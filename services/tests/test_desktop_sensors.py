import logging
import subprocess
from datetime import UTC, datetime, timedelta

import pytest

from agents.desktop import sensors
from agents.desktop.sensors import (
    MEETING_APPS,
    build_desktop_state,
    list_process_names,
    meeting_app_active,
    next_meeting_start,
    parse_hid_idle_seconds,
    pc_state,
    read_desktop_state,
    read_idle_seconds,
)
from ambient.schemas import CONTEXT_FIELDS, PcState
from homeconfig.loader import DEFAULT_CONFIG_DIR

NOW = datetime(2026, 10, 16, 5, 0, tzinfo=UTC)
TITLE = "Secret project review"


def ics(*events: str) -> str:
    body = "".join(f"BEGIN:VEVENT\r\n{e.strip()}\r\nEND:VEVENT\r\n" for e in events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n"


def event(start: str, end: str | None = None, extra: str = "") -> str:
    lines = [f"SUMMARY:{TITLE}", f"DTSTART{start}"]
    if end is not None:
        lines.append(f"DTEND{end}")
    if extra:
        lines.append(extra)
    return "\r\n".join(lines)


# --- W3-1 calendar -------------------------------------------------------------


def test_utc_event():
    text = ics(event(":20261016T060000Z", ":20261016T063000Z"))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_tzid_event_is_converted_to_utc():
    text = ics(event(";TZID=Asia/Seoul:20261016T150000", ";TZID=Asia/Seoul:20261016T153000"))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_quoted_tzid_with_other_zone():
    text = ics(event(';TZID="America/New_York":20261016T020000'))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_unknown_tzid_falls_back_to_default_zone():
    text = ics(event(";TZID=Korea Standard Time:20261016T150000"))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_floating_time_uses_default_tz():
    text = ics(event(":20261016T150000", ":20261016T153000"))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)
    in_utc = next_meeting_start(text, NOW, default_tz="UTC")
    assert in_utc == datetime(2026, 10, 16, 15, 0, tzinfo=UTC)


def test_all_day_events_are_not_meetings():
    text = ics(
        event(";VALUE=DATE:20261016", ";VALUE=DATE:20261017"),
        event(":20261017"),  # date without VALUE=DATE
    )
    assert next_meeting_start(text, NOW) is None


def test_folded_lines_are_unfolded():
    text = (
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n"
        "SUMMARY:A very long title that\r\n  wraps over two lines\r\n"
        "DTSTART;TZID=Asia/\r\n Seoul:20261016T15\r\n\t0000\r\n"
        "DTEND:20261016T063000Z\r\n"
        "END:VEVENT\r\nEND:VCALENDAR\r\n"
    )
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_lf_line_endings():
    text = ics(event(":20261016T060000Z")).replace("\r\n", "\n")
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 6, 0, tzinfo=UTC)


def test_past_ongoing_and_future_meetings():
    past = event(":20261016T030000Z", ":20261016T040000Z")
    ongoing = event(":20261016T043000Z", ":20261016T053000Z")
    future = event(":20261016T070000Z", ":20261016T080000Z")
    assert next_meeting_start(ics(past, future), NOW) == datetime(2026, 10, 16, 7, tzinfo=UTC)
    # an ongoing meeting wins and returns its (past) start
    got = next_meeting_start(ics(past, future, ongoing), NOW)
    assert got == datetime(2026, 10, 16, 4, 30, tzinfo=UTC)
    assert next_meeting_start(ics(past), NOW) is None


def test_meeting_ending_exactly_now_is_over():
    text = ics(event(":20261016T040000Z", ":20261016T050000Z"))
    assert next_meeting_start(text, NOW) is None
    assert next_meeting_start(text, NOW - timedelta(seconds=1)) is not None


def test_missing_dtend_lasts_one_hour():
    text = ics(event(":20261016T043000Z"))
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 4, 30, tzinfo=UTC)
    assert next_meeting_start(text, NOW + timedelta(minutes=30)) is None


def test_cancelled_events_and_alarms_are_ignored():
    cancelled = event(":20261016T060000Z", extra="STATUS:CANCELLED")
    with_alarm = event(
        ":20261016T070000Z",
        extra="BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nEND:VALARM",
    )
    got = next_meeting_start(ics(cancelled, with_alarm), NOW)
    assert got == datetime(2026, 10, 16, 7, 0, tzinfo=UTC)


def test_vtimezone_dtstart_is_not_an_event():
    text = (
        "BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Seoul\r\nBEGIN:STANDARD\r\n"
        "DTSTART:20261016T060000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nEND:VCALENDAR\r\n"
    )
    assert next_meeting_start(text, NOW) is None


