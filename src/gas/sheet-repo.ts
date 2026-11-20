// ==============================================================================
// Evently GAS — Sheet Repository
// Google Sheets-backed data store with LockService concurrency protection.
//
// Sheet layout (one Google Spreadsheet, multiple tabs):
//   - "registrations"   : id, eventId, participantUserId, isExternal, status,
//                         waitlistPosition, registeredAt, customFields (JSON)
//   - "attendance_log"  : id, registrationId, eventId, fromStatus, toStatus,
//                         changedBy, changedAt, reason, source
//   - "scan_audit_log"  : id, eventId, sessionId, registrationId,
//                         participantUserId, scannerUserId, scanResult,
//                         doorGate, overrideReason, offlineBuffered, scannedAt
//   - "events"          : id, eventTypeSlug, title, status, ownerUserId,
//                         startDate, endDate, maxCapacity, waitlistEnabled,
//                         waitlistPromotionMode, config (JSON), attributes (JSON)
//
// Spreadsheet ID is stored in Script Properties under key "EVENTLY_SHEET_ID".
// ==============================================================================

import { Registration, AttendanceLogEntry, ScanAuditEntry, EventRecord } from '../types/index.js';

// ---------- helpers & spreadsheet connection caching --------------------------

let cachedSS: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;

function getSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  if (cachedSS) return cachedSS;
  const sheetId = PropertiesService.getScriptProperties().getProperty('EVENTLY_SHEET_ID');
  if (!sheetId) throw new Error('EVENTLY_SHEET_ID not set in Script Properties');
  cachedSS = SpreadsheetApp.openById(sheetId);
  return cachedSS;
}

