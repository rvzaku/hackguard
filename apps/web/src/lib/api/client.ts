import type { AuditEntry, Decision } from '@hackguard/contracts';
import {
  AuditLogSchema,
  ChainVerificationSchema,
  DecisionFeedSchema,
  ReplaySeriesSchema,
  SimulateViolationResultSchema,
  type AuditLog,
  type ChainVerification,
  type DecisionFeed,
  type ReplaySeries,
  type SimulateViolationResult,
} from './types';
import { EvalLoopArtifactSchema, type EvalLoopArtifact } from '../eval/artifact';

/**
 * Typed API client — the ONLY way the dashboard reads data. Every response is
 * parsed against the shared contract schemas; failures surface as a typed
 * error union (never an unhandled shape).
 */

export type ApiError =
  | { kind: 'network'; message: string }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'parse'; message: string };

export class ApiRequestError extends Error {
  readonly payload: ApiError;
  constructor(payload: ApiError) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.payload = payload;
  }
}

type RequestOptions = { signal?: AbortSignal };

async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } } },
  init?: RequestInit & RequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: init?.signal });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new ApiRequestError({
      kind: 'network',
      message: `Could not reach ${url}: ${cause instanceof Error ? cause.message : 'unknown error'}`,
    });
  }
  if (!response.ok) {
    throw new ApiRequestError({
      kind: 'http',
      status: response.status,
      message: `${url} responded with HTTP ${response.status}`,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError({ kind: 'parse', message: `${url} returned non-JSON body` });
  }
  const result = schema.safeParse(body);
  if (!result.success || result.data === undefined) {
    throw new ApiRequestError({
      kind: 'parse',
      message: `${url} returned a payload that violates the contract: ${result.error?.issues[0]?.message ?? 'unknown'}`,
    });
  }
  return result.data;
}

export interface ApiClient {
  getDecisions(options?: RequestOptions): Promise<DecisionFeed>;
  getReplay(options?: RequestOptions): Promise<ReplaySeries>;
  getAuditLog(options?: RequestOptions): Promise<AuditLog>;
  verifyChain(options?: RequestOptions): Promise<ChainVerification>;
  simulateViolatingRetry(options?: RequestOptions): Promise<SimulateViolationResult>;
  getEvalLoop(options?: RequestOptions): Promise<EvalLoopArtifact>;
}

export function createApiClient(fetchImpl: typeof fetch = fetch): ApiClient {
  return {
    getDecisions: (options) => request(fetchImpl, '/api/decisions', DecisionFeedSchema, options),
    getReplay: (options) => request(fetchImpl, '/api/replay', ReplaySeriesSchema, options),
    getAuditLog: (options) => request(fetchImpl, '/api/audit', AuditLogSchema, options),
    verifyChain: (options) =>
      request(fetchImpl, '/api/audit/verify', ChainVerificationSchema, { method: 'POST', ...options }),
    simulateViolatingRetry: (options) =>
      request(fetchImpl, '/api/compliance/simulate-violation', SimulateViolationResultSchema, {
        method: 'POST',
        ...options,
      }),
    getEvalLoop: (options) => request(fetchImpl, '/api/eval-loop', EvalLoopArtifactSchema, options),
  };
}

export type { AuditEntry, Decision, EvalLoopArtifact };
