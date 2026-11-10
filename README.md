# AidFlow: Emergency Ambulance Routing & Hospital Recommendation

> **Prototype Notice**  
> All hospital data in this project is fictional **DEMO DATA**.  
> Route durations (ETAs) are **estimates** based on assumed average speeds with **no live traffic data**.  
> The API specification and schema rules are governed by [`CONTRACT.md`](CONTRACT.md) as the single source of truth.

---

## Overview

AidFlow is a smart emergency ambulance response and hospital recommendation system prototype. This repository contains **Member 3 (Harshith RG)**'s module, currently implemented through **Phases 0–5: Road Routing, ETA Calculation, Hospital Ranking & the `POST /recommend-hospital` endpoint**.

Features implemented in Phases 0–5:
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

- **Hospital recommendation endpoint**: `POST /recommend-hospital` filters hospitals, routes to each eligible one with A\*, then returns the best hospital, alternatives, route polyline, warnings and assumptions as specified in CONTRACT.md sections 4 to 6 (`app/api/routes.py`). See "Recommend Hospital Endpoint" below.

*(Note: Several Phase 5 behaviours are provisional proposals awaiting team approval: P3, P4, P7 and P8. See "Recommend Hospital Endpoint" and [`docs/PROPOSED_EXTENSIONS.md`](docs/PROPOSED_EXTENSIONS.md).)*

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

The service uses the expanded Bengaluru road network in GraphML format at `app/data/graph/bengaluru_coverage_box.graphml` (68.52 MB, covering 23 of 37 demo hospitals: H01–H15, H17, H20, H24, H25, H27, H29, H32, H34; 72,040 nodes, 187,464 directed edges).

> **Active Graph Configuration**: The application configures `app/data/graph/bengaluru_coverage_box.graphml` as its active graph and preloads it into memory at server startup so incoming requests do not pay the graph-load delay. If the file is missing, the server still starts cleanly and routing endpoints return the contract-specified HTTP 500 `INTERNAL_ERROR` naming `scripts/setup_graph.py`.

Run the automated graph setup script on a fresh clone:
```bash
python scripts/setup_graph.py
```

This script ensures `app/data/graph/bengaluru_coverage_box.graphml` is ready:
1. **Uses the existing target graph** at `app/data/graph/bengaluru_coverage_box.graphml` if already present and non-empty.
2. **Otherwise, copies `phase0/output/bengaluru_coverage_box.graphml`** if that file is present.
3. **Otherwise, downloads from OpenStreetMap** using OSMnx for the expanded Bengaluru coverage box (`west=77.52, south=12.90, east=77.68, north=13.04`) and installs it at the target path. This needs internet access, takes several minutes and about 1.5 GB of memory. A copy from `phase0/output/` leaves the source file untouched.

Files are written under a temporary name (`*.graphml.part`) and renamed only when complete, so an interrupted run never leaves a half-written graph.

To force a fresh download directly from OpenStreetMap:
```bash
python scripts/setup_graph.py --download --force
```

*(Note: `*.graphml` and `*.graphml.part` files are git-ignored and never committed, so a fresh clone has no graph until you run the setup script. Road data is (c) OpenStreetMap contributors, ODbL.)*

**Settings for the graph** (environment variables, all optional):

| Variable | Default | Meaning |
|---|---|---|
| `AIDFLOW_PRELOAD_GRAPH` | `true` | Load the graph when the server starts. `false` loads it on the first request instead, which then takes 20 to 80 s. |
| `AIDFLOW_GRAPH_PATH` | the default file above | Load a different GraphML file. The setup script always installs the default file. |

---

## Running the Service

Start the FastAPI application with Uvicorn:

```bash
uvicorn app.main:app --reload
```

**Startup:** the server loads the road graph once before it accepts requests, so the first request is not slow. This takes about 20 to 80 seconds. The console shows `Preloading the road graph...` and then `Road graph preloaded in ... s`. With `--reload`, every code change restarts the server and reloads the graph.

**If the graph is missing or unreadable**, the server still starts and logs `Road graph could not be loaded at server startup`. `GET /health` keeps working, and every endpoint that needs the graph returns the contract error `INTERNAL_ERROR` (HTTP 500) with `{"error": {"code", "message", "details"}}`. Request problems (for example bad coordinates) still get their own 400 error. After you install the graph, the next request loads it, with no restart needed.

