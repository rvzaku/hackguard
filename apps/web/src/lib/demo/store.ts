import { createHash } from 'node:crypto';
import { AuditEntrySchema, type AuditEntry, type Decision } from '@hackguard/contracts';

/**
 * DEMO-SEED in-memory store backing the dashboard's BFF routes until WS-B's
 * real backend (Postgres audit_log + decisions tables) lands. The UI never
 * imports this file — it only talks to /api/* through the typed client, so
 * swapping this store for the real backend is invisible to the dashboard.
 *
 * The hash chain here follows the AuditEntry contract (hash = SHA-256 over
 * seq, prevHash, decisionRef, actor, ts) so the tamper-detection endpoint is
 * meaningful in the demo.
 */

function chainHash(seq: number, prevHash: string, decisionRef: string, actor: string, ts: string): string {
  return createHash('sha256').update(`${seq}|${prevHash}|${decisionRef}|${actor}|${ts}`).digest('hex');
}

const GENESIS_HASH = '0'.repeat(64);

function buildEntry(
  seq: number,
  prevHash: string,
  decisionRef: string,
  actor: AuditEntry['actor'],
  ts: string,
): AuditEntry {
  return AuditEntrySchema.parse({
    seq,
    prevHash,
    hash: chainHash(seq, prevHash, decisionRef, actor, ts),
    decisionRef,
    actor,
    ts,
  });
}

const SEED_DECISIONS: Decision[] = [
  {
    paymentId: 'pay_demo_001',
    action: 'RETRY',
    scheduledFor: '2026-08-22T18:30:00.000Z',
    pRecover: 0.62,
    shapTop: [
      { feature: 'decline_code_family', contribution: 0.84 },
      { feature: 'payer_propensity', contribution: 0.41 },
      { feature: 'inter_attempt_interval', contribution: 0.22 },
      { feature: 'amount_band', contribution: -0.11 },
      { feature: 'hour_of_day', contribution: -0.05 },
    ],
    ruleHits: [],
    modelVersion: 'propensity-v0.1.0',
  },
  {
    paymentId: 'pay_demo_002',
    action: 'SUPPRESS',
    pRecover: 0.02,
    shapTop: [
      { feature: 'decline_code_family', contribution: -1.42 },
      { feature: 'attempt_number', contribution: -0.36 },
      { feature: 'card_brand', contribution: -0.08 },
      { feature: 'customer_tenure', contribution: 0.04 },
      { feature: 'amount_band', contribution: -0.03 },
    ],
    ruleHits: ['VISA-CAT1-NEVER-RETRY'],
    modelVersion: 'propensity-v0.1.0',
  },
  {
    paymentId: 'pay_demo_003',
    action: 'ASK_CUSTOMER',
    pRecover: 0.31,
    shapTop: [
      { feature: 'decline_code_family', contribution: -0.47 },
      { feature: 'payer_propensity', contribution: 0.19 },
      { feature: 'attempt_number', contribution: -0.12 },
      { feature: 'hour_of_day', contribution: 0.06 },
      { feature: 'inter_attempt_interval', contribution: -0.02 },
    ],
    ruleHits: ['MC-MAC-21-DO-NOT-RETRY'],
    modelVersion: 'propensity-v0.1.0',
  },
  {
    paymentId: 'pay_demo_004',
    action: 'RETRY',
    scheduledFor: '2026-08-23T09:15:00.000Z',
    pRecover: 0.55,
    shapTop: [
      { feature: 'payer_propensity', contribution: 0.52 },
      { feature: 'hour_of_day', contribution: 0.28 },
      { feature: 'payday_proximity', contribution: 0.17 },
      { feature: 'attempt_number', contribution: -0.09 },
      { feature: 'amount_band', contribution: -0.04 },
    ],
    ruleHits: [],
    modelVersion: 'propensity-v0.1.0',
  },
  {
    paymentId: 'pay_demo_005',
    action: 'SUPPRESS',
    pRecover: 0.06,
    shapTop: [
      { feature: 'decline_code_family', contribution: -1.05 },
      { feature: 'attempt_number', contribution: -0.44 },
      { feature: 'inter_attempt_interval', contribution: -0.13 },
      { feature: 'card_brand', contribution: -0.07 },
      { feature: 'customer_tenure', contribution: 0.02 },
    ],
    ruleHits: ['VISA-CAT1-NEVER-RETRY', 'MC-MAC-01-DO-NOT-RETRY'],
    modelVersion: 'propensity-v0.1.0',
  },
  {
    paymentId: 'pay_demo_006',
    action: 'ASK_CUSTOMER',
    pRecover: 0.24,
    shapTop: [
      { feature: 'attempt_number', contribution: -0.61 },
      { feature: 'decline_code_family', contribution: -0.33 },
      { feature: 'payer_propensity', contribution: 0.14 },
      { feature: 'amount_band', contribution: -0.08 },
      { feature: 'payday_proximity', contribution: 0.01 },
    ],
    ruleHits: ['MC-TPE-24H-CAP'],
    modelVersion: 'propensity-v0.1.0',
  },
];

