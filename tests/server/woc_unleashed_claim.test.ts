// The WoC Unleashed claim endpoints (server/woc_unleashed_claim.ts): gate
// order, the online-characters deduction plan, and the debit/refund
// atomicity contract, all exercised with fake deps/runtime - no Postgres, no
// Solana RPC (the ad_spend.test.ts idiom, extended with the claim runtime
// seam).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureWocUnleashedClaimRuntime,
  planDeduction,
  resetWocUnleashedClaimAuthDbForTests,
  resetWocUnleashedClaimDepsForTests,
  resetWocUnleashedClaimRuntimeForTests,
  routes,
  setWocUnleashedClaimAuthDbForTests,
  setWocUnleashedClaimDepsForTests,
  type WocUnleashedClaimRuntime,
} from '../../server/woc_unleashed_claim';
import { fakeCtx } from './helpers';

const ADMIN_TOKEN = 'a'.repeat(64); // reused as a plain account bearer here

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

async function runRoute(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const route = handlerFor(method, path);
  const ctx = fakeCtx({
    method,
    url: path,
    body: opts.body,
    headers: {
      authorization: `Bearer ${opts.token ?? ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
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

describe('planDeduction', () => {
  it('drains the largest balance first', () => {
    const plan = planDeduction(
      [
        { pid: 1, unitsAvailable: 100 },
        { pid: 2, unitsAvailable: 500 },
        { pid: 3, unitsAvailable: 50 },
      ],
      300,
    );
    expect(plan).toEqual([{ pid: 2, units: 300 }]);
  });

  it('spans multiple characters when one is not enough', () => {
    const plan = planDeduction(
      [
        { pid: 1, unitsAvailable: 100 },
        { pid: 2, unitsAvailable: 50 },
      ],
      120,
    );
    expect(plan).toEqual([
      { pid: 1, units: 100 },
      { pid: 2, units: 20 },
    ]);
  });

  it('returns null when the pool cannot cover the requested amount', () => {
    const plan = planDeduction([{ pid: 1, unitsAvailable: 10 }], 20);
    expect(plan).toBeNull();
  });

  it('returns an empty plan (not null) for a zero request', () => {
    expect(planDeduction([{ pid: 1, unitsAvailable: 10 }], 0)).toEqual([]);
  });
});

describe('claim routes', () => {
  const runtime: WocUnleashedClaimRuntime = {
    onlineCharacterBalances: vi.fn(() => [{ pid: 1, unitsAvailable: 1_000_000 }]),
    adjustLivePid: vi.fn(),
  };

  const savedWocUnleashed = process.env.WOC_UNLEASHED;

  beforeEach(() => {
    process.env.WOC_UNLEASHED = '1';
    setWocUnleashedClaimAuthDbForTests({
      accountAndScopeForToken: async (token: string) =>
        token === ADMIN_TOKEN ? { accountId: 7, scope: 'full' as const } : null,
      moderationStatusForAccount: async () => ({ locked: false }) as never,
    });
    configureWocUnleashedClaimRuntime(runtime);
    setWocUnleashedClaimDepsForTests({
      linkedWallet: async () => 'FakeWallet1111111111111111111111111111111',
      getClaimStatus: async () => ({
        accountId: 7,
        lastClaimAt: null,
        totalClaimedCopper: 0,
      }),
      onChainBalance: async () => 1000,
      holdingThresholdWoc: () => 40,
      mintDecimals: async () => 6,
      executeClaim: async () => ({
        signature: 'fakeSig',
        transferredBaseUnits: 800_000n,
        treasuryBaseUnits: 100_000n,
        burnedBaseUnits: 100_000n,
      }),
      recordClaim: async () => {},
      recordLedgerEvent: async () => {},
      recordEmissionSink: async () => {},
    });
  });

  afterEach(() => {
    resetWocUnleashedClaimAuthDbForTests();
    resetWocUnleashedClaimRuntimeForTests();
    resetWocUnleashedClaimDepsForTests();
    if (savedWocUnleashed === undefined) delete process.env.WOC_UNLEASHED;
    else process.env.WOC_UNLEASHED = savedWocUnleashed;
    vi.clearAllMocks();
  });

  it('answers 404 (unknown endpoint) when WOC_UNLEASHED is unset, matching Claudemoon', async () => {
    delete process.env.WOC_UNLEASHED;
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(404);
  });

  it('rejects an unauthenticated request', async () => {
    const out = await runRoute('POST', '/api/woc-unleashed/claim', {
      token: 'f'.repeat(64),
      body: { amountWoc: 1 },
    });
    expect(out.status).toBe(401);
  });

  it('rejects a missing/invalid amount before touching deps', async () => {
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: {} });
    expect(out.status).toBe(400);
    const negative = await runRoute('POST', '/api/woc-unleashed/claim', {
      body: { amountWoc: -5 },
    });
    expect(negative.status).toBe(400);
  });

  it('rejects when no wallet is linked', async () => {
    setWocUnleashedClaimDepsForTests({ linkedWallet: async () => null });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: expect.stringContaining('wallet') });
  });

  it('rejects when the 24h cooldown has not elapsed', async () => {
    setWocUnleashedClaimDepsForTests({
      getClaimStatus: async () => ({
        accountId: 7,
        lastClaimAt: new Date().toISOString(),
        totalClaimedCopper: 0,
      }),
    });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(429);
  });

  it('rejects when the on-chain hold is below the threshold', async () => {
    setWocUnleashedClaimDepsForTests({ onChainBalance: async () => 5 });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(403);
  });

  it('rejects when the holding threshold has never been refreshed (fail-closed)', async () => {
    setWocUnleashedClaimDepsForTests({ holdingThresholdWoc: () => null });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(503);
  });

  it('rejects when the online balance pool cannot cover the amount', async () => {
    (runtime.onlineCharacterBalances as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { pid: 1, unitsAvailable: 10 },
    ]);
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1000 } });
    expect(out.status).toBe(400);
  });

  it('debits before sending, and refunds on an on-chain failure', async () => {
    setWocUnleashedClaimDepsForTests({
      executeClaim: async () => {
        throw new Error('rpc timeout');
      },
    });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(502);
    // Debited once (before the send), refunded once (after the failure):
    // net zero, never a silent loss.
    expect(runtime.adjustLivePid).toHaveBeenCalledTimes(2);
    expect(runtime.adjustLivePid).toHaveBeenNthCalledWith(1, 1, -10_000);
    expect(runtime.adjustLivePid).toHaveBeenNthCalledWith(2, 1, 10_000);
  });

  it('succeeds end to end: debits, sends, records the claim/ledger/emission sink', async () => {
    const recordClaim = vi.fn(async () => {});
    const recordLedgerEvent = vi.fn(async () => {});
    const recordEmissionSink = vi.fn(async () => {});
    setWocUnleashedClaimDepsForTests({ recordClaim, recordLedgerEvent, recordEmissionSink });
    const out = await runRoute('POST', '/api/woc-unleashed/claim', { body: { amountWoc: 1 } });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ signature: 'fakeSig' });
    expect(runtime.adjustLivePid).toHaveBeenCalledTimes(1);
    expect(runtime.adjustLivePid).toHaveBeenCalledWith(1, -10_000);
    expect(recordClaim).toHaveBeenCalledWith(7, 10_000);
    expect(recordLedgerEvent).toHaveBeenCalledWith(7, -10_000);
    expect(recordEmissionSink).toHaveBeenCalledWith(10_000);
  });

  it('claim-status reports cooldown and threshold without requiring a linked wallet', async () => {
    const out = await runRoute('GET', '/api/woc-unleashed/claim-status');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ cooldownElapsed: true, holdingThresholdWoc: 40 });
  });
});
