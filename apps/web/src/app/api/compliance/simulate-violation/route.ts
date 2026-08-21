import { NextResponse } from 'next/server';
import { appendAuditEntry } from '@/lib/demo/store';

/**
 * POST /api/compliance/simulate-violation — red-team demo beat: attempts to
 * schedule a retry that would violate Visa Decline Category 1 (hard decline,
 * issuer will never approve). The compliance engine blocks the retry and
 * records the enforcement event in the audit ledger. Demo-backed until WS-B's
 * compliance engine lands; the block decision itself is deterministic rule
 * territory and never computed client-side.
 */
export async function POST() {
  const ruleHits = ['VISA-CAT1-NEVER-RETRY', 'VISA-CAT1-PENALTY-FEE-EXPOSURE'];
  const entry = appendAuditEntry('pay_demo_002', 'RULE');
  return NextResponse.json({ blocked: true, ruleHits, auditEntry: entry });
}
