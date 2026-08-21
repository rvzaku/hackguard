'use client';

import { formatDateTime, formatProbability } from '@/lib/format';
import type { Decision } from '@/lib/api/client';
import { ActionBadge } from './ActionBadge';

/**
 * Live decision feed (plan §2): failed payments with triage verdicts, rule
 * citations and model version. Selecting a row drives the explanation panel.
 */
export function DecisionFeed({
  decisions,
  selectedId,
  onSelect,
}: {
  decisions: Decision[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-neutral-800" data-testid="decision-feed">
      {decisions.map((d) => {
        const selected = d.paymentId === selectedId;
        return (
          <li key={d.paymentId}>
            <button
              type="button"
              onClick={() => onSelect(d.paymentId)}
              aria-pressed={selected}
              className={`w-full px-3 py-3 text-left transition-colors hover:bg-neutral-800/50 ${
                selected ? 'bg-neutral-800/70' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <ActionBadge action={d.action} />
                <span className="font-mono text-xs text-neutral-400">{d.paymentId}</span>
                <span className="ml-auto text-sm font-semibold text-neutral-100">
                  {formatProbability(d.pRecover)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                <span className="font-mono text-neutral-300">{d.ruleHits[0] ?? 'no rule hits'}</span>
                {d.ruleHits.length > 1 ? <span>+{d.ruleHits.length - 1} more</span> : null}
                <span className="text-neutral-600">·</span>
                <span>{d.modelVersion}</span>
                {d.scheduledFor ? (
                  <>
                    <span className="text-neutral-600">·</span>
                    <span>retry {formatDateTime(d.scheduledFor)}</span>
                  </>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
