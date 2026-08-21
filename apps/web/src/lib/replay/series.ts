import { REPLAY_METHODOLOGY_CAPTION } from '@/lib/api/types';
import type { ReplaySeries } from '@/lib/api/types';
import type { ReplayRunRecord } from '@/lib/stores/memory';

/**
 * Derives the dashboard's A/B replay series (hourly cumulative recovered
 * dollars per arm) from a persisted replay run. With no run yet the series is
 * empty and both counters read zero. The methodology caption is part of the
 * response contract and must be displayed verbatim (plan §3 ML design).
 */
export function runToReplaySeries(run: ReplayRunRecord | null): ReplaySeries {
  if (!run) {
    return {
      series: [],
      baselineTotalMinor: 0,
      policyTotalMinor: 0,
      methodology: REPLAY_METHODOLOGY_CAPTION,
    };
  }

  const buckets = new Map<string, { baselineRecoveredMinor: number; policyRecoveredMinor: number }>();
  const ensure = (iso: string) => {
    const hour = new Date(iso);
    hour.setUTCMinutes(0, 0, 0);
    const key = hour.toISOString();
    let entry = buckets.get(key);
    if (!entry) {
      entry = { baselineRecoveredMinor: 0, policyRecoveredMinor: 0 };
      buckets.set(key, entry);
    }
    return { entry };
  };

  for (const point of run.baseline.series) {
    if (point.recovered) ensure(point.scheduledFor).entry.baselineRecoveredMinor += point.amountMinor;
  }
  for (const point of run.policy.series) {
    if (point.recovered) ensure(point.scheduledFor).entry.policyRecoveredMinor += point.amountMinor;
  }

  const keys = [...buckets.keys()].sort();
  let baselineCum = 0;
  let policyCum = 0;
  const series = keys.map((bucket) => {
    const entry = buckets.get(bucket)!;
    baselineCum += entry.baselineRecoveredMinor;
    policyCum += entry.policyRecoveredMinor;
    return {
      bucket,
      baselineRecoveredMinor: baselineCum,
      policyRecoveredMinor: policyCum,
    };
  });

  return {
    series,
    baselineTotalMinor: run.baseline.recoveredAmountMinor,
    policyTotalMinor: run.policy.recoveredAmountMinor,
    methodology: REPLAY_METHODOLOGY_CAPTION,
  };
}
