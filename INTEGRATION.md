# AidFlow Service Integration Guide

**Module**: Member 3 (Harshith RG) — Emergency Ambulance Routing & Hospital Recommendation
**Specification**: [`CONTRACT.md`](CONTRACT.md) v0.2
**Target Audience**:
- **Hema** (Member 2 — Dispatcher Backend & Core Services)
- **Chitte** (Member 1 — Web Frontend & Operations UI)
- **Bindu** (Member 4 — Ambulance Location & Real-Time Tracking)

---

## 1. Quick Reference & Base Endpoints

- **Local Base URL**: `http://127.0.0.1:8000`
- **Interactive OpenAPI / Swagger Docs**: `http://127.0.0.1:8000/docs`
- **Leaflet Demo UI**: `http://127.0.0.1:8000/`

| HTTP Method | Path | Purpose | Primary Consumer |
|---|---|---|---|
| `GET` | `/health` | Service liveness probe (`{"status":"ok"}`) | Hema, Load Balancer |
| `POST` | `/recommend-hospital` | Production hospital recommendation, alternatives & route | Hema, Chitte |
| `GET` | `/api/demo/hospitals` | List of 23 candidate hospitals inside road coverage | Chitte |
| `POST` | `/api/demo/route` | Point-to-point route calculation (A\* or Dijkstra demo) | Chitte, Bindu |

---

## 2. Integration with Hema (Member 2 — Dispatcher Backend)

### 2.1 Calling the Recommendation Engine

Hema's dispatch service calls `POST /recommend-hospital` whenever an emergency call requires hospital allocation.

#### Request Payload (`RecommendHospitalRequest` — CONTRACT.md §4)

```json
{
  "case_id": "CASE-001",
  "origin": {
    "lat": 12.9716,
    "lng": 77.5946
  },
  "needs": ["ICU"],
  "max_alternatives": 2,
  "candidate_hospital_ids": null
}
```

- `origin` (**required**): Patient pickup coordinates.
  - `lat`: Float in $[-90, 90]$.
  - `lng`: Float in $[-180, 180]$.
  - *Strict Validation*: Booleans, numeric strings, null, and out-of-range floats raise `INVALID_COORDINATES` (HTTP 400).
- `needs` (**required**): Array of string specialties. Empty list `[]` is valid.
  - Allowed vocabulary: `["ICU", "TRAUMA", "CARDIAC", "NEURO", "MATERNITY", "PAEDIATRIC", "GENERAL"]`.
  - Unrecognized or lowercase values raise `INVALID_REQUEST` (HTTP 400).
- `case_id` (*optional*, string or `null`): Echoed back in response if provided.
- `max_alternatives` (*optional*, integer, default `2`): Number of fallback alternatives to return (range: $0$ to $5$).
  - Floats, strings, or booleans raise `INVALID_REQUEST` (HTTP 400).
- `candidate_hospital_ids` (*optional*, array of strings or `null`, default `null`):
  - When `null` or omitted: all operational hospitals are evaluated.
  - When specified: only the given hospital IDs are evaluated.
  - An empty list `[]` returns `NO_ELIGIBLE_HOSPITAL` (HTTP 422).
  - Unknown IDs return `INVALID_REQUEST` (HTTP 400).

#### Response Payload (`RecommendHospitalResponse` — CONTRACT.md §5 — Excerpt)

> **Excerpt Notice**: The full response contains 134 coordinate pairs in `route.polyline`. The response below is shown as a shortened excerpt for display readability.

