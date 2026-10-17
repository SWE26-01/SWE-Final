"""Desktop sensors (WBS W3-1, W3-2): next meeting, idle time and meeting apps.

Raw PC data (event titles, process lists, ioreg dumps) stays inside this module. The only
output meant for other agents is `build_desktop_state`: `meeting_app_active`,
`meeting_start_at` and `pc_state`. Parsers are pure; system calls live in small readers.
"""

from __future__ import annotations

import logging
import re
import subprocess
import sys
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ambient.schemas import CONTEXT_FIELDS, PcState

log = logging.getLogger(__name__)

DEFAULT_TZ = "Asia/Seoul"
DEFAULT_EVENT_LENGTH = timedelta(hours=1)
IDLE_THRESHOLD_SECONDS = 300.0
COMMAND_TIMEOUT_SECONDS = 2.0

# --- W3-1 calendar (minimal RFC 5545 VEVENT reader) ---------------------------

_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_DATE_TIME = re.compile(r"^(\d{8}T\d{6})(Z?)$")
# Only these VEVENT properties are ever kept; SUMMARY, DESCRIPTION etc. are dropped unread.
_EVENT_PROPS = frozenset({"DTSTART", "DTEND", "STATUS"})

_Prop = tuple[dict[str, str], str]  # (parameters, value)


def read_calendar(path: str | Path) -> str:
    """Read an .ics file (BOM and bad bytes tolerated)."""
    return Path(path).read_text(encoding="utf-8-sig", errors="replace")


def _unfold(ics_text: str) -> list[str]:
    """Join folded lines: a line starting with a space or tab continues the previous one."""
    lines: list[str] = []
    for line in _LINE_BREAK.split(ics_text):
        if line[:1] in (" ", "\t") and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    return lines


def _content_line(line: str) -> tuple[str, dict[str, str], str] | None:
    """Split `NAME;KEY=VAL:value` into (NAME, {KEY: VAL}, value). Quotes may hide ';' and ':'."""
    head: list[str] = []
    start, quoted = 0, False
    for i, ch in enumerate(line):
        if ch == '"':
            quoted = not quoted
        elif ch in ";:" and not quoted:
            head.append(line[start:i])
            start = i + 1
            if ch == ":":
                name, *raw_params = head
                params: dict[str, str] = {}
                for raw in raw_params:
                    key, _, val = raw.partition("=")
                    params[key.strip().upper()] = val.strip().strip('"')
                return name.strip().upper(), params, line[start:]
    return None


def _events(lines: Iterable[str]) -> Iterator[dict[str, _Prop]]:
    """Yield the kept properties of each VEVENT (nested VALARM etc. are skipped)."""
    stack: list[str] = []
    props: dict[str, _Prop] = {}
    for line in lines:
        parsed = _content_line(line)
        if parsed is None:
            continue
        name, params, value = parsed
        if name == "BEGIN":
            stack.append(value.strip().upper())
            if stack[-1] == "VEVENT":
                props = {}
        elif name == "END":
            if stack and stack[-1] == value.strip().upper():
                if stack.pop() == "VEVENT":
                    yield props
        elif stack and stack[-1] == "VEVENT" and name in _EVENT_PROPS:
            props[name] = (params, value.strip())


def _zone(tzid: str, fallback: ZoneInfo) -> ZoneInfo:
    try:
        return ZoneInfo(tzid)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        # e.g. Outlook's "Korea Standard Time"; assume the user's own zone
        return fallback


def _parse_date_time(prop: _Prop, default_tz: ZoneInfo) -> datetime | None:
    """DATE-TIME (UTC, TZID or floating) as aware UTC; None for all-day DATE or garbage."""
    params, value = prop
    if params.get("VALUE", "DATE-TIME").upper() != "DATE-TIME":
        return None
    match = _DATE_TIME.match(value)
    if match is None:
        return None
    try:
        local = datetime.strptime(match.group(1), "%Y%m%dT%H%M%S")
    except ValueError:
        return None
    if match.group(2):
        tz: tzinfo = UTC
    elif "TZID" in params:
        tz = _zone(params["TZID"], default_tz)
    else:
        tz = default_tz
    return local.replace(tzinfo=tz).astimezone(UTC)


