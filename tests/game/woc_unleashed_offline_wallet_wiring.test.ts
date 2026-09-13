// The "Unleashed Offline" wallet panel hooks (src/game/woc_unleashed_offline_wallet_wiring.ts),
// exercised through a real Sim rather than a fake: regression coverage for a
// real bug where the in-game balance skipped the copper -> $WOC conversion
// and showed 10000x the player's actual holding (100 $WOC displayed as
// 1,000,000 $WOC).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ui/wallet_balance', () => ({
  walletConnectionView: () => ({
    kind: 'disabled',
    enabled: false,
    linkedAddress: null,
    connectedAddress: null,
    balance: null,
    balanceVerified: false,
    action: 'none',
  }),
}));

const { buildOfflineWalletPanelHooks } = await import(
  '../../src/game/woc_unleashed_offline_wallet_wiring'
);
const { Sim } = await import('../../src/sim/sim');

describe('buildOfflineWalletPanelHooks: in-game balance conversion', () => {
  it('reports the off-chain total in $WOC, not raw copper units', async () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'A');
    const meta = (sim as unknown as { players: Map<number, { copper: number }> }).players.get(pid)!;
    // 100 $WOC of gameplay income, in copper units (1 $WOC = 10000 copper).
    meta.copper += 100 * 10_000;

    const hooks = buildOfflineWalletPanelHooks(sim);
    const snap = await hooks.snapshot();

    expect(snap.offChainTotalWoc).toBe(100);
    expect(snap.offChainCharacters).toEqual([{ pid: sim.playerId, woc: 100 }]);
  });

  it('reports 0, never NaN, for a fresh character with no balance yet', async () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    sim.addPlayer('warrior', 'B');

    const hooks = buildOfflineWalletPanelHooks(sim);
    const snap = await hooks.snapshot();

    expect(snap.offChainTotalWoc).toBe(0);
  });
});
