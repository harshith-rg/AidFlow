"""Service settings, read from environment variables.

Defaults come from CONTRACT.md (speed 30 km/h, stale after 60 minutes).
A wrong setting raises ConfigError, so the service refuses to start
instead of silently running with nonsense.
"""

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass

VALID_TIME_MODES = ("real", "demo")
TRUE_WORDS = ("true", "1", "yes", "on")
FALSE_WORDS = ("false", "0", "no", "off")


class ConfigError(ValueError):
    """Raised when a setting has an invalid value."""


@dataclass(frozen=True)
class Settings:
    """All settings in one read-only object."""

    # "real" = actual UTC clock (contract behaviour).
    # "demo" = dataset as_of time, for labelled demo/test use only.
    time_mode: str = "real"
    average_speed_kmh: float = 30.0  # CONTRACT.md section 9
    stale_after_minutes: float = 60.0  # CONTRACT.md section 8
    # Switch for the PROPOSED GET /hospitals endpoints (not built yet).
    enable_demo_endpoints: bool = False


def _read_float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number, but got {raw!r}.") from None
    if not math.isfinite(value):
        raise ConfigError(f"{name} must be a finite number, but got {raw!r}.")
    return value


def _read_bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    word = raw.strip().lower()
    if word in TRUE_WORDS:
        return True
    if word in FALSE_WORDS:
        return False
    raise ConfigError(
        f"{name} must be true or false (also 1/0, yes/no, on/off), but got {raw!r}."
    )


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Build Settings from environment variables (or from a dict in tests)."""
    if env is None:
        env = os.environ

    time_mode = env.get("AIDFLOW_TIME_MODE", "real").strip().lower()
    if time_mode not in VALID_TIME_MODES:
        raise ConfigError(
            f"AIDFLOW_TIME_MODE must be one of {VALID_TIME_MODES}, "
            f"but got {env.get('AIDFLOW_TIME_MODE')!r}."
        )

    speed = _read_float(env, "AIDFLOW_AVERAGE_SPEED_KMH", 30.0)
    if speed <= 0:
        raise ConfigError("AIDFLOW_AVERAGE_SPEED_KMH must be greater than 0.")

    stale = _read_float(env, "AIDFLOW_STALE_AFTER_MINUTES", 60.0)
    if stale < 0:
        raise ConfigError("AIDFLOW_STALE_AFTER_MINUTES must not be negative.")

    demo_endpoints = _read_bool(env, "AIDFLOW_ENABLE_DEMO_ENDPOINTS", False)

    return Settings(
        time_mode=time_mode,
        average_speed_kmh=speed,
        stale_after_minutes=stale,
        enable_demo_endpoints=demo_endpoints,
    )