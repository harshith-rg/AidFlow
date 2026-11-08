# AidFlow Routing & Hospital Recommendation: Interface Contract

**Status:** DRAFT v0.2 (proposal, open for changes)
**Owner:** Harshith RG (Member 3)
**Reviewers:** Hema (M2, backend/dispatch), Chitte (M1, frontend), Bindu (M4, location)
**Reply deadline:** _<fill in: 2 days from sending>_. If there are no objections by then, v0.2 becomes the working version.

> Prototype scope. Hospital values are **demo data**. ETA is an **estimate** with no live traffic.

---

## 1. Purpose

Given a patient/pickup location and the emergency's needs, this service filters candidate hospitals, computes road distance and estimated ETA to each, ranks them with a fixed rule, and returns the recommended hospital, alternatives, a reason, and the route polyline.

This is the **hospital** ranking. Ambulance ranking is a separate rule owned by M2.

## 2. Conventions (please confirm)

| Item | Proposal |
|---|---|
| Coordinate order | `lat`, `lng` as named JSON fields (never a bare array pair in requests) |
| Polyline points | arrays of `[lat, lng]`, which Leaflet accepts directly |
| Distance unit | kilometres (`distance_km`, rounded to 2 decimals) |
| Duration unit | minutes (`eta_min`, rounded to 1 decimal) |
| Timestamps | ISO 8601 in UTC, e.g. `2026-11-02T10:15:00Z` |
| IDs | strings, e.g. `"H01"` for hospitals, `"C-1042"` for cases |
| Transport | HTTP + JSON (Python service called by the Node backend) |
| Field names | `snake_case` |

## 3. Endpoint

```
POST /recommend-hospital
Content-Type: application/json
```

Optional: `GET /health` returns `{ "status": "ok" }`.

## 4. Request

