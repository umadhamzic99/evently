# Evently — Phase 1: Blueprinting & Product Specification

**Project:** Evently (Enterprise L&D Event Management System)  
**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Linked Knowledge Base:** `Event Management System` (`7561820b-d9d3-4c6f-8740-ac5c78c7de8b`)  
**Target Systems:** Google Workspace (HtmlService / Apps Script), Google Cloud Platform (Cloud Tasks, Cloud Run, BigQuery), Workday Learning LMS.

---

## 1. Executive Summary & Architectural Philosophy

### 1.1 The Core Problem
In enterprise People & Growth (P&G) / Learning & Development (L&D) environments, events range from a simple 1-hour manager coaching session to a 3-day multi-track leadership summit or mandatory compliance cohorts. Traditional tools fail because:
1. **Rigid Schemas:** Statically designed tables end up with dozens of nullable columns and break whenever custom registration fields (e.g., dietary requirements, accommodation) are introduced.
2. **Concurrent Check-In Bottlenecks:** Direct writes to spreadsheet backends (Google Sheets) collapse under burst traffic (50+ scans/minute) due to cell locking and API rate limits.
3. **Flawed Security & Verification:** Static QR codes and unauthenticated paper lists allow screenshot sharing, proxy check-ins, and inaccurate LMS compliance records.
4. **Venue Network Fragility:** Hotel or venue basements experience Wi-Fi drops, causing check-in lines to stall unless a resilient offline-first architecture is established.

### 1.2 The "Airport Terminal" Mental Model
Evently separates check-in execution from background heavy lifting using an Airport Check-In Terminal paradigm:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                FRONT TERMINAL (Browser UI)                             │
│   Pass Station (HtmlService Web App)  ──►  Local Boarding Binder (localStorage Cache)  │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Async Request (google.script.run)
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                MIDDLEWARE GATEWAY (Apps Script / Cloud API)            │
│   Border Control (Auth Guard)         ──►  Conveyor Belt (Pub/Sub / Cloud Tasks Queue)   │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Heavy Workload Handoff
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                BACK-OFFICE FACTORY (GCP)                               │
│   Flight Manifest (BigQuery Store)   ──►  Pass Printer (Drive PDF & Calendar API)        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Local Boarding Binder (`localStorage` inside `HtmlService`)**: When venue Wi-Fi drops, gate staff never stop scanning. Scans are buffered offline in client storage with instant visual confirmation and automatically flushed when connectivity resumes.
2. **Border Control (Apps Script Gateway)**: Validates scanner credentials, verifies HMAC signatures, and admits participants into a durable buffer without blocking the line.
3. **Conveyor Belt & Factory Worker (Cloud Tasks / Pub/Sub + Cloud Run)**: Offloads heavy asset generation (PDF certificates in Google Drive, dynamic calendar updates via Calendar API, Workday sync batches) away from the user-facing web interface.
4. **Authoritative Flight Manifest (BigQuery / SQL Store)**: Acts as the single source of truth for immutable attendance logs, keeping Google Sheets strictly as a read-only or operational projection for coordinators.

---

## 2. Pillar 1: Event Types & System Rules Framework

### 2.1 The Four Baseline Event Templates
Evently provides four foundational configuration templates in the `event_types` registry:

| Event Type Slug | Default Label | Multi-Day | Has Sessions | Requires Cohort | Default Capacity | Key Operational Rule |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `manager_workshop` | 1-Hour Manager Workshop | `false` | `false` | `false` | 15 | Basic event-level entry check-in; physical room required. |
| `leadership_retreat`| Leadership Retreat | `true` (3 days) | `true` | `false` | 30 | Session-level door scanning; custom registration attributes required (dietary, t-shirt, accommodation). |
| `compliance_cohort` | Compliance Training Cohort | `false` | `false` | `true` | 50 | Mandatory passing score validation; compliance-grade immutable scan audit logs for Workday reconciliation. |
| `internal_summit` | Internal Summit | `true` (2-5 days)| `true` (tracks) | `false` | 500 | Multi-gate scanner access; breakout session-level capacity constraints and track management. |

