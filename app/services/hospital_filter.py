"""Hospital eligibility filtering (CONTRACT.md section 8, steps 1 and 4).

For each hospital, in this order:
  1. status must be OPEN.
  2. it must support EVERY requested need (empty needs = no specialty limit).
  3. if ICU is requested AND the bed data is fresh, icu_beds_available > 0.
     (Stale bed data is not used for this check.)
A stale hospital that passes the rules stays eligible, flagged bed_data_stale.

This file does NOT calculate distance, ETA or ranking, and it never reads
the dataset's 'edge_case' label.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.models.hospital import Hospital

OPEN_STATUS = "OPEN"
ICU_NEED = "ICU"


class RejectionReason(StrEnum):
    NOT_OPEN = "NOT_OPEN"
    MISSING_SPECIALTY = "MISSING_SPECIALTY"
    NO_ICU_BEDS = "NO_ICU_BEDS"


@dataclass(frozen=True)
class EligibleHospital:
    hospital: Hospital
    bed_data_stale: bool


@dataclass(frozen=True)
class RejectedHospital:
    hospital: Hospital
    reason: RejectionReason
    missing_needs: tuple[str, ...] = ()


@dataclass(frozen=True)
class FilterResult:
    reference_time: datetime
    eligible: tuple[EligibleHospital, ...]
    rejected: tuple[RejectedHospital, ...]

    @property
    def eligible_ids(self) -> tuple[str, ...]:
        return tuple(item.hospital.hospital_id for item in self.eligible)

    @property
    def rejection_reasons(self) -> dict[str, RejectionReason]:
        return {item.hospital.hospital_id: item.reason for item in self.rejected}


def is_bed_data_stale(
    last_updated: datetime, reference_time: datetime, stale_after_minutes: float
) -> bool:
    """True only if the record is OLDER than the threshold.

    Exactly at the threshold is still fresh. A record dated in the future
    has a negative age, so it counts as fresh.
    (Both readings are listed for team confirmation.)
    """
    return reference_time - last_updated > timedelta(minutes=stale_after_minutes)


def filter_hospitals(
    hospitals: Iterable[Hospital],
    needs: Iterable[str],
    reference_time: datetime,
    stale_after_minutes: float,
) -> FilterResult:
    """Split hospitals into eligible and rejected (input order is kept)."""
    if isinstance(needs, str):
        raise TypeError("needs must be a list of strings, not one string.")
    if reference_time.tzinfo is None or reference_time.utcoffset() is None:
        raise ValueError("reference_time must include a time zone (use UTC).")
    if stale_after_minutes < 0:
        raise ValueError("stale_after_minutes must not be negative.")

    required = frozenset(needs)
    eligible: list[EligibleHospital] = []
    rejected: list[RejectedHospital] = []

    for hospital in hospitals:
        # Rule 1: status
        if hospital.status != OPEN_STATUS:
            rejected.append(RejectedHospital(hospital, RejectionReason.NOT_OPEN))
            continue

        # Rule 2: every need must be supported
        missing = tuple(sorted(required.difference(hospital.specialties)))
        if missing:
            rejected.append(
                RejectedHospital(hospital, RejectionReason.MISSING_SPECIALTY, missing)
            )
            continue

        # Rule 3: ICU beds, only when ICU is requested and the data is fresh
        stale = is_bed_data_stale(
            hospital.last_updated, reference_time, stale_after_minutes
        )
        if ICU_NEED in required and not stale and hospital.icu_beds_available <= 0:
            rejected.append(RejectedHospital(hospital, RejectionReason.NO_ICU_BEDS))
            continue

        eligible.append(EligibleHospital(hospital, stale))

    return FilterResult(reference_time, tuple(eligible), tuple(rejected))