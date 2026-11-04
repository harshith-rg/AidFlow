"""Decides which 'now' is used to judge whether hospital data is stale.

    real mode (default): the actual current UTC time (contract behaviour).
    demo mode:           the dataset's meta.as_of time (labelled demo/test use).
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import Settings


@dataclass(frozen=True)
class ReferenceTime:
    """The chosen 'now', and which mode produced it."""

    value: datetime  # always timezone-aware UTC
    mode: str  # "real" or "demo"


def utc_now() -> datetime:
    """The actual current time in UTC."""
    return datetime.now(timezone.utc)


def _to_utc(value: datetime, label: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{label} must include a time zone (use UTC).")
    return value.astimezone(timezone.utc)


def get_reference_time(
    settings: Settings,
    dataset_as_of: datetime,
    now_fn: Callable[[], datetime] = utc_now,
) -> ReferenceTime:
    """Pick the reference time according to settings.time_mode.

    now_fn exists so tests can pass a fixed clock instead of the real one.
    """
    if settings.time_mode == "demo":
        return ReferenceTime(_to_utc(dataset_as_of, "dataset as_of"), "demo")
    if settings.time_mode == "real":
        return ReferenceTime(_to_utc(now_fn(), "the current time"), "real")
    raise ValueError(f"Unknown time mode: {settings.time_mode!r}")