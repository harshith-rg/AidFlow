# AidFlow System Audit & Component Status (Phase 1)

**Audit Date:** October 2026  
**Project:** AidFlow — AI-Based Smart Ambulance Emergency Response and Hospital Recommendation System  
**Institution:** Global Academy of Technology, Dept. of CSE (AIML)  
**Team Members:**  
- **Member 1 (Chiranthan):** Frontend and UI  
- **Member 2 (Hema):** Backend, DB, dispatch  
- **Member 3 (Harshith RG):** Routing, ETA, hospital recommendation  
- **Member 4 (Bindu):** GPS, location, ambulance movement  

---

## 1. Frontend Audit (`src/`)

| Route / Component | Primary Files | Status | Description & Data Source |
|---|---|---|---|
| **Landing Page** (`/`) | `src/App.tsx`<br>`src/components/Header.tsx`<br>`src/components/Hero.tsx`<br>`src/components/HowItWorks.tsx`<br>`src/components/AISection.tsx`<br>`src/components/SimulatedCallModal.tsx`<br>`src/components/Disclaimer.tsx`<br>`src/components/Footer.tsx` | **Complete** | Showcases dummy helpline `1800-000-0000 (DEMO NUMBER)`, academic disclaimer, mobile `tel:` dialer link, desktop call simulator dialog, and quick links to operations pages. |
| **Authentication UI** (`/login`) | `src/pages/LoginPage.tsx`<br>`src/context/AuthContext.tsx` | **Complete** | Full JWT login and patient registration with fast demo one-click logins (`admin@aidflow.demo`, `driver1@aidflow.demo`, `hospital@aidflow.demo`, `patient@aidflow.demo`). Role redirection and session persistence. |
| **Call Centre Console** (`/call-center`, `/emergency`) | `src/pages/CallCentrePage.tsx`<br>`src/components/SimulatedCallModal.tsx` | **Complete UI / Partial API** | Operator intake form with triage, severity, symptoms, special assistance, Leaflet map pin, nearest hospital calculation. Connected to dummy telephony routes (`POST /calls/incoming`, `POST /calls/:id/answer`, `POST /calls/:id/register-emergency`) and fallback `emergencyStore.ts`. Full transition to API in Phase 8. |
| **Control Room Command Center** (`/control-room`) | `src/pages/ControlRoom.tsx`<br>`src/components/ControlRoomAlertToast.tsx` | **Complete UI / Partial API** | Real-time compact red left-side toast notification with optional dual-tone audio chime, dismiss and View details actions, 6 KPI cards, Leaflet map with route polyline, ambulance assignment modal, simulated movement demo, dossier modal. Reads/writes through `emergencyStore.ts` and REST APIs (`GET /emergencies`, `GET /ambulances`, `GET /calls`). |
| **Driver Panel** (`/driver`) | `src/pages/DriverPanel.tsx` | **Complete** | Role-guarded (`driver`, `admin`). Displays vehicle assignment, availability toggle (`available`/`offline`), incoming dispatch offer card with countdown from `expiresAt`, Accept / Reject action buttons (with 409 conflict handling), active journey milestones (`en_route` → `reached_patient` → `heading_to_hospital` → `handed_over`), embedded simulated telephony IVR dialer keypad, and location update controls. |
| **Hospital Desk** (`/hospital-desk`) | `src/pages/HospitalDesk.tsx` | **Complete** | Role-guarded (`hospital`, `admin`). Hospital capacity status update form (`capacity_status`, `beds`, `icu_beds`, `is_operational`), incoming emergency patient triage queue with ETA indicators, and triage arrival acknowledgement action. |
| **Case Tracking** (`/track/:caseId`) | `src/pages/TrackCase.tsx` | **Complete** | Patient-facing tracking view with 7-stage status timeline, assigned driver information, and hospital recommendation. Uses `src/api/client.ts` with real-time socket events and polling fallback. |
| **Hospitals Network** (`/hospitals`) | `src/pages/HospitalsPage.tsx`<br>`src/components/HospitalMap.tsx` | **Complete UI** | Reads `public/hospital_directory.json` with state filtering, search, map markers, bed & ICU count indicators. Reads static JSON; wired with `GET /hospitals` backend data. |
| **Delivery Patrol** (`/delivery-patrol`) | `src/pages/OperationsPages.tsx` | **Complete UI** | Ambulance fleet readiness table, operational zone assignment, availability toggle. Connected to `emergencyStore.ts` and `api.listAmbulances()`. |
| **Live Tracking Radar** (`/live-tracking`) | `src/pages/OperationsPages.tsx`<br>`src/components/LiveLocationMap.tsx` | **Placeholder / Demo** | Satellite tracking map with demo fleet markers. Clearly documents that live GPS requires authorized hardware feed and presents simulated movement. |
| **Alerts & Cases** (`/alerts`) | `src/pages/OperationsPages.tsx` | **Complete UI** | Operations notification log and emergency case register. Connected to `emergencyStore.ts` and `GET /alerts`. |
| **Legacy Emergency Report** (`/legacy-report`) | `src/pages/ReportEmergency.tsx` | **Complete** | Retained 3-step self-service emergency reporting form with geolocation coordinates and contact details. |

