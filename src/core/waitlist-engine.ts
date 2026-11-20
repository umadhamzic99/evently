import {
  EventRecord,
  Registration,
  AttendanceLogEntry,
  EventSession,
} from '../types/index.js';

export interface RegistrationStore {
  registrations: Registration[];
  attendanceLogs: AttendanceLogEntry[];
}

export interface RegisterResult {
  registration: Registration;
  promoted?: Registration;
  log: AttendanceLogEntry;
}

export interface CancelResult {
  cancelled: Registration;
  promoted?: Registration;
  logs: AttendanceLogEntry[];
}

// shortcut: in-memory array filtering for waitlist FIFO; upgrade to SQL transaction FOR UPDATE SKIP LOCKED when connecting to Cloud SQL / PostgreSQL.
export class WaitlistEngine {
  /**
   * Anti-gaming rule: Check whether a user is already holding a registered or waitlisted
   * spot in a conflicting/overlapping session within the event.
   */
  public static validateAntiGaming(
    participantUserId: string,
    targetSession: EventSession,
    allSessions: EventSession[],
    allRegistrations: Registration[],
    sessionAttendances: { registrationId: string; sessionId: string; status: string }[]
  ): void {
    // Find all registrations of this user
    const userRegIds = new Set(
      allRegistrations
        .filter(
          (r) =>
            r.participantUserId === participantUserId &&
            (r.status === 'registered' || r.status === 'waitlisted')
        )
        .map((r) => r.id)
    );

    for (const sa of sessionAttendances) {
      if (userRegIds.has(sa.registrationId) && sa.sessionId !== targetSession.id) {
        const otherSession = allSessions.find((s) => s.id === sa.sessionId);
        if (
          otherSession &&
          otherSession.sessionDate === targetSession.sessionDate &&
          ((otherSession.startTime <= targetSession.startTime && otherSession.endTime > targetSession.startTime) ||
            (otherSession.startTime < targetSession.endTime && otherSession.endTime >= targetSession.endTime))
        ) {
          throw new Error(
            `Anti-gaming violation: User ${participantUserId} is already holding a spot in overlapping session '${otherSession.title}'`
          );
        }
      }
    }
  }

  /**
   * Register a participant into an event.
   * Handles capacity triggers and waitlist assignment.
   */
  public static register(
    event: EventRecord,
    participantUserId: string,
    isExternal: boolean,
    customFields: Record<string, unknown> = {},
    currentRegistrations: Registration[],
    operatorId: string = 'system'
  ): RegisterResult {
    // 1. Check if user is already enrolled
    const existing = currentRegistrations.find(
      (r) =>
        r.eventId === event.id &&
        r.participantUserId === participantUserId &&
        r.status !== 'cancelled'
    );
    if (existing) {
      throw new Error(
        `User ${participantUserId} is already enrolled in this event with status: ${existing.status}`
      );
    }

    // 2. Count active registered participants
    const activeRegistered = currentRegistrations.filter(
      (r) => r.eventId === event.id && r.status === 'registered'
    );

    const now = new Date().toISOString();
    const regId = `reg_${Math.random().toString(36).substring(2, 11)}`;
    const secretSalt = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

    if (activeRegistered.length < event.maxCapacity) {
      // Spot available
      const registration: Registration = {
        id: regId,
        eventId: event.id,
        participantUserId,
        isExternal,
        status: 'registered',
        registeredAt: now,
        customFields,
        qrSecretSalt: secretSalt,
      };

      const log: AttendanceLogEntry = {
        id: `log_${Math.random().toString(36).substring(2, 11)}`,
        registrationId: registration.id,
        eventId: event.id,
        fromStatus: null,
        toStatus: 'registered',
        changedBy: operatorId,
        changedAt: now,
        source: 'coordinator_manual',
      };

      return { registration, log };
    }

    // Event is at capacity
    if (!event.waitlistEnabled) {
      throw new Error(`Event '${event.title}' is at full capacity (${event.maxCapacity}) and waitlist is disabled.`);
    }

    // Assign next sequential waitlist position
    const currentWaitlisted = currentRegistrations
      .filter((r) => r.eventId === event.id && r.status === 'waitlisted' && r.waitlistPosition != null)
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

    const nextPosition =
      currentWaitlisted.length > 0
        ? (currentWaitlisted[currentWaitlisted.length - 1].waitlistPosition ?? 0) + 1
        : 1;

    const waitlistedReg: Registration = {
      id: regId,
      eventId: event.id,
      participantUserId,
      isExternal,
      status: 'waitlisted',
      waitlistPosition: nextPosition,
      registeredAt: now,
      customFields,
      qrSecretSalt: secretSalt,
    };

    const log: AttendanceLogEntry = {
      id: `log_${Math.random().toString(36).substring(2, 11)}`,
      registrationId: waitlistedReg.id,
      eventId: event.id,
      fromStatus: null,
      toStatus: 'waitlisted',
      changedBy: operatorId,
      changedAt: now,
      reason: `Capacity limit of ${event.maxCapacity} reached. Assigned waitlist #${nextPosition}`,
      source: 'coordinator_manual',
    };

    return { registration: waitlistedReg, log };
  }

