import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvent,
  EVENT_TYPE_REGISTRY,
  WaitlistEngine,
  QRSecurityManager,
  RBACGuard,
  Registration,
  EventSession,
  UserContext,
} from '../src/index.js';

describe('Phase 1 Pillar 1: Event Types & Configuration Registry', () => {
  test('Instantiates manager workshop with baseline defaults', () => {
    const event = createEvent({
      eventTypeSlug: 'manager_workshop',
      title: 'New Manager 101',
      ownerUserId: 'EMP-001',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });

    assert.equal(event.eventTypeSlug, 'manager_workshop');
    assert.equal(event.maxCapacity, 15);
    assert.equal(event.config.requiresRoom, true);
    assert.equal(event.status, 'draft');
  });

  test('Permits overriding default capacity and custom duration without schema changes', () => {
    // 60-person manager workshop spanning 5 days
    const event = createEvent({
      eventTypeSlug: 'manager_workshop',
      title: 'All-Hands Management Intensive',
      ownerUserId: 'EMP-002',
      startDate: '2026-11-10',
      endDate: '2026-11-15',
      maxCapacity: 60,
    });

    assert.equal(event.maxCapacity, 60);
    assert.equal(event.startDate, '2026-11-10');
    assert.equal(event.endDate, '2026-11-15');
  });

  test('Rejects invalid date ranges', () => {
    assert.throws(
      () =>
        createEvent({
          eventTypeSlug: 'leadership_retreat',
          title: 'Invalid Dates Retreat',
          ownerUserId: 'EMP-003',
          startDate: '2026-11-15',
          endDate: '2026-11-10',
        }),
      /Event end date cannot be earlier than start date/
    );
  });
});

describe('Phase 1 Pillar 2: QR Security & Door Verification', () => {
  const secretKey = 'super_secret_enterprise_hmac_key_2026';
  const qrManager = new QRSecurityManager(secretKey);

  test('Generates valid HMAC dynamic token and successfully verifies at the door', () => {
    const token = qrManager.generateDynamicToken('reg_123', 'evt_999', 'EMP-500', 3600);
    const result = qrManager.verifyAndConsumeToken(
      token,
      'evt_999',
      'VOLUNTEER_ALICE',
      'Door 1 - Main Entrance'
    );

    assert.equal(result.valid, true);
    assert.equal(result.scanResult, 'SUCCESS');
    assert.equal(result.payload?.uid, 'EMP-500');
    assert.equal(result.auditEntry.scanResult, 'SUCCESS');
    assert.equal(result.auditEntry.doorGate, 'Door 1 - Main Entrance');
  });

  test('Single-use locking blocks duplicate scans (Anti-Screenshot/Replay)', () => {
    const token = qrManager.generateDynamicToken('reg_duplicate', 'evt_999', 'EMP-501', 3600);

    // First scan at Door 1
    const firstScan = qrManager.verifyAndConsumeToken(
      token,
      'evt_999',
      'VOLUNTEER_ALICE',
      'Door 1'
    );
    assert.equal(firstScan.valid, true);

    // Second scan with same token at Door 2
    const secondScan = qrManager.verifyAndConsumeToken(
      token,
      'evt_999',
      'VOLUNTEER_BOB',
      'Door 2'
    );
    assert.equal(secondScan.valid, false);
    assert.equal(secondScan.scanResult, 'DUPLICATE_REJECTED');
    assert.match(secondScan.message, /Duplicate Scan: Already Checked In/);
    assert.match(secondScan.message, /Door 1/);
    assert.match(secondScan.message, /VOLUNTEER_ALICE/);
  });

  test('Rejects expired dynamic tokens', () => {
    // Expired 10 seconds ago
    const expiredToken = qrManager.generateDynamicToken('reg_exp', 'evt_999', 'EMP-502', -10);
    const result = qrManager.verifyAndConsumeToken(
      expiredToken,
      'evt_999',
      'VOLUNTEER_ALICE',
      'Door 1'
    );

    assert.equal(result.valid, false);
    assert.equal(result.scanResult, 'EXPIRED_TOKEN');
  });

  test('Rejects tampered tokens with forged signatures', () => {
    const token = qrManager.generateDynamicToken('reg_tamper', 'evt_999', 'EMP-503', 3600);
    const parts = token.split('.');
    const forgedToken = `${parts[0]}.forged_invalid_signature_xyz`;

    const result = qrManager.verifyAndConsumeToken(
      forgedToken,
      'evt_999',
      'VOLUNTEER_ALICE',
      'Door 1'
    );

    assert.equal(result.valid, false);
    assert.equal(result.scanResult, 'INVALID_SIGNATURE');
  });
});

