import { withErrorHandling } from '@/lib/errors';
import { runToReplaySeries } from '@/lib/replay/series';
import { getRuntime } from '@/lib/runtime';

/**
 * GET /api/replay — A/B replay series: baseline fixed schedule vs HackGuard
 * policy recovered dollars over the identical historical failure stream
 * (plan §2/§6). Derived from the most recent persisted replay run (POST
 * /api/replay/run); with no run yet the series is empty and both counters
 * read zero. Recovery figures are counterfactual estimates by construction.
 */
export const GET = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();
  const run = await runtime.replays.latestRun();
  return Response.json(runToReplaySeries(run), { status: 200 });
});
