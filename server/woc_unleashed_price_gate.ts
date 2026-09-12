// The WoC Unleashed holding-gate threshold: the $WOC amount currently
// equivalent to $40 USD, refreshed periodically from the Jupiter aggregator
// price API (never a live on-chain AMM spot price directly - spec-mandated,
// since thin liquidity makes a spot price manipulable moments before a
// claim). Bounded between refreshes (max +-15% move) and clamped to a hard
// floor/ceiling, so a bad or manipulated price read can never move the gate
// to an absurd value in one step. WoC Unleashed-exclusive.

import { logger } from './http/logger';

const WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

// Jupiter's price API (v2, api.jup.ag): { data: { <mint>: { price: "0.123" } } }.
// A separate endpoint from the balance RPC in woc_balance.ts - price is off
// Jupiter, balances are off the chain's own RPC.
const JUPITER_PRICE_API_URL = 'https://api.jup.ag/price/v2';

export const HOLD_USD_THRESHOLD = 40;

// Bounded movement between refreshes: the spec's own "max +-15%" cap.
export const MAX_THRESHOLD_MOVE_FRACTION = 0.15;

// PROVISIONAL hard floor/ceiling (in $WOC), pending real market-cap/liquidity
// evidence: a maintainer tuning call, not resolved unilaterally here. The
// floor guards against a price read of ~0 (or a manipulated near-zero quote)
// making the gate trivially satisfiable; the ceiling guards against a price
// spike making the gate practically unreachable. Both are env-overridable so
// an operator can tune them without a code change.
export const DEFAULT_HOLDING_THRESHOLD_FLOOR_WOC = 1_000;
export const DEFAULT_HOLDING_THRESHOLD_CEILING_WOC = 10_000_000;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function holdingThresholdFloor(): number {
  return envNumber('WOC_UNLEASHED_HOLD_THRESHOLD_FLOOR', DEFAULT_HOLDING_THRESHOLD_FLOOR_WOC);
}

function holdingThresholdCeiling(): number {
  return envNumber('WOC_UNLEASHED_HOLD_THRESHOLD_CEILING', DEFAULT_HOLDING_THRESHOLD_CEILING_WOC);
}

/** Clamp a raw computed threshold to [floor, ceiling]. Pure, exported for a
 *  direct unit test independent of the bounded-movement step below. */
export function clampThreshold(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, value));
}

/** Bound how far the threshold may move in one refresh relative to the
 *  previous cached value: at most +-maxMoveFraction. `previous === null`
 *  (the very first refresh, nothing cached yet) applies no bound - there is
 *  no prior value to move away from. Pure, exported for a direct unit test. */
export function boundThresholdMove(
  previous: number | null,
  raw: number,
  maxMoveFraction: number,
): number {
  if (previous === null) return raw;
  const maxUp = previous * (1 + maxMoveFraction);
  const maxDown = previous * (1 - maxMoveFraction);
  return Math.min(maxUp, Math.max(maxDown, raw));
}

let cachedThresholdWoc: number | null = null;
let lastRefreshAt: number | null = null;
let lastRefreshError: string | null = null;

/** The current cached $WOC amount equivalent to $40 USD, or null before the
 *  first successful refresh (the claim gate must fail closed in that case,
 *  never fall back to an un-refreshed default). */
export function currentHoldingThresholdWoc(): number | null {
  return cachedThresholdWoc;
}

export function holdingThresholdStatus(): {
  thresholdWoc: number | null;
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
} {
  return { thresholdWoc: cachedThresholdWoc, lastRefreshAt, lastRefreshError };
}

/** Test-only: reset the module's cached state between tests. */
export function resetHoldingThresholdForTests(): void {
  cachedThresholdWoc = null;
  lastRefreshAt = null;
  lastRefreshError = null;
}

interface JupiterPriceResponse {
  data?: Record<string, { price?: unknown } | undefined>;
}

/** Raw $WOC/USD price from Jupiter, or null on any fetch/parse failure. */
export async function fetchWocUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch(`${JUPITER_PRICE_API_URL}?ids=${WOC_MINT}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as JupiterPriceResponse;
    const raw = body?.data?.[WOC_MINT]?.price;
    const price = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : null;
    return price !== null && Number.isFinite(price) && price > 0 ? price : null;
  } catch (err) {
    logger.error({ err }, 'woc unleashed jupiter price fetch failed');
    return null;
  }
}

/** One refresh pass: fetch the price, compute the raw $40-equivalent $WOC
 *  amount, bound its movement against the previous cached value, clamp to
 *  the floor/ceiling, and cache. A failed fetch leaves the cache untouched
 *  (the last known-good threshold keeps gating claims) and records the
 *  error for the status readout. Returns the resulting cached value (which
 *  may be the untouched previous one on failure, or still null before any
 *  refresh has ever succeeded). */
export async function refreshHoldingThreshold(): Promise<number | null> {
  const price = await fetchWocUsdPrice();
  if (price === null) {
    lastRefreshError = 'price fetch failed';
    return cachedThresholdWoc;
  }
  const raw = HOLD_USD_THRESHOLD / price;
  const bounded = boundThresholdMove(cachedThresholdWoc, raw, MAX_THRESHOLD_MOVE_FRACTION);
  const clamped = clampThreshold(bounded, holdingThresholdFloor(), holdingThresholdCeiling());
  cachedThresholdWoc = clamped;
  lastRefreshAt = Date.now();
  lastRefreshError = null;
  return clamped;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic refresh loop (spec: every 1-6h; defaults to 3h,
 *  env-overridable). Fires one immediate refresh so the gate has a value as
 *  soon as possible after boot, rather than staying null for a full
 *  interval. Idempotent: a second call is a no-op if already running. */
export function startHoldingThresholdRefreshLoop(): void {
  if (refreshTimer) return;
  const intervalMs = envNumber('WOC_UNLEASHED_HOLD_THRESHOLD_REFRESH_MS', 3 * 60 * 60 * 1000);
  void refreshHoldingThreshold();
  refreshTimer = setInterval(() => void refreshHoldingThreshold(), intervalMs);
  refreshTimer.unref?.();
}

/** Test-only: stop the refresh loop. */
export function stopHoldingThresholdRefreshLoop(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}
