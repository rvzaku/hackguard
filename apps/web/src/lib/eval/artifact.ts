import { z } from 'zod';

/**
 * Contract for the committed eval-loop metrics artifact (scope item 4/5).
 * The runner script writes it, the API route re-validates it on serve, and
 * the dashboard panel types against it — one schema, three consumers, so the
 * artifact can never drift from what the UI renders.
 */

export const EVAL_METHODOLOGY_CAPTION =
  'counterfactual estimation on seeded adversarial streams — deterministic, reproducible, disclosed';

export const TimingPolicyParamsSchema = z.object({
  firstOffsetHours: z.number().int().min(1).max(168),
  stepHours: z.number().int().min(1).max(336),
  paydaySnapDays: z.number().int().min(0).max(14),
});
export type TimingPolicyParams = z.infer<typeof TimingPolicyParamsSchema>;

export const ArmMetricsSchema = z.object({
  recoveredCount: z.number().int().min(0),
  retryableCount: z.number().int().min(0),
  recoveryRate: z.number().min(0).max(1),
  complianceViolations: z.number().int().min(0),
  penaltyFeeMinor: z.number().int().min(0),
  recoveredAmountMinor: z.number().int().min(0),
  netValueMinor: z.number().int(),
});
export type ArmMetrics = z.infer<typeof ArmMetricsSchema>;

export const RoundRecordSchema = z.object({
  round: z.number().int().min(1),
  policyVersion: z.string().min(1),
  params: TimingPolicyParamsSchema,
  metrics: ArmMetricsSchema,
  /** True when this round's tuning step strictly improved on the previous round. */
  improved: z.boolean(),
});
export type RoundRecord = z.infer<typeof RoundRecordSchema>;

export const ScenarioGradeSchema = z.object({
  scenario: z.string().min(1),
  policy: ArmMetricsSchema,
  baseline: ArmMetricsSchema,
});
export type ScenarioGrade = z.infer<typeof ScenarioGradeSchema>;

export const EvalLoopArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  seed: z.number().int(),
  rounds: z.array(RoundRecordSchema).min(1),
  baselineVersion: z.string().min(1),
  baselineMetrics: ArmMetricsSchema,
  perScenarioFinal: z.array(ScenarioGradeSchema),
  summary: z.object({
    finalPolicyVersion: z.string().min(1),
    recoveryRateFirst: z.number().min(0).max(1),
    recoveryRateFinal: z.number().min(0).max(1),
    violationsFinal: z.number().int().min(0),
    penaltyFeeMinorFinal: z.number().int().min(0),
    baselinePenaltyFeeMinor: z.number().int().min(0),
  }),
  methodology: z.literal(EVAL_METHODOLOGY_CAPTION),
});
export type EvalLoopArtifact = z.infer<typeof EvalLoopArtifactSchema>;
