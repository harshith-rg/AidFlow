"""Phase 4 scenario tests: demo hospitals through the whole Phase 4 pipeline.

Pipeline (no road graph and no API yet, that is Phase 5):

    demo hospitals -> filter -> distance/ETA -> ranking -> reason sentences

Everything is fixed, so the expected results can be checked by hand:
  * Distances come from a fixed table (metres, as RouteResult.total_distance_m
    would give them). At the contract speed of 30 km/h, ETA minutes are simply
    metres / 500 (4,500 m = 9.0 min).
  * The clock is fixed: the "demo" clock uses the dataset's own as_of time
    (2026-10-31T14:30Z), or a fixed fake "now" in the real-clock scenario.

Rules pinned here that are PENDING TEAM APPROVAL (change these tests if the
team decides differently):
  P1: at equal ETA, fresh-data hospitals rank before stale-data hospitals.
  P2: ranking uses the rounded eta_min.
"""

import random
from datetime import datetime, timezone
from typing import NamedTuple

import pytest

from app.core.config import Settings
from app.data.hospital_repository import load_repository
from app.services.clock import get_reference_time
from app.services.distance_eta import calculate_distance_eta
from app.services.hospital_filter import RejectionReason, filter_hospitals
from app.services.hospital_ranking import RankingCandidate, rank_hospitals
from app.services.reasons import build_reasons

DEMO_SETTINGS = Settings(time_mode="demo")  # clock = dataset as_of time
FIXED_NOW = datetime(2026, 11, 8, 7, 0, tzinfo=timezone.utc)  # 8 days after as_of

# Fixed road distances in METRES from one imaginary pickup point.
# H37 is left out on purpose: it lies outside the coverage area.
ALL_DISTANCES_M = {
    "H01": 4500, "H02": 6500, "H03": 8000, "H04": 7000, "H05": 9500,
    "H06": 6000, "H07": 3500, "H08": 3500, "H09": 8500, "H10": 10000,
    "H11": 2000, "H12": 9000, "H13": 11000, "H14": 2500, "H15": 12000,
    "H16": 20000, "H17": 7500, "H18": 17500, "H19": 15000, "H20": 12500,
    "H21": 16000, "H22": 11500, "H23": 3500, "H24": 9000, "H25": 8000,
    "H26": 15000, "H27": 13000, "H28": 14000, "H29": 5500, "H30": 19000,
    "H31": 14500, "H32": 9500, "H33": 3000, "H34": 13500, "H35": 22000,
    "H36": 6000,
}


class Row(NamedTuple):
    """One line of the final result, as the API will show it."""

    hospital_id: str
    distance_km: float
    eta_min: float
    bed_data_stale: bool
    reason: str


class Outcome(NamedTuple):
    rows: tuple[Row, ...]  # ranked, best first
    rejected: dict  # hospital_id -> RejectionReason


def run_pipeline(needs, candidate_ids, distances_m, *, settings=DEMO_SETTINGS, now_fn=None):
    """Filter -> distance/ETA -> rank -> reasons, using only fixed inputs."""
    repo = load_repository()
    hospitals = [repo.get(hospital_id) for hospital_id in candidate_ids]
    assert all(h is not None for h in hospitals), "unknown hospital id in the scenario"

    clock_args = {} if now_fn is None else {"now_fn": now_fn}
    reference = get_reference_time(settings, repo.meta.as_of, **clock_args)
    filtered = filter_hospitals(
        hospitals, needs, reference.value, settings.stale_after_minutes
    )

    calculated = {}
    candidates = []
    for item in filtered.eligible:
        hospital_id = item.hospital.hospital_id
        result = calculate_distance_eta(
            distances_m[hospital_id], settings.average_speed_kmh
        )
        calculated[hospital_id] = result
        candidates.append(
            RankingCandidate(
                hospital_id=hospital_id,
                name=item.hospital.name,
                beds_available=item.hospital.beds_available,
                eta_min=result.eta_min,
                bed_data_stale=item.bed_data_stale,
                raw_eta_min=result.raw_eta_min,
            )
        )

    ranked = rank_hospitals(candidates)
    reasons = build_reasons(needs, ranked)
    rows = tuple(
        Row(
            hospital_id=r.hospital_id,
            distance_km=calculated[r.hospital_id].distance_km,
            eta_min=r.candidate.eta_min,
            bed_data_stale=r.candidate.bed_data_stale,
            reason=reason,
        )
        for r, reason in zip(ranked, reasons, strict=True)
    )
    return Outcome(rows, filtered.rejection_reasons)


