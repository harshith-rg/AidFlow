# AidFlow — Separate User AI Call and Control Room websites

The project runs two isolated Vite frontends and one shared Express/Socket.IO backend.

## Addresses

- **User AI Call website:** http://localhost:5174/ (the home page opens the AI Call interface)
- User AI Call direct route: http://localhost:5174/emergency
- Manual accessibility form: http://localhost:5174/emergency/accessibility
- **Employee Control Room:** http://localhost:5173/control-room
- Live tracking workspace: http://localhost:5173/live-tracking
- Alerts: http://localhost:5173/alerts
- Backend health: http://localhost:4000/health

Port 5174 is compiled with `VITE_APP_ROLE=user` and only renders the public User routes. Port 5173 is compiled with `VITE_APP_ROLE=control-room` and only renders Control Room routes. Opening `/` on port 5173 redirects to `/control-room`; opening `/` on port 5174 displays the AI Call interface from the supplied AI Call ZIP.

## Setup (Windows / VS Code)

Prerequisites: Node.js 18+ and PostgreSQL.

1. Extract the ZIP and open `AidFlow_Integrated` in VS Code.
2. In the project root terminal, run `npm install`.
3. Run `cd backend` and then `npm install`.
4. Copy `backend/.env.example` to `backend/.env`. Set `DATABASE_URL`, `DATABASE_URL_TEST`, and a private `JWT_SECRET` (at least 16 characters). Keep `CORS_ORIGIN` allowing both `http://localhost:5173` and `http://localhost:5174`.
5. Create a PostgreSQL database named `aidflow`.
6. In the project root, copy `.env.example` to `.env`. Keep `VITE_API_MODE=real` and `VITE_API_URL=http://localhost:4000`.
7. From the backend directory, run `npm run db:reset` to apply migrations and seed demo data. If the database is already initialized, use `npm run db:migrate` to apply pending migrations without resetting data.
8. Return to the project root and run `npm run dev` (equivalent to `npm run dev:all`).

The command starts the Control Room on port 5173, User AI Call website on port 5174, and backend on port 4000. Keep that one terminal open while testing; do not run two copies of the generic Vite server separately.

## Emergency alert flow

1. Open the Control Room at `http://localhost:5173/control-room` in one browser tab/window.
2. Open the User AI Call website at `http://localhost:5174/` in another tab/window.
3. Allow browser location access and microphone access (or use the text-entry control if speech recognition is unavailable).
4. Start the simulated AI call and complete the intake prompts. The AI Call frontend posts to the shared backend.
5. When the call is finalized, the backend stores the emergency, emits `case:created` and `alert:new` over Socket.IO to the admin room, and starts the configured demo dispatch workflow. The Control Room ingests the report and its `ControlRoomAlertToast` displays a compact red notification near the left side of the screen, with an optional short alert chime, emergency details, Dismiss and View details actions. The notification automatically closes after 9 seconds if it is not opened or dismissed. The persistent Sound on/off control remains available even when no notification is visible. Click inside the Control Room once (or click the sound control) to allow the browser to play alert audio; browser autoplay rules can block audio until a user interaction. Some browsers require one click in the Control Room before playing audio.

Both frontend builds use the same API URL and database. The alert requires the backend and PostgreSQL to be running; the two browser tabs do not communicate by themselves.

## Demo safety note

This is an academic software demonstration. The displayed helpline is a simulated browser call; it does not connect to telephone networks, emergency numbers, real dispatch services, or live ambulance units. Location and dispatch details may be simulated. Do not use this prototype for real emergency operations or expose its demo Control Room/backend publicly.

## AI call completion flow

The AI Call page collects five core emergency details: emergency type, patient
consciousness, breathing condition, patient count, and device GPS coordinates.
Once all five are stored by the backend, the User page advances to a review
screen for the caller's name and 10-digit mobile number. Selecting **Report
emergency to Control Room** submits those contact fields, finalizes the case,
and triggers the existing real-time Control Room emergency alert. The report
is not created until that final submit succeeds.

