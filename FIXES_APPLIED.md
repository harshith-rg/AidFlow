# AidFlow UI fixes applied

## Earlier fixes
- The AI call starts the backend session without waiting for browser GPS lookup.
- The 11 instant emergency response categories are provided as numbered quick-action buttons.
- The call button reads **Call emergency service** and clearly remains a simulated demo.
- The reported emergency uses a high-contrast red pulsing pin.
- The homepage hero retains the supplied `hero-city.mp4` video.

## Follow-up fixes (November 2026)
- Fixed the special-context visibility condition. The 11 emergency buttons now appear as soon as the AI asks the caller to select a special context. The previous condition unnecessarily gated them on phone/GPS validation.
- The map frames the reported emergency together with the five nearest hospital pins and five nearest synthetic ambulance pins. The full nearest-hospital and nearby-ambulance lists remain below the map.
- Removed the city-video background from the AI call, public tracking, and ambulance-dispatch screens. The video remains reserved for the homepage hero.
- Widened the call page wrapper so “Back to AidFlow” sits near the left edge, and strengthened the call-page heading contrast and placement.
- Removed the oversized GPS-accuracy circle so it no longer competes visually with the red emergency marker.

## Notes
- Ambulance locations are synthetic demo positions, not live GPS.
- This is a simulated student-project workflow and does not contact real emergency services.

## November 10, 2026 follow-up fixes

- The public user-site `/` route now renders the landing page (`App`), which mounts the existing `Hero` component and its looping `/hero-city.mp4` background. The AI browser-call screen is available at `/emergency`.
- Updated the hero's primary action to open the AI emergency call instead of navigating to the separate Control Room app route.
- The AI-call heading is now pinned to the viewport with responsive sizing, and the page content has top spacing so the heading does not cover the call UI while scrolling.
- Added `backend/migrations/004_ai_call_alert_compatibility.sql`, a forward-only compatibility migration that ensures the AI-call columns and `emergency_reported` alert/source constraints exist on databases created from earlier project versions.
- In development, unexpected backend errors now return the actual diagnostic message and request ID; production continues to return a generic server error. The frontend displays the request ID when supplied.

### Apply the database compatibility migration

From the project root, run:

```powershell
npm run db:migrate --prefix backend
```

Then restart the backend and both Vite apps. The user website remains on port 5174, the Control Room on its configured port, and the backend on port 4000.

## November 10, 2026 (evening) fixes

- **"alertMessage is not defined" after 7/7 details:** in `backend/src/modules/aicall/aicall.routes.ts` the `alertMessage` constant was declared inside the database transaction but used afterwards in the `alert:new` socket emit, which threw a ReferenceError (HTTP 500) *after* the case was saved. It is now declared before the transaction, so finalizing succeeds and the screen moves to the "Demo emergency registered" page. **Restart the backend.**
- **"Talk to our AI assistant" box no longer follows the scroll:** removed the `createPortal` + `position: fixed` heading; it is now a normal in-flow heading at the top of the call page and scrolls away with the content.
- **Ambulance dispatch satellite map:** the bottom "Emergency location · Satellite view" panel now stretches from the right edge of the left sidebar to the right edge of the screen (never under the sidebar) and is taller. Nothing else on the page changed.
