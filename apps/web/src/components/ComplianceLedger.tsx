'use client';

import { useState } from 'react';
import { formatDateTime, shortHash } from '@/lib/format';
import { ErrorState, LoadingSkeleton } from './states';
import { useApiResource } from '@/hooks/useApiResource';
import type { ApiClient } from '@/lib/api/client';
import type { ChainVerification, SimulateViolationResult } from '@/lib/api/types';

const ACTOR_STYLES = {
  MODEL: 'text-sky-300 border-sky-800 bg-sky-950/50',
  RULE: 'text-violet-300 border-violet-800 bg-violet-950/50',
  HUMAN: 'text-neutral-300 border-neutral-700 bg-neutral-900',
} as const;

/**
 * Compliance ledger view (plan §2/§4): append-only, hash-chained audit rows,
 * a Verify-chain button driving the tamper-detection endpoint, and the
 * red-team demo beat — a "simulate violating retry" control that shows the
 * compliance block plus the audit event it records.
 */
export function ComplianceLedger({ api }: { api: ApiClient }) {
  const audit = useApiResource((signal) => api.getAuditLog({ signal }), { pollMs: 5000 });
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [violation, setViolation] = useState<SimulateViolationResult | null>(null);
  const [violating, setViolating] = useState(false);
  const [violationError, setViolationError] = useState<string | null>(null);

  async function handleVerify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerification(await api.verifyChain());
    } catch (cause) {
      setVerifyError(cause instanceof Error ? cause.message : 'Verification request failed');
    } finally {
      setVerifying(false);
    }
  }

  async function handleSimulate() {
    setViolating(true);
    setViolationError(null);
    try {
      const result = await api.simulateViolatingRetry();
      setViolation(result);
      audit.refresh();
    } catch (cause) {
      setViolationError(cause instanceof Error ? cause.message : 'Simulation request failed');
    } finally {
      setViolating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          data-testid="verify-chain"
        >
          {verifying ? 'Verifying…' : 'Verify chain'}
        </button>
        <button
          type="button"
          onClick={handleSimulate}
          disabled={violating}
          className="rounded border border-red-800 bg-red-950/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/50 disabled:opacity-50"
          data-testid="simulate-violation"
        >
          {violating ? 'Simulating…' : 'Simulate violating retry'}
        </button>
      </div>

      {verification ? (
        <div
          role="status"
          data-testid="verify-result"
          className={`rounded-md border p-3 text-xs ${
            verification.valid
              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
              : 'border-red-800 bg-red-950/40 text-red-300'
          }`}
        >
          {verification.valid
            ? `Chain intact — ${verification.checkedCount} entries verified, no tampering detected.`
            : `TAMPER DETECTED at seq ${verification.brokenAtSeq} — hash chain broken.`}
        </div>
      ) : null}
      {verifyError ? <ErrorState error={{ kind: 'http', message: verifyError }} onRetry={handleVerify} /> : null}

      {violation ? (
        <div
          role="alert"
          data-testid="violation-block"
          className="rounded-md border border-red-800 bg-red-950/40 p-3 text-xs text-red-200"
        >
          <p className="font-semibold uppercase tracking-wide">Retry blocked by compliance engine</p>
          <p className="mt-1">
            Hard-decline retry would violate <span className="font-mono">{violation.ruleHits.join(', ')}</span>{' '}
            (Visa Category 1: issuer will never approve; per-attempt penalty fee exposure). Enforcement recorded
            as audit seq {violation.auditEntry.seq}.
          </p>
        </div>
      ) : null}
      {violationError ? (
        <ErrorState error={{ kind: 'http', message: violationError }} onRetry={handleSimulate} />
      ) : null}

      {audit.loading ? (
        <LoadingSkeleton rows={4} />
      ) : audit.error ? (
        <ErrorState error={audit.error} onRetry={audit.refresh} />
      ) : audit.data && audit.data.entries.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-left text-xs" data-testid="audit-table">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/80 text-neutral-500">
                <th className="px-3 py-2 font-medium">Seq</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Hash</th>
                <th className="px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/70 font-mono">
              {audit.data.entries.map((e) => (
                <tr key={e.seq} className="text-neutral-300">
                  <td className="px-3 py-2 tabular-nums">{e.seq}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded border px-1.5 py-0.5 font-sans text-[10px] font-semibold ${ACTOR_STYLES[e.actor]}`}
                    >
                      {e.actor}
                    </span>
                  </td>
                  <td className="px-3 py-2">{e.decisionRef}</td>
                  <td className="px-3 py-2 text-neutral-500" title={`prev ${e.prevHash}`}>
                    {shortHash(e.hash)}…
                  </td>
                  <td className="px-3 py-2">{formatDateTime(e.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-400">
          Ledger is empty.
        </div>
      )}
    </div>
  );
}
