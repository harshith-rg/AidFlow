# AidFlow Backend — Service Documentation

The AidFlow backend is built with **Node.js, Express, TypeScript, Socket.IO, and PostgreSQL**. It acts as the centralized source of truth for case lifecycles, user authentication, ambulance dispatch offers, status transitions, driver telephony, and algorithmic hospital recommendation.

---

## 1. Environment Configuration

Create a `.env` file in `/backend` based on `.env.example`:

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `4000` | Port for Express HTTP & Socket.IO server |
| `DATABASE_URL` | string | `postgresql://postgres:postgres@localhost:5432/aidflow` | Main PostgreSQL connection string |
| `DATABASE_URL_TEST` | string | `postgresql://postgres:postgres@localhost:5432/aidflow_test` | Isolated test DB connection string |
| `JWT_SECRET` | string | `ChangeMe123_AidFlow_Secret_Key!` | Secret key for JWT signing (minimum 16 characters) |
| `SEED_DEMO_PASSWORD` | string | `ChangeMe123!` | Default password for seeded accounts |
| `DISPATCH_TIMEOUT_MS` | number | `20000` | Expiration window for dispatch offers (20 seconds) |
| `DISPATCH_MAX_ROUNDS` | number | `4` | Maximum dispatch retry rounds before escalation |
| `DISPATCH_CANDIDATE_RADIUS_KM` | number | `25` | Maximum search radius for candidate ambulances |
| `TELEPHONY_PROVIDER` | string | `simulated` | Software telephony provider mode (`simulated`) |
| `LOG_LEVEL` | string | `info` | Pino logging level (`debug`, `info`, `warn`, `error`) |

---

## 2. Database Management Scripts

| Command | Purpose |
|---|---|
| `npm run db:migrate` | Runs all pending SQL migrations in `migrations/` in sequential order. |
| `npm run db:seed` | Seeds the database with demo hospitals, demo ambulances, and default user accounts. |
| `npm run db:reset` | Drops and recreates the public schema, applies all migrations, imports hospitals, and seeds demo data. |
| `npm run db:import-hospitals` | Imports hospital data from the directory into the `hospitals` table. |

---

## 3. Server Scripts & Testing

| Command | Purpose |
|---|---|
| `npm run dev` | Starts the Express & Socket.IO backend in development mode with auto-reload. |
| `npm run build` | Compiles TypeScript into the `dist/` production bundle. |
| `npm start` | Runs the compiled server from `dist/server.js`. |
| `npm run typecheck` | Validates TypeScript types across the backend codebase without emitting files. |
| `npm test` | Runs the full Vitest integration suite against `DATABASE_URL_TEST`. |
| `npm run routing:compare` | Runs benchmark comparing Dijkstra and A* pathfinding on test coordinate pairs. |

---

## 4. API & Feature Modules

The backend is modularized under `src/modules/`:

- **`auth/`**: Registration (patient only), BCrypt password verification, JWT issuance, `/auth/me`.
- **`emergencies/`**: Emergency lifecycle state machine (`REPORTED` ➔ `DISPATCHED` ➔ `EN_ROUTE` ➔ `ARRIVED_AT_SCENE` ➔ `PATIENT_ON_BOARD` ➔ `TRANSPORTING` ➔ `AT_HOSPITAL` ➔ `COMPLETED` / `CANCELLED`), duplicate submission prevention (50m radius / 60s window), and history tracking.
- **`dispatch/`**: Ranking engine with Haversine distance, capability match (BLS/ALS), 20-second automated timeout scheduling, and atomic accept/reject concurrency handling with `FOR UPDATE` row locks.
- **`routing/`**: In-memory topological street network graph with Dijkstra and A* (Haversine heuristic) algorithms, and multi-criteria hospital recommendation scoring.
- **`telephony/`**: In-software simulated telephony layer managing inbound caller sessions, operator call answering, emergency case binding, and outbound driver phone calls with DTMF `1`/`2` keypress processing.
- **`ambulances/`**: Real-time vehicle fleet status, driver assignments, and sequence-based out-of-order GPS telemetry ingestion.
- **`hospitals/`**: Hospital registry, live bed & ICU telemetry updates, and pre-arrival ambulance incoming queues.
- **`alerts/`**: Emergency alert generation and acknowledgment tracking.
- **`realtime/`**: Socket.IO server with room subscriptions (`case:join`, `role:admin`), authentication middleware, and broadcast events.

---

## 5. Unified Error Response Standard

All endpoints return a standardized RFC-compliant error format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Emergency case EMG-2026-0001 was not found",
    "details": []
  }
}
```

Standard error codes:
- `VALIDATION` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `RATE_LIMITED` (429)
- `INTERNAL` (500)
