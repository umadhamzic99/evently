Timestamp

: 2026-10-15 09:13:06

User

:

 

Based on our sources, what are the primary types of events our platform needs to support (e.g., 1-hour manager training vs. 3-day leadership retreat), and what unique rules apply to each?

Gemini

:

 

The platform supports four primary types of events configured through a central type registry (

event_types

), each governed by specific operational flags and system rules[cite: 2, 3]:

1-Hour Manager Workshop (

manager_workshop

)

Structure:

 Single-day (

is_multi_day = false

) and single-session (

has_sessions = false

)[cite: 2, 3].

Unique Rules:

 Requires basic event-level check-in tracking upon entry[cite: 3]. It defaults to a capacity limit of 15 participants and requires a physical room allocation[cite: 2].

3-Day Leadership Retreat (

leadership_retreat

)

Structure:

 Multi-day (

is_multi_day = true

) with a 3-day default duration and multiple discrete time-slotted sessions (

has_sessions = true

)[cite: 2, 3].

Unique Rules:

 Requires session-level attendance tracking at individual session room doors rather than a single check-in[cite: 3, 4]. Utilizes custom registration attribute fields (e.g., dietary preferences, T-shirt size, emergency contacts, accommodation needs) and defaults to a capacity of 30 participants[cite: 2, 3].

Compliance Training Cohort (

compliance_cohort

)

Structure:

 Single-day program grouped by participant cohorts (

requires_cohort = true

)[cite: 2, 3].

Unique Rules:

 Mandates passing status tracking (

passing_score_required = true

) and completion validation[cite: 2, 3]. Enforces strict, compliance-grade per-scan audit logs for post-event reconciliation with Workday Learning[cite: 3]. Default capacity is set to 50 participants[cite: 2].

Internal Summit (

internal_summit

)

Structure:

 Large-scale, multi-day (

is_multi_day = true

), multi-session (

has_sessions = true

) event supporting parallel breakout session tracks (

has_tracks = true

)[cite: 2, 3].

Unique Rules:

 Enforces multi-gate scanner access and individual session-level capacity limits for parallel breakout rooms[cite: 3]. Default capacity is scaled to 500 participants[cite: 2].

Timestamp

: 2026-10-15 09:14:22

User

:

 

these are way too specific. what if I have a 1 hour manager session for 60 people? already breaks. Or what if the multi day training is one week? we need more flexibility from the start

Gemini

:

 

You are completely right—if preset types locked down capacity or exact durations, the system would break on day one. The four event categories in the system design serve as baseline configuration templates (

default_config

), not static locks or hard limits[cite: 4].

The underlying architecture is built with a flexible four-layer model so you can override numbers, dates, and settings on any individual event without altering the system schema[cite: 4]:

Capacity is an Overrideable Instance Property:

 The 

event_types

 registry sets template defaults (e.g., 15 for a workshop), but the actual 

events

 record stores an independent 

max_capacity

 column and an event-level 

config

 JSONB object[cite: 4]. A 1-hour manager workshop for 60 people simply sets 

max_capacity: 60

 on that specific instance[cite: 4].

Duration is Date-Driven:

 Event length is determined dynamically by 

start_date

 and 

end_date

 on the 

events

 record[cite: 4]. The 

is_multi_day

 boolean flag simply signals to the UI and calendar logic that the event spans multiple days[cite: 4]; a 1-week or 2-week training runs using the exact same structure as a 3-day retreat[cite: 4].

Operational Behavior Flags vs. Numeric Limits:

 What 

event_types

 actually define are core system mechanics, not numerical caps[cite: 4]:

has_sessions

: Toggles whether check-ins happen at individual breakout room doors or once at the main entrance[cite: 4].

requires_cohort

: Controls whether participant grouping and compliance passing criteria are enforced[cite: 4].

has_tracks

: Enables multi-track parallel schedule support[cite: 4].

Schema-less Custom Attributes:

 Registration form requirements and event metadata are handled through JSONB columns (

events.attributes

 and 

registrations.custom_fields

) driven by a flexible 

event_field_definitions

 table[cite: 4]. You can add fields like dietary preferences, manager approvals, or accommodation requests to any event without running database migrations[cite: 4].

To help fine-tune the configuration model, are there specific operational rules—such as session-level attendance scanning or automated waitlist promotion—that you want facilitators to be able to toggle on or off per event?