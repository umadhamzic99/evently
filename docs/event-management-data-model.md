Abstracted Event Management Data Model

System Design Reference for Diverse L&D Event Types


--------------------------------------------------------------------------------


0. The Core Problem (and Why It's Tricky)

A 1-hour manager workshop and a 3-day leadership retreat are both "events" — but their configuration, participant behavior, and resource needs are wildly different. If you model them in the same rigid table, you end up with dozens of nullable columns, messy JOINs, and a migration script every time someone adds "dietary preferences" to the registration form.

The goal of this design is:

A 

stable core

 that never changes (event identity, type, dates, owner)

Pluggable configuration

 per event type (multi-day sessions, capacity, agenda items)

Flexible participant data

 (custom registration fields, attendance lifecycle)

Resource allocation

 (rooms, tools, facilitators) decoupled from both


--------------------------------------------------------------------------------


1. The Four Layers of the Model

┌─────────────────────────────────────────┐
│         EVENT CONFIGURATION LAYER        │  ← What the event IS
│  event_types / events / event_sessions  │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│       CUSTOM ATTRIBUTES LAYER           │  ← Per-type flexibility (no migrations)
│  event_field_definitions / attributes  │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│         PARTICIPANT LAYER               │  ← Who is attending and how
│  registrations / attendance_log         │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│       RESOURCE ALLOCATION LAYER         │  ← Rooms, tools, facilitators
│  resources / event_resource_allocation  │
└─────────────────────────────────────────┘



--------------------------------------------------------------------------------


2. Layer 1: Event Configuration

2a. 

event_types

 — The Type Registry

This table defines what kinds of events exist and holds the config 

template

 for each type.

CREATE TABLE event_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,       -- 'workshop', 'retreat', 'summit', 'compliance_cohort'
    label           TEXT NOT NULL,              -- Human-readable name
    is_multi_day    BOOLEAN NOT NULL DEFAULT FALSE,
    has_sessions    BOOLEAN NOT NULL DEFAULT FALSE,  -- True for retreats/summits
    requires_cohort BOOLEAN NOT NULL DEFAULT FALSE,  -- True for compliance training with cohort grouping
    default_config  JSONB,                      -- Type-level defaults (e.g., max_capacity, agenda_template)
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Seed data
INSERT INTO event_types (slug, label, is_multi_day, has_sessions, requires_cohort, default_config) VALUES
('manager_workshop',    '1:1 Manager Workshop',      FALSE, FALSE, FALSE, '{"default_capacity": 15, "requires_room": true}'),
('leadership_retreat',  'Leadership Retreat',         TRUE,  TRUE,  FALSE, '{"default_capacity": 30, "requires_room": true, "default_duration_days": 3}'),
('compliance_cohort',   'Compliance Training Cohort', FALSE, FALSE, TRUE,  '{"default_capacity": 50, "passing_score_required": true}'),
('internal_summit',     'Internal Summit',            TRUE,  TRUE,  FALSE, '{"default_capacity": 500, "requires_room": true, "has_tracks": true}');


sql

2b. 

events

 — The Core Event Record

This is intentionally lean. Only universal attributes live here.

CREATE TABLE events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type_id   UUID NOT NULL REFERENCES event_types(id),
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    owner_user_id   TEXT NOT NULL,              -- FK to your HR/identity system (e.g., Workday employee ID)
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'Europe/Berlin',
    max_capacity    INT,
    waitlist_enabled BOOLEAN DEFAULT FALSE,
    registration_deadline TIMESTAMPTZ,
    config          JSONB,                      -- Event-level overrides of type defaults
    attributes      JSONB,                      -- Custom fields (see Section 3)
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for common queries
CREATE INDEX idx_events_type ON events(event_type_id);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_start_date ON events(start_date);
CREATE INDEX idx_events_attributes ON events USING GIN(attributes);


sql

Why 

config

 AND 

attributes

 as separate JSONB columns?

config

 = operational settings (capacity overrides, facilitator links, LMS course ID). Semi-structured but mostly known at design time.

attributes

 = user-defined custom fields that vary per event type (e.g., "dietary_preference", "manager_approval_required"). Unknown at design time.

2c. 

event_sessions

 — Multi-Day / Multi-Track Support

For retreats and summits that have discrete sessions within the event.

CREATE TABLE event_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    session_date    DATE NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    track           TEXT,                       -- For summits with parallel tracks (e.g., "Leadership", "Ops")
    is_mandatory    BOOLEAN DEFAULT TRUE,
    session_config  JSONB,                      -- Session-specific config (speaker, materials URL, etc.)
    sort_order      INT DEFAULT 0
);


