/**
 * Idempotency keys (plan §3: Upstash Redis free tier). `reserve` must be
 * atomic: exactly one caller out of N concurrent duplicates wins. The Upstash
 * REST impl uses SET NX EX; the in-memory impl is for tests and degraded
 * local mode.
 */

export interface IdempotencyStore {
  /** Returns true iff this caller is the first for `key` within the TTL. */
  reserve(key: string, ttlSeconds: number): Promise<boolean>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly keys = new Map<string, number>();

  async reserve(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.keys.get(key);
    if (existing !== undefined && existing > now) {
      return false;
    }
    this.keys.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

/**
 * Upstash Redis REST (https://docs.upstash.com/redis/features/restapi):
 * SET key value NX EX ttl — returns { result: "OK" } when reserved,
 * { result: null } when the key already exists.
 */
export class UpstashIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async reserve(key: string, ttlSeconds: number): Promise<boolean> {
    const url = `${this.restUrl.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/reserved?nx=true&ex=${ttlSeconds}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.restToken}` },
    });
    if (!res.ok) {
      throw new Error(`upstash idempotency SET failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { result: string | null };
    return body.result === 'OK';
  }
}