Once started, the following endpoints are available:

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Interactive Leaflet demo map interface for live route calculation and snapping inspection |
| `/health` | `GET` | Service health status (`{"status": "ok"}`) |
| `/docs` | `GET` | Interactive Swagger API documentation |
| `/recommend-hospital` | `POST` | Recommend the best hospital for a patient pickup point (CONTRACT.md sections 4 to 6) |
| `/api/demo/hospitals` | `GET` | List candidate hospitals situated inside active road graph coverage |
| `/api/demo/route` | `POST` | Calculate shortest road route between patient coordinates and a destination hospital |

> *Note: The `/api/demo/*` endpoints and the map at `/` are Phase 3 demo tools. `POST /recommend-hospital` is the contract endpoint other modules should call.*

---

## Recommend Hospital Endpoint

`POST /recommend-hospital` follows [`CONTRACT.md`](CONTRACT.md) (v0.2), which stays the source of truth for fields and error codes.

**How it works**
1. Validates the request, then loads the road graph and snaps the pickup point to the nearest road.
2. Keeps only hospitals that are open and offer every requested need. If `ICU` is requested, a hospital with fresh bed data must also have at least one ICU bed; stale bed counts are not used for this check (CONTRACT.md section 8).
3. Finds a road route to each eligible hospital with A\*, converts the distance to `distance_km` and `eta_min`, and ranks the hospitals (see "ETA and Ranking Assumptions").
4. Returns the best hospital as `recommended`, up to `max_alternatives` others (default 2, allowed 0 to 5), the route to the recommended hospital, `warnings`, `assumptions` and `generated_at`.

**Request** (`needs` is required, may be empty, and uses upper-case names such as `ICU`)
```json
{
  "case_id": "CASE-001",
  "origin": { "lat": 12.9716, "lng": 77.5946 },
  "needs": ["ICU"],
  "candidate_hospital_ids": null,
  "max_alternatives": 2
}
```
`case_id`, `candidate_hospital_ids` and `max_alternatives` are optional.

**Example call** (demo clock, see "Demo clock" below)

macOS / Linux:
```bash
AIDFLOW_TIME_MODE=demo uvicorn app.main:app --port 8000

curl -s -X POST http://localhost:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"]}'
```

Windows (PowerShell):
```powershell
$env:AIDFLOW_TIME_MODE = "demo"
uvicorn app.main:app --port 8000

# In a second terminal:
Invoke-RestMethod -Method Post -Uri http://localhost:8000/recommend-hospital `
  -ContentType "application/json" `
  -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"]}'
```

**Response shape.** The block below is an **abbreviated outline, not valid JSON**: values in `<angle brackets>` are placeholders for values left out here. The numbers come from a live demo-mode run with the active graph. For a complete, valid response, run the example call above.
```text
{
  "case_id": null,
  "recommended": {
    "hospital_id": "H02", "name": <hospital name>, "location": { "lat": <number>, "lng": <number> },
    "distance_km": 2.53, "eta_min": 5.1, "reason": <sentence>, "bed_data_stale": false
  },
  "alternatives": [
    { "hospital_id": "H01", "name": <hospital name>, "distance_km": 3.79, "eta_min": 7.6,
      "reason": <sentence>, "bed_data_stale": false }
  ],
  "route": { "to_hospital_id": "H02", "distance_km": 2.53, "eta_min": 5.1, "polyline": <list of [lat, lng] points> },
  "warnings": [],
  "assumptions": {
    "eta_method": "road distance / assumed average speed", "average_speed_kmh": 30,
    "live_traffic": false, "routing_algorithm": "astar", "hospital_data": "DEMO values, not real"
  },
  "generated_at": "2026-11-09T06:49:11Z"
}
```
`generated_at` is always the real current UTC time, in both clock modes.

**Errors** (all use `{"error": {"code", "message", "details"}}`)