sql


--------------------------------------------------------------------------------


3. Layer 2: Custom Attributes Without Migrations

This is where most systems break down. Three patterns handle it — each with different tradeoffs.


--------------------------------------------------------------------------------


Pattern A: JSONB Column (Recommended for most cases)

Already shown above in 

events.attributes

. The event stores its own custom field values directly.

Defining the field schema

 (so you can validate and build forms):

CREATE TABLE event_field_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type_id   UUID REFERENCES event_types(id),  -- NULL = applies to ALL types
    event_id        UUID REFERENCES events(id),        -- NULL = type-level, not event-specific
    field_key       TEXT NOT NULL,              -- The JSON key used in events.attributes
    label           TEXT NOT NULL,
    field_type      TEXT NOT NULL               -- 'text', 'select', 'boolean', 'date', 'number', 'multiselect'
                    CHECK (field_type IN ('text', 'select', 'boolean', 'date', 'number', 'multiselect')),
    is_required     BOOLEAN DEFAULT FALSE,
    options         JSONB,                      -- For select/multiselect: ["Option A", "Option B"]
    applies_to      TEXT NOT NULL DEFAULT 'event'
                    CHECK (applies_to IN ('event', 'registration')),  -- Is this on the event config or the reg form?
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_type_id, event_id, field_key, applies_to)
);

-- Example: Leadership Retreat gets a "facilitator_company" field on the event config
INSERT INTO event_field_definitions (event_type_id, field_key, label, field_type, applies_to)
SELECT id, 'facilitator_company', 'Facilitator Company', 'text', 'event'
FROM event_types WHERE slug = 'leadership_retreat';

-- Example: All events get a "dietary_preference" field on the registration form
INSERT INTO event_field_definitions (field_key, label, field_type, options, applies_to, is_required)
VALUES ('dietary_preference', 'Dietary Preference', 'select',
        '["None", "Vegetarian", "Vegan", "Gluten-Free", "Halal", "Kosher"]', 'registration', FALSE);


sql

Querying custom attributes in BigQuery

 (after exporting):

-- Find all leadership retreats run by Acme Learning
SELECT
    id,
    title,
    JSON_VALUE(attributes, '$.facilitator_company') AS facilitator_company,
    start_date
FROM events
WHERE event_type_id = (SELECT id FROM event_types WHERE slug = 'leadership_retreat')
  AND JSON_VALUE(attributes, '$.facilitator_company') = 'Acme Learning';


sql

In 

BigQuery native

, use 

JSON_VALUE()

 or 

JSON_QUERY()

 on STRING JSON columns, or store attributes as a 

STRUCT

 / 

ARRAY<STRUCT<key STRING, value STRING>>

 for cheaper querying at scale.


--------------------------------------------------------------------------------


Pattern B: Entity-Attribute-Value (EAV) Table

Use when you need to query across custom fields with SQL JOINs, or when the attribute space is very large and sparse.

CREATE TABLE event_attributes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    field_key       TEXT NOT NULL,
    value_text      TEXT,
    value_number    NUMERIC,
    value_boolean   BOOLEAN,
    value_date      DATE,
    value_json      JSONB,                      -- For multi-select or complex values
    UNIQUE(event_id, field_key)
);

-- Querying via EAV (more verbose, but SQL-filterable)
SELECT e.title, a.value_text AS facilitator_company
FROM events e
JOIN event_attributes a ON a.event_id = e.id AND a.field_key = 'facilitator_company'
WHERE a.value_text = 'Acme Learning';


sql

When to use EAV vs JSONB:

Situation

Use

Attributes are sparse, user-defined, or change frequently

JSONB column

You need to JOIN or aggregate across custom attribute values

EAV table

You're on BigQuery and need cost-efficient column pruning

JSONB as STRING, query with JSON_VALUE

You need type safety and DB-level constraints on custom fields

EAV (you can apply CHECK constraints per field_key)


--------------------------------------------------------------------------------


Pattern C: Firestore Document Model

If you're using Firestore (e.g., for a real-time registration interface), events are documents with fully flexible fields.

