import { z } from 'zod';

import { AppError, withErrorHandling } from '@/lib/errors';
import { runReplay } from '@/lib/replay/engine';
import { getRuntime, getScoringClient } from '@/lib/runtime';

/**
 * POST /api/replay/run — A/B replay over an identical captured stream:
 * baseline fixed schedule vs HackGuard policy decisions. Both outcome series
 * are stored and returned; recovery figures are counterfactual estimates by
 * construction (deterministic draw against each arm's P(recover)).
 */

const RunRequestSchema = z.object({
  streamId: z.string().min(1).max(128),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const parsed = RunRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('SCHEMA_VALIDATION_FAILED', 'run payload failed validation', {
      issues: parsed.error.issues,
    });
  }
  const runtime = getRuntime();
  const stream = await runtime.replays.getStream(parsed.data.streamId);
  if (!stream) {
    throw new AppError('STREAM_NOT_FOUND', `no replay stream ${parsed.data.streamId}`);
  }

  const run = await runReplay(stream.streamId, stream.events, {
    scoring: getScoringClient(),
    now: new Date(),
  });
  await runtime.replays.saveRun(run);
  return Response.json(run, { status: 200 });
});
