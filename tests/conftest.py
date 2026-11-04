"""Shared test helpers."""

import json
from pathlib import Path

import pytest

from app.data.hospital_repository import (
    DEFAULT_DATASET_PATH,
    HospitalRepository,
    load_repository,
)


@pytest.fixture(scope="session")
def repo() -> HospitalRepository:
    """The real demo dataset, loaded once for all tests."""
    return load_repository()


@pytest.fixture
def dataset_dict() -> dict:
    """A fresh in-memory copy of the real dataset that a test may damage."""
    return json.loads(DEFAULT_DATASET_PATH.read_text(encoding="utf-8-sig"))


@pytest.fixture
def write_dataset(tmp_path):
    """Write a dict to a temporary JSON file and return its path."""

    def _write(data) -> Path:
        path = tmp_path / "dataset.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    return _write