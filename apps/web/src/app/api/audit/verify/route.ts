import { NextResponse } from 'next/server';
import { verifyChain } from '@/lib/demo/store';

/**
 * POST /api/audit/verify — tamper detection: recompute the hash chain over the
 * ledger and report the first broken sequence number, if any. Demo-backed
 * until WS-B's chain verifier lands; the response shape is the contract the
 * dashboard's Verify-chain button consumes.
 */
export async function POST() {
  return NextResponse.json(verifyChain());
}