// Collection: events / Document: {event_id}
{
  "id": "evt_abc123",
  "eventTypeSlug": "leadership_retreat",
  "title": "Leadership Basecamp — Cohort 4",
  "status": "published",
  "ownerUserId": "emp_lead_001",
  "startDate": "2026-11-10",
  "endDate": "2026-11-12",
  "timezone": "Europe/Berlin",
  "maxCapacity": 30,
  "waitlistEnabled": true,
  "config": {
    "facilitatorCompany": "Acme Learning",
    "lmsCourseId": "WDL_LBC_004",
    "requiresManagerApproval": true
  },
  "customAttributes": {
    "targetAudience": "People Managers",
    "programPillar": "Leadership",
    "budgetCode": "L&D-2026-Q4"
  },
  "sessions": [
    {
      "sessionId": "sess_001",
      "title": "Opening & Context Setting",
      "date": "2026-11-10",
      "startTime": "09:00",
      "endTime": "12:00",
      "isMandatory": true
    }
  ],
  "createdAt": "2026-10-01T09:00:00Z",
  "updatedAt": "2026-10-15T14:32:00Z"
}


json

Subcollections handle participant data (see Section 4).


--------------------------------------------------------------------------------


4. Layer 3: Participant Data and Attendance Lifecycle

Key principle:

 Participant data is completely decoupled from event configuration. The 

registrations

 table only knows the event ID — it does not care about session structure, type config, or custom event attributes.

4a. 

registrations

 — The Core Enrollment Record

CREATE TABLE registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id),
    participant_user_id TEXT NOT NULL,          -- FK to your identity system (Workday employee ID, email, etc.)
    cohort_id           UUID REFERENCES cohorts(id),  -- For compliance training cohort grouping (nullable)
    status              TEXT NOT NULL DEFAULT 'registered'
                        CHECK (status IN ('registered', 'waitlisted', 'attended', 'no_show', 'cancelled')),
    registered_at       TIMESTAMPTZ DEFAULT now(),
    waitlist_position   INT,                    -- Non-null only when status = 'waitlisted'
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    custom_fields       JSONB,                  -- Participant answers to event_field_definitions (applies_to='registration')
    notes               TEXT,                   -- Internal coordinator notes
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, participant_user_id)
);

CREATE INDEX idx_registrations_event ON registrations(event_id);
CREATE INDEX idx_registrations_user ON registrations(participant_user_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_custom ON registrations USING GIN(custom_fields);


sql

Example: custom_fields for a leadership retreat registration

{
  "dietary_preference": "Vegetarian",
  "manager_approved": true,
  "t_shirt_size": "M",
  "emergency_contact": "Jane Doe � +1 555 0199",
  "accommodation_required": true
}


json

No migration needed when you add "accommodation_required" to the form — it just appears in new registration rows.

4b. 

attendance_log

 — Full Lifecycle History

Don't update status in place without tracking it. This table is your audit trail.

CREATE TABLE attendance_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    event_id        UUID NOT NULL REFERENCES events(id),
    from_status     TEXT,                       -- NULL on first entry
    to_status       TEXT NOT NULL,
    changed_by      TEXT,                       -- User ID of coordinator who made the change
    changed_at      TIMESTAMPTZ DEFAULT now(),
    reason          TEXT,                       -- Optional context
    source          TEXT                        -- 'lms_sync', 'coordinator_manual', 'self_cancellation', 'auto_waitlist_promote'
);


sql

The status lifecycle:

                    ┌──────────────┐
         Full?  Yes │  WAITLISTED  │◄───────────────────────┐
                    └──────┬───────┘                        │
                           │ Spot opens                     │
                           ▼                                │
[Start] ──────────► REGISTERED ──────────────────► CANCELLED
                           │                                │
              Event held   │                                │
                    ┌──────┴───────┐                        │
                    ▼             ▼                         │
                ATTENDED       NO_SHOW                      │
                                  │                         │
                                  └─────────────────────────┘
                                     (coordinator can cancel after no-show)


4c. 

cohorts

 — For Compliance Training Groupings

CREATE TABLE cohorts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id),
    name            TEXT NOT NULL,              -- e.g., "Berlin Q4 Cohort", "Remote EMEA Group A"
    start_date      DATE,
    end_date        DATE,
    max_size        INT,
    completion_deadline DATE,
    config          JSONB                       -- cohort-specific rules (passing score, mandatory modules)
);


sql

