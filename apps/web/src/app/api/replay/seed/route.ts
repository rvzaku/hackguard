import { z } from 'zod';

import { ReplayEventSchema } from '@hackguard/contracts';

import { AppError, withErrorHandling } from '@/lib/errors';
import { getRuntime } from '@/lib/runtime';

/**
 * POST /api/replay/seed — seeds a canonical replay stream (plan §4) from
 * captured real Stripe test-mode events (or clearly-labeled synthetic seeds).
 * The whole stream is Zod-validated against the shared ReplayEvent contract
 * before storage; invalid rows are rejected with a typed 422.
 */

const SeedRequestSchema = z.object({
  streamId: z.string().min(1).max(128),
  events: z.array(ReplayEventSchema).min(1).max(10_000),
});

export const POST = withErrorHandling(async (request: Request): Promise<Response> => {
  const parsed = SeedRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError('SCHEMA_VALIDATION_FAILED', 'seed payload failed validation', {
      issues: parsed.error.issues,
    });
  }
  const runtime = getRuntime();
  await runtime.replays.saveStream({ streamId: parsed.data.streamId, events: parsed.data.events });
  return Response.json(
    { seeded: true, streamId: parsed.data.streamId, eventCount: parsed.data.events.length },
    { status: 201 },
  );
});
