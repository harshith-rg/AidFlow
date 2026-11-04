"""Hospital data shapes (CONTRACT.md section 7) and dataset metadata.

These models describe what a valid record looks like. They are read-only
("frozen") so nothing can accidentally change a hospital after loading.
"""

from datetime import datetime, timezone

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)


def parse_utc_timestamp(value: object) -> datetime:
    """Turn text like '2026-10-31T14:30:00Z' into a UTC datetime.

    Numbers and text without a time zone are rejected on purpose.
    """
    if not isinstance(value, str):
        raise ValueError(
            "must be a text timestamp such as 2026-10-31T14:30:00Z"
        )
    try:
        parsed = datetime.fromisoformat(value)  # Python 3.11 accepts the 'Z'
    except ValueError:
        raise ValueError(f"{value!r} is not a valid ISO 8601 timestamp") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(
            f"{value!r} has no time zone; use UTC such as 2026-10-31T14:30:00Z"
        )
    return parsed.astimezone(timezone.utc)


def require_number(value: object) -> float:
    """Accept real numbers only (not text, not True/False)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("must be a number")
    return float(value)


class FrozenModel(BaseModel):
    """Base class: read-only, and unknown extra fields are ignored."""

    model_config = ConfigDict(frozen=True, extra="ignore")


class Location(FrozenModel):
    """A point on the map. Hospital coordinates are approximate locality
    centres and are snapped to the road graph later (Phase 3)."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    @field_validator("lat", "lng", mode="before")
    @classmethod
    def _numbers_only(cls, value: object) -> float:
        return require_number(value)


class Hospital(FrozenModel):
    """One hospital record. All values are fictional DEMO data."""

    hospital_id: StrictStr = Field(min_length=1)
    name: StrictStr = Field(min_length=1)
    location: Location
    status: StrictStr
    specialties: tuple[StrictStr, ...]
    beds_total: StrictInt = Field(ge=0)
    beds_available: StrictInt = Field(ge=0)
    icu_beds_available: StrictInt = Field(ge=0)
    last_updated: datetime
    is_demo: StrictBool

    # Extra information in the demo file. Not part of the contract record.
    # "edge_case" is only a label for humans and tests: the filter NEVER reads it.
    locality: StrictStr | None = None
    zone: StrictStr | None = None
    edge_case: StrictStr | None = None

    @field_validator("last_updated", mode="before")
    @classmethod
    def _utc_timestamp(cls, value: object) -> datetime:
        return parse_utc_timestamp(value)


class BoundingBox(FrozenModel):
    """The rectangle the demo covers."""

    south: float = Field(ge=-90, le=90)
    north: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    east: float = Field(ge=-180, le=180)

    @field_validator("south", "north", "west", "east", mode="before")
    @classmethod
    def _numbers_only(cls, value: object) -> float:
        return require_number(value)

    @model_validator(mode="after")
    def _check_order(self) -> "BoundingBox":
        if self.south >= self.north:
            raise ValueError("south must be smaller than north")
        if self.west >= self.east:
            raise ValueError("west must be smaller than east")
        return self


class DatasetMeta(FrozenModel):
    """The 'meta' section of hospitals_demo.json."""

    dataset: StrictStr
    is_demo: StrictBool
    warning: StrictStr
    as_of: datetime
    stale_after_minutes: float = Field(ge=0)  # informational; Settings wins
    coverage_bbox: BoundingBox
    needs_vocabulary: tuple[StrictStr, ...] = Field(min_length=1)
    status_values: tuple[StrictStr, ...] = Field(min_length=1)

    @field_validator("as_of", mode="before")
    @classmethod
    def _utc_timestamp(cls, value: object) -> datetime:
        return parse_utc_timestamp(value)

    @field_validator("stale_after_minutes", mode="before")
    @classmethod
    def _number_only(cls, value: object) -> float:
        return require_number(value)