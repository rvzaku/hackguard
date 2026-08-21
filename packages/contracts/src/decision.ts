import { z } from 'zod';

/**
 * Decision — the triage engine's verdict for one failed payment.
 * Contract: plan §4.
 */
export const RetryActionSchema = z.enum(['RETRY', 'SUPPRESS', 'ASK_CUSTOMER']);
export type RetryAction = z.infer<typeof RetryActionSchema>;

export const ShapContributionSchema = z.object({
  feature: z.string().min(1),
  contribution: z.number().describe('SHAP value: signed contribution to P(recover) log-odds'),
});

export const DecisionSchema = z.object({
  paymentId: z.string().min(1).describe('Internal id of the failed payment this decision covers'),
  action: RetryActionSchema,
  scheduledFor: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .describe('Planned retry moment; required iff action === RETRY'),
  pRecover: z.number().min(0).max(1).describe('Model-estimated probability of recovery'),
  shapTop: z
    .array(ShapContributionSchema)
    .max(5)
    .describe('Top-5 SHAP feature contributions for the explanation panel'),
  ruleHits: z
    .array(z.string().min(1))
    .describe('Compliance rule citations that fired, e.g. "VISA-CAT1-NEVER-RETRY"'),
  modelVersion: z.string().min(1).describe('Versioned model artifact id, e.g. "propensity-v0.1.0"'),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type ShapContribution = z.infer<typeof ShapContributionSchema>;
