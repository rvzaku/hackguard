'use client';

import type { EvalLoopArtifact } from '@/lib/api/client';

/**
 * Adversarial eval-loop panel (eval-loop scope item 4): round-by-round
 * recovery and compliance metrics next to the A/B replay view. Renders the
 * committed artifact served by /api/eval-loop — the visible proof that the
 * policy demonstrably improves over tuning rounds.
 */
export function EvalLoopPanel({ artifact }: { artifact: EvalLoopArtifact }) {
  const { summary, rounds, baselineMetrics, baselineVersion, perScenarioFinal } = artifact;
  const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
  const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

  const maxNet = Math.max(...rounds.map((r) => r.metrics.netValueMinor), 1);

  return (
    <div className="space-y-4" data-testid="eval-loop-panel">
      <p className="text-sm text-neutral-300">
        <span className="font-semibold text-emerald-300" data-testid="eval-loop-summary">
          {summary.finalPolicyVersion}: recovery {pct(summary.recoveryRateFirst)} →{' '}
          {pct(summary.recoveryRateFinal)}, violations {summary.violationsFinal}
        </span>{' '}
        over {rounds.length} tuning rounds on seeded adversarial streams — vs baseline{' '}
        {pct(baselineMetrics.recoveryRate)} recovery with {summary.baselinePenaltyFeeMinor > 0 ? `${money(summary.baselinePenaltyFeeMinor)} penalty-fee exposure` : 'no fee exposure'}.
      </p>

      <div className="space-y-2" data-testid="eval-loop-rounds">
        {rounds.map((round) => {
          const widthPct = Math.max(4, Math.round((Math.max(round.metrics.netValueMinor, 0) / maxNet) * 100));
          return (
            <div key={round.round} className="flex items-center gap-3 text-xs" data-testid={`eval-loop-round-${round.round}`}>
              <span className="w-20 shrink-0 font-medium text-neutral-300">{round.policyVersion}</span>
              <span className="w-40 shrink-0 tabular-nums text-neutral-400">
                recovery {pct(round.metrics.recoveryRate)} · violations {round.metrics.complianceViolations}
              </span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full ${round.improved ? 'bg-emerald-500' : 'bg-neutral-500'}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums text-neutral-500">
                net {money(round.metrics.netValueMinor)}
              </span>
              <span className="hidden w-44 shrink-0 truncate font-mono text-[10px] text-neutral-600 lg:inline" title={JSON.stringify(round.params)}>
                {JSON.stringify(round.params)}
              </span>
            </div>
          );
        })}
      </div>

      <details className="rounded border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-400">
        <summary className="cursor-pointer select-none text-neutral-300">Per-scenario breakdown (final round vs baseline)</summary>
        <table className="mt-2 w-full tabular-nums">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1 pr-2 font-medium">Scenario</th>
              <th className="py-1 pr-2 font-medium">Policy recovery</th>
              <th className="py-1 pr-2 font-medium">Baseline recovery</th>
              <th className="py-1 pr-2 font-medium">Policy fees</th>
              <th className="py-1 font-medium">Baseline fees</th>
            </tr>
          </thead>
          <tbody>
            {perScenarioFinal.map((s) => (
              <tr key={s.scenario} className="border-t border-neutral-800/60">
                <td className="py-1 pr-2 text-neutral-300">{s.scenario}</td>
                <td className="py-1 pr-2">{pct(s.policy.recoveryRate)}</td>
                <td className="py-1 pr-2">{pct(s.baseline.recoveryRate)}</td>
                <td className="py-1 pr-2">{money(s.policy.penaltyFeeMinor)}</td>
                <td className="py-1">{money(s.baseline.penaltyFeeMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs italic text-neutral-500">
        Methodology: {artifact.methodology}. Baseline: {baselineVersion}.
      </p>
    </div>
  );
}
