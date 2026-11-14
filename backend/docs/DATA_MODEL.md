# AidFlow Data Model & Database Architecture

AidFlow uses a relational schema in PostgreSQL managed by sequential migrations (`001_init.sql`, `002_calls_and_dispatch.sql`).

---

## 1. Entity-Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ AMBULANCES : drives
    USERS ||--o{ EMERGENCIES : reports
    HOSPITALS ||--o{ EMERGENCIES : receives
    HOSPITALS ||--o{ USERS : staffs
    HOSPITALS ||--o{ ALERTS : receives
    AMBULANCES ||--o{ EMERGENCIES : assigned_to
    AMBULANCES ||--o{ DISPATCH_ATTEMPTS : offered_to
    AMBULANCES ||--o{ CALL_SESSIONS : dialed
    EMERGENCIES ||--o{ DISPATCH_ATTEMPTS : has
    EMERGENCIES ||--o{ EMERGENCY_STATUS_HISTORY : tracks
    EMERGENCIES ||--o{ ALERTS : triggers
    EMERGENCIES ||--o{ CALL_SESSIONS : origin_call
    DISPATCH_ATTEMPTS ||--o| CALL_SESSIONS : linked_ivr
    CALL_SESSIONS ||--o{ CALL_EVENTS : logs

    USERS {
        uuid id PK
        text email UK
        text password_hash
        text role
        text name
        uuid hospital_id FK
    }

    HOSPITALS {
        uuid id PK
        text name
        text address
        float lat
        float lng
        text capacity_status
        int beds
        int icu_beds
        text[] specialties
        boolean is_operational
        boolean is_demo
    }

    AMBULANCES {
        uuid id PK
        text label
        text vehicle_number UK
        uuid driver_id FK
        text status
        float lat
        float lng
        bigint last_location_seq
        timestamptz last_location_at
        boolean is_test
    }

    EMERGENCIES {
        uuid id PK
        text case_code UK
        text type
        text severity
        text status
        text source
        uuid reporter_id FK
        text reporter_name
        text reporter_phone
        float pickup_lat
        float pickup_lng
        uuid assigned_ambulance_id FK
        uuid hospital_id FK
        jsonb route_polyline
        int eta_minutes
        int retry_count
    }

    DISPATCH_ATTEMPTS {
        uuid id PK
        uuid emergency_id FK
        uuid ambulance_id FK
        int attempt_no
        text outcome
        text via
        text dtmf_input
        timestamptz offered_at
        timestamptz expires_at
        timestamptz responded_at
    }

    CALL_SESSIONS {
        uuid id PK
        text direction
        text from_number
        text to_number
        text caller_name
        text status
        uuid emergency_id FK
        uuid ambulance_id FK
        uuid dispatch_attempt_id FK
        text dtmf_input
        boolean simulated
    }

    CALL_EVENTS {
        bigserial id PK
        uuid call_session_id FK
        text type
        jsonb payload
        timestamptz at
    }

    EMERGENCY_STATUS_HISTORY {
        bigserial id PK
        uuid emergency_id FK
        text from_status
        text to_status
        uuid changed_by FK
        text note
        timestamptz changed_at
    }

    ALERTS {
        uuid id PK
        text type
        text message
        uuid emergency_id FK
        text target_role
        boolean acknowledged
        timestamptz created_at
    }
```

---

## 2. Concurrency Safety Nets & Partial Unique Indexes

1. **One Active Case Per Ambulance**:
   ```sql
   CREATE UNIQUE INDEX one_active_case_per_ambulance
     ON emergencies (assigned_ambulance_id)
     WHERE assigned_ambulance_id IS NOT NULL
       AND status IN ('assigned','en_route','reached_patient','heading_to_hospital');
   ```
2. **One Pending Attempt Per Case**:
   ```sql
   CREATE UNIQUE INDEX one_pending_attempt_per_case
     ON dispatch_attempts (emergency_id)
     WHERE outcome = 'pending';
   ```
3. **One Accepted Attempt Per Case**:
   ```sql
   CREATE UNIQUE INDEX one_accepted_attempt_per_case
     ON dispatch_attempts (emergency_id)
     WHERE outcome = 'accepted';
   ```
4. **One Outbound IVR Call Per Attempt**:
   ```sql
   CREATE UNIQUE INDEX one_call_per_dispatch_attempt
     ON call_sessions (dispatch_attempt_id)
     WHERE dispatch_attempt_id IS NOT NULL;
   ```
