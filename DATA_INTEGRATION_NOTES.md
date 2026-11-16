# AidFlow data integration notes

## Emergency call interaction
- The AI call microphone can be started while the assistant is speaking; starting it cancels speech synthesis.
- Finalized speech-recognition text is submitted immediately, rather than waiting for the spoken category list or requiring a second Send action.
- The text-entry path remains available as an immediate alternative.
- Browser speech recognition quality depends on browser, microphone, language model and network conditions. This remains a simulated browser call, not a connection to emergency services.

## Bengaluru map datasets
- `public/bengaluru_hospitals_merged.json`: 1,532 Bengaluru hospital records integrated from the supplied AidFlow hospital directory/GeoJSON-derived dataset.
- `public/bengaluru_ambulances_demo.json`: 300 synthetic ambulance locations supplied with the earlier AidFlow FINAL project.
- User-facing AI call map selects the 10 nearest hospital records and 10 nearest synthetic ambulance locations using Haversine distance.
- Control Room combines the stored ambulance fleet with the 300-unit synthetic dataset and renders up to 80 nearby hospital facilities from the merged hospital sources.
- Green ambulance markers and redesigned hospital markers are used on the Control Room map.

**Important:** the ambulance dataset is synthetic demo data, not live GPS telemetry. Hospital coordinates are dataset-derived and may require operational verification before real-world use. Actual real-time fleet tracking requires live ambulance GPS devices and an authenticated telemetry feed. The map imagery provider also requires network access.

## Hero
The home hero uses the existing `public/hero-city.mp4` background video. The background video is not blurred.

## Run
Install dependencies with `npm install`, configure the backend using `.env.example`, then follow `README.md` and `START_HERE.md`. Do not use this demo as a substitute for calling local emergency services.
