import { describe, expect, it } from 'vitest';

import { GET } from '../src/app/api/eval-loop/route';
import { EvalLoopArtifactSchema } from '../src/lib/eval/artifact';

/**
 * /api/eval-loop serves the committed metrics artifact, re-validated through
 * the shared Zod contract (eval-loop scope item 4).
 */

describe('GET /api/eval-loop', () => {
  it('returns a contract-valid artifact with a non-degrading round series', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    const artifact = EvalLoopArtifactSchema.parse(body);
    expect(artifact.rounds.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < artifact.rounds.length; i++) {
      expect(artifact.rounds[i]!.metrics.netValueMinor).toBeGreaterThanOrEqual(
        artifact.rounds[i - 1]!.metrics.netValueMinor,
      );
    }
    expect(artifact.summary.violationsFinal).toBe(0);
  });
});