```json
{
  "case_id": null,
  "recommended": {
    "hospital_id": "H02",
    "name": "Demo Shivajinagar General Hospital",
    "location": {
      "lat": 12.9857,
      "lng": 77.6057
    },
    "distance_km": 2.53,
    "eta_min": 5.1,
    "reason": "Nearest open hospital with ICU (5.1 min ETA).",
    "bed_data_stale": true
  },
  "alternatives": [
    {
      "hospital_id": "H01",
      "name": "Demo Majestic Central Hospital",
      "distance_km": 3.79,
      "eta_min": 7.6,
      "reason": "Open with ICU, 2.5 min slower than recommended.",
      "bed_data_stale": true
    },
    {
      "hospital_id": "H03",
      "name": "Demo Indiranagar Medical Centre",
      "distance_km": 5.83,
      "eta_min": 11.7,
      "reason": "Open with ICU, 6.6 min slower than recommended.",
      "bed_data_stale": true
    }
  ],
  "route": {
    "to_hospital_id": "H02",
    "distance_km": 2.53,
    "eta_min": 5.1,
    "polyline": [
      [12.9720538, 77.594311],
      [12.9720277, 77.5943769],
      [12.9856306, 77.6056916]
    ]
  },
  "warnings": [
    {
      "code": "STALE_HOSPITAL_DATA",
      "message": "Hospital bed counts may be outdated (older than 60 minutes)."
    }
  ],
  "assumptions": {
    "eta_method": "road distance / assumed average speed",
    "average_speed_kmh": 30.0,
    "live_traffic": false,
    "routing_algorithm": "astar",
    "hospital_data": "DEMO values, not real"
  },
  "generated_at": "2026-11-12T16:45:46Z"
}
```

*Key Response Conventions*:
- Top-level recommendation field is named **`recommended`** (CONTRACT.md §5).
- `recommended.reason` is a single human-readable display string (not an array).
- In CONTRACT.md §5, `recommended` includes `location` (`lat`, `lng`), while `alternatives` currently do not (see proposal E1). Neither includes `beds_available` or `locality` in the contract response envelope.
- `route` contains `to_hospital_id`, `distance_km`, `eta_min`, and `polyline` (`[[lat, lng], ...]`).
- `generated_at` is always the real current UTC timestamp in ISO-8601 format.

### 2.2 Error Handling & Status Codes (CONTRACT.md §6)

