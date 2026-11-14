-- AI-assisted browser call intake additions; extends the existing telephony schema.
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS handled_by TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS caller_number TEXT;
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en-IN';
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS slots JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE call_sessions ADD COLUMN IF NOT EXISTS last_transcript TEXT;
ALTER TABLE call_sessions ALTER COLUMN from_number DROP NOT NULL;
ALTER TABLE call_sessions ALTER COLUMN to_number DROP NOT NULL;
ALTER TABLE call_sessions DROP CONSTRAINT IF EXISTS call_sessions_status_check;
ALTER TABLE call_sessions ADD CONSTRAINT call_sessions_status_check CHECK (status IN ('ringing','in_progress','active','completed','missed','failed','cancelled'));
ALTER TABLE emergencies DROP CONSTRAINT IF EXISTS emergencies_source_check;
ALTER TABLE emergencies ADD CONSTRAINT emergencies_source_check CHECK (source IN ('web','call','manual','ai_call'));
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN ('dispatch','hospital','system','no_ambulance','emergency_reported'));
ALTER TABLE emergencies ADD COLUMN IF NOT EXISTS triage_label TEXT;
ALTER TABLE emergencies ADD COLUMN IF NOT EXISTS triage_confidence DOUBLE PRECISION;
ALTER TABLE emergencies ADD COLUMN IF NOT EXISTS tracking_token_hash TEXT UNIQUE;