4d. Session-Level Attendance (Multi-Day Events)

For retreats and summits where you track attendance per session, not just the event:

CREATE TABLE session_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    session_id      UUID NOT NULL REFERENCES event_sessions(id),
    status          TEXT NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered', 'attended', 'no_show', 'excused')),
    checked_in_at   TIMESTAMPTZ,
    checked_in_by   TEXT,
    UNIQUE(registration_id, session_id)
);


sql

4e. Firestore Equivalent (Subcollection Pattern)

// events/{event_id}/registrations/{participant_user_id}
{
  "participantUserId": "emp_10492",
  "status": "registered",
  "waitlistPosition": null,
  "registeredAt": "2026-10-12T10:00:00Z",
  "customFields": {
    "dietary_preference": "Vegan",
    "manager_approved": true,
    "accommodation_required": false
  },
  "statusHistory": [
    { "from": null, "to": "registered", "at": "2026-10-12T10:00:00Z", "by": "self" },
    { "from": "registered", "to": "waitlisted", "at": "2026-10-13T09:00:00Z", "by": "auto_system" }
  ]
}


json

Firestore transactions handle capacity checks atomically (increment 

registeredCount

, check against 

maxCapacity

 in a single transaction — the standard atomic transactional pattern).


--------------------------------------------------------------------------------


5. Layer 4: Room and Resource Allocation

Resources are decoupled from both event config and participant data. An event can have zero or many resources.

5a. 

resources

 — The Resource Catalog

CREATE TABLE resources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    resource_type   TEXT NOT NULL
                    CHECK (resource_type IN ('room', 'virtual_link', 'equipment', 'catering', 'facilitator', 'external_tool')),
    location        TEXT,                       -- Building, floor, or URL
    capacity        INT,                        -- For rooms: max people
    attributes      JSONB,                      -- e.g., {"has_av": true, "video_conferencing": "zoom", "accessibility": true}
    is_active       BOOLEAN DEFAULT TRUE
);

-- Examples
INSERT INTO resources (name, resource_type, location, capacity, attributes) VALUES
('Main Auditorium Room 4A',     'room',          'Building 1 Floor 4', 40,   '{"has_av": true, "video_conferencing": "zoom"}'),
('Acme Learning Facilitator', 'facilitator', NULL,              NULL, '{"company": "Acme Learning", "contact": "contact@acmelearning.com"}'),
('Miro Workspace Link',   'virtual_link',  NULL,              NULL, '{"url": "https://miro.com/board/xxx"}'),
('Catering - Veggie Pack', 'catering',     NULL,              NULL, '{"per_person_cost_eur": 15}');


sql

5b. 

event_resource_allocations

 — What's Booked for What

CREATE TABLE event_resource_allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_id      UUID REFERENCES event_sessions(id),  -- NULL = whole event, non-null = specific session
    resource_id     UUID NOT NULL REFERENCES resources(id),
    start_datetime  TIMESTAMPTZ NOT NULL,
    end_datetime    TIMESTAMPTZ NOT NULL,
    quantity        INT DEFAULT 1,              -- For catering: number of units/people
    booking_status  TEXT NOT NULL DEFAULT 'tentative'
                    CHECK (booking_status IN ('tentative', 'confirmed', 'cancelled')),
    booked_by       TEXT,
    notes           TEXT,
    UNIQUE(resource_id, start_datetime, end_datetime)  -- Prevents double-booking
);


sql

Conflict detection query:

-- Check if a room is available before booking
SELECT id, event_id, start_datetime, end_datetime
FROM event_resource_allocations
WHERE resource_id = 'room_4a_id'
  AND booking_status != 'cancelled'
  AND start_datetime < '2026-11-12 18:00:00'
  AND end_datetime   > '2026-11-10 09:00:00';
-- If this returns rows: the room is unavailable in that window.


sql


--------------------------------------------------------------------------------


6. BigQuery Schema: Analytics-Optimized Variant

In BigQuery, you often want a denormalized structure for cheap, fast reporting. The pattern is: one event row, with participants and sessions as 

REPEATED STRUCTS

 nested inside.