Every failure returns the contract error shape:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable explanation.",
    "details": {}
  }
}
```

| HTTP Status | Error Code | Trigger Condition |
|---|---|---|
| `400 Bad Request` | `INVALID_COORDINATES` | `origin` is missing, null, not an object, or `lat`/`lng` is missing, not a number, boolean/string, or out of range $[-90, 90]$ / $[-180, 180]$. |
| `400 Bad Request` | `INVALID_REQUEST` | Malformed JSON, missing required fields, unknown or lowercase `needs`, invalid `max_alternatives` (not integer $0..5$), or unknown ID in `candidate_hospital_ids`. |
| `422 Unprocessable` | `OUT_OF_COVERAGE` | Pickup coordinates lie outside the road network coverage area or exceed the 500 m snap limit. |
| `422 Unprocessable` | `NO_ELIGIBLE_HOSPITAL` | No operational hospital meets all requested `needs`, or `candidate_hospital_ids` is an empty list `[]`. |
| `422 Unprocessable` | `NO_ROUTE_FOUND` | Hospitals are eligible, but no directed road path exists from origin to any eligible hospital (e.g., requested candidate is outside the road graph). |
| `500 Server Error` | `INTERNAL_ERROR` | Road graph file missing or corrupted, or unhandled server exception. |

### 2.3 Clock Modes & Staleness Configuration

AidFlow supports two clock modes via the environment variable `AIDFLOW_TIME_MODE`:
1. `AIDFLOW_TIME_MODE=real` (**default**): Reference time is the real UTC current system time. Because demo data is timestamped `2026-10-31`, all hospitals are flagged `bed_data_stale = true`, bed counts are ignored during ranking, and the response carries the `STALE_HOSPITAL_DATA` warning.
2. `AIDFLOW_TIME_MODE=demo`: Reference time freezes to the dataset's `as_of` timestamp (`2026-10-31T14:30:00Z`). In this mode, demo bed data is fresh (`bed_data_stale = false`) and actively used for ranking.
- **Generated At Timestamp**: In both modes, `generated_at` always reports the real current UTC response time.

### 2.4 Decisions Pending Team Approval (with Hema)
- **P1**: Stale data group rule: fresh bed data hospitals break ties before stale hospitals at equal ETA; stale hospital bed counts are treated as 0.
- **P2**: ETA ranking basis: the current implementation provisionally ranks on rounded `eta_min` (1 decimal), matching the literal wording in CONTRACT.md §8 ("sort by `eta_min`"). The proposal to rank on unrounded `raw_eta_min` is pending team approval.
- **P3**: Restrict `STALE_HOSPITAL_DATA` warning strictly to hospitals that appear in the response (recommended + alternatives), rather than all candidates.
- **P4**: Formalize `candidate_hospital_ids: null` to mean "all hospitals", and returning `INVALID_REQUEST` on unknown hospital ID.
- **P7**: Formalize behavior when a hospital lies outside road graph coverage: skip during routing (decision needed on whether to return a warning code).
- **P8**: Formalize error partition: any defect in `origin` yields `INVALID_COORDINATES`; all other parameter defects yield `INVALID_REQUEST`.

---

## 3. Integration with Chitte (Member 1 — Web Frontend & UI)

### 3.1 Map Rendering with Leaflet

The recommendation endpoint returns a ready-to-render polyline for the primary recommended route:
- Format: `route.polyline` is a JSON array of `[lat, lng]` coordinate pairs:
  ```javascript
  const routeCoords = response.route.polyline;
  // Leaflet expects [lat, lng] array format directly:
  const polylineLayer = L.polyline(routeCoords, {
    color: '#e53e3e',
    weight: 5,
    opacity: 0.8
  }).addTo(map);
  map.fitBounds(polylineLayer.getBounds(), { padding: [40, 40] });
  ```

### 3.2 Display Cards & Comparison Sentences

1. **Recommended Hospital Card**:
   - Title: `response.recommended.name`.
   - Key Metrics: `response.recommended.eta_min` (display as "X.X min") and `response.recommended.distance_km` ("X.XX km").
   - Reason badge: Display `response.recommended.reason` (e.g., `"Nearest open hospital with ICU (5.1 min ETA)."`).
   - Marker pin: Placed at `response.recommended.location.lat`, `response.recommended.location.lng`.
2. **Alternative Hospital Cards**:
   - Render `response.alternatives[i]`.
   - Title: `alt.name`.
   - Reason text contains comparative delay: e.g., `"Open with ICU, 2.5 min slower than recommended."`.
   - *Note*: `alternatives` currently omit `location`. If Chitte's team requires pins for alternatives, proposal E1 should be approved.
3. **Mandatory UI Disclosures**:
   - The contract and safety rules mandate prominent display of these notices:
     - **"All hospital data is fictional DEMO DATA."**
     - **"Route durations (ETAs) are estimates based on assumed average speeds with no live traffic data."**
4. **Stale Data Warning Banner**:
   - When `warnings` contains `STALE_HOSPITAL_DATA`, render an amber warning pill or banner:
     `"⚠️ Hospital bed counts may be outdated (older than 60 minutes)."`

### 3.3 Proposals Pending Approval (with Chitte)
- **E1**: Inclusion of `location: {lat, lng}` inside each item in `alternatives` so the frontend can place marker pins for alternative hospitals without an extra lookup.
- **P6**: Explicitly snapping the visual polyline to start at the exact pickup pin and terminate at the hospital entrance pin.
- **P3**: Warning restricted to shown hospitals only.

---

## 4. Integration with Bindu (Member 4 — Ambulance Location & Tracking)

### 4.1 Coordinate Snapping & Coverage Limits

Ambulances report live telemetry `(lat, lng)` from mobile GPS units:
- **Snapping Logic (`snap_to_road`)**: The engine uses a pure-Python pruned linear scan with a latitude lower-bound filter and deterministic lowest-node-ID tie-breaking.
- **Tolerance**: The maximum allowed snapping distance is **500 metres**.
- If an ambulance is reported in an off-road terrain or outside the central Bengaluru bounding box ($12.90^\circ\text{N} - 13.04^\circ\text{N}$, $77.52^\circ\text{E} - 77.68^\circ\text{E}$), the API will reject the request with `OUT_OF_COVERAGE` (HTTP 422).

### 4.2 Ambulance Tracking Simulation Along the Polyline

For vehicle simulation and demo tracking:
1. Obtain the `route.polyline` from `POST /recommend-hospital`.
2. The vehicle position advances along the polyline segments at the nominal speed of $30\text{ km/h}$ ($8.33\text{ m/s}$).
3. When tracking is active, poll or re-route if the ambulance deviates more than $100\text{ metres}$ from the prescribed polyline nodes.

### 4.3 Road Directionality & One-Way Asymmetry

Bindu's tracking module must account for one-way street asymmetry:
- Real urban streets contain divided avenues and one-way restrictions. Never assume reversing a route produces an identical path or distance.
- Dynamic route queries must always be computed in the forward direction: $\text{ambulance\_location} \to \text{hospital\_location}$.

---

## 5. API Command Examples (Verified PowerShell & Example Bash `curl`)

The Windows PowerShell `Invoke-RestMethod` examples below were executed and verified live against the active running AidFlow server (`127.0.0.1:8000`). Equivalent Bash `curl` commands are provided as examples for POSIX environments.

### 5.1 Service Health Check (`GET /health`)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -Method Get
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s http://127.0.0.1:8000/health
```