---

## 2. Backend Audit (`backend/src/`)

| Module / Layer | Primary Files | Status | Description |
|---|---|---|---|
| **Server & Framework** | `backend/src/server.ts`<br>`backend/src/app.ts` | **Done** | Express app with `http.createServer` attached to Socket.IO gateway, CORS configuration, JSON body parsing with payload size limits, graceful shutdown. |
| **Environment Config** | `backend/src/config/env.ts`<br>`backend/.env.example`<br>`backend/.env` | **Done** | Zod-validated environment config. Requires `JWT_SECRET` (min 16 chars). Validates `TELEPHONY_PROVIDER=simulated` (rejects external telephony providers), `DATABASE_URL`, `DATABASE_URL_TEST`, dispatch, routing, and simulation flags. |
| **Database & Migrations** | `backend/src/db/pool.ts`<br>`backend/src/db/migrate.ts`<br>`backend/src/db/reset.ts`<br>`backend/src/db/seed.ts`<br>`backend/migrations/001_init.sql`<br>`backend/migrations/002_calls_and_dispatch.sql` | **Done** | `001_init.sql` defines core tables (`hospitals`, `users`, `ambulances`, `emergencies`, `dispatch_attempts`, `emergency_status_history`, `alerts`) with partial unique indexes preventing double-booking.<br>`002_calls_and_dispatch.sql` adds telephony sessions/events, driver location tracking columns, alert hospital targeting, and `users.ambulance_id` link. Seed populates demo hospitals, ambulances, and role credentials. |
| **Security & Middleware** | `backend/src/middleware/errorHandler.ts`<br>`backend/src/middleware/rateLimit.ts`<br>`backend/src/middleware/requestId.ts`<br>`backend/src/middleware/validate.ts`<br>`backend/src/middleware/auth.ts`<br>`backend/src/utils/errors.ts`<br>`backend/src/utils/logger.ts` | **Done** | Unified error shape `{ error: { code, message, details? } }`. `helmet`, rate limiters (`standardRateLimiter` 120/min and `publicStrictRateLimiter` 10/min), `validate(schema)` helper supporting Zod, `requestId` tracing in headers and logs, `requireAuth` and `requireRole` middleware. |
| **Health Check** | `backend/src/modules/health/health.routes.ts` | **Done** | `GET /health` returns service and database connectivity status. |
| **Authentication & RBAC** | `backend/src/modules/auth/auth.routes.ts`<br>`backend/src/modules/auth/auth.service.ts` | **Done** | `POST /auth/register` (patient registration), `POST /auth/login` (bcrypt check + 12h JWT), `GET /auth/me` (returns role, name, phone, linked `ambulanceId` or `hospitalId`). |
| **Emergencies API & Lifecycle** | `backend/src/modules/emergencies/emergencies.routes.ts`<br>`backend/src/modules/emergencies/emergencies.service.ts`<br>`backend/src/modules/emergencies/stateMachine.ts`<br>`backend/src/modules/emergencies/emergencies.mapper.ts` | **Done** | `POST /emergencies` (validates pickup coords, phone normalization, duplicate submit check within 60s/50m), `GET /emergencies`, `GET /emergencies/:id` with history timeline, `POST /emergencies/:id/cancel`, `POST /emergencies/:id/complete`, `POST /emergencies/:id/assign` (manual dispatch). State machine enforces legal transitions. |
| **Routing & Recommendation** | `backend/src/modules/routing/router.ts`<br>`backend/src/modules/routing/recommend.ts`<br>`backend/src/modules/routing/providers/`<br>`backend/src/modules/routing/algorithms/` | **Done** | Multi-provider routing (`haversine`, `graph`, `osrm`, `ors`). Demo road graph with Dijkstra and A* pathfinding. Hospital recommendation pipeline scoring distance, capacity status, specialty matching, and ICU bed availability. |
| **Dispatch Engine** | `backend/src/modules/dispatch/engine.ts`<br>`backend/src/modules/dispatch/service.ts`<br>`backend/src/modules/dispatch/scheduler.ts`<br>`backend/src/modules/dispatch/ranking.ts` | **Done** | `startDispatch`, `offerNext`, candidate ranking by ETA. Atomic `acceptAttempt` / `rejectAttempt` / `timeoutAttempt`. Concurrency control using `SELECT ... FOR UPDATE`. Sweeper running every 2s for background timeout enforcement. Retry rounds on candidate exhaustion. |
| **Ambulance & Location APIs** | `backend/src/modules/ambulances/ambulances.routes.ts`<br>`backend/src/modules/ambulances/ambulances.service.ts`<br>`backend/src/modules/driver/driver.routes.ts` | **Done** | Driver availability toggle `PATCH /ambulances/:id/availability` (prevents offline while holding active case). Monotonic location ingestion `PATCH /ambulances/:id/location` with stale/future timestamp filtering. Journey status updates `PATCH /driver/cases/:id/status`. |
| **Hospital Management** | `backend/src/modules/hospitals/hospitals.routes.ts` | **Done** | `GET /hospitals`, `GET /hospitals/:id/status`, `PATCH /hospitals/:id/status`, `GET /hospitals/:id/incoming`, `POST /hospitals/:id/ack/:caseId`, `GET /hospitals/recommend`. |
| **Simulated Telephony** | `backend/src/modules/telephony/telephony.routes.ts`<br>`backend/src/modules/telephony/service.ts`<br>`backend/src/modules/telephony/provider.ts` | **Done** | Simulated telephony gateway: `GET /telephony/config`, `POST /calls/incoming`, `POST /calls/:id/answer`, `POST /calls/:id/register-emergency`, `POST /calls/:id/dtmf`, `POST /calls/:id/end`, `GET /calls`. |
| **Alerts & System Events** | `backend/src/modules/alerts/alerts.routes.ts` | **Done** | `GET /alerts`, `PATCH /alerts/:id/acknowledge`. Role-scoped alerts feed. |
| **Simulation Module** | `backend/src/modules/simulation/simulation.routes.ts`<br>`backend/src/modules/simulation/simulator.ts` | **Done** | `POST /simulation/ambulances/:id/follow-case` simulating GPS along polyline route, `POST /simulation/stop`. Strictly tagged with `simulated: true`. |
| **Real-time Gateway** | `backend/src/realtime/socket.ts`<br>`backend/src/realtime/events.ts` | **Done** | Socket.IO server with JWT authentication, role rooms (`role:admin`, `role:hospital`), driver rooms (`driver:<ambulanceId>`), hospital rooms (`hospital:<id>`), case rooms (`case:<id>`). Strongly typed event emitters firing after DB commit. |
| **Automated Test Suite** | `backend/tests/` | **Done** | 8 test suites with 52 unit & integration tests covering health, auth, emergencies, dispatch concurrency, routing & algorithms, ambulance location, telephony IVR, and real-time sockets. |

---

## 3. Database Link Audit (`001_init.sql` & `002_calls_and_dispatch.sql`)

### Schema Link Analysis:
1. **Hospital Users:** `users.hospital_id REFERENCES hospitals(id)`. Allows hospital personnel to manage their specific hospital's bed capacity and view incoming patients.
2. **Driver Users:** 
   - In `001_init.sql`, `ambulances.driver_id REFERENCES users(id)`.
   - In `002_calls_and_dispatch.sql`, added `ALTER TABLE users ADD COLUMN ambulance_id UUID REFERENCES ambulances(id)`. This bidirectional foreign key enables fast token payload generation and O(1) lookups in `GET /auth/me` without requiring extra joins.
3. **Dispatch Attempts & Emergencies:**
   - Enforces partial unique index `one_active_case_per_ambulance` on `emergencies`.
   - Enforces partial unique indexes `one_accepted_attempt_per_case` and `one_pending_attempt_per_case` on `dispatch_attempts`.
   - Guaranteed atomic concurrency under race conditions.
