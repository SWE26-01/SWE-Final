import shutil
from pathlib import Path

import pytest
import yaml
from support import ENV

from homeconfig import ConfigError, load_config
from homeconfig.loader import DEFAULT_CONFIG_DIR, DEFAULT_HA_URL
from homeconfig.models import Role

HA_CONFIG = DEFAULT_CONFIG_DIR.parents[1] / "homeassistant" / "config" / "configuration.yaml"


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
    assert cfg.owner_of("input_boolean.living_tv") == "home"
    assert cfg.owner_of("input_boolean.not_a_device") is None
    assert set(cfg.owned_by("home")) == set(cfg.devices)  # only the Home Agent commands devices
    home = cfg.caller_by_token("t-home")
    assert home is not None and home.id == "home" and home.role is Role.AGENT
    assert cfg.caller_by_token("t-dashboard").role is Role.OPERATOR
    assert cfg.caller_by_token("t-ha") is None  # the HA token is not a caller
    assert [a.id for a in cfg.agents()] == ["home"]
    assert (cfg.ha_url, cfg.ha_token) == ("http://ha.test:8123", "t-ha")


def test_devices_match_home_assistant():
    ha = yaml.safe_load(HA_CONFIG.read_text())
    helpers = {f"{kind}.{name}" for kind in ha if kind.startswith("input_") for name in ha[kind]}
    assert helpers == set(load_config(env=ENV).devices)


def test_ha_defaults():
    env = {k: v for k, v in ENV.items() if not k.startswith("HA_")}
    cfg = load_config(env=env)
    assert (cfg.ha_url, cfg.ha_token) == (DEFAULT_HA_URL, None)
    assert load_config(env={**env, "HA_URL": "http://ha:8123/"}).ha_url == "http://ha:8123"


def test_missing_token_is_reported(cfg_dir):
    env = {k: v for k, v in ENV.items() if k != "AMBIENT_TOKEN_HOME"}
    assert "home: environment variable AMBIENT_TOKEN_HOME is not set" in problems(cfg_dir, env)


def test_shared_token_is_reported(cfg_dir):
    env = {**ENV, "DASHBOARD_TOKEN": "t-home"}
    assert "dashboard: same token as 'home'" in problems(cfg_dir, env)


def test_device_checks(cfg_dir):
    def bad(data):
        data["devices"] += [
            {"entity": "input_boolean.x", "space": "attic", "owner": "home"},
            {"entity": "input_boolean.y", "space": "living_room", "owner": "dashboard"},
            {"entity": "input_boolean.living_light", "space": "living_room", "owner": "home"},
            {"entity": "Not An Entity", "space": "living_room", "owner": "home"},
        ]

    edit(cfg_dir / "devices.yaml", bad)
    found = problems(cfg_dir)
    assert ".entity: String should match pattern" in found  # schema errors come first, alone
    edit(cfg_dir / "devices.yaml", lambda d: d["devices"].pop())
    found = problems(cfg_dir)
    assert "device 'input_boolean.x': unknown space 'attic'" in found
    assert "device 'input_boolean.y': owner 'dashboard' is not an agent" in found
    assert "duplicate device 'input_boolean.living_light'" in found


def test_caller_cannot_be_agent_and_operator(cfg_dir):
    edit(cfg_dir / "agents.yaml", lambda d: d["operators"].update(home={"token_env": "X"}))
    assert "'home' is listed as both an agent and an operator" in problems(cfg_dir)


def test_unknown_keys_rejected(cfg_dir):
    edit(cfg_dir / "agents.yaml", lambda d: d["agents"]["home"].update(token="plain"))
    assert "agents.home.token: Extra inputs are not permitted" in problems(cfg_dir)


def test_cors_origins():
    assert load_config(env=ENV).cors_origins == []
    env = {**ENV, "AMBIENT_CORS_ORIGINS": " http://localhost:5173, https://dash.example "}
    assert load_config(env=env).cors_origins == ["http://localhost:5173", "https://dash.example"]
    with pytest.raises(ConfigError, match="not an origin"):
        load_config(env={**ENV, "AMBIENT_CORS_ORIGINS": "http://localhost:5173/"})
    with pytest.raises(ConfigError, match="not an origin"):
        load_config(env={**ENV, "AMBIENT_CORS_ORIGINS": "*"})
