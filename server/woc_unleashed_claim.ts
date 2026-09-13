// The WoC Unleashed $WOC claim endpoint: converts off-chain balance into a
// real on-chain SPL transfer + burn. WoC Unleashed-exclusive (every request
// refuses with 404 when WOC_UNLEASHED is unset, matching how a Claudemoon
// deployment answers an unknown route).
//
// V1 SCOPE, flagged rather than silently narrowed: a claim draws only from
// the account's CURRENTLY ONLINE characters in this realm (their live,
// authoritative Sim balance, never a possibly-stale DB row). An account
// whose $WOC sits entirely on an offline alt must log into that character
// first. Draining offline characters too needs a locked, transactional
// direct-DB debit path (the online path can't reuse it, since a live
// session's next autosave would silently clobber a bare SQL UPDATE with its
// own in-memory value) - a real follow-up, not implemented here.
//
// Atomicity note: true two-phase commit across Postgres and Solana is not
// possible. The realistic contract this endpoint keeps is "no double-spend,
// no silently lost funds": the off-chain balance is debited from the LIVE
// character(s) BEFORE the on-chain transaction is sent; if the on-chain send
// fails or cannot be confirmed, the exact same amount is credited back to
// the exact same character(s) before the request returns an error. A crash
// between "on-chain confirmed" and "claim record written" is the one
// unguarded window (flagged, not solved, in this pass): the player keeps
// their on-chain funds either way, and the worst case is the 24h cooldown
// or the claimed-total audit undercounting by one claim, never a duplicate
// payout, since the off-chain debit already happened and is never reverted
// once the on-chain send confirms.

import { accountAndScopeForToken, moderationStatusForAccount, pool } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import { withBody } from './http/middleware/body';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { cachedWocBalance } from './woc_balance';
import { resolveWocUnleashed } from './woc_unleashed';
import {
  executeClaimTransaction,
  WOC_UNLEASHED_CLAIM_SOURCE_WALLET,
  wocMintDecimals,
  wocToBaseUnits,
} from './woc_unleashed_chain';
import { recordSink } from './woc_unleashed_emission_db';
import { currentHoldingThresholdWoc } from './woc_unleashed_price_gate';
import {
  claimCooldownElapsed,
  getClaimStatus,
  recordClaim,
  recordLedgerEvent,
} from './woc_unleashed_wallet_db';

// ---------------------------------------------------------------------------
// Auth (the createActiveGuard factory, not a 4th inline copy - see
// server/wallet.ts's own FOLLOW-UP comment on its three legacy copies).
// ---------------------------------------------------------------------------

const REAL_CLAIM_AUTH_DB: BearerActiveGuardDb = {
  accountAndScopeForToken,
  moderationStatusForAccount,
};
let claimAuthDb = REAL_CLAIM_AUTH_DB;
export function setWocUnleashedClaimAuthDbForTests(overrides: Partial<BearerActiveGuardDb>): void {
  claimAuthDb = { ...claimAuthDb, ...overrides };
}
export function resetWocUnleashedClaimAuthDbForTests(): void {
  claimAuthDb = REAL_CLAIM_AUTH_DB;
}
const activeGuard = createActiveGuard(() => claimAuthDb);

// ---------------------------------------------------------------------------
// Live-character runtime injection (server/main.ts wires this off liveGame()
// after the GameServer exists, the configureWocMarketRuntime shape).
// ---------------------------------------------------------------------------

export interface OnlineCharacterBalance {
  pid: number;
  unitsAvailable: number;
}

export interface WocUnleashedClaimRuntime {
  /** This account's characters currently online in THIS realm, with their
   *  LIVE (not DB-lagged) $WOC balance in copper-equivalent units, ordered
   *  balance descending (drain largest first). */
  onlineCharacterBalances(accountId: number): OnlineCharacterBalance[];
  /** Move `units` between the live balance and the claim (positive delta
   *  credits the player back on a refund, negative debits them). */
  adjustLivePid(pid: number, deltaUnits: number): void;
}

let claimRuntime: WocUnleashedClaimRuntime | null = null;
export function configureWocUnleashedClaimRuntime(rt: WocUnleashedClaimRuntime): void {
  claimRuntime = rt;
}
export function resetWocUnleashedClaimRuntimeForTests(): void {
  claimRuntime = null;
}

// ---------------------------------------------------------------------------
// Data/chain seam (the ad_spend.ts shape): real bundle, test-swappable.
// ---------------------------------------------------------------------------

const REAL_CLAIM_DEPS = {
  linkedWallet: async (accountId: number): Promise<string | null> => {
    const res = await pool.query('SELECT pubkey FROM wallet_links WHERE account_id = $1', [
      accountId,
    ]);
    return res.rows[0]?.pubkey ?? null;
  },
  getClaimStatus: (accountId: number) => getClaimStatus(pool, accountId),
  onChainBalance: (pubkey: string) => cachedWocBalance(pubkey, true),
  holdingThresholdWoc: (): number | null => currentHoldingThresholdWoc(),
  mintDecimals: () => wocMintDecimals(),
  executeClaim: executeClaimTransaction,
  recordClaim: (accountId: number, claimedUnits: number) =>
    recordClaim(pool, accountId, claimedUnits),
  recordLedgerEvent: (accountId: number, amountCopper: number) =>
    recordLedgerEvent(pool, { accountId, sourceSink: 'claim', amountCopper }),
  recordEmissionSink: (units: number) => recordSink(pool, units),
};
let claimDeps = REAL_CLAIM_DEPS;
export function setWocUnleashedClaimDepsForTests(overrides: Partial<typeof REAL_CLAIM_DEPS>): void {
  claimDeps = { ...claimDeps, ...overrides };
}
export function resetWocUnleashedClaimDepsForTests(): void {
  claimDeps = REAL_CLAIM_DEPS;
}

