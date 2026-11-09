# Proposed extensions (NOT in CONTRACT.md)

CONTRACT.md stays authoritative and unchanged. Every item below is only a proposal until the named person approves it.

| ID | Proposal | Approver | Status |
|---|---|---|---|
| E1 | Optional `location` field on each item in `alternatives` | Hema, Chitte | Proposed |
| E2 | `GET /hospitals` (demo UI only) | Hema | Proposed |
| E3 | `GET /hospitals/{id}` (demo UI only) | Hema | Proposed |
| E4 | `reference_time_mode` and `reference_time` in `assumptions` | Hema, Chitte | Proposed |
| P1 | Stale tie-break "group rule" | Whole team | Pending approval (provisionally implemented, see notes below) |
| P2 | Rank on unrounded ETA, round only for display | Whole team | Pending approval (current implementation provisionally ranks on rounded `eta_min`, see notes below) |
| P3 | `STALE_HOSPITAL_DATA` only for stale hospitals shown in the response, with the hospital ID | Hema, Chitte | Pending approval (provisionally implemented in Phase 5 without the hospital ID, see notes below) |
| P4 | `candidate_hospital_ids: null` means all hospitals; unknown ID gives `INVALID_REQUEST` | Hema | Pending approval (provisionally implemented in Phase 5, see notes below) |
| P5 | `OUT_OF_COVERAGE` also when origin is about 500 m or more from any road | All | Proposed |
| P6 | Polyline starts/ends at exact pickup and hospital points; distance counts road edges only | Chitte, Bindu | Proposed |
| P7 | Hospital outside the graph is skipped with a new warning code | Hema, Chitte | Pending approval (skipping is provisionally implemented in Phase 5; the new warning code is not, see notes below) |
| P8 | Any problem inside `origin` gives `INVALID_COORDINATES`; everything else `INVALID_REQUEST` | Hema | Pending approval (provisionally implemented in Phase 5, see notes below) |
| P9 | New codes `NOT_FOUND` (404) and `METHOD_NOT_ALLOWED` (405) | Whole team | Proposed (implemented as harmless extras) |
| P10 | Final deterministic tie-break on `hospital_id` when ETA, beds and name all tie | Whole team | Pending approval (provisionally implemented in Phase 4) |

Confirmed in Phase 1 (not extensions): malformed JSON gives `INVALID_REQUEST`, HTTP 400.

## Phase 4 notes on the ranking proposals

**P1 (pending approval).** ETA decides first, so a stale hospital with a clearly better ETA still ranks first. Only among hospitals with the same ETA do fresh-data hospitals come first (beds, then name), followed by stale-data hospitals (name only, because their beds are ignored). The alternative "skip the bed step if either hospital is stale" is not used because it can give a circular order that depends on input order. Tests pin this behaviour in `tests/test_phase4_scenarios.py` (Scenario 5); change them if the team decides differently.

**P2 (pending approval).** The proposal is to rank on the unrounded ETA and round only for display. CONTRACT.md section 8 says "sort by `eta_min`", which is the rounded field, so `hospital_ranking.py` currently ranks on the rounded `eta_min` as a provisional literal reading (`EtaBasis.ROUNDED`, the default). `EtaBasis.UNROUNDED` is also implemented and needs `raw_eta_min`. `distance_eta.py` keeps `raw_eta_min` on its result so that the unrounded option stays available if the team approves it. Switching is a change to the default basis in `hospital_ranking.py` plus the ranking tests that pin the rounded behaviour.

**P10 (pending approval): deterministic tie-break.** CONTRACT.md section 8, step 5 requires that the same input always gives the same output. The contract does not say which field breaks a complete tie, so the implementation uses `hospital_id` as the final key. The full sort key is: ETA, freshness group (fresh before stale), beds descending (0 for stale), name ignoring case, name exactly, `hospital_id`. Two candidates with the same `hospital_id` in one ranking call are rejected with a `ValueError`. The name comparison (ignoring case first, then exact) is an implementation detail so that "alpha" and "Alpha" always sort the same way.

## Phase 5 notes on the endpoint proposals

