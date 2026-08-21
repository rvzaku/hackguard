'use client';

import { useMemo, useState } from 'react';
import { createApiClient } from '@/lib/api/client';
import { useApiResource } from '@/hooks/useApiResource';
import { DecisionFeed } from '@/components/DecisionFeed';
import { EvalLoopPanel } from '@/components/EvalLoopPanel';
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
  const evalLoop = useApiResource((signal) => api.getEvalLoop({ signal }), { pollMs: 10000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  async function runDemo() {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      await api.runDemoBootstrap();
      decisions.refresh();
      replay.refresh();
    } catch (cause) {
      setBootstrapError(cause instanceof Error ? cause.message : 'Demo bootstrap failed');
    } finally {
      setBootstrapping(false);
    }
  }

  const isEmpty =
    !decisions.loading && !decisions.error && (decisions.data?.decisions.length ?? 0) === 0;

  const selectedDecision = useMemo(
    () =>
      decisions.data?.decisions.find((d) => d.paymentId === selectedId) ??
      decisions.data?.decisions[0] ??
      null,
    [decisions.data, selectedId],
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HackGuard</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Decision brain above Stripe&apos;s built-in retries — triage, timed retries, network-rule
            guardrails, hash-chained audit.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={runDemo}
            disabled={bootstrapping}
            data-testid="run-demo"
            className="rounded border border-emerald-800 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-50"
          >
            {bootstrapping ? 'Running demo…' : isEmpty ? 'Load demo data' : 'Re-run demo replay'}
          </button>
          {bootstrapError ? <p className="text-xs text-red-400">{bootstrapError}</p> : null}
        </div>
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
        ) : replay.data && replay.data.series.length > 0 ? (
          <ReplayCounters replay={replay.data} />
        ) : (
          <EmptyState
            title="No replay run yet"
            hint="Use “Load demo data” above, or POST /api/replay/seed + /api/replay/run with your captured stream."
          />
        )}
      </section>

      <section aria-label="Adversarial eval loop" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <SectionHeading
          title="Adversarial eval loop — policy improving over rounds"
          subtitle="Seeded adversarial streams · baseline fixed schedule vs tuned timing policy, round by round"
        />
        {evalLoop.loading ? (
          <LoadingSkeleton rows={3} />
        ) : evalLoop.error ? (
          <ErrorState error={evalLoop.error} onRetry={evalLoop.refresh} />
        ) : evalLoop.data ? (
          <EvalLoopPanel artifact={evalLoop.data} />
        ) : (
          <EmptyState title="No eval-loop artifact" hint="Run `npm run eval:loop` to generate it." />
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
