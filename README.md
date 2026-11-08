# AidFlow: Emergency Ambulance Routing & Hospital Recommendation

> **Prototype Notice**  
> All hospital data in this project is fictional **DEMO DATA**.  
> Route durations (ETAs) are **estimates** based on assumed average speeds with **no live traffic data**.  
> The API specification and schema rules are governed by [`CONTRACT.md`](CONTRACT.md) as the single source of truth.

---

## Overview

AidFlow is a smart emergency ambulance response and hospital recommendation system prototype. This repository contains **Member 3 (Harshith RG)**'s module, currently implemented through **Phases 0–4: Road Routing, ETA Calculation & Hospital Ranking**.

Features implemented in Phases 0–4:
- **Road network loading & cleanup**: Directed multigraph validation, parallel edge collapsing, self-loop removal, and safe heuristic factor computation stored in an immutable, memory-efficient `RoadGraph` structure.
- **Hospital data management & filtering**: Demo hospital dataset loading, schema validation, operational status checks, emergency specialty filtering, and configurable data staleness detection.
- **Deterministic location snapping**: Snapping GPS coordinates for patient pickup and hospital locations to the nearest road intersection node within coverage boundaries and distance limits.
- **Independent routing algorithms**: Custom implementations of **A\*** (with an admissible, scaled Haversine heuristic) and **Dijkstra** algorithms built from scratch using Python's `heapq`.
- **Algorithm verification**: Agreement tests verifying identical shortest paths and road distances between custom A*, custom Dijkstra, and NetworkX across deterministic synthetic graphs and random trips.
- **Contract-compliant error handling**: Consistent JSON error formatting returning `{"error": {"code", "message", "details"}}` for `INVALID_COORDINATES`, `INVALID_REQUEST`, `OUT_OF_COVERAGE`, `NO_ROUTE_FOUND`, and `INTERNAL_ERROR`.
- **Interactive demo map interface**: Leaflet web interface served at `GET /` to visualize road paths, one-way street asymmetry, intersection nodes, and snapping distances in central Bengaluru.
- **Distance & ETA calculation**: Converts a road distance in metres and an average speed into `distance_km` (2 decimals) and `eta_min` (1 decimal) using the CONTRACT.md section 9 formula (`app/services/distance_eta.py`).
- **Hospital ranking**: Sorts eligible hospitals best first; the exact order is listed under "ETA and Ranking Assumptions" (`app/services/hospital_ranking.py`).
- **Reason sentences**: Short display text for the recommended hospital and each alternative (`app/services/reasons.py`).

*(Note: The Phase 4 services are implemented and tested, but are not yet exposed through any HTTP endpoint. Phase 5 `POST /recommend-hospital` is not started.)*

---

## Requirements

- Python 3.11+
- Windows, macOS, or Linux
- Virtual environment (`venv`)

