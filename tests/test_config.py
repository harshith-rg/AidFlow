"""Tests for configuration loading."""

import pytest

from app.core.config import ConfigError, Settings, load_settings


def test_defaults_match_the_agreed_values():
    settings = load_settings({})
    assert settings.time_mode == "real"
    assert settings.average_speed_kmh == 30
    assert settings.stale_after_minutes == 60
    assert settings.enable_demo_endpoints is False
    assert settings.preload_graph is True
    assert settings == Settings()


def test_valid_overrides_are_applied():
    settings = load_settings(
        {
            "AIDFLOW_TIME_MODE": "demo",
            "AIDFLOW_AVERAGE_SPEED_KMH": "40",
            "AIDFLOW_STALE_AFTER_MINUTES": "90",
            "AIDFLOW_ENABLE_DEMO_ENDPOINTS": "true",
            "AIDFLOW_PRELOAD_GRAPH": "false",
        }
    )
    assert settings.time_mode == "demo"
    assert settings.average_speed_kmh == 40
    assert settings.stale_after_minutes == 90
    assert settings.enable_demo_endpoints is True
    assert settings.preload_graph is False


def test_time_mode_ignores_case_and_spaces():
    assert load_settings({"AIDFLOW_TIME_MODE": " DEMO "}).time_mode == "demo"


def test_stale_threshold_zero_is_allowed():
    assert load_settings({"AIDFLOW_STALE_AFTER_MINUTES": "0"}).stale_after_minutes == 0


@pytest.mark.parametrize("word", ["true", "TRUE", "1", "yes", "on"])
def test_bool_true_words(word):
    assert load_settings({"AIDFLOW_ENABLE_DEMO_ENDPOINTS": word}).enable_demo_endpoints


@pytest.mark.parametrize("word", ["false", "FALSE", "0", "no", "off"])
def test_bool_false_words(word):
    settings = load_settings({"AIDFLOW_ENABLE_DEMO_ENDPOINTS": word})
    assert settings.enable_demo_endpoints is False


@pytest.mark.parametrize(
    "bad_env",
    [
        {"AIDFLOW_TIME_MODE": "banana"},
        {"AIDFLOW_TIME_MODE": ""},
        {"AIDFLOW_AVERAGE_SPEED_KMH": "0"},
        {"AIDFLOW_AVERAGE_SPEED_KMH": "-5"},
        {"AIDFLOW_AVERAGE_SPEED_KMH": "fast"},
        {"AIDFLOW_AVERAGE_SPEED_KMH": "nan"},
        {"AIDFLOW_AVERAGE_SPEED_KMH": "inf"},
        {"AIDFLOW_STALE_AFTER_MINUTES": "-1"},
        {"AIDFLOW_STALE_AFTER_MINUTES": "soon"},
        {"AIDFLOW_ENABLE_DEMO_ENDPOINTS": "maybe"},
    ],
)
def test_invalid_settings_are_rejected(bad_env):
    with pytest.raises(ConfigError):
        load_settings(bad_env)


def test_settings_are_read_from_real_environment(monkeypatch):
    monkeypatch.setenv("AIDFLOW_TIME_MODE", "demo")
    assert load_settings().time_mode == "demo"