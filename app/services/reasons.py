"""Reason sentences for the recommended hospital and the alternatives.

What this file does, in simple words:
  Writes the short, human-readable "reason" text that CONTRACT.md section 5
  shows next to each hospital. It only builds TEXT. It does not filter,
  calculate distance or ETA, or decide the order.

Wording (taken from the CONTRACT.md section 5 sample):
    recommended : "Nearest open hospital with ICU (9.0 min ETA)."
    alternative : "Open with ICU, 4.0 min slower than recommended."

Wording for cases the sample does not show (display text only):
    several needs   : "with ICU and TRAUMA", "with ICU, TRAUMA and CARDIAC"
    no needs        : "Nearest open hospital (9.0 min ETA)."
                      "Open hospital, 4.0 min slower than recommended."
    same ETA        : "Open with ICU, same ETA as recommended."

Rules applied here:
  * Needs are shown in the order the request gave them, duplicates removed.
  * ETAs are the ROUNDED eta_min values the API returns (1 decimal).
  * "N min slower" is the difference between the two DISPLAYED ETAs, so the
    numbers on screen always add up (13.0 - 9.0 = 4.0).
  * Stale bed data is NOT mentioned here. The bed_data_stale field and the
    STALE_HOSPITAL_DATA warning already carry that information.
"""

import math
from collections.abc import Iterable, Sequence
from decimal import ROUND_HALF_UP, Decimal
from numbers import Real

from app.services.distance_eta import ETA_DECIMALS
from app.services.hospital_ranking import RankedHospital

__all__ = [
    "build_alternative_reason",
    "build_reasons",
    "build_recommended_reason",
]

_ETA_QUANTUM = Decimal(1).scaleb(-ETA_DECIMALS)  # Decimal('0.1')


def _clean_needs(needs: object) -> tuple[str, ...]:
    """The needs as a tuple of unique, non-empty text items (request order)."""
    if isinstance(needs, str):
        raise TypeError("needs must be a list of strings, not one string.")
    if not isinstance(needs, Iterable):
        raise TypeError(f"needs must be a list of strings, got {type(needs).__name__}.")

    cleaned: list[str] = []
    for item in needs:
        if not isinstance(item, str):
            raise TypeError(
                f"Every need must be text, but got {type(item).__name__}."
            )
        if not item.strip():
            raise ValueError("A need must not be empty.")
        if item not in cleaned:
            cleaned.append(item)
    return tuple(cleaned)


def _join_needs(needs: tuple[str, ...]) -> str:
    """'ICU', 'ICU and TRAUMA' or 'ICU, TRAUMA and CARDIAC'."""
    if len(needs) == 1:
        return needs[0]
    return ", ".join(needs[:-1]) + " and " + needs[-1]


def _minutes(value: object, name: str) -> Decimal:
    """A finite ETA of 0 or more, as a Decimal rounded half up to 1 decimal."""
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a number, but got {type(value).__name__}.")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name} must be a finite number of 0 or more, got {value!r}.")
    return Decimal(repr(number)).quantize(_ETA_QUANTUM, rounding=ROUND_HALF_UP)


def build_recommended_reason(needs: Iterable[str], eta_min: float) -> str:
    """Reason for the recommended (rank 1) hospital.

    Example: build_recommended_reason(["ICU"], 9.0)
             -> "Nearest open hospital with ICU (9.0 min ETA)."
    """
    needs_tuple = _clean_needs(needs)
    eta = _minutes(eta_min, "eta_min")
    with_clause = f" with {_join_needs(needs_tuple)}" if needs_tuple else ""
    return f"Nearest open hospital{with_clause} ({eta} min ETA)."


def build_alternative_reason(
    needs: Iterable[str], eta_min: float, recommended_eta_min: float
) -> str:
    """Reason for an alternative hospital.

    Example: build_alternative_reason(["ICU"], 13.0, 9.0)
             -> "Open with ICU, 4.0 min slower than recommended."

    Raises:
        ValueError: the alternative is faster than the recommended hospital
            (the ranking never produces this, so it signals a mistake).
    """
    needs_tuple = _clean_needs(needs)
    eta = _minutes(eta_min, "eta_min")
    recommended_eta = _minutes(recommended_eta_min, "recommended_eta_min")

    difference = eta - recommended_eta  # exact: both are 1-decimal Decimals
    if difference < 0:
        raise ValueError(
            f"The alternative ({eta} min) is faster than the recommended "
            f"hospital ({recommended_eta} min)."
        )

    lead = f"Open with {_join_needs(needs_tuple)}" if needs_tuple else "Open hospital"
    if difference == 0:
        return f"{lead}, same ETA as recommended."
    return f"{lead}, {difference} min slower than recommended."


def build_reasons(
    needs: Iterable[str], ranked: Sequence[RankedHospital]
) -> tuple[str, ...]:
    """One reason per ranked hospital, in the same order as `ranked`.

    The first hospital is the recommended one; the others are alternatives.
    An empty ranking gives an empty result.
    """
    needs_tuple = _clean_needs(needs)
    items = list(ranked)
    for item in items:
        if not isinstance(item, RankedHospital):
            raise TypeError(
                f"Expected RankedHospital objects, but got {type(item).__name__}."
            )
    if not items:
        return ()

    recommended_eta = items[0].candidate.eta_min
    reasons = [build_recommended_reason(needs_tuple, recommended_eta)]
    for item in items[1:]:
        reasons.append(
            build_alternative_reason(needs_tuple, item.candidate.eta_min, recommended_eta)
        )
    return tuple(reasons)