import { NextResponse } from 'next/server';
import { getDemoStore } from '@/lib/demo/store';

/**
 * GET /api/decisions — decision feed + stored SHAP explanations (plan §3).
 * Backed by the demo seed until WS-B's real decisions endpoint lands; the
 * dashboard consumes this route only through the typed client.
 */
export async function GET() {
  return NextResponse.json({ decisions: getDemoStore().decisions });
}
