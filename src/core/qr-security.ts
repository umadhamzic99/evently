import crypto from 'node:crypto';
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

export class QRSecurityManager {
  private secretKey: string;
  // shortcut: in-memory Map for single-use token lock; upgrade to Redis/Firestore transaction when deploying multi-worker Cloud Run instances.
  private consumedTokens: Map<
    string,
    { scannedAt: string; doorGate: string; scannerUserId: string }
  > = new Map();

  constructor(secretKey: string) {
    if (!secretKey || secretKey.length < 16) {
      throw new Error('QR secret key must be at least 16 characters long');
    }
    this.secretKey = secretKey;
  }

  /**
   * Generates a cryptographically signed dynamic QR token.
   */
  public generateDynamicToken(
    registrationId: string,
    eventId: string,
    participantUserId: string,
    validDurationSeconds: number = 3600 * 4, // 4-hour window by default
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
      nonce: crypto.randomBytes(8).toString('hex'),
    };

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies an incoming QR token at the door, enforcing:
   * 1. Cryptographic HMAC authenticity
   * 2. Time-window validity
   * 3. Single-use server lock (anti-replay screenshot defense)
   */
  public verifyAndConsumeToken(
    tokenString: string,
    expectedEventId: string,
    scannerUserId: string,
    doorGate: string,
    deviceFingerprint?: string,
    expectedSessionId?: string
  ): ScanVerificationResult {
    const nowIso = new Date().toISOString();
    const currentEpoch = Math.floor(Date.now() / 1000);
    const parts = tokenString.split('.');

    const buildAudit = (
      result: ScanResult,
      uid: string,
      regId?: string,
      age?: number
    ): ScanAuditEntry => ({
      id: `audit_${crypto.randomBytes(8).toString('hex')}`,
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
      const audit = buildAudit('INVALID_SIGNATURE', 'UNKNOWN');
      return {
        valid: false,
        scanResult: 'INVALID_SIGNATURE',
        message: 'Malformed token structure',
        auditEntry: audit,
      };
    }

    const [payloadB64, signature] = parts;

    // 1. Verify HMAC Signature
    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
      const audit = buildAudit('INVALID_SIGNATURE', 'UNKNOWN');
      return {
        valid: false,
        scanResult: 'INVALID_SIGNATURE',
        message: 'Invalid cryptographic signature. Forged or corrupted token.',
        auditEntry: audit,
      };
    }

    // 2. Parse Payload
    let payload: DynamicQRTokenPayload;
    try {
      const rawJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(rawJson);
    } catch {
      const audit = buildAudit('INVALID_SIGNATURE', 'UNKNOWN');
      return {
        valid: false,
        scanResult: 'INVALID_SIGNATURE',
        message: 'Unparseable payload JSON',
        auditEntry: audit,
      };
    }

    const tokenAge = currentEpoch - payload.iat;

    // 3. Event / Session Match Verification
    if (payload.eid !== expectedEventId) {
      const audit = buildAudit('UNREGISTERED', payload.uid, payload.tid, tokenAge);
      return {
        valid: false,
        scanResult: 'UNREGISTERED',
        message: `Token event mismatch. Expected: ${expectedEventId}, Found: ${payload.eid}`,
        auditEntry: audit,
      };
    }

    if (expectedSessionId && payload.sid && payload.sid !== expectedSessionId) {
      const audit = buildAudit('SESSION_MISMATCH', payload.uid, payload.tid, tokenAge);
      return {
        valid: false,
        scanResult: 'SESSION_MISMATCH',
        message: `Token session mismatch. Expected: ${expectedSessionId}, Found: ${payload.sid}`,
        auditEntry: audit,
      };
    }

    // 4. Time Window Expiry Check
    if (currentEpoch > payload.exp) {
      const audit = buildAudit('EXPIRED_TOKEN', payload.uid, payload.tid, tokenAge);
      return {
        valid: false,
        scanResult: 'EXPIRED_TOKEN',
        message: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
        auditEntry: audit,
      };
    }

    // 5. Single-Use Locking (Anti-Replay / Screenshot Defense)
    const lockKey = payload.sid ? `${payload.eid}:${payload.sid}:${payload.tid}` : `${payload.eid}:${payload.tid}`;
    const previousScan = this.consumedTokens.get(lockKey);

    if (previousScan) {
      const audit = buildAudit('DUPLICATE_REJECTED', payload.uid, payload.tid, tokenAge);
      return {
        valid: false,
        scanResult: 'DUPLICATE_REJECTED',
        message: `Duplicate Scan: Already Checked In at ${previousScan.scannedAt} at ${previousScan.doorGate} by operator ${previousScan.scannerUserId}`,
        auditEntry: audit,
      };
    }

    // First valid scan: Consume token lock
    this.consumedTokens.set(lockKey, {
      scannedAt: nowIso,
      doorGate,
      scannerUserId,
    });

    const audit = buildAudit('SUCCESS', payload.uid, payload.tid, tokenAge);

    return {
      valid: true,
      scanResult: 'SUCCESS',
      message: `Checked in successfully: ${payload.uid}`,
      payload,
      auditEntry: audit,
    };
  }

  /**
   * Resets or marks token for testing or manual re-entry if needed
   */
  public clearLock(lockKey: string): void {
    this.consumedTokens.delete(lockKey);
  }
}
