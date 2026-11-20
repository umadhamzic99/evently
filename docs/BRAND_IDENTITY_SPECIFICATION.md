# Evently Brand Identity & Design System Specification
**Codename:** The Calm Pilot (Humanized Edition)  
**Target Environments:** Google Stitch UI, HtmlService Mobile Scanner, Web Coordinator Dashboard  
**Status:** Approved Brand Foundation for Phase 2  

---

## 1. Brand Soul: "The Calm Pilot" with Warm Campus Geometry

### The Concept & Emotional Tone
Event mornings are high-stress environments. Line bottlenecks, Wi-Fi drops, and executive walk-ins create friction. 
- **The Pilot Mindset:** The software is unshakeable, fast, and precise. It provides mission-critical data density, instant door feedback (<200ms), and crisp contrast under any lighting.
- **The Human Touch:** Instead of feeling like a cold cockpit, it borrows the welcoming, tactile feel of a high-end campus retreat. Soft, organic card silhouettes (`16px–24px` radius) and gentle pill tags reassure attendees and volunteers that everything is under control.

---

## 2. Color System & Semantic Architecture

Every color has a dedicated operational purpose. Colors are calibrated for **WCAG AAA contrast** (>7:1) for readability under harsh sunlight or dim hotel ballrooms.

### 2.1 Core Palette Tokens

| Token Name | Hex Code | Role & Purpose | Where It Is Used |
| :--- | :--- | :--- | :--- |
| `--surface-canvas` | `#0B132B` | **Deep Slate Navy**: Infinite calm canvas that eliminates glare and saves battery during continuous phone scanning. | Mobile app background, scanner shroud, dashboard shell. |
| `--surface-card` | `#1C2541` | **Pilot Bridge Blue**: Elevated surface with high visual separation from canvas without harsh borders. | Attendee cards, session containers, modal backdrops. |
| `--surface-card-subtle`| `#253259` | **Soft Card Highlight**: For nested containers and secondary pill groups. | Time slots, track badges, walk-in inputs. |
| `--brand-primary` | `#3B82F6` | **Cobalt Signal**: Authoritative, trusted action color. Guides the eye straight to primary buttons. | "Scan Next", "Confirm Check-In", active tab pills. |
| `--brand-accent` | `#60A5FA` | **Electric Sky**: High-visibility accent for active states and focus rings. | Active input borders, camera target reticle. |
| `--text-primary` | `#F8FAFC` | **Crisp White (98% lightness)**: Zero eye strain, immediate legibility at a distance. | Attendee names, session titles, door numbers. |
| `--text-muted` | `#94A3B8` | **Slate Mist**: Clean secondary typography that doesn't compete for attention. | Employee IDs, timestamps, secondary metadata. |

### 2.2 Operational Semantic Gate Signals (High-Contrast Statuses)

| Signal State | Hex Code | Background Tint | Real-World Operational Meaning |
| :--- | :--- | :--- | :--- |
| **Admit Emerald** | `#10B981` | `#064E3B` (80% opacity) | **Admitted (<200ms glance)**. Valid QR scan, green border flash, immediate entry confirmation. |
| **Alert Crimson** | `#EF4444` | `#7F1D1D` (80% opacity) | **Scan Rejected**. Duplicate screenshot, expired pass, wrong session, or unauthorized door. |
| **Waitlist Gold** | `#F59E0B` | `#78350F` (80% opacity) | **Pending / Queue Status**. Attendee on waitlist, awaiting manual approval, or offline buffer pending. |
| **Neutral Info** | `#64748B` | `#1E293B` | Neutral informational badge (e.g., "Contractor", "General Admission"). |

---

## 3. Shape & Surface Language: The "Humanized Pilot" Geometry

This is where the **Warm Campus** aesthetic softens the **Calm Pilot** foundation:

* **Organic Card Radii (`16px` to `24px`):** All UI cards (tickets, attendee rows, modals) use generous squircle-style corner radii. No sharp 90° clinical corners.
* **Tactile Floating Pills (`9999px` full round):** Status badges, time chips, and quick-filter buttons are pill-shaped. They invite touch and feel approachable.
* **Soft Depth, Not Harsh Outlines:** Cards use subtle elevation shadows combined with ultra-thin `1px` translucent borders (`rgba(255, 255, 255, 0.08)`), giving elements depth without visual noise.
* **Ergonomic Bottom Sheets:** Mobile actions slide up from the bottom as organic cards with a `24px` top radius, keeping interactive buttons squarely inside the natural thumb zone.

---

## 4. Dual-Environment Typography

To balance personality with data precision, Evently utilizes two distinct type roles:

```text
┌────────────────────────────────────────────────────────┐
│  Brand & Headers: Plus Jakarta Sans / Outfit           │
│  "Clean, warm, confident geometric letterforms"        │
├────────────────────────────────────────────────────────┤
│  Data & Tabular Numbers: Inter (with font-feature-settings: 'tnum') │
│  "08:59:14 AM  •  Capacity: 14 / 15  •  EMP-10492"     │
└────────────────────────────────────────────────────────┘
```

* **Heading Scale (Mobile & Web):**
  * Display Header: `28px` / Line Height `34px` / Semi-bold (700)
  * Section Title: `20px` / Line Height `26px` / Medium (600)
  * Card Heading: `16px` / Line Height `22px` / Medium (600)
* **Tabular Body Scale:**
  * Primary Body / Attendee Name: `15px` / Line Height `20px` / Regular (400)
  * Badge & Time Chip: `13px` / Line Height `16px` / Medium (500)
  * Micro / Audit Timestamp: `11px` / Line Height `14px` / Monospace (`tnum`)

---

## 5. Voice & Microcopy Rules

Evently speaks with **operational calm and human clarity**:

| Situation | ❌ Don't Say | ✅ Do Say | Why |
| :--- | :--- | :--- | :--- |
| Valid Door Scan | "Hooray! Welcome to the summit!" | **"Admitted • Seat 14 Confirmed"** | Door staff need instant confirmation, not enthusiasm. |
| Duplicate Scan | "Access denied! Invalid ticket code detected." | **"Already Checked In • 08:54 AM at Door 2"** | Factual reason prevents arguments and tells staff where it occurred. |
| Battery Dead Override | "Force system override without ticket." | **"Manual Check-In: Reason Required"** | Reassuring for attendee, legally defensible for HR compliance. |
| Wi-Fi Disconnect | "Network error! Cannot reach cloud server." | **"Offline Mode Active • 14 Scans Saved to Device"** | Instantly reassures staff that scans are safe and will sync later. |

---

## 6. Stitch-Ready Design Tokens & Prompt Snippets

When entering prompts into **Stitch**, use this exact design spec block to ensure brand adherence:

```text
Design System Guidelines for Evently Screens:
- Theme: "The Calm Pilot" with humanized organic geometry.
- Backgrounds: Dark slate navy (#0B132B) for high-contrast scanning; elevated cards in #1C2541.
- Accents: Electric cobalt (#3B82F6) for CTAs; emerald (#10B981) for admit screens; crimson (#EF4444) for alerts.
- Geometry: Organic rounded cards with 18px-24px border-radius, pill-shaped tags (rounded-full), soft borders (1px solid rgba(255,255,255,0.08)).
- Typography: Clean modern geometric sans headers (Plus Jakarta Sans) with tabular monospaced numbers for timestamps, seat numbers, and counts (Inter).
- Ergonomics: Mobile layout bottom-weighted in the natural thumb zone with minimum 48px touch targets.
```
