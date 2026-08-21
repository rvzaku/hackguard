import {
  ArmMetricsSchema,
  EVAL_METHODOLOGY_CAPTION,
  EvalLoopArtifactSchema,
  type ArmMetrics,
  type EvalLoopArtifact,
  type RoundRecord,
  type TimingPolicyParams,
} from './artifact';
import { gradeBaseline, gradePolicy } from './grader';
import { PARAM_GRID, POLICY_V1_PARAMS, policyVersion } from './policy';
import { simulateCorpus } from './simulator';

/**
 * Improvement loop (eval-loop scope item 3): hill-climb the timing-policy
 * parameters over a FIXED grid on graded adversarial streams. Deterministic
 * tuning — no auto-ML: each round evaluates the grid neighbors of the current
 * best parameter set, adopts the best strictly-improving neighbor (objective:
 * net recovered value minus penalty fees), and keeps the previous best
 * otherwise. The objective is therefore monotonically non-decreasing by
 * construction, and the committed artifact records every round.
 */

/** Default eval seed (2026-08-22). Overridable for robustness testing. */
export const EVAL_SEED = 20260822;
export const TUNING_ROUNDS = 6;

function objective(m: ArmMetrics): number {
  return m.netValueMinor;
}

/** Lexicographic tie-break so parameter selection is fully deterministic. */
function paramsKey(p: TimingPolicyParams): string {
  return `${p.firstOffsetHours}|${p.stepHours}|${p.paydaySnapDays}`;
}

/** All one-step grid neighbors of a parameter set (deduplicated). */
export function gridNeighbors(params: TimingPolicyParams): TimingPolicyParams[] {
  const seen = new Set<string>([paramsKey(params)]);
  const neighbors: TimingPolicyParams[] = [];
  for (const key of Object.keys(PARAM_GRID) as Array<keyof TimingPolicyParams>) {
    const values = PARAM_GRID[key];
    const idx = values.indexOf(params[key]);
    if (idx === -1) throw new Error(`param ${key}=${params[key]} is off-grid`);
    for (const delta of [-1, 1]) {
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= values.length) continue;
      const candidate = { ...params, [key]: values[nextIdx] } as TimingPolicyParams;
      const k = paramsKey(candidate);
      if (!seen.has(k)) {
        seen.add(k);
        neighbors.push(candidate);
      }
    }
  }
  return neighbors;
}

export function runEvalLoop(seed: number = EVAL_SEED, rounds: number = TUNING_ROUNDS): EvalLoopArtifact {
  if (rounds < 1) throw new Error('runEvalLoop requires at least one round');
  const { streams } = simulateCorpus(seed);
  const baseline = gradeBaseline(streams);

  const roundRecords: RoundRecord[] = [];
  let current: TimingPolicyParams = POLICY_V1_PARAMS;
  let currentGrade = gradePolicy(streams, current);

  for (let round = 1; round <= rounds; round++) {
    if (round > 1) {
      let bestParams: TimingPolicyParams = current;
      let bestObjective = objective(currentGrade.overall);
      let bestGrade = currentGrade;
      let improved = false;
      for (const candidate of gridNeighbors(current)) {
        const grade = gradePolicy(streams, candidate);
        const o = objective(grade.overall);
        // Strictly better wins; on exact ties prefer the lexicographically
        // smaller parameter key (only among adopted candidates, so an
        // unchanged incumbent is never replaced by an equal one).
        const wins = o > bestObjective || (o === bestObjective && improved && paramsKey(candidate) < paramsKey(bestParams));
        if (wins) {
          bestParams = candidate;
          bestObjective = o;
          bestGrade = grade;
          improved = true;
        }
      }
      if (!improved) {
        bestParams = current;
        bestGrade = currentGrade;
      }
      current = bestParams;
      currentGrade = bestGrade;
    }

    roundRecords.push({
      round,
      policyVersion: policyVersion(round),
      params: current,
      metrics: ArmMetricsSchema.parse(currentGrade.overall),
      improved: round === 1 ? false : objective(currentGrade.overall) > objective(roundRecords[round - 2]?.metrics as ArmMetrics),
    });
  }

  const first = roundRecords[0] as RoundRecord;
  const final = roundRecords[roundRecords.length - 1] as RoundRecord;

  const perScenarioFinal = currentGrade.perScenario.map((p, i) => ({
    scenario: p.scenario,
    policy: ArmMetricsSchema.parse(p.metrics),
    baseline: ArmMetricsSchema.parse(baseline.perScenario[i]?.metrics ?? baseline.overall),
  }));

  return EvalLoopArtifactSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed,
    rounds: roundRecords,
    baselineVersion: baseline.version,
    baselineMetrics: baseline.overall,
    perScenarioFinal,
    summary: {
      finalPolicyVersion: final.policyVersion,
      recoveryRateFirst: first.metrics.recoveryRate,
      recoveryRateFinal: final.metrics.recoveryRate,
      violationsFinal: final.metrics.complianceViolations,
      penaltyFeeMinorFinal: final.metrics.penaltyFeeMinor,
      baselinePenaltyFeeMinor: baseline.overall.penaltyFeeMinor,
    },
    methodology: EVAL_METHODOLOGY_CAPTION,
  });
}
