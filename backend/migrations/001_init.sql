-- AidFlow schema v1. Status names match src/types/contract.ts (frontend) exactly.
-- Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ───────── hospitals ─────────
CREATE TABLE hospitals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  address         TEXT,
  phone           TEXT,
  category        TEXT,
  lat             DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng             DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  is_operational  BOOLEAN NOT NULL DEFAULT TRUE,
  capacity_status TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (capacity_status IN ('unknown','available','limited','full')),
  beds            INTEGER CHECK (beds >= 0),
  icu_beds        INTEGER CHECK (icu_beds >= 0),
  specialties     TEXT[] NOT NULL DEFAULT '{}',
  last_updated    TIMESTAMPTZ,
  is_demo         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── users (4 roles) ─────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('patient','driver','hospital','admin')),
  name          TEXT NOT NULL,
  phone         TEXT,
  hospital_id   UUID REFERENCES hospitals(id) ON DELETE SET NULL, -- only for role = 'hospital'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- ───────── ambulances ─────────
CREATE TABLE ambulances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label            TEXT NOT NULL,
  vehicle_number   TEXT NOT NULL UNIQUE,
  driver_id        UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('available','busy','offline')),
  lat              DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  lng              DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180),
  last_location_at TIMESTAMPTZ,
  is_test          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────── emergencies (cases) ─────────
CREATE SEQUENCE emergency_case_seq;

CREATE TABLE emergencies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- server-generated, unique, human-friendly, e.g. EMG-2026-0001
  case_code             TEXT NOT NULL UNIQUE
                        DEFAULT ('EMG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('emergency_case_seq')::text, 4, '0')),
  type                  TEXT NOT NULL CHECK (type IN
                          ('cardiac','accident','fire','breathing','stroke','trauma','poisoning','burn','fracture','other')),
  severity              TEXT NOT NULL CHECK (severity IN ('critical','high','medium')),
  reporter_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  reporter_name         TEXT NOT NULL,
  reporter_phone        TEXT NOT NULL,
  description           TEXT,
  pickup_lat            DOUBLE PRECISION NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng            DOUBLE PRECISION NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  pickup_address        TEXT,
  status                TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN
                          ('waiting','offered','assigned','en_route','reached_patient',
                           'heading_to_hospital','handed_over','completed','cancelled')),
  assigned_ambulance_id UUID REFERENCES ambulances(id) ON DELETE SET NULL,
  hospital_id           UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  hospital_reason       TEXT,
  eta_minutes           INTEGER CHECK (eta_minutes >= 0),   -- ESTIMATE only, no live traffic
  cancel_reason         TEXT,
  is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emergencies_status_idx   ON emergencies (status);
CREATE INDEX emergencies_reporter_idx ON emergencies (reporter_id);

-- An ambulance can hold ONLY ONE active case (safety net for the atomic assign step).
CREATE UNIQUE INDEX one_active_case_per_ambulance
  ON emergencies (assigned_ambulance_id)
  WHERE assigned_ambulance_id IS NOT NULL
    AND status IN ('assigned','en_route','reached_patient','heading_to_hospital');

-- ───────── dispatch attempts ─────────
CREATE TABLE dispatch_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id UUID NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
  ambulance_id UUID NOT NULL REFERENCES ambulances(id),
  attempt_no   INTEGER NOT NULL CHECK (attempt_no > 0),
  outcome      TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','accepted','rejected','timed_out')),
  offered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,                 -- offered_at + DISPATCH_TIMEOUT_MS (server-enforced)
  responded_at TIMESTAMPTZ,
  CHECK (expires_at > offered_at),
  UNIQUE (emergency_id, attempt_no),
  UNIQUE (emergency_id, ambulance_id)                -- never offer the same case to the same ambulance twice
);
-- Two drivers can never both win one case; only one offer is open at a time.
CREATE UNIQUE INDEX one_accepted_attempt_per_case ON dispatch_attempts (emergency_id) WHERE outcome = 'accepted';
CREATE UNIQUE INDEX one_pending_attempt_per_case  ON dispatch_attempts (emergency_id) WHERE outcome = 'pending';
CREATE INDEX dispatch_attempts_ambulance_idx ON dispatch_attempts (ambulance_id, outcome);

-- ───────── status history ─────────
CREATE TABLE emergency_status_history (
  id           BIGSERIAL PRIMARY KEY,
  emergency_id UUID NOT NULL REFERENCES emergencies(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_history_emergency_idx ON emergency_status_history (emergency_id, changed_at);

-- ───────── alerts / notifications ─────────
CREATE TABLE alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN ('dispatch','hospital','system','no_ambulance')),
  message      TEXT NOT NULL,
  emergency_id UUID REFERENCES emergencies(id) ON DELETE CASCADE,
  target_role  TEXT CHECK (target_role IN ('patient','driver','hospital','admin')),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX alerts_created_idx ON alerts (created_at DESC);

-- ───────── updated_at triggers ─────────
CREATE TRIGGER hospitals_updated   BEFORE UPDATE ON hospitals   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ambulances_updated  BEFORE UPDATE ON ambulances  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER emergencies_updated BEFORE UPDATE ON emergencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
