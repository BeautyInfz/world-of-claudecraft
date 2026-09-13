// SQL boundary for the WoC Unleashed in-game $WOC emission cap (the *_db.ts
// convention). WoC Unleashed-exclusive: nothing here is called unless the
// calling code has already checked WOC_UNLEASHED (server/woc_unleashed.ts).
//
// A SINGLETON state row (id = 1, enforced by the CHECK) tracks two counters,
// both in copper units (COPPER_PER_WOC below), separate from the on-chain
// claim source wallet's own SPL token balance, which is a different pool
// entirely and never touches this table:
//   - gross_emitted_copper: total $WOC ever minted into circulation through
//     gameplay (loot, quests, bosses). Monotonically non-decreasing.
//   - net_circulating_copper: gross emission minus off-chain sinks (repairs,
//     marketplace fees, claims). Can fall as players spend/claim.
// cap_copper is the configured ceiling on gross_emitted_copper, adjustable at
// runtime (see setEmissionCap); every change is appended to
// woc_unleashed_emission_cap_log for the audit trail.
//
// Behavior AT the cap (hard stop / soft scale-down / queue-pause) is an open
// design decision (see the WoC Unleashed spec's "Open decisions" section) and
// is deliberately NOT implemented here: this module only tracks the counters
// and exposes wouldExceedCap() as the primitive a future gameplay-facing sink
// (loot/quest/boss reward grant) will call once that wiring lands.
//
// Bounded by nature (one state row, an append-only but naturally low-volume
// admin-action log), so neither table needs retention registration.

import type { Pool } from 'pg';

// $WOC is 1:1 with gold, and this repo's currency granularity is copper
// (see src/sim/format_money.ts: 10000 copper = 1 gold). Keeping emission
// counters in copper keeps them directly comparable to character.state.copper
// and the existing bank_ledger/account_wealth copper-denominated tables.
export const COPPER_PER_WOC = 10000;

// Spec default: 1,000,000 $WOC total ever emitted in-game.
export const DEFAULT_EMISSION_CAP_WOC = 1_000_000;
export const DEFAULT_EMISSION_CAP_COPPER = DEFAULT_EMISSION_CAP_WOC * COPPER_PER_WOC;

export const WOC_UNLEASHED_EMISSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS woc_unleashed_emission_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  cap_copper BIGINT NOT NULL DEFAULT ${DEFAULT_EMISSION_CAP_COPPER},
  gross_emitted_copper BIGINT NOT NULL DEFAULT 0,
  net_circulating_copper BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT woc_unleashed_emission_state_singleton CHECK (id = 1),
  CONSTRAINT woc_unleashed_emission_state_nonnegative CHECK (
    cap_copper >= 0 AND gross_emitted_copper >= 0
  )
);
INSERT INTO woc_unleashed_emission_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS woc_unleashed_emission_cap_log (
  id BIGSERIAL PRIMARY KEY,
  changed_by TEXT NOT NULL,
  old_cap_copper BIGINT NOT NULL,
  new_cap_copper BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export interface EmissionState {
  capCopper: number;
  grossEmittedCopper: number;
  netCirculatingCopper: number;
  updatedAt: string;
}

type RawState = {
  cap_copper: number | string;
  gross_emitted_copper: number | string;
  net_circulating_copper: number | string;
  updated_at: Date | string;
};

function stateFromRaw(row: RawState): EmissionState {
  return {
    capCopper: Number(row.cap_copper),
    grossEmittedCopper: Number(row.gross_emitted_copper),
    netCirculatingCopper: Number(row.net_circulating_copper),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** The current emission counters and cap. The seed row from the schema's
 *  ON CONFLICT DO NOTHING insert guarantees this never returns null. */
export async function getEmissionState(db: Pool): Promise<EmissionState> {
  const res = await db.query<RawState>(
    `SELECT cap_copper, gross_emitted_copper, net_circulating_copper, updated_at
       FROM woc_unleashed_emission_state WHERE id = 1`,
  );
  return stateFromRaw(res.rows[0]);
}

function validCapCopper(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('capCopper must be a non-negative integer');
  }
  return value;
}

function validChangedBy(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('changedBy must be a non-empty string');
  }
  return value.trim();
}

/** Set the emission cap and append an audit-log row, in one transaction (so a
 *  reader can never observe a cap change with no matching log entry). Returns
 *  the new state. */
export async function setEmissionCap(
  db: Pool,
  capCopper: number,
  changedBy: string,
): Promise<EmissionState> {
  const cap = validCapCopper(capCopper);
  const who = validChangedBy(changedBy);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const prev = await client.query<RawState>(
      `SELECT cap_copper, gross_emitted_copper, net_circulating_copper, updated_at
         FROM woc_unleashed_emission_state WHERE id = 1 FOR UPDATE`,
    );
    const oldCap = Number(prev.rows[0].cap_copper);
    const updated = await client.query<RawState>(
      `UPDATE woc_unleashed_emission_state
          SET cap_copper = $1, updated_at = now()
        WHERE id = 1
      RETURNING cap_copper, gross_emitted_copper, net_circulating_copper, updated_at`,
      [cap],
    );
    await client.query(
      `INSERT INTO woc_unleashed_emission_cap_log (changed_by, old_cap_copper, new_cap_copper)
       VALUES ($1, $2, $3)`,
      [who, oldCap, cap],
    );
    await client.query('COMMIT');
    return stateFromRaw(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface EmissionCapLogRow {
  id: number;
  changedBy: string;
  oldCapCopper: number;
  newCapCopper: number;
  createdAt: string;
}

/** Most recent cap changes, newest first. */
export async function listEmissionCapLog(db: Pool, limit: number): Promise<EmissionCapLogRow[]> {
  const res = await db.query(
    `SELECT id, changed_by, old_cap_copper, new_cap_copper, created_at
       FROM woc_unleashed_emission_cap_log
      ORDER BY id DESC
      LIMIT $1`,
    [Math.min(Math.max(1, Math.floor(limit) || 50), 500)],
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    changedBy: row.changed_by,
    oldCapCopper: Number(row.old_cap_copper),
    newCapCopper: Number(row.new_cap_copper),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/** Whether crediting amountCopper more gross emission would exceed the
 *  currently configured cap. The primitive a future loot/quest/boss reward
 *  grant will call; not wired to any gameplay sink yet (see module header). */
export async function wouldExceedCap(db: Pool, amountCopper: number): Promise<boolean> {
  const state = await getEmissionState(db);
  return state.grossEmittedCopper + amountCopper > state.capCopper;
}

/** Record an off-chain sink (repair, marketplace fee, claim): decrements
 *  net_circulating_copper only, never gross_emitted_copper - the sink took
 *  $WOC OUT of circulation, it never un-mints what was already granted.
 *  Floored at 0 so a sink can never drive the counter negative (a defensive
 *  floor, not an expected path: every sink amount is validated non-negative
 *  by its own caller, e.g. src/sim/durability.ts's repairCostCopper). */
export async function recordSink(db: Pool, amountCopper: number): Promise<void> {
  if (!Number.isFinite(amountCopper) || amountCopper < 0) {
    throw new TypeError('amountCopper must be a non-negative finite number');
  }
  await db.query(
    `UPDATE woc_unleashed_emission_state
        SET net_circulating_copper = GREATEST(0, net_circulating_copper - $1),
            updated_at = now()
      WHERE id = 1`,
    [Math.floor(amountCopper)],
  );
}
