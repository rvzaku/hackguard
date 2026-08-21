import postgres from 'postgres';

import type { AuditEntry, PaymentFailedEvent, ReplayEvent } from '@hackguard/contracts';

import { AppError } from '../errors.js';
import type { AuditLogStore } from '../audit/chain.js';
import {
  scopeKeyFor,
  type PaymentEventStore,
  type ReplayRunRecord,
  type ReplayStore,
  type ReplayStreamRecord,
} from './memory.js';
import type { AttemptRecord } from '../compliance/guardrail.js';

/**
 * Neon Postgres implementations of the persistence boundaries. Thin by
 * design: all invariants (append-only audit, chain integrity) are enforced
 * application-side and by db/migrations/*.sql triggers.
 */

interface PaymentRow {
  stripe_id: string;
  customer_id: string;
  amount_minor: number;
  currency: string;
  decline_code: string;
  attempt: number;
  card_brand: string;
  ts: string;
}

export class PostgresPaymentEventStore implements PaymentEventStore {
  constructor(private readonly sql: postgres.Sql) {}

  async insert(event: PaymentFailedEvent): Promise<void> {
    await this.sql`
      INSERT INTO payment_failed_events
        (stripe_id, customer_id, amount_minor, currency, decline_code, attempt, card_brand, ts)
      VALUES (${event.stripeId}, ${event.customerId}, ${event.amountMinor}, ${event.currency},
              ${event.declineCode}, ${event.attempt}, ${event.cardBrand}, ${event.ts})
      ON CONFLICT (stripe_id) DO NOTHING`;
  }

  async get(stripeId: string): Promise<PaymentFailedEvent | null> {
    const rows = await this.sql<PaymentRow[]>`SELECT * FROM payment_failed_events WHERE stripe_id = ${stripeId}`;
    const row = rows[0];
    if (!row) return null;
    return {
      stripeId: row.stripe_id,
      customerId: row.customer_id,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      declineCode: row.decline_code,
      attempt: Number(row.attempt),
      cardBrand: row.card_brand as PaymentFailedEvent['cardBrand'],
      ts: new Date(row.ts).toISOString(),
    };
  }

  async attemptsForScope(scopeKey: string): Promise<AttemptRecord[]> {
    const [customerId, cardBrand] = scopeKey.split(':');
    const rows = await this.sql<PaymentRow[]>`
      SELECT * FROM payment_failed_events
      WHERE customer_id = ${customerId ?? ''} AND card_brand = ${cardBrand ?? ''}
      ORDER BY ts ASC`;
    return rows.map((row) => ({
      scopeKey,
      network: networkOfBrand(cardBrand as PaymentFailedEvent['cardBrand']),
      ts: new Date(row.ts).toISOString(),
    }));
  }
}

function networkOfBrand(brand: PaymentFailedEvent['cardBrand']): AttemptRecord['network'] {
  if (brand === 'visa') return 'visa';
  if (brand === 'mastercard') return 'mastercard';
  return 'other';
}

interface AuditRow {
  seq: string | number;
  prev_hash: string;
  hash: string;
  decision_ref: string;
  actor: AuditEntry['actor'];
  ts: Date | string;
}

export class PostgresAuditLogStore implements AuditLogStore {
  constructor(private readonly sql: postgres.Sql) {}

  async latest(): Promise<AuditEntry | null> {
    const rows = await this.sql<AuditRow[]>`
      SELECT seq, prev_hash, hash, decision_ref, actor, ts FROM audit_log
      ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    return row ? toAuditEntry(row) : null;
  }

  async insert(entry: AuditEntry): Promise<void> {
    try {
      await this.sql`
        INSERT INTO audit_log (seq, prev_hash, hash, decision_ref, actor, ts)
        VALUES (${entry.seq}, ${entry.prevHash}, ${entry.hash}, ${entry.decisionRef}, ${entry.actor}, ${entry.ts})`;
    } catch (err) {
      // Unique(hash) or the append-only trigger rejected the write.
      throw new AppError('INTERNAL', 'audit append rejected by database', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async all(): Promise<AuditEntry[]> {
    const rows = await this.sql<AuditRow[]>`
      SELECT seq, prev_hash, hash, decision_ref, actor, ts FROM audit_log ORDER BY seq ASC`;
    return rows.map(toAuditEntry);
  }
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    seq: Number(row.seq),
    prevHash: row.prev_hash,
    hash: row.hash,
    decisionRef: row.decision_ref,
    actor: row.actor,
    ts: new Date(row.ts).toISOString(),
  };
}

export class PostgresReplayStore implements ReplayStore {
  constructor(private readonly sql: postgres.Sql) {}

  async saveStream(stream: ReplayStreamRecord): Promise<void> {
    await this.sql`
      INSERT INTO replay_streams (stream_id, events) VALUES (${stream.streamId}, ${this.sql.json(toJsonValue(stream.events))})
      ON CONFLICT (stream_id) DO UPDATE SET events = EXCLUDED.events`;
  }

  async getStream(streamId: string): Promise<ReplayStreamRecord | null> {
    const rows = await this.sql<{ stream_id: string; events: ReplayEvent[] }[]>`
      SELECT stream_id, events FROM replay_streams WHERE stream_id = ${streamId}`;
    const row = rows[0];
    return row ? { streamId: row.stream_id, events: row.events } : null;
  }

  async saveRun(run: ReplayRunRecord): Promise<void> {
    await this.sql`
      INSERT INTO replay_runs (run_id, stream_id, record) VALUES (${run.runId}, ${run.streamId}, ${this.sql.json(toJsonValue(run))})
      ON CONFLICT (run_id) DO NOTHING`;
  }

  async getRun(runId: string): Promise<ReplayRunRecord | null> {
    const rows = await this.sql<{ record: ReplayRunRecord }[]>`
      SELECT record FROM replay_runs WHERE run_id = ${runId}`;
    return rows[0]?.record ?? null;
  }
}

/** Opens the Neon pool. Caller owns closing. */
export function createPostgresPool(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, { max: 5, idle_timeout: 20 });
}

function toJsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

export function scopeKeyOfEvent(event: PaymentFailedEvent): string {
  return scopeKeyFor(event);
}
