// Assembles the WoC Unleashed wallet panel's hooks for the "Unleashed Offline"
// dev shortcut (src/main.ts's server-select dropdown): a local Sim with no
// server, so wallet CONNECTION is real (src/net/wallet talks to the browser's
// Solana extension / a Solana RPC directly, never our server) while every
// server-backed reading (off-chain totals beyond this one character, the
// holding-gate threshold, claim status, the reserve, both charts) has nothing
// to read from and stays null/empty. Claiming itself needs the real on-chain
// custody flow server/woc_unleashed_claim.ts owns, so it always rejects here.
import type { Sim } from '../sim/sim';
import { t } from '../ui/i18n';
import { walletConnectionView } from '../ui/wallet_balance';
import type { WalletPanelSnapshot } from '../ui/wallet_panel_view';
import type { WalletPanelHooks } from '../ui/wallet_panel_window';
import { requestWalletVerify } from '../ui/wallet_verify_request';
import { copperToWocTokens } from '../ui/woc_currency';

export function buildOfflineWalletPanelHooks(sim: Sim): WalletPanelHooks {
  return {
    async snapshot(): Promise<WalletPanelSnapshot> {
      // meta.copper is the live unleashedBalance redirect (sim.ts's
      // bindUnleashedCurrency), installed unconditionally whenever
      // durabilitySystemEnabled is true, exactly the case that gates this
      // wiring being attached at all - and, like every other copper field in
      // the sim, it is in COPPER units (1 $WOC = 10000 copper), so it must go
      // through the same copperToWocTokens conversion the online path's own
      // /10000 division applies, or the panel shows 10000x the real balance.
      const woc = copperToWocTokens(sim.players.get(sim.playerId)?.copper ?? 0);
      return {
        connection: walletConnectionView(),
        holdingThresholdWoc: null,
        offChainTotalWoc: woc,
        offChainCharacters: [{ pid: sim.playerId, woc }],
        claimStatus: null,
        reserveWoc: null,
        circulatingSupply: null,
      };
    },
    async circulationSeries() {
      return [];
    },
    async onchainFlowSeries() {
      return [];
    },
    onConnect: requestWalletVerify,
    onDisconnect: () => {
      void import('../net/wallet').then((w) => w.disconnectWallet().catch(() => {}));
    },
    async onClaim() {
      throw new Error(t('hudChrome.walletPanel.offlineClaimUnavailable'));
    },
  };
}
