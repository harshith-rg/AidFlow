-- Migration 002: calls, dispatch extensions, and simulation fields

-- ───────── call_sessions ─────────
CREATE TABLE call_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction           TEXT NOT NULL CHECK (direction IN ('inbound_caller', 'outbound_driver')),
  from_number         TEXT NOT NULL,
  to_number           TEXT NOT NULL,
  caller_name         TEXT,
  status              TEXT NOT NULL DEFAULT 'ringing'
                      CHECK (status IN ('ringing', 'in_progress', 'completed', 'missed', 'failed')),
  emergency_id        UUID REFERENCES emergencies(id) ON DELETE SET NULL,
  ambulance_id        UUID REFERENCES ambulances(id) ON DELETE SET NULL,
  dispatch_attempt_id UUID REFERENCES dispatch_attempts(id) ON DELETE SET NULL,
  answered_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  dtmf_input          TEXT,
  simulated           BOOLEAN NOT NULL DEFAULT TRUE,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at         TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  end_reason          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_sessions_status_idx ON call_sessions (status);
CREATE INDEX call_sessions_emergency_idx ON call_sessions (emergency_id);
CREATE UNIQUE INDEX one_call_per_dispatch_attempt ON call_sessions (dispatch_attempt_id) WHERE dispatch_attempt_id IS NOT NULL;

CREATE TRIGGER call_sessions_updated BEFORE UPDATE ON call_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ───────── call_events ─────────
CREATE TABLE call_events (
  id              BIGSERIAL PRIMARY KEY,
  call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_events_session_idx ON call_events (call_session_id, at);

-- ───────── emergencies enhancements ─────────
ALTER TABLE emergencies
  ADD COLUMN source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'call', 'manual')),
  ADD COLUMN call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  ADD COLUMN route_polyline JSONB,
  ADD COLUMN route_distance_km NUMERIC,
  ADD COLUMN eta_source TEXT,
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN next_retry_at TIMESTAMPTZ;

-- ───────── dispatch_attempts enhancements ─────────
ALTER TABLE dispatch_attempts
  ADD COLUMN via TEXT DEFAULT 'app' CHECK (via IN ('app', 'call')),
  ADD COLUMN dtmf_input TEXT;
ALTER TABLE dispatch_attempts
  DROP CONSTRAINT IF EXISTS dispatch_attempts_emergency_id_ambulance_id_key;

-- ───────── ambulances enhancements ─────────
ALTER TABLE ambulances
  ADD COLUMN last_location_seq BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN heading NUMERIC,
  ADD COLUMN speed_kmh NUMERIC;

-- ───────── alerts enhancements ─────────
ALTER TABLE alerts
  ADD COLUMN hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL;
