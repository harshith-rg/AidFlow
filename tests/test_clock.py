"""Tests for the reference-time (real mode vs demo mode)."""

from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import Settings, load_settings
from app.services.clock import get_reference_time
from app.services.hospital_filter import filter_hospitals

UTC = timezone.utc
AS_OF = datetime(2026, 10, 31, 14, 30, tzinfo=UTC)
FIXED_NOW = datetime(2026, 11, 2, 10, 15, tzinfo=UTC)


def fixed_clock():
    return FIXED_NOW


def clock_must_not_be_used():
    raise AssertionError("demo mode must not read the real clock")


def test_demo_mode_uses_dataset_as_of():
    result = get_reference_time(
        Settings(time_mode="demo"), AS_OF, now_fn=clock_must_not_be_used
    )
    assert result.value == AS_OF
    assert result.mode == "demo"


def test_real_mode_uses_the_clock():
    result = get_reference_time(Settings(time_mode="real"), AS_OF, now_fn=fixed_clock)
    assert result.value == FIXED_NOW
    assert result.mode == "real"


def test_default_settings_mean_real_mode():
    result = get_reference_time(Settings(), AS_OF, now_fn=fixed_clock)
    assert result.mode == "real"
    assert result.value == FIXED_NOW


def test_real_mode_default_clock_is_actual_utc_time():
    before = datetime.now(UTC)
    result = get_reference_time(Settings(time_mode="real"), AS_OF)
    after = datetime.now(UTC)
    assert before <= result.value <= after
    assert result.value.utcoffset() == timedelta(0)


def test_real_mode_converts_other_time_zones_to_utc():
    india = timezone(timedelta(hours=5, minutes=30))

    def clock_in_india():
        return datetime(2026, 11, 2, 15, 45, tzinfo=india)

    result = get_reference_time(Settings(time_mode="real"), AS_OF, now_fn=clock_in_india)
    assert result.value == FIXED_NOW
    assert result.value.utcoffset() == timedelta(0)


def test_real_mode_rejects_a_clock_without_time_zone():
    def naive_clock():
        return datetime(2026, 11, 2, 10, 15)

    with pytest.raises(ValueError, match="time zone"):
        get_reference_time(Settings(time_mode="real"), AS_OF, now_fn=naive_clock)


def test_demo_mode_rejects_as_of_without_time_zone():
    with pytest.raises(ValueError, match="time zone"):
        get_reference_time(Settings(time_mode="demo"), datetime(2026, 10, 31, 14, 30))


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError, match="Unknown time mode"):
        get_reference_time(Settings(time_mode="banana"), AS_OF)


def test_demo_mode_works_with_phase1_configuration_and_repository(repo):
    settings = load_settings({"AIDFLOW_TIME_MODE": "demo"})
    result = get_reference_time(settings, repo.meta.as_of)
    assert result.value == datetime(2026, 10, 31, 14, 30, tzinfo=UTC)
    assert result.mode == "demo"


def test_time_mode_changes_which_hospitals_are_stale(repo):
    """Same data, two time modes: demo mode has 1 stale hospital, a later
    real-mode time has all of them stale."""
    settings_demo = Settings(time_mode="demo")
    settings_real = Settings(time_mode="real")
    demo_time = get_reference_time(settings_demo, repo.meta.as_of)
    real_time = get_reference_time(settings_real, repo.meta.as_of, now_fn=fixed_clock)

    demo = filter_hospitals(repo.all(), [], demo_time.value, settings_demo.stale_after_minutes)
    real = filter_hospitals(repo.all(), [], real_time.value, settings_real.stale_after_minutes)

    assert [e.hospital.hospital_id for e in demo.eligible if e.bed_data_stale] == ["H23"]
    assert all(e.bed_data_stale for e in real.eligible)