import { withErrorHandling } from '@/lib/errors';
import { getRuntime } from '@/lib/runtime';

/**
 * GET /api/decisions — decision feed + stored SHAP explanations (plan §3).
 * Backed by the runtime decision store: every decision the webhook pipeline
 * produced (triage -> guardrail -> scheduler) is persisted contract-shaped.
 */
export const GET = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();
  const decisions = await runtime.decisions.list();
  return Response.json({ decisions }, { status: 200 });
});
