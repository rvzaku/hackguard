import { NextResponse } from 'next/server';
import { getDemoStore } from '@/lib/demo/store';

/**
 * GET /api/audit — append-only, hash-chained compliance ledger (plan §4).
 * Backed by the demo seed until WS-B's Postgres-backed audit endpoint lands.
 */
export async function GET() {
  return NextResponse.json({ entries: getDemoStore().audit });
}
