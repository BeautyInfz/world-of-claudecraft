// The WoC Unleashed wallet panel's read-only endpoints
// (server/woc_unleashed_wallet_routes.ts): auth, the WOC_UNLEASHED live gate,
// and the runtime/deps seams, all faked - no Postgres.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureWocUnleashedWalletRoutesRuntime,
  resetWocUnleashedWalletRoutesAuthDbForTests,
  resetWocUnleashedWalletRoutesDepsForTests,
  resetWocUnleashedWalletRoutesRuntimeForTests,
  routes,
  setWocUnleashedWalletRoutesAuthDbForTests,
  setWocUnleashedWalletRoutesDepsForTests,
} from '../../server/woc_unleashed_wallet_routes';
import { fakeCtx } from './helpers';

const TOKEN = 'a'.repeat(64);

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

async function runRoute(
  method: 'GET',
  path: string,
  opts: { url?: string; token?: string | null } = {},
): Promise<{ status: number; body: unknown }> {
  const route = handlerFor(method, path);
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    headers: opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? TOKEN}` },
  });
  const chain = [...(route.middleware ?? [])];
  let i = 0;
  const next = async (): Promise<void> => {
    const mw = chain[i++];
    if (mw) await mw(ctx, next);
    else await route.handler(ctx);
  };
  await next();
  const res = ctx.res as unknown as {
    statusCode: number;
    body?: unknown;
    payload?: unknown;
    written?: string;
  };
  const raw =
    (res as { written?: string }).written ??
    (res as { payload?: unknown }).payload ??
    (res as { body?: unknown }).body;
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { status: res.statusCode, body };
}

describe('woc-unleashed wallet routes', () => {
  const savedWocUnleashed = process.env.WOC_UNLEASHED;

  beforeEach(() => {
    process.env.WOC_UNLEASHED = '1';
    setWocUnleashedWalletRoutesAuthDbForTests({
      accountAndScopeForToken: async (token: string) =>
        token === TOKEN ? { accountId: 7, scope: 'full' as const } : null,
      moderationStatusForAccount: async () => ({ locked: false }) as never,
    });
    configureWocUnleashedWalletRoutesRuntime({
      onlineCharacterBalances: () => [
        { pid: 1, unitsAvailable: 20_000 },
        { pid: 2, unitsAvailable: 5_000 },
      ],
      adjustLivePid: () => {},
    });
    setWocUnleashedWalletRoutesDepsForTests({
      reserveFromChain: async () => 999_000,
      latestReserveSnapshot: async () => null,
      circulationSeries: async () => [{ day: '2026-09-01', inCopper: 100, outCopper: 20 }],
      onChainFlowSeries: async () => [{ day: '2026-09-01', balanceWoc: 999_000, deltaWoc: null }],
      emissionState: async () => ({
        capCopper: 1_000_000 * 10_000,
        grossEmittedCopper: 250_000 * 10_000,
        netCirculatingCopper: 180_000 * 10_000,
        updatedAt: '2026-09-01T00:00:00Z',
      }),
    });
  });

  afterEach(() => {
    resetWocUnleashedWalletRoutesAuthDbForTests();
    resetWocUnleashedWalletRoutesRuntimeForTests();
    resetWocUnleashedWalletRoutesDepsForTests();
    if (savedWocUnleashed === undefined) delete process.env.WOC_UNLEASHED;
    else process.env.WOC_UNLEASHED = savedWocUnleashed;
  });

  it('404s every route when WOC_UNLEASHED is unset', async () => {
    delete process.env.WOC_UNLEASHED;
    expect((await runRoute('GET', '/api/woc-unleashed/off-chain-balance')).status).toBe(404);
    expect((await runRoute('GET', '/api/woc-unleashed/reserve')).status).toBe(404);
    expect((await runRoute('GET', '/api/woc-unleashed/circulation-series')).status).toBe(404);
    expect((await runRoute('GET', '/api/woc-unleashed/onchain-flow-series')).status).toBe(404);
    expect((await runRoute('GET', '/api/woc-unleashed/circulating-supply')).status).toBe(404);
  });

  it('off-chain-balance requires auth and sums online characters in $WOC (not raw units)', async () => {
    const unauth = await runRoute('GET', '/api/woc-unleashed/off-chain-balance', { token: null });
    expect(unauth.status).toBe(401);
    const out = await runRoute('GET', '/api/woc-unleashed/off-chain-balance');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ totalWoc: 2.5 });
  });

  it('reserve falls back to a live RPC read when no snapshot exists yet, no auth required', async () => {
    const out = await runRoute('GET', '/api/woc-unleashed/reserve', { token: null });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ reserveWoc: 999_000, at: null });
  });

  it('reserve prefers the cached snapshot over a live RPC read', async () => {
    setWocUnleashedWalletRoutesDepsForTests({
      latestReserveSnapshot: async () => ({ balanceWoc: 500, createdAt: '2026-09-01T00:00:00Z' }),
    });
    const out = await runRoute('GET', '/api/woc-unleashed/reserve', { token: null });
    expect(out.body).toMatchObject({ reserveWoc: 500 });
  });

  it('circulation-series and onchain-flow-series need no auth', async () => {
    const a = await runRoute('GET', '/api/woc-unleashed/circulation-series', { token: null });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ series: [{ day: '2026-09-01' }] });
    const b = await runRoute('GET', '/api/woc-unleashed/onchain-flow-series', { token: null });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ series: [{ day: '2026-09-01' }] });
  });

  it('circulating-supply reports the economy-wide totals in $WOC (not copper), no auth required', async () => {
    const out = await runRoute('GET', '/api/woc-unleashed/circulating-supply', { token: null });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      netCirculatingWoc: 180_000,
      grossEmittedWoc: 250_000,
      capWoc: 1_000_000,
      at: '2026-09-01T00:00:00Z',
    });
  });
});
