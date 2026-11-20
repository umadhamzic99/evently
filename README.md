# Evently 🎫

> **Fast, screenshot-proof door check-in, automated waitlists, and compliance-grade tracking.**  
> *100% Google-Native • Zero SaaS Subscriptions • Runs on Google Workspace & Free-Tier GCP*

[![Tests](https://img.shields.io/badge/tests-19%20passed-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📌 Overview

**Evently** solves the chaos of corporate and enterprise event mornings: long registration lines, basement Wi-Fi dropouts, screenshot ticket sharing, and manual spreadsheet waitlist headaches. 

Designed for Corporate Learning & Development (L&D) and Enterprise Events, Evently provides:
- **Sub-Second Scans (<200ms)**: Zero-install mobile QR check-in for door volunteers.
- **Dynamic HMAC QR Security**: Time-stamped, server-signed single-use passes preventing screenshot sharing and replay attacks.
- **Self-Healing FIFO Waitlist Engine**: Automatic promotion of waitlisted attendees on cancellations with anti-slot-hoarding protection.
- **Strict Role-Based Access Control (RBAC)**: Clear permission boundaries between Door Volunteers, Registration Leads, and Event Managers with immutable audit trails for manual overrides.
- **Zero SaaS Subscriptions**: Built on Google Workspace (Google Apps Script, Google Sheets, Drive) with a TypeScript codebase that runs both locally (Node.js) and in Google Apps Script.

---

## 🏗️ Architecture & Core Pillars

### 1. Event Registry & Configuration
- Supports diverse event topologies: 1-hour workshops, multi-day leadership retreats, compliance training cohorts, and multi-track conferences.
- Built-in schema validation and date constraints without requiring database migrations.

### 2. QR Security & Door Verification
- Generates cryptographic HMAC-SHA256 dynamic tokens with time-window validation (`issuedAt` + `expiresAt`).
- Dual-environment parity: QR verification runs identical logic across local Node.js testing and Google Apps Script (`Utilities.computeHmacSha256Signature`).
- Atomic single-use lock prevents pass reuse across multiple doors.

### 3. FIFO Waitlist Engine
- Capacity triggers transition registrants to sequential queue positions (`#1`, `#2`, ...).
- Automatic FIFO promotion shifts queue when cancellations occur.
- Anti-gaming detection prevents registrants from hoarding concurrent time slots.
- Protected purge command requiring explicit safety confirmation.

### 4. RBAC & Compliance Auditing
- Minimal privilege boundaries: Volunteers can only verify tokens; they cannot read PII or bypass gates.
- Manual overrides by Registration Leads strictly require documented reason codes (`PHONE_BATTERY_DEAD`, `PHOTO_ID_VERIFIED`, etc.) logged directly to compliance audit streams.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)
- [npm](https://www.npmjs.com/)
- [Google Clasp](https://github.com/google/clasp) (optional, for deployment to Google Apps Script)

### Installation
```powershell
git clone https://github.com/umadhamzic99/evently.git
cd evently
npm install
```

### Running Tests
The project features a suite of 19 automated tests validating security, state machines, and cross-runtime parity:
```powershell
npm test
```

### Building for Google Apps Script
```powershell
npm run build:gas
```

For Apps Script deployment:
1. Copy `.clasp.json.example` to `.clasp.json`.
2. Insert your Google Apps Script script ID.
3. Deploy via clasp:
```powershell
npm run clasp:push
```

---

## 📂 Project Structure

```text
Evently/
├── assets/             # Logos, diagrams, and media
├── docs/               # System architecture and specifications
├── schemas/            # Data schemas and sheet definitions
├── scripts/            # Build and bundling scripts (GAS bundling)
├── src/
│   ├── core/           # Core engine: event registry, QR security, waitlist, RBAC
│   ├── gas/            # Google Apps Script plumbing, adapters, and Sheet repositories
│   └── types/          # TypeScript definitions
├── tests/              # Test suites for security, waitlist, RBAC, and parity
├── .claspignore        # Apps Script ignore rules
├── .gitignore          # Git exclusion rules
├── package.json        # Dependencies and scripts
├── PITCH.md            # Product vision and business case
└── tsconfig.json       # TypeScript configuration
```

---

## 📜 License
MIT License. See [LICENSE](LICENSE) for details.
