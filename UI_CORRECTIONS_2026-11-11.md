# AidFlow UI corrections — 11 Nov 2026

Implemented in the existing AidFlow React/Vite project:

- Reworked Live Tracking incident details into a structured incident dossier with report details, response status, four-step progress, and status history, following the supplied Incident EMG reference.
- Removed the Average ETA metric from Live Tracking.
- Kept and enlarged the Alerts satellite map, and rebuilt the alerts register using the exact columns in the supplied AidFlow alerts reference (incident, emergency type, reporter, coordinates, time, status, severity, location).
- Changed the poisoning icon to the biohazard symbol (☣️) in the emergency type choices and alert display.
- Changed the Control Room satellite map to include every geocoded hospital in `hospital_directory.json` (10,843 records) and all 300 ambulance demo directory units. Hospital pins use Leaflet canvas rendering; clicking a hospital or ambulance opens a structured details popup.
- Normalized embedded newlines in hospital names, including the first hospital in the directory.
- Removed the yellow capacity-information note from the top of the Hospital Directory page.

## Data notes

Hospital directory records are national directory locations. Ambulance positions are the supplied synthetic/demo Bengaluru fleet positions, not live GPS. Report-detail fields such as conscious/breathing status are not part of the current API contract, so the redesigned panel labels them “Not provided” rather than inventing values.

## Validation

TypeScript/TSX syntax transpilation passed for all edited source files. A full `npm run build` could not be completed because the dependency installation timed out and the partially installed `node_modules` is missing type packages (React, Leaflet, GeoJSON, etc.). Run `npm ci` in the project folder, then `npm run build` to perform the full project build.