### 2.2 Instance-Level Override Architecture
Preset event types are **baseline templates**, not immutable constraints. Any event instance can override parameters without schema modifications:
1. **Dynamic Capacity:** `max_capacity` is an explicit column on the `events` table. A 60-person manager workshop simply sets `max_capacity = 60`.
2. **Date-Driven Duration:** Duration is governed by `start_date` and `end_date`. A 1-week or 2-week retreat uses the `leadership_retreat` type without schema alterations.
3. **Behavioral Flags:** Core mechanics are controlled by booleans:
   - `has_sessions`: Controls whether check-in QR scanners scan at individual breakout doors or once at the main entrance.
   - `requires_cohort`: Controls whether cohort grouping, passing criteria, and LMS compliance reconciliation are enforced.
   - `has_tracks`: Enables parallel breakout schedule streams.
4. **Operational Settings vs. Dynamic Attributes:**
   - `config` (JSONB): Operational parameters known at configuration time (e.g., facilitator links, LMS Course ID, minimum attendance duration).
   - `attributes` (JSONB): Dynamic metadata defined by coordinators via `event_field_definitions` (e.g., budget codes, pillar alignment).

---

## 3. Pillar 2: Identity & Access Control

### 3.1 Identity Resolution Strategy
The system handles both corporate employees and external contractors:
- **Corporate Employees (Primary Source of Truth):**
  - Primary identifier (`participant_user_id`): Workday Employee ID (e.g., `EMP-10492`) or corporate Google Workspace email (`user@company.com`).
  - Seamlessly links to corporate identity records, department hierarchies, and Workday Learning transcripts.
- **External Contractors & Partners:**
  - Registered via email fallback identifier (e.g., `ext:contractor@partner.com`).
  - Captured alongside required contractor fields (vendor company, non-disclosure confirmation, external host sponsor).
  - Flags prevent invalid direct sync to internal Workday employee profiles while preserving complete door attendance history.

### 3.2 Dynamic Door Credential Mechanics (Cryptographic QR)
Static QR codes (e.g., simple raw email strings) allow screenshot sharing, credential forging, and stale ticket reuse. Evently enforces **Dynamic Signed QR Tokens**:

```
Token Structure:
Base64Url( Payload ) + "." + HMAC_SHA256( Payload, SecretKey )

Payload JSON:
{
  "tid": "reg_uuid_v4",          // Registration ID
  "eid": "evt_uuid_v4",          // Event ID
  "sid": "sess_uuid_v4",         // Session ID (optional for event-level)
  "uid": "EMP-10492",            // Participant User ID
  "iat": 1776412800,             // Issued At (Epoch seconds)
  "exp": 1776427200,             // Expires At (Strict time-window)
  "ver": 1,                      // Token schema version
  "nonce": "a8f3b2c1"            // Random cryptographic salt
}
```

#### Security Guardrails:
1. **Time-Windowed Validity:** Tokens expire outside the event/session check-in window (e.g., valid from 30 minutes before session start until session conclusion).
2. **Single-Use Server Invalidation:** Upon the first successful scan, the server marks the registration/session token as consumed in an in-memory/cache store and records it in the authoritative database.
3. **Anti-Replay / Screenshot Defense:** If Attendee A screenshots their QR code and gives it to Attendee B:
   - Scan 1 at Door 1: **Admitted (Green Screen)**.
   - Scan 2 at Door 2: **Rejected (Red Screen)** with immediate feedback: `"Duplicate Scan: Already Checked In at 09:14:22 by Door 1 (Volunteer John)"`.
4. **Door Feedback Latency:** Scanner client receives immediate visual green/red feedback within <200ms.

---

## 4. Pillar 3: Waitlist State Machine & Edge Cases

### 4.1 Waitlist Lifecycle State Machine
When an event reaches `max_capacity`, subsequent registrants enter the `waitlisted` status with an incremental integer `waitlist_position`.

```
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
```

### 4.2 Promotion Modes
Waitlist promotion behavior is configurable per event:
- **Automated Promotion (FIFO):**
  - When an existing attendee cancels or is removed, the system atomically identifies `waitlist_position = 1`.
  - Upgrades status from `waitlisted` to `registered`, clears `waitlist_position`, shifts all subsequent waitlist positions by -1, and triggers an automated confirmation email with dynamic QR ticket.
