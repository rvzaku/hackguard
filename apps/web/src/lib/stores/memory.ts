import type { AuditEntry, Decision, PaymentFailedEvent, ReplayEvent } from '@hackguard/contracts';

import type { AuditLogStore } from '../audit/chain.js';
import type { IdempotencyStore } from '../idempotency.js';
import type { AttemptRecord } from '../compliance/guardrail.js';
import { InMemoryIdempotencyStore } from '../idempotency.js';

/**
 * Persistence boundaries for the backend core. The in-memory implementations
 * back tests and degraded local mode; the Postgres implementations (Neon)
 * are selected at runtime when DATABASE_URL is configured.
 */

export interface PaymentEventStore {
  insert(event: PaymentFailedEvent): Promise<void>;
  get(stripeId: string): Promise<PaymentFailedEvent | null>;
  /** Prior reattempts recorded for a scope key (customer+card). */
  attemptsForScope(scopeKey: string): Promise<AttemptRecord[]>;
}

export interface ReplayStreamRecord {
  streamId: string;
  events: ReplayEvent[];
}

export interface ReplayOutcomePoint {
  paymentId: string;
  attempt: number;
  scheduledFor: string;
  action: 'RETRY' | 'SUPPRESS' | 'ASK_CUSTOMER';
  pRecover: number;
  recovered: boolean;
  amountMinor: number;
}

export interface ReplayRunRecord {
  runId: string;
  streamId: string;
  createdAt: string;
  degraded: boolean;
  baseline: { series: ReplayOutcomePoint[]; recoveredCount: number; recoveredAmountMinor: number };
  policy: { series: ReplayOutcomePoint[]; recoveredCount: number; recoveredAmountMinor: number };
}

export interface ReplayStore {
  saveStream(stream: ReplayStreamRecord): Promise<void>;
  getStream(streamId: string): Promise<ReplayStreamRecord | null>;
  saveRun(run: ReplayRunRecord): Promise<void>;
  getRun(runId: string): Promise<ReplayRunRecord | null>;
  /** Most recent run by creation time — drives GET /api/replay. */
  latestRun(): Promise<ReplayRunRecord | null>;
}

/** Persisted decision feed (plan §3: /api/decisions + stored SHAP). */
export interface DecisionStore {
  save(decision: Decision): Promise<void>;
  /** Newest first. */
  list(limit?: number): Promise<Decision[]>;
}

export class InMemoryPaymentEventStore implements PaymentEventStore {
  private readonly byId = new Map<string, PaymentFailedEvent>();

  async insert(event: PaymentFailedEvent): Promise<void> {
    this.byId.set(event.stripeId, event);
  }

  async get(stripeId: string): Promise<PaymentFailedEvent | null> {
    return this.byId.get(stripeId) ?? null;
  }

  async attemptsForScope(scopeKey: string): Promise<AttemptRecord[]> {
    const out: AttemptRecord[] = [];
    for (const event of this.byId.values()) {
      if (scopeKeyFor(event) === scopeKey) {
        out.push({ scopeKey, network: networkOf(event), ts: event.ts });
      }
    }
    return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }
}

export function scopeKeyFor(event: PaymentFailedEvent): string {
  return `${event.customerId}:${event.cardBrand}`;
}

export function networkOf(event: PaymentFailedEvent): 'visa' | 'mastercard' | 'other' {
  if (event.cardBrand === 'visa') return 'visa';
  if (event.cardBrand === 'mastercard') return 'mastercard';
  return 'other';
}

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly entries: AuditEntry[] = [];

  async latest(): Promise<AuditEntry | null> {
    return this.entries.at(-1) ?? null;
  }

  async insert(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async all(): Promise<AuditEntry[]> {
    return [...this.entries];
  }
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly streams = new Map<string, ReplayStreamRecord>();
  private readonly runs = new Map<string, ReplayRunRecord>();

  async saveStream(stream: ReplayStreamRecord): Promise<void> {
    this.streams.set(stream.streamId, stream);
  }

  async getStream(streamId: string): Promise<ReplayStreamRecord | null> {
    return this.streams.get(streamId) ?? null;
  }

  async saveRun(run: ReplayRunRecord): Promise<void> {
    this.runs.set(run.runId, run);
  }

  async getRun(runId: string): Promise<ReplayRunRecord | null> {
    return this.runs.get(runId) ?? null;
  }

  async latestRun(): Promise<ReplayRunRecord | null> {
    let newest: ReplayRunRecord | null = null;
    for (const run of this.runs.values()) {
      if (!newest || run.createdAt > newest.createdAt) newest = run;
    }
    return newest;
  }
}

export class InMemoryDecisionStore implements DecisionStore {
  private readonly byPaymentId = new Map<string, Decision>();

  async save(decision: Decision): Promise<void> {
    this.byPaymentId.set(decision.paymentId, decision);
  }

  async list(limit = 200): Promise<Decision[]> {
    return [...this.byPaymentId.values()].slice(-limit).reverse();
  }
}

/** Bundled runtime dependencies shared by the API routes. */
export interface Runtime {
  payments: PaymentEventStore;
  audit: AuditLogStore;
  replays: ReplayStore;
  decisions: DecisionStore;
  idempotency: IdempotencyStore;
}

export function inMemoryRuntime(): Runtime {
  return {
    payments: new InMemoryPaymentEventStore(),
    audit: new InMemoryAuditLogStore(),
    replays: new InMemoryReplayStore(),
    decisions: new InMemoryDecisionStore(),
    idempotency: new InMemoryIdempotencyStore(),
  };
}
