import type { PaymentFailedEvent } from '@hackguard/contracts';

import { triage } from '../triage/rules';
import { mulberry32, type Rng } from './rng';

/**
 * Adversarial scenario simulator (eval-loop scope item 1).
 *
 * Generates hard synthetic failure streams designed to punish naive retry
 * policies, each with hidden GROUND TRUTH the policy cannot see:
 *   - `cureAtMs`   — the moment funds actually become available (payday
 *                    alignment is the dominant real-world timing signal).
 *   - `propensity` — how likely this payer is to cure at a well-timed moment.
 *
 * The outcome model (`pRecoverAt`) is the simulator's ground truth, NOT the
 * policy being graded: a retry recovers only if it lands in the cure window
 * AND a deterministic draw (shared across arms — common random numbers) beats
 * P(recover). Streams are seeded + deterministic so every eval run is
 * reproducible bit-for-bit.
 *
 * Adversarial families (eval-loop brief):
 *   1. payday-timing edge cases   — soft declines straddling 1st/15th paydays
 *   2. penalty-fee traps          — Visa Cat-1 / MC MAC do-not-retry codes
 *   3. cap-exceeding sequences    — 20 failures / 30d on one scope
 *   4. hostile decline orderings  — hard-then-soft sequences per customer
 *   5. mixed customer tenures     — propensity varies with tenure
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Retry lands inside the cure window: full recovery odds. */
export const CURE_WINDOW_MS = 48 * HOUR_MS;
/** Up to 5 days late: odds decay but recovery is still plausible. */
export const LATE_WINDOW_MS = 5 * DAY_MS;
const ALIGN_IN_WINDOW = 1.0;
const ALIGN_LATE = 0.5;
const ALIGN_OFF = 0.12;

/** Published-curve-style decay by 0-based retry index (attempt 1 strongest). */
const ATTEMPT_DECAY = [1.0, 0.6, 0.36] as const;
const ATTEMPT_DECAY_TAIL = 0.2;

export interface ScenarioFailure {
  event: PaymentFailedEvent;
  groundTruth: {
    /** Funds become available at this moment (ms epoch). */
    cureAtMs: number;
    /** P(payer cures | well-timed retry), in (0, 1). */
    propensity: number;
  };
}

export interface ScenarioStream {
  name: string;
  description: string;
  failures: ScenarioFailure[];
}

// --- Ground-truth outcome model -------------------------------------------

export function alignmentFactor(momentMs: number, cureAtMs: number): number {
  if (momentMs >= cureAtMs && momentMs <= cureAtMs + CURE_WINDOW_MS) return ALIGN_IN_WINDOW;
  if (momentMs > cureAtMs + CURE_WINDOW_MS && momentMs <= cureAtMs + LATE_WINDOW_MS) return ALIGN_LATE;
  return ALIGN_OFF;
}

export function attemptDecay(retryIndex: number): number {
  return ATTEMPT_DECAY[retryIndex] ?? ATTEMPT_DECAY_TAIL;
}

/** P(recover) the SIMULATOR assigns to one retry moment (ground truth). */
export function pRecoverAt(failure: ScenarioFailure, retryIndex: number, momentMs: number): number {
  const p = failure.groundTruth.propensity * attemptDecay(retryIndex) * alignmentFactor(momentMs, failure.groundTruth.cureAtMs);
  return Math.min(0.99, Math.max(0.001, p));
}

// --- Time helpers (UTC only; deterministic) --------------------------------

/** Next payday moment (day 1 or 15 of the month, 09:00 UTC) strictly after `afterMs`. */
export function nextPaydayMs(afterMs: number, hourUtc = 9): number {
  const start = new Date(afterMs);
  for (let dayOffset = 0; dayOffset <= 32; dayOffset++) {
    const candidate = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + dayOffset, hourUtc, 0, 0, 0),
    );
    if (candidate.getTime() > afterMs && (candidate.getUTCDate() === 1 || candidate.getUTCDate() === 15)) {
      return candidate.getTime();
    }
  }
  // Unreachable: within any 32-day span a 1st or 15th occurs.
  throw new Error('nextPaydayMs: no payday found within 32 days');
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// --- Stream generators ------------------------------------------------------

const SOFT_CODES_VISA = ['insufficient_funds', 'try_again_later', 'generic_decline'] as const;
// Mastercard retryable soft declines: MAC 02 ("no information available") is
// the TPE-eligible retryable advice code the triage engine maps to RETRY_SOFT.
const SOFT_CODES_MC = ['mac_02'] as const;
const VISA_HARD_CODES = ['stolen_card', 'lost_card', 'fraudulent'] as const;
const MC_HARD_CODES = ['mac_03', 'mac_21'] as const;
const ASK_CODES = ['expired_card', 'incorrect_cvc', 'card_not_authorized'] as const;