- **Manual Approval (Registration Lead Review):**
  - When a spot opens, the position becomes "Eligible for Promotion".
  - A Registration Lead or Event Manager reviews the queue and manually approves promotion.

### 4.3 Critical Edge Cases & Mitigation

| Edge Case | Risk | Enforced System Rule |
| :--- | :--- | :--- |
| **Irreversible Waitlist Purge** | Accidentally toggling waitlist off could wipe 50 people. | Disabling waitlists on an active event requires a double confirmation dialogue with explicit typing of `"PURGE_WAITLIST"`. A snapshot archive of all removed waitlisted participants is permanently retained in `attendance_log`. |
| **Slot Hoarding / Multi-Session Gaming** | Learners join 4 concurrent breakout sessions. | An anti-gaming validation check restricts learners to **one active registration or waitlist entry per concurrent time slot**. |
| **High-Demand Session Overflow** | 100 people waitlist for a 20-person workshop. | Organizers can execute **Session Replication & Bulk Waitlist Transfer**, duplicating the session into an overflow time slot (e.g., Session B) and migrating waitlist positions in order. |
| **Last-Minute Cancellation Deadlock** | A registrant cancels 15 minutes before the event. | Automated promotion sends an urgent SMS/Gmail notification with an RSVP acceptance window (e.g., 10 minutes). If unanswered, it cascades to the next position. |

---

## 5. Pillar 4: Roles & Permissions (RBAC) & Audit Integrity

### 5.1 RBAC Matrix
The principle of least privilege applies to all client and administrative interfaces:

| Capability / Action | Door Staff / Volunteer | Registration Lead (LLA) | Event Manager / Admin |
| :--- | :---: | :---: | :---: |
| Scan Dynamic QR Codes | Yes | Yes | Yes |
| View Real-time Green/Red Screen | Yes | Yes | Yes |
| Partial Name / Email Search | Yes (Limited View) | Yes (Full View) | Yes (Full View) |
| View Dietary / Sensitive Registration Attributes | No | Yes | Yes |
| Handle Walk-Ins (Rapid Registration) | No | Yes | Yes |
| Execute Manual Check-In Override | No | Yes (Reason Required) | Yes (Reason Required) |
| Edit Event Templates & Capacities | No | No | Yes |
| Force-Promote / Reorder Waitlist | No | No | Yes |
| Replicate Overflow Sessions | No | No | Yes |
| Trigger Workday Learning Completion Sync | No | No | Yes |
| Export Raw Compliance Audit Logs | No | No | Yes |

### 5.2 Manual Check-In Override Protocol
When an attendee cannot present a valid QR code (e.g., phone battery died, shattered screen, network failure):
1. **Restricted Authority:** Only a Registration Lead or Event Manager can execute an override; Door Volunteers are blocked.
2. **Mandatory Reason Code:** The operator must select a structured reason code:
   - `PHONE_BATTERY_DEAD`
   - `QR_DISPLAY_MALFUNCTION`
   - `OFFLINE_MANUAL_WALKIN`
   - `IDENTITY_VERIFIED_PHOTO_ID`
   - `OTHER` (Requires minimum 10-character free-text explanation).
3. **Audit Immutability:** Overrides are permanently recorded with `source = 'manual_override'`, logging the operator's user ID, timestamp, and stated reason.

### 5.3 Audit Log Schema Requirements
Every scan attempt (successful, rejected, or manual override) produces an immutable entry in `scan_audit_log`:
- `scan_id`: Unique UUID.
- `event_id` & `session_id`: Targeted scope.
- `participant_user_id`: Target attendee identifier.
- `scanner_user_id`: Operator who scanned the code.
- `device_fingerprint`: Client device identifier / IP / user agent.
- `scan_result`: `SUCCESS`, `DUPLICATE_REJECTED`, `EXPIRED`, `UNAUTHORIZED`, `MANUAL_OVERRIDE`.
- `door_location`: Gate identifier (e.g., "Main Entrance Gate 2").
- `scanned_at`: Microsecond-precision timestamp.
- `offline_buffered`: Boolean indicating whether this scan was processed via offline buffer flush.

