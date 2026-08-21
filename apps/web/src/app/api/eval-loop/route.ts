import artifactJson from '../../../../../../models/registry/eval-loop-v1/metrics.json';
import { NextResponse } from 'next/server';

import { EvalLoopArtifactSchema } from '@/lib/eval/artifact';

/**
 * GET /api/eval-loop — round-by-round adversarial eval metrics series
 * (eval-loop scope item 4). Serves the committed artifact from
 * models/registry/eval-loop-v1/metrics.json, re-validated through the shared
 * Zod contract so the dashboard can never render a drifted shape.
 */
export async function GET() {
  const parsed = EvalLoopArtifactSchema.safeParse(artifactJson);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'EVAL_ARTIFACT_INVALID',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}
