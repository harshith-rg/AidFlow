\# AidFlow Routing \& Hospital Recommendation (Member 3)



DEMO prototype. All hospital data is fictional. ETA is an estimate, no live traffic.

CONTRACT.md is the source of truth.



\## Setup

&#x20;   python -m venv .venv

&#x20;   .venv\\Scripts\\activate

&#x20;   pip install -r requirements.txt



\## Run

&#x20;   uvicorn app.main:app --reload

Open http://127.0.0.1:8000/health and http://127.0.0.1:8000/docs



\## Test

&#x20;   pytest -v



\## Status

Phase 0 done (road-network feasibility). Phase 1: skeleton, config, errors, /health.