#### Exact Response (HTTP 200 OK)
```json
{"status":"ok"}
```

---

### 5.2 Hospital Recommendation (Valid Request)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "max_alternatives": 2}'
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "max_alternatives": 2}'
```

#### Exact Response (HTTP 200 OK — Excerpt)

> **Excerpt Notice**: The actual server response returns all 134 coordinate pairs in `route.polyline` (measuring 2,526.4 metres). It is shortened to four representative points in this display excerpt for readability.

```json
{
  "case_id": null,
  "recommended": {
    "hospital_id": "H02",
    "name": "Demo Shivajinagar General Hospital",
    "location": {
      "lat": 12.9857,
      "lng": 77.6057
    },
    "distance_km": 2.53,
    "eta_min": 5.1,
    "reason": "Nearest open hospital with ICU (5.1 min ETA).",
    "bed_data_stale": true
  },
  "alternatives": [
    {
      "hospital_id": "H01",
      "name": "Demo Majestic Central Hospital",
      "distance_km": 3.79,
      "eta_min": 7.6,
      "reason": "Open with ICU, 2.5 min slower than recommended.",
      "bed_data_stale": true
    },
    {
      "hospital_id": "H03",
      "name": "Demo Indiranagar Medical Centre",
      "distance_km": 5.83,
      "eta_min": 11.7,
      "reason": "Open with ICU, 6.6 min slower than recommended.",
      "bed_data_stale": true
    }
  ],
  "route": {
    "to_hospital_id": "H02",
    "distance_km": 2.53,
    "eta_min": 5.1,
    "polyline": [
      [12.9720538, 77.594311],
      [12.9720277, 77.5943769],
      [12.9719217, 77.5946604],
      [12.9856306, 77.6056916]
    ]
  },
  "warnings": [
    {
      "code": "STALE_HOSPITAL_DATA",
      "message": "Hospital bed counts may be outdated (older than 60 minutes)."
    }
  ],
  "assumptions": {
    "eta_method": "road distance / assumed average speed",
    "average_speed_kmh": 30.0,
    "live_traffic": false,
    "routing_algorithm": "astar",
    "hospital_data": "DEMO values, not real"
  },
  "generated_at": "2026-11-12T16:45:46Z"
}
```

---

### 5.3 Error Case: Invalid Coordinates (HTTP 400)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 95.0, "lng": 77.5946}, "needs": ["ICU"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 95.0, "lng": 77.5946}, "needs": ["ICU"]}'
```