def ids(outcome):
    return [row.hospital_id for row in outcome.rows]


# ---------------------------------------------------------------------------
# The fixed table itself
# ---------------------------------------------------------------------------
def test_distance_table_covers_h01_to_h36_exactly():
    assert set(ALL_DISTANCES_M) == {f"H{n:02d}" for n in range(1, 37)}


# ---------------------------------------------------------------------------
# Scenario 1: the contract sample (4.5 km = 9.0 min, 6.5 km = 13.0 min)
# ---------------------------------------------------------------------------
def test_scenario_contract_sample():
    outcome = run_pipeline(
        ["ICU"],
        ["H02", "H01", "H03"],
        {"H01": 4500, "H02": 6500, "H03": 5000},
    )
    assert outcome.rows == (
        Row("H01", 4.5, 9.0, False, "Nearest open hospital with ICU (9.0 min ETA)."),
        Row("H03", 5.0, 10.0, False, "Open with ICU, 1.0 min slower than recommended."),
        Row("H02", 6.5, 13.0, False, "Open with ICU, 4.0 min slower than recommended."),
    )
    assert outcome.rejected == {}


# ---------------------------------------------------------------------------
# Scenario 2: the nearest hospitals are not eligible, so they are never chosen
# ---------------------------------------------------------------------------
def test_scenario_nearest_hospitals_rejected_for_icu():
    candidates = ["H11", "H14", "H33", "H06", "H17", "H12", "H15"]
    outcome = run_pipeline(["ICU"], candidates, ALL_DISTANCES_M)

    # Closest by road: H11 (4.0 min), H14 (5.0), H33 (6.0), H06 (12.0), H17 (15.0).
    # All five are rejected, so the 18.0 and 24.0 minute hospitals are left.
    assert outcome.rejected == {
        "H11": RejectionReason.NOT_OPEN,  # CLOSED
        "H14": RejectionReason.NOT_OPEN,  # DIVERTED
        "H33": RejectionReason.MISSING_SPECIALTY,  # no ICU
        "H06": RejectionReason.MISSING_SPECIALTY,  # no ICU
        "H17": RejectionReason.NO_ICU_BEDS,  # ICU capable, 0 ICU beds, fresh data
    }
    assert outcome.rows == (
        Row("H12", 9.0, 18.0, False, "Nearest open hospital with ICU (18.0 min ETA)."),
        Row("H15", 12.0, 24.0, False, "Open with ICU, 6.0 min slower than recommended."),
    )


# ---------------------------------------------------------------------------
# Scenario 3: no needs means any open hospital, including one without ICU
# ---------------------------------------------------------------------------
def test_scenario_no_needs_accepts_any_open_hospital():
    outcome = run_pipeline([], ["H01", "H06", "H33"], ALL_DISTANCES_M)
    assert outcome.rejected == {}
    assert outcome.rows == (
        Row("H33", 3.0, 6.0, False, "Nearest open hospital (6.0 min ETA)."),
        Row("H01", 4.5, 9.0, False, "Open hospital, 3.0 min slower than recommended."),
        Row("H06", 6.0, 12.0, False, "Open hospital, 6.0 min slower than recommended."),
    )


