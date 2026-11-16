# AidFlow System Contracts & Technical Agreement

**Version:** 1.0.0 (Phase 1 Agreement)  
**Authors:**
- **Member 1 (Chiranthan):** Frontend & User Interface
- **Member 2 (Hema):** Backend, Database & Dispatch Engine
- **Member 3 (Harshith RG):** Routing, ETA & Hospital Recommendation
- **Member 4 (Bindu):** Geolocation, Movement Simulation & Tracking

This document serves as the master contract between the frontend, backend, routing engine, and geolocation telemetry modules.

---

## 1. REST API Contract Summary

### 1.1 Standard Error Shape
All HTTP responses returning error status codes (`4xx` or `5xx`) adhere to the unified error envelope:
```json
{
  "error": {
    "code": "VALIDATION | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL",
    "message": "Human-readable description of the error.",
    "details": [
      {
        "field": "pickup.lat",
        "message": "Latitude must be between -90 and 90"
      }
    ]
  }
}
```

### 1.2 Core Contract Statuses & Roles
- **Roles:** `'patient'`, `'driver'`, `'hospital'`, `'admin'`
- **Case Statuses (Sequential Lifecycle):**
  1. `waiting`: Case created and queued for dispatch.
  2. `offered`: An offer has been extended to an ambulance driver (app notification and/or IVR call).
  3. `assigned`: Driver accepted the case; ambulance is marked busy; hospital and route polyline are linked.
  4. `en_route`: Ambulance is moving towards the patient pickup location.
  5. `reached_patient`: Ambulance has arrived at the patient location.
  6. `heading_to_hospital`: Patient picked up; ambulance moving towards the recommended hospital.
  7. `handed_over`: Patient arrived at hospital emergency department.
  8. `completed`: Admin or hospital supervisor closed the case; ambulance freed to `available`.
  9. `cancelled`: Case terminated prior to completion (allowed from any non-terminal state).
- **Dispatch Attempt Outcomes:** `'pending'`, `'accepted'`, `'rejected'`, `'timed_out'`
- **Emergency Severities:** `'critical'`, `'high'`, `'medium'`
- **Ambulance Statuses:** `'available'`, `'busy'`, `'offline'`
- **Hospital Capacity Statuses:** `'available'`, `'limited'`, `'full'`, `'unknown'`

### 1.3 Key REST Route Specifications

| Method | Path | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Service health & PostgreSQL connectivity check |
| `POST` | `/auth/register` | Public | Register new patient account |
| `POST` | `/auth/login` | Public | Authenticate user, returns JWT and user profile |
| `GET` | `/auth/me` | Any Authenticated | Retrieve current user profile, role, and linked ambulance/hospital ID |
| `POST` | `/emergencies` | `patient`, `admin` | Create emergency case (validates coordinates, normalizes phone, prevents duplicate within 60s/50m) |
| `GET` | `/emergencies/:id` | Owner, Driver, Hospital, Admin | Fetch case details, assigned unit, and status history |
| `GET` | `/emergencies` | `admin` | List emergency cases with status/type filtering and pagination |
| `POST` | `/emergencies/:id/cancel` | Owner, Admin | Cancel active emergency |
| `POST` | `/emergencies/:id/complete` | `admin` | Mark case completed and return ambulance to available |
| `POST` | `/emergencies/:id/assign` | `admin` | Manual atomic dispatch override |
| `POST` | `/dispatch/:id/accept` | `driver` (offered) | Accept pending dispatch offer |
| `POST` | `/dispatch/:id/reject` | `driver` (offered) | Reject pending dispatch offer (moves to next candidate) |
| `GET` | `/driver/requests` | `driver` | Fetch current driver's pending offer and active case |
| `PATCH` | `/driver/cases/:id/status` | `driver` (assigned) | Advance journey milestone (`en_route` → `reached_patient` → etc.) |
| `PATCH` | `/ambulances/:id/availability` | `driver` | Toggle status between `available` and `offline` (blocked if holding active case) |
| `PATCH` | `/ambulances/:id/location` | `driver`, `admin` | Ingest vehicle GPS telemetry |
| `GET` | `/ambulances` | `admin` | List all ambulances with fresh/stale calculation |
| `GET` | `/hospitals` | Public | List operational hospitals |
| `GET` | `/hospitals/:id/status` | `hospital`, `admin` | Get hospital capacity details |
| `PATCH` | `/hospitals/:id/status` | `hospital`, `admin` | Update bed counts and operational status |
| `GET` | `/hospitals/:id/incoming` | `hospital`, `admin` | List emergency cases en route to this facility |
| `POST` | `/hospitals/:id/ack/:caseId` | `hospital`, `admin` | Acknowledge patient arrival |
| `GET` | `/hospitals/recommend` | Authenticated | Test/query hospital recommendation engine |
| `GET` | `/telephony/config` | Public | Helpline number and demo simulation banner |
| `POST` | `/calls/incoming` | Public (Rate Limited) | Simulate incoming citizen call to helpline |
| `POST` | `/calls/:id/answer` | `admin` | Operator answers incoming call |
| `POST` | `/calls/:id/register-emergency` | `admin` | Create case directly from call session |
| `POST` | `/calls/:id/dtmf` | `driver` | Send keypad digit (1=Accept, 2=Reject) on outbound IVR call |
| `POST` | `/calls/:id/end` | `admin` | Terminate simulated call |
| `GET` | `/calls` | `admin` | List call session history |
| `GET` | `/alerts` | Authenticated | List system alerts scoped by role |
| `PATCH` | `/alerts/:id/acknowledge` | Authenticated | Acknowledge alert |

