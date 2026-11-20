// ==============================================================================
// Evently GAS — QR Security (Apps Script re-implementation)
// Replaces node:crypto with GAS Utilities.computeHmacSha256Signature.
// Uses CacheService for fast lock deduplication without filling PropertiesService.
// ==============================================================================

import {
  DynamicQRTokenPayload,
  ScanResult,
  ScanAuditEntry,
} from '../types/index.js';

export interface ScanVerificationResult {
  valid: boolean;
  scanResult: ScanResult;
  message: string;
  payload?: DynamicQRTokenPayload;
  auditEntry: ScanAuditEntry;
}

/** Encodes a string to base64url using GAS Utilities. */
function toBase64Url(input: string): string {
  return Utilities.base64EncodeWebSafe(input).replace(/=+$/, '');
}

/** Decodes a base64url string using GAS Utilities. */
function fromBase64Url(input: string): string {
  const padded = input + '==='.slice((input.length + 3) % 4);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
}

/**
 * Computes HMAC-SHA256 signature using GAS Utilities (identical algorithm to node:crypto).
 * Returns base64url-encoded signature.
 */
function hmacSha256(key: string, data: string): string {
  const signatureBytes = Utilities.computeHmacSha256Signature(data, key);
  const blob = Utilities.newBlob(signatureBytes);
  return Utilities.base64EncodeWebSafe(blob.getBytes()).replace(/=+$/, '');
}

/** Generates a random hex nonce using GAS Utilities. */
function randomHex(bytes: number): string {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(
    Array.from({ length: bytes }, () => Math.floor(Math.random() * 256))
  ).getBytes()).replace(/[^a-f0-9]/gi, '').substring(0, bytes * 2);
}

export class GasQRSecurityManager {
  private secretKey: string;

  constructor(secretKey: string) {
    if (!secretKey || secretKey.length < 16) {
      throw new Error('QR secret key must be at least 16 characters long');
    }
    this.secretKey = secretKey;
  }

  public generateDynamicToken(
    registrationId: string,
    eventId: string,
    participantUserId: string,
    validDurationSeconds = 3600 * 4,
    sessionId?: string
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: DynamicQRTokenPayload = {
      tid: registrationId,
      eid: eventId,
      sid: sessionId,
      uid: participantUserId,
      iat: now,
      exp: now + validDurationSeconds,
      ver: 1,
      nonce: randomHex(8),
    };
    const payloadB64 = toBase64Url(JSON.stringify(payload));
    const sig = hmacSha256(this.secretKey, payloadB64);
    return `${payloadB64}.${sig}`;
  }

  public verifyAndConsumeToken(
    tokenString: string,
    expectedEventId: string,
    scannerUserId: string,
    doorGate: string,
    deviceFingerprint?: string,
    expectedSessionId?: string,
    // Optional cache override for unit testing outside GAS
    customCache?: { get(key: string): string | null; put(key: string, value: string, expirationInSeconds?: number): void }
  ): ScanVerificationResult {
    const nowIso = new Date().toISOString();
    const currentEpoch = Math.floor(Date.now() / 1000);
    const parts = tokenString.split('.');

    const buildAudit = (result: ScanResult, uid: string, regId?: string, age?: number): ScanAuditEntry => ({
      id: `audit_${randomHex(8)}`,
      eventId: expectedEventId,
      sessionId: expectedSessionId,
      registrationId: regId,
      participantUserId: uid,
      scannerUserId,
      scanResult: result,
      doorGate,
      deviceFingerprint,
      tokenAgeSeconds: age,
      offlineBuffered: false,
      scannedAt: nowIso,
    });

    if (parts.length !== 2) {
      return { valid: false, scanResult: 'INVALID_SIGNATURE', message: 'Malformed token', auditEntry: buildAudit('INVALID_SIGNATURE', 'UNKNOWN') };
    }

    const [payloadB64, signature] = parts;
    const expectedSig = hmacSha256(this.secretKey, payloadB64);

    if (signature.length !== expectedSig.length || signature !== expectedSig) {
      return { valid: false, scanResult: 'INVALID_SIGNATURE', message: 'Invalid signature', auditEntry: buildAudit('INVALID_SIGNATURE', 'UNKNOWN') };
    }

    let payload: DynamicQRTokenPayload;
    try {
      payload = JSON.parse(fromBase64Url(payloadB64));
    } catch {
      return { valid: false, scanResult: 'INVALID_SIGNATURE', message: 'Unparseable payload', auditEntry: buildAudit('INVALID_SIGNATURE', 'UNKNOWN') };
    }

    const tokenAge = currentEpoch - payload.iat;

    if (payload.eid !== expectedEventId) {
      return { valid: false, scanResult: 'UNREGISTERED', message: `Event mismatch`, auditEntry: buildAudit('UNREGISTERED', payload.uid, payload.tid, tokenAge) };
    }

    if (expectedSessionId && payload.sid && payload.sid !== expectedSessionId) {
      return { valid: false, scanResult: 'SESSION_MISMATCH', message: `Session mismatch`, auditEntry: buildAudit('SESSION_MISMATCH', payload.uid, payload.tid, tokenAge) };
    }

    if (currentEpoch > payload.exp) {
      return { valid: false, scanResult: 'EXPIRED_TOKEN', message: `Token expired`, auditEntry: buildAudit('EXPIRED_TOKEN', payload.uid, payload.tid, tokenAge) };
    }

    // Fast deduplication via CacheService (6-hour TTL) instead of filling PropertiesService quota
    const lockKey = `scan_${payload.eid}_${payload.sid ?? 'evt'}_${payload.tid}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const cache = customCache ?? CacheService.getScriptCache();
    const cachedScan = cache.get(lockKey);

    if (cachedScan) {
      const prev = JSON.parse(cachedScan);
      return {
        valid: false,
        scanResult: 'DUPLICATE_REJECTED',
        message: `Duplicate Scan: Already Checked In at ${prev.scannedAt} at ${prev.doorGate}`,
        auditEntry: buildAudit('DUPLICATE_REJECTED', payload.uid, payload.tid, tokenAge),
      };
    }

    // Put into cache for 6 hours (21600 seconds)
    cache.put(lockKey, JSON.stringify({ scannedAt: nowIso, doorGate, scannerUserId }), 21600);

    return {
      valid: true,
      scanResult: 'SUCCESS',
      message: `Checked in: ${payload.uid}`,
      payload,
      auditEntry: buildAudit('SUCCESS', payload.uid, payload.tid, tokenAge),
    };
  }
}