function seedAuditChain(): AuditEntry[] {
  const rows: Array<[string, AuditEntry['actor'], string]> = [
    ['ledger-genesis', 'HUMAN', '2026-08-22T14:00:00.000Z'],
    ['pay_demo_001', 'MODEL', '2026-08-22T14:02:11.000Z'],
    ['pay_demo_002', 'RULE', '2026-08-22T14:05:47.000Z'],
    ['pay_demo_003', 'MODEL', '2026-08-22T14:09:03.000Z'],
    ['pay_demo_004', 'MODEL', '2026-08-22T14:12:38.000Z'],
    ['pay_demo_005', 'RULE', '2026-08-22T14:15:20.000Z'],
    ['pay_demo_006', 'MODEL', '2026-08-22T14:18:55.000Z'],
  ];
  let prevHash = GENESIS_HASH;
  return rows.map(([decisionRef, actor, ts], seq) => {
    const entry = buildEntry(seq, prevHash, decisionRef, actor, ts);
    prevHash = entry.hash;
    return entry;
  });
}

const SEED_AUDIT: AuditEntry[] = seedAuditChain();

const SEED_REPLAY = {
  series: [
    { bucket: '2026-08-22T14:00:00.000Z', baselineRecoveredMinor: 0, policyRecoveredMinor: 0 },
    { bucket: '2026-08-22T15:00:00.000Z', baselineRecoveredMinor: 4900, policyRecoveredMinor: 9800 },
    { bucket: '2026-08-22T16:00:00.000Z', baselineRecoveredMinor: 9800, policyRecoveredMinor: 24600 },
    { bucket: '2026-08-22T17:00:00.000Z', baselineRecoveredMinor: 14700, policyRecoveredMinor: 39400 },
    { bucket: '2026-08-22T18:00:00.000Z', baselineRecoveredMinor: 19600, policyRecoveredMinor: 54200 },
    { bucket: '2026-08-22T19:00:00.000Z', baselineRecoveredMinor: 22100, policyRecoveredMinor: 68900 },
    { bucket: '2026-08-22T20:00:00.000Z', baselineRecoveredMinor: 24600, policyRecoveredMinor: 83600 },
    { bucket: '2026-08-22T21:00:00.000Z', baselineRecoveredMinor: 27100, policyRecoveredMinor: 98300 },
    { bucket: '2026-08-22T22:00:00.000Z', baselineRecoveredMinor: 29600, policyRecoveredMinor: 113000 },
    { bucket: '2026-08-22T23:00:00.000Z', baselineRecoveredMinor: 32100, policyRecoveredMinor: 127700 },
    { bucket: '2026-08-23T00:00:00.000Z', baselineRecoveredMinor: 34600, policyRecoveredMinor: 142400 },
    { bucket: '2026-08-23T01:00:00.000Z', baselineRecoveredMinor: 37100, policyRecoveredMinor: 157100 },
  ],
  baselineTotalMinor: 37100,
  policyTotalMinor: 157100,
  methodology: 'counterfactual estimation validated against published recovery curves',
} as const;

interface DemoState {
  decisions: Decision[];
  audit: AuditEntry[];
  nextSeq: number;
}

const globalForDemoStore = globalThis as unknown as { __hackguardDemoStore?: DemoState };

export function getDemoStore(): DemoState {
  globalForDemoStore.__hackguardDemoStore ??= {
    decisions: SEED_DECISIONS,
    audit: [...SEED_AUDIT],
    nextSeq: SEED_AUDIT.length,
  };
  return globalForDemoStore.__hackguardDemoStore;
}

export function appendAuditEntry(decisionRef: string, actor: AuditEntry['actor']): AuditEntry {
  const store = getDemoStore();
  const prev = store.audit[store.audit.length - 1];
  const entry = buildEntry(
    store.nextSeq,
    prev?.hash ?? GENESIS_HASH,
    decisionRef,
    actor,
    new Date().toISOString(),
  );
  store.audit.push(entry);
  store.nextSeq += 1;
  return entry;
}

export function replaySeries(): typeof SEED_REPLAY {
  return SEED_REPLAY;
}

/** Recomputes the chain linkage; returns the first broken seq, if any. */
export function verifyChain(): { valid: boolean; checkedCount: number; brokenAtSeq: number | null } {
  const store = getDemoStore();
  let prevHash = GENESIS_HASH;
  for (const entry of store.audit) {
    const expected = chainHash(entry.seq, entry.prevHash, entry.decisionRef, entry.actor, entry.ts);
    if (entry.prevHash !== prevHash || entry.hash !== expected) {
      return { valid: false, checkedCount: store.audit.length, brokenAtSeq: entry.seq };
    }
    prevHash = entry.hash;
  }
  return { valid: true, checkedCount: store.audit.length, brokenAtSeq: null };
}
