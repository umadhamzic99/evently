Timestamp

: 2026-10-15 09:01:10

User

:

 

help me tackle phase 1

Gemini

:

1. Event Types & System Rules

System rules and configurations are mapped through an event type registry (

event_types

) to support diverse L&D formats[cite: 4]:

1-Hour Manager Workshops:

 Single-day, single-session events requiring basic event-level check-in tracking[cite: 2, 4].

3-Day Leadership Retreats:

 Multi-day events (

is_multi_day = true

, 

has_sessions = true

) requiring session-level attendance tracking across discrete time slots, resource/room allocations, and custom registration fields (e.g., dietary preferences, accommodation needs)[cite: 2, 4].

Compliance Training Cohorts:

 Cohort-grouped programs (

requires_cohort = true

) requiring mandatory completion tracking, passing status, and compliance-grade per-scan audit logs for Workday Learning reconciliation[cite: 2, 4, 5].

Internal Summits:

 Multi-day, multi-track events with parallel breakout session tracks, individual session capacity limits, and multi-gate scanning[cite: 1, 2, 4].

2. Identity & Access Control

Identity Source of Truth:

 Primary participant records bind directly to corporate identity records using Workday Employee IDs or corporate emails (

participant_user_id

)[cite: 2, 4, 5].

External Contractors:

 Non-credentialed external contractors register via email-based fallback identifiers and custom registration attributes without requiring full LMS credentials[cite: 1, 2, 4].

Door Credential Mechanics:

 Verification relies on dynamic QR codes with encrypted server-side payloads and time-windowed validity[cite: 2]. Single-use locking immediately locks the code upon the first valid scan to block screenshot sharing, duplicate entries, or stale ticket reuse[cite: 2].

3. Waitlist Logic & Edge Cases

Capacity Trigger:

 When an event reaches 

max_capacity

, subsequent registrants are assigned a 

waitlist_position

[cite: 4, 5].

Promotion Logic:

 Configurable between 

Automated Promotion

 (the next waitlisted person is automatically registered and notified as soon as a cancellation occurs) and 

Manual Approval

 (a Registration Lead manually reviews and promotes waitlisted candidates)[cite: 1, 2, 5].

Critical Edge Cases:

Irreversible Waitlist Deletion:

 Disabling a waitlist mid-stream permanently removes all waitlisted learners and sends automated cancellation notices, which cannot be reversed[cite: 5].

Gaming Prevention:

 Learners can be restricted to a single waitlist per event to prevent multi-session hoarding[cite: 5].

High-Demand Overflow:

 Organizers can duplicate high-demand sessions and move waitlisted users in bulk to the new session instance[cite: 5].

4. Roles & Permissions (RBAC)

Access control follows least-privilege principles to prevent unauthorized edits and protect participant privacy[cite: 2, 5]:

Door Staff / Volunteers:

 Limited to scanning QR codes, executing partial-name/email searches, and viewing check-in feedback (green/red screens)[cite: 2]. They cannot edit attendee profiles, view sensitive registration data, or perform un-audited overrides[cite: 2].

Registration Lead / Local Learning Admin (LLA):

 Authorized to handle walk-ins and execute manual overrides (e.g., dead phone, unreadable screen)[cite: 2, 5]. Every manual override strictly requires a mandatory reason field and is tagged as "Manual" in the per-scan audit log[cite: 2].

Event Manager / Learning Administrator:

 Holds full access to build event templates, manage waitlist queues, override capacity caps, export raw audit logs, and trigger post-event completion pushes into Workday Learning[cite: 2, 5].