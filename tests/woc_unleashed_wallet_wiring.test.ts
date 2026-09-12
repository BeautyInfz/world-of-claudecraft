// The WoC Unleashed wallet panel hook composition (src/game/woc_unleashed_wallet_wiring.ts):
// turns the raw Api JSON responses into the typed WalletPanelSnapshot/series
// shapes wallet_panel_view.ts expects, tolerating a malformed or partial
// server payload (a missing field silently coerces to null/0/[] rather than
// throwing and blanking the whole panel), and delegates connect/disconnect to
// the existing wallet_balance/wallet_verify_request/net/wallet seams instead
// of duplicating their logic.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/net/online';
import type { WalletConnectionView } from '../src/ui/wallet_connection_view';

let connectionView: WalletConnectionView = {
  kind: 'disabled',
  enabled: false,
  linkedAddress: null,
  connectedAddress: null,
  balance: null,
  balanceVerified: false,
  action: 'none',
};
vi.mock('../src/ui/wallet_balance', () => ({
  walletConnectionView: () => connectionView,
}));

const verifyRequests: number[] = [];
vi.mock('../src/ui/wallet_verify_request', () => ({
  requestWalletVerify: () => {
    verifyRequests.push(1);
  },
}));

const disconnectCalls: number[] = [];
vi.mock('../src/net/wallet', () => ({
  disconnectWallet: async () => {
    disconnectCalls.push(1);
  },
}));

const { buildWalletPanelHooks } = await import('../src/game/woc_unleashed_wallet_wiring');

function fakeApi(overrides: Partial<Record<string, unknown>> = {}): Api {
  const responses: Record<string, unknown> = {
    wocUnleashedClaimStatus: {
      holdingThresholdWoc: 40,
      lastClaimAt: '2026-09-10T00:00:00.000Z',
      cooldownElapsed: false,
      totalClaimedCopper: 12000,
    },
    wocUnleashedOffChainBalance: {
      totalWoc: 250,
      characters: [
        { pid: 1, woc: 100 },
        { pid: 2, woc: 150 },
      ],
    },
    wocUnleashedReserve: { reserveWoc: 900000 },
    wocUnleashedCirculationSeries: {
      series: [{ day: '2026-09-10', inCopper: 500, outCopper: 200 }],
    },
    wocUnleashedOnchainFlowSeries: {
      series: [{ day: '2026-09-10', balanceWoc: 900000 }],
    },
    ...overrides,
  };
  return {
    wocUnleashedClaimStatus: async () => responses.wocUnleashedClaimStatus,
    wocUnleashedOffChainBalance: async () => responses.wocUnleashedOffChainBalance,
    wocUnleashedReserve: async () => responses.wocUnleashedReserve,
    wocUnleashedCirculationSeries: async () => responses.wocUnleashedCirculationSeries,
    wocUnleashedOnchainFlowSeries: async () => responses.wocUnleashedOnchainFlowSeries,
    wocUnleashedClaim: async (amountWoc: number) =>
      (responses.wocUnleashedClaim as (a: number) => unknown)?.(amountWoc) ?? {
        signature: 'sig-1',
        netWoc: amountWoc * 0.8,
      },
  } as unknown as Api;
}

