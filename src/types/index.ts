// ==============================================================================
// Evently — Domain Models & Type Definitions
// Phase 1: Blueprinting & Product Specification
// ==============================================================================

export type EventTypeSlug =
  | 'manager_workshop'
  | 'leadership_retreat'
  | 'compliance_cohort'
  | 'internal_summit';

export type EventStatus =
  | 'draft'
  | 'published'
  | 'in_progress'
  | 'cancelled'
  | 'completed';

export type RegistrationStatus =
  | 'registered'
  | 'waitlisted'
  | 'attended'
  | 'no_show'
  | 'cancelled';

export type SessionAttendanceStatus =
  | 'registered'
  | 'attended'
  | 'no_show'
  | 'excused';

export type WaitlistPromotionMode = 'automatic' | 'manual_approval';

export type UserRole =
  | 'DOOR_VOLUNTEER'
  | 'REGISTRATION_LEAD'
  | 'EVENT_MANAGER';

export type ScanResult =
  | 'SUCCESS'
  | 'DUPLICATE_REJECTED'
  | 'EXPIRED_TOKEN'
  | 'INVALID_SIGNATURE'
  | 'MANUAL_OVERRIDE'
  | 'UNREGISTERED'
  | 'SESSION_MISMATCH';

export type ManualOverrideReason =
  | 'PHONE_BATTERY_DEAD'
  | 'QR_DISPLAY_MALFUNCTION'
  | 'OFFLINE_MANUAL_WALKIN'
  | 'IDENTITY_VERIFIED_PHOTO_ID'
  | 'OTHER';

export interface EventTypeTemplate {
  slug: EventTypeSlug;
  label: string;
  isMultiDay: boolean;
  hasSessions: boolean;
  requiresCohort: boolean;
  hasTracks: boolean;
  defaultConfig: {
    defaultCapacity: number;
    requiresRoom?: boolean;
    defaultDurationDays?: number;
    passingScoreRequired?: boolean;
    hasTracks?: boolean;
    [key: string]: unknown;
  };
}

export interface EventRecord {
  id: string;
  eventTypeSlug: EventTypeSlug;
  title: string;
  description?: string;
  status: EventStatus;
  ownerUserId: string; // Workday Employee ID or Corporate Email
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  timezone: string;
  maxCapacity: number;
  waitlistEnabled: boolean;
  waitlistPromotionMode: WaitlistPromotionMode;
  registrationDeadline?: string; // ISO 8601
  config: Record<string, unknown>;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EventSession {
  id: string;
  eventId: string;
  title: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  track?: string;
  maxCapacity?: number;
  isMandatory: boolean;
  sessionConfig: Record<string, unknown>;
  sortOrder: number;
}

export interface Registration {
  id: string;
  eventId: string;
  participantUserId: string;
  isExternal: boolean;
  cohortId?: string;
  status: RegistrationStatus;
  waitlistPosition?: number;
  registeredAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  customFields: Record<string, unknown>;
  qrSecretSalt: string;
  notes?: string;
}

export interface SessionAttendance {
  id: string;
  registrationId: string;
  sessionId: string;
  status: SessionAttendanceStatus;
  checkedInAt?: string;
  checkedInBy?: string;
  doorGate?: string;
}

export interface AttendanceLogEntry {
  id: string;
  registrationId: string;
  eventId: string;
  fromStatus: RegistrationStatus | null;
  toStatus: RegistrationStatus;
  changedBy: string;
  changedAt: string;
  reason?: string;
  source:
    | 'qr_door_scan'
    | 'auto_waitlist_promote'
    | 'coordinator_manual'
    | 'self_cancellation'
    | 'lms_reconciliation';
}

export interface DynamicQRTokenPayload {
  tid: string; // Registration ID
  eid: string; // Event ID
  sid?: string;// Session ID (optional for event-level)
  uid: string; // Participant User ID
  iat: number; // Issued At (Epoch seconds)
  exp: number; // Expires At (Epoch seconds)
  ver: number; // Token version
  nonce: string; // Cryptographic nonce
}

export interface ScanAuditEntry {
  id: string;
  eventId: string;
  sessionId?: string;
  registrationId?: string;
  participantUserId: string;
  scannerUserId: string;
  scanResult: ScanResult;
  doorGate: string;
  deviceFingerprint?: string;
  overrideReason?: string;
  tokenAgeSeconds?: number;
  offlineBuffered: boolean;
  scannedAt: string;
}
