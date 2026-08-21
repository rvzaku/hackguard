'use client';

import type { ShapContribution } from '@hackguard/contracts';
import { describeContribution, formatSigned, shapBarPercent } from '@/lib/shap-copy';
import { formatProbability } from '@/lib/format';
import { ActionBadge } from './ActionBadge';
import { EmptyState } from './states';
import type { Decision } from '@/lib/api/client';

/**
 * Per-decision explanation panel (plan §2): top-5 SHAP contributions as
 * plain-English sentences plus signed bars. Presentation only — the values
 * come from the scoring sidecar through the decision feed.
 */
export function ExplanationPanel({ decision }: { decision: Decision | null }) {
  if (!decision) {
    return (
      <EmptyState
        title="Select a decision to see why"
        hint="The top model drivers for that decision appear here."
      />
    );
  }

  const bars = shapBarPercent(decision.shapTop);

  return (
    <div className="space-y-4" data-testid="explanation-panel">
      <div className="flex flex-wrap items-center gap-2">
        <ActionBadge action={decision.action} />
        <span className="font-mono text-xs text-neutral-400">{decision.paymentId}</span>
        <span className="ml-auto text-xs text-neutral-400">
          P(recover) <span className="font-semibold text-neutral-100">{formatProbability(decision.pRecover)}</span>
        </span>
      </div>

      {decision.scheduledFor ? (
        <p className="text-xs text-neutral-400">
          Scheduled retry:{' '}
          <span className="text-neutral-200">
            {new Date(decision.scheduledFor).toLocaleString('en-US', { hour12: false })}
          </span>
        </p>
      ) : null}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Why (top model drivers)
        </h3>
        <ul className="mt-2 space-y-2">
          {decision.shapTop.map((c: ShapContribution, i) => {
            const positive = c.contribution >= 0;
            return (
              <li key={c.feature} className="space-y-1" data-testid="shap-row">
                <p className="text-sm text-neutral-200">{describeContribution(c)}</p>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className={`h-full rounded-full ${positive ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ width: `${bars[i] ?? 1}%` }}
                      data-testid={`shap-bar-${positive ? 'pos' : 'neg'}`}
                    />
                  </div>
                  <span
                    className={`w-12 text-right font-mono text-xs ${positive ? 'text-emerald-400' : 'text-red-400'}`}
                  >
                    {formatSigned(c)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="text-xs text-neutral-500">
        Rule citations:{' '}
        {decision.ruleHits.length === 0 ? (
          <span className="text-neutral-400">none — no network-rule limits engaged</span>
        ) : (
          <span className="font-mono text-neutral-300">{decision.ruleHits.join(', ')}</span>
        )}
      </div>
      <p className="text-xs text-neutral-600">Model version: {decision.modelVersion}</p>
    </div>
  );
}
