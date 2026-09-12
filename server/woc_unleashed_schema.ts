// Applies the WoC Unleashed additive schema modules (server/
// woc_unleashed_emission_db.ts, server/woc_unleashed_wallet_db.ts) at boot.
//
// Deliberately called from server/main.ts's boot sequence AFTER db.ts's
// ensureSchema(), rather than folded INTO ensureSchema like every other
// schema module: server/db.ts is a monolith-ratchet-capped file already
// sitting exactly at its line ceiling (tests/monolith_budget.test.ts), so a
// new schema registration there would exceed it, and the ratchet's own rule
// is extraction/an additive path, never a ceiling bump by a non-maintainer
// change. This module IS that additive path.
//
// Idempotent (CREATE TABLE/INDEX IF NOT EXISTS, an ON CONFLICT DO NOTHING
// seed insert) and serialized behind its OWN advisory lock key, distinct
// from db.ts's SCHEMA_ADVISORY_LOCK_KEY, so it never contends with the main
// boot lock and concurrent boots of the same realm can never race the DDL.

import type { Pool } from 'pg';
import { WOC_UNLEASHED_EMISSION_SCHEMA } from './woc_unleashed_emission_db';
import { WOC_UNLEASHED_RESERVE_SNAPSHOTS_SCHEMA } from './woc_unleashed_reserve_snapshot';
import { WOC_UNLEASHED_WALLET_SCHEMA } from './woc_unleashed_wallet_db';

// Arbitrary constant distinct from db.ts's SCHEMA_ADVISORY_LOCK_KEY and
// account_wealth_db.ts's ACCOUNT_WEALTH_SWEEP_LOCK_KEY.
const WOC_UNLEASHED_SCHEMA_LOCK_KEY = 0x574f_4355; // "WOCU"

export async function ensureWocUnleashedSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [WOC_UNLEASHED_SCHEMA_LOCK_KEY]);
    await client.query(WOC_UNLEASHED_EMISSION_SCHEMA);
    await client.query(WOC_UNLEASHED_WALLET_SCHEMA);
    await client.query(WOC_UNLEASHED_RESERVE_SNAPSHOTS_SCHEMA);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
