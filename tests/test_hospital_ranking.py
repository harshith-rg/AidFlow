"""Tests for hospital ranking (CONTRACT.md section 8, step 3).

P1 (fresh before stale at equal ETA) and P2 (rank on rounded ETA) are
PENDING TEAM APPROVAL. The tests marked P1 or P2 pin the provisional choice.
If the team decides differently, those tests are the ones to change.
"""

from dataclasses import FrozenInstanceError
from itertools import permutations

import pytest

from app.data.hospital_repository import load_repository
from app.services.hospital_filter import filter_hospitals
from app.services.hospital_ranking import (
    EtaBasis,
    RankedHospital,
    RankingCandidate,
    rank_hospitals,
)


def cand(hospital_id, *, eta=10.0, beds=10, name=None, stale=False, raw=None):
    """Short way to build a candidate for a test."""
    return RankingCandidate(
        hospital_id=hospital_id,
        name=name if name is not None else f"Hospital {hospital_id}",
        beds_available=beds,
        eta_min=eta,
        bed_data_stale=stale,
        raw_eta_min=raw,
    )


def ids(ranked):
    return [item.hospital_id for item in ranked]


# ---------------------------------------------------------------------------
# The contract order: ETA, then beds, then name
# ---------------------------------------------------------------------------
def test_smaller_eta_ranks_first_even_with_fewer_beds_and_a_later_name():
    ranked = rank_hospitals(
        [
            cand("H1", eta=12.0, beds=90, name="Alpha"),
            cand("H2", eta=9.0, beds=1, name="Zulu"),
            cand("H3", eta=10.5, beds=50, name="Mike"),
        ]
    )
    assert ids(ranked) == ["H2", "H3", "H1"]


def test_equal_eta_more_beds_ranks_first():
    ranked = rank_hospitals(
        [cand("H1", beds=5), cand("H2", beds=20), cand("H3", beds=12)]
    )
    assert ids(ranked) == ["H2", "H3", "H1"]


def test_equal_eta_and_beds_name_a_to_z():
    ranked = rank_hospitals(
        [
            cand("H1", name="Charlie"),
            cand("H2", name="Alpha"),
            cand("H3", name="Bravo"),
        ]
    )
    assert ids(ranked) == ["H2", "H3", "H1"]


def test_beds_are_compared_before_name():
    """The hospital with more beds wins even though its name sorts later.
    (The H07/H08 demo pair cannot prove this, see the next section.)"""
    ranked = rank_hospitals(
        [
            cand("H1", beds=5, name="Alpha Hospital"),
            cand("H2", beds=50, name="Zulu Hospital"),
        ]
    )
    assert ids(ranked) == ["H2", "H1"]


def test_eta_tie_is_exact_not_close():
    ranked = rank_hospitals([cand("H1", eta=9.1, beds=1), cand("H2", eta=9.0, beds=1)])
    assert ids(ranked) == ["H2", "H1"]


# ---------------------------------------------------------------------------
# The H07 / H08 pair from the demo dataset
# ---------------------------------------------------------------------------
def test_demo_pair_h07_h08_share_a_location():
    repo = load_repository()
    assert repo.get("H07").location == repo.get("H08").location


@pytest.mark.parametrize("input_order", [("H07", "H08"), ("H08", "H07")])
def test_demo_pair_h07_h08_more_beds_first_in_any_input_order(input_order):
    repo = load_repository()
    candidates = []
    for hospital_id in input_order:
        hospital = repo.get(hospital_id)
        candidates.append(
            RankingCandidate(
                hospital_id=hospital.hospital_id,
                name=hospital.name,
                beds_available=hospital.beds_available,
                eta_min=9.0,  # same place, so the same road distance and ETA
                bed_data_stale=False,
            )
        )
    assert ids(rank_hospitals(candidates)) == ["H07", "H08"]


# ---------------------------------------------------------------------------
# P1 (pending approval): stale data, ETA first, then fresh before stale
# ---------------------------------------------------------------------------
def test_p1_stale_hospital_with_many_beds_does_not_beat_fresh_at_equal_eta():
    ranked = rank_hospitals(
        [
            cand("STALE", beds=999, stale=True, name="Alpha"),
            cand("FRESH", beds=5, stale=False, name="Zulu"),
        ]
    )
    assert ids(ranked) == ["FRESH", "STALE"]


def test_p1_stale_hospitals_are_ordered_by_name_not_beds():
    ranked = rank_hospitals(
        [
            cand("H1", beds=900, stale=True, name="Bravo"),
            cand("H2", beds=1, stale=True, name="Alpha"),
        ]
    )
    assert ids(ranked) == ["H2", "H1"]


