"""Loads and validates hospitals_demo.json, then holds the records.

The file is only READ. It is never modified.
If anything is wrong, DatasetError explains exactly what and where.
"""

import json
from collections.abc import Iterable
from pathlib import Path

from pydantic import ValidationError

from app.models.hospital import DatasetMeta, Hospital

DEFAULT_DATASET_PATH = Path(__file__).resolve().parent / "hospitals_demo.json"


class DatasetError(Exception):
    """The hospital dataset is missing or invalid."""


class HospitalRepository:
    """Read-only collection of hospitals, in the same order as the file."""

    def __init__(self, meta: DatasetMeta, hospitals: Iterable[Hospital]) -> None:
        self._meta = meta
        self._hospitals = tuple(hospitals)
        self._by_id = {h.hospital_id: h for h in self._hospitals}

    @property
    def meta(self) -> DatasetMeta:
        return self._meta

    def all(self) -> tuple[Hospital, ...]:
        return self._hospitals

    def get(self, hospital_id: str) -> Hospital | None:
        """Return the hospital, or None if the ID is unknown."""
        return self._by_id.get(hospital_id)

    def __contains__(self, hospital_id: object) -> bool:
        return hospital_id in self._by_id

    def __len__(self) -> int:
        return len(self._hospitals)


def _format_errors(error: ValidationError) -> str:
    """Turn pydantic's error list into one short readable sentence."""
    parts = []
    for item in error.errors():
        where = ".".join(str(part) for part in item["loc"]) or "(whole record)"
        parts.append(f"{where}: {item['msg']}")
    return "; ".join(parts)


def _record_label(index: int, record: object) -> str:
    """'hospitals[1] (H02)' so error messages say which record is wrong."""
    hospital_id = record.get("hospital_id") if isinstance(record, dict) else None
    if isinstance(hospital_id, str) and hospital_id:
        return f"hospitals[{index}] ({hospital_id})"
    return f"hospitals[{index}]"


def _read_json(path: Path) -> dict:
    if not path.is_file():
        raise DatasetError(f"Hospital dataset not found: {path}")
    try:
        # utf-8-sig also accepts files saved with a Windows 'BOM'.
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise DatasetError(f"{path.name}: cannot read as JSON ({error})") from None
    if not isinstance(data, dict):
        raise DatasetError(f"{path.name}: the top level must be a JSON object.")
    return data


def _load_meta(data: dict, source: str) -> DatasetMeta:
    if "meta" not in data:
        raise DatasetError(f"{source}: missing the 'meta' section.")
    try:
        return DatasetMeta.model_validate(data["meta"])
    except ValidationError as error:
        raise DatasetError(f"{source}: meta: {_format_errors(error)}") from None


def _load_hospitals(data: dict, meta: DatasetMeta, source: str) -> list[Hospital]:
    raw_records = data.get("hospitals")
    if not isinstance(raw_records, list):
        raise DatasetError(f"{source}: 'hospitals' must be a list.")
    if not raw_records:
        raise DatasetError(f"{source}: the 'hospitals' list is empty.")

    hospitals: list[Hospital] = []
    seen_ids: set[str] = set()
    for index, record in enumerate(raw_records):
        label = _record_label(index, record)
        try:
            hospital = Hospital.model_validate(record)
        except ValidationError as error:
            raise DatasetError(f"{source}: {label}: {_format_errors(error)}") from None

        # Checks that need the dataset's own vocabularies.
        if hospital.status not in meta.status_values:
            raise DatasetError(
                f"{source}: {label}: status {hospital.status!r} is not one of "
                f"{list(meta.status_values)}."
            )
        unknown = [s for s in hospital.specialties if s not in meta.needs_vocabulary]
        if unknown:
            raise DatasetError(
                f"{source}: {label}: specialties {unknown} are not in "
                f"meta.needs_vocabulary."
            )
        if hospital.hospital_id in seen_ids:
            raise DatasetError(
                f"{source}: {label}: duplicate hospital_id {hospital.hospital_id!r}."
            )
        seen_ids.add(hospital.hospital_id)
        hospitals.append(hospital)
    return hospitals


def load_repository(path: Path | str | None = None) -> HospitalRepository:
    """Load and validate the dataset (default: app/data/hospitals_demo.json)."""
    file_path = Path(path) if path is not None else DEFAULT_DATASET_PATH
    source = file_path.name
    data = _read_json(file_path)
    meta = _load_meta(data, source)
    hospitals = _load_hospitals(data, meta, source)
    return HospitalRepository(meta, hospitals)