---

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/harshith-rg/AidFlow.git aidflow-routing
cd aidflow-routing
```

### 2. Create and activate a virtual environment

**On Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
*(Or in Command Prompt: `.\.venv\Scripts\activate.bat`)*

**On macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

---

## Road Network Setup

The service requires the central Bengaluru road network in GraphML format at `app/data/graph/bengaluru_small_full.graphml`.

> **Active Graph Notice**: The application currently loads `app/data/graph/bengaluru_small_full.graphml` (6.47 MB, covering only H01 and H02 of the 37 demo hospitals). The expanded 23-hospital / 72,040-node / 68.52 MB / 1,577.4 MB peak memory dataset was measured on `phase0/output/bengaluru_coverage_box.graphml` as documented in `docs/PHASE0_REPORT.md`, which the application does not load yet.

Run the automated graph setup script:
```bash
python scripts/setup_graph.py
```

This script ensures `app/data/graph/bengaluru_small_full.graphml` is ready:
1. **Uses the existing target graph** at `app/data/graph/bengaluru_small_full.graphml` if already present and non-empty.
2. **Otherwise, copies `phase0/output/bengaluru_small_full.graphml`** if that file is present.
3. **Otherwise, downloads from OpenStreetMap** using OSMnx for the central Bengaluru bounding box and installs it at the target path.

To force a fresh download directly from OpenStreetMap:
```bash
python scripts/setup_graph.py --download --force
```

*(Note: `*.graphml` files are git-ignored and never committed.)*

---

## Running the Service

Start the FastAPI application with Uvicorn:

```bash
uvicorn app.main:app --reload
```

Once started, the following endpoints are available:

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Interactive Leaflet demo map interface for live route calculation and snapping inspection |
| `/health` | `GET` | Service health status (`{"status": "ok"}`) |
| `/docs` | `GET` | Interactive Swagger API documentation |
| `/api/demo/hospitals` | `GET` | List candidate hospitals situated inside active road graph coverage |
| `/api/demo/route` | `POST` | Calculate shortest road route between patient coordinates and a destination hospital |

> *Note: Phase 4 (ETA & ranking) exists as internal services only and is not wired to any endpoint. Phase 5 (`POST /recommend-hospital`) is not started. Only the endpoints listed above currently exist.*

---

## Running the Tests

The test suite runs entirely offline using synthetic graph fixtures and does not require an internet connection.

Run all tests:
```bash
pytest -v
```

Or run in quiet mode:
```bash
pytest -q
```

Test coverage includes:
- **Graph loader**: Directed multigraph validation, parallel edge collapsing, self-loop removal, and heuristic factor verification.
- **Routing algorithms**: Independent A\* and Dijkstra implementations verified against NetworkX shortest-path ground truth over random trips.
- **Location snapping**: Boundary validation, distance limits, tie-breaking, and hospital location mapping.
- **Demo API & Contract errors**: Validation of `INVALID_COORDINATES`, `INVALID_REQUEST`, `OUT_OF_COVERAGE`, `NO_ROUTE_FOUND`, and `INTERNAL_ERROR`.
- **Phase 4 ETA, ranking & reasons**: Unit tests plus scenario tests (`tests/test_phase4_scenarios.py`) that run the demo hospitals through filter, ETA, ranking and reason sentences using a fixed distance table and a fixed clock. They need no road graph or API.

---

## Current Project Status

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Graph feasibility, bounding box sizing, and OSMnx road-network preparation | **Completed** |
| **Phase 1** | Project skeleton, contract definitions, configuration, error translation, `GET /health` | **Completed** |
| **Phase 2** | Hospital repository, validation, eligibility filtering, and data staleness handling | **Completed** |
| **Phase 3** | Routing engine (snapping, custom A\*, custom Dijkstra, agreement tests, demo map & API) | **Completed** |
| **Phase 4** | Road-distance ETA calculation, hospital ranking and reason sentences (ranking rules P1/P2/P10 provisional) | **Completed** |
| **Phase 5** | Production API endpoint (`POST /recommend-hospital`) and team integration | *Not Started* |
| **Phase 6** | Frontend & UI integration | *Not Started* |
| **Phase 7** | System polish, performance tuning | *Not Started* |
| **Phase 8** | Final documentation and multi-member integration | *Not Started* |

---

## ETA and Ranking Assumptions

**ETA**
- **Formula** (CONTRACT.md section 9): `eta_min = (road_distance_km / average_speed_kmh) * 60`, using the road distance from the routing engine.
- **Speed**: one constant nominal urban ambulance speed, default 30 km/h (`Settings.average_speed_kmh`). There is no live traffic, so every ETA is an estimate.
- **Rounding**: `distance_km` is rounded half up to 2 decimals (for example, 0.125 km becomes 0.13 km). `eta_min` is calculated from the unrounded distance and rounded half up once to 1 decimal (for example, 0.05 min becomes 0.1 min). Calculations use `Decimal` (D1 and D2).
- The unrounded ETA is kept as `raw_eta_min` (not in the API response) so the team can choose to rank on it; see P2.

**Ranking order (as currently implemented)**
1. ETA, smallest first. This uses the **rounded** `eta_min` (1 decimal), the same value the API returns. This is a provisional reading of CONTRACT.md section 8; proposal P2 (rank on unrounded ETA) is still pending team approval.
2. At equal ETA, hospitals with **fresh** bed data rank before hospitals with **stale** bed data (P1, pending team approval). ETA is still checked first, so a stale hospital with a clearly better ETA still ranks first.
3. Among fresh hospitals with equal ETA, more beds available ranks first. **Stale** hospitals' bed counts are ignored, so they are separated only by the tie-breaks below.
4. Then hospital name A to Z, compared ignoring upper/lower case first, then exactly.
5. Finally `hospital_id`, so the same input always gives the same output (P10).

**Reason sentences** follow the wording in CONTRACT.md section 5. Cases the contract sample does not show (no needs, several needs, same ETA as the recommended hospital) are described in [`docs/PROPOSED_EXTENSIONS.md`](docs/PROPOSED_EXTENSIONS.md). Stale bed data is not mentioned in the sentence; the `bed_data_stale` field carries it.

Proposal details and approval status for P1, P2 and P10 are in [`docs/PROPOSED_EXTENSIONS.md`](docs/PROPOSED_EXTENSIONS.md).

---

## Known Limitations

1. **Active Road Graph Coverage**: The application currently loads `app/data/graph/bengaluru_small_full.graphml` (6.47 MB), which covers central Bengaluru and contains only H01 and H02 of the 37 demo hospitals. The expanded coverage box numbers (23 hospitals, 72,040 nodes, 187,464 edges, 68.52 MB, 1,577.4 MB peak memory) were measured on `phase0/output/bengaluru_coverage_box.graphml`, which the application does not load yet. Any coordinates outside the loaded graph coverage return an `OUT_OF_COVERAGE` contract error.
2. **No Live Traffic**: ETAs are calculated assuming a constant nominal urban ambulance speed (default: 30 km/h) without dynamic traffic congestion data.
3. **Demo Data**: Hospital bed availability, specialty sets, and facility operational statuses are simulated values.