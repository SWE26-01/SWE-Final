import shutil
from pathlib import Path

import pytest
import yaml

from homeconfig import ConfigError, load_config
from homeconfig.loader import DEFAULT_CONFIG_DIR


@pytest.fixture
def cfg_dir(tmp_path: Path) -> Path:
    for name in ("devices.yaml", "agents.yaml", "policies.yaml"):
        shutil.copy(DEFAULT_CONFIG_DIR / name, tmp_path / name)
    return tmp_path


def edit(path: Path, fn) -> None:
    data = yaml.safe_load(path.read_text())
    fn(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True))


def problems(cfg_dir: Path) -> str:
    with pytest.raises(ConfigError) as exc:
        load_config(cfg_dir)
    return "\n".join(exc.value.problems)


def agent(data, agent_id):
    return next(a for a in data["agents"] if a["id"] == agent_id)


def test_repo_config_loads():
    cfg = load_config()
    assert cfg.owner_of("robot_vacuum") == "home-agent"
    assert cfg.agent_by_token("dev-my-room-user1").id == "my-room-user1"
    assert cfg.allowed_fields("desktop-user1", "home-agent") == ["pc_state"]
    assert cfg.allowed_fields("desktop-user1", "dashboard") == []
    assert {d.id for d in cfg.devices_owned_by("my-room-user1")} == {"my_room_light", "my_room_ac"}


def test_typo_key_is_rejected(cfg_dir):
    edit(cfg_dir / "devices.yaml", lambda d: d["devices"][0].update(ownr="x"))
    assert "devices.0.ownr" in problems(cfg_dir)


def test_device_owner_must_exist(cfg_dir):
    edit(cfg_dir / "devices.yaml", lambda d: d["devices"][0].update(owner="ghost"))
    assert "owner 'ghost' is not in agents.yaml" in problems(cfg_dir)


def test_subscription_needs_provider_field_and_disclosure(cfg_dir):
    def f(d):
        agent(d, "home-agent")["subscribe"].append(
            {"to": "desktop-user1", "fields": ["meeting_app_active", "gps"]}
        )

    edit(cfg_dir / "agents.yaml", f)
    out = problems(cfg_dir)
    assert "'desktop-user1' does not provide 'gps'" in out
    assert "desktop-user1.meeting_app_active but disclosure does not allow it" in out


def test_automation_must_use_owned_device_or_request_owner(cfg_dir):
    def f(d):
        actions = d["agents"]["my-room-user1"]["automation"][0]["then"]
        actions[1].pop("request")  # robot_vacuum belongs to home-agent

    edit(cfg_dir / "policies.yaml", f)
    assert "use `request: home-agent`" in problems(cfg_dir)


def test_automation_source_must_be_subscribed(cfg_dir):
    def f(d):
        subs = agent(d, "my-room-user1")["subscribe"]
        subs[:] = [s for s in subs if s["to"] != "mobile-user1"]

    edit(cfg_dir / "agents.yaml", f)
    assert "uses mobile-user1.presence but the agent does not subscribe to it" in problems(cfg_dir)


def test_deny_if_requires_reason(cfg_dir):
    def f(d):
        d["agents"]["baby-room-agent"]["requests"][0].pop("reason")

    edit(cfg_dir / "policies.yaml", f)
    assert "has deny_if but no reason" in problems(cfg_dir)


def test_duplicate_tokens_are_rejected(cfg_dir):
    def f(d):
        agent(d, "home-agent").update(token="dev-my-room-user1")

    edit(cfg_dir / "agents.yaml", f)
    assert "duplicate token" in problems(cfg_dir)