def next_meeting_start(
    ics_text: str, now: datetime, default_tz: str = DEFAULT_TZ
) -> datetime | None:
    """Start (aware UTC) of the earliest timed event that has not ended yet, or None.

    An ongoing event returns its past start. All-day and cancelled events are ignored, and
    an event without DTEND lasts one hour. Recurrence (RRULE) is not expanded.
    Only DTSTART/DTEND/STATUS are read; titles and descriptions never leave the parser.
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    tz = ZoneInfo(default_tz)
    starts: list[datetime] = []
    for props in _events(_unfold(ics_text)):
        status = props["STATUS"][1].upper() if "STATUS" in props else ""
        if status == "CANCELLED" or "DTSTART" not in props:
            continue
        start = _parse_date_time(props["DTSTART"], tz)
        if start is None:
            continue
        end = _parse_date_time(props["DTEND"], tz) if "DTEND" in props else None
        if (end or start + DEFAULT_EVENT_LENGTH) > now:
            starts.append(start)
    return min(starts, default=None)


# --- W3-2 PC state: idle time and meeting apps --------------------------------

# Property line of the IOHIDSystem node, e.g. `    | |   "HIDIdleTime" = 73236624833` (ns)
_HID_IDLE = re.compile(r'^[ \t|]*"HIDIdleTime"\s*=\s*(\d+)\s*$', re.MULTILINE)

# Exact executable basenames (`ps -axo comm=`). Never substring-match: "zoom" also hits
# "Core Audio Driver (ZoomAudioDevice.driver)", which runs even when Zoom is closed.
# Browser-based meetings (Google Meet, Zoom/Teams on the web) run inside the browser
# process and cannot be detected from process names.
MEETING_APPS: frozenset[str] = frozenset(
    {"zoom.us", "Microsoft Teams", "MSTeams", "Webex", "FaceTime"}
)


def _run(cmd: list[str]) -> str | None:
    """Run a short read-only command; None if it is missing, times out or fails."""
    try:
        done = subprocess.run(
            cmd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout


def parse_hid_idle_seconds(ioreg_output: str) -> float | None:
    """Seconds since the last keyboard/mouse input from `ioreg` HIDIdleTime, or None."""
    values = [int(v) for v in _HID_IDLE.findall(ioreg_output)]
    return min(values) / 1e9 if values else None


def read_idle_seconds() -> float | None:
    """Idle seconds via `ioreg` (macOS only); None on other systems or on failure."""
    if sys.platform != "darwin":
        return None
    # -r -d 1: only the IOHIDSystem node itself, not the whole registry (~2000 lines)
    out = _run(["ioreg", "-r", "-d", "1", "-c", "IOHIDSystem"])
    return None if out is None else parse_hid_idle_seconds(out)


def _basename(name: str) -> str:
    return name.strip().rsplit("/", 1)[-1]


def list_process_names() -> list[str]:
    """Basenames of running processes via `ps`; empty on failure. Do not share this list."""
    out = _run(["ps", "-axo", "comm="])
    if out is None:
        return []
    return [name for line in out.splitlines() if (name := _basename(line))]


def meeting_app_active(process_names: Iterable[str]) -> bool:
    """True if some process basename is exactly one of MEETING_APPS."""
    return any(_basename(name) in MEETING_APPS for name in process_names)


def pc_state(
    idle_seconds: float | None,
    session_active: bool = True,
    idle_threshold: float = IDLE_THRESHOLD_SECONDS,
) -> PcState:
    """OFF without an active session; IDLE if idle >= threshold or unknown; else ACTIVE."""
    if not session_active:
        return PcState.OFF
    if idle_seconds is None or idle_seconds >= idle_threshold:
        return PcState.IDLE
    return PcState.ACTIVE


# --- Shared Desktop state -----------------------------------------------------


def build_desktop_state(
    now: datetime,
    ics_text: str,
    idle_seconds: float | None,
    process_names: Iterable[str],
    session_active: bool = True,
) -> dict[str, object]:
    """The Desktop Agent's shareable state: three CONTEXT_FIELDS, no raw data."""
    start = next_meeting_start(ics_text, now)
    state: dict[str, object] = {
        "meeting_app_active": meeting_app_active(process_names),
        "meeting_start_at": None if start is None else start.isoformat(),
        "pc_state": pc_state(idle_seconds, session_active),
    }
    assert state.keys() <= CONTEXT_FIELDS, "desktop state must use shared context fields only"
    return state


def read_desktop_state(now: datetime, calendar_path: str | Path) -> dict[str, object]:
    """Read the real calendar, idle time and process list into the shareable state."""
    try:
        ics_text = read_calendar(calendar_path)
    except OSError:
        log.warning("calendar not readable: %s", calendar_path)
        ics_text = ""
    return build_desktop_state(now, ics_text, read_idle_seconds(), list_process_names())
