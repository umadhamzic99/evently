-- ==============================================================================
-- Evently — Phase 1: PostgreSQL Relational Database Schema
-- Architecture: 4-Layer Pluggable Event Management System
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- LAYER 1: EVENT CONFIGURATION LAYER (What the event IS)
-- ==============================================================================

-- 1a. Event Types Registry (Baseline Templates)
CREATE TABLE IF NOT EXISTS event_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,          -- 'manager_workshop', 'leadership_retreat', 'compliance_cohort', 'internal_summit'
    label           TEXT NOT NULL,                 -- Human-readable name
    is_multi_day    BOOLEAN NOT NULL DEFAULT FALSE,
    has_sessions    BOOLEAN NOT NULL DEFAULT FALSE,-- True for retreats/summits with breakout doors
    requires_cohort BOOLEAN NOT NULL DEFAULT FALSE,-- True for compliance programs with cohort grouping
    has_tracks      BOOLEAN NOT NULL DEFAULT FALSE,-- True for multi-track summits
    default_config  JSONB NOT NULL DEFAULT '{}'::jsonb, -- Type-level defaults (default_capacity, requires_room)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Baseline Templates
INSERT INTO event_types (slug, label, is_multi_day, has_sessions, requires_cohort, has_tracks, default_config) VALUES
('manager_workshop',   '1-Hour Manager Workshop',    FALSE, FALSE, FALSE, FALSE, '{"default_capacity": 15, "requires_room": true}'::jsonb),
('leadership_retreat', '3-Day Leadership Retreat',   TRUE,  TRUE,  FALSE, FALSE, '{"default_capacity": 30, "requires_room": true, "default_duration_days": 3}'::jsonb),
('compliance_cohort',  'Compliance Training Cohort', FALSE, FALSE, TRUE,  FALSE, '{"default_capacity": 50, "passing_score_required": true}'::jsonb),
('internal_summit',    'Internal Summit',            TRUE,  TRUE,  FALSE, TRUE,  '{"default_capacity": 500, "requires_room": true, "has_tracks": true}'::jsonb)
ON CONFLICT (slug) DO UPDATE 
SET label = EXCLUDED.label,
    is_multi_day = EXCLUDED.is_multi_day,
    has_sessions = EXCLUDED.has_sessions,
    requires_cohort = EXCLUDED.requires_cohort,
    has_tracks = EXCLUDED.has_tracks,
    default_config = EXCLUDED.default_config;

-- 1b. Events (The Core Event Record - Intentionally Lean)
CREATE TABLE IF NOT EXISTS events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type_id         UUID NOT NULL REFERENCES event_types(id) ON DELETE RESTRICT,
    title                 TEXT NOT NULL,
    description           TEXT,
    status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'published', 'in_progress', 'cancelled', 'completed')),
    owner_user_id         TEXT NOT NULL,               -- Workday Employee ID or Corporate Email
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    timezone              TEXT NOT NULL DEFAULT 'Europe/Berlin',
    max_capacity          INT NOT NULL CHECK (max_capacity >= 0),
    waitlist_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    waitlist_promotion_mode TEXT NOT NULL DEFAULT 'automatic'
                          CHECK (waitlist_promotion_mode IN ('automatic', 'manual_approval')),
    registration_deadline TIMESTAMPTZ,
    config                JSONB NOT NULL DEFAULT '{}'::jsonb, -- Operational parameters (facilitator links, LMS course ID)
    attributes            JSONB NOT NULL DEFAULT '{}'::jsonb, -- Dynamic coordinator custom attributes
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_attributes ON events USING GIN(attributes);

-- 1c. Event Sessions (Multi-Day and Multi-Track Support)
CREATE TABLE IF NOT EXISTS event_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    session_date    DATE NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    track           TEXT,                               -- e.g. "Leadership", "Engineering", "People Ops"
    max_capacity    INT,                                -- Room/session specific limit
    is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
    session_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_session_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_sessions_event ON event_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON event_sessions(session_date);

-- ==============================================================================
-- LAYER 2: CUSTOM ATTRIBUTES LAYER (Schema-less flexibility without migrations)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS event_field_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type_id   UUID REFERENCES event_types(id) ON DELETE CASCADE,  -- NULL = global across all types
    event_id        UUID REFERENCES events(id) ON DELETE CASCADE,       -- NULL = type-level, non-null = event instance specific
    field_key       TEXT NOT NULL,                                      -- e.g., 'dietary_preference', 't_shirt_size'
    label           TEXT NOT NULL,
    field_type      TEXT NOT NULL 
                    CHECK (field_type IN ('text', 'textarea', 'select', 'multiselect', 'boolean', 'date', 'number')),
    is_required     BOOLEAN NOT NULL DEFAULT FALSE,
    options         JSONB,                                              -- E.g. ["Vegetarian", "Vegan", "Gluten-Free"]
    applies_to      TEXT NOT NULL DEFAULT 'registration'
                    CHECK (applies_to IN ('event', 'registration')),    -- Event metadata vs. Registration form
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_field_def ON event_field_definitions 
(COALESCE(event_type_id, '00000000-0000-0000-0000-000000000000'::uuid), 
 COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), 
 field_key, 
 applies_to);

