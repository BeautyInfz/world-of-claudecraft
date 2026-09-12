// Assembles the WoC Unleashed wallet panel's hooks (src/ui/wallet_panel_window.ts
// WalletPanelHooks) from the live Api client, so src/main.ts (a firewall, not
// a home) stays a one-line caller. Mirrors src/game/woc_market_wiring.ts's
// "compose hooks from Api, hand them to Hud.attach*" shape.

import type { Api } from '../net/online';
import { walletConnectionView } from '../ui/wallet_balance';
import type { WalletPanelSnapshot } from '../ui/wallet_panel_view';
import type { WalletPanelHooks } from '../ui/wallet_panel_window';
import { requestWalletVerify } from '../ui/wallet_verify_request';

function asNumber(v: unknown, fallback: number | null = null): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function buildWalletPanelHooks(api: Api): WalletPanelHooks {
  return {
    async snapshot(): Promise<WalletPanelSnapshot> {
      const [claimStatus, offChain, reserve] = await Promise.all([
        api.wocUnleashedClaimStatus(),
        api.wocUnleashedOffChainBalance(),
        api.wocUnleashedReserve(),
      ]);
      const rawCharacters: unknown[] = Array.isArray(offChain.characters)
        ? offChain.characters
        : [];
      const characters = rawCharacters
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => ({ pid: asNumber(c.pid, 0) ?? 0, woc: asNumber(c.woc, 0) ?? 0 }));
      return {
        connection: walletConnectionView(),
        holdingThresholdWoc: asNumber(claimStatus.holdingThresholdWoc),
        offChainTotalWoc: asNumber(offChain.totalWoc),
        offChainCharacters: characters,
        claimStatus: {
          lastClaimAt: typeof claimStatus.lastClaimAt === 'string' ? claimStatus.lastClaimAt : null,
          cooldownElapsed: claimStatus.cooldownElapsed === true,
          totalClaimedCopper: asNumber(claimStatus.totalClaimedCopper, 0) ?? 0,
        },
        reserveWoc: asNumber(reserve.reserveWoc),
      };
    },
    async circulationSeries() {
      const res = await api.wocUnleashedCirculationSeries();
      const rows: unknown[] = Array.isArray(res.series) ? res.series : [];
      return rows
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          day: String(r.day ?? ''),
          inCopper: asNumber(r.inCopper, 0) ?? 0,
          outCopper: asNumber(r.outCopper, 0) ?? 0,
        }));
    },
    async onchainFlowSeries() {
      const res = await api.wocUnleashedOnchainFlowSeries();
      const rows: unknown[] = Array.isArray(res.series) ? res.series : [];
      return rows
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({ day: String(r.day ?? ''), balanceWoc: asNumber(r.balanceWoc, 0) ?? 0 }));
    },
    onConnect: requestWalletVerify,
    onDisconnect: () => {
      void import('../net/wallet').then((w) => w.disconnectWallet().catch(() => {}));
    },
    async onClaim(amountWoc: number) {
      const res = await api.wocUnleashedClaim(amountWoc);
      if (typeof res.error === 'string') throw new Error(res.error);
      return { signature: String(res.signature ?? ''), netWoc: asNumber(res.netWoc, 0) ?? 0 };
    },
  };
}
