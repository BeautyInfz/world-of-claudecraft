// Pure/validation surface of woc_unleashed_wallet_db.ts, exercised with fake
// db.query calls so nothing here touches real Postgres (the ad_spend_db.test
// idiom). SQL shape (the realm-scoping, the chart bucketing) is covered by
// the db-integration suite once a running Postgres is available in CI.

import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_COOLDOWN_MS,
  claimCooldownElapsed,
  recordLedgerEvent,
} from '../../server/woc_unleashed_wallet_db';

describe('claimCooldownElapsed', () => {
  const now = Date.parse('2026-09-12T12:00:00.000Z');

  it('allows a claim when the account has never claimed (null)', () => {
    expect(claimCooldownElapsed(null, now)).toBe(true);
  });

  it('is exactly the 24h boundary: not elapsed one ms before, elapsed at/after', () => {
    const last = new Date(now - CLAIM_COOLDOWN_MS).toISOString();
    expect(claimCooldownElapsed(last, now)).toBe(true);
    const lastTooRecent = new Date(now - CLAIM_COOLDOWN_MS + 1).toISOString();
    expect(claimCooldownElapsed(lastTooRecent, now)).toBe(false);
  });

  it('blocks a claim well within the cooldown window', () => {
    const last = new Date(now - 60_000).toISOString();
    expect(claimCooldownElapsed(last, now)).toBe(false);
  });

  it('treats an unparseable timestamp as eligible rather than throwing', () => {
    expect(claimCooldownElapsed('not-a-date', now)).toBe(true);
  });
});

describe('recordLedgerEvent validation', () => {
  function fakeDb() {
    return { query: vi.fn().mockResolvedValue({ rows: [] }) };
  }

  it('rejects an unrecognized source/sink before any query', async () => {
    const db = fakeDb();
    await expect(
      recordLedgerEvent(db as never, {
        accountId: 1,
        sourceSink: 'bogus' as never,
        amountCopper: 100,
      }),
    ).rejects.toThrow(/sourceSink/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount for a source (loot/quest/boss)', async () => {
    const db = fakeDb();
    await expect(
      recordLedgerEvent(db as never, { accountId: 1, sourceSink: 'loot', amountCopper: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      recordLedgerEvent(db as never, { accountId: 1, sourceSink: 'quest', amountCopper: -5 }),
    ).rejects.toThrow(/positive/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a non-negative amount for a sink (repair/marketplace_fee/claim)', async () => {
    const db = fakeDb();
    await expect(
      recordLedgerEvent(db as never, { accountId: 1, sourceSink: 'repair', amountCopper: 0 }),
    ).rejects.toThrow(/negative/);
    await expect(
      recordLedgerEvent(db as never, { accountId: 1, sourceSink: 'claim', amountCopper: 5 }),
    ).rejects.toThrow(/negative/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('accepts a valid source and a valid sink, issuing exactly one insert each', async () => {
    const db = fakeDb();
    await recordLedgerEvent(db as never, { accountId: 1, sourceSink: 'boss', amountCopper: 500 });
    await recordLedgerEvent(db as never, {
      accountId: 1,
      sourceSink: 'marketplace_fee',
      amountCopper: -50,
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
