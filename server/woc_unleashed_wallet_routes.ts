// The WoC Unleashed wallet panel's read-only data: the account's off-chain
// balance (item 2 of the spec), the claim wallet reserve (item 5, public,
// no wallet connection required), and the two circulation charts (item 6).
// WoC Unleashed-exclusive; every route 404s when WOC_UNLEASHED is unset,
// matching server/woc_unleashed_claim.ts's live-read gate.

import { accountAndScopeForToken, moderationStatusForAccount, pool } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { resolveWocUnleashed } from './woc_unleashed';
import { claimWalletReserve, WOC_UNLEASHED_CLAIM_SOURCE_WALLET } from './woc_unleashed_chain';
import type { WocUnleashedClaimRuntime } from './woc_unleashed_claim';
import { latestReserveSnapshot, onChainFlowSeries } from './woc_unleashed_reserve_snapshot';
import { ledgerEventSeries } from './woc_unleashed_wallet_db';

const REAL_AUTH_DB: BearerActiveGuardDb = { accountAndScopeForToken, moderationStatusForAccount };
let authDb = REAL_AUTH_DB;
export function setWocUnleashedWalletRoutesAuthDbForTests(
  overrides: Partial<BearerActiveGuardDb>,
): void {
  authDb = { ...authDb, ...overrides };
}
export function resetWocUnleashedWalletRoutesAuthDbForTests(): void {
  authDb = REAL_AUTH_DB;
}
const activeGuard = createActiveGuard(() => authDb);

// The SAME live-character runtime the claim route uses (server/main.ts wires
// one instance to both configureWocUnleashedClaimRuntime and this setter).
let runtime: WocUnleashedClaimRuntime | null = null;
export function configureWocUnleashedWalletRoutesRuntime(rt: WocUnleashedClaimRuntime): void {
  runtime = rt;
}
export function resetWocUnleashedWalletRoutesRuntimeForTests(): void {
  runtime = null;
}

const REAL_DEPS = {
  reserveFromChain: () => claimWalletReserve(WOC_UNLEASHED_CLAIM_SOURCE_WALLET),
  latestReserveSnapshot: () => latestReserveSnapshot(pool),
  circulationSeries: (days: number) => ledgerEventSeries(pool, days),
  onChainFlowSeries: (days: number) => onChainFlowSeries(pool, days),
};
let deps = REAL_DEPS;
export function setWocUnleashedWalletRoutesDepsForTests(
  overrides: Partial<typeof REAL_DEPS>,
): void {
  deps = { ...deps, ...overrides };
}
export function resetWocUnleashedWalletRoutesDepsForTests(): void {
  deps = REAL_DEPS;
}

const UNITS_PER_WOC = 10000;
const fail = (ctx: Ctx, status: number, error: string): void => json(ctx.res, status, { error });
const wocUnleashedLive = (): boolean => resolveWocUnleashed(process.env.WOC_UNLEASHED);

function daysParam(ctx: Ctx): number {
  const raw = ctx.url.searchParams.get('days');
  const n = raw ? Number(raw) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** GET /api/woc-unleashed/off-chain-balance: the account's spendable $WOC,
 *  summed across its currently-online characters in this realm (see
 *  server/woc_unleashed_claim.ts's own V1 scope note: an offline alt's
 *  balance is not yet included here either). */
async function offChainBalanceHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  if (!runtime) return fail(ctx, 503, 'wallet service not ready');
  const accountId = ctxAccountId(ctx);
  const balances = runtime.onlineCharacterBalances(accountId);
  const totalWoc = balances.reduce((sum, c) => sum + c.unitsAvailable, 0) / UNITS_PER_WOC;
  return json(ctx.res, 200, {
    totalWoc,
    characters: balances.map((c) => ({ pid: c.pid, woc: c.unitsAvailable / UNITS_PER_WOC })),
  });
}

/** GET /api/woc-unleashed/reserve: the claim source wallet's own remaining
 *  $WOC, public (no auth) per the spec. Prefers the cached snapshot (fast,
 *  no RPC on every panel open); falls back to a live RPC read when no
 *  snapshot has ever been taken yet. */
async function reserveHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  const snapshot = await deps.latestReserveSnapshot();
  if (snapshot) {
    return json(ctx.res, 200, { reserveWoc: snapshot.balanceWoc, at: snapshot.createdAt });
  }
  const live = await deps.reserveFromChain();
  return json(ctx.res, 200, { reserveWoc: live ?? null, at: null });
}

/** GET /api/woc-unleashed/circulation-series: the in-game circulation chart
 *  (loot/quest/boss in vs. repair/fee/claim out), public - off-chain ledger
 *  totals reveal nothing about any individual account. */
async function circulationSeriesHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  const series = await deps.circulationSeries(daysParam(ctx));
  return json(ctx.res, 200, { series });
}

/** GET /api/woc-unleashed/onchain-flow-series: the claim wallet's own
 *  balance over time, public (the wallet's balance is already public
 *  on-chain data). */
async function onChainFlowSeriesHandler(ctx: Ctx): Promise<void> {
  if (!wocUnleashedLive()) return fail(ctx, 404, 'unknown endpoint');
  const series = await deps.onChainFlowSeries(daysParam(ctx));
  return json(ctx.res, 200, { series });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/woc-unleashed/off-chain-balance',
    surface: 'api',
    middleware: [activeGuard],
    handler: offChainBalanceHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-unleashed/reserve',
    surface: 'api',
    middleware: [],
    handler: reserveHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-unleashed/circulation-series',
    surface: 'api',
    middleware: [],
    handler: circulationSeriesHandler,
  },
  {
    method: 'GET',
    path: '/api/woc-unleashed/onchain-flow-series',
    surface: 'api',
    middleware: [],
    handler: onChainFlowSeriesHandler,
  },
];