describe('woc_unleashed_wallet_wiring: snapshot composition', () => {
  beforeEach(() => {
    connectionView = {
      kind: 'disabled',
      enabled: false,
      linkedAddress: null,
      connectedAddress: null,
      balance: null,
      balanceVerified: false,
      action: 'none',
    };
    verifyRequests.length = 0;
    disconnectCalls.length = 0;
  });

  it('assembles the snapshot from the three parallel Api calls', async () => {
    const hooks = buildWalletPanelHooks(fakeApi());
    const snap = await hooks.snapshot();
    expect(snap.holdingThresholdWoc).toBe(40);
    expect(snap.offChainTotalWoc).toBe(250);
    expect(snap.offChainCharacters).toEqual([
      { pid: 1, woc: 100 },
      { pid: 2, woc: 150 },
    ]);
    expect(snap.claimStatus).toEqual({
      lastClaimAt: '2026-09-10T00:00:00.000Z',
      cooldownElapsed: false,
      totalClaimedCopper: 12000,
    });
    expect(snap.reserveWoc).toBe(900000);
    expect(snap.connection).toBe(connectionView);
  });

  it('coerces a malformed payload to safe defaults instead of throwing', async () => {
    const hooks = buildWalletPanelHooks(
      fakeApi({
        wocUnleashedClaimStatus: {
          holdingThresholdWoc: 'nope',
          lastClaimAt: 9,
          cooldownElapsed: 'yes',
        },
        wocUnleashedOffChainBalance: {
          totalWoc: null,
          characters: [null, 'x', { pid: '1', woc: 'y' }, { pid: 2, woc: 5 }],
        },
        wocUnleashedReserve: {},
      }),
    );
    const snap = await hooks.snapshot();
    expect(snap.holdingThresholdWoc).toBeNull();
    expect(snap.offChainTotalWoc).toBeNull();
    // Non-object entries are dropped; a present-but-wrong-typed pid/woc falls back to 0.
    expect(snap.offChainCharacters).toEqual([
      { pid: 0, woc: 0 },
      { pid: 2, woc: 5 },
    ]);
    expect(snap.claimStatus).toEqual({
      lastClaimAt: null,
      cooldownElapsed: false,
      totalClaimedCopper: 0,
    });
    expect(snap.reserveWoc).toBeNull();
  });

  it('reads the live wallet connection view fresh on every snapshot', async () => {
    const hooks = buildWalletPanelHooks(fakeApi());
    expect((await hooks.snapshot()).connection.enabled).toBe(false);
    connectionView = {
      ...connectionView,
      kind: 'linked_connected',
      enabled: true,
      connectedAddress: 'Addr1',
    };
    expect((await hooks.snapshot()).connection.enabled).toBe(true);
  });
});

describe('woc_unleashed_wallet_wiring: series composition', () => {
  it('maps the circulation series rows and drops non-object entries', async () => {
    const hooks = buildWalletPanelHooks(
      fakeApi({
        wocUnleashedCirculationSeries: {
          series: [{ day: '2026-09-09', inCopper: 10, outCopper: 3 }, null, { day: '2026-09-10' }],
        },
      }),
    );
    expect(await hooks.circulationSeries()).toEqual([
      { day: '2026-09-09', inCopper: 10, outCopper: 3 },
      { day: '2026-09-10', inCopper: 0, outCopper: 0 },
    ]);
  });

  it('maps the on-chain flow series rows and tolerates a missing series field', async () => {
    const hooks = buildWalletPanelHooks(fakeApi({ wocUnleashedOnchainFlowSeries: {} }));
    expect(await hooks.onchainFlowSeries()).toEqual([]);
    const hooksWithRows = buildWalletPanelHooks(
      fakeApi({
        wocUnleashedOnchainFlowSeries: { series: [{ day: '2026-09-10', balanceWoc: 42 }] },
      }),
    );
    expect(await hooksWithRows.onchainFlowSeries()).toEqual([
      { day: '2026-09-10', balanceWoc: 42 },
    ]);
  });
});

describe('woc_unleashed_wallet_wiring: connect, disconnect, claim', () => {
  it('routes onConnect through requestWalletVerify', () => {
    const hooks = buildWalletPanelHooks(fakeApi());
    hooks.onConnect();
    expect(verifyRequests.length).toBe(1);
  });

  it('routes onDisconnect through the lazily loaded net/wallet module', async () => {
    const hooks = buildWalletPanelHooks(fakeApi());
    hooks.onDisconnect();
    await new Promise((r) => setTimeout(r, 0));
    expect(disconnectCalls.length).toBe(1);
  });

  it('resolves onClaim with the signature and net amount on success', async () => {
    const hooks = buildWalletPanelHooks(fakeApi());
    await expect(hooks.onClaim(10)).resolves.toEqual({ signature: 'sig-1', netWoc: 8 });
  });

  it('rejects onClaim when the server responds with an error field', async () => {
    const hooks = buildWalletPanelHooks(
      fakeApi({ wocUnleashedClaim: () => ({ error: 'holding gate not met' }) }),
    );
    await expect(hooks.onClaim(10)).rejects.toThrow('holding gate not met');
  });
});
