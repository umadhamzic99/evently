import {
  UserRole,
  ManualOverrideReason,
  AttendanceLogEntry,
  ScanAuditEntry,
} from '../types/index.js';

export interface UserContext {
  userId: string;
  role: UserRole;
  displayName: string;
}

export class RBACGuard {
  /**
   * Asserts whether a user has permission to view sensitive registration fields
   * (e.g. dietary preference, accommodation, medical, t-shirt size).
   */
  public static assertCanViewSensitiveAttributes(user: UserContext): void {
    if (user.role === 'DOOR_VOLUNTEER') {
      throw new Error(
        `Access Denied: Door Volunteers are not authorized to view sensitive participant attributes.`
      );
    }
  }

  /**
   * Asserts whether a user has permission to perform walk-in registrations.
   */
  public static assertCanRegisterWalkIns(user: UserContext): void {
    if (user.role === 'DOOR_VOLUNTEER') {
      throw new Error(
        `Access Denied: Door Volunteers cannot register walk-in participants. Escalate to Registration Lead.`
      );
    }
  }

  /**
   * Asserts whether a user is authorized to execute a manual check-in override.
   * Requires:
   * 1. Authorized role (`REGISTRATION_LEAD` or `EVENT_MANAGER`)
   * 2. Mandatory reason code
   * 3. Non-empty explanation if reason is 'OTHER'
   */
  public static assertAndLogManualOverride(
    user: UserContext,
    eventId: string,
    participantUserId: string,
    registrationId: string,
    reasonCode: ManualOverrideReason,
    explanation?: string,
    doorGate: string = 'Registration Desk'
  ): { log: AttendanceLogEntry; auditEntry: ScanAuditEntry } {
    if (user.role === 'DOOR_VOLUNTEER') {
      throw new Error(
        `Access Denied: Door Volunteers cannot perform manual check-in overrides. Requires Registration Lead or Admin.`
      );
    }

    if (!reasonCode) {
      throw new Error(
        'Validation Error: Manual overrides strictly require a mandatory reason code.'
      );
    }

    if (reasonCode === 'OTHER' && (!explanation || explanation.trim().length < 10)) {
      throw new Error(
        "Validation Error: Reason 'OTHER' requires an explicit explanation of at least 10 characters."
      );
    }

    const now = new Date().toISOString();
    const finalReason = explanation ? `${reasonCode}: ${explanation}` : reasonCode;

    const log: AttendanceLogEntry = {
      id: `log_ovr_${Math.random().toString(36).substring(2, 11)}`,
      registrationId,
      eventId,
      fromStatus: 'registered',
      toStatus: 'attended',
      changedBy: user.userId,
      changedAt: now,
      reason: finalReason,
      source: 'coordinator_manual',
    };

    const auditEntry: ScanAuditEntry = {
      id: `audit_ovr_${Math.random().toString(36).substring(2, 11)}`,
      eventId,
      registrationId,
      participantUserId,
      scannerUserId: user.userId,
      scanResult: 'MANUAL_OVERRIDE',
      doorGate,
      overrideReason: finalReason,
      offlineBuffered: false,
      scannedAt: now,
    };

    return { log, auditEntry };
  }

  /**
   * Asserts administrative permissions for template/capacity management and LMS sync.
   */
  public static assertAdminPrivileges(user: UserContext, actionName: string): void {
    if (user.role !== 'EVENT_MANAGER') {
      throw new Error(
        `Access Denied: Action '${actionName}' strictly requires EVENT_MANAGER privileges.`
      );
    }
  }
}
