# Start Here — AidFlow AI Call + Control Room

## Run the complete project

1. Extract this ZIP and open the `AidFlow_Integrated` folder in VS Code.
2. In the project root terminal, run `npm install`.
3. Run `cd backend` and then `npm install`.
4. Configure the two environment files using the matching `.env.example` files:
   - `AidFlow_Integrated/.env`
   - `AidFlow_Integrated/backend/.env`
5. Make sure PostgreSQL is running and the `aidflow` database exists.
6. If this is a fresh database, run `npm run db:reset` from the `backend` folder once. This resets the demo database. If you are updating an already initialized AidFlow database, do not reset it; use `npm run db:migrate` from `backend` if migrations need applying.
7. Return to the project root and run `npm run dev`.
8. Keep that terminal open while using AidFlow.

## Open the applications

- User AI Call website: http://localhost:5174/
- Employee Control Room: http://localhost:5173/control-room
- Backend health: http://localhost:4000/health

## Emergency notification

When an AI Call is finalized on the User website, the shared backend sends the new emergency to the Control Room over Socket.IO. The Control Room displays a compact red notification near the left side of the screen. It shows the emergency type, severity, location and case ID, and offers Dismiss and View details actions. It closes automatically after 9 seconds.

A Sound on/off control stays visible near the notification area. Click once inside the Control Room (or on the sound control) to allow browser audio. Alert sound can be blocked by browser autoplay settings until the page has been interacted with.

## Updating an existing local installation

If you already configured AidFlow in another extracted folder, you can copy these two private files into this version rather than creating them again:

- Existing root `.env` → new `AidFlow_Integrated/.env`
- Existing `backend/.env` → new `AidFlow_Integrated/backend/.env`

Do not share these files; they contain local database credentials and a JWT secret. Your PostgreSQL database is separate from the ZIP, so you do not need to reset it just to install this source-code update.

## Academic demonstration notice

AidFlow is a simulated academic prototype. It does not contact real emergency numbers or dispatch real ambulances. Do not use it for real emergencies or expose the demo backend/control room publicly.
