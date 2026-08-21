import { describe, expect, it } from 'vitest';
import { appendAuditEntry, getDemoStore, verifyChain } from '@/lib/demo/store';

// The demo seed must itself satisfy the frozen contracts and produce a
// verifiable hash chain so the tamper-detection demo is meaningful.
describe('demo seed store', () => {
  it('produces an intact hash chain on first load', () => {
    const result = verifyChain();
    expect(result).toEqual({
      valid: true,
      checkedCount: getDemoStore().audit.length,
      brokenAtSeq: null,
    });
  });

  it('appends audit entries that keep the chain intact and verifiable', () => {
    const before = getDemoStore().audit.length;
    const appended = appendAuditEntry('pay_test_append', 'RULE');
    expect(appended.seq).toBe(before);
    expect(appended.prevHash).toBe(getDemoStore().audit[before - 1]?.hash);
    expect(verifyChain().valid).toBe(true);
    expect(verifyChain().checkedCount).toBe(before + 1);
  });

  it('seeds decisions covering every triage action', () => {
    const actions = new Set(getDemoStore().decisions.map((d) => d.action));
    expect(actions).toEqual(new Set(['RETRY', 'SUPPRESS', 'ASK_CUSTOMER']));
  });
});
