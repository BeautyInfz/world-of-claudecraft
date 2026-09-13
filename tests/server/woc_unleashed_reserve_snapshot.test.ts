// Validation surface of woc_unleashed_reserve_snapshot.ts, exercised with a
// fake db.query so nothing here touches real Postgres.

import { describe, expect, it, vi } from 'vitest';
import { recordReserveSnapshot } from '../../server/woc_unleashed_reserve_snapshot';

describe('recordReserveSnapshot validation', () => {
  function fakeDb() {
    return { query: vi.fn().mockResolvedValue({ rows: [] }) };
  }

  it('rejects a negative or non-finite balance before any query', async () => {
    const db = fakeDb();
    await expect(recordReserveSnapshot(db as never, -1)).rejects.toThrow(/balanceWoc/);
    await expect(recordReserveSnapshot(db as never, Number.NaN)).rejects.toThrow(/balanceWoc/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('accepts a valid balance, issuing exactly one insert', async () => {
    const db = fakeDb();
    await recordReserveSnapshot(db as never, 12345.67);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
