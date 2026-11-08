"""Tests for the reason sentences (CONTRACT.md section 5 wording)."""

import pytest

from app.data.hospital_repository import load_repository
from app.services.hospital_ranking import RankingCandidate, rank_hospitals
from app.services.reasons import (
    build_alternative_reason,
    build_reasons,
    build_recommended_reason,
)


# ---------------------------------------------------------------------------
# The exact wording from the contract sample
# ---------------------------------------------------------------------------
def test_recommended_reason_matches_the_contract_sample():
    assert (
        build_recommended_reason(["ICU"], 9.0)
        == "Nearest open hospital with ICU (9.0 min ETA)."
    )


def test_alternative_reason_matches_the_contract_sample():
    assert (
        build_alternative_reason(["ICU"], 13.0, 9.0)
        == "Open with ICU, 4.0 min slower than recommended."
    )


# ---------------------------------------------------------------------------
# Needs wording (not shown in the sample)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("needs", "expected_phrase"),
    [
        ([], ""),
        (["ICU"], " with ICU"),
        (["ICU", "TRAUMA"], " with ICU and TRAUMA"),
        (["ICU", "TRAUMA", "CARDIAC"], " with ICU, TRAUMA and CARDIAC"),
        (["TRAUMA", "ICU"], " with TRAUMA and ICU"),  # request order is kept
        (["ICU", "ICU", "TRAUMA", "ICU"], " with ICU and TRAUMA"),  # no repeats
    ],
)
def test_recommended_reason_needs_wording(needs, expected_phrase):
    assert (
        build_recommended_reason(needs, 9.0)
        == f"Nearest open hospital{expected_phrase} (9.0 min ETA)."
    )


def test_alternative_reason_with_several_needs():
    assert (
        build_alternative_reason(["ICU", "TRAUMA", "CARDIAC"], 12.0, 9.0)
        == "Open with ICU, TRAUMA and CARDIAC, 3.0 min slower than recommended."
    )


def test_alternative_reason_with_no_needs():
    assert (
        build_alternative_reason([], 13.0, 9.0)
        == "Open hospital, 4.0 min slower than recommended."
    )


def test_needs_can_be_any_iterable_of_text():
    assert build_recommended_reason(("ICU",), 9.0) == build_recommended_reason(
        iter(["ICU"]), 9.0
    )


# ---------------------------------------------------------------------------
# Same ETA
# ---------------------------------------------------------------------------
def test_same_eta_as_recommended_has_its_own_wording():
    assert (
        build_alternative_reason(["ICU"], 9.0, 9.0)
        == "Open with ICU, same ETA as recommended."
    )
    assert (
        build_alternative_reason([], 9.0, 9.0)
        == "Open hospital, same ETA as recommended."
    )


# ---------------------------------------------------------------------------
# The numbers on screen must add up
# ---------------------------------------------------------------------------
def test_difference_has_no_floating_point_noise():
    # 0.3 - 0.1 is 0.19999999999999998 in plain floating point.
    assert build_alternative_reason(["ICU"], 0.3, 0.1).startswith(
        "Open with ICU, 0.2 min slower"
    )
    # 13.1 - 9.0 is 4.1000000000000005 in plain floating point.
    assert "4.1 min slower" in build_alternative_reason(["ICU"], 13.1, 9.0)


@pytest.mark.parametrize(
    ("eta", "recommended", "expected_gap"),
    [(10.0, 9.0, "1.0"), (9.1, 9.0, "0.1"), (120.5, 9.5, "111.0"), (5.0, 0.0, "5.0")],
)
def test_difference_equals_displayed_etas(eta, recommended, expected_gap):
    assert f", {expected_gap} min slower than recommended." in build_alternative_reason(
        ["ICU"], eta, recommended
    )


def test_eta_is_shown_with_exactly_one_decimal():
    assert "(9.0 min ETA)" in build_recommended_reason(["ICU"], 9)  # an int
    assert "(0.0 min ETA)" in build_recommended_reason(["ICU"], 0)
    assert "(120.0 min ETA)" in build_recommended_reason(["ICU"], 120.0)


def test_eta_with_more_decimals_rounds_half_up_like_the_api():
    assert "(9.1 min ETA)" in build_recommended_reason(["ICU"], 9.05)
    assert "(9.0 min ETA)" in build_recommended_reason(["ICU"], 9.04)


def test_alternative_faster_than_recommended_is_an_error():
    with pytest.raises(ValueError, match="faster"):
        build_alternative_reason(["ICU"], 8.0, 9.0)


# ---------------------------------------------------------------------------
# build_reasons: one reason per ranked hospital
# ---------------------------------------------------------------------------
def _candidate(hospital_id, eta, *, beds=10, stale=False, name=None):
    return RankingCandidate(
        hospital_id=hospital_id,
        name=name or f"Hospital {hospital_id}",
        beds_available=beds,
        eta_min=eta,
        bed_data_stale=stale,
    )


