"""Studio's harness: what keeps an LLM-made agent safe, independent of how good the LLM is.

1. Input guard (`scan`): a request with shell commands (rm -rf ~/, sudo, curl | sh ...) or prompt
   injection is refused before any LLM call.
2. Form, not code: the LLM only fills slots whose choices come from the catalogs (studio/slots.py);
   rules and device ids are compiled by code (studio/compile.py).
3. Output guard (`check_text`): the few free-text slots (name, description, question) are scanned
   like the input, and must be one plain line.
4. Capability lock (`check_rendered`): the rendered OpenClaw profile must keep the fixed tool
   allowlist (only the Ambient-A2A plugin; no shell, file or web tools), the fixed workspace and
   plugin paths, ASCII-only config, and devices limited to what the agent owns.
5. The user approves the draft before anything is written or registered (studio/main.py).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

REQUEST_LIMIT = 500  # characters of one Studio request
PORT_RANGE = range(19400, 25000)  # generated agents' OpenClaw gateway ports
HOME_PLUGIN_PATH = "${AMBIENT_HOME}/app/agents/ambient-a2a-plugin"
TOOLS = {"profile": "minimal", "alsoAllow": ["ambient-a2a"], "toolSearch": False}
SKILLS = {"allowBundled": []}


@dataclass(frozen=True)
class Finding:
    code: str
    message: str
    excerpt: str

    def text(self) -> str:
        return f"{self.code}: {self.message} ({self.excerpt!r})"


_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    (code, message, re.compile(pattern, re.IGNORECASE))
    for code, message, pattern in [
        ("RM_RECURSIVE", "recursive delete", r"\brm\s+(-[a-z]*r[a-z]*|--recursive)\b"),
        ("PRIVILEGE", "privilege escalation", r"\b(sudo|doas)\b|\bsu\s+-"),
        ("DISK_WIPE", "disk wipe", r"\bmkfs(\.\w+)?\b|\bdd\s+if=|>\s*/dev/(sd|nvme|disk)"),
        ("FORK_BOMB", "fork bomb", r":\s*\(\s*\)\s*\{"),
        ("PERMISSIONS", "permission change", r"\bchmod\s+(-r\s+)?[0-7]*777\b|\bchown\s+-r\b"),
        (
            "REMOTE_SCRIPT",
            "downloaded script piped to a shell",
            r"\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b",
        ),
        ("POWER", "shutdown or reboot", r"\b(shutdown|reboot|halt|poweroff)\b"),
        (
            "CODE_EXEC",
            "code execution",
            r"\beval\s*\(|\bexec\s*\(|\bos\.system\b|\bsubprocess\b|\bchild_process\b",
        ),
        (
            "SECRETS",
            "credential or system file",
            r"/etc/(passwd|shadow|sudoers)\b|~/\.ssh\b|\bid_(rsa|ed25519)\b|\.aws/credentials",
        ),
        (
            "PROMPT_INJECTION",
            "attempt to override the instructions",
            r"\b(ignore|disregard)\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions|rules)"
            r"|(이전|위의?)\s*(지시|명령|규칙)\S*\s*(무시|잊)|system\s+prompt|시스템\s*프롬프트",
        ),
    ]
]


def scan(text: str) -> list[Finding]:
    """Dangerous commands and injection attempts in `text`, one finding per rule."""
    found = []
    for code, message, pattern in _RULES:
        m = pattern.search(text)
        if m:
            found.append(Finding(code, message, m.group(0)[:60]))
    return found


def check_request(text: str) -> list[Finding]:
    found = scan(text)
    if len(text) > REQUEST_LIMIT:
        found.append(Finding("TOO_LONG", f"longer than {REQUEST_LIMIT} characters", text[:20]))
    return found


_CONTROL = re.compile(r"[\x00-\x1f\x7f`]")
_MARKUP = re.compile(r"(^\s*#|\$\{|\{\{|<\s*/?\s*(script|system)\b)", re.IGNORECASE)


def check_text(name: str, value: str | None) -> list[str]:
    """A free-text slot: one plain line, no commands, no markup that would change the files it is
    written into (AGENTS.md is the agent's own instructions)."""
    if not value:
        return []
    problems = [f"{name}: {f.text()}" for f in scan(value)]
    if _CONTROL.search(value):
        problems.append(f"{name}: must be one line without control characters or backticks")
    if _MARKUP.search(value):
        problems.append(f"{name}: must not contain headings, ${{...}}, {{{{...}}}} or tags")
    return problems


def _walk(value: Any, path: str = "") -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        return [x for k, v in value.items() for x in _walk(v, f"{path}.{k}")]
    if isinstance(value, list):
        return [x for i, v in enumerate(value) for x in _walk(v, f"{path}[{i}]")]
    return [(path, value)]


def check_rendered(
    profile: dict[str, Any], agent_id: str, owned: list[str], agents_md: str
) -> list[str]:
    """Capability lock on the rendered OpenClaw profile. The renderer is code, so this never fails
    unless that code (or a hand-edited draft) breaks a rule; it is the last line before disk."""
    problems: list[str] = []
    if profile.get("tools") != TOOLS:
        problems.append(f"tools must be exactly {TOOLS} (no shell, file or web tools)")
    if profile.get("skills") != SKILLS:
        problems.append("bundled OpenClaw skills must stay off")
    defaults = profile.get("agents", {}).get("defaults", {})
    if defaults.get("workspace") != f"${{AMBIENT_HOME}}/state/{agent_id}/workspace":
        problems.append("workspace must be the agent's own state directory")
    plugins = profile.get("plugins", {})
    if plugins.get("load") != {"paths": [HOME_PLUGIN_PATH]}:
        problems.append("only the Ambient-A2A plugin may be loaded")
    if set(plugins.get("entries", {})) != {"ambient-a2a"}:
        problems.append("only the ambient-a2a plugin entry is allowed")
    gateway = profile.get("gateway", {})
    if gateway.get("$include") != "../../gateway.json5" or gateway.get("port") not in PORT_RANGE:
        problems.append("gateway must include ../../gateway.json5 and use a generated-agent port")
    config = plugins.get("entries", {}).get("ambient-a2a", {}).get("config", {})
    if config.get("agentId") != agent_id or config.get("$include") != "../../shared.json5":
        problems.append("plugin config must be this agent's and include ../../shared.json5")
    used = {a.get("device") for r in config.get("rules", []) for a in r.get("actions", [])}
    used |= {a.get("device") for a in config.get("energySaving", [])}
    used |= {d for p in config.get("policies", []) for d in p.get("deny", {}).get("devices", [])}
    if not used <= set(owned) or set(config.get("owned", [])) != set(owned):
        problems.append("the agent may only act on the devices it owns")
    for path, value in _walk(profile):
        if not isinstance(value, str):
            continue
        if not value.isascii():
            problems.append(f"{path}: config must be ASCII (OpenClaw rejects non-ASCII paths)")
        problems += [f"{path}: {f.text()}" for f in scan(value)]
    problems += [f"AGENTS.md: {f.text()}" for f in scan(agents_md)]
    text = json.dumps(profile)
    for word in ("elevated", '"exec"', '"bash"', '"shell"', '"process"'):
        if word in text:
            problems.append(f"forbidden capability {word} in the profile")
    return problems
