# AidFlow UI corrections — 11 Nov 2026 (v2)

Applied to the latest AidFlow project ZIP available in this conversation.

## Changes
- Tightened vertical spacing in Control Room between the demo banner, metric cards and fleet map.
- Tightened Alerts page spacing and retained/confirmed the satellite incident map with selectable emergency pins and a selected-report details panel.
- Reworked Live Tracking emergency rows into structured report cards showing case ID, severity, incident type, caller, location, ambulance assignment, status and reported time. Non-critical severity labels use a blue/cyan treatment rather than the former cream/gold treatment.
- Expanded Hospital Directory from a five-card preview to the full 10,843-record source directory, displayed in pages of 30 with state/district/search filters. The default view is All states / All districts.
- Generated clearly labelled synthetic bed, ICU, ventilator and utilisation figures when directory values are missing. These are demo estimates, not live availability.
- Improved hospital map pin size/anchor and map framing. The map displays up to 30 closest hospitals to Bengaluru or the user's explicitly shared browser location to avoid a cluttered nationwide pin cloud; all directory records remain available in the paginated list.
- Delivery Patrol now labels each ambulance's nearby hospital landmark and exact demo GPS coordinates instead of displaying operational zones. Coordinates and locations remain synthetic demo data, not live GPS.
- Increased emergency/report and ambulance emoji sizes so they fill their square icon containers more consistently.

## Validation
- ZIP archive integrity checked.
- Full TypeScript/Vite build could not be completed in this environment because npm dependency installation timed out; run `npm ci` and `npm run build` locally.