/** Brand-faithful retryable soft code: Visa Cat-2/3 family vs MC MAC 02. */
let softPickVisaCounter = 0;
function softCodeFor(brand: ScenarioBrand): string {
  if (brand === 'mastercard') return SOFT_CODES_MC[0] as string;
  // Cycle deterministically through the visa soft codes.
  const codes = [...SOFT_CODES_VISA];
  softPickVisaCounter = (softPickVisaCounter + 1) % codes.length;
  return codes[softPickVisaCounter] as string;
}

function propensityFor(rng: Rng, tenureDays: number, amountMinor: number): number {
  const tenureFactor = Math.min(1, tenureDays / 730);
  const amountBonus = amountMinor < 5_000 ? 0.1 : 0;
  const jitter = rng.next() * 0.08 - 0.04;
  return Math.min(0.92, Math.max(0.08, 0.3 + 0.45 * tenureFactor + amountBonus + jitter));
}

const CARD_BRANDS = ['visa', 'mastercard'] as const;
type ScenarioBrand = (typeof CARD_BRANDS)[number];

function makeFailure(
  rng: Rng,
  id: string,
  declineCode: string,
  opts: {
    tsMs: number;
    tenureDays: number;
    amountMinor?: number;
    cardBrand?: PaymentFailedEvent['cardBrand'];
    attempt?: number;
    cureAtMs?: number;
    customerId?: string;
  },
): ScenarioFailure {
  const amountMinor = opts.amountMinor ?? rng.int(1_900, 14_900);
  // Ground truth aligns with the real triage engine: anything the policy must
  // suppress (hard / do-not-retry / customer-actionable) can never recover
  // via an automatic retry, so its propensity is exactly 0.
  const event: PaymentFailedEvent = {
    stripeId: `in_${id}`,
    customerId: opts.customerId ?? `cus_${id}`,
    amountMinor,
    currency: 'usd',
    declineCode,
    attempt: opts.attempt ?? 1,
    cardBrand: opts.cardBrand ?? 'visa',
    ts: iso(opts.tsMs),
  };
  const autoRetryable = triage(event).action === 'RETRY_SOFT';
  return {
    event,
    groundTruth: {
      cureAtMs: opts.cureAtMs ?? opts.tsMs + rng.int(1, 6) * DAY_MS,
      propensity: autoRetryable ? propensityFor(rng, opts.tenureDays, amountMinor) : 0,
    },
  };
}

/** 1. Payday-timing edge cases: soft declines straddling the 1st/15th cycle. */
export function paydayTimingStream(rng: Rng): ScenarioStream {
  const failures: ScenarioFailure[] = [];
  // Anchor the stream inside one month so paydays are stable relative to failures.
  const monthStart = Date.UTC(2026, 6, 1); // July 2026
  for (let i = 0; i < 28; i++) {
    const tsMs = monthStart + rng.int(0, 27) * DAY_MS + rng.int(0, 20) * HOUR_MS;
    const tenureDays = rng.int(10, 900);
    const cardBrand = rng.pick(CARD_BRANDS);
    failures.push(
      makeFailure(rng, `pd_${String(i).padStart(3, '0')}`, softCodeFor(cardBrand), {
        tsMs,
        tenureDays,
        cardBrand,
        attempt: rng.int(1, 2),
        cureAtMs: nextPaydayMs(tsMs), // funds arrive next payday morning
      }),
    );
  }
  return {
    name: 'payday-timing',
    description: 'Soft declines 0-27 days from month start; funds cure only on the next 1st/15th.',
    failures,
  };
}

/** 2. Penalty-fee traps: Visa Cat-1 / MC MAC do-not-retry / customer-actionable codes. */
export function penaltyTrapStream(rng: Rng): ScenarioStream {
  const failures: ScenarioFailure[] = [];
  const base = Date.UTC(2026, 7, 3, 14, 0, 0);
  for (let i = 0; i < 18; i++) {
    const brand = rng.pick(CARD_BRANDS);
    const code =
      brand === 'visa' ? rng.pick([...VISA_HARD_CODES, ...ASK_CODES]) : rng.pick([...MC_HARD_CODES, 'mac_01']);
    failures.push(
      makeFailure(rng, `trap_${String(i).padStart(3, '0')}`, code, {
        tsMs: base + i * rng.int(2, 9) * HOUR_MS,
        tenureDays: rng.int(30, 800),
        cardBrand: brand,
      }),
    );
  }
  return {
    name: 'penalty-traps',
    description: 'Category-1 and do-not-retry codes: any retry incurs penalty fees and never recovers.',
    failures,
  };
}

