"""Typed, cross-checked access to config/*.yaml and the tokens they name."""

from homeconfig.loader import ConfigError, HomeConfig, load_config

__all__ = ["ConfigError", "HomeConfig", "load_config"]