def test_p1_a_faster_stale_hospital_still_ranks_first():
    """Staleness never demotes a hospital on ETA: ETA is checked first."""
    ranked = rank_hospitals(
        [
            cand("FRESH", eta=20.0, beds=50),
            cand("STALE", eta=8.0, beds=0, stale=True),
        ]
    )
    assert ids(ranked) == ["STALE", "FRESH"]


def test_p1_mixed_group_order_is_consistent():
    """Fresh X (10 beds), fresh Y (5 beds), stale Z (name sorts first).
    A 'skip beds if either is stale' rule would be circular here; the group
    rule gives one clear order."""
    ranked = rank_hospitals(
        [
            cand("Z", beds=500, stale=True, name="Aardvark"),
            cand("Y", beds=5, name="Zebra"),
            cand("X", beds=10, name="Mango"),
        ]
    )
    assert ids(ranked) == ["X", "Y", "Z"]


# ---------------------------------------------------------------------------
# P1 on the real demo data and the real filter
# ---------------------------------------------------------------------------
def test_p1_real_demo_data_stale_hospital_h23_ranks_last_at_equal_eta():
    repo = load_repository()
    result = filter_hospitals(
        repo.all(),
        needs=["ICU"],
        reference_time=repo.meta.as_of,  # demo clock: dataset as_of time
        stale_after_minutes=60,
    )
    stale_ids = [i.hospital.hospital_id for i in result.eligible if i.bed_data_stale]
    assert stale_ids == ["H23"]  # the only stale hospital in the dataset

    candidates = [
        RankingCandidate(
            hospital_id=item.hospital.hospital_id,
            name=item.hospital.name,
            beds_available=item.hospital.beds_available,
            eta_min=10.0,  # same ETA for all, so only the tie-breaks decide
            bed_data_stale=item.bed_data_stale,
        )
        for item in result.eligible
    ]
    ranked = rank_hospitals(candidates)

    fresh = [c for c in candidates if not c.bed_data_stale]
    expected_fresh_order = [
        c.hospital_id
        for c in sorted(fresh, key=lambda c: (-c.beds_available, c.name))
    ]
    assert ids(ranked) == expected_fresh_order + ["H23"]
    assert ids(ranked)[0] == "H01"  # most beds among the fresh ICU hospitals (42)


def test_p1_real_demo_data_h17_and_h06_are_not_eligible_for_icu():
    """The filter (not the ranking) removes hospitals without ICU beds or ICU."""
    repo = load_repository()
    result = filter_hospitals(
        repo.all(),
        needs=["ICU"],
        reference_time=repo.meta.as_of,
        stale_after_minutes=60,
    )
    assert "H17" not in result.eligible_ids  # ICU capable, 0 ICU beds
    assert "H06" not in result.eligible_ids  # no ICU
    assert "H11" not in result.eligible_ids  # closed


# ---------------------------------------------------------------------------
# P2 (pending approval): rounded or unrounded ETA
# ---------------------------------------------------------------------------
def test_p2_rounded_eta_is_the_default_so_equal_displayed_eta_falls_to_beds():
    """Both show 9.0 min. By default beds decide, even though FAST is a
    little quicker in reality (9.02 vs 9.04)."""
    candidates = [
        cand("FAST", eta=9.0, raw=9.02, beds=5),
        cand("SLOW", eta=9.0, raw=9.04, beds=20),
    ]
    assert ids(rank_hospitals(candidates)) == ["SLOW", "FAST"]


def test_p2_unrounded_option_ranks_by_the_real_eta():
    candidates = [
        cand("FAST", eta=9.0, raw=9.02, beds=5),
        cand("SLOW", eta=9.0, raw=9.04, beds=20),
    ]
    ranked = rank_hospitals(candidates, eta_basis=EtaBasis.UNROUNDED)
    assert ids(ranked) == ["FAST", "SLOW"]


def test_p2_basis_can_be_given_as_text():
    candidates = [cand("A", raw=9.02), cand("B", raw=9.01)]
    assert ids(rank_hospitals(candidates, eta_basis="unrounded")) == ["B", "A"]


def test_p2_unrounded_without_raw_eta_is_an_error():
    with pytest.raises(ValueError, match="raw_eta_min"):
        rank_hospitals([cand("H1")], eta_basis=EtaBasis.UNROUNDED)


def test_unknown_eta_basis_is_an_error():
    with pytest.raises(ValueError):
        rank_hospitals([cand("H1")], eta_basis="fastest")


# ---------------------------------------------------------------------------
# Last tie-breaks: name case, then hospital_id
# ---------------------------------------------------------------------------
def test_names_are_compared_ignoring_case():
    ranked = rank_hospitals(
        [cand("H1", name="bravo"), cand("H2", name="Alpha"), cand("H3", name="charlie")]
    )
    assert ids(ranked) == ["H2", "H1", "H3"]