function getSheet(name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet tab "${name}" not found`);
  return sheet;
}

/** Appends a single row array to a named sheet tab. */
function appendRow(sheetName: string, row: unknown[]): void {
  getSheet(sheetName).appendRow(row);
}

/** Appends multiple row arrays in a single atomic setValues call. */
function appendRows(sheetName: string, rows: unknown[][]): void {
  if (rows.length === 0) return;
  const sheet = getSheet(sheetName);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
}

/** Reads all data rows (skipping header row 1) from a sheet as plain objects. */
function readAllRows(sheetName: string): Record<string, string>[] {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
  );
}

/**
 * Acquires a script-level lock before executing fn.
 * Throws if lock cannot be acquired within 10 s (prevents concurrent write corruption).
 */
export function withLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10_000); // 10-second timeout
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- Registration Repository ------------------------------------------

export const RegistrationRepo = {
  /** Returns all registrations for an event (reads are eventually consistent). */
  findByEvent(eventId: string): Registration[] {
    return readAllRows('registrations')
      .filter(r => r.eventId === eventId)
      .map(rowToRegistration);
  },

  /** Returns a single registration by ID. */
  findById(id: string): Registration | undefined {
    return readAllRows('registrations').filter(r => r.id === id).map(rowToRegistration)[0];
  },

  /** Appends a new registration row. Call inside withLock(). */
  insert(reg: Registration): void {
    appendRow('registrations', [
      reg.id, reg.eventId, reg.participantUserId, String(reg.isExternal),
      reg.status, reg.waitlistPosition ?? '', reg.registeredAt,
      reg.cancelledAt ?? '', reg.cancellationReason ?? '',
      JSON.stringify(reg.customFields), reg.qrSecretSalt, reg.notes ?? '',
    ]);
  },

  /**
   * Updates the status (and optional waitlistPosition) of a registration row.
   * Call inside withLock().
   */
  updateStatus(id: string, status: Registration['status'], waitlistPosition?: number | null): void {
    this.updateStatusesBatch(new Map([[id, { status, waitlistPosition }]]));
  },

  /**
   * Updates multiple registration statuses in a single atomic read-and-write.
   * Call inside withLock().
   */
  updateStatusesBatch(
    updates: Map<string, { status: Registration['status']; waitlistPosition?: number | null }>
  ): void {
    if (updates.size === 0) return;
    const sheet = getSheet('registrations');
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;

    const headers = data[0].map(String);
    const idCol = headers.indexOf('id');
    const statusCol = headers.indexOf('status');
    const wlCol = headers.indexOf('waitlistPosition');

    let modified = false;
    for (let i = 1; i < data.length; i++) {
      const regId = String(data[i][idCol]);
      const update = updates.get(regId);
      if (update) {
        data[i][statusCol] = update.status;
        if (update.waitlistPosition !== undefined) {
          data[i][wlCol] = update.waitlistPosition ?? '';
        }
        modified = true;
      }
    }

    if (modified) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    }
  },
};

function rowToRegistration(r: Record<string, string>): Registration {
  return {
    id: r.id,
    eventId: r.eventId,
    participantUserId: r.participantUserId,
    isExternal: r.isExternal === 'true',
    status: r.status as Registration['status'],
    waitlistPosition: r.waitlistPosition ? Number(r.waitlistPosition) : undefined,
    registeredAt: r.registeredAt,
    cancelledAt: r.cancelledAt || undefined,
    cancellationReason: r.cancellationReason || undefined,
    customFields: r.customFields ? JSON.parse(r.customFields) : {},
    qrSecretSalt: r.qrSecretSalt,
    notes: r.notes || undefined,
  };
}

// ---------- Attendance Log Repository ----------------------------------------

export const AttendanceLogRepo = {
  insert(entry: AttendanceLogEntry): void {
    this.insertBatch([entry]);
  },

  insertBatch(entries: AttendanceLogEntry[]): void {
    const rows = entries.map(entry => [
      entry.id, entry.registrationId, entry.eventId,
      entry.fromStatus ?? '', entry.toStatus, entry.changedBy,
      entry.changedAt, entry.reason ?? '', entry.source,
    ]);
    appendRows('attendance_log', rows);
  },
};

// ---------- Scan Audit Log Repository ----------------------------------------

export const ScanAuditRepo = {
  insert(entry: ScanAuditEntry): void {
    this.insertBatch([entry]);
  },

  insertBatch(entries: ScanAuditEntry[]): void {
    const rows = entries.map(entry => [
      entry.id, entry.eventId, entry.sessionId ?? '', entry.registrationId ?? '',
      entry.participantUserId, entry.scannerUserId, entry.scanResult,
      entry.doorGate, entry.overrideReason ?? '',
      String(entry.offlineBuffered), entry.scannedAt,
    ]);
    appendRows('scan_audit_log', rows);
  },
};

// ---------- Event Repository --------------------------------------------------

export const EventRepo = {
  findById(id: string): EventRecord | undefined {
    return readAllRows('events').filter(r => r.id === id).map(rowToEvent)[0];
  },
};

function rowToEvent(r: Record<string, string>): EventRecord {
  return {
    id: r.id,
    eventTypeSlug: r.eventTypeSlug as EventRecord['eventTypeSlug'],
    title: r.title,
    status: r.status as EventRecord['status'],
    ownerUserId: r.ownerUserId,
    startDate: r.startDate,
    endDate: r.endDate,
    timezone: r.timezone || 'Europe/London',
    maxCapacity: Number(r.maxCapacity),
    waitlistEnabled: r.waitlistEnabled === 'true',
    waitlistPromotionMode: (r.waitlistPromotionMode || 'automatic') as EventRecord['waitlistPromotionMode'],
    config: r.config ? JSON.parse(r.config) : {},
    attributes: r.attributes ? JSON.parse(r.attributes) : {},
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ---------- Automated Sheet Schema Initializer --------------------------------

export const SCHEMA_DEFINITIONS: Record<string, string[]> = {
  events: [
    'id', 'eventTypeSlug', 'title', 'status', 'ownerUserId',
    'startDate', 'endDate', 'timezone', 'maxCapacity',
    'waitlistEnabled', 'waitlistPromotionMode', 'config', 'attributes',
    'createdAt', 'updatedAt',
  ],
  registrations: [
    'id', 'eventId', 'participantUserId', 'isExternal', 'status',
    'waitlistPosition', 'registeredAt', 'cancelledAt', 'cancellationReason',
    'customFields', 'qrSecretSalt', 'notes',
  ],
  attendance_log: [
    'id', 'registrationId', 'eventId', 'fromStatus', 'toStatus',
    'changedBy', 'changedAt', 'reason', 'source',
  ],
  scan_audit_log: [
    'id', 'eventId', 'sessionId', 'registrationId',
    'participantUserId', 'scannerUserId', 'scanResult',
    'doorGate', 'overrideReason', 'offlineBuffered', 'scannedAt',
  ],
};

export function setupEventlySpreadsheet(spreadsheetId?: string): { spreadsheetId: string; url: string } {
  let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
    ss = SpreadsheetApp.create('Evently — Operations Center');
  }

  for (const [tabName, headers] of Object.entries(SCHEMA_DEFINITIONS)) {
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#1C2541');
      headerRange.setFontColor('#F8FAFC');
      headerRange.setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }

  // Only delete default 'Sheet1' if this is a newly created workbook
  if (!spreadsheetId) {
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      try {
        ss.deleteSheet(defaultSheet);
      } catch {
        // Ignore if cannot delete
      }
    }
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('EVENTLY_SHEET_ID', ss.getId());
  cachedSS = ss;

  if (!props.getProperty('EVENTLY_QR_SECRET')) {
    const generatedSecret = Utilities.base64EncodeWebSafe(
      Utilities.newBlob(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).getBytes()
    ).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    props.setProperty('EVENTLY_QR_SECRET', generatedSecret);
  }

  return { spreadsheetId: ss.getId(), url: ss.getUrl() };
}