| Code | HTTP | When |
|---|---|---|
| `INVALID_COORDINATES` | 400 | `origin` is missing, null, not an object, or `lat`/`lng` is missing, not a number (strings and booleans are rejected) or out of range |
| `INVALID_REQUEST` | 400 | Malformed JSON, missing or wrong-typed fields, unknown or lower-case need, `max_alternatives` not an integer from 0 to 5, unknown hospital ID in `candidate_hospital_ids` |
| `OUT_OF_COVERAGE` | 422 | The pickup point is outside the loaded road graph |
| `NO_ELIGIBLE_HOSPITAL` | 422 | No hospital passes the filters, or `candidate_hospital_ids` is an empty list |
| `NO_ROUTE_FOUND` | 422 | Hospitals are eligible but none can be reached by road |
| `INTERNAL_ERROR` | 500 | For example, the road graph file is missing (run `python scripts/setup_graph.py`) |

Request fields are validated before the road graph is loaded, so a bad request returns its own error even when the graph is missing or the pickup point is outside coverage.

**Provisional behaviour (pending team approval)**

The endpoint already behaves as follows, but these rules are not in CONTRACT.md. They are proposals in [`docs/PROPOSED_EXTENSIONS.md`](docs/PROPOSED_EXTENSIONS.md) and may change.

| ID | Current behaviour |
|---|---|
| P3 | `STALE_HOSPITAL_DATA` is returned only when the recommended hospital or a shown alternative has stale data. The warning does **not** yet list the hospital IDs. |
| P4 | `candidate_hospital_ids: null` (or omitted) means all hospitals. An unknown ID returns `INVALID_REQUEST`. Duplicate IDs are ignored. |
| P7 | A hospital outside the loaded road graph, or with no road route, is skipped. **No warning is returned**, so the caller cannot tell it was skipped. |
| P8 | Any problem with `origin` returns `INVALID_COORDINATES`; every other bad field returns `INVALID_REQUEST`. |

P1, P2 and P10 (ranking) are also still pending approval; see "ETA and Ranking Assumptions".

**Demo clock.** Bed data counts as stale when it is older than 60 minutes (`AIDFLOW_STALE_AFTER_MINUTES`) compared with a reference time:
- `AIDFLOW_TIME_MODE=real` (**default**): the reference time is the real current time. The demo dataset is dated 2026-10-31T14:30Z, so every demo hospital is stale. Bed counts are then ignored in the ICU-bed check and in ranking, and responses carry `STALE_HOSPITAL_DATA` with `bed_data_stale: true`.
- `AIDFLOW_TIME_MODE=demo`: the reference time is the dataset's own `as_of` time, so the demo hospitals are fresh and bed counts are used. Use this for demonstrations.

The response does not yet say which clock mode was used (proposal E4).

---

## Browser UI

Open <http://127.0.0.1:8000/> after the service has started (the first page load does not need the road graph; routing does). The UI is plain HTML, CSS and JavaScript in `app/static/` and is served by the same FastAPI app, so there is no build step. Leaflet and the map tiles load from the internet.

- **Recommend:** choose a pickup (landmark button, latitude/longitude, click or drag the pin on the map), tick the needs, and press "Find hospital & route". It shows the recommended hospital, the alternatives, the warnings, and draws the returned route on the map. Click an alternative to see its route.
- **Route preview:** moves a marker along the returned `route.polyline` with play, pause, replay, a position slider and a speed button. It is a simulation of the route, **not** a vehicle position, and nothing is dispatched. "Reduce motion" (or the operating-system setting) skips the animation and shows the whole route.
- **Hospitals:** search, filter by specialty, sort, and open details for the demo hospitals inside the loaded map coverage. "Estimate route from pickup" uses `POST /recommend-hospital` with `candidate_hospital_ids`.
- **Overview:** counts and specialty coverage from the hospital list, and the latest recommendation.
- Light and dark mode (follows the system at first, then remembers your choice), a responsive layout for phones and laptops, and a "DEMO DATA" and "Estimated ETA, live traffic not used" notice that is always visible.

The UI calls only `GET /health`, `GET /api/demo/hospitals` and `POST /recommend-hospital`. Hospital status, last-update time and the hospitals outside the map coverage are not shown, because no endpoint returns them (proposals E2 and E3 in `docs/PROPOSED_EXTENSIONS.md`). `tests/test_ui.py` checks the page is served, keeps its labels, and uses only those endpoints.

## Running the Tests

