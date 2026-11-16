# AidFlow UI and dispatch updates — 11 November 2026

## Dispatch progress
- Added a 3-second visual confirmation window to each backend-confirmed timeline stage.
- A stage receives its green check only after the confirmation window; dispatch progression remains driven by the API and does not simulate ambulance arrival.

## Control Room and tracking
- Tightened page spacing and reduced map clutter by showing the 24 nearest fleet markers and 12 nearest hospital markers on the overview map.
- Live Tracking now includes summary metrics, selectable emergency reports, satellite incident map, and organised report/response details.
- Selecting a report focuses the map and shows the available assigned ambulance and recommended hospital markers.
- Alerts now includes a satellite incident map and selected-alert detail panel; report rows can be selected.

## Delivery Patrol
- Loads all 300 units from the supplied Bengaluru ambulance dataset.
- Displays driver, vehicle, zone, type, status, and a unique non-callable demo contact placeholder for each unit.

## Hospitals
- Defaults to Bengaluru Urban, Karnataka, and shows five hospital cards in a multicolour layout.
- Adds bed, ICU, ventilator and bed-utilisation indicators.
- Values not supplied by the directory are clearly marked as demo estimates. These are not live hospital capacity or availability feeds.

## Data imports
- JSON datasets used by the frontend were copied into `src/data` and imports updated to use source files rather than importing from Vite's `public` directory.

## Validation
- Checked relative imports and TypeScript/TSX syntax.
- A full production build could not be run in this environment because project npm dependencies were not installed and the package registry was unavailable. Run `npm install` and then `npm run build` locally before presenting the project.
