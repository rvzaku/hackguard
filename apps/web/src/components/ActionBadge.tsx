import type { RetryAction } from '@hackguard/contracts';

/**
 * Display mapping only: the contract's SUPPRESS action is surfaced to users as
 * NEVER-RETRY (plan §2 triage vocabulary).
 */
const BADGE_STYLES: Record<RetryAction, { label: string; className: string }> = {
  RETRY: { label: 'RETRY', className: 'border-emerald-700 bg-emerald-950/60 text-emerald-300' },
  SUPPRESS: { label: 'NEVER-RETRY', className: 'border-red-800 bg-red-950/60 text-red-300' },
  ASK_CUSTOMER: { label: 'ASK-CUSTOMER', className: 'border-amber-700 bg-amber-950/60 text-amber-300' },
};

export function ActionBadge({ action }: { action: RetryAction }) {
  const badge = BADGE_STYLES[action];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}
