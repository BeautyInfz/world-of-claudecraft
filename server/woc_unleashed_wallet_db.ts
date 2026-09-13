// SQL boundary for the WoC Unleashed account-level off-chain $WOC ledger (the
// *_db.ts convention). WoC Unleashed-exclusive: nothing here is called unless
// the calling code has already checked WOC_UNLEASHED (server/woc_unleashed.ts).
//
// Three responsibilities, deliberately kept in one module since they share
// the same account-scoped shape:
//
//   1. offChainWocBalance: the player's spendable $WOC balance, POOLED ACROSS
//      ALL OF THAT ACCOUNT'S CHARACTERS. Read LIVE (SUM over characters.state,
//      not materialized) rather than following account_wealth's materialized-
//      sweep precedent: this is a single account's own on-demand wallet-panel
//      read, not a sortable admin list, so the heavy-scan cost that
//      justifies materialization there does not apply here, and a live read
//      can never drift stale between a purchase/loot event and the panel
//      opening. CRITICALLY, this is scoped `WHERE realm = $realm` (the
//      calling process's OWN realm, server/realm.ts's REALM): unlike
//      account_wealth (which deliberately pools every realm for admin
//      oversight), a WoC Unleashed claim must never be able to pull in
//      Claudemoon (or any other realm's) copper. The caller passes REALM
//      explicitly rather than this module importing it, so a unit test can
//      exercise the scoping without module-load realm.ts side effects.
//
//   2. Claim cooldown + audit (woc_unleashed_claims): one row per account,
//      last_claim_at + a running total. The claim flow itself (the atomic
//      on-chain transfer/burn) is NOT implemented here (a later slice); this
//      module only tracks the timestamp and total the cooldown/audit need.
//
//   3. woc_unleashed_ledger_events: the append-only time-series feed for the
//      wallet panel's "in-game circulation" chart (every loot/quest/boss
//      grant and every repair/marketplace-fee/claim sink writes one row).
//
// KNOWN GAP, flagged rather than silently deferred: woc_unleashed_ledger_events
// grows without bound and is NOT YET registered with the retention sweep
// (server/retention_sweep.ts). Wiring it in is a follow-up before this ships
// to production; listLedgerEventSeries is LIMIT-bounded in the meantime so an
// unbounded table cannot yet break a read.

import type { Pool } from 'pg';

export const WOC_UNLEASHED_WALLET_SCHEMA = `
CREATE TABLE IF NOT EXISTS woc_unleashed_claims (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_claim_at TIMESTAMPTZ,
  total_claimed_copper BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT woc_unleashed_claims_nonnegative CHECK (total_claimed_copper >= 0)
);

CREATE TABLE IF NOT EXISTS woc_unleashed_ledger_events (
  id BIGSERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT,
  source_sink TEXT NOT NULL,
  amount_copper BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_unleashed_ledger_events_created_at
  ON woc_unleashed_ledger_events (created_at);
CREATE INDEX IF NOT EXISTS woc_unleashed_ledger_events_account
  ON woc_unleashed_ledger_events (account_id, created_at);
`;

// The closed vocabulary for ledger event sources/sinks. 'loot' | 'quest' |
// 'boss' are emission (amount_copper > 0); 'repair' | 'marketplace_fee' |
// 'claim' are sinks (amount_copper < 0). Enforced in Node (recordLedgerEvent),
// not a CHECK constraint, so a future source/sink can be added without a
// migration.
export const LEDGER_SOURCES = ['loot', 'quest', 'boss'] as const;
export const LEDGER_SINKS = ['repair', 'marketplace_fee', 'claim'] as const;
export type LedgerSourceSink = (typeof LEDGER_SOURCES)[number] | (typeof LEDGER_SINKS)[number];

export interface AccountCharacterBalance {
  characterId: number;
  name: string;
  unleashedBalanceUnits: number;
}

export interface OffChainWocBalance {
  accountId: number;
  totalWocBalanceUnits: number;
  characters: AccountCharacterBalance[];
}

/** The account's spendable $WOC balance, summed LIVE across every character
 *  on `realm` (see the module header for why this must be realm-scoped and
 *  why it is live rather than materialized). Reads `state.unleashedBalance`
 *  (src/sim/character_state.ts CharacterState.unleashedBalance) - the genuinely
 *  separate $WOC ledger a WoC Unleashed character's save writes, NEVER
 *  `state.copper` (Claudemoon's field, always 0/absent on a WoC Unleashed
 *  save; see src/sim/unleashed_currency_binding.ts). "Units" matches the sim's own
 *  storage granularity (the same integer precision copper used, 10000 units
 *  = 1 $WOC token = the old "1 gold"); callers doing the $WOC token
 *  conversion should reuse copperToWocTokens's rate (src/ui/woc_currency.ts)
 *  rather than re-deriving 10000. */
export async function offChainWocBalance(
  db: Pool,
  accountId: number,
  realm: string,
): Promise<OffChainWocBalance> {
  const res = await db.query(
    `SELECT id, name, COALESCE((state->>'unleashedBalance')::bigint, 0) AS unleashed_balance
       FROM characters
      WHERE account_id = $1 AND realm = $2
      ORDER BY unleashed_balance DESC, id`,
    [accountId, realm],
  );
  const characters: AccountCharacterBalance[] = res.rows.map((row) => ({
    characterId: Number(row.id),
    name: row.name,
    unleashedBalanceUnits: Number(row.unleashed_balance),
  }));
  return {
    accountId,
    totalWocBalanceUnits: characters.reduce((sum, c) => sum + c.unleashedBalanceUnits, 0),
    characters,
  };
}

