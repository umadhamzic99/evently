// ==============================================================================
// Evently GAS — API Gateway
//
// This is the Apps Script entry point. esbuild bundles this (and its imports)
// into a single dist/gas/Code.js. Top-level functions are assigned to
// globalThis so Apps Script can call them as global functions after bundling.
//
// Exposed GAS functions:
//   doGet(e)                       — serves the web app HTML shell
//   apiVerifyScan(params)          — door QR verification (scanner RPC)
//   apiProcessOfflineQueue(params) — offline batch flush (reconnect sync)
//   apiManualOverride(params)      — registration lead override
//   apiRegisterWalkIn(params)      — walk-in rapid registration
//   apiCancelRegistration(params)  — cancellation & FIFO waitlist promotion
//   apiGetEventDashboard(params)   — coordinator live dashboard state
//   setupEventlySheet(sheetId?)    — one-click sheet & properties initialisation
// ==============================================================================

import { ManualOverrideReason, UserRole, RegistrationStatus } from '../types/index.js';
import { RBACGuard, UserContext } from '../core/rbac-guard.js';
import { WaitlistEngine } from '../core/waitlist-engine.js';
import { GasQRSecurityManager } from './qr-security-gas.js';
import {
  withLock,
  RegistrationRepo,
  AttendanceLogRepo,
  ScanAuditRepo,
  EventRepo,
  setupEventlySpreadsheet,
} from './sheet-repo.js';

// ---------- Input & Auth helpers ----------------------------------------------

/** Safely parses input whether passed as a JSON string or a native JS object across google.script.run. */
function parseInput<T>(input: string | T): T {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as T;
    } catch {
      return input as unknown as T;
    }
  }
  return input;
}

/** Resolves the calling user's email and RBAC role from Script Properties config. */
function resolveUser(): UserContext {
  let email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch {
    email = '';
  }
  if (!email) {
    email = 'door_volunteer@evently.local';
  }

  const props = PropertiesService.getScriptProperties();
  const roleMap: Record<string, UserRole> = JSON.parse(
    props.getProperty('EVENTLY_ROLE_MAP') ?? '{}'
  );
  const role: UserRole = roleMap[email] ?? 'DOOR_VOLUNTEER';
  return { userId: email, role, displayName: email };
}

function getQR(): GasQRSecurityManager {
  const secret = PropertiesService.getScriptProperties().getProperty('EVENTLY_QR_SECRET');
  if (!secret) throw new Error('EVENTLY_QR_SECRET not set in Script Properties');
  return new GasQRSecurityManager(secret);
}

// ---------- Response helpers --------------------------------------------------

function ok(data: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(message: string, code = 400): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message, code }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- GAS entry point ---------------------------------------------------

function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  // shortcut: serves a minimal HTML shell; Phase 2 will replace with full Stitch UI.
  return HtmlService.createHtmlOutput('<h1>Evently</h1><p>Gateway online.</p>')
    .setTitle('Evently')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- apiVerifyScan -----------------------------------------------------
// Called by scanner client: google.script.run.apiVerifyScan({token, eventId, doorGate, sessionId?})

interface VerifyScanParams {
  token: string;
  eventId: string;
  doorGate: string;
  sessionId?: string;
  deviceFingerprint?: string;
}

