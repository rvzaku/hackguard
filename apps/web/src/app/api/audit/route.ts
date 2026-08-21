import { withErrorHandling } from '@/lib/errors';
import { getRuntime } from '@/lib/runtime';

/**
 * GET /api/audit — append-only, hash-chained compliance ledger (plan §4),
 * backed by the runtime audit store (Postgres audit_log when DATABASE_URL is
 * set; the DB trigger in db/migrations/0001_audit_log.sql enforces
 * append-only at the storage layer).
 */
export const GET = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();
  const entries = await runtime.audit.all();
  return Response.json({ entries }, { status: 200 });
});
