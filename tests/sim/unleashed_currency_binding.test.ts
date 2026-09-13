// bindUnleashedCurrency (src/sim/unleashed_currency_binding.ts): the copper<->unleashedBalance
// redirect that makes a WoC Unleashed character's $WOC balance a genuinely
// separate ledger from the shared `copper` field, with zero call-site
// changes anywhere else in the sim.

import { describe, expect, it } from 'vitest';
import type { PlayerMeta } from '../../src/sim/sim';
import { bindUnleashedCurrency } from '../../src/sim/unleashed_currency_binding';

function fakeMeta(copper: number, unleashedBalance?: number): PlayerMeta {
  return { copper, unleashedBalance } as unknown as PlayerMeta;
}

describe('bindUnleashedCurrency', () => {
  it('is a no-op when disabled: copper stays a plain field, unleashedBalance untouched', () => {
    const meta = fakeMeta(500, undefined);
    bindUnleashedCurrency(meta, false);
    expect(meta.copper).toBe(500);
    meta.copper = 700;
    expect(meta.copper).toBe(700);
    expect(meta.unleashedBalance).toBeUndefined();
  });

  it('redirects copper reads/writes to unleashedBalance when enabled, defaulting to 0', () => {
    const meta = fakeMeta(0, undefined);
    bindUnleashedCurrency(meta, true);
    expect(meta.copper).toBe(0);
    expect(meta.unleashedBalance).toBe(0);
    meta.copper += 1500;
    expect(meta.unleashedBalance).toBe(1500);
    expect(meta.copper).toBe(1500);
  });

  it('preserves an already-loaded unleashedBalance rather than resetting it to 0', () => {
    const meta = fakeMeta(0, 42_000);
    bindUnleashedCurrency(meta, true);
    expect(meta.copper).toBe(42_000);
  });

  it('never sums or aliases copper and unleashedBalance: writing copper never touches a', () => {
    const meta = fakeMeta(999, 100);
    bindUnleashedCurrency(meta, true);
    meta.copper = 250;
    // The original `copper` value (999) is gone from the live object - the
    // accessor shadows it entirely. Only unleashedBalance moved.
    expect(meta.unleashedBalance).toBe(250);
  });

  it('is idempotent: binding twice does not double-wrap or throw', () => {
    const meta = fakeMeta(0, 10);
    bindUnleashedCurrency(meta, true);
    bindUnleashedCurrency(meta, true);
    meta.copper = 20;
    expect(meta.unleashedBalance).toBe(20);
  });
});
