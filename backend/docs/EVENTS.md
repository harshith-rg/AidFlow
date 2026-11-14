# AidFlow Real-Time Event Catalogue (Socket.IO Specification)

AidFlow uses Socket.IO for server-to-client real-time notifications. Events are emitted **only after the corresponding database transaction has committed** (Ground Rule 8).

---

## 1. Connection & Authentication

Clients connect to `http://localhost:4000` and provide the JWT token in the handshake:

```typescript
const socket = io('http://localhost:4000', {
  auth: { token: 'jwt_token_here' }
})
```

Upon connection, the server automatically joins the socket to role-based and entity rooms based on verified token claims:
- `role:<role>` (e.g. `role:admin`, `role:driver`, `role:hospital`, `role:patient`)
- `driver:<ambulanceId>` for drivers assigned to an ambulance
- `hospital:<hospitalId>` for hospital administrators

Cases can be joined dynamically via `socket.emit('case:join', { caseId })`.

---

## 2. Event Reference

### `dispatch:offered`
- **Room**: `driver:<ambulanceId>`
- **Trigger**: An emergency dispatch attempt is created and offered to an ambulance.
- **Payload**:
```json
{
  "attemptId": "48b6c507-...",
  "caseId": "EMG-2026-0001",
  "ambulanceId": "a90df731-...",
  "expiresAt": "2026-10-16T12:00:20.000Z",
  "pickup": { "lat": 12.9716, "lng": 77.5946 },
  "emergencyType": "cardiac",
  "severity": "critical",
  "etaMinutes": 4
}
```

### `dispatch:accepted`
- **Room**: `driver:<ambulanceId>`
- **Trigger**: Driver accepts dispatch offer via app or IVR digit 1.
- **Payload**:
```json
{
  "attemptId": "48b6c507-...",
  "caseId": "EMG-2026-0001",
  "ambulanceId": "a90df731-...",
  "driverId": "00000000-..."
}
```

### `dispatch:rejected`
- **Room**: `driver:<ambulanceId>`
- **Trigger**: Driver rejects offer via app or IVR digit 2.
- **Payload**:
```json
{
  "attemptId": "48b6c507-...",
  "caseId": "EMG-2026-0001",
  "ambulanceId": "a90df731-...",
  "reason": "Driver rejected via DTMF digit 2"
}
```

### `dispatch:timeout`
- **Room**: `driver:<ambulanceId>`
- **Trigger**: Server timeout (20s) expired with no response from driver.
- **Payload**:
```json
{
  "attemptId": "48b6c507-...",
  "caseId": "EMG-2026-0001",
  "ambulanceId": "a90df731-..."
}
```

### `case:created`
- **Room**: `role:admin`
- **Trigger**: New emergency reported via web form or call center.
- **Payload**: `{ "caseId": "EMG-2026-0001", "emergency": { ... } }`

### `case:status`
- **Room**: `case:<caseCode>`, `role:admin`
- **Trigger**: Emergency case status transition occurs.
- **Payload**:
```json
{
  "caseId": "EMG-2026-0001",
  "status": "en_route",
  "changedBy": "driver-id",
  "note": "Driver en route to patient",
  "timestamp": "2026-10-16T12:02:15.000Z"
}
```

### `ambulance:location`
- **Room**: `case:<caseCode>`, `role:admin`
- **Trigger**: Ambulance GPS telemetry update ingested and accepted.
- **Payload**:
```json
{
  "ambulanceId": "a90df731-...",
  "lat": 12.9735,
  "lng": 77.5962,
  "heading": 85,
  "speedKmh": 38.5,
  "timestamp": "2026-10-16T12:02:30.000Z",
  "isStale": false,
  "simulated": true
}
```

### `call:incoming`
- **Room**: `role:admin` (inbound), `driver:<ambulanceId>` (outbound)
- **Trigger**: Incoming caller dials dummy helpline or system dials driver IVR.
- **Payload**:
```json
{
  "callSessionId": "c8f12a34-...",
  "direction": "inbound_caller",
  "fromNumber": "9876543210",
  "toNumber": "1800-000-0000",
  "callerName": "Rahul Sharma",
  "simulated": true,
  "prompt": "Incoming simulated helpline call from Rahul Sharma (9876543210)"
}
```

### `call:updated` & `call:ended`
- **Room**: `role:admin` / Broadcast
- **Trigger**: Call answered, digit pressed, or call terminated.

### `hospital:incoming`
- **Room**: `hospital:<hospitalId>`
- **Trigger**: Case assigned with this hospital recommended as destination.
- **Payload**:
```json
{
  "hospitalId": "hosp-uuid",
  "caseId": "EMG-2026-0001",
  "ambulanceId": "amb-uuid",
  "etaMinutes": 8,
  "emergencyType": "cardiac",
  "severity": "critical"
}
```

### `alert:new`
- **Room**: `role:admin` (and optionally `hospital:<hospitalId>`)
- **Trigger**: System alert generated (e.g. `no_ambulance` available after timeout rounds).
