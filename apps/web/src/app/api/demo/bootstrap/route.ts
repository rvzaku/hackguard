import { buildDemoReplayStream, DEMO_STREAM_ID } from '@/lib/demo/seed-stream';
import { AppError, withErrorHandling } from '@/lib/errors';
import { runReplay } from '@/lib/replay/engine';
import { getRuntime, getScoringClient } from '@/lib/runtime';

/**
 * POST /api/demo/bootstrap — one-click demo data for the dashboard: seeds the
 * canonical failure stream (clearly-labeled synthetic seed, plan §4) and runs
 * the A/B replay over it. Idempotent: re-seeding replaces the stream and each
 * call appends a fresh replay run. Live webhook ingest is driven separately
 * by scripts/seed-demo.mjs (signed Stripe test-mode deliveries).
 */
export const POST = withErrorHandling(async (): Promise<Response> => {
  const runtime = getRuntime();
  const events = buildDemoReplayStream();
  await runtime.replays.saveStream({ streamId: DEMO_STREAM_ID, events });

  const run = await runReplay(DEMO_STREAM_ID, events, {
    scoring: getScoringClient(),
    now: new Date(),
  });
  await runtime.replays.saveRun(run);

  if (run.baseline.series.length === 0 || run.policy.series.length === 0) {
    throw new AppError('INTERNAL', 'demo replay produced an empty outcome series');
  }
  return Response.json(
    {
      seeded: true,
      streamId: DEMO_STREAM_ID,
      eventCount: events.length,
      runId: run.runId,
      baselineRecoveredMinor: run.baseline.recoveredAmountMinor,
      policyRecoveredMinor: run.policy.recoveredAmountMinor,
      degraded: run.degraded,
    },
    { status: 200 },
  );
});