function apiVerifyScan(paramsInput: string | VerifyScanParams): GoogleAppsScript.Content.TextOutput {
  try {
    const params = parseInput<VerifyScanParams>(paramsInput);
    const { token, eventId, doorGate, sessionId, deviceFingerprint } = params;
    if (!token || !eventId || !doorGate) return err('Missing required fields: token, eventId, doorGate');

    const user = resolveUser();
    const qr = getQR();

    // Perform check & consume atomically under one lock
    return withLock(() => {
      const result = qr.verifyAndConsumeToken(token, eventId, user.userId, doorGate, deviceFingerprint, sessionId);

      if (result.valid && result.payload) {
        // Permanent database-level duplicate check against registrations sheet
        const reg = RegistrationRepo.findById(result.payload.tid);
        if (reg && reg.status === 'attended') {
          result.valid = false;
          result.scanResult = 'DUPLICATE_REJECTED';
          result.message = `Duplicate Scan: Already Checked In (Registration: ${result.payload.tid})`;
          result.auditEntry.scanResult = 'DUPLICATE_REJECTED';
        } else {
          RegistrationRepo.updateStatus(result.payload.tid, 'attended');
          AttendanceLogRepo.insert({
            id: `log_${Date.now()}`,
            registrationId: result.payload.tid,
            eventId,
            fromStatus: reg ? reg.status : 'registered',
            toStatus: 'attended',
            changedBy: user.userId,
            changedAt: new Date().toISOString(),
            source: 'qr_door_scan',
          });
        }
      }

      // Record audit entry
      ScanAuditRepo.insert(result.auditEntry);

      return ok({ scanResult: result.scanResult, message: result.message, payload: result.payload });
    });
  } catch (e) {
    return err(String(e));
  }
}

// ---------- apiProcessOfflineQueue --------------------------------------------
// Batch flush from mobile devices on reconnection: runs in a single atomic pass
// batchInput: Array of {token, eventId, doorGate, sessionId?, scannedOfflineAt}

interface OfflineQueueItem {
  token: string;
  eventId: string;
  doorGate: string;
  sessionId?: string;
  scannedOfflineAt: string;
}

function apiProcessOfflineQueue(batchInput: string | OfflineQueueItem[]): GoogleAppsScript.Content.TextOutput {
  try {
    const batch = parseInput<OfflineQueueItem[]>(batchInput);
    if (!Array.isArray(batch) || batch.length === 0) return ok({ processed: 0, results: [] });

    const user = resolveUser();
    const qr = getQR();

    return withLock(() => {
      const auditEntries = [];
      const attendanceLogs = [];
      const statusUpdates = new Map<string, { status: RegistrationStatus; waitlistPosition?: number | null }>();
      const results = [];

      // Read current registrations for this event once into memory
      const eventId = batch[0].eventId;
      const currentRegs = new Map(RegistrationRepo.findByEvent(eventId).map(r => [r.id, r]));

      for (const item of batch) {
        const result = qr.verifyAndConsumeToken(item.token, item.eventId, user.userId, item.doorGate, undefined, item.sessionId);
        const audit = { ...result.auditEntry, offlineBuffered: true, scannedAt: item.scannedOfflineAt };

        if (result.valid && result.payload) {
          const reg = currentRegs.get(result.payload.tid);
          if (reg && reg.status === 'attended') {
            result.valid = false;
            result.scanResult = 'DUPLICATE_REJECTED';
            result.message = `Duplicate Scan: Already Checked In (Registration: ${result.payload.tid})`;
            audit.scanResult = 'DUPLICATE_REJECTED';
          } else {
            statusUpdates.set(result.payload.tid, { status: 'attended' });
            if (reg) reg.status = 'attended'; // update in-memory cache for subsequent items in same batch

            attendanceLogs.push({
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              registrationId: result.payload.tid,
              eventId: item.eventId,
              fromStatus: (reg ? reg.status : 'registered') as RegistrationStatus,
              toStatus: 'attended' as RegistrationStatus,
              changedBy: user.userId,
              changedAt: item.scannedOfflineAt,
              source: 'qr_door_scan' as const,
            });
          }
        }

        auditEntries.push(audit);
        results.push({ token: item.token, scanResult: result.scanResult, message: result.message });
      }

      // Flush writes in 3 batched operations (instead of 3 * N individual RPC calls)
      RegistrationRepo.updateStatusesBatch(statusUpdates);
      AttendanceLogRepo.insertBatch(attendanceLogs);
      ScanAuditRepo.insertBatch(auditEntries);

      return ok({ processed: results.length, results });
    });
  } catch (e) {
    return err(String(e));
  }
}