-- BigQuery DDL
CREATE TABLE IF NOT EXISTS `evently_analytics.events_denormalized` (
    event_id          STRING NOT NULL,
    event_type_slug   STRING,
    title             STRING,
    status            STRING,
    owner_user_id     STRING,
    start_date        DATE,
    end_date          DATE,
    max_capacity      INT64,

    -- Custom event config as a key-value array (avoids schema changes for new fields)
    config_attributes ARRAY<STRUCT<key STRING, value STRING>>,

    -- Sessions nested inside the event
    sessions          ARRAY<STRUCT<
        session_id    STRING,
        title         STRING,
        session_date  DATE,
        track         STRING,
        is_mandatory  BOOL
    >>,

    -- Resources nested inside the event
    resources         ARRAY<STRUCT<
        resource_id   STRING,
        resource_name STRING,
        resource_type STRING,
        session_id    STRING
    >>,

    created_at        TIMESTAMP,
    updated_at        TIMESTAMP
)
PARTITION BY start_date
CLUSTER BY event_type_slug, status;


sql

Participants are kept in a 

separate

 BigQuery table to avoid row explosion (each participant × each event = expensive joins):

CREATE TABLE IF NOT EXISTS `evently_analytics.registrations` (
    registration_id     STRING NOT NULL,
    event_id            STRING NOT NULL,
    participant_user_id STRING NOT NULL,
    status              STRING,             -- registered, waitlisted, attended, no_show, cancelled
    registered_at       TIMESTAMP,
    cancelled_at        TIMESTAMP,

    -- Custom registration fields as key-value pairs
    custom_fields       ARRAY<STRUCT<key STRING, value STRING>>,

    -- Full status history (no separate table needed in BQ)
    status_history      ARRAY<STRUCT<
        from_status   STRING,
        to_status     STRING,
        changed_at    TIMESTAMP,
        changed_by    STRING,
        source        STRING
    >>
)
PARTITION BY DATE(registered_at)
CLUSTER BY event_id, status;


sql

Sample BigQuery report: attendance rate by event type

SELECT
    e.event_type_slug,
    COUNT(DISTINCT r.registration_id)                                         AS total_registrations,
    COUNTIF(r.status = 'attended')                                            AS attended,
    COUNTIF(r.status = 'no_show')                                             AS no_shows,
    COUNTIF(r.status = 'cancelled')                                           AS cancellations,
    ROUND(COUNTIF(r.status = 'attended') / COUNT(DISTINCT r.registration_id) * 100, 1) AS attendance_rate_pct
FROM `evently_analytics.events_denormalized` e
JOIN `evently_analytics.registrations` r ON r.event_id = e.event_id
WHERE e.start_date BETWEEN '2026-01-01' AND '2026-12-31'
GROUP BY e.event_type_slug
ORDER BY attendance_rate_pct DESC;


sql


--------------------------------------------------------------------------------


7. Full ERD Summary

event_types ──< events ──< event_sessions
                  │               │
                  │               └──< session_attendance ──> registrations
                  │
                  ├──< registrations ──< attendance_log
                  │         │
                  │         └── (cohorts)
                  │
                  └──< event_resource_allocations >── resources
                              │
                              └── (optional: linked to event_sessions)

event_field_definitions ── linked to event_types or events
                           ── drives form building for events.attributes
                              and registrations.custom_fields



--------------------------------------------------------------------------------


8. Key Design Decisions to Confirm Before Building

These are the questions worth answering with key program coordinators and stakeholders before you commit to any implementation:

Identity source of truth

 — Are participants identified by Workday employee IDs, Google Workspace emails, or both? This affects every FK in the registrations table.

Who owns custom field definitions?

 — Can any event coordinator add a new registration field, or does it go through a central process? Ungated field creation leads to data chaos fast.

Do you need session-level attendance, or is event-level enough?

 — Session-level tracking adds complexity; only worth it if you actually report on it.

Is Workday Learning the record of completion?

 — If so, your SQL schema is probably a pre-LMS coordination layer, and you need a sync mechanism (webhook or scheduled export) to reconcile status.

BigQuery vs Firestore vs both?

 — Firestore is great for real-time registration UX; BigQuery is great for reporting. Many teams use both (Firestore as operational store, sync to BQ for analytics).

How do you handle waitlist promotion?

 — Manual (coordinator promotes) or automatic (trigger fires when a cancellation happens)? Automatic promotion requires a queue or Cloud Function.

Multi-currency resource costs?

 — If you want to track L&D spend per event, you need a currency field on resource allocations from the start.


--------------------------------------------------------------------------------


Schema version: v1.0 | Designed: October 2026 | Author: Evently Team