def test_no_events_or_garbage_returns_none():
    assert next_meeting_start("", NOW) is None
    assert next_meeting_start(ics(), NOW) is None
    assert next_meeting_start("not a calendar\n:::\n;;;", NOW) is None
    assert next_meeting_start(ics(event(":2026-10-16 06:00")), NOW) is None


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        next_meeting_start(ics(), datetime(2026, 10, 16, 5, 0))


def test_repo_demo_calendar():
    text = sensors.read_calendar(DEFAULT_CONFIG_DIR / "calendar.ics")
    assert next_meeting_start(text, NOW) == datetime(2026, 10, 16, 5, 0, tzinfo=UTC)


# --- W3-2 idle time -------------------------------------------------------------

IOREG_SAMPLE = """\
+-o IOHIDSystem  <class IOHIDSystem, id 0x10000052b, registered, matched, active, busy 0>
    {
      "IOClass" = "IOHIDSystem"
      "HIDScrollCountMaxTimeDeltaBetween" = 600
      "IOProviderClass" = "IOResources"
      "IOProbeScore" = 0
      "HIDIdleTime" = 73236624833
      "HIDScrollCountIgnoreMomentumScrolls" = Yes
      "HIDPowerOnDelayNS" = 500000000
      "HIDParameters" = {"HIDMouseKeysOptionToggles"=0,"JitterNoClick"=1,"Dragging"=0}
    }
"""

IOREG_TREE_SAMPLE = """\
+-o Root  <class IORegistryEntry, id 0x100000100, retain 34>
  +-o MacBookPro18,3  <class IOPlatformExpertDevice, id 0x100000226>
    +-o IOResources  <class IOResources, id 0x100000101, registered>
    | +-o IOHIDSystem  <class IOHIDSystem, id 0x10000052b, registered>
    | | {
    | |   "IOClass" = "IOHIDSystem"
    | |   "HIDIdleTime" = 1500000000
    | | }
"""


def test_parse_hid_idle_seconds():
    assert parse_hid_idle_seconds(IOREG_SAMPLE) == pytest.approx(73.236624833)
    assert parse_hid_idle_seconds(IOREG_TREE_SAMPLE) == pytest.approx(1.5)


def test_parse_hid_idle_seconds_garbage():
    assert parse_hid_idle_seconds("") is None
    assert parse_hid_idle_seconds("command not found: ioreg") is None
    assert parse_hid_idle_seconds('"HIDIdleTime" = Yes') is None
    assert parse_hid_idle_seconds('"HIDParameters" = {"HIDIdleTime"=5}') is None


def fake_run(outputs: dict[str, str | Exception]):
    calls: list[list[str]] = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        assert kwargs["timeout"] <= 5
        out = outputs[cmd[0]]
        if isinstance(out, Exception):
            raise out
        return subprocess.CompletedProcess(cmd, 0, stdout=out, stderr="")

    run.calls = calls
    return run


def test_read_idle_seconds_on_macos(monkeypatch):
    run = fake_run({"ioreg": IOREG_SAMPLE})
    monkeypatch.setattr(sensors.sys, "platform", "darwin")
    monkeypatch.setattr(sensors.subprocess, "run", run)
    assert read_idle_seconds() == pytest.approx(73.236624833)
    assert run.calls[0][0] == "ioreg" and "IOHIDSystem" in run.calls[0]


def test_read_idle_seconds_failures(monkeypatch):
    monkeypatch.setattr(sensors.sys, "platform", "darwin")
    timeout = subprocess.TimeoutExpired("ioreg", 2)
    monkeypatch.setattr(sensors.subprocess, "run", fake_run({"ioreg": timeout}))
    assert read_idle_seconds() is None
    monkeypatch.setattr(sensors.subprocess, "run", fake_run({"ioreg": FileNotFoundError()}))
    assert read_idle_seconds() is None


def test_read_idle_seconds_off_macos(monkeypatch):
    run = fake_run({})
    monkeypatch.setattr(sensors.sys, "platform", "linux")
    monkeypatch.setattr(sensors.subprocess, "run", run)
    assert read_idle_seconds() is None
    assert run.calls == []


# --- W3-2 meeting apps ------------------------------------------------------------

PS_SAMPLE = """\
/sbin/launchd
/usr/libexec/logd
Core Audio Driver (ZoomAudioDevice.driver)
/Applications/zoom.us.app/Contents/MacOS/zoom.us
/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams

"""


