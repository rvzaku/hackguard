import { z } from 'zod';
import { AuditEntrySchema, DecisionSchema } from '@hackguard/contracts';

/**
 * Response contracts for the dashboard's BFF endpoints (plan §2/§3:
 * /api/decisions, /api/replay, /api/audit). Composed from the frozen
 * @hackguard/contracts schemas so the UI can never drift from the backend.
 */

export const DecisionFeedSchema = z.object({
  decisions: z.array(DecisionSchema),
});
export type DecisionFeed = z.infer<typeof DecisionFeedSchema>;

export const ReplaySeriesPointSchema = z.object({
  bucket: z.string().datetime({ offset: true }),
  baselineRecoveredMinor: z.number().int().min(0),
  policyRecoveredMinor: z.number().int().min(0),
});
export type ReplaySeriesPoint = z.infer<typeof ReplaySeriesPointSchema>;

/**
 * The methodology caption is enforced verbatim from the plan (§3 ML design):
 * the A/B replay is counterfactual estimation and must never be presented as
 * observed fact.
 */
export const REPLAY_METHODOLOGY_CAPTION =
  'counterfactual estimation validated against published recovery curves';

export const ReplaySeriesSchema = z.object({
  series: z.array(ReplaySeriesPointSchema),
  baselineTotalMinor: z.number().int().min(0),
  policyTotalMinor: z.number().int().min(0),
  methodology: z.literal(REPLAY_METHODOLOGY_CAPTION),
});
export type ReplaySeries = z.infer<typeof ReplaySeriesSchema>;

export const AuditLogSchema = z.object({
  entries: z.array(AuditEntrySchema),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const ChainVerificationSchema = z.object({
  valid: z.boolean(),
  checkedCount: z.number().int().min(0),
  brokenAtSeq: z.number().int().min(0).nullable(),
});
export type ChainVerification = z.infer<typeof ChainVerificationSchema>;

export const SimulateViolationResultSchema = z.object({
  blocked: z.literal(true),
  ruleHits: z.array(z.string().min(1)).min(1),
  auditEntry: AuditEntrySchema,
});
export type SimulateViolationResult = z.infer<typeof SimulateViolationResultSchema>;
