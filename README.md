# AidFlow: Emergency Ambulance Routing & Hospital Recommendation

> **Prototype Notice**  
> All hospital data in this project is fictional **DEMO DATA**.  
> Route durations (ETAs) are **estimates** based on assumed average speeds with **no live traffic data**.  
> The API specification and schema rules are governed by [`CONTRACT.md`](CONTRACT.md) as the single source of truth.

---

## Overview

AidFlow is a smart emergency ambulance response and hospital recommendation system prototype. This repository contains **Member 3 (Harshith RG)**'s module, currently implemented through **Phases 0–3: Road Routing & Network Preparation**.

Features implemented in Phases 0–3:
- **Road network loading & cleanup**: Directed multigraph validation, parallel edge collapsing, self-loop removal, and safe heuristic factor computation stored in an immutable, memory-efficient `RoadGraph` structure.
- **Hospital data management & filtering**: Demo hospital dataset loading, schema validation, operational status checks, emergency specialty filtering, and configurable data staleness detection.
- **Deterministic location snapping**: Snapping GPS coordinates for patient pickup and hospital locations to the nearest road intersection node within coverage boundaries and distance limits.
- **Independent routing algorithms**: Custom implementations of **A\*** (with an admissible, scaled Haversine heuristic) and **Dijkstra** algorithms built from scratch using Python's `heapq`.
- **Algorithm verification**: Agreement tests verifying identical shortest paths and road distances between custom A*, custom Dijkstra, and NetworkX across deterministic synthetic graphs and random trips.
- **Contract-compliant error handling**: Consistent JSON error formatting returning `{"error": {"code", "message", "details"}}` for `INVALID_COORDINATES`, `INVALID_REQUEST`, `OUT_OF_COVERAGE`, `NO_ROUTE_FOUND`, and `INTERNAL_ERROR`.
- **Interactive demo map interface**: Leaflet web interface served at `GET /` to visualize road paths, one-way street asymmetry, intersection nodes, and snapping distances in central Bengaluru.

*(Note: Phase 4 ETA/ranking rules and Phase 5 `POST /recommend-hospital` are not yet implemented.)*

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

> *Note: Phase 4 (ETA & Ranking) and Phase 5 (`POST /recommend-hospital`) are not yet started. Only the endpoints listed above currently exist.*

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

---

## Current Project Status

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Graph feasibility, bounding box sizing, and OSMnx road-network preparation | **Completed** |
| **Phase 1** | Project skeleton, contract definitions, configuration, error translation, `GET /health` | **Completed** |
| **Phase 2** | Hospital repository, validation, eligibility filtering, and data staleness handling | **Completed** |
| **Phase 3** | Routing engine (snapping, custom A\*, custom Dijkstra, agreement tests, demo map & API) | **Completed** |
| **Phase 4** | Road-distance ETA calculation and hospital ranking rules | *Not Started* |
| **Phase 5** | Production API endpoint (`POST /recommend-hospital`) and team integration | *Not Started* |
| **Phase 6** | Frontend & UI integration | *Not Started* |
| **Phase 7** | System polish, performance tuning | *Not Started* |
| **Phase 8** | Final documentation and multi-member integration | *Not Started* |

---

## Known Limitations

1. **Coverage Area**: The service operates within the defined Bengaluru bounding box (e.g. `west 77.52, south 12.90, east 77.68, north 13.04`). Coordinates outside this boundary return an `OUT_OF_COVERAGE` contract error.
2. **No Live Traffic**: ETAs are calculated assuming a constant nominal urban ambulance speed (default: 30 km/h) without dynamic traffic congestion data.
3. **Demo Data**: Hospital bed availability, specialty sets, and facility operational statuses are simulated values.