describe('Phase 1 Pillar 3: Waitlist State Machine & Edge Cases', () => {
  test('Enforces capacity trigger and sequential waitlist positions', () => {
    const event = createEvent({
      eventTypeSlug: 'manager_workshop',
      title: 'Workshop Small',
      ownerUserId: 'EMP-01',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      maxCapacity: 2,
    });

    const registrations: Registration[] = [];

    // Reg 1
    const res1 = WaitlistEngine.register(event, 'EMP-1', false, {}, registrations);
    registrations.push(res1.registration);
    assert.equal(res1.registration.status, 'registered');

    // Reg 2
    const res2 = WaitlistEngine.register(event, 'EMP-2', false, {}, registrations);
    registrations.push(res2.registration);
    assert.equal(res2.registration.status, 'registered');

    // Reg 3 (Capacity reached -> Waitlist #1)
    const res3 = WaitlistEngine.register(event, 'EMP-3', false, {}, registrations);
    registrations.push(res3.registration);
    assert.equal(res3.registration.status, 'waitlisted');
    assert.equal(res3.registration.waitlistPosition, 1);

    // Reg 4 (Waitlist #2)
    const res4 = WaitlistEngine.register(event, 'EMP-4', false, {}, registrations);
    registrations.push(res4.registration);
    assert.equal(res4.registration.status, 'waitlisted');
    assert.equal(res4.registration.waitlistPosition, 2);
  });

  test('FIFO Auto-promotion promotes waitlist #1 when active registration cancels', () => {
    const event = createEvent({
      eventTypeSlug: 'manager_workshop',
      title: 'Workshop Promotion',
      ownerUserId: 'EMP-01',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      maxCapacity: 1,
      waitlistPromotionMode: 'automatic',
    });

    const registrations: Registration[] = [];

    const reg1 = WaitlistEngine.register(event, 'EMP-1', false, {}, registrations).registration;
    registrations.push(reg1);

    const reg2 = WaitlistEngine.register(event, 'EMP-2', false, {}, registrations).registration;
    registrations.push(reg2); // Waitlist #1

    const reg3 = WaitlistEngine.register(event, 'EMP-3', false, {}, registrations).registration;
    registrations.push(reg3); // Waitlist #2

    assert.equal(reg2.waitlistPosition, 1);
    assert.equal(reg3.waitlistPosition, 2);

    // Cancel EMP-1
    const cancelRes = WaitlistEngine.cancel(event, reg1.id, 'Schedule conflict', registrations);

    assert.equal(cancelRes.cancelled.status, 'cancelled');
    assert.equal(cancelRes.promoted?.id, reg2.id);
    assert.equal(reg2.status, 'registered');
    assert.equal(reg2.waitlistPosition, undefined);

    // EMP-3 should shift from waitlist #2 to #1
    assert.equal(reg3.waitlistPosition, 1);
  });

  test('Anti-gaming check prevents multi-session slot hoarding in concurrent timeslots', () => {
    const sessionA: EventSession = {
      id: 'sess_a',
      eventId: 'evt_summit',
      title: 'Keynote Track 1',
      sessionDate: '2026-11-20',
      startTime: '10:00',
      endTime: '11:30',
      isMandatory: false,
      sessionConfig: {},
      sortOrder: 1,
    };

    const sessionB: EventSession = {
      id: 'sess_b',
      eventId: 'evt_summit',
      title: 'Workshop Track 2 (Overlapping)',
      sessionDate: '2026-11-20',
      startTime: '10:30',
      endTime: '12:00',
      isMandatory: false,
      sessionConfig: {},
      sortOrder: 2,
    };

    const registrations: Registration[] = [
      {
        id: 'reg_user1',
        eventId: 'evt_summit',
        participantUserId: 'EMP-HOARDER',
        isExternal: false,
        status: 'registered',
        registeredAt: new Date().toISOString(),
        customFields: {},
        qrSecretSalt: 'salt',
      },
    ];

    const attendances = [{ registrationId: 'reg_user1', sessionId: 'sess_a', status: 'registered' }];

    assert.throws(
      () =>
        WaitlistEngine.validateAntiGaming(
          'EMP-HOARDER',
          sessionB,
          [sessionA, sessionB],
          registrations,
          attendances
        ),
      /Anti-gaming violation/
    );
  });

  test('Purge waitlist requires explicit PURGE_WAITLIST confirmation token', () => {
    const event = createEvent({
      eventTypeSlug: 'manager_workshop',
      title: 'Workshop Purge Test',
      ownerUserId: 'EMP-01',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      maxCapacity: 1,
    });

    const registrations: Registration[] = [];
    registrations.push(WaitlistEngine.register(event, 'EMP-1', false, {}, registrations).registration);
    registrations.push(WaitlistEngine.register(event, 'EMP-2', false, {}, registrations).registration);

    // Attempt without token fails
    assert.throws(
      () => WaitlistEngine.purgeWaitlistSafely(event, 'WRONG_TOKEN', registrations, 'ADMIN_1'),
      /Safeguard violation/
    );

    // With token succeeds
    const purgeRes = WaitlistEngine.purgeWaitlistSafely(
      event,
      'PURGE_WAITLIST',
      registrations,
      'ADMIN_1'
    );
    assert.equal(purgeRes.purged.length, 1);
    assert.equal(purgeRes.purged[0].participantUserId, 'EMP-2');
    assert.equal(purgeRes.purged[0].status, 'cancelled');
    assert.equal(event.waitlistEnabled, false);
  });
});

