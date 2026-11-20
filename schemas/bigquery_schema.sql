-- ==============================================================================
-- Evently — Phase 1: Google BigQuery Analytical Warehouse DDL
-- Denormalized, Partitioned & Clustered Schema for High-Scale Reporting
-- ==============================================================================

-- 1. Events Denormalized Reporting Table
CREATE TABLE IF NOT EXISTS `evently_analytics.events_denormalized` (
    event_id            STRING NOT NULL,
    event_type_slug     STRING NOT NULL,
    title               STRING NOT NULL,
    status              STRING NOT NULL,
    owner_user_id       STRING NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    timezone            STRING,
    max_capacity        INT64,
    waitlist_enabled    BOOL,
    waitlist_promotion_mode STRING,

    -- Dynamic event config & custom attributes as key-value structs
    config_attributes   ARRAY<STRUCT<key STRING, value STRING>>,
    custom_attributes   ARRAY<STRUCT<key STRING, value STRING>>,

    -- Sessions nested inside the event
    sessions            ARRAY<STRUCT<
        session_id      STRING,
        title           STRING,
        session_date    DATE,
        track           STRING,
        max_capacity    INT64,
        is_mandatory    BOOL
    >>,

    -- Booked resources nested inside the event
    resources           ARRAY<STRUCT<
        resource_id     STRING,
        resource_name   STRING,
        resource_type   STRING,
        session_id      STRING,
        booking_status  STRING
    >>,

    created_at          TIMESTAMP,
    updated_at          TIMESTAMP
)
PARTITION BY start_date
CLUSTER BY event_type_slug, status;

-- 2. Registrations & Attendance Analytical Table
CREATE TABLE IF NOT EXISTS `evently_analytics.registrations` (
    registration_id     STRING NOT NULL,
    event_id            STRING NOT NULL,
    participant_user_id STRING NOT NULL,
    is_external         BOOL,
    cohort_id           STRING,
    status              STRING NOT NULL,       -- registered, waitlisted, attended, no_show, cancelled
    waitlist_position   INT64,
    registered_at       TIMESTAMP NOT NULL,
    cancelled_at        TIMESTAMP,
    cancellation_reason STRING,

    -- Dynamic participant answers (e.g. dietary_preference, t_shirt_size)
    custom_fields       ARRAY<STRUCT<key STRING, value STRING>>,

    -- Full lifecycle history transitions
    status_history      ARRAY<STRUCT<
        from_status     STRING,
        to_status       STRING,
        changed_at      TIMESTAMP,
        changed_by      STRING,
        reason          STRING,
        source          STRING
    >>,

    -- Session-level check-ins
    session_checkins    ARRAY<STRUCT<
        session_id      STRING,
        status          STRING,
        checked_in_at   TIMESTAMP,
        checked_in_by   STRING,
        door_gate       STRING
    >>
)
PARTITION BY DATE(registered_at)
CLUSTER BY event_id, status;

-- 3. Door Scan Audit Trail (Compliance-Grade Log for Workday Reconciliation)
CREATE TABLE IF NOT EXISTS `evently_analytics.scan_audit_log` (
    scan_id             STRING NOT NULL,
    event_id            STRING NOT NULL,
    session_id          STRING,
    registration_id     STRING,
    participant_user_id STRING NOT NULL,
    scanner_user_id     STRING NOT NULL,
    scan_result         STRING NOT NULL,       -- SUCCESS, DUPLICATE_REJECTED, EXPIRED_TOKEN, MANUAL_OVERRIDE
    door_gate           STRING NOT NULL,
    device_fingerprint  STRING,
    override_reason     STRING,
    token_age_seconds   INT64,
    offline_buffered    BOOL,
    scanned_at          TIMESTAMP NOT NULL
)
PARTITION BY DATE(scanned_at)
CLUSTER BY event_id, scan_result;
