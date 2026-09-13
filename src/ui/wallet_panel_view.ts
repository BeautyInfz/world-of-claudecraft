// WoC Unleashed wallet panel: pure view model. DOM-free so tests can drive
// it directly (the pure-core half of the pure-core + thin-consumer split,
// src/ui/claudium_window.ts / claudium_view.ts precedent).

import type { WalletConnectionView } from './wallet_connection_view';

export interface WalletPanelCharacterBalance {
  pid: number;
  woc: number;
}

export interface WalletPanelClaimStatus {
  lastClaimAt: string | null;
  cooldownElapsed: boolean;
  totalClaimedCopper: number;
}

/** The economy-wide $WOC currently in circulation (server/
 *  woc_unleashed_emission_db.ts), NOT this account's own balance: netWoc is
 *  gross emission minus every off-chain sink (repairs, marketplace fees,
 *  claims), grossEmittedWoc/capWoc give it a scale against the emission
 *  ceiling. Every field null before the first server read. */
export interface WalletPanelCirculatingSupply {
  netWoc: number | null;
  grossEmittedWoc: number | null;
  capWoc: number | null;
}

export interface WalletPanelSnapshot {
  connection: WalletConnectionView;
  /** $WOC amount currently equivalent to $40 USD (server/
   *  woc_unleashed_price_gate.ts); null before the first server-side refresh. */
  holdingThresholdWoc: number | null;
  offChainTotalWoc: number | null;
  offChainCharacters: readonly WalletPanelCharacterBalance[];
  claimStatus: WalletPanelClaimStatus | null;
  reserveWoc: number | null;
  circulatingSupply: WalletPanelCirculatingSupply | null;
}

export interface WalletPanelView {
  connected: boolean;
  connectedAddress: string | null;
  onChainBalanceWoc: number | null;
  /** Derived from holdingThresholdWoc (price = $40 / threshold), never a
   *  second price fetch: usdValue = balance * (40 / threshold). */
  onChainBalanceUsd: number | null;
  holdingThresholdWoc: number | null;
  holdingMet: boolean;
  offChainTotalWoc: number | null;
  /** Derived from holdingThresholdWoc, the SAME usdPerWoc rate onChainBalanceUsd
   *  uses (one price source for the whole panel): usdValue = balance *
   *  (40 / threshold). */
  offChainTotalUsd: number | null;
  offChainCharacters: readonly WalletPanelCharacterBalance[];
  showCharacterBreakdown: boolean;
  cooldownElapsed: boolean;
  lastClaimAt: string | null;
  reserveWoc: number | null;
  circulatingSupplyWoc: number | null;
  emissionCapWoc: number | null;
  /** grossEmittedWoc / capWoc as a 0-100 percent, null when either input is
   *  missing or the cap is 0 (division-by-zero guard). */
  emissionCapPct: number | null;
  /** True only once every gate this session can check client-side agrees a
   *  claim could succeed (holding gate met, cooldown elapsed, wallet
   *  connected+linked, an off-chain balance loaded and > 0). The server
   *  re-validates every one of these regardless; this only decides whether
   *  the panel's Claim button is enabled. */
  canAttemptClaim: boolean;
}

export function buildWalletPanelView(snapshot: WalletPanelSnapshot): WalletPanelView {
  const { connection } = snapshot;
  const connected = connection.kind === 'linked_connected';
  const threshold = snapshot.holdingThresholdWoc;
  const onChainBalanceWoc = connected ? connection.balance : null;
  const usdPerWoc = threshold !== null && threshold > 0 ? 40 / threshold : null;
  const onChainBalanceUsd =
    onChainBalanceWoc !== null && usdPerWoc !== null ? onChainBalanceWoc * usdPerWoc : null;
  const offChainTotalUsd =
    snapshot.offChainTotalWoc !== null && usdPerWoc !== null
      ? snapshot.offChainTotalWoc * usdPerWoc
      : null;
  const holdingMet =
    threshold !== null && onChainBalanceWoc !== null && onChainBalanceWoc >= threshold;
  const nonzeroCharacters = snapshot.offChainCharacters.filter((c) => c.woc > 0);
  const grossEmittedWoc = snapshot.circulatingSupply?.grossEmittedWoc ?? null;
  const emissionCapWoc = snapshot.circulatingSupply?.capWoc ?? null;
  const emissionCapPct =
    grossEmittedWoc !== null && emissionCapWoc !== null && emissionCapWoc > 0
      ? Math.min(100, (grossEmittedWoc / emissionCapWoc) * 100)
      : null;
  return {
    connected,
    connectedAddress: connected ? connection.linkedAddress : null,
    onChainBalanceWoc,
    onChainBalanceUsd,
    holdingThresholdWoc: threshold,
    holdingMet,
    offChainTotalWoc: snapshot.offChainTotalWoc,
    offChainTotalUsd,
    offChainCharacters: snapshot.offChainCharacters,
    showCharacterBreakdown: nonzeroCharacters.length > 1,
    cooldownElapsed: snapshot.claimStatus?.cooldownElapsed ?? false,
    lastClaimAt: snapshot.claimStatus?.lastClaimAt ?? null,
    reserveWoc: snapshot.reserveWoc,
    circulatingSupplyWoc: snapshot.circulatingSupply?.netWoc ?? null,
    emissionCapWoc,
    emissionCapPct,
    canAttemptClaim:
      connected &&
      holdingMet &&
      (snapshot.claimStatus?.cooldownElapsed ?? false) &&
      (snapshot.offChainTotalWoc ?? 0) > 0,
  };
}

export interface ClaimFeeBreakdown {
  gross: number;
  net: number;
  treasury: number;
  burn: number;
}

// The spec-fixed 80/10/10 split (server/woc_unleashed_chain.ts's real
// on-chain instruction split, mirrored here for the LIVE client-side
// preview only; the server is the sole authority on the actual amounts
// paid, computed independently at claim time).
export const CLAIM_NET_FRACTION = 0.8;
export const CLAIM_TREASURY_FRACTION = 0.1;
export const CLAIM_BURN_FRACTION = 0.1;

/** Pure: the live fee breakdown shown while the player types an amount. */
export function claimFeeBreakdown(grossWoc: number): ClaimFeeBreakdown {
  const gross = Number.isFinite(grossWoc) && grossWoc > 0 ? grossWoc : 0;
  return {
    gross,
    net: gross * CLAIM_NET_FRACTION,
    treasury: gross * CLAIM_TREASURY_FRACTION,
    burn: gross * CLAIM_BURN_FRACTION,
  };
}

/** Pure: is this candidate claim amount valid against the available balance
 *  (the amount-entry step's own validation, mirrored server-side). */
export function claimAmountValid(amountWoc: number, availableWoc: number): boolean {
  return Number.isFinite(amountWoc) && amountWoc > 0 && amountWoc <= availableWoc;
}
