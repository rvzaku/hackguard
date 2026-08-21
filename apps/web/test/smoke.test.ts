import { describe, expect, it } from 'vitest';
import { DecisionSchema } from '@hackguard/contracts';

// SCAFFOLD EXAMPLE — wired smoke test proving the web app can consume the
// shared contracts package. Replace with real unit tests in WS-C.
describe('contracts consumption (scaffold example)', () => {
  it('parses a Decision from the shared contract', () => {
    const decision = DecisionSchema.parse({
      paymentId: 'pay_smoke_001',
      action: 'SUPPRESS',
      pRecover: 0.03,
      shapTop: [],
      ruleHits: ['VISA-CAT1-NEVER-RETRY'],
      modelVersion: 'propensity-v0.1.0',
    });
    expect(decision.action).toBe('SUPPRESS');
  });
});
