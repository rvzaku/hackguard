/**
 * Seeded deterministic PRNG for the adversarial eval loop (plan §3 "ML
 * design": the replay/eval harness must be deterministic and inspectable).
 *
 * mulberry32 — small, fast, well-distributed 32-bit PRNG. Never used for
 * security; only for reproducible synthetic-stream generation.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform element pick (array must be non-empty). */
  pick<T>(items: readonly T[]): T;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  function int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
  }
  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('rng.pick called with an empty array');
    return items[Math.floor(next() * items.length)] as T;
  }
  return { next, int, pick };
}
