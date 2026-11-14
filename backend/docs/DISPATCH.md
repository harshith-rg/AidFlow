# AidFlow Dispatch Engine Specification

The dispatch engine is the core orchestration module of AidFlow. It enforces atomic single-offer dispatch, candidate ranking, timeout expiry, and multi-round retry policies.

---

## 1. Candidate Eligibility Criteria

An ambulance is considered eligible for dispatch if and only if all of the following conditions hold:
1. `status = 'available'`
2. Has valid spatial coordinates (`lat`, `lng` not null)
3. Location telemetry freshness: `last_location_at >= now() - INTERVAL '120 seconds'` (`LOCATION_STALE_SECONDS`)
4. Distance from pickup location $\le 50\text{ km}$ (`DISPATCH_RADIUS_KM`)
5. Has not already been offered this case during the current retry round (`allowPreviousAttempts = false`)
6. Does not currently hold an active case

---

## 2. Ambulance Ranking Rule

Ambulances that meet the eligibility criteria are ranked using the following strict hierarchy:
1. **Primary Sort: Lowest Estimated Travel Time (ETA)** to pickup location computed via the configured `RoutingProvider` (Haversine, Graph Dijkstra/A*, OSRM, or ORS).
2. **First Tie-Breaker: Lower Road / Straight-Line Distance ($km$)**.
3. **Second Tie-Breaker: Alphabetical Ambulance Label** (`label.localeCompare`).

---

## 3. Offer & Timeout Lifecycle

```
[Case Reported]
       ↓
[offerNext] ────(Lock Case FOR UPDATE)────→ Pick Top Candidate
       ↓
Insert Attempt (outcome='pending', expires_at = now() + 20s)
       ↓
Set Case status = 'offered'
Commit DB Transaction
       ↓
Emit 'dispatch:offered' (Socket.IO) & Trigger IVR Call Hook
       ↓
  ┌───────────────────────┬────────────────────────┐
  ↓                       ↓                        ↓
[Accept]               [Reject]                [Timeout]
• Via App              • Via App (reason)       • In-memory setTimeout (20s)
• Via DTMF [1]         • Via DTMF [2]           • DB Sweeper (every 2s)
  ↓                       ↓                        ↓
Lock Attempt FOR UPDATE Lock Attempt FOR UPDATE Lock Attempt FOR UPDATE
Attempt: 'accepted'    Attempt: 'rejected'      Attempt: 'timed_out'
Ambulance: 'busy'      History recorded         Call: 'missed'
Case: 'assigned'                  ↓                        ↓
Hospital Recommended     [offerNext]              [offerNext]
```

### 3.1 Background Sweeper & Crash Recovery
In addition to in-memory `setTimeout` handlers, `scheduler.ts` executes a periodic sweeper query every 2 seconds:

```sql
SELECT id FROM dispatch_attempts
WHERE outcome = 'pending' AND expires_at <= now()
FOR UPDATE SKIP LOCKED;
```

This ensures that even if the Node.js process restarts mid-offer, expired offers are immediately transitioned to `timed_out` upon startup, preventing hung cases.

---

## 4. No Ambulance & Retry Policy

If no eligible ambulance is available in the operational area:
1. The case status reverts to `waiting`.
2. A `no_ambulance` alert is inserted into `alerts` and broadcast to `role:admin`.
3. If `retry_count < DISPATCH_MAX_RETRIES` (default 5):
   - `next_retry_at` is set to `now() + 30000ms`.
   - After `DISPATCH_RETRY_MS` (30s), dispatch automatically re-evaluates all ambulances (previously attempted ambulances become eligible again for the new round).
4. If maximum retries are exhausted, the case remains `waiting` with a persistent flag: `"CRITICAL: Maximum dispatch retries exhausted. Manual ambulance assignment required."`
