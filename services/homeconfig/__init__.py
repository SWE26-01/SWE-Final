"""Typed, cross-checked access to config/*.yaml (WBS W0-3)."""

from homeconfig.loader import ConfigError, HomeConfig, load_config

__all__ = ["ConfigError", "HomeConfig", "load_config"]
