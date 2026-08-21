import { z } from 'zod';

import { ScoringSidecarClient, type ScoringClient } from './scoring/client.js';
import {
  InMemoryIdempotencyStore,
  UpstashIdempotencyStore,
  type IdempotencyStore,
} from './idempotency.js';
import {
  inMemoryRuntime,
  type Runtime,
} from './stores/memory.js';
import {
  createPostgresPool,
  PostgresAuditLogStore,
  PostgresDecisionStore,
  PostgresPaymentEventStore,
  PostgresReplayStore,
} from './stores/postgres.js';

/**
 * Composition root: selects Neon-backed stores when DATABASE_URL is set,
 * Upstash-backed idempotency when the REST env vars are set, and falls back
 * to in-memory implementations otherwise (degraded local mode — every route
 * still functions for the demo, with reduced durability).
 */

const EnvSchema = z.object({
  SCORING_BASE_URL: z.string().url().default('http://localhost:8000'),
  DATABASE_URL: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
});

export type RuntimeEnv = z.infer<typeof EnvSchema>;

export function envFrom(processEnv: NodeJS.ProcessEnv): RuntimeEnv {
  return EnvSchema.parse({
    SCORING_BASE_URL: processEnv.SCORING_BASE_URL,
    DATABASE_URL: processEnv.DATABASE_URL,
    UPSTASH_REDIS_REST_URL: processEnv.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: processEnv.UPSTASH_REDIS_REST_TOKEN,
  });
}

export function buildRuntime(env: RuntimeEnv): Runtime {
  if (env.DATABASE_URL) {
    const sql = createPostgresPool(env.DATABASE_URL);
    let idempotency: IdempotencyStore = new InMemoryIdempotencyStore();
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
      idempotency = new UpstashIdempotencyStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
    }
    return {
      payments: new PostgresPaymentEventStore(sql),
      audit: new PostgresAuditLogStore(sql),
      replays: new PostgresReplayStore(sql),
      decisions: new PostgresDecisionStore(sql),
      idempotency,
    };
  }
  return inMemoryRuntime();
}

export function buildScoringClient(env: RuntimeEnv): ScoringSidecarClient {
  return new ScoringSidecarClient(env.SCORING_BASE_URL);
}

// Next.js bundles each route separately, so module-level singletons are NOT
// shared across route handlers. Cache on globalThis (standard Next pattern)
// so every route composes onto the same runtime/stores.
const globalForRuntime = globalThis as unknown as {
  __hackguardRuntime?: Runtime;
  __hackguardScoring?: ScoringSidecarClient | null;
};

export function getRuntime(): Runtime {
  globalForRuntime.__hackguardRuntime ??= buildRuntime(envFrom(process.env));
  return globalForRuntime.__hackguardRuntime;
}

export function getScoringClient(): ScoringSidecarClient {
  globalForRuntime.__hackguardScoring ??= buildScoringClient(envFrom(process.env));
  return globalForRuntime.__hackguardScoring;
}

/** Test seam: swap the process-wide runtime before exercising route handlers. */
export function setRuntimeForTests(runtime: Runtime, scoring?: ScoringClient): void {
  globalForRuntime.__hackguardRuntime = runtime;
  globalForRuntime.__hackguardScoring =
    (scoring as ScoringSidecarClient | undefined) ?? null;
}
