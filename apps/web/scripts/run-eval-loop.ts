import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EvalLoopArtifactSchema } from '../src/lib/eval/artifact';
import { EVAL_SEED, TUNING_ROUNDS, runEvalLoop } from '../src/lib/eval/tuner';

/**
 * One-command adversarial eval loop (acceptance: "one command runs the full
 * loop and emits a metrics artifact committed to the repo"):
 *
 *   npm run eval:loop
 *
 * Runs the seeded simulator -> grades baseline vs policy -> hill-climbs the
 * timing-policy parameters for N rounds -> writes the validated artifact to
 * models/registry/eval-loop-v1/metrics.json.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(scriptDir, '../../../models/registry/eval-loop-v1/metrics.json');

const seedArg = process.argv[2] ? Number(process.argv[2]) : undefined;
if (process.argv[2] !== undefined && (!Number.isInteger(seedArg) || seedArg === undefined || seedArg <= 0)) {
  console.error(`usage: tsx apps/web/scripts/run-eval-loop.ts [seed]  (got "${process.argv[2]}")`);
  process.exit(1);
}

const seed = seedArg ?? EVAL_SEED;
console.log(`eval-loop: seed=${seed} rounds=${TUNING_ROUNDS}`);
const artifact = runEvalLoop(seed, TUNING_ROUNDS);

// Re-validate through the shared contract before writing — the artifact on
// disk must always satisfy the schema the API route and UI parse it with.
const parsed = EvalLoopArtifactSchema.parse(artifact);

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

for (const round of parsed.rounds) {
  const m = round.metrics;
  console.log(
    `round ${round.round} ${round.policyVersion}: recovery ${(m.recoveryRate * 100).toFixed(1)}% ` +
      `(recovered $${(m.recoveredAmountMinor / 100).toFixed(2)}) violations=${m.complianceViolations} ` +
      `fees=$${(m.penaltyFeeMinor / 100).toFixed(2)} net=$${(m.netValueMinor / 100).toFixed(2)} ` +
      `params=${JSON.stringify(round.params)}${round.improved ? ' improved' : ''}`,
  );
}
const b = parsed.baselineMetrics;
console.log(
  `baseline (${parsed.baselineVersion}): recovery ${(b.recoveryRate * 100).toFixed(1)}% violations=${b.complianceViolations} fees=$${(b.penaltyFeeMinor / 100).toFixed(2)}`,
);
console.log(`summary: ${parsed.summary.finalPolicyVersion} recovery ${(parsed.summary.recoveryRateFirst * 100).toFixed(1)}% -> ${(parsed.summary.recoveryRateFinal * 100).toFixed(1)}%, violations ${parsed.summary.violationsFinal}`);
console.log(`artifact written: ${artifactPath}`);