def test_zoom_audio_driver_is_not_a_meeting():
    assert not meeting_app_active(["Core Audio Driver (ZoomAudioDevice.driver)"])
    assert not meeting_app_active(["ZoomAudioDevice.driver", "zoom", "Zoom", "zoom.us.helper"])
    assert not meeting_app_active(["/Applications/zoom.us.app/Contents/Frameworks/ZoomUpdater"])
    assert not meeting_app_active(["Microsoft Teams Helper (Renderer)", "Google Chrome"])
    assert not meeting_app_active([])


@pytest.mark.parametrize("name", sorted(MEETING_APPS))
def test_exact_meeting_app_names(name):
    assert meeting_app_active(["/sbin/launchd", name])
    assert meeting_app_active([f"/Applications/X.app/Contents/MacOS/{name}"])


def test_list_process_names(monkeypatch):
    monkeypatch.setattr(sensors.subprocess, "run", fake_run({"ps": PS_SAMPLE}))
    names = list_process_names()
    assert names == [
        "launchd",
        "logd",
        "Core Audio Driver (ZoomAudioDevice.driver)",
        "zoom.us",
        "MSTeams",
    ]
    assert meeting_app_active(names)


def test_list_process_names_failure(monkeypatch):
    error = subprocess.CalledProcessError(1, "ps")
    monkeypatch.setattr(sensors.subprocess, "run", fake_run({"ps": error}))
    assert list_process_names() == []


# --- W3-2 pc_state ---------------------------------------------------------------


def test_pc_state_threshold_boundaries():
    assert pc_state(0) is PcState.ACTIVE
    assert pc_state(299.9) is PcState.ACTIVE
    assert pc_state(300) is PcState.IDLE
    assert pc_state(3600) is PcState.IDLE
    assert pc_state(59, idle_threshold=60) is PcState.ACTIVE
    assert pc_state(60, idle_threshold=60) is PcState.IDLE


def test_pc_state_unknown_idle_and_no_session():
    assert pc_state(None) is PcState.IDLE
    assert pc_state(0, session_active=False) is PcState.OFF
    assert pc_state(None, session_active=False) is PcState.OFF


# --- Shared Desktop state ----------------------------------------------------------


def test_build_desktop_state_keys_and_values():
    text = ics(event(";TZID=Asia/Seoul:20261016T150000", ";TZID=Asia/Seoul:20261016T153000"))
    state = build_desktop_state(NOW, text, 12.0, ["/sbin/launchd", "zoom.us"])
    assert set(state) == {"meeting_app_active", "meeting_start_at", "pc_state"}
    assert set(state) <= CONTEXT_FIELDS
    assert state == {
        "meeting_app_active": True,
        "meeting_start_at": "2026-10-16T06:00:00+00:00",
        "pc_state": "ACTIVE",
    }
    assert datetime.fromisoformat(state["meeting_start_at"]).utcoffset() == timedelta(0)


def test_build_desktop_state_without_meeting():
    state = build_desktop_state(NOW, "", None, [], session_active=False)
    assert state == {"meeting_app_active": False, "meeting_start_at": None, "pc_state": "OFF"}


def test_raw_data_never_leaves(caplog):
    text = ics(event(":20261016T060000Z", extra=f"DESCRIPTION:{TITLE} agenda"))
    with caplog.at_level(logging.DEBUG):
        state = build_desktop_state(NOW, text, 1.0, PS_SAMPLE.splitlines())
    dumped = repr(state)
    for raw in (TITLE, "agenda", "launchd", "ZoomAudioDevice", "/Applications"):
        assert raw not in dumped
        assert raw not in caplog.text


def test_read_desktop_state_composes_readers(monkeypatch, tmp_path):
    calendar = tmp_path / "calendar.ics"
    calendar.write_text("﻿" + ics(event(":20261016T060000Z")), encoding="utf-8")
    monkeypatch.setattr(sensors.sys, "platform", "darwin")
    run = fake_run({"ioreg": IOREG_SAMPLE, "ps": PS_SAMPLE})
    monkeypatch.setattr(sensors.subprocess, "run", run)
    state = read_desktop_state(NOW, calendar)
    assert state == {
        "meeting_app_active": True,
        "meeting_start_at": "2026-10-16T06:00:00+00:00",
        "pc_state": "ACTIVE",
    }
    assert sorted(c[0] for c in run.calls) == ["ioreg", "ps"]


def test_read_desktop_state_without_calendar(monkeypatch, tmp_path):
    monkeypatch.setattr(sensors.sys, "platform", "linux")
    monkeypatch.setattr(sensors.subprocess, "run", fake_run({"ps": OSError()}))
    state = read_desktop_state(NOW, tmp_path / "missing.ics")
    assert state == {"meeting_app_active": False, "meeting_start_at": None, "pc_state": "IDLE"}
