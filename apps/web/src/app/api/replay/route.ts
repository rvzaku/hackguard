import { NextResponse } from 'next/server';
import { replaySeries } from '@/lib/demo/store';

/**
 * GET /api/replay — A/B replay series: baseline fixed schedule vs HackGuard
 * policy recovered dollars over the identical historical failure stream
 * (plan §2/§6). Counterfactual estimation; the methodology caption is part of
 * the response contract and must be displayed verbatim.
 */
export async function GET() {
  return NextResponse.json(replaySeries());
}
