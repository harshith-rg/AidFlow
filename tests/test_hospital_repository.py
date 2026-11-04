"""Tests for loading and validating the hospital dataset."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.data.hospital_repository import (
    DEFAULT_DATASET_PATH,
    DatasetError,
    load_repository,
)

UTC = timezone.utc


# ---------------- loading the real dataset ----------------
def test_loads_all_37_hospitals_in_file_order(repo):
    ids = [h.hospital_id for h in repo.all()]
    assert ids == [f"H{n:02d}" for n in range(1, 38)]
    assert len(repo) == 37


def test_meta_is_loaded(repo):
    meta = repo.meta
    assert meta.is_demo is True
    assert meta.as_of == datetime(2026, 10, 31, 14, 30, tzinfo=UTC)
    assert meta.stale_after_minutes == 60
    assert meta.status_values == ("OPEN", "CLOSED", "DIVERTED")
    assert meta.needs_vocabulary == (
        "ICU", "TRAUMA", "CARDIAC", "NEURO", "MATERNITY", "PAEDIATRIC", "GENERAL",
    )
    assert meta.coverage_bbox.south == 12.83
    assert meta.coverage_bbox.east == 77.80


def test_one_record_is_read_correctly(repo):
    h = repo.get("H02")
    assert h.name == "Demo Shivajinagar General Hospital"
    assert (h.location.lat, h.location.lng) == (12.9857, 77.6057)
    assert h.status == "OPEN"
    assert h.specialties == ("ICU", "TRAUMA", "GENERAL", "PAEDIATRIC")
    assert (h.beds_total, h.beds_available, h.icu_beds_available) == (250, 30, 4)
    assert h.last_updated == datetime(2026, 10, 31, 14, 18, tzinfo=UTC)
    assert h.is_demo is True


def test_original_coordinates_are_kept_not_snapped(repo):
    h = repo.get("H01")
    assert (h.location.lat, h.location.lng) == (12.9767, 77.5713)


def test_every_record_is_marked_demo(repo):
    assert all(h.is_demo for h in repo.all())


def test_get_unknown_id_returns_none(repo):
    assert repo.get("H99") is None
    assert "H99" not in repo
    assert "H01" in repo


def test_all_returns_a_tuple(repo):
    assert isinstance(repo.all(), tuple)


def test_hospital_records_are_read_only(repo):
    with pytest.raises(ValidationError):
        repo.get("H01").status = "CLOSED"


def test_loading_does_not_change_the_file():
    before = DEFAULT_DATASET_PATH.read_bytes()
    load_repository()
    assert DEFAULT_DATASET_PATH.read_bytes() == before


def test_file_saved_with_windows_bom_still_loads(dataset_dict, tmp_path):
    import json

    path = tmp_path / "bom.json"
    path.write_text(json.dumps(dataset_dict), encoding="utf-8-sig")
    assert len(load_repository(path)) == 37


# ---------------- file-level problems ----------------
def test_missing_file(tmp_path):
    with pytest.raises(DatasetError, match="not found"):
        load_repository(tmp_path / "nope.json")


def test_invalid_json_text(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(DatasetError, match="cannot read as JSON"):
        load_repository(path)


def test_top_level_must_be_an_object(write_dataset):
    with pytest.raises(DatasetError, match="top level"):
        load_repository(write_dataset([1, 2, 3]))


def test_missing_meta_section(dataset_dict, write_dataset):
    del dataset_dict["meta"]
    with pytest.raises(DatasetError, match="meta"):
        load_repository(write_dataset(dataset_dict))


def test_missing_hospitals_section(dataset_dict, write_dataset):
    del dataset_dict["hospitals"]
    with pytest.raises(DatasetError, match="hospitals"):
        load_repository(write_dataset(dataset_dict))


def test_empty_hospitals_list(dataset_dict, write_dataset):
    dataset_dict["hospitals"] = []
    with pytest.raises(DatasetError, match="empty"):
        load_repository(write_dataset(dataset_dict))


# ---------------- damaged meta ----------------
def m_meta_missing_as_of(d):
    del d["meta"]["as_of"]


def m_meta_naive_as_of(d):
    d["meta"]["as_of"] = "2026-10-31T14:30:00"


def m_meta_empty_vocabulary(d):
    d["meta"]["needs_vocabulary"] = []


def m_meta_bad_bbox(d):
    d["meta"]["coverage_bbox"]["south"] = 13.5  # south above north


def m_meta_negative_threshold(d):
    d["meta"]["stale_after_minutes"] = -5


def m_meta_not_an_object(d):
    d["meta"] = "oops"


META_MUTATIONS = {
    f.__name__: f
    for f in (
        m_meta_missing_as_of,
        m_meta_naive_as_of,
        m_meta_empty_vocabulary,
        m_meta_bad_bbox,
        m_meta_negative_threshold,
        m_meta_not_an_object,
    )
}


@pytest.mark.parametrize("name", list(META_MUTATIONS))
def test_damaged_meta_is_rejected(name, dataset_dict, write_dataset):
    META_MUTATIONS[name](dataset_dict)
    with pytest.raises(DatasetError, match="meta"):
        load_repository(write_dataset(dataset_dict))


# ---------------- damaged hospital records (record index 1 = H02) ----------------
def _h2(d):
    return d["hospitals"][1]


def m_missing_status(d):
    del _h2(d)["status"]


def m_missing_location(d):
    del _h2(d)["location"]


def m_missing_is_demo(d):
    del _h2(d)["is_demo"]


def m_lat_too_big(d):
    _h2(d)["location"]["lat"] = 91


def m_lng_too_small(d):
    _h2(d)["location"]["lng"] = -181


def m_lat_as_text(d):
    _h2(d)["location"]["lat"] = "12.9"


def m_negative_beds(d):
    _h2(d)["beds_available"] = -1


def m_beds_as_text(d):
    _h2(d)["beds_total"] = "250"


def m_beds_as_bool(d):
    _h2(d)["icu_beds_available"] = True


def m_beds_as_fraction(d):
    _h2(d)["beds_available"] = 2.5


def m_unknown_status(d):
    _h2(d)["status"] = "PAUSED"


def m_unknown_specialty(d):
    _h2(d)["specialties"].append("DENTAL")


def m_specialties_as_text(d):
    _h2(d)["specialties"] = "ICU"


def m_timestamp_without_zone(d):
    _h2(d)["last_updated"] = "2026-10-31T14:18:00"


def m_timestamp_as_number(d):
    _h2(d)["last_updated"] = 1761920000


def m_timestamp_as_nonsense(d):
    _h2(d)["last_updated"] = "yesterday"


def m_empty_id(d):
    _h2(d)["hospital_id"] = ""


def m_empty_name(d):
    _h2(d)["name"] = ""


def m_record_not_an_object(d):
    d["hospitals"][1] = "H02"


RECORD_MUTATIONS = {
    f.__name__: f
    for f in (
        m_missing_status, m_missing_location, m_missing_is_demo,
        m_lat_too_big, m_lng_too_small, m_lat_as_text,
        m_negative_beds, m_beds_as_text, m_beds_as_bool, m_beds_as_fraction,
        m_unknown_status, m_unknown_specialty, m_specialties_as_text,
        m_timestamp_without_zone, m_timestamp_as_number, m_timestamp_as_nonsense,
        m_empty_id, m_empty_name, m_record_not_an_object,
    )
}


@pytest.mark.parametrize("name", list(RECORD_MUTATIONS))
def test_damaged_record_is_rejected_and_located(name, dataset_dict, write_dataset):
    RECORD_MUTATIONS[name](dataset_dict)
    with pytest.raises(DatasetError) as info:
        load_repository(write_dataset(dataset_dict))
    # The message must say WHICH record is wrong.
    assert "hospitals[1]" in str(info.value)


def test_duplicate_hospital_id_is_rejected(dataset_dict, write_dataset):
    dataset_dict["hospitals"][1]["hospital_id"] = "H01"
    with pytest.raises(DatasetError) as info:
        load_repository(write_dataset(dataset_dict))
    assert "duplicate" in str(info.value).lower()
    assert "H01" in str(info.value)