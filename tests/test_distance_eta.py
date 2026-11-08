"""Tests for distance and ETA calculation (CONTRACT.md sections 2 and 9)."""

from dataclasses import FrozenInstanceError
from decimal import Decimal

import pytest

from app.core.config import Settings
from app.services.distance_eta import (
    DistanceEta,
    calculate_distance_eta,
    round_half_up,
)

SPEED = 30.0  # contract default, km/h


# ---------------------------------------------------------------------------
# The formula: eta_min = (distance_km / speed_kmh) * 60
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("distance_m", "speed", "expected_eta"),
    [
        (15000, 30, 30.0),  # 15 km at 30 km/h = 30 min
        (4500, 30, 9.0),  # contract example ETA of 9.0 min
        (6500, 30, 13.0),  # contract example ETA of 13.0 min
        (10000, 40, 15.0),  # a different speed (setting override)
        (5010, 30, 10.0),  # Phase 0 report: H01 -> H02, 5.01 km = 10.0 min
        (4530, 30, 9.1),  # Phase 0 report: H02 -> H01, 4.53 km = 9.1 min
        (0, 30, 0.0),  # already there
    ],
)
def test_eta_formula(distance_m, speed, expected_eta):
    assert calculate_distance_eta(distance_m, speed).eta_min == expected_eta


def test_contract_sample_numbers_match_the_formula():
    """CONTRACT.md section 5 sample: 4.5 km -> 9.0 min, 6.5 km -> 13.0 min."""
    assert calculate_distance_eta(4500, SPEED).eta_min == 9.0
    assert calculate_distance_eta(6500, SPEED).eta_min == 13.0


def test_default_speed_setting_gives_contract_formula():
    speed = Settings().average_speed_kmh
    assert calculate_distance_eta(3000, speed).eta_min == 6.0


def test_integer_and_float_inputs_agree():
    assert calculate_distance_eta(5000, 30) == calculate_distance_eta(5000.0, 30.0)


# ---------------------------------------------------------------------------
# Rounding (decision D2: half up) and one rounding only (decision D1)
# ---------------------------------------------------------------------------
def test_distance_is_rounded_to_two_decimals():
    assert calculate_distance_eta(5010.4, SPEED).distance_km == 5.01
    assert calculate_distance_eta(1000, SPEED).distance_km == 1.0
    assert calculate_distance_eta(0, SPEED).distance_km == 0.0


def test_distance_rounds_half_up_not_half_to_even():
    # 0.125 km: Python round() gives 0.12, half-up gives 0.13.
    assert calculate_distance_eta(125, SPEED).distance_km == 0.13
    assert calculate_distance_eta(124.9, SPEED).distance_km == 0.12


def test_eta_rounds_half_up():
    # 25 m at 30 km/h is exactly 0.05 min, which must round up to 0.1.
    assert calculate_distance_eta(25, SPEED).eta_min == 0.1
    # 24.9 m is a little under 0.05 min and rounds down to 0.0.
    assert calculate_distance_eta(24.9, SPEED).eta_min == 0.0


def test_eta_uses_unrounded_distance():
    """D1: the ETA comes from the real distance, not the rounded km value.

    1,021 m at 25 km/h is 2.4504 min, which rounds to 2.5.
    If the distance were rounded first (1.02 km), the ETA would be
    2.448 min, which rounds to 2.4. The two routes give different answers.
    """
    result = calculate_distance_eta(1021, 25)
    assert result.distance_km == 1.02
    assert result.eta_min == 2.5


def test_raw_eta_is_not_rounded():
    result = calculate_distance_eta(4530, SPEED)  # 9.06 min
    assert result.eta_min == 9.1
    assert result.raw_eta_min == pytest.approx(9.06)


def test_round_half_up_helper():
    assert round_half_up(Decimal("0.125"), 2) == 0.13
    assert round_half_up(Decimal("2.675"), 2) == 2.68
    assert round_half_up(Decimal("9.05"), 1) == 9.1
    assert round_half_up(Decimal("9.049"), 1) == 9.0


# ---------------------------------------------------------------------------
# Result object and repeatability
# ---------------------------------------------------------------------------
def test_result_is_read_only():
    result = calculate_distance_eta(5000, SPEED)
    assert isinstance(result, DistanceEta)
    with pytest.raises(FrozenInstanceError):
        result.eta_min = 1.0  # type: ignore[misc]


def test_same_input_always_gives_same_output():
    results = {calculate_distance_eta(12345.678, 27.5) for _ in range(50)}
    assert len(results) == 1


def test_very_long_distance_still_works():
    result = calculate_distance_eta(1_000_000, SPEED)  # 1,000 km
    assert result.distance_km == 1000.0
    assert result.eta_min == 2000.0


# ---------------------------------------------------------------------------
# Bad input
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("bad_distance", ["100", None, True, [5], 1 + 2j])
def test_distance_of_wrong_type_raises_type_error(bad_distance):
    with pytest.raises(TypeError):
        calculate_distance_eta(bad_distance, SPEED)


@pytest.mark.parametrize("bad_distance", [-1, -0.001, float("nan"), float("inf")])
def test_invalid_distance_value_raises_value_error(bad_distance):
    with pytest.raises(ValueError):
        calculate_distance_eta(bad_distance, SPEED)


@pytest.mark.parametrize("bad_speed", ["30", None, True, [30]])
def test_speed_of_wrong_type_raises_type_error(bad_speed):
    with pytest.raises(TypeError):
        calculate_distance_eta(1000, bad_speed)


@pytest.mark.parametrize("bad_speed", [0, -5, 0.0, float("nan"), float("inf")])
def test_invalid_speed_value_raises_value_error(bad_speed):
    with pytest.raises(ValueError):
        calculate_distance_eta(1000, bad_speed)