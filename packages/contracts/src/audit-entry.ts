import { z } from 'zod';

/**
 * AuditEntry — one link in the append-only, hash-chained compliance ledger.
 * Contract: plan §4. Tamper-evidence: hash = SHA-256(seq || prevHash || payload).
 */
export const AuditActorSchema = z.enum(['MODEL', 'RULE', 'HUMAN']);
export type AuditActor = z.infer<typeof AuditActorSchema>;

const hex64 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'lowercase hex-encoded SHA-256 digest');

export const AuditEntrySchema = z.object({
  seq: z
    .number()
    .int()
    .min(0)
    .describe('Application-assigned monotonically increasing sequence number (0 = genesis)'),
  prevHash: hex64.describe('Hash of the previous entry; all-zero hex for the genesis entry'),
  hash: hex64.describe('SHA-256 over (seq, prevHash, decisionRef, actor, ts) — tamper-evident'),
  decisionRef: z.string().min(1).describe('Id of the Decision this entry attests'),
  actor: AuditActorSchema,
  ts: z.string().datetime({ offset: true }),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;
