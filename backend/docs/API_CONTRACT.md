# AidFlow System API Contract (Final Specification)

**Base URL**: `http://localhost:4000`  
**Data Format**: JSON (`Content-Type: application/json`)  
**Coordinates**: Decimal degrees (`lat`, `lng`) in range $[-90, 90]$ and $[-180, 180]$  
**Timestamps**: ISO 8601 UTC (e.g. `2026-10-16T12:00:00.000Z`)  
**Security**: Bearer JWT tokens (`Authorization: Bearer <token>`)

---

## 1. Unified Error Format

Every error response follows a strict, predictable shape:

```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Some fields are invalid.",
    "details": [
      { "field": "reporterPhone", "message": "Reporter phone must be a valid 10-digit phone number." }
    ]
  }
}
```

### Standard Status Codes
- `VALIDATION (400)`: Body or parameter schema mismatch.
- `UNAUTHORIZED (401)`: Missing, expired, or invalid JWT token.
- `FORBIDDEN (403)`: Insufficient role permissions for the resource.
- `NOT_FOUND (404)`: Case, ambulance, hospital, or call session not found.
- `CONFLICT (409)`: State violation (e.g., attempt expired, double booking, illegal status transition).
- `RATE_LIMITED (429)`: IP rate limit exceeded on public endpoints.
- `INTERNAL (500)`: Unhandled server exception.

---

## 2. Authentication & Profile Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `POST /auth/register` | Public | Register patient account. Body: `{ email, password, name, phone? }` |
| `POST /auth/login` | Public | Log in and obtain JWT. Body: `{ email, password }` |
| `GET /auth/me` | Authenticated | Returns current profile `{ user: { id, email, role, name, hospitalId? } }` |

---

## 3. Emergency Cases & Lifecycle Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `POST /emergencies` | Patient / Admin | Report emergency. Body: `{ type, reporterName, reporterPhone, pickup: { lat, lng, address? }, description?, source? }`. Returns `EmergencyCase` with server ID (e.g. `EMG-2026-0001`). Starts async dispatch. |
| `GET /emergencies/:id` | Case Owner / Driver / Hospital / Admin | Get case details, assigned ambulance, recommended hospital, and status history timeline. |
| `GET /emergencies` | Admin | List all emergency cases with optional filters: `?status=&type=&limit=`. |
| `POST /emergencies/:id/cancel` | Case Owner / Admin | Cancel emergency case. Body: `{ reason: string }`. Frees assigned ambulance and cancels active offers. |
| `POST /emergencies/:id/assign` | Admin | Manually assign an available ambulance. Body: `{ ambulanceId: string }`. Cancels pending attempts atomically. |
| `POST /emergencies/:id/complete` | Admin | Mark case completed. Sets assigned ambulance back to `available`. |

---

## 4. Dispatch Engine Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `POST /dispatch/:attemptId/accept` | Driver of offered ambulance | Atomically accepts offer. Marks ambulance `busy`, case `assigned`, triggers hospital recommendation. Returns `409 CONFLICT` if expired or answered. |
| `POST /dispatch/:attemptId/reject` | Driver of offered ambulance | Rejects offer with optional reason. Moves immediately to the next ranked candidate. |
| `GET /driver/requests` | Driver | Returns active case and any pending dispatch offer with server `expiresAt`. |
| `PATCH /driver/cases/:id/status` | Assigned Driver | Updates journey stage (`en_route` -> `reached_patient` -> `heading_to_hospital` -> `handed_over`). |

---

## 5. Ambulances & Live GPS Telemetry Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `GET /ambulances` | Admin | List ambulances with location, status, and computed `isStale` telemetry flag. |
| `PATCH /ambulances/:id/availability` | Driver of unit | Set status (`available` or `offline`). Returns `409 CONFLICT` if ambulance has an active case. |
| `PATCH /ambulances/:id/location` | Driver / Simulator | Ingests GPS update: `{ ambulanceId, lat, lng, timestamp?, heading?, speed? }`. Rejects stale or out-of-order updates monotonically. |

---

## 6. Hospitals & Recommendation Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `GET /hospitals` | Public | List operational hospitals. |
| `GET /hospitals/:id/status` | Hospital / Admin | Get current capacity status, beds, and ICU availability. |
| `PATCH /hospitals/:id/status` | Hospital user (own) / Admin | Update facility readiness: `{ capacity_status, beds, icu_beds, is_operational }`. |
| `GET /hospitals/:id/incoming` | Hospital / Admin | List emergency cases currently in transit to this hospital. |
| `GET /hospitals/recommend` | Authenticated | Test recommendation pipeline for given `{ lat, lng, type, severity }`. |

---

## 7. Simulated Telephony (Dummy Helpline & IVR) Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `GET /telephony/config` | Public | Returns helpline number (`1800-000-0000`), simulated status, and academic notice. |
| `POST /calls/incoming` | Public (Rate-limited) | Simulates incoming phone call from bystander. Body: `{ callerNumber, callerName?, lat?, lng? }`. Creates ringing call session. |
| `POST /calls/:id/answer` | Admin | Operator answers incoming call; transitions session to `in_progress`. |
| `POST /calls/:id/register-emergency` | Admin | Registers emergency directly from call session; links case with `source='call'`. |
| `POST /calls/:id/end` | Admin / System | Ends call session. |
| `POST /calls/:id/dtmf` | Driver (own call) | Processes keypad input (`1` = Accept, `2` = Reject). Safe concurrency with app accept. |
| `GET /calls` | Admin | Telephony call history and session logs. |
| `GET /calls/:id` | Admin | Call details and chronological DTMF/ringing event log. |

---

## 8. Alerts Endpoints

| Method & Path | Auth / Role | Description |
|---|---|---|
| `GET /alerts` | Admin / Hospital | List system alerts (e.g. `no_ambulance`, dispatch warnings). |
| `PATCH /alerts/:id/acknowledge` | Admin / Hospital | Acknowledge an alert item. |