def test_build_reasons_first_is_recommended_rest_are_alternatives():
    ranked = rank_hospitals(
        [_candidate("H2", 13.0), _candidate("H1", 9.0), _candidate("H3", 9.0, beds=1)]
    )
    assert build_reasons(["ICU"], ranked) == (
        "Nearest open hospital with ICU (9.0 min ETA).",  # H1: ETA 9.0, 10 beds
        "Open with ICU, same ETA as recommended.",  # H3: ETA 9.0, 1 bed
        "Open with ICU, 4.0 min slower than recommended.",  # H2: ETA 13.0
    )


def test_build_reasons_matches_the_ranking_order():
    ranked = rank_hospitals([_candidate("H2", 13.0), _candidate("H1", 9.0)])
    reasons = build_reasons(["ICU"], ranked)
    assert len(reasons) == len(ranked) == 2
    assert reasons[0].startswith("Nearest open hospital")
    assert reasons[1].startswith("Open with ICU")


def test_build_reasons_empty_ranking_gives_empty_result():
    assert build_reasons(["ICU"], []) == ()


def test_build_reasons_single_hospital():
    ranked = rank_hospitals([_candidate("H1", 9.0)])
    assert build_reasons(["ICU"], ranked) == (
        "Nearest open hospital with ICU (9.0 min ETA).",
    )


def test_build_reasons_demo_pair_h07_h08():
    """Same location, same ETA: H07 (more beds) is recommended, H08 is the
    alternative with the same ETA."""
    repo = load_repository()
    candidates = [
        RankingCandidate(
            hospital_id=h.hospital_id,
            name=h.name,
            beds_available=h.beds_available,
            eta_min=9.0,
            bed_data_stale=False,
        )
        for h in (repo.get("H08"), repo.get("H07"))
    ]
    ranked = rank_hospitals(candidates)
    assert [r.hospital_id for r in ranked] == ["H07", "H08"]
    assert build_reasons(["ICU"], ranked) == (
        "Nearest open hospital with ICU (9.0 min ETA).",
        "Open with ICU, same ETA as recommended.",
    )


def test_reasons_never_mention_stale_data_or_beds():
    ranked = rank_hospitals(
        [
            _candidate("H1", 9.0, stale=True, beds=999),
            _candidate("H2", 12.0, stale=True),
        ]
    )
    for reason in build_reasons(["ICU"], ranked):
        lowered = reason.lower()
        assert "stale" not in lowered
        assert "bed" not in lowered


def test_every_reason_is_plain_ascii_and_ends_with_a_full_stop():
    ranked = rank_hospitals([_candidate("H1", 9.0), _candidate("H2", 11.5)])
    for reason in build_reasons(["ICU", "TRAUMA"], ranked):
        assert reason.isascii()
        assert reason.endswith(".")


def test_same_input_always_gives_the_same_reasons():
    ranked = rank_hospitals([_candidate("H1", 9.0), _candidate("H2", 11.5)])
    assert build_reasons(["ICU"], ranked) == build_reasons(["ICU"], ranked)


# ---------------------------------------------------------------------------
# Bad input
# ---------------------------------------------------------------------------
def test_needs_given_as_one_string_is_rejected():
    with pytest.raises(TypeError):
        build_recommended_reason("ICU", 9.0)


@pytest.mark.parametrize("bad_needs", [None, 5, 1.5])
def test_needs_that_is_not_a_collection_is_rejected(bad_needs):
    with pytest.raises(TypeError):
        build_recommended_reason(bad_needs, 9.0)


@pytest.mark.parametrize("bad_item", [None, 5, True])
def test_non_text_need_is_rejected(bad_item):
    with pytest.raises(TypeError):
        build_recommended_reason(["ICU", bad_item], 9.0)


@pytest.mark.parametrize("bad_item", ["", "   "])
def test_empty_need_is_rejected(bad_item):
    with pytest.raises(ValueError):
        build_recommended_reason([bad_item], 9.0)


@pytest.mark.parametrize("bad_eta", ["9.0", None, True])
def test_wrong_type_eta_is_rejected(bad_eta):
    with pytest.raises(TypeError):
        build_recommended_reason(["ICU"], bad_eta)
    with pytest.raises(TypeError):
        build_alternative_reason(["ICU"], bad_eta, 9.0)
    with pytest.raises(TypeError):
        build_alternative_reason(["ICU"], 9.0, bad_eta)


@pytest.mark.parametrize("bad_eta", [-1.0, float("nan"), float("inf")])
def test_invalid_eta_value_is_rejected(bad_eta):
    with pytest.raises(ValueError):
        build_recommended_reason(["ICU"], bad_eta)
    with pytest.raises(ValueError):
        build_alternative_reason(["ICU"], bad_eta, 9.0)
    with pytest.raises(ValueError):
        build_alternative_reason(["ICU"], 9.0, bad_eta)


def test_build_reasons_rejects_items_that_are_not_ranked_hospitals():
    with pytest.raises(TypeError):
        build_reasons(["ICU"], ["H1", "H2"])