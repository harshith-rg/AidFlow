"""Tests for hospital filtering: status, specialties, ICU beds, staleness.

All hospitals come from hospitals_demo.json (via the `repo` fixture).
To test time boundaries we move the reference time, not the data.
"""

from datetime import datetime, timezone

import pytest

from app.services.hospital_filter import (
    FilterResult,
    RejectionReason,
    filter_hospitals,
    is_bed_data_stale,
)

UTC = timezone.utc
AS_OF = datetime(2026, 10, 31, 14, 30, tzinfo=UTC)  # the dataset's meta.as_of
LATER = datetime(2026, 11, 2, 10, 0, tzinfo=UTC)  # a "real" time long after the data


def run(repo, ids, needs, now=AS_OF, stale_after=60) -> FilterResult:
    return filter_hospitals([repo.get(i) for i in ids], needs, now, stale_after)


# ---------------- status ----------------
@pytest.mark.parametrize("hospital_id", ["H11", "H14"])  # CLOSED, DIVERTED
@pytest.mark.parametrize("needs", [[], ["ICU"], ["TRAUMA", "ICU"]])
def test_closed_and_diverted_are_never_eligible(repo, hospital_id, needs):
    result = run(repo, [hospital_id], needs)
    assert result.eligible == ()
    assert result.rejection_reasons == {hospital_id: RejectionReason.NOT_OPEN}


def test_open_hospital_is_eligible(repo):
    result = run(repo, ["H01"], [])
    assert result.eligible_ids == ("H01",)
    assert result.rejected == ()


# ---------------- specialties ----------------
def test_single_need_supported(repo):
    assert run(repo, ["H01"], ["TRAUMA"]).eligible_ids == ("H01",)


def test_single_need_not_supported(repo):
    result = run(repo, ["H03"], ["TRAUMA"])  # H03 has no TRAUMA
    assert result.rejection_reasons == {"H03": RejectionReason.MISSING_SPECIALTY}
    assert result.rejected[0].missing_needs == ("TRAUMA",)


def test_all_needs_must_be_supported(repo):
    assert run(repo, ["H01"], ["ICU", "TRAUMA"]).eligible_ids == ("H01",)
    result = run(repo, ["H02"], ["TRAUMA", "CARDIAC"])  # H02 lacks CARDIAC
    assert result.rejected[0].missing_needs == ("CARDIAC",)


def test_missing_needs_are_listed_alphabetically(repo):
    result = run(repo, ["H06"], ["TRAUMA", "ICU"])
    assert result.rejected[0].missing_needs == ("ICU", "TRAUMA")


@pytest.mark.parametrize("hospital_id", ["H06", "H17", "H33"])
def test_empty_needs_does_not_exclude_open_hospitals(repo, hospital_id):
    assert run(repo, [hospital_id], []).eligible_ids == (hospital_id,)


def test_duplicate_needs_make_no_difference(repo):
    assert run(repo, ["H01", "H03"], ["ICU", "ICU"]) == run(repo, ["H01", "H03"], ["ICU"])


def test_unknown_need_matches_no_hospital(repo):
    result = run(repo, ["H01", "H02"], ["DENTAL"])
    assert result.eligible == ()
    assert set(result.rejection_reasons.values()) == {RejectionReason.MISSING_SPECIALTY}


def test_needs_given_as_one_string_is_a_programming_error(repo):
    with pytest.raises(TypeError):
        run(repo, ["H01"], "ICU")


def test_edge_case_label_is_never_used(repo):
    # A copy of H01 wrongly labelled "CLOSED" is still eligible,
    # and a copy of H11 with no label is still rejected.
    labelled = repo.get("H01").model_copy(update={"edge_case": "CLOSED"})
    unlabelled = repo.get("H11").model_copy(update={"edge_case": None})
    result = filter_hospitals([labelled, unlabelled], [], AS_OF, 60)
    assert result.eligible_ids == ("H01",)
    assert result.rejection_reasons == {"H11": RejectionReason.NOT_OPEN}


# ---------------- ICU beds (fresh data) ----------------
def test_icu_with_beds_is_eligible(repo):
    result = run(repo, ["H01"], ["ICU"])
    assert result.eligible_ids == ("H01",)
    assert result.eligible[0].bed_data_stale is False


def test_icu_capable_but_zero_icu_beds_is_rejected(repo):
    result = run(repo, ["H17"], ["ICU"])
    assert result.rejection_reasons == {"H17": RejectionReason.NO_ICU_BEDS}


def test_icu_with_other_needs_still_checks_beds(repo):
    result = run(repo, ["H17"], ["ICU", "CARDIAC"])
    assert result.rejection_reasons == {"H17": RejectionReason.NO_ICU_BEDS}


@pytest.mark.parametrize("needs", [[], ["CARDIAC"], ["GENERAL"]])
def test_icu_bed_rule_applies_only_when_icu_is_requested(repo, needs):
    assert run(repo, ["H17"], needs).eligible_ids == ("H17",)


def test_no_icu_capability_is_a_specialty_rejection(repo):
    result = run(repo, ["H06"], ["ICU"])
    assert result.rejection_reasons == {"H06": RejectionReason.MISSING_SPECIALTY}