---

## 2. Real-Time Socket.IO Contract

### 2.1 Connection & Rooms
- **Endpoint:** `ws://localhost:4000/socket.io/`
- **Authentication:** JWT provided in `handshake.auth.token`. Connections without valid tokens are rejected.
- **Automatic Room Joins:**
  - `role:<role>` (`role:admin`, `role:hospital`, `role:driver`, `role:patient`)
  - `driver:<ambulanceId>` (for drivers, based on `users.ambulance_id`)
  - `hospital:<hospitalId>` (for hospital users, based on `users.hospital_id`)
- **Dynamic Rooms:**
  - `case:<caseId>` (Client joins via event `case:join`, leaves via `case:leave`. Patients may only join cases they reported).

### 2.2 Event Catalogue

| Event Name | Direction | Target Rooms | Payload Shape |
|---|---|---|---|
| `dispatch:offered` | Server → Client | `driver:<ambulanceId>` | `{ attemptId: string, caseId: string, pickup: LatLng, severity: string, emergencyType: string, expiresAt: string }` |
| `dispatch:accepted` | Server → Client | `case:<id>`, `role:admin` | `{ caseId: string, ambulanceId: string, driverName: string }` |
| `dispatch:rejected` | Server → Client | `role:admin` | `{ caseId: string, ambulanceId: string, reason: string }` |
| `dispatch:timeout` | Server → Client | `role:admin` | `{ caseId: string, attemptId: string }` |
| `case:created` | Server → Client | `role:admin` | `{ caseId: string, type: string, severity: string, pickup: LatLng }` |
| `case:status` | Server → Client | `case:<id>`, `role:admin` | `{ caseId: string, status: CaseStatus, note?: string, timestamp: string }` |
| `ambulance:location` | Server → Client | `case:<id>`, `role:admin` | `{ ambulanceId: string, lat: number, lng: number, heading?: number, speed?: number, timestamp: string }` |
| `hospital:incoming` | Server → Client | `hospital:<id>` | `{ hospitalId: string, caseId: string, emergencyType: string, severity: string, etaMinutes: number }` |
| `call:incoming` | Server → Client | `role:admin`, `driver:<id>` | `{ callSessionId: string, direction: string, fromNumber: string, simulated: true }` |
| `call:updated` | Server → Client | `role:admin` | `{ callSessionId: string, status: string }` |
| `call:ended` | Server → Client | `role:admin` | `{ callSessionId: string, endReason: string }` |
| `alert:new` | Server → Client | `role:<role>`, `hospital:<id>` | `{ id: string, type: string, message: string, emergencyId?: string }` |
| `case:join` | Client → Server | Gateway | `{ caseId: string }` |
| `case:leave` | Client → Server | Gateway | `{ caseId: string }` |
| `location:update` | Client → Server | Gateway | `{ ambulanceId: string, lat: number, lng: number, timestamp: string, heading?: number, speed?: number }` |

### 2.3 Reconnection Rules
Upon socket disconnection and subsequent reconnect:
1. Sockets automatically authenticate and rejoin designated role/driver/hospital rooms.
2. Frontend client executes a state refetch (`api.getCase()`, `api.getDriverRequests()`, or `api.listEmergencies()`) to synchronize any updates missed during the disconnect window.