// $WOC <-> copper-equivalent units, the same 10000 rate every WoC Unleashed
// module shares (src/ui/woc_currency.ts copperToWocTokens, the emission db's
// COPPER_PER_WOC).
const UNITS_PER_WOC = 10000;

const fail = (ctx: Ctx, status: number, error: string): void => json(ctx.res, status, { error });

// Read live (never the frozen WOC_UNLEASHED module constant): the claim
// gate needs to be exercised per-request in tests without a process
// restart, the same conscious-exception shape server/http/config.ts
// documents for ALLOW_DEV_COMMANDS. resolveWocUnleashed is still the single
// source of truth for what counts as "on".
const wocUnleashedLive = (): boolean => resolveWocUnleashed(process.env.WOC_UNLEASHED);

/** Pick which online characters to drain for `unitsNeeded`, largest balance
 *  first, refusing (returning null) if the pool can't cover it. Pure so it
 *  has its own focused test. */
export function planDeduction(
  balances: readonly OnlineCharacterBalance[],
  unitsNeeded: number,
): { pid: number; units: number }[] | null {
  const sorted = [...balances].sort((a, b) => b.unitsAvailable - a.unitsAvailable);
  let remaining = unitsNeeded;
  const plan: { pid: number; units: number }[] = [];
  for (const c of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, c.unitsAvailable);
    if (take <= 0) continue;
    plan.push({ pid: c.pid, units: take });
    remaining -= take;
  }
  return remaining <= 0 ? plan : null;
}

async function claimHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  if (!claimRuntime) return fail(ctx, 503, 'claim service not ready');

  const accountId = ctxAccountId(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const amountWoc = body.amountWoc;
  if (typeof amountWoc !== 'number' || !Number.isFinite(amountWoc) || amountWoc <= 0) {
    return fail(ctx, 400, 'amountWoc must be a positive number');
  }

  const wallet = await claimDeps.linkedWallet(accountId);
  if (!wallet) return fail(ctx, 400, 'no linked wallet');

  const status = await claimDeps.getClaimStatus(accountId);
  if (!claimCooldownElapsed(status.lastClaimAt, Date.now())) {
    return fail(ctx, 429, 'claim cooldown has not elapsed');
  }

  const threshold = claimDeps.holdingThresholdWoc();
  if (threshold === null) return fail(ctx, 503, 'holding gate not ready');
  const heldWoc = await claimDeps.onChainBalance(wallet);
  if (heldWoc === null || heldWoc < threshold) {
    return fail(ctx, 403, `must hold at least ${threshold} $WOC to claim`);
  }

  const unitsRequested = Math.floor(amountWoc * UNITS_PER_WOC);
  const balances = claimRuntime.onlineCharacterBalances(accountId);
  const plan = planDeduction(balances, unitsRequested);
  if (!plan) return fail(ctx, 400, 'insufficient available balance on online characters');

  // Debit BEFORE the on-chain send (see the module header's atomicity note):
  // a failed/unconfirmed send refunds this exact plan before returning.
  for (const step of plan) claimRuntime.adjustLivePid(step.pid, -step.units);

  const decimals = await claimDeps.mintDecimals();
  const grossBaseUnits = wocToBaseUnits(unitsRequested / UNITS_PER_WOC, decimals);

  try {
    const result = await claimDeps.executeClaim({
      destinationOwner: wallet,
      grossBaseUnits,
    });
    await claimDeps.recordClaim(accountId, unitsRequested);
    await claimDeps.recordLedgerEvent(accountId, -unitsRequested);
    await claimDeps.recordEmissionSink(unitsRequested);
    return json(ctx.res, 200, {
      signature: result.signature,
      grossWoc: unitsRequested / UNITS_PER_WOC,
      netWoc: Number(result.transferredBaseUnits) / 10 ** decimals,
      treasuryWoc: Number(result.treasuryBaseUnits) / 10 ** decimals,
      burnedWoc: Number(result.burnedBaseUnits) / 10 ** decimals,
      claimSourceWallet: WOC_UNLEASHED_CLAIM_SOURCE_WALLET,
    });
  } catch (err) {
    for (const step of plan) claimRuntime.adjustLivePid(step.pid, step.units);
    return fail(ctx, 502, err instanceof Error ? err.message : 'on-chain claim failed');
  }
}

async function claimStatusHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  const accountId = ctxAccountId(ctx);
  const status = await claimDeps.getClaimStatus(accountId);
  const elapsed = claimCooldownElapsed(status.lastClaimAt, Date.now());
  return json(ctx.res, 200, {
    lastClaimAt: status.lastClaimAt,
    totalClaimedCopper: status.totalClaimedCopper,
    cooldownElapsed: elapsed,
    holdingThresholdWoc: claimDeps.holdingThresholdWoc(),
  });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/woc-unleashed/claim-status',
    surface: 'api',
    middleware: [activeGuard],
    handler: claimStatusHandler,
  },
  {
    method: 'POST',
    path: '/api/woc-unleashed/claim',
    surface: 'api',
    middleware: [activeGuard, withBody()],
    handler: claimHandler,
  },
];