# ---------------------------------------------------------------------------
# Scenario 4: H07 and H08 share a location, so they tie on ETA (beds decide)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "candidate_ids", [["H08", "H07", "H04"], ["H04", "H07", "H08"], ["H07", "H04", "H08"]]
)
def test_scenario_tie_break_pair_h07_h08(candidate_ids):
    outcome = run_pipeline(["ICU"], candidate_ids, ALL_DISTANCES_M)
    assert outcome.rows == (
        Row("H07", 3.5, 7.0, False, "Nearest open hospital with ICU (7.0 min ETA)."),
        Row("H08", 3.5, 7.0, False, "Open with ICU, same ETA as recommended."),
        Row("H04", 7.0, 14.0, False, "Open with ICU, 7.0 min slower than recommended."),
    )


# ---------------------------------------------------------------------------
# Scenario 5: stale data (H23), demo clock. P1 pending approval.
# ---------------------------------------------------------------------------
def test_scenario_stale_hospital_ranks_after_fresh_one_at_equal_eta():
    """H23 (stale) has MORE beds than H10 (19 vs 17), but stale beds are
    ignored, so at equal ETA the fresh hospital comes first."""
    outcome = run_pipeline(
        ["ICU"],
        ["H23", "H10", "H25"],
        {"H25": 3000, "H10": 4000, "H23": 4000},
    )
    assert outcome.rows == (
        Row("H25", 3.0, 6.0, False, "Nearest open hospital with ICU (6.0 min ETA)."),
        Row("H10", 4.0, 8.0, False, "Open with ICU, 2.0 min slower than recommended."),
        Row("H23", 4.0, 8.0, True, "Open with ICU, 2.0 min slower than recommended."),
    )


def test_scenario_faster_stale_hospital_is_still_recommended():
    """ETA is checked first, so staleness never demotes a closer hospital.
    The reason text does not mention stale data (the flag carries that)."""
    outcome = run_pipeline(
        ["ICU"], ["H25", "H23"], {"H23": 2500, "H25": 3000}
    )
    assert outcome.rows == (
        Row("H23", 2.5, 5.0, True, "Nearest open hospital with ICU (5.0 min ETA)."),
        Row("H25", 3.0, 6.0, False, "Open with ICU, 1.0 min slower than recommended."),
    )


# ---------------------------------------------------------------------------
# Scenario 6: the real clock, 8 days after the dataset, makes everything stale
# ---------------------------------------------------------------------------
def test_scenario_real_clock_makes_every_hospital_stale():
    """With the default 'real' clock and this old demo data, every hospital is
    stale, so the ICU-bed rule is skipped and H17 (0 ICU beds) stays eligible.
    This is contract behaviour (section 8, step 4) and the reason the demo
    needs AIDFLOW_TIME_MODE=demo (a Phase 5 decision)."""
    outcome = run_pipeline(
        ["ICU"],
        ["H17", "H12", "H15"],
        ALL_DISTANCES_M,
        settings=Settings(time_mode="real"),
        now_fn=lambda: FIXED_NOW,
    )
    assert outcome.rejected == {}
    assert outcome.rows == (
        Row("H17", 7.5, 15.0, True, "Nearest open hospital with ICU (15.0 min ETA)."),
        Row("H12", 9.0, 18.0, True, "Open with ICU, 3.0 min slower than recommended."),
        Row("H15", 12.0, 24.0, True, "Open with ICU, 9.0 min slower than recommended."),
    )


def test_scenario_same_hospitals_with_demo_clock_reject_h17():
    outcome = run_pipeline(["ICU"], ["H17", "H12", "H15"], ALL_DISTANCES_M)
    assert outcome.rejected == {"H17": RejectionReason.NO_ICU_BEDS}
    assert ids(outcome) == ["H12", "H15"]
    assert not any(row.bed_data_stale for row in outcome.rows)


# ---------------------------------------------------------------------------
# Scenario 7: the whole dataset (H01 to H36), no needs
# ---------------------------------------------------------------------------
ALL_IDS = [f"H{n:02d}" for n in range(1, 37)]


