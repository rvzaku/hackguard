import { verifyAuditChain } from '@/lib/audit/chain';
import { withErrorHandling } from '@/lib/errors';
import { getRuntime } from '@/lib/runtime';

/**
 * POST /api/audit/verify — tamper detection: full-scan recomputation of the
 * hash chain over the persisted ledger (plan §6 security tests). The response
 * shape is the contract the dashboard's Verify-chain button consumes.
 */
export const POST = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();
  const entries = await runtime.audit.all();
  const verdict = verifyAuditChain(entries);
  return Response.json(
    {
      valid: verdict.valid,
      checkedCount: entries.length,
      brokenAtSeq: verdict.firstBadSeq ?? null,
      reason: verdict.reason ?? null,
    },
    { status: 200 },
  );
});