The test suite runs entirely offline using synthetic graph fixtures and does not require an internet connection. The one exception is a routing-agreement test that needs the real Bengaluru graph file; it is skipped automatically when that file is not present.

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
- **Phase 5 endpoint**: `tests/test_recommend_hospital.py` calls `POST /recommend-hospital` against an in-memory synthetic road graph (no `.graphml` file needed). It covers the response shape, `max_alternatives` limits, candidate IDs, strict coordinate and number validation, validation before graph loading, the error codes, the stale warning in both clock modes, and `generated_at` being the real current time.
- **Phase 6 startup and setup**: `tests/test_startup_graph.py` runs the real app and checks that the graph loads once at startup, that a missing or unreadable graph does not stop the service (500 `INTERNAL_ERROR` in the contract shape, `/health` still works, bad requests keep their own error), that installing the graph later needs no restart, and the two graph settings. `tests/test_setup_graph.py` checks the setup script (keep, copy, download fallback, no partial files, source never changed) and that no `.graphml` file is tracked by git. Both use temporary fake files only.
- **Real-map scenarios (opt-in)**: `tests/test_real_map_scenarios.py` runs `POST /recommend-hospital` on the real larger graph. It is skipped by default because loading the graph takes 20 to 80 seconds. To run it (Windows Command Prompt): `set AIDFLOW_RUN_REAL_MAP_TESTS=1` then `pytest tests\test_real_map_scenarios.py -v`.

---

## Current Project Status

| Phase | Description | Status |
|---|---|---|
| **Phase 0** | Graph feasibility, bounding box sizing, and OSMnx road-network preparation | **Completed** |
| **Phase 1** | Project skeleton, contract definitions, configuration, error translation, `GET /health` | **Completed** |
| **Phase 2** | Hospital repository, validation, eligibility filtering, and data staleness handling | **Completed** |
| **Phase 3** | Routing engine (snapping, custom A\*, custom Dijkstra, agreement tests, demo map & API) | **Completed** |
| **Phase 4** | Road-distance ETA calculation, hospital ranking and reason sentences (ranking rules P1/P2/P10 provisional) | **Completed** |
| **Phase 5** | Production API endpoint (`POST /recommend-hospital`); P3, P4, P7 and P8 behaviours provisional, team integration still to do | **Endpoint completed** (merged to `main`) |
| **Phase 6** | Frontend & UI integration | **UI built, in review** (Recommend, Hospitals, Overview, map and route preview) |
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

Proposal details and approval status for P1, P2 and P10 (ranking) and for P3, P4, P7 and P8 (endpoint) are in [`docs/PROPOSED_EXTENSIONS.md`](docs/PROPOSED_EXTENSIONS.md).

---

## Known Limitations

1. **Active Road Graph Coverage**: The application loads the larger measured Bengaluru road graph (`app/data/graph/bengaluru_coverage_box.graphml`, 68.52 MB), which covers 23 of the 37 demo hospitals. The remaining 14 demo hospitals (H16, H18, H19, H21, H22, H23, H26, H28, H30, H31, H33, H35, H36, H37) lie outside the graph boundary. Any pickup coordinates outside this coverage area return an `OUT_OF_COVERAGE` contract error (422), and hospitals outside coverage are skipped during routing (or return `NO_ROUTE_FOUND` if only those hospitals are requested).
2. **Server Startup Preload and Request Performance**: The graph (72,040 nodes, 187,464 edges, 68.52 MB) is loaded once at startup. Load time was 20.1 s, 23.1 s, 26.8 s and 78.1 s on different runs, with peak memory about 1.4 to 1.6 GB (1,362 to 1,577 MB). Once it is loaded, `POST /recommend-hospital` was measured with `python scripts\measure_recommend.py --graph <graph file>` (15 requests, 5 pickup points, demo clock, 0 failures): typical 1.4 s, slowest 4.0 s. Every request routes to every eligible hospital, so this suits a single-user demo, not many simultaneous callers.
3. **Demo Clock**: With the default `AIDFLOW_TIME_MODE=real`, every demo hospital counts as stale because the dataset is dated 2026-10-31, so ranking ignores bed counts and every response carries `STALE_HOSPITAL_DATA`. Run with `AIDFLOW_TIME_MODE=demo` for demonstrations.
4. **No Live Traffic**: ETAs are calculated assuming a constant nominal urban ambulance speed (default: 30 km/h) without dynamic traffic congestion data.
5. **Demo Data**: Hospital bed availability, specialty sets, and facility operational statuses are simulated values.