// ---------- apiManualOverride -------------------------------------------------
// google.script.run.apiManualOverride({registrationId, reasonCode, explanation?, doorGate?})

interface ManualOverrideParams {
  registrationId: string;
  reasonCode: ManualOverrideReason;
  explanation?: string;
  doorGate?: string;
}

function apiManualOverride(paramsInput: string | ManualOverrideParams): GoogleAppsScript.Content.TextOutput {
  try {
    const params = parseInput<ManualOverrideParams>(paramsInput);
    const { registrationId, reasonCode, explanation, doorGate = 'Registration Desk' } = params;
    if (!registrationId || !reasonCode) return err('Missing required fields: registrationId, reasonCode');

    const user = resolveUser();
    const reg = RegistrationRepo.findById(registrationId);
    if (!reg) return err(`Registration ${registrationId} not found`, 404);

    const { log, auditEntry } = RBACGuard.assertAndLogManualOverride(
      user, reg.eventId, reg.participantUserId, registrationId,
      reasonCode, explanation, doorGate
    );

    withLock(() => {
      RegistrationRepo.updateStatus(registrationId, 'attended');
      AttendanceLogRepo.insert(log);
      ScanAuditRepo.insert(auditEntry);
    });

    return ok({ message: `Manual override recorded for ${reg.participantUserId}` });
  } catch (e) {
    return err(String(e));
  }
}

// ---------- apiRegisterWalkIn ------------------------------------------------
// google.script.run.apiRegisterWalkIn({eventId, participantUserId, isExternal, customFields?})

interface WalkInParams {
  eventId: string;
  participantUserId: string;
  isExternal?: boolean;
  customFields?: Record<string, unknown>;
}

function apiRegisterWalkIn(paramsInput: string | WalkInParams): GoogleAppsScript.Content.TextOutput {
  try {
    const params = parseInput<WalkInParams>(paramsInput);
    const { eventId, participantUserId, isExternal = false, customFields = {} } = params;
    if (!eventId || !participantUserId) return err('Missing required fields: eventId, participantUserId');

    const user = resolveUser();
    RBACGuard.assertCanRegisterWalkIns(user);

    const event = EventRepo.findById(eventId);
    if (!event) return err(`Event ${eventId} not found`, 404);

    const result = withLock(() => {
      const currentRegistrations = RegistrationRepo.findByEvent(eventId);
      const { registration, log } = WaitlistEngine.register(
        event, participantUserId, isExternal, customFields, currentRegistrations, user.userId
      );
      RegistrationRepo.insert(registration);
      AttendanceLogRepo.insert(log);
      return registration;
    });

    return ok({ registration: result });
  } catch (e) {
    return err(String(e));
  }
}

// ---------- apiCancelRegistration --------------------------------------------
// google.script.run.apiCancelRegistration({eventId, registrationId, reason?})

interface CancelParams {
  eventId: string;
  registrationId: string;
  reason?: string;
}