-- ==============================================================================
-- LAYER 3: PARTICIPANT LAYER (Attendance Lifecycle, Waitlists & Security)
-- ==============================================================================

-- 3a. Cohorts (Grouping for Compliance Programs)
CREATE TABLE IF NOT EXISTS cohorts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,                                  -- e.g. "Berlin Q4 Cohort", "Remote EMEA"
    start_date          DATE,
    end_date            DATE,
    max_size            INT,
    completion_deadline DATE,
    config              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3b. Registrations (Core Enrollment Record)
CREATE TABLE IF NOT EXISTS registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_user_id TEXT NOT NULL,                                  -- Workday Employee ID, corporate email, or ext:contractor
    is_external         BOOLEAN NOT NULL DEFAULT FALSE,                 -- True for external contractors
    cohort_id           UUID REFERENCES cohorts(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered', 'waitlisted', 'attended', 'no_show', 'cancelled')),
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    waitlist_position   INT,                                            -- Assigned when status = 'waitlisted'
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    custom_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,             -- Values for event_field_definitions
    qr_secret_salt      TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'), -- Per-attendee crypto nonce
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(event_id, participant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_user ON registrations(participant_user_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_custom ON registrations USING GIN(custom_fields);

-- 3c. Session-Level Attendance (For Multi-Day/Multi-Track Events)
CREATE TABLE IF NOT EXISTS session_attendance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    session_id          UUID NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered', 'attended', 'no_show', 'excused')),
    checked_in_at       TIMESTAMPTZ,
    checked_in_by       TEXT,                                           -- Scanner operator user ID
    door_gate           TEXT,                                           -- E.g. "Room 4B Entrance"
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(registration_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_att_session ON session_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_session_att_reg ON session_attendance(registration_id);

-- 3d. Attendance Lifecycle History (Audit Log of Status Transitions)
CREATE TABLE IF NOT EXISTS attendance_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    from_status         TEXT,                                           -- NULL on initial enrollment
    to_status           TEXT NOT NULL,
    changed_by          TEXT NOT NULL,                                  -- System or operator user ID
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason              TEXT,                                           -- Required for manual overrides
    source              TEXT NOT NULL                                   -- 'qr_door_scan', 'auto_waitlist_promote', 'coordinator_manual', 'self_cancellation', 'lms_reconciliation'
);

CREATE INDEX IF NOT EXISTS idx_att_log_reg ON attendance_log(registration_id);
CREATE INDEX IF NOT EXISTS idx_att_log_event ON attendance_log(event_id);

-- 3e. Scan Audit Log (Compliance-Grade Door Verification Log)
CREATE TABLE IF NOT EXISTS scan_audit_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id          UUID REFERENCES event_sessions(id) ON DELETE SET NULL,
    registration_id     UUID REFERENCES registrations(id) ON DELETE SET NULL,
    participant_user_id TEXT NOT NULL,
    scanner_user_id     TEXT NOT NULL,
    scan_result         TEXT NOT NULL
                        CHECK (scan_result IN ('SUCCESS', 'DUPLICATE_REJECTED', 'EXPIRED_TOKEN', 'INVALID_SIGNATURE', 'MANUAL_OVERRIDE', 'UNREGISTERED')),
    door_gate           TEXT NOT NULL,
    device_fingerprint  TEXT,
    override_reason     TEXT,                                           -- Mandatory if scan_result = 'MANUAL_OVERRIDE'
    token_age_seconds   INT,
    offline_buffered    BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_audit_event ON scan_audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_scan_audit_user ON scan_audit_log(participant_user_id);
CREATE INDEX IF NOT EXISTS idx_scan_audit_result ON scan_audit_log(scan_result);

-- ==============================================================================
-- LAYER 4: RESOURCE ALLOCATION LAYER (Rooms, Tools & Facilitators)
-- ==============================================================================

-- 4a. Resources Catalog
CREATE TABLE IF NOT EXISTS resources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    resource_type       TEXT NOT NULL
                        CHECK (resource_type IN ('room', 'virtual_link', 'equipment', 'catering', 'facilitator', 'external_tool')),
    location            TEXT,                                           -- Building, floor, room number, or URL
    capacity            INT,                                            -- Max room capacity
    attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,             -- {"has_av": true, "video_conferencing": "zoom"}
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4b. Event Resource Allocations (Prevents Double-Booking)
CREATE TABLE IF NOT EXISTS event_resource_allocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id          UUID REFERENCES event_sessions(id) ON DELETE CASCADE, -- NULL = whole event
    resource_id         UUID NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    start_datetime      TIMESTAMPTZ NOT NULL,
    end_datetime        TIMESTAMPTZ NOT NULL,
    quantity            INT NOT NULL DEFAULT 1,
    booking_status      TEXT NOT NULL DEFAULT 'tentative'
                        CHECK (booking_status IN ('tentative', 'confirmed', 'cancelled')),
    booked_by           TEXT NOT NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_booking_window CHECK (end_datetime > start_datetime)
);

-- Unique index prevents physical room double-booking
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_resource_window 
ON event_resource_allocations (resource_id, start_datetime, end_datetime)
WHERE booking_status != 'cancelled';