def test_scenario_whole_dataset_no_needs():
    repo = load_repository()
    outcome = run_pipeline([], ALL_IDS, ALL_DISTANCES_M)

    # H11 is CLOSED and H14 is DIVERTED. Every other hospital is open.
    assert outcome.rejected == {
        "H11": RejectionReason.NOT_OPEN,
        "H14": RejectionReason.NOT_OPEN,
    }
    assert len(outcome.rows) == 34

    # Worked by hand (ETA = metres / 500):
    #   6.0 H33 | 7.0 H07, H08, H23 | 9.0 H01 | 11.0 H29 | 12.0 H36, H06
    # H07 (25 beds) before H08 (11 beds); stale H23 comes last of the 7.0 group
    # although it has more beds than H08; H36 (15 beds) before H06 (12 beds).
    assert ids(outcome)[:8] == [
        "H33", "H07", "H08", "H23", "H01", "H29", "H36", "H06",
    ]
    assert ids(outcome)[-1] == "H35"  # 22 km = 44.0 min, the farthest

    assert outcome.rows[0] == Row(
        "H33", 3.0, 6.0, False, "Nearest open hospital (6.0 min ETA)."
    )
    assert outcome.rows[3] == Row(
        "H23", 3.5, 7.0, True, "Open hospital, 1.0 min slower than recommended."
    )
    assert [r.hospital_id for r in outcome.rows if r.bed_data_stale] == ["H23"]

    # Property check for the whole list: every neighbouring pair obeys the
    # contract order (ETA, then fresh before stale, then beds, then name).
    for first, second in zip(outcome.rows, outcome.rows[1:]):
        assert first.eta_min <= second.eta_min
        if first.eta_min == second.eta_min:
            assert (not first.bed_data_stale) or second.bed_data_stale
            if not first.bed_data_stale and not second.bed_data_stale:
                a, b = repo.get(first.hospital_id), repo.get(second.hospital_id)
                assert a.beds_available >= b.beds_available
                if a.beds_available == b.beds_available:
                    assert a.name.casefold() <= b.name.casefold()


def test_scenario_whole_dataset_result_never_depends_on_input_order():
    expected = run_pipeline([], ALL_IDS, ALL_DISTANCES_M)
    generator = random.Random(2026)  # fixed seed: the same 25 shuffles every run
    for _ in range(25):
        shuffled = ALL_IDS[:]
        generator.shuffle(shuffled)
        assert run_pipeline([], shuffled, ALL_DISTANCES_M) == expected


# ---------------------------------------------------------------------------
# Scenario 8: nobody is eligible
# ---------------------------------------------------------------------------
def test_scenario_no_eligible_hospital_gives_empty_result():
    """Phase 5 will turn this empty result into NO_ELIGIBLE_HOSPITAL."""
    outcome = run_pipeline(["TRAUMA"], ["H06", "H33", "H11", "H14"], ALL_DISTANCES_M)
    assert outcome.rows == ()
    assert outcome.rejected == {
        "H06": RejectionReason.MISSING_SPECIALTY,
        "H33": RejectionReason.MISSING_SPECIALTY,
        "H11": RejectionReason.NOT_OPEN,
        "H14": RejectionReason.NOT_OPEN,
    }


# ---------------------------------------------------------------------------
# Scenario 9: a different speed setting (40 km/h)
# ---------------------------------------------------------------------------
def test_scenario_speed_setting_changes_etas_and_the_shown_gaps():
    """At 40 km/h: 4.5 km = 6.75 min (shown 6.8), 5.0 km = 7.5, 6.5 km = 9.75
    (shown 9.8). The gaps use the SHOWN numbers: 7.5 - 6.8 = 0.7 (not 0.75)."""
    outcome = run_pipeline(
        ["ICU"],
        ["H02", "H01", "H03"],
        {"H01": 4500, "H02": 6500, "H03": 5000},
        settings=Settings(time_mode="demo", average_speed_kmh=40.0),
    )
    assert outcome.rows == (
        Row("H01", 4.5, 6.8, False, "Nearest open hospital with ICU (6.8 min ETA)."),
        Row("H03", 5.0, 7.5, False, "Open with ICU, 0.7 min slower than recommended."),
        Row("H02", 6.5, 9.8, False, "Open with ICU, 3.0 min slower than recommended."),
    )