# ---------------- stale data ----------------
def test_stale_hospital_stays_eligible_and_is_flagged(repo):
    result = run(repo, ["H23"], ["ICU"])  # H23 last updated 08:45
    assert result.eligible_ids == ("H23",)
    assert result.eligible[0].bed_data_stale is True


def test_fresh_hospital_is_not_flagged(repo):
    assert run(repo, ["H01"], []).eligible[0].bed_data_stale is False


def test_stale_boundary_exactly_60_minutes_is_fresh(repo):
    # H17 last_updated is 14:14:00, so 15:14:00 is exactly 60 minutes later.
    now = datetime(2026, 10, 31, 15, 14, 0, tzinfo=UTC)
    result = run(repo, ["H17"], ["ICU"], now=now)
    assert result.rejection_reasons == {"H17": RejectionReason.NO_ICU_BEDS}


def test_stale_boundary_one_second_over_is_stale(repo):
    now = datetime(2026, 10, 31, 15, 14, 1, tzinfo=UTC)
    result = run(repo, ["H17"], ["ICU"], now=now)
    # Stale: the ICU-bed filter is skipped, so H17 becomes eligible.
    assert result.eligible_ids == ("H17",)
    assert result.eligible[0].bed_data_stale is True


def test_stale_does_not_waive_status(repo):
    result = run(repo, ["H11"], [], now=LATER)
    assert result.rejection_reasons == {"H11": RejectionReason.NOT_OPEN}


def test_stale_does_not_waive_specialty(repo):
    result = run(repo, ["H06"], ["ICU"], now=LATER)
    assert result.rejection_reasons == {"H06": RejectionReason.MISSING_SPECIALTY}


def test_threshold_is_configurable(repo):
    # H01 was updated at 14:20, so it is 10 minutes old at 14:30.
    assert run(repo, ["H01"], [], stale_after=5).eligible[0].bed_data_stale is True
    assert run(repo, ["H01"], [], stale_after=10).eligible[0].bed_data_stale is False


def test_is_bed_data_stale_rules():
    updated = datetime(2026, 10, 31, 14, 0, tzinfo=UTC)
    exactly = datetime(2026, 10, 31, 15, 0, tzinfo=UTC)
    one_second_over = datetime(2026, 10, 31, 15, 0, 1, tzinfo=UTC)
    before_update = datetime(2026, 10, 31, 13, 0, tzinfo=UTC)
    assert is_bed_data_stale(updated, exactly, 60) is False
    assert is_bed_data_stale(updated, one_second_over, 60) is True
    assert is_bed_data_stale(updated, before_update, 60) is False  # future = fresh
    assert is_bed_data_stale(updated, updated, 0) is False
    assert is_bed_data_stale(updated, one_second_over, 0) is True


def test_negative_threshold_is_rejected(repo):
    with pytest.raises(ValueError):
        run(repo, ["H01"], [], stale_after=-1)


def test_reference_time_without_time_zone_is_rejected(repo):
    with pytest.raises(ValueError):
        run(repo, ["H01"], [], now=datetime(2026, 10, 31, 14, 30))


# ---------------- whole dataset, demo time (as_of) ----------------
def test_whole_dataset_with_no_needs(repo):
    result = filter_hospitals(repo.all(), [], AS_OF, 60)
    all_ids = {h.hospital_id for h in repo.all()}
    assert set(result.eligible_ids) == all_ids - {"H11", "H14"}
    assert [e.hospital.hospital_id for e in result.eligible if e.bed_data_stale] == ["H23"]


def test_whole_dataset_with_icu_need(repo):
    result = filter_hospitals(repo.all(), ["ICU"], AS_OF, 60)
    assert result.rejection_reasons == {
        "H06": RejectionReason.MISSING_SPECIALTY,
        "H33": RejectionReason.MISSING_SPECIALTY,
        "H11": RejectionReason.NOT_OPEN,
        "H14": RejectionReason.NOT_OPEN,
        "H17": RejectionReason.NO_ICU_BEDS,
    }
    assert "H23" in result.eligible_ids  # stale but still eligible
    assert len(result.eligible) + len(result.rejected) == len(repo)


# ---------------- whole dataset, a later "real" time ----------------
def test_whole_dataset_when_everything_is_stale(repo):
    result = filter_hospitals(repo.all(), ["ICU"], LATER, 60)
    assert all(e.bed_data_stale for e in result.eligible)
    # With stale data the ICU-bed rule is skipped, so H17 is now eligible.
    assert "H17" in result.eligible_ids
    assert result.rejection_reasons == {
        "H06": RejectionReason.MISSING_SPECIALTY,
        "H33": RejectionReason.MISSING_SPECIALTY,
        "H11": RejectionReason.NOT_OPEN,
        "H14": RejectionReason.NOT_OPEN,
    }


# ---------------- order and repeatability ----------------
def test_input_order_is_kept(repo):
    assert run(repo, ["H05", "H01", "H03"], []).eligible_ids == ("H05", "H01", "H03")


def test_same_input_gives_same_output(repo):
    first = filter_hospitals(repo.all(), ["ICU", "TRAUMA"], AS_OF, 60)
    second = filter_hospitals(repo.all(), ["ICU", "TRAUMA"], AS_OF, 60)
    assert first == second