#### Exact Response (HTTP 400 Bad Request)
```json
{
  "error": {
    "code": "INVALID_COORDINATES",
    "message": "lat must be between -90 and 90, but got 95.0.",
    "details": {
      "origin": {
        "lat": 95.0,
        "lng": 77.5946
      }
    }
  }
}
```

---

### 5.4 Error Case: Out of Coverage Area (HTTP 422)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 13.5, "lng": 77.5946}, "needs": ["ICU"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 13.5, "lng": 77.5946}, "needs": ["ICU"]}'
```

#### Exact Response (HTTP 422 Unprocessable Entity)
```json
{
  "error": {
    "code": "OUT_OF_COVERAGE",
    "message": "Coordinates (13.5, 77.5946) lie outside the road network coverage area (south=12.9000011, north=13.04, west=77.5200018, east=77.6799877).",
    "details": {
      "origin": {
        "lat": 13.5,
        "lng": 77.5946
      }
    }
  }
}
```

---

### 5.5 Error Case: Unknown Specialty Need (HTTP 400)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["DENTISTRY"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["DENTISTRY"]}'
```

#### Exact Response (HTTP 400 Bad Request)
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Unknown need 'DENTISTRY'. Allowed needs: ['CARDIAC', 'GENERAL', 'ICU', 'MATERNITY', 'NEURO', 'PAEDIATRIC', 'TRAUMA'].",
    "details": {
      "needs": [
        "DENTISTRY"
      ],
      "unknown_need": "DENTISTRY"
    }
  }
}
```

---

### 5.6 Error Case: Empty Candidate Hospital List (HTTP 422)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": []}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": []}'
```

#### Exact Response (HTTP 422 Unprocessable Entity)
```json
{
  "error": {
    "code": "NO_ELIGIBLE_HOSPITAL",
    "message": "Candidate hospital list is empty.",
    "details": {
      "candidate_hospital_ids": []
    }
  }
}
```

---

### 5.7 Error Case: Impossible Specialty Combination (HTTP 422)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["TRAUMA", "PAEDIATRIC", "CARDIAC"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["TRAUMA", "PAEDIATRIC", "CARDIAC"]}'
```

#### Exact Response (HTTP 422 Unprocessable Entity)
```json
{
  "error": {
    "code": "NO_ELIGIBLE_HOSPITAL",
    "message": "No open hospital with TRAUMA, PAEDIATRIC, CARDIAC found among 37 candidates.",
    "details": {
      "needs": [
        "TRAUMA",
        "PAEDIATRIC",
        "CARDIAC"
      ],
      "candidate_count": 37
    }
  }
}
```

---

### 5.8 Error Case: Candidate Outside Road Network (HTTP 422)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": ["H37"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": ["H37"]}'
```

#### Exact Response (HTTP 422 Unprocessable Entity)
```json
{
  "error": {
    "code": "NO_ROUTE_FOUND",
    "message": "No road path found from origin to any eligible hospital.",
    "details": {
      "eligible_hospital_ids": [
        "H37"
      ]
    }
  }
}
```

---

### 5.9 Error Case: Unknown Candidate Hospital ID (HTTP 400)

#### Windows PowerShell (Verified: `Invoke-RestMethod`)
```powershell
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/recommend-hospital" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": ["H99"]}'
} catch {
  $_.ErrorDetails.Message
}
```

#### Bash / Linux / macOS (Example: `curl`)
```bash
curl -s -X POST http://127.0.0.1:8000/recommend-hospital \
  -H "Content-Type: application/json" \
  -d '{"origin": {"lat": 12.9716, "lng": 77.5946}, "needs": ["ICU"], "candidate_hospital_ids": ["H99"]}'
```

