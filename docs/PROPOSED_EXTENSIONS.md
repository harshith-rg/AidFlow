# Proposed extensions (NOT in CONTRACT.md)

CONTRACT.md stays authoritative and unchanged. Every item below is only a proposal until the named person approves it.

| ID | Proposal | Approver | Status |
|---|---|---|---|
| E1 | Optional `location` field on each item in `alternatives` | Hema, Chitte | Proposed |
| E2 | `GET /hospitals` (demo UI only) | Hema | Proposed |
| E3 | `GET /hospitals/{id}` (demo UI only) | Hema | Proposed |
| E4 | `reference_time_mode` and `reference_time` in `assumptions` | Hema, Chitte | Proposed |
| P1 | Stale tie-break "group rule" | Whole team | Proposed |
| P2 | Rank on unrounded ETA, round only for display | Whole team | Proposed |
| P3 | `STALE_HOSPITAL_DATA` only for stale hospitals shown in the response, with the hospital ID | Hema, Chitte | Proposed |
| P4 | `candidate_hospital_ids: null` means all hospitals; unknown ID gives `INVALID_REQUEST` | Hema | Proposed |
| P5 | `OUT_OF_COVERAGE` also when origin is about 500 m or more from any road | All | Proposed |
| P6 | Polyline starts/ends at exact pickup and hospital points; distance counts road edges only | Chitte, Bindu | Proposed |
| P7 | Hospital outside the graph is skipped with a new warning code | Hema, Chitte | Proposed |
| P8 | Any problem inside `origin` gives `INVALID_COORDINATES`; everything else `INVALID_REQUEST` | Hema | Proposed (not implemented) |
| P9 | New codes `NOT_FOUND` (404) and `METHOD_NOT_ALLOWED` (405) | Whole team | Proposed (implemented as harmless extras) |

Confirmed in Phase 1 (not extensions): malformed JSON gives `INVALID_REQUEST`, HTTP 400.