export interface ClaimStatus {
  accountId: number;
  lastClaimAt: string | null;
  totalClaimedCopper: number;
}

/** The account's claim cooldown state. A never-claimed account (no row) reads
 *  as lastClaimAt: null, totalClaimedCopper: 0 - eligible by cooldown (the
 *  $40-hold gate is a separate, live on-chain check, not tracked here). */
export async function getClaimStatus(db: Pool, accountId: number): Promise<ClaimStatus> {
  const res = await db.query(
    `SELECT last_claim_at, total_claimed_copper
       FROM woc_unleashed_claims WHERE account_id = $1`,
    [accountId],
  );
  const row = res.rows[0];
  return {
    accountId,
    lastClaimAt: row ? (row.last_claim_at?.toISOString?.() ?? row.last_claim_at) : null,
    totalClaimedCopper: row ? Number(row.total_claimed_copper) : 0,
  };
}

export const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Record a successful claim: stamps last_claim_at to now and adds
 *  claimedUnits to the running total (upserting the row on a first claim).
 *  Called AFTER the on-chain transaction has confirmed (server/
 *  woc_unleashed_claim.ts); this function only touches the cooldown/audit
 *  row, never the off-chain balance itself (that debit already happened
 *  against the live character(s) before the on-chain send). */
export async function recordClaim(
  db: Pool,
  accountId: number,
  claimedUnits: number,
): Promise<void> {
  if (!Number.isFinite(claimedUnits) || claimedUnits < 0) {
    throw new TypeError('claimedUnits must be a non-negative finite number');
  }
  await db.query(
    `INSERT INTO woc_unleashed_claims (account_id, last_claim_at, total_claimed_copper)
     VALUES ($1, now(), $2)
     ON CONFLICT (account_id) DO UPDATE SET
       last_claim_at = now(),
       total_claimed_copper = woc_unleashed_claims.total_claimed_copper + EXCLUDED.total_claimed_copper,
       updated_at = now()`,
    [accountId, Math.floor(claimedUnits)],
  );
}

/** Pure cooldown check: given the last claim's ISO timestamp (or null for
 *  never-claimed) and the current time, is another claim allowed now? Kept
 *  pure and exported so both the future claim-flow handler and its tests can
 *  reuse the exact same rule without re-deriving it. */
export function claimCooldownElapsed(lastClaimAt: string | null, nowMs: number): boolean {
  if (lastClaimAt === null) return true;
  const last = Date.parse(lastClaimAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= CLAIM_COOLDOWN_MS;
}

function validSourceSink(value: string): LedgerSourceSink {
  if (
    (LEDGER_SOURCES as readonly string[]).includes(value) ||
    (LEDGER_SINKS as readonly string[]).includes(value)
  ) {
    return value as LedgerSourceSink;
  }
  throw new TypeError(
    `sourceSink must be one of ${[...LEDGER_SOURCES, ...LEDGER_SINKS].join(', ')}`,
  );
}

export interface RecordLedgerEventInput {
  accountId: number;
  characterId?: number;
  sourceSink: LedgerSourceSink;
  amountCopper: number;
}

/** Append one ledger event. Sources ('loot' | 'quest' | 'boss') must carry a
 *  positive amount; sinks ('repair' | 'marketplace_fee' | 'claim') must carry
 *  a negative amount, so the circulation chart's in/out split (SUM FILTER on
 *  the sign) can never be fed a mis-signed row. */
export async function recordLedgerEvent(db: Pool, input: RecordLedgerEventInput): Promise<void> {
  const sourceSink = validSourceSink(input.sourceSink);
  const isSource = (LEDGER_SOURCES as readonly string[]).includes(sourceSink);
  if (typeof input.amountCopper !== 'number' || !Number.isFinite(input.amountCopper)) {
    throw new TypeError('amountCopper must be a finite number');
  }
  if (isSource && input.amountCopper <= 0) {
    throw new TypeError(`amountCopper must be positive for source "${sourceSink}"`);
  }
  if (!isSource && input.amountCopper >= 0) {
    throw new TypeError(`amountCopper must be negative for sink "${sourceSink}"`);
  }
  await db.query(
    `INSERT INTO woc_unleashed_ledger_events (account_id, character_id, source_sink, amount_copper)
     VALUES ($1, $2, $3, $4)`,
    [input.accountId, input.characterId ?? null, sourceSink, input.amountCopper],
  );
}

export interface LedgerDayBucket {
  day: string;
  inCopper: number;
  outCopper: number;
}

const MAX_LEDGER_SERIES_DAYS = 365;

/** Daily in/out buckets for the circulation chart, newest-day-last (chart-
 *  ready order), bounded to MAX_LEDGER_SERIES_DAYS so an unbounded table (see
 *  the module header's known gap) cannot yet blow up this read. */
export async function ledgerEventSeries(db: Pool, days: number): Promise<LedgerDayBucket[]> {
  const window = Math.min(MAX_LEDGER_SERIES_DAYS, Math.max(1, Math.floor(days) || 30));
  const res = await db.query(
    `SELECT date_trunc('day', created_at)::date AS day,
            COALESCE(sum(amount_copper) FILTER (WHERE amount_copper > 0), 0)::bigint AS in_copper,
            COALESCE(-sum(amount_copper) FILTER (WHERE amount_copper < 0), 0)::bigint AS out_copper
       FROM woc_unleashed_ledger_events
      WHERE created_at >= now() - ($1::int * INTERVAL '1 day')
      GROUP BY day
      ORDER BY day ASC`,
    [window],
  );
  return res.rows.map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
    inCopper: Number(row.in_copper),
    outCopper: Number(row.out_copper),
  }));
}
