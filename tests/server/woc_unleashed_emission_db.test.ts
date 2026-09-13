// Input-validation surface of woc_unleashed_emission_db.ts's setEmissionCap,
// exercised with a fake db.query so nothing here touches real Postgres
// (the ad_spend_db.test idiom). The SQL shape itself is covered by the
// db-integration suite once a running Postgres is available in CI.

import { describe, expect, it, vi } from 'vitest';
import {
  COPPER_PER_WOC,
  DEFAULT_EMISSION_CAP_COPPER,
  DEFAULT_EMISSION_CAP_WOC,
  setEmissionCap,
} from '../../server/woc_unleashed_emission_db';

describe('woc_unleashed_emission_db constants', () => {
  it('keeps the $WOC-to-copper conversion at the same 10000 rate as gold', () => {
    expect(COPPER_PER_WOC).toBe(10000);
  });

  it('defaults the emission cap to 1,000,000 $WOC, expressed in copper', () => {
    expect(DEFAULT_EMISSION_CAP_WOC).toBe(1_000_000);
    expect(DEFAULT_EMISSION_CAP_COPPER).toBe(1_000_000 * 10000);
  });
});

describe('setEmissionCap validation', () => {
  function fakePool() {
    return {
      connect: vi.fn(),
      query: vi.fn(),
    } as never;
  }

  it('rejects a negative or non-integer cap before ever connecting', async () => {
    const db = fakePool();
    await expect(setEmissionCap(db, -1, 'ops')).rejects.toThrow(/capCopper/);
    await expect(setEmissionCap(db, 1.5, 'ops')).rejects.toThrow(/capCopper/);
    await expect(setEmissionCap(db, Number.NaN, 'ops')).rejects.toThrow(/capCopper/);
  });

  it('rejects an empty or whitespace-only changedBy before ever connecting', async () => {
    const db = fakePool();
    await expect(setEmissionCap(db, 100, '')).rejects.toThrow(/changedBy/);
    await expect(setEmissionCap(db, 100, '   ')).rejects.toThrow(/changedBy/);
  });
});
