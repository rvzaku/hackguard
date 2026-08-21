import { DecisionSchema, type ShapContribution } from '@hackguard/contracts';

import { AppError } from '../errors.js';
import type { PaymentFailedEvent } from '@hackguard/contracts';

/**
 * Typed client for the FastAPI scoring sidecar (services/scoring). The
 * boundary is the frozen OpenAPI contract: requests are contract-shaped
 * PaymentFailedEvents, responses are validated with the shared Zod
 * DecisionSchema before any consumer sees them.
 */

export interface ScoreResult {
  pRecover: number;
  modelVersion: string;
  shapTop: ShapContribution[];
}

export interface ScoringClient {
  score(event: PaymentFailedEvent): Promise<ScoreResult>;
}

const SCORE_TIMEOUT_MS = 2_500;

export class ScoringSidecarClient implements ScoringClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async score(event: PaymentFailedEvent): Promise<ScoreResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v1/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(SCORE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AppError('SCORING_UNAVAILABLE', 'scoring sidecar unreachable', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (!res.ok) {
      throw new AppError('SCORING_UNAVAILABLE', `scoring sidecar returned HTTP ${res.status}`);
    }
    const parsed = DecisionSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError('SCORING_INVALID_RESPONSE', 'sidecar response failed contract validation', {
        issues: parsed.error.issues,
      });
    }
    return {
      pRecover: parsed.data.pRecover,
      modelVersion: parsed.data.modelVersion,
      shapTop: parsed.data.shapTop,
    };
  }
}
