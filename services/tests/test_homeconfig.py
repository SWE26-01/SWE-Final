import shutil
from pathlib import Path

import pytest
import yaml
from support import ENV

from homeconfig import ConfigError, load_config
from homeconfig.loader import DEFAULT_CONFIG_DIR, DEFAULT_HA_URL
from homeconfig.models import Role


@pytest.fixture
def cfg_dir(tmp_path: Path) -> Path:
    for name in ("devices.yaml", "agents.yaml"):
        shutil.copy(DEFAULT_CONFIG_DIR / name, tmp_path / name)
    return tmp_path


def edit(path: Path, fn) -> None:
    data = yaml.safe_load(path.read_text())
    fn(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True))


def problems(cfg_dir: Path, env: dict[str, str] = ENV) -> str:
    with pytest.raises(ConfigError) as exc:
        load_config(cfg_dir, env)
    return "\n".join(exc.value.problems)


def test_repo_config_loads():
    cfg = load_config(env=ENV)
    assert cfg.owner_of("input_boolean.living_tv_muted") == "orchestrator"
    assert cfg.owner_of("input_boolean.not_a_device") is None
    assert set(cfg.owned_by("room2")) == {
        "input_boolean.room2_light",
        "input_boolean.room2_ac",
        "input_boolean.room2_sleep_mode",
    }
    room1 = cfg.caller_by_token("t-room1")
    assert room1 is not None and room1.id == "room1" and room1.role is Role.AGENT
    assert room1.url == "http://127.0.0.1:19160/plugins/ambient"
    assert cfg.caller_by_token("t-dashboard").role is Role.OPERATOR
    assert cfg.caller_by_token("t-ha") is None  # the HA token is not a caller
    agents = [a.id for a in cfg.agents()]
    assert agents == ["desktop", "smartphone", "orchestrator", "room1", "room2"]
    assert (cfg.ha_url, cfg.ha_token) == ("http://ha.test:8123", "t-ha")


def test_every_owner_of_a_device_is_an_agent_with_a_url():
    cfg = load_config(env=ENV)
    for device in cfg.devices.values():
        assert cfg.callers[device.owner].url


def test_ha_defaults():
    env = {k: v for k, v in ENV.items() if not k.startswith("HA_")}
    cfg = load_config(env=env)
    assert (cfg.ha_url, cfg.ha_token) == (DEFAULT_HA_URL, None)
    assert load_config(env={**env, "HA_URL": "http://ha:8123/"}).ha_url == "http://ha:8123"


def test_missing_token_is_reported(cfg_dir):
    env = {k: v for k, v in ENV.items() if k != "AMBIENT_TOKEN_ROOM2"}
    assert "room2: environment variable AMBIENT_TOKEN_ROOM2 is not set" in problems(cfg_dir, env)


def test_shared_token_is_reported(cfg_dir):
    env = {**ENV, "AMBIENT_TOKEN_ROOM2": "t-room1"}
    assert "room2: same token as 'room1'" in problems(cfg_dir, env)


def test_device_checks(cfg_dir):
    def bad(data):
        data["devices"] += [
            {"entity": "input_boolean.x", "space": "attic", "owner": "room1"},
            {"entity": "input_boolean.y", "space": "my_room", "owner": "dashboard"},
            {"entity": "input_boolean.room1_light", "space": "my_room", "owner": "room1"},
            {"entity": "Not An Entity", "space": "my_room", "owner": "room1"},
        ]

    edit(cfg_dir / "devices.yaml", bad)
    found = problems(cfg_dir)
    assert ".entity: String should match pattern" in found  # schema errors come first, alone
    edit(cfg_dir / "devices.yaml", lambda d: d["devices"].pop())
    found = problems(cfg_dir)
    assert "device 'input_boolean.x': unknown space 'attic'" in found
    assert "device 'input_boolean.y': owner 'dashboard' is not an agent" in found
    assert "duplicate device 'input_boolean.room1_light'" in found


def test_caller_cannot_be_agent_and_operator(cfg_dir):
    edit(cfg_dir / "agents.yaml", lambda d: d["operators"].update(room1={"token_env": "X"}))
    assert "'room1' is listed as both an agent and an operator" in problems(cfg_dir)


def test_unknown_keys_rejected(cfg_dir):
    edit(cfg_dir / "agents.yaml", lambda d: d["agents"]["room1"].update(token="plain"))
    assert "agents.room1.token: Extra inputs are not permitted" in problems(cfg_dir)
