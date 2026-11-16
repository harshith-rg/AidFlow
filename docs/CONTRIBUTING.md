# AidFlow Contribution & Engineering Guidelines

**Project:** AidFlow — AI-Based Smart Ambulance Emergency Response and Hospital Recommendation System  
**Institution:** Global Academy of Technology, Dept. of CSE (AIML)  
**Authors:**
- **Member 1 (Chiranthan):** Frontend and UI
- **Member 2 (Hema):** Backend, DB, dispatch
- **Member 3 (Harshith RG):** Routing, ETA, hospital recommendation
- **Member 4 (Bindu):** GPS, location, ambulance movement

---

## 1. Project Folder Structure

```text
AidFlow/
├── backend/                   # Express + TypeScript + PostgreSQL backend (Member 2)
│   ├── docs/                  # Technical domain specifications
│   │   ├── API_CONTRACT.md    # Complete REST endpoints, parameters, error formats
│   │   ├── DATA_MODEL.md      # Database schema, ER diagram, constraints
│   │   ├── DISPATCH.md        # State machine, ranking, timeout & retry algorithms
│   │   ├── EVENTS.md          # Socket.IO event catalogue and payloads
│   │   ├── HOSPITAL_DATA.md   # Hospital directory specification & demo data rules
│   │   ├── ROUTING.md         # Routing engines (Dijkstra, A*, Haversine, OSRM/ORS)
│   │   └── TELEPHONY.md       # Dummy telephony, call states, IVR keypad flow
│   ├── migrations/            # Versioned SQL migrations (001_init.sql, 002_calls_and_dispatch.sql)
│   ├── src/
│   │   ├── config/            # Zod-validated environment config (env.ts)
│   │   ├── db/                # Pool connection, transactions, seed, reset, migrations
│   │   ├── middleware/        # Helmet, rate-limiting, auth, validation, request tracing
│   │   ├── modules/
│   │   │   ├── alerts/        # Alerts feed and acknowledgments
│   │   │   ├── ambulances/    # Availability toggles and location ingestion
│   │   │   ├── auth/          # JWT registration, login, profile (/auth/me)
│   │   │   ├── dispatch/      # Ranking engine, offer queue, timeout scheduler
│   │   │   ├── driver/        # Driver journey and active requests
│   │   │   ├── emergencies/   # Case lifecycle, validation, state machine
│   │   │   ├── health/        # Service and database health checks
│   │   │   ├── hospitals/     # Hospital directory, capacity status, patient intake
│   │   │   ├── routing/       # Multi-provider routing & hospital recommendation
│   │   │   ├── simulation/    # Simulated ambulance movement along route polylines
│   │   │   └── telephony/     # Simulated helpline and outbound driver IVR calls
│   │   ├── realtime/          # Socket.IO gateway and post-commit event emitters
│   │   ├── types/contract.ts  # Shared contract types (synchronized with frontend)
│   │   └── utils/             # Structured logger (pino) and unified error classes
│   └── tests/                 # Vitest + Supertest integration test suite
├── docs/                      # Global project documentation
│   ├── AUDIT.md               # System component status & gap analysis
│   ├── CONTRACTS.md           # Master system contract agreement
│   ├── CONTRIBUTING.md         # Development guidelines and review rules
│   ├── INTEGRATION_CHECKLIST.md # End-to-end integration and verification matrix
│   ├── LOCATION.md            # Geolocation formats, transport, and accuracy rules
│   └── SCREEN_API_MAP.md      # UI screens to REST routes and Socket.IO mapping
├── public/                    # Static assets & demo hospital directory (hospital_directory.json)
├── src/                       # React + Vite + TypeScript frontend (Member 1)
│   ├── api/                   # REST client (`client.ts`), mock data (`mock.ts`), real API
│   ├── components/            # Header, Hero, Modals, Maps, UI cards, Layouts
│   ├── context/               # AuthContext (JWT tokens, role guards)
│   ├── pages/                 # Route views (Landing, Login, CallCentre, ControlRoom, Driver, HospitalDesk, etc.)
│   ├── realtime/              # Socket.IO client gateway (`socket.ts`)
│   ├── services/              # Adapter layer (`caseAdapter.ts`) & legacy storage helpers
│   ├── types/contract.ts      # Shared contract types (synchronized with backend)
│   └── utils/                 # Geolocation, formatters, validation
├── package.json               # Root scripts (dev:all, build, test, typecheck)
└── tsconfig.json              # TypeScript compilation configuration
```

---

## 2. Branching & PR Workflow

1. **Phase & Feature Branches:**
   - Always branch from `main`:
     - Phase development: `phase/1-foundation`, `phase/2-auth`, `phase/3-emergencies`, etc.
     - Individual member features: `feat/m1-driver-ui`, `feat/m2-dispatch-sweeper`, `feat/m3-astar-search`, `feat/m4-gps-sender`.
   - Never commit directly to `main` without peer review.

2. **Cross-Member Review Matrix (Strict):**
   - Every Pull Request requires **at least one approving review** from a peer member:
     - **Member 1 (Frontend):** Reviews Member 2’s API changes that affect the UI interface or response schema.
     - **Member 2 (Backend):** Reviews Member 3’s routing and hospital recommendation service signatures and Member 4’s location ingestion format.
     - **Member 3 (Routing):** Reviews Member 2’s dispatch candidate ranking pipeline and hospital capacity scoring rules.
     - **Member 4 (Location):** Reviews Member 1’s map tracking updates and Member 2’s ambulance location service.

3. **Commit Message Conventions:**
   - Format: `<type>(<scope>): <short description>` or `phase-N: <summary>`
   - Examples:
     - `phase-1: foundation setup, audit docs, contracts, and test harness`
     - `feat(dispatch): add atomic SELECT FOR UPDATE offer lock`
     - `fix(location): reject updates with future timestamps over 5 minutes`
     - `docs(contracts): document socket.io reconnection event refetch rules`

---

## 3. Coding Standards & Ground Rules

1. **Contract Synchronization:**
   - `src/types/contract.ts` and `backend/src/types/contract.ts` must remain **100% in sync**.
   - Any new status, severity, role, or field must be added to both files simultaneously and documented in `docs/CONTRACTS.md`.
2. **Unified Error Shape:**
   - All backend errors must adhere to:
     ```json
     {
       "error": {
         "code": "VALIDATION | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMITED | INTERNAL",
         "message": "Human-readable explanation.",
         "details": []
       }
     }
     ```
3. **Database Transactions & Events:**
   - State transitions and dispatch operations must run inside database transactions (`withTransaction` or explicit `BEGIN ... COMMIT`).
   - Real-time Socket.IO events **must only fire after the transaction has successfully committed**.
4. **Honesty & Simulation Labelling:**
   - Simulated hospitals, demo ambulances, simulated telephony IVR, and estimated ETAs must be visibly labelled with `isDemo: true`, `simulated: true`, or `is_test: true` in the DB, API responses, and UI.
   - Never claim real traffic conditions; always qualify ETAs as estimates based on nominal road speeds.
5. **Quality Gates:**
   - Before requesting review or committing, run:
     ```bash
     npm run typecheck
     npm test
     ```
   - All tests must pass with 0 TypeScript compilation errors.