#### Exact Response (HTTP 400 Bad Request)
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Unknown candidate hospital ID 'H99'.",
    "details": {
      "candidate_hospital_ids": [
        "H99"
      ],
      "unknown_id": "H99"
    }
  }
}
```

---

### 5.10 Error Case: Internal Server Error (HTTP 500)

*Condition*: Triggered when the road network GraphML file is missing or corrupted, or if an unhandled server exception occurs (`app/api/errors.py::handle_unexpected_error` and `app/api/routes.py`).

*Verified Response Envelope (HTTP 500 Internal Server Error)*:
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Road graph is not available. Please run scripts/setup_graph.py first.",
    "details": {}
  }
}
```
*Verification Evidence*: Verified by regression test `tests/test_recommend_hospital.py::test_recommend_internal_error_when_graph_missing`.

---

## 6. Test Evidence & Regression Record

Test suites are decoupled so unit tests pass on a fresh repository clone without downloading large binary graph files:

### 6.1 Historical Run Results (Recorded from Dedicated Branch Runs)

> **Note**: These historical results are recorded from their respective branch verification runs and are not claimed to have been re-run on `main`.

1. **Full Test Suite (Recorded on Phase 7 Branch)**:
   - Command: `pytest`
   - Result: **703 passed, 44 skipped** (graph-independent synthetic mocks, contract validators, edge-case scenarios).
   - Skips: 44 real-map integration tests that require the local GraphML file.
2. **Real-Map Road Network Tests (Recorded Opt-In Run)**:
   - Command: `pytest -m real_map`
   - Result: **44 passed** (verifies end-to-end snapping, A\* routing, and NetworkX agreement on `bengaluru_coverage_box.graphml`).
3. **UI & Demonstration Endpoint Tests**:
   - Command: `pytest tests/test_ui_behavior.py`
   - Result: **14 passed** (validates Leaflet map HTML serving, static assets, demo hospital queries, and route calculations).

### 6.2 Known Deprecation Warnings

During execution of the test suite with Starlette / FastAPI, the following warning is emitted:
- `StarletteDeprecationWarning`: `starlette.testclient.TestClient` relies on `httpx` client transport semantics that will deprecate passing `app=` directly in upcoming major versions. This is an upstream Starlette/HTTPX library notice that does not affect runtime reliability or test outcomes.

---

## 7. Summary of Items Requiring Team Alignment

The following provisional behaviors and extensions are currently implemented or proposed, and await whole-team alignment:

| Item | Topic | Current Behavior | Proposed Alignment |
|---|---|---|---|
| **P1** | Stale Data Ranking | Fresh hospitals break ties before stale hospitals at equal ETA. Stale bed counts replaced by 0. | Formal approval by Hema, Chitte, Bindu. |
| **P2** | ETA Ranking Basis | Sorted on rounded `eta_min` (1 decimal), matching CONTRACT.md §8 literal definition. | Whole-team decision on whether to adopt proposal P2 (rank on unrounded `raw_eta_min`). |
| **P3** | Stale Warning Scope | `STALE_HOSPITAL_DATA` issued only if recommended or alternative is stale. | Formal approval by Hema & Chitte. |
| **P4** | Candidate Filtering | `candidate_hospital_ids: null` evaluates all; unknown ID raises 400. | Formal approval by Hema. |
| **P7** | Out-of-Graph Hospitals | 14 out-of-boundary hospitals are skipped silently. | Decide whether a warning code (e.g. `HOSPITAL_OUT_OF_COVERAGE`) should be returned. |
| **P8** | Error Code Division | Origin problems yield `INVALID_COORDINATES`; other invalid inputs yield `INVALID_REQUEST`. | Formal approval by Hema. |
| **E1** | Alternative Locations | Alternatives currently omit `location`. | Add optional `location: {lat, lng}` to `AlternativeHospital` for Chitte's map markers. |
| **E4** | Clock Mode in Assumptions | Assumptions currently omit the active clock mode. | Add `reference_time_mode` to `AssumptionsDetail`. |
