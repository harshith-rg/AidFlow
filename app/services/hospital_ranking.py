"""Hospital ranking (CONTRACT.md section 8, step 3).

What this file does, in simple words:
  Puts the eligible hospitals in order, best first. It only SORTS. It does not
  filter, calculate distance, calculate ETA or write reason sentences.

The order (CONTRACT.md section 8):
  1. ETA, smallest first.
  2. Beds available, largest first.
  3. Hospital name, A to Z.

Rules the contract does not spell out. Each one is PENDING TEAM APPROVAL:

  P2 (pending): the ETA used for step 1 is the ROUNDED eta_min (1 decimal),
      the same number the API returns. Anyone can check the order from the
      response alone. Two hospitals that show the same ETA are then separated
      by beds and name, even if one is a few seconds slower. If the team
      prefers the unrounded ETA (EtaBasis.UNROUNDED), this is the only
      place that changes. Contract section 8 says "sort by eta_min", which
      is the rounded field, so ROUNDED is the literal reading.

  P1 (pending): stale-data hospitals (CONTRACT.md section 8, step 4: their
      bed counts are ignored). ETA still decides first, so a stale hospital
      with a clearly better ETA still ranks first. Only among hospitals with
      the SAME ETA, fresh-data hospitals come first (beds, then name), then
      stale-data hospitals (name only, because their beds are ignored).
      "Skip the bed step if either hospital is stale" is NOT used: it can
      give a circular order that depends on the input order.

  D3 (implementation detail, to be listed as P10): if ETA, beds and name all
      tie, hospital_id decides, so the same input always gives the same
      output (CONTRACT.md section 8, step 5).

  D4 (implementation detail): names are compared ignoring upper/lower case
      first, then exactly, so "alpha" and "Alpha" always sort the same way.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum
from numbers import Real

__all__ = [
    "DEFAULT_ETA_BASIS",
    "EtaBasis",
    "RankedHospital",
    "RankingCandidate",
    "rank_hospitals",
]


class EtaBasis(StrEnum):
    """Which ETA number step 1 of the ranking compares (proposal P2)."""

    ROUNDED = "rounded"  # eta_min as returned by the API (1 decimal)
    UNROUNDED = "unrounded"  # raw_eta_min before rounding


DEFAULT_ETA_BASIS = EtaBasis.ROUNDED


def _check_eta(value: object, name: str) -> float:
    """A finite number that is not negative (and not True/False)."""
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a number, but got {type(value).__name__}.")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name} must be a finite number of 0 or more, got {value!r}.")
    return number


@dataclass(frozen=True)
class RankingCandidate:
    """One eligible hospital with the numbers the ranking needs.

    Attributes:
        hospital_id: Unique ID such as "H07".
        name: Hospital name (used as the last visible tie-break).
        beds_available: Beds available (ignored when bed_data_stale is True).
        eta_min: ETA in minutes, rounded to 1 decimal (the contract value).
        bed_data_stale: True when the bed data is older than the threshold.
        raw_eta_min: ETA before rounding. Only needed for EtaBasis.UNROUNDED.
    """

    hospital_id: str
    name: str
    beds_available: int
    eta_min: float
    bed_data_stale: bool
    raw_eta_min: float | None = None

    def __post_init__(self) -> None:
        for field_name in ("hospital_id", "name"):
            value = getattr(self, field_name)
            if not isinstance(value, str):
                raise TypeError(
                    f"{field_name} must be text, but got {type(value).__name__}."
                )
            if not value.strip():
                raise ValueError(f"{field_name} must not be empty.")

        if isinstance(self.beds_available, bool) or not isinstance(
            self.beds_available, int
        ):
            raise TypeError(
                "beds_available must be a whole number, "
                f"but got {type(self.beds_available).__name__}."
            )
        if self.beds_available < 0:
            raise ValueError("beds_available must not be negative.")

        if not isinstance(self.bed_data_stale, bool):
            raise TypeError(
                "bed_data_stale must be True or False, "
                f"but got {type(self.bed_data_stale).__name__}."
            )

        object.__setattr__(self, "eta_min", _check_eta(self.eta_min, "eta_min"))
        if self.raw_eta_min is not None:
            object.__setattr__(
                self, "raw_eta_min", _check_eta(self.raw_eta_min, "raw_eta_min")
            )


@dataclass(frozen=True)
class RankedHospital:
    """A candidate with its place in the final order (1 = recommended)."""

    rank: int
    candidate: RankingCandidate

    @property
    def hospital_id(self) -> str:
        return self.candidate.hospital_id


def _eta_for_sorting(candidate: RankingCandidate, basis: EtaBasis) -> float:
    if basis is EtaBasis.ROUNDED:
        return candidate.eta_min
    assert candidate.raw_eta_min is not None  # checked in rank_hospitals
    return candidate.raw_eta_min


def _sort_key(candidate: RankingCandidate, basis: EtaBasis) -> tuple:
    """The full sort key. Smaller key = better rank.

    (ETA, freshness group, beds, name ignoring case, name exactly, hospital_id)

    The freshness group is 0 for fresh data and 1 for stale data. A stale
    hospital's beds are replaced by 0, so only its name (and then its ID)
    separates it from other stale hospitals. Because every key is a plain
    tuple of the same shape, the order is always consistent.
    """
    eta = _eta_for_sorting(candidate, basis)
    if candidate.bed_data_stale:
        group, beds_key = 1, 0
    else:
        group, beds_key = 0, -candidate.beds_available  # more beds sorts first
    return (
        eta,
        group,
        beds_key,
        candidate.name.casefold(),
        candidate.name,
        candidate.hospital_id,
    )


def rank_hospitals(
    candidates: Iterable[RankingCandidate],
    eta_basis: EtaBasis | str = DEFAULT_ETA_BASIS,
) -> tuple[RankedHospital, ...]:
    """Return the candidates in ranked order (rank 1 is the recommended one).

    The input is never changed. An empty input gives an empty result; turning
    that into a NO_ELIGIBLE_HOSPITAL error is the job of the caller.

    Raises:
        TypeError: an item is not a RankingCandidate.
        ValueError: eta_basis is unknown, two candidates share a hospital_id,
            or EtaBasis.UNROUNDED is used and a candidate has no raw_eta_min.
    """
    basis = EtaBasis(eta_basis)  # ValueError for an unknown name
    items = list(candidates)

    seen: set[str] = set()
    for item in items:
        if not isinstance(item, RankingCandidate):
            raise TypeError(
                f"Expected RankingCandidate objects, but got {type(item).__name__}."
            )
        if item.hospital_id in seen:
            raise ValueError(f"Duplicate hospital_id {item.hospital_id!r}.")
        seen.add(item.hospital_id)
        if basis is EtaBasis.UNROUNDED and item.raw_eta_min is None:
            raise ValueError(
                f"EtaBasis.UNROUNDED needs raw_eta_min, but {item.hospital_id!r} "
                "has none."
            )

    ordered = sorted(items, key=lambda c: _sort_key(c, basis))
    return tuple(
        RankedHospital(rank=position, candidate=candidate)
        for position, candidate in enumerate(ordered, start=1)
    )