function apiCancelRegistration(paramsInput: string | CancelParams): GoogleAppsScript.Content.TextOutput {
  try {
    const params = parseInput<CancelParams>(paramsInput);
    const { eventId, registrationId, reason = 'Participant cancellation' } = params;
    if (!eventId || !registrationId) return err('Missing required fields: eventId, registrationId');

    const user = resolveUser();
    const event = EventRepo.findById(eventId);
    if (!event) return err(`Event ${eventId} not found`, 404);

    return withLock(() => {
      const currentRegistrations = RegistrationRepo.findByEvent(eventId);
      const target = currentRegistrations.find(r => r.id === registrationId);
      if (!target) return err(`Registration ${registrationId} not found`, 404);

      // Door volunteers cannot cancel other attendees
      if (user.role === 'DOOR_VOLUNTEER' && target.participantUserId !== user.userId) {
        throw new Error('Access Denied: Door volunteers cannot cancel other participants.');
      }

      const { cancelled, promoted, logs } = WaitlistEngine.cancel(
        event, registrationId, reason, currentRegistrations, user.userId
      );

      const statusUpdates = new Map<string, { status: RegistrationStatus; waitlistPosition?: number | null }>();
      statusUpdates.set(cancelled.id, { status: 'cancelled', waitlistPosition: null });

      if (promoted) {
        statusUpdates.set(promoted.id, { status: 'registered', waitlistPosition: null });
        // Shift remaining waitlist positions
        const remainingWaitlisted = currentRegistrations.filter(
          r => r.id !== cancelled.id && r.id !== promoted.id && r.status === 'waitlisted'
        ).sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

        remainingWaitlisted.forEach((r, idx) => {
          statusUpdates.set(r.id, { status: 'waitlisted', waitlistPosition: idx + 1 });
        });
      }

      RegistrationRepo.updateStatusesBatch(statusUpdates);
      AttendanceLogRepo.insertBatch(logs);

      return ok({
        cancelled: { id: cancelled.id, status: cancelled.status },
        promoted: promoted ? { id: promoted.id, participantUserId: promoted.participantUserId } : null,
      });
    });
  } catch (e) {
    return err(String(e));
  }
}

// ---------- apiGetEventDashboard ----------------------------------------------
// google.script.run.apiGetEventDashboard({eventId})

interface DashboardParams {
  eventId: string;
}

function apiGetEventDashboard(paramsInput: string | DashboardParams): GoogleAppsScript.Content.TextOutput {
  try {
    const params = parseInput<DashboardParams>(paramsInput);
    const { eventId } = params;
    if (!eventId) return err('Missing required field: eventId');

    const user = resolveUser();
    RBACGuard.assertCanViewSensitiveAttributes(user);

    // 5-second cache check to protect Google Sheets quota during multi-coordinator polling
    const cache = CacheService.getScriptCache();
    const cacheKey = `dash_${eventId}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return ContentService.createTextOutput(cachedData).setMimeType(ContentService.MimeType.JSON);
    }

    const event = EventRepo.findById(eventId);
    if (!event) return err(`Event ${eventId} not found`, 404);

    const registrations = RegistrationRepo.findByEvent(eventId);
    const checkedIn   = registrations.filter(r => r.status === 'attended').length;
    const registered  = registrations.filter(r => r.status === 'registered').length;
    const waitlisted  = registrations.filter(r => r.status === 'waitlisted').length;
    const noShow      = registrations.filter(r => r.status === 'no_show').length;

    const response = {
      ok: true,
      data: {
        event: { id: event.id, title: event.title, maxCapacity: event.maxCapacity, status: event.status },
        stats: { checkedIn, registered, waitlisted, noShow, capacity: event.maxCapacity },
      },
    };

    const responseJson = JSON.stringify(response);
    cache.put(cacheKey, responseJson, 5); // cache for 5 seconds

    return ContentService.createTextOutput(responseJson).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return err(String(e));
  }
}

// ---------- setupEventlySheet -------------------------------------------------
// Run once to initialize tabs, headers, formatting, and script properties.
function setupEventlySheet(sheetId?: string): string {
  const result = setupEventlySpreadsheet(sheetId);
  return `Evently initialized successfully! Sheet URL: ${result.url}`;
}

// ==============================================================================
// Expose functions to globalThis so esbuild IIFE bundle keeps them callable
// by the Google Apps Script runtime as global functions.
// ==============================================================================
declare const globalThis: Record<string, unknown>;
globalThis['doGet']                  = doGet;
globalThis['apiVerifyScan']          = apiVerifyScan;
globalThis['apiProcessOfflineQueue'] = apiProcessOfflineQueue;
globalThis['apiManualOverride']      = apiManualOverride;
globalThis['apiRegisterWalkIn']      = apiRegisterWalkIn;
globalThis['apiCancelRegistration']  = apiCancelRegistration;
globalThis['apiGetEventDashboard']   = apiGetEventDashboard;
globalThis['setupEventlySheet']      = setupEventlySheet;
