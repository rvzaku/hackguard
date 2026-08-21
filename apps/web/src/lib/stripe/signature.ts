import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stripe webhook signature verification (Stripe docs: "Verify webhook
 * signatures" — HMAC-SHA256 over `${timestamp}.${payload}` using the
 * endpoint's signing secret; v1 entries compared with a timing-safe equal).
 * The timestamp tolerance check also rejects captured-then-replayed requests.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureRejection =
  | 'malformed_header'
  | 'bad_signature'
  | 'stale_timestamp';

export type SignatureVerification =
  | { ok: true }
  | { ok: false; rejection: SignatureRejection };

export interface StripeSignatureHeader {
  timestamp: number;
  signatures: string[];
}

export function parseStripeSignatureHeader(header: string): StripeSignatureHeader | null {
  const parts = header.split(',').map((kv) => kv.split('=', 2));
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const [key, value] of parts) {
    if (!key || !value) continue;
    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) return null;
      timestamp = parsed;
    } else if (key === 'v1') {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function signPayload(payload: string, secret: string, timestampSeconds: number): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${payload}`, 'utf8').digest('hex');
}

export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): SignatureVerification {
  if (!header) return { ok: false, rejection: 'malformed_header' };
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed) return { ok: false, rejection: 'malformed_header' };

  const ageSeconds = Math.abs(nowMs / 1000 - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, rejection: 'stale_timestamp' };
  }

  const expected = signPayload(payload, secret, parsed.timestamp);
  for (const candidate of parsed.signatures) {
    if (safeEqualHex(expected, candidate)) {
      return { ok: true };
    }
  }
  return { ok: false, rejection: 'bad_signature' };
}

/** Builds a valid Stripe-Signature header — used by tests and the seed capture tooling. */
export function buildStripeSignatureHeader(
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestampSeconds},v1=${signPayload(payload, secret, timestampSeconds)}`;
}
