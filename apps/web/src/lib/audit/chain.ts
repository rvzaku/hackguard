import { createHash } from 'node:crypto';

import { AuditEntrySchema, type AuditActor, type AuditEntry } from '@hackguard/contracts';

import { AppError } from '../errors.js';

/**
 * Append-only, hash-chained audit ledger (plan §4, db/migrations/0001_audit_log.sql).
 *
 * hash = SHA-256(canonicalJson({ seq, prevHash, decisionRef, actor, ts })).
 * The chain is verified by full scan: seq must be contiguous from 0, each
 * prevHash must equal the previous row's hash (genesis prevHash is all-zero),
 * and every hash must recompute exactly. Any mutation of a historical row —
 * decisionRef, actor, ts, hash, prevHash or seq — breaks every subsequent
 * link and is reported by verifyAuditChain.
 */

export const GENESIS_PREV_HASH = '0'.repeat(64);

/** Deterministic JSON: object keys sorted lexicographically at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export type AuditEntryWithoutHash = Omit<AuditEntry, 'hash'>;

export function computeAuditHash(entry: AuditEntryWithoutHash): string {
  return sha256Hex(
    canonicalJson({
      seq: entry.seq,
      prevHash: entry.prevHash,
      decisionRef: entry.decisionRef,
      actor: entry.actor,
      ts: entry.ts,
    }),
  );
}

/** Persistence boundary for the ledger. Postgres impl: db/migrations/0001_audit_log.sql. */
export interface AuditLogStore {
  latest(): Promise<AuditEntry | null>;
  insert(entry: AuditEntry): Promise<void>;
  all(): Promise<AuditEntry[]>;
}

export interface AppendAuditInput {
  decisionRef: string;
  actor: AuditActor;
  ts: string;
}

/**
 * Appends one entry, extending the chain from the current head.
 * Note: callers serializing concurrent appends must hold a lock (single
 * BFF instance in the demo deployment; Postgres UNIQUE(hash) is the backstop).
 */
export async function appendAuditEntry(
  store: AuditLogStore,
  input: AppendAuditInput,
): Promise<AuditEntry> {
  const latest = await store.latest();
  const withoutHash = {
    seq: latest ? latest.seq + 1 : 0,
    prevHash: latest ? latest.hash : GENESIS_PREV_HASH,
    decisionRef: input.decisionRef,
    actor: input.actor,
    ts: input.ts,
  };
  const withHash: AuditEntry = AuditEntrySchema.parse({
    ...withoutHash,
    hash: computeAuditHash(withoutHash),
  });
  await store.insert(withHash);
  return withHash;
}

export interface ChainVerification {
  valid: boolean;
  /** seq of the first bad link when invalid */
  firstBadSeq?: number;
  reason?: string;
}

/** Full-scan tamper detection. O(n); intended for the compliance ledger UI. */
export function verifyAuditChain(entries: readonly AuditEntry[]): ChainVerification {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (!entry) {
      return { valid: false, reason: 'gap in chain' };
    }
    if (entry.seq !== i) {
      return { valid: false, firstBadSeq: entry.seq, reason: `expected seq ${i}, found ${entry.seq}` };
    }
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : sorted[i - 1]?.hash;
    if (entry.prevHash !== expectedPrev) {
      return {
        valid: false,
        firstBadSeq: entry.seq,
        reason: `prevHash mismatch at seq ${entry.seq}`,
      };
    }
    const { hash, ...withoutHash } = entry;
    void hash;
    if (computeAuditHash(withoutHash) !== entry.hash) {
      return {
        valid: false,
        firstBadSeq: entry.seq,
        reason: `hash mismatch at seq ${entry.seq} — entry was modified`,
      };
    }
  }
  return { valid: true };
}

/** Convenience: verify and raise a typed error when the ledger fails inspection. */
export function assertChainIntact(entries: readonly AuditEntry[]): void {
  const verdict = verifyAuditChain(entries);
  if (!verdict.valid) {
    throw new AppError('INTERNAL', 'audit chain verification failed', verdict);
  }
}