`POST /recommend-hospital` (`app/api/routes.py`) already behaves as described below. None of these four items is in CONTRACT.md or approved yet, so each may change. Tests pin the current behaviour in `tests/test_recommend_hospital.py`; update them if the team decides differently.

**P3 (pending approval, partly implemented).** The `STALE_HOSPITAL_DATA` warning is added only when the recommended hospital or one of the shown alternatives has stale bed data; stale hospitals that are not shown do not trigger it. The proposal also asks for the hospital ID in the warning. That part is **not implemented**: the warning has a code and a message only, so the caller must read `bed_data_stale` on each hospital to see which one is stale.

**P4 (pending approval).** `candidate_hospital_ids` set to `null` or omitted means all hospitals. An ID that is not in the dataset returns `INVALID_REQUEST` (HTTP 400). Duplicate IDs are removed. An empty list returns `NO_ELIGIBLE_HOSPITAL` (HTTP 422). IDs are checked before the road graph is loaded.

**P7 (pending approval, partly implemented).** A hospital whose location is outside the loaded road graph, or that has no road route from the pickup point, is skipped and the remaining hospitals are ranked. If none remain, the response is `NO_ROUTE_FOUND`. The proposed new warning code is **not implemented**, so a skipped hospital is invisible to the caller. This matters because the active graph (the larger 68.52 MB coverage box) contains only 23 of the 37 demo hospitals: the other 14, for example the deliberately out-of-area H37, are always skipped without notice. The team should decide whether a skipped hospital needs a warning code.

**P8 (pending approval).** Any problem with `origin` returns `INVALID_COORDINATES` (HTTP 400): origin missing, null or not an object; `lat` or `lng` missing, null, not a number, a numeric string or a boolean; or a value out of range. Every other missing or wrong-typed field returns `INVALID_REQUEST` (HTTP 400). `max_alternatives` is strict as well: only an integer from 0 to 5 is accepted (a string, float or boolean is rejected), and `null` means the default of 2.

**Related Phase 5 behaviour (no proposal needed).**
- `generated_at` is always the real current UTC time, in both clock modes. The clock mode only decides whether bed data counts as stale.
- With the default `AIDFLOW_TIME_MODE=real`, all demo hospitals are stale because the dataset is dated 2026-10-31T14:30Z. With `AIDFLOW_TIME_MODE=demo` the dataset's own `as_of` time is the reference, so the demo hospitals are fresh. The response does not report the mode; that is proposal E4.
- Request fields are validated before the road graph is loaded. The pickup point is snapped to the road after that, so `OUT_OF_COVERAGE` can only appear for an otherwise valid request.

## Phase 4 implementation decisions (inside CONTRACT.md section 9, not changes to it)

- **D1: ETA from the unrounded distance.** `eta_min` is calculated from the exact road distance and rounded once; `distance_km` is not rounded first, so rounding errors never add up.
- **D2: Round half up.** `distance_km` is shown to 2 decimals (0.125 km becomes 0.13 km), and `eta_min` to 1 decimal (0.05 min becomes 0.1 min). For example, at 40 km/h, 4.5 km is 6.75 min, shown as 6.8.

## Reason sentence wording (display text)

The recommended and alternative sentences follow the sample in CONTRACT.md section 5 (for example `Nearest open hospital with ICU (9.0 min ETA).` and `Open with ICU, 4.0 min slower than recommended.`). Cases the sample does not show are display text only and should not be parsed by other modules:

- No needs: `Nearest open hospital (6.0 min ETA).` and `Open hospital, 3.0 min slower than recommended.` (Scenario 3).
- Same ETA as the recommended hospital: `Open with ICU, same ETA as recommended.` (Scenario 4).
- "N min slower" is the difference between the two displayed (rounded) ETAs, so the numbers on screen always add up. At 40 km/h this gives 7.5 - 6.8 = 0.7, not 0.75 (Scenario 9).
- Stale bed data is not mentioned in the sentence; the `bed_data_stale` field and the `STALE_HOSPITAL_DATA` warning carry it (Scenario 5).
- Several needs: `with ICU and TRAUMA`, `with ICU, TRAUMA and CARDIAC`, in request order with duplicates removed. This is implemented in `reasons.py` but not covered by a scenario test.