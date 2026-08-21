import type { TriageAction, CardNetwork } from '../triage/rules.js';

/**
 * Compliance guardrail (plan §2.4): the LAST line of defense before any retry
 * schedule is accepted. Enforces the exact verified network caps:
 *   Visa Cat 1            -> never retry (any reattempt = penalty fee)
 *   Visa Cat 2/3          -> max 15 reattempts / rolling 30 days ($0.10/attempt over)
 *   Mastercard MAC 01/03/21 -> never auto-retry
 *   Mastercard TPE        -> max 10 retries / 24h AND max 35 / rolling 30d ($0.15/attempt over 35)
 *
 * The guardrail is pure and deterministic so property-based tests (fast-check)
 * can prove: no accepted schedule can exceed a cap, and hard declines are
 * never retried.
 */

export const CAPS = {
  VISA_MAX_REATTEMPTS_30D: 15,
  MC_MAX_RETRIES_24H: 10,
  MC_MAX_RETRIES_30D: 35,
} as const;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface AttemptRecord {
  /** Scope key for caps — customer + card fingerprint (demo: customerId+brand). */
  scopeKey: string;
  network: CardNetwork;
  /** RFC 3339 moment the reattempt was (or will be) executed. */
  ts: string;
}

export interface ScheduleProposal {
  paymentId: string;
  scopeKey: string;
  network: CardNetwork;
  triageAction: TriageAction;
  scheduledFor: string;
  now: string;
}

export interface ComplianceViolation {
  ruleId: string;
  detail: string;
}

export interface GuardrailResult {
  allowed: boolean;
  violations: ComplianceViolation[];
  /** Citations for every rule that fired on this evaluation. */
  ruleIds: string[];
}

export const RULE_HARD_DECLINE_NO_RETRY = 'GUARDRAIL-HARD-DECLINE-NEVER-RETRIED';
export const RULE_VISA_30D_CAP = 'VISA-CAT23-MAX15-PER-30D';
export const RULE_MC_24H_CAP = 'MC-TPE-MAX10-PER-24H';
export const RULE_MC_30D_CAP = 'MC-TPE-MAX35-PER-30D';

function withinWindow(ts: string, fromMs: number, toMs: number): boolean {
  const t = Date.parse(ts);
  return t > fromMs && t <= toMs;
}

const PLUS_INF_MS = Number.POSITIVE_INFINITY;

/**
 * Evaluates one proposed retry against the verified caps given the attempt
 * history for the same scopeKey. Pure: no I/O, no clock reads.
 *
 * Counting semantics: the history includes already-executed AND committed
 * (scheduled-but-future) reattempts — a scheduler that has committed to N
 * retries must treat them as spent cap budget. Windows relative to `now`:
 *   30d caps: (now - 30d, +inf)
 *   24h cap:  (now - 24h, now + 24h)   — any two executions within 24h of the
 *     proposal moment share the cap, so no accepted schedule can cluster past it.
 */
export function evaluateScheduleProposal(
  proposal: ScheduleProposal,
  history: readonly AttemptRecord[],
): GuardrailResult {
  const violations: ComplianceViolation[] = [];
  const ruleIds: string[] = [];
  const nowMs = Date.parse(proposal.now);

  // Rule 0: hard declines (Visa Cat 1, MC MAC 03/21) are never retried, and
  // ASK_CUSTOMER decisions never produce automatic retries either.
  if (proposal.triageAction !== 'RETRY_SOFT') {
    violations.push({
      ruleId: RULE_HARD_DECLINE_NO_RETRY,
      detail: `triage action ${proposal.triageAction} forbids an automatic retry of payment ${proposal.paymentId}`,
    });
    ruleIds.push(RULE_HARD_DECLINE_NO_RETRY);
    return { allowed: false, violations, ruleIds };
  }

  const prior = history.filter((a) => a.scopeKey === proposal.scopeKey);

  if (proposal.network === 'visa') {
    const last30d = prior.filter((a) =>
      withinWindow(a.ts, nowMs - THIRTY_DAYS_MS, PLUS_INF_MS),
    ).length;
    if (last30d >= CAPS.VISA_MAX_REATTEMPTS_30D) {
      violations.push({
        ruleId: RULE_VISA_30D_CAP,
        detail: `visa scope ${proposal.scopeKey} already has ${last30d} reattempts in the trailing 30d window (cap ${CAPS.VISA_MAX_REATTEMPTS_30D})`,
      });
      ruleIds.push(RULE_VISA_30D_CAP);
    } else {
      ruleIds.push(RULE_VISA_30D_CAP);
    }
  }

  if (proposal.network === 'mastercard') {
    const last24h = prior.filter((a) =>
      withinWindow(a.ts, nowMs - TWENTY_FOUR_HOURS_MS, nowMs + TWENTY_FOUR_HOURS_MS),
    ).length;
    const last30d = prior.filter((a) => withinWindow(a.ts, nowMs - THIRTY_DAYS_MS, PLUS_INF_MS)).length;
    if (last24h >= CAPS.MC_MAX_RETRIES_24H) {
      violations.push({
        ruleId: RULE_MC_24H_CAP,
        detail: `mastercard scope ${proposal.scopeKey} already has ${last24h} retries in the trailing 24h window (cap ${CAPS.MC_MAX_RETRIES_24H})`,
      });
    }
    if (last30d >= CAPS.MC_MAX_RETRIES_30D) {
      violations.push({
        ruleId: RULE_MC_30D_CAP,
        detail: `mastercard scope ${proposal.scopeKey} already has ${last30d} retries in the trailing 30d window (cap ${CAPS.MC_MAX_RETRIES_30D})`,
      });
    }
    ruleIds.push(RULE_MC_24H_CAP, RULE_MC_30D_CAP);
  }

  return { allowed: violations.length === 0, violations, ruleIds };
}
