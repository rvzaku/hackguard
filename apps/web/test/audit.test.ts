import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  appendAuditEntry,
  canonicalJson,
  computeAuditHash,
  GENESIS_PREV_HASH,
  sha256Hex,
  verifyAuditChain,
} from '../src/lib/audit/chain';
import { InMemoryAuditLogStore } from '../src/lib/stores/memory';

describe('canonical JSON serialization', () => {
  it('is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { y: 2, x: 3 } })).toBe(canonicalJson({ a: { x: 3, y: 2 }, b: 1 }));
  });

  it('sorts keys lexicographically at every depth and drops undefined', () => {
    expect(canonicalJson({ z: undefined, a: [{ c: 1, b: [2, { e: 3, d: 4 }] }] })).toBe(
      '{"a":[{"b":[2,{"d":4,"e":3}],"c":1}]}',
    );
  });

  it('handles scalars, nulls and arrays deterministically', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('hash computation', () => {
  it('matches node crypto SHA-256 over the canonical form', () => {
    const entry = {
      seq: 0,
      prevHash: GENESIS_PREV_HASH,
      decisionRef: 'pay_001',
      actor: 'RULE' as const,
      ts: '2026-08-22T10:15:01Z',
    };
    const expected = createHash('sha256')
      .update(
        canonicalJson({
          seq: entry.seq,
          prevHash: entry.prevHash,
          decisionRef: entry.decisionRef,
          actor: entry.actor,
          ts: entry.ts,
        }),
        'utf8',
      )
      .digest('hex');
    expect(computeAuditHash(entry)).toBe(expected);
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('changes when any payload field changes (tamper sensitivity)', () => {
    const base = {
      seq: 1,
      prevHash: GENESIS_PREV_HASH,
      decisionRef: 'pay_001',
      actor: 'RULE' as const,
      ts: '2026-08-22T10:15:01Z',
    };
    const hashes = [
      computeAuditHash(base),
      computeAuditHash({ ...base, decisionRef: 'pay_002' }),
      computeAuditHash({ ...base, actor: 'MODEL' }),
      computeAuditHash({ ...base, ts: '2026-08-22T10:15:02Z' }),
      computeAuditHash({ ...base, seq: 2 }),
      computeAuditHash({ ...base, prevHash: 'a'.repeat(64) }),
    ];
    expect(new Set(hashes).size).toBe(6);
  });
});

describe('append + verify round trip', () => {
  it('builds a contiguous genesis-rooted chain', async () => {
    const store = new InMemoryAuditLogStore();
    const e0 = await appendAuditEntry(store, { decisionRef: 'pay_001', actor: 'RULE', ts: '2026-08-22T10:15:01Z' });
    const e1 = await appendAuditEntry(store, { decisionRef: 'pay_002', actor: 'MODEL', ts: '2026-08-22T10:16:01Z' });
    const e2 = await appendAuditEntry(store, { decisionRef: 'pay_003', actor: 'HUMAN', ts: '2026-08-22T10:17:01Z' });

    expect(e0.seq).toBe(0);
    expect(e0.prevHash).toBe(GENESIS_PREV_HASH);
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(e0.hash);
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);

    const verdict = verifyAuditChain(await store.all());
    expect(verdict.valid).toBe(true);
  });

  it('accepts an empty ledger', () => {
    expect(verifyAuditChain([])).toEqual({ valid: true });
  });
});

describe('tamper detection', () => {
  async function buildChain(): Promise<InMemoryAuditLogStore> {
    const store = new InMemoryAuditLogStore();
    await appendAuditEntry(store, { decisionRef: 'pay_001', actor: 'RULE', ts: '2026-08-22T10:15:01Z' });
    await appendAuditEntry(store, { decisionRef: 'pay_002', actor: 'MODEL', ts: '2026-08-22T10:16:01Z' });
    await appendAuditEntry(store, { decisionRef: 'pay_003', actor: 'HUMAN', ts: '2026-08-22T10:17:01Z' });
    return store;
  }

  it('detects a modified decisionRef on a historical row', async () => {
    const entries = await (await buildChain()).all();
    const tampered = entries.map((e) =>
      e.seq === 1 ? { ...e, decisionRef: 'pay_FORGED' } : e,
    );
    const verdict = verifyAuditChain(tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.firstBadSeq).toBe(1);
    expect(verdict.reason).toContain('hash mismatch');
  });

  it('detects a forged hash field', async () => {
    const entries = await (await buildChain()).all();
    const tampered = entries.map((e) => (e.seq === 2 ? { ...e, hash: 'f'.repeat(64) } : e));
    const verdict = verifyAuditChain(tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.firstBadSeq).toBe(2);
  });

  it('detects a modified timestamp', async () => {
    const entries = await (await buildChain()).all();
    const tampered = entries.map((e) =>
      e.seq === 0 ? { ...e, ts: '2025-01-01T00:00:00Z' } : e,
    );
    expect(verifyAuditChain(tampered).valid).toBe(false);
  });

  it('detects a removed middle row (seq gap)', async () => {
    const entries = await (await buildChain()).all();
    const tampered = entries.filter((e) => e.seq !== 1);
    const verdict = verifyAuditChain(tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('expected seq 1');
  });

  it('detects a broken prevHash link without touching hashes', async () => {
    const entries = await (await buildChain()).all();
    const tampered = entries.map((e) =>
      e.seq === 2 ? { ...e, prevHash: GENESIS_PREV_HASH } : e,
    );
    const verdict = verifyAuditChain(tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.firstBadSeq).toBe(2);
    expect(verdict.reason).toContain('prevHash mismatch');
  });

  it('detects reordering attacks via seq contiguity after sort-stable check', async () => {
    const entries = await (await buildChain()).all();
    // Swap payloads of seq 1 and 2 keeping seq fields: hashes no longer match.
    const [a] = entries.splice(1, 1);
    if (!a) throw new Error('fixture broken');
    entries.push({ ...a, seq: 2 });
    const verdict = verifyAuditChain(entries);
    expect(verdict.valid).toBe(false);
  });
});