/** 3. Cap-exceeding sequences: 20 failures on one scope inside a rolling 30d window. */
export function capExceedStream(rng: Rng): ScenarioStream {
  const failures: ScenarioFailure[] = [];
  const base = Date.UTC(2026, 5, 2, 10, 0, 0);
  for (let i = 0; i < 20; i++) {
    const tsMs = base + i * DAY_MS + rng.int(0, 6) * HOUR_MS;
    failures.push(
      makeFailure(rng, `cap_${String(i).padStart(3, '0')}`, softCodeFor('visa'), {
        tsMs,
        tenureDays: rng.int(200, 900),
        customerId: 'cus_cap_buster',
        cardBrand: 'visa',
        cureAtMs: tsMs + 2 * DAY_MS,
      }),
    );
  }
  return {
    name: 'cap-exceed',
    description: 'One visa scope, 20 soft failures in 30d: fixed-schedule retrying blows past the 15/30d cap.',
    failures,
  };
}

/** 4. Hostile decline orderings: hard-then-soft and ask-then-soft per customer. */
export function hostileOrderingStream(rng: Rng): ScenarioStream {
  const failures: ScenarioFailure[] = [];
  const base = Date.UTC(2026, 7, 5, 8, 0, 0);
  for (let i = 0; i < 12; i++) {
    const customerId = `cus_hostile_${i}`;
    const brand = rng.pick(CARD_BRANDS);
    const firstCode = brand === 'visa' ? rng.pick(VISA_HARD_CODES) : rng.pick(MC_HARD_CODES);
    const secondCode = softCodeFor(brand);
    const firstTs = base + i * 2 * DAY_MS;
    const tenureDays = rng.int(60, 700);
    failures.push(
      makeFailure(rng, `ho_${String(i).padStart(3, '0')}a`, firstCode, {
        tsMs: firstTs,
        tenureDays,
        customerId,
        cardBrand: brand,
      }),
    );
    failures.push(
      makeFailure(rng, `ho_${String(i).padStart(3, '0')}b`, secondCode, {
        tsMs: firstTs + rng.int(6, 20) * HOUR_MS,
        tenureDays,
        customerId,
        cardBrand: brand,
        cureAtMs: firstTs + 3 * DAY_MS,
      }),
    );
  }
  return {
    name: 'hostile-ordering',
    description: 'Hard decline followed by a retryable soft decline on the same scope — punishes retry-everything.',
    failures,
  };
}

/** 5. Mixed customer tenures: propensity spans new (low) to tenured (high). */
export function mixedTenureStream(rng: Rng): ScenarioStream {
  const failures: ScenarioFailure[] = [];
  const base = Date.UTC(2026, 6, 8, 12, 0, 0);
  for (let i = 0; i < 24; i++) {
    const tenureDays = rng.pick([2, 20, 75, 200, 400, 900]);
    const tsMs = base + rng.int(0, 25) * DAY_MS + rng.int(0, 12) * HOUR_MS;
    const cardBrand = rng.pick(CARD_BRANDS);
    failures.push(
      makeFailure(rng, `ten_${String(i).padStart(3, '0')}`, softCodeFor(cardBrand), {
        tsMs,
        tenureDays,
        cardBrand,
        cureAtMs: tsMs + rng.int(1, 4) * DAY_MS,
      }),
    );
  }
  return {
    name: 'mixed-tenure',
    description: 'Soft declines across tenures 2-900 days; tenured payers cure far more often.',
    failures,
  };
}

export interface SimulatedCorpus {
  streams: ScenarioStream[];
}

/** Build the full adversarial corpus from a seed. Deterministic. */
export function simulateCorpus(seed: number): SimulatedCorpus {
  const streams = [
    paydayTimingStream(mulberry32(seed ^ 0x50a9d4)),
    penaltyTrapStream(mulberry32(seed ^ 0x7e2c11)),
    capExceedStream(mulberry32(seed ^ 0x3f8b02)),
    hostileOrderingStream(mulberry32(seed ^ 0x11d5a9)),
    mixedTenureStream(mulberry32(seed ^ 0x62e7f0)),
  ];
  return { streams };
}