```json
{
  "case_id": "C-1042",
  "origin": { "lat": 12.9716, "lng": 77.5946 },
  "needs": ["ICU"],
  "candidate_hospital_ids": ["H01", "H02", "H03"],
  "max_alternatives": 2
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `case_id` | string | no | Echoed back for tracing only |
| `origin` | object `{lat, lng}` | yes | Patient pickup or ambulance position. Numbers; lat in [-90, 90], lng in [-180, 180] |
| `needs` | array of string | yes (may be empty) | Capabilities required. Empty means any open hospital |
| `candidate_hospital_ids` | array of string | no | If omitted, all hospitals in the dataset are considered |
| `max_alternatives` | integer | no | Default 2, range 0 to 5 |

**Proposed `needs` vocabulary** (M2 to confirm or replace): `ICU`, `TRAUMA`, `CARDIAC`, `NEURO`, `MATERNITY`, `PAEDIATRIC`, `GENERAL`.

## 5. Success response (HTTP 200)

```json
{
  "case_id": "C-1042",
  "recommended": {
    "hospital_id": "H02",
    "name": "Demo City Hospital",
    "location": { "lat": 12.9352, "lng": 77.6245 },
    "distance_km": 4.5,
    "eta_min": 9.0,
    "reason": "Nearest open hospital with ICU (9.0 min ETA).",
    "bed_data_stale": false
  },
  "alternatives": [
    {
      "hospital_id": "H01",
      "name": "Demo General Hospital",
      "distance_km": 6.5,
      "eta_min": 13.0,
      "reason": "Open with ICU, 4.0 min slower than recommended.",
      "bed_data_stale": false
    }
  ],
  "route": {
    "to_hospital_id": "H02",
    "distance_km": 4.5,
    "eta_min": 9.0,
    "polyline": [[12.9716, 77.5946], [12.9700, 77.5990], [12.9352, 77.6245]]
  },
  "warnings": [],
  "assumptions": {
    "eta_method": "road distance / assumed average speed",
    "average_speed_kmh": 30,
    "live_traffic": false,
    "routing_algorithm": "astar",
    "hospital_data": "DEMO values, not real"
  },
  "generated_at": "2026-11-02T10:15:00Z"
}
```

Notes:
- `route` is always the route to the **recommended** hospital (this is what the map draws and what M4 can move a marker along).
- `warnings` is an array of `{ "code": "...", "message": "..." }`. Example: `STALE_HOSPITAL_DATA` when a hospital's `last_updated` is older than the threshold (bed counts are then ignored for ranking).
- `reason` is a human-readable sentence safe to show in the UI.

## 6. Error response

Same shape for every failure:

```json
{
  "error": {
    "code": "NO_ELIGIBLE_HOSPITAL",
    "message": "No open hospital with ICU among the 3 candidates.",
    "details": {}
  }
}
```

| `code` | HTTP | When |
|---|---|---|
| `INVALID_REQUEST` | 400 | Missing or wrong-typed fields, unknown `needs` value, bad `max_alternatives` |
| `INVALID_COORDINATES` | 400 | `origin` missing, not numeric, or out of range |
| `OUT_OF_COVERAGE` | 422 | `origin` is outside the loaded map area |
| `NO_ELIGIBLE_HOSPITAL` | 422 | Candidate list empty, or every candidate is filtered out |
| `NO_ROUTE_FOUND` | 422 | No road path to any eligible hospital |
| `INTERNAL_ERROR` | 500 | Unexpected failure (never a crash with no body) |

The service never returns a fake or placeholder route. A failure is always an error response.

## 7. Hospital data (demo)

Each hospital record in my dataset:

```json
{
  "hospital_id": "H02",
  "name": "Demo City Hospital",
  "location": { "lat": 12.9352, "lng": 77.6245 },
  "status": "OPEN",
  "specialties": ["ICU", "TRAUMA", "GENERAL"],
  "beds_total": 120,
  "beds_available": 14,
  "icu_beds_available": 3,
  "last_updated": "2026-11-02T09:50:00Z",
  "is_demo": true
}
```

`status` values: `OPEN`, `CLOSED`, `DIVERTED` (not accepting new emergencies).

**Open question for M2:** will hospital status/capacity live in your database (you send it to me, or I read it), or does this service read its own demo file for now? Proposal: my demo file for the prototype, with the same field names so we can swap the source later.

## 8. Ranking rule (hospital ranking, reproducible)

1. **Filter:** keep hospitals where `status == "OPEN"` **and** `specialties` contains every item in `needs`. If `needs` includes `ICU`, also require `icu_beds_available > 0` when the data is fresh.
2. **Compute** road distance and ETA from `origin` to each remaining hospital.
3. **Sort by:** (a) `eta_min` ascending, (b) `beds_available` descending, (c) `name` ascending.
4. **Staleness:** if `now - last_updated` > **60 minutes** (configurable), the hospital stays eligible, but its bed counts are **ignored** (no ICU-bed filter, no bed tie-break), `bed_data_stale` is `true`, and a `STALE_HOSPITAL_DATA` warning is added.
5. Same input and same data always give the same output.

## 9. ETA assumptions

- `eta_min = (road_distance_km / average_speed_kmh) * 60`
- Default `average_speed_kmh = 30` (urban ambulance estimate, configurable, may later vary by road type).
- No live traffic. Responses say so in `assumptions`. The UI should label the value "Estimated ETA".

## 10. Open items

| # | Question | For | Needed by |
|---|---|---|---|
| 1 | OK to call a Python service over HTTP from the Node backend? | Hema | _<date>_ |
| 2 | Confirm or replace the `needs` vocabulary and the status names | Hema | _<date>_ |
| 3 | Hospital data in your DB, or my demo file for now? | Hema | _<date>_ |
| 4 | Is the `route.polyline` format (`[[lat, lng], ...]`) fine for Leaflet? | Chitte | _<date>_ |
| 5 | Agree one map area (city + bounding box) for routing, simulation, and UI | All | _<date>_ |
| 6 | Bindu: is `route.polyline` enough for simulated movement, or do you need per-point timing? | Bindu | _<date>_ |

## 11. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-31 | First draft by Harshith RG |
| 0.2 | 2026-11-08 | Section 5 sample response: distances corrected (4.2 to 4.5 km, 6.1 to 6.5 km) so the sample matches the section 9 ETA formula at 30 km/h. No rule changes. |
