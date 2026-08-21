'use client';

import { formatMoneyMinor } from '@/lib/format';
import type { ReplaySeries } from '@/lib/api/types';

/**
 * A/B replay view (plan §2/§6): baseline fixed schedule vs HackGuard policy
 * recovered dollars over the identical historical failure stream. Live
 * counters driven by /api/replay; the methodology caption is enforced verbatim
 * by the response contract and must always be shown — this is counterfactual
 * estimation, never presented as observed fact.
 */
export function ReplayCounters({ replay }: { replay: ReplaySeries }) {
  const liftMinor = replay.policyTotalMinor - replay.baselineTotalMinor;
  const maxTotal = Math.max(replay.policyTotalMinor, 1);
  const baselinePct = Math.round((replay.baselineTotalMinor / maxTotal) * 100);
  const policyPct = Math.round((replay.policyTotalMinor / maxTotal) * 100);

  return (
    <div className="space-y-4" data-testid="replay-counters">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            Baseline · fixed schedule
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-neutral-300" data-testid="baseline-counter">
            {formatMoneyMinor(replay.baselineTotalMinor)}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-neutral-500" style={{ width: `${baselinePct}%` }} />
          </div>
        </div>
        <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-500">
            HackGuard policy
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-300" data-testid="policy-counter">
            {formatMoneyMinor(replay.policyTotalMinor)}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${policyPct}%` }} />
          </div>
        </div>
      </div>

      <p className="text-sm text-neutral-400">
        Recovered{' '}
        <span className="font-semibold text-emerald-300" data-testid="replay-lift">
          {formatMoneyMinor(liftMinor)}
        </span>{' '}
        more with the HackGuard policy over the same failure stream.
      </p>

      <p className="rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs italic text-neutral-500">
        Methodology: {replay.methodology}.
      </p>
    </div>
  );
}