  /**
   * Cancel a registration.
   * If the cancelled person was 'registered' and waitlist promotion mode is 'automatic',
   * automatically promotes the #1 waitlisted learner and shifts subsequent positions.
   */
  public static cancel(
    event: EventRecord,
    registrationId: string,
    cancellationReason: string,
    currentRegistrations: Registration[],
    operatorId: string = 'system'
  ): CancelResult {
    const reg = currentRegistrations.find((r) => r.id === registrationId);
    if (!reg) {
      throw new Error(`Registration not found: ${registrationId}`);
    }
    if (reg.status === 'cancelled') {
      throw new Error(`Registration is already cancelled: ${registrationId}`);
    }

    const now = new Date().toISOString();
    const prevStatus = reg.status;
    reg.status = 'cancelled';
    reg.cancelledAt = now;
    reg.cancellationReason = cancellationReason;
    const oldPosition = reg.waitlistPosition;
    delete reg.waitlistPosition;

    const logs: AttendanceLogEntry[] = [
      {
        id: `log_${Math.random().toString(36).substring(2, 11)}`,
        registrationId: reg.id,
        eventId: event.id,
        fromStatus: prevStatus,
        toStatus: 'cancelled',
        changedBy: operatorId,
        changedAt: now,
        reason: cancellationReason,
        source: 'self_cancellation',
      },
    ];

    let promoted: Registration | undefined;

    if (prevStatus === 'registered') {
      // If a registered spot opened up and auto-promotion is enabled
      if (event.waitlistPromotionMode === 'automatic') {
        const waitlisted = currentRegistrations
          .filter((r) => r.eventId === event.id && r.status === 'waitlisted' && r.waitlistPosition != null)
          .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

        if (waitlisted.length > 0) {
          const firstInLine = waitlisted[0];
          firstInLine.status = 'registered';
          delete firstInLine.waitlistPosition;
          promoted = firstInLine;

          logs.push({
            id: `log_${Math.random().toString(36).substring(2, 11)}`,
            registrationId: firstInLine.id,
            eventId: event.id,
            fromStatus: 'waitlisted',
            toStatus: 'registered',
            changedBy: 'system',
            changedAt: now,
            reason: `Auto-promoted following cancellation of registration ${reg.id}`,
            source: 'auto_waitlist_promote',
          });

          // Shift remaining waitlist positions by -1
          for (let i = 1; i < waitlisted.length; i++) {
            if (waitlisted[i].waitlistPosition != null) {
              waitlisted[i].waitlistPosition = (waitlisted[i].waitlistPosition as number) - 1;
            }
          }
        }
      }
    } else if (prevStatus === 'waitlisted' && oldPosition != null) {
      // Re-index remaining waitlist positions after someone left the waitlist
      const remainingWaitlisted = currentRegistrations
        .filter((r) => r.eventId === event.id && r.status === 'waitlisted' && r.waitlistPosition != null)
        .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

      remainingWaitlisted.forEach((r, idx) => {
        r.waitlistPosition = idx + 1;
      });
    }

    return {
      cancelled: reg,
      promoted,
      logs,
    };
  }

  /**
   * Safely purge a waitlist.
   * Requires explicit confirmation string to prevent accidental irreversible data loss.
   */
  public static purgeWaitlistSafely(
    event: EventRecord,
    confirmationToken: string,
    currentRegistrations: Registration[],
    operatorId: string
  ): { purged: Registration[]; logs: AttendanceLogEntry[] } {
    if (confirmationToken !== 'PURGE_WAITLIST') {
      throw new Error(
        "Safeguard violation: Purging a waitlist permanently removes learners. Confirmation token 'PURGE_WAITLIST' is required."
      );
    }

    const waitlisted = currentRegistrations.filter(
      (r) => r.eventId === event.id && r.status === 'waitlisted'
    );

    const now = new Date().toISOString();
    const logs: AttendanceLogEntry[] = [];

    waitlisted.forEach((r) => {
      r.status = 'cancelled';
      r.cancelledAt = now;
      r.cancellationReason = 'Event waitlist was permanently disabled by coordinator';
      delete r.waitlistPosition;

      logs.push({
        id: `log_${Math.random().toString(36).substring(2, 11)}`,
        registrationId: r.id,
        eventId: event.id,
        fromStatus: 'waitlisted',
        toStatus: 'cancelled',
        changedBy: operatorId,
        changedAt: now,
        reason: 'Bulk waitlist purge',
        source: 'coordinator_manual',
      });
    });

    event.waitlistEnabled = false;

    return { purged: waitlisted, logs };
  }

  /**
   * High-Demand Overflow: Replicate session and migrate waitlisted users in order.
   */
  public static replicateSessionAndTransferWaitlist(
    originalEvent: EventRecord,
    newEventId: string,
    maxToTransfer: number,
    currentRegistrations: Registration[],
    operatorId: string
  ): { transferred: Registration[]; logs: AttendanceLogEntry[] } {
    const waitlisted = currentRegistrations
      .filter((r) => r.eventId === originalEvent.id && r.status === 'waitlisted' && r.waitlistPosition != null)
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

    const toTransfer = waitlisted.slice(0, maxToTransfer);
    const now = new Date().toISOString();
    const logs: AttendanceLogEntry[] = [];

    toTransfer.forEach((r) => {
      const prevEventId = r.eventId;
      r.eventId = newEventId;
      r.status = 'registered'; // Transferred into open seats of the duplicate session
      delete r.waitlistPosition;

      logs.push({
        id: `log_${Math.random().toString(36).substring(2, 11)}`,
        registrationId: r.id,
        eventId: newEventId,
        fromStatus: 'waitlisted',
        toStatus: 'registered',
        changedBy: operatorId,
        changedAt: now,
        reason: `Migrated from oversubscribed event ${prevEventId} to overflow instance ${newEventId}`,
        source: 'coordinator_manual',
      });
    });

    // Re-index remaining in original event
    const remaining = currentRegistrations
      .filter((r) => r.eventId === originalEvent.id && r.status === 'waitlisted')
      .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

    remaining.forEach((r, idx) => {
      r.waitlistPosition = idx + 1;
    });

    return { transferred: toTransfer, logs };
  }
}