describe('Phase 1 Pillar 4: Roles & Permissions (RBAC)', () => {
  const volunteer: UserContext = {
    userId: 'VOL-01',
    role: 'DOOR_VOLUNTEER',
    displayName: 'Volunteer Dave',
  };

  const lead: UserContext = {
    userId: 'LLA-01',
    role: 'REGISTRATION_LEAD',
    displayName: 'Lead Sarah',
  };

  const manager: UserContext = {
    userId: 'MGR-01',
    role: 'EVENT_MANAGER',
    displayName: 'Manager Claire',
  };

  test('Door Volunteers cannot view sensitive registration attributes or handle walk-ins', () => {
    assert.throws(
      () => RBACGuard.assertCanViewSensitiveAttributes(volunteer),
      /Access Denied/
    );
    assert.throws(() => RBACGuard.assertCanRegisterWalkIns(volunteer), /Access Denied/);

    // Registration Lead and Manager can
    assert.doesNotThrow(() => RBACGuard.assertCanViewSensitiveAttributes(lead));
    assert.doesNotThrow(() => RBACGuard.assertCanRegisterWalkIns(lead));
  });

  test('Door Volunteers cannot perform manual check-in overrides', () => {
    assert.throws(
      () =>
        RBACGuard.assertAndLogManualOverride(
          volunteer,
          'evt_1',
          'EMP-99',
          'reg_99',
          'PHONE_BATTERY_DEAD'
        ),
      /Door Volunteers cannot perform manual check-in overrides/
    );
  });

  test('Registration Lead manual override strictly enforces reason code and explanation', () => {
    // Missing reason code
    assert.throws(
      // @ts-expect-error Testing invalid parameter
      () => RBACGuard.assertAndLogManualOverride(lead, 'evt_1', 'EMP-99', 'reg_99', null),
      /Validation Error/
    );

    // Reason 'OTHER' with too short explanation
    assert.throws(
      () =>
        RBACGuard.assertAndLogManualOverride(
          lead,
          'evt_1',
          'EMP-99',
          'reg_99',
          'OTHER',
          'short'
        ),
      /explicit explanation of at least 10 characters/
    );

    // Valid override succeeds and produces audit trail
    const result = RBACGuard.assertAndLogManualOverride(
      lead,
      'evt_1',
      'EMP-99',
      'reg_99',
      'PHONE_BATTERY_DEAD'
    );
    assert.equal(result.auditEntry.scanResult, 'MANUAL_OVERRIDE');
    assert.equal(result.auditEntry.overrideReason, 'PHONE_BATTERY_DEAD');
    assert.equal(result.log.source, 'coordinator_manual');
  });

  test('Administrative actions strictly require EVENT_MANAGER role', () => {
    assert.throws(
      () => RBACGuard.assertAdminPrivileges(lead, 'trigger_lms_sync'),
      /strictly requires EVENT_MANAGER/
    );
    assert.doesNotThrow(() =>
      RBACGuard.assertAdminPrivileges(manager, 'trigger_lms_sync')
    );
  });
});
