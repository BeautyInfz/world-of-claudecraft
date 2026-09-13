// Periodic snapshots of the claim source wallet's own on-chain $WOC balance
// (server/woc_unleashed_chain.ts WOC_UNLEASHED_CLAIM_SOURCE_WALLET). This is
// the data source for BOTH the wallet panel's "claim wallet reserve"
// readout (its latest row) and the "on-chain flow" chart (day-over-day
// deltas: a rise is a refill, a fall is claims paid out) - the spec's own
// suggested approach ("the reserve balance is this chart's latest data
// point, implement off the same data source"), avoiding a full Solana
// transaction-history parse. WoC Unleashed-exclusive.

import type { Pool } from 'pg';
import { logger } from './http/logger';

export const WOC_UNLEASHED_RESERVE_SNAPSHOTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS woc_unleashed_reserve_snapshots (
  id BIGSERIAL PRIMARY KEY,
  balance_woc DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_unleashed_reserve_snapshots_created_at
  ON woc_unleashed_reserve_snapshots (created_at);
`;

export async function recordReserveSnapshot(db: Pool, balanceWoc: number): Promise<void> {
  if (!Number.isFinite(balanceWoc) || balanceWoc < 0) {
    throw new TypeError('balanceWoc must be a non-negative finite number');
  }
  await db.query('INSERT INTO woc_unleashed_reserve_snapshots (balance_woc) VALUES ($1)', [
    balanceWoc,
  ]);
}

export interface ReserveSnapshotRow {
  balanceWoc: number;
  createdAt: string;
}

/** The latest snapshot, or null before the first one has ever been taken
 *  (the wallet panel's reserve readout falls back to a live RPC read in
 *  that case; see server/woc_unleashed_wallet_routes.ts). */
export async function latestReserveSnapshot(db: Pool): Promise<ReserveSnapshotRow | null> {
  const res = await db.query(
    `SELECT balance_woc, created_at FROM woc_unleashed_reserve_snapshots
      ORDER BY created_at DESC LIMIT 1`,
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    balanceWoc: Number(row.balance_woc),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export interface OnChainFlowDayBucket {
  day: string;
  balanceWoc: number;
  /** balanceWoc - the PRIOR day's last snapshot (null for the first bucket
   *  in the window, which has no prior point to diff against). Positive is
   *  a refill/inflow, negative is claims paid out that day. */
  deltaWoc: number | null;
}

const MAX_FLOW_SERIES_DAYS = 365;

/** One row per day (the last snapshot taken that day) plus its delta from
 *  the previous day's last snapshot, bounded to MAX_FLOW_SERIES_DAYS. */
export async function onChainFlowSeries(db: Pool, days: number): Promise<OnChainFlowDayBucket[]> {
  const window = Math.min(MAX_FLOW_SERIES_DAYS, Math.max(1, Math.floor(days) || 30));
  const res = await db.query(
    `WITH daily AS (
       SELECT DISTINCT ON (date_trunc('day', created_at))
              date_trunc('day', created_at)::date AS day,
              balance_woc
         FROM woc_unleashed_reserve_snapshots
        WHERE created_at >= now() - (($1::int + 1) * INTERVAL '1 day')
        ORDER BY date_trunc('day', created_at), created_at DESC
     )
     SELECT day, balance_woc,
            balance_woc - LAG(balance_woc) OVER (ORDER BY day) AS delta
       FROM daily
      ORDER BY day ASC`,
    [window],
  );
  return res.rows
    .filter((row) => {
      const dayMs = new Date(row.day).getTime();
      return dayMs >= Date.now() - window * 24 * 60 * 60 * 1000;
    })
    .map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
      balanceWoc: Number(row.balance_woc),
      deltaWoc: row.delta === null ? null : Number(row.delta),
    }));
}

let snapshotTimer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic snapshot loop (defaults to hourly, env-overridable via
 *  WOC_UNLEASHED_RESERVE_SNAPSHOT_MS). Errors are logged and never thrown
 *  into the interval (a missed snapshot is a chart gap, never a crash).
 *  Idempotent. */
export function startReserveSnapshotLoop(
  db: Pool,
  readBalance: () => Promise<number | null>,
): void {
  if (snapshotTimer) return;
  const raw = process.env.WOC_UNLEASHED_RESERVE_SNAPSHOT_MS;
  const intervalMs = raw && Number(raw) > 0 ? Number(raw) : 60 * 60 * 1000;
  const tick = async () => {
    try {
      const balance = await readBalance();
      if (balance !== null) await recordReserveSnapshot(db, balance);
    } catch (err) {
      logger.error({ err }, 'woc unleashed reserve snapshot failed');
    }
  };
  void tick();
  snapshotTimer = setInterval(() => void tick(), intervalMs);
  snapshotTimer.unref?.();
}

export function stopReserveSnapshotLoop(): void {
  if (snapshotTimer) clearInterval(snapshotTimer);
  snapshotTimer = null;
}