---

## 3. Geolocation & Telemetry Contract

### 3.1 Location Ingestion Payload
```typescript
interface AmbulanceLocationPayload {
  ambulanceId: string;
  lat: number;              // Decimal degrees: -90.0 to +90.0
  lng: number;              // Decimal degrees: -180.0 to +180.0
  timestamp: string;        // ISO 8601 UTC (e.g. 2026-10-19T10:15:30.000Z)
  heading?: number;         // Degrees 0.0 to 360.0 clockwise from North
  speed?: number;           // Kilometers per hour (km/h) >= 0.0
  seq?: number;             // Monotonically increasing sequence number
}
```

### 3.2 Telemetry Ingestion Rules
- **Transports:** HTTP `PATCH /ambulances/:id/location` (primary); Socket.IO event `location:update` (secondary). Both invoke the identical backend service.
- **Update Frequency:**
  - Client default transmission interval: `VITE_LOCATION_INTERVAL_MS=3000` (3 seconds).
  - Server minimum throttle interval: `LOCATION_MIN_INTERVAL_MS=1000` (max 1 update/sec per ambulance).
- **Stale Threshold:** `LOCATION_STALE_SECONDS=120` (2 minutes). If `now() - last_location_at > 120s`, vehicle is tagged `isStale: true` and excluded from dispatch ranking.
- **Validation & Out-of-Order Rejection:**
  - Rejects timestamps more than 5 minutes in the future (`400 VALIDATION`).
  - Ignores updates where `timestamp <= last_location_at` (returns `200 { applied: false, reason: "stale" }`).

---

## 4. Ranking & Recommendation Rules

### 4.1 Ambulance Dispatch Candidate Ranking
An ambulance is eligible for a case offer if:
1. `status = 'available'`.
2. Location is fresh (`now() - last_location_at <= LOCATION_STALE_SECONDS`).
3. Does not hold an active case in `assigned`, `en_route`, `reached_patient`, or `heading_to_hospital`.
4. Haversine distance from vehicle to pickup is within `DISPATCH_RADIUS_KM` (50 km).
5. Has not already been offered and rejected/timed out in the current dispatch round.

**Ranking Order:** Shortest estimated road ETA to the pickup location (via configured `RoutingProvider`). Tie-breakers: lower Euclidean/Haversine distance, then alphabetical vehicle `label`.

### 4.2 Hospital Recommendation Scoring
The recommendation engine filters and scores operational hospitals:
1. **Filter:**
   - Must be `is_operational = true`.
   - Must not have `capacity_status = 'full'`.
   - Must support required specialty for the emergency type (e.g., cardiac → cardiology, trauma → trauma/orthopedics). General hospitals are accepted as universal fallback.
2. **Score (Lower Score Wins):**
   $$\text{Score} = \text{ETA (minutes)} + \text{Penalties}$$
   - Capacity `limited`: $+5$ min penalty.
   - Capacity `unknown`: $+8$ min penalty.
   - Stale hospital records ($> 24$ hours without update): $+5$ min penalty.
   - Critical severity case with 0 ICU beds: $+10$ min penalty.
   - General hospital fallback without matching specialty: $+6$ min penalty.
3. **Tie-Break:** Lower road distance (km), then alphabetical hospital name.

---

## 5. Local Setup & Execution Contract

### 5.1 Environment Variables
All configuration is loaded via environment variables with strictly defined fallbacks:
- `PORT=4000`
- `DATABASE_URL=postgresql://.../aidflow`
- `DATABASE_URL_TEST=postgresql://.../aidflow_test`
- `JWT_SECRET` (Must be at least 16 characters)
- `DISPATCH_TIMEOUT_MS=20000` (20 seconds driver response window)
- `DISPATCH_RADIUS_KM=50`
- `DISPATCH_RETRY_MS=30000`
- `DISPATCH_MAX_RETRIES=5`
- `ROUTING_PROVIDER=haversine` (`haversine`, `graph`, `osrm`, `ors`)
- `TELEPHONY_PROVIDER=simulated` (Only `simulated` is valid)

### 5.2 One-Command Run & Reset
- Database reset from scratch:
  ```bash
  npm run db:reset # or npm --prefix backend run db:reset
  ```
- Full application execution (frontend + backend concurrently):
  ```bash
  npm run dev:all
  ```
- Typecheck and automated testing:
  ```bash
  npm run typecheck
  npm test
  ```