---

## 6. Four-Layer Data Architecture

```
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
```

### 6.1 Multi-Store Data Distribution Strategy
- **Operational OLTP Store (PostgreSQL / Cloud SQL / Firestore):**
  - Manages real-time transactional integrity, waitlist FIFO concurrency, and atomic registration locks.
- **Analytical Warehouse (BigQuery):**
  - Consumes buffered event logs and attendance records.
  - Partitioned by `DATE(start_date)` and clustered by `event_type_slug, status`.
  - Supports executive dashboards, no-show rate analytics, and LMS batch exports.
- **Operational Coordinator Surface (Google Sheets):**
  - Periodically synchronized via scheduled Apps Script batch updates.
  - Never acts as the write target for mobile scanners.

---

## 7. Resilient Offline & High-Burst Queueing Flow

### 7.1 High-Burst Check-In Protection
When 200 participants arrive simultaneously before a keynote:
1. **Frontend Buffer:** Scans are queued in browser `localStorage` / IndexedDB immediately.
2. **Decoupled Gateway:** `google.script.run` or Cloud Run endpoint validates token signatures and places payloads into a **GCP Cloud Tasks** queue.
3. **Immediate Acknowledgement:** The UI indicates `Checked In` (or `Queued`) in <200ms without waiting for downstream database writes or certificate generation.
4. **Background Consumers:** Cloud Run workers read the Cloud Tasks queue, update the authoritative database, and trigger downstream APIs.

### 7.2 Offline Operation & Reconnection Sync
If the venue Wi-Fi disconnects:
1. Client UI detects `navigator.onLine === false` or API connection timeout.
2. The UI switches to **Offline Scanner Mode**:
   - Compares the scanned QR token signature against a pre-cached offline roster key.
   - Logs the scan to `localStorage.evently_offline_queue`.
   - Displays a prominent status: `"Checked In (Offline Queue - 14 Scans Pending Sync)"`.
3. Upon reconnection (`window.addEventListener('online')`):
   - Flushes the queued batch in a single atomic RPC call to `processOfflineQueue(batch)`.
   - Reconciles any duplicate scans that may have occurred across independent offline tablets.

---

## 8. Workday Learning & Post-Event Reconciliation

### 8.1 Data Mapping for LMS Reconciliation
Post-event attendance records must map cleanly into Workday Learning import formats:

| Evently Attribute | Workday Learning Field | Transformation Rule |
| :--- | :--- | :--- |
| `participant_user_id` | `Worker_ID` | Clean `EMP-` prefix if required. |
| `config.lms_course_id` | `Course_Offering_ID` | Extracted from event configuration. |
| `attendance_log.to_status` | `Completion_Status` | `attended` ➔ `Completed`, `no_show` ➔ `Incomplete`. |
| `scan_audit_log.scanned_at`| `Completion_Date` | ISO 8601 formatted date. |
| `config.passing_score` | `Score` | Evaluated against cohort test results. |

### 8.2 Reconciliation Pathways
1. **Automated Scheduled Sync:** Nightly Cloud Run job queries BigQuery for newly completed events and invokes the Workday Learning REST API.
2. **Verified Manual CSV Export:** For one-off or ad-hoc events, the Event Manager interface generates a pre-formatted Workday EIB (Enterprise Interface Builder) compatible CSV file.

---

## 9. Phase 1 Sign-Off Checklist & Next Steps

- [x] Four baseline event templates & instance override model specified.
- [x] Identity resolution for corporate Workday IDs and external contractors established.
- [x] Cryptographic dynamic QR token structure and single-use locking defined.
- [x] Waitlist state machine, promotion rules, and edge-case mitigations designed.
- [x] Role-Based Access Control matrix & manual override governance locked.
- [x] 4-layer relational and analytics schemas mapped.
- [x] Offline caching & burst queueing architecture validated.
- [x] Workday Learning LMS reconciliation pathway documented.

**Ready for Phase 2: UI Prototyping & Frontend Design (Scanner UX, Walk-In Modal, Coordinator Live Dashboard).**