def test_same_name_apart_from_case_still_gives_a_fixed_order():
    forward = ids(rank_hospitals([cand("H1", name="alpha"), cand("H2", name="Alpha")]))
    backward = ids(rank_hospitals([cand("H2", name="Alpha"), cand("H1", name="alpha")]))
    assert forward == backward == ["H2", "H1"]  # "Alpha" < "alpha" exactly


def test_everything_equal_hospital_id_decides():
    ranked = rank_hospitals(
        [cand("H9", name="Same"), cand("H2", name="Same"), cand("H5", name="Same")]
    )
    assert ids(ranked) == ["H2", "H5", "H9"]


# ---------------------------------------------------------------------------
# Same input always gives the same output
# ---------------------------------------------------------------------------
def _mixed_candidates():
    return [
        cand("A", eta=9.0, beds=10, name="Alpha"),
        cand("B", eta=9.0, beds=10, name="Alpha"),  # same name, ID decides
        cand("C", eta=9.0, beds=30, name="Charlie"),
        cand("D", eta=9.0, beds=500, name="Delta", stale=True),
        cand("E", eta=9.0, beds=1, name="Echo", stale=True),
        cand("F", eta=7.5, beds=2, name="Foxtrot"),
    ]


def test_every_input_order_gives_the_same_ranking():
    candidates = _mixed_candidates()
    expected = ids(rank_hospitals(candidates))
    assert expected == ["F", "C", "A", "B", "D", "E"]
    for order in permutations(candidates):
        assert ids(rank_hospitals(order)) == expected


def test_repeat_calls_give_identical_results():
    candidates = _mixed_candidates()
    assert rank_hospitals(candidates) == rank_hospitals(candidates)


def test_input_list_is_not_changed():
    candidates = _mixed_candidates()
    snapshot = list(candidates)
    rank_hospitals(candidates)
    assert candidates == snapshot


def test_works_with_any_iterable():
    assert ids(rank_hospitals(iter(_mixed_candidates()))) == ids(
        rank_hospitals(tuple(_mixed_candidates()))
    )


# ---------------------------------------------------------------------------
# Result shape
# ---------------------------------------------------------------------------
def test_ranks_are_numbered_from_one():
    ranked = rank_hospitals(_mixed_candidates())
    assert [item.rank for item in ranked] == [1, 2, 3, 4, 5, 6]
    assert all(isinstance(item, RankedHospital) for item in ranked)


def test_empty_input_gives_empty_result():
    assert rank_hospitals([]) == ()


def test_single_candidate():
    ranked = rank_hospitals([cand("H1")])
    assert ids(ranked) == ["H1"]
    assert ranked[0].rank == 1


def test_result_and_candidate_are_read_only():
    ranked = rank_hospitals([cand("H1")])
    with pytest.raises(FrozenInstanceError):
        ranked[0].rank = 5  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        ranked[0].candidate.eta_min = 1.0  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Bad input
# ---------------------------------------------------------------------------
def test_duplicate_hospital_ids_are_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        rank_hospitals([cand("H1"), cand("H1", name="Other")])


def test_non_candidate_items_are_rejected():
    with pytest.raises(TypeError):
        rank_hospitals(["H1", "H2"])


@pytest.mark.parametrize("bad", [-1.0, float("nan"), float("inf")])
def test_invalid_eta_value_is_rejected(bad):
    with pytest.raises(ValueError):
        cand("H1", eta=bad)


@pytest.mark.parametrize("bad", ["9.0", None, True])
def test_wrong_type_eta_is_rejected(bad):
    with pytest.raises(TypeError):
        cand("H1", eta=bad)


def test_invalid_raw_eta_is_rejected():
    with pytest.raises(ValueError):
        cand("H1", raw=-0.5)


@pytest.mark.parametrize("bad", [1.5, "10", None, True])
def test_beds_must_be_a_whole_number(bad):
    with pytest.raises(TypeError):
        cand("H1", beds=bad)


def test_negative_beds_are_rejected():
    with pytest.raises(ValueError):
        cand("H1", beds=-1)


@pytest.mark.parametrize("bad", ["yes", 1, None])
def test_stale_flag_must_be_true_or_false(bad):
    with pytest.raises(TypeError):
        cand("H1", stale=bad)


@pytest.mark.parametrize("field", ["hospital_id", "name"])
def test_empty_id_or_name_is_rejected(field):
    with pytest.raises(ValueError):
        RankingCandidate(
            **{
                "hospital_id": "H1",
                "name": "Name",
                "beds_available": 1,
                "eta_min": 1.0,
                "bed_data_stale": False,
                field: "  ",
            }
        )