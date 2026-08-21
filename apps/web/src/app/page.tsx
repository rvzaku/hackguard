'use client';

import { useMemo, useState } from 'react';
import { createApiClient } from '@/lib/api/client';
import { useApiResource } from '@/hooks/useApiResource';
import { DecisionFeed } from '@/components/DecisionFeed';
import { ExplanationPanel } from '@/components/ExplanationPanel';
import { ReplayCounters } from '@/components/ReplayCounters';
import { ComplianceLedger } from '@/components/ComplianceLedger';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states';

const api = createApiClient();

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-neutral-600">{subtitle}</p> : null}
    </div>
  );
}

export default function Home() {
  const decisions = useApiResource((signal) => api.getDecisions({ signal }), { pollMs: 4000 });
  const replay = useApiResource((signal) => api.getReplay({ signal }), { pollMs: 3000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedDecision = useMemo(
    () =>
      decisions.data?.decisions.find((d) => d.paymentId === selectedId) ??
      decisions.data?.decisions[0] ??
      null,
    [decisions.data, selectedId],
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">HackGuard</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Decision brain above Stripe&apos;s built-in retries — triage, timed retries, network-rule
          guardrails, hash-chained audit.
        </p>
      </header>

      <section aria-label="Decision feed and explanation">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 lg:col-span-3">
            <SectionHeading
              title="Decision feed"
              subtitle="Live triage of failed payments · click a row for the why"
            />
            {decisions.loading ? (
              <LoadingSkeleton rows={4} />
            ) : decisions.error ? (
              <ErrorState error={decisions.error} onRetry={decisions.refresh} />
            ) : decisions.data && decisions.data.decisions.length > 0 ? (
              <DecisionFeed
                decisions={decisions.data.decisions}
                selectedId={selectedDecision?.paymentId ?? null}
                onSelect={setSelectedId}
              />
            ) : (
              <EmptyState title="No failed payments yet" hint="Decisions appear as Stripe events are ingested." />
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 lg:col-span-2">
            <SectionHeading title="Why this decision" subtitle="Top SHAP drivers, in plain English" />
            <ExplanationPanel decision={selectedDecision} />
          </div>
        </div>
      </section>

      <section aria-label="A/B replay" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <SectionHeading
          title="A/B replay — recovered dollars"
          subtitle="Baseline fixed schedule vs HackGuard policy over the identical failure stream"
        />
        {replay.loading ? (
          <LoadingSkeleton rows={2} />
        ) : replay.error ? (
          <ErrorState error={replay.error} onRetry={replay.refresh} />
        ) : replay.data ? (
          <ReplayCounters replay={replay.data} />
        ) : (
          <EmptyState title="No replay data" />
        )}
      </section>

      <section aria-label="Compliance ledger" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <SectionHeading
          title="Compliance ledger"
          subtitle="Append-only, hash-chained audit trail · tamper-evident"
        />
        <ComplianceLedger api={api} />
      </section>
    </main>
  );
}
