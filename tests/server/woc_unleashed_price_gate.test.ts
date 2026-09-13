// The WoC Unleashed holding-gate threshold (server/woc_unleashed_price_gate.ts):
// bounded movement, floor/ceiling clamping, and fail-closed/keep-last-good
// behavior on a failed price fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boundThresholdMove,
  clampThreshold,
  currentHoldingThresholdWoc,
  DEFAULT_HOLDING_THRESHOLD_CEILING_WOC,
  DEFAULT_HOLDING_THRESHOLD_FLOOR_WOC,
  HOLD_USD_THRESHOLD,
  holdingThresholdStatus,
  MAX_THRESHOLD_MOVE_FRACTION,
  refreshHoldingThreshold,
  resetHoldingThresholdForTests,
} from '../../server/woc_unleashed_price_gate';

describe('clampThreshold', () => {
  it('clamps to the floor and ceiling, passes through in between', () => {
    expect(clampThreshold(500, 1000, 10000)).toBe(1000);
    expect(clampThreshold(50000, 1000, 10000)).toBe(10000);
    expect(clampThreshold(5000, 1000, 10000)).toBe(5000);
  });
});

describe('boundThresholdMove', () => {
  it('applies no bound on the very first refresh (previous is null)', () => {
    expect(boundThresholdMove(null, 999_999, 0.15)).toBe(999_999);
  });

  it('caps an upward move at +maxMoveFraction', () => {
    expect(boundThresholdMove(1000, 2000, 0.15)).toBe(1150);
  });

  it('caps a downward move at -maxMoveFraction', () => {
    expect(boundThresholdMove(1000, 100, 0.15)).toBe(850);
  });

  it('passes through a move within the bound', () => {
    expect(boundThresholdMove(1000, 1050, 0.15)).toBe(1050);
  });

  it('matches the spec constant (15%)', () => {
    expect(MAX_THRESHOLD_MOVE_FRACTION).toBe(0.15);
  });
});

describe('refreshHoldingThreshold', () => {
  beforeEach(() => {
    resetHoldingThresholdForTests();
  });
  afterEach(() => {
    resetHoldingThresholdForTests();
    vi.unstubAllGlobals();
  });

  function stubFetch(price: number | null, ok = true) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok,
        json: async () => ({
          data:
            price === null
              ? {}
              : { '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth': { price: String(price) } },
        }),
      }),
    );
  }

  it('computes $40-equivalent $WOC from a successful price fetch', async () => {
    stubFetch(0.01); // $0.01/$WOC -> $40 / $0.01 = 4000 $WOC
    const threshold = await refreshHoldingThreshold();
    expect(threshold).toBe(4000);
    expect(currentHoldingThresholdWoc()).toBe(4000);
  });

  it('clamps to the floor when the raw computation is far below it', async () => {
    stubFetch(1000); // $40 / $1000 = 0.04 $WOC, far under the floor
    const threshold = await refreshHoldingThreshold();
    expect(threshold).toBe(DEFAULT_HOLDING_THRESHOLD_FLOOR_WOC);
  });

  it('clamps to the ceiling when the raw computation is far above it', async () => {
    stubFetch(0.00000001); // an absurdly low price -> a huge $WOC threshold
    const threshold = await refreshHoldingThreshold();
    expect(threshold).toBe(DEFAULT_HOLDING_THRESHOLD_CEILING_WOC);
  });

  it('keeps the last known-good value and records the error on a failed fetch', async () => {
    stubFetch(0.01);
    await refreshHoldingThreshold();
    expect(currentHoldingThresholdWoc()).toBe(4000);
    stubFetch(null, false);
    const threshold = await refreshHoldingThreshold();
    expect(threshold).toBe(4000); // unchanged
    expect(holdingThresholdStatus().lastRefreshError).not.toBeNull();
  });

  it('stays null before any successful refresh (fail-closed for the claim gate)', () => {
    expect(currentHoldingThresholdWoc()).toBeNull();
  });

  it('matches the spec constant ($40)', () => {
    expect(HOLD_USD_THRESHOLD).toBe(40);
  });
});
