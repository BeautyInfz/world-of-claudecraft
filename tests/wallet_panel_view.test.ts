import { describe, expect, it } from 'vitest';
import type { WalletConnectionView } from '../src/ui/wallet_connection_view';
import {
  buildWalletPanelView,
  claimAmountValid,
  claimFeeBreakdown,
  type WalletPanelSnapshot,
} from '../src/ui/wallet_panel_view';

function connection(overrides: Partial<WalletConnectionView> = {}): WalletConnectionView {
  return {
    kind: 'unlinked',
    enabled: true,
    linkedAddress: null,
    connectedAddress: null,
    balance: null,
    balanceVerified: false,
    action: 'connect',
    ...overrides,
  };
}

function snapshot(overrides: Partial<WalletPanelSnapshot> = {}): WalletPanelSnapshot {
  return {
    connection: connection(),
    holdingThresholdWoc: null,
    offChainTotalWoc: null,
    offChainCharacters: [],
    claimStatus: null,
    reserveWoc: null,
    circulatingSupply: null,
    ...overrides,
  };
}

describe('buildWalletPanelView', () => {
  it('is disconnected when not linked_connected: no on-chain balance, cannot claim', () => {
    const view = buildWalletPanelView(snapshot());
    expect(view.connected).toBe(false);
    expect(view.onChainBalanceWoc).toBeNull();
    expect(view.canAttemptClaim).toBe(false);
  });

  it('derives USD value from the holding threshold, never a separate price fetch', () => {
    const view = buildWalletPanelView(
      snapshot({
        connection: connection({ kind: 'linked_connected', balance: 100, linkedAddress: 'W1' }),
        holdingThresholdWoc: 4000, // $40 / 4000 = $0.01 per $WOC
      }),
    );
    expect(view.onChainBalanceWoc).toBe(100);
    expect(view.onChainBalanceUsd).toBeCloseTo(1, 5); // 100 * 0.01
  });

  it('holdingMet is true only at or above the threshold', () => {
    const met = buildWalletPanelView(
      snapshot({
        connection: connection({ kind: 'linked_connected', balance: 4000, linkedAddress: 'W1' }),
        holdingThresholdWoc: 4000,
      }),
    );
    expect(met.holdingMet).toBe(true);
    const notMet = buildWalletPanelView(
      snapshot({
        connection: connection({ kind: 'linked_connected', balance: 3999, linkedAddress: 'W1' }),
        holdingThresholdWoc: 4000,
      }),
    );
    expect(notMet.holdingMet).toBe(false);
  });

  it('shows the character breakdown only with more than one nonzero character', () => {
    const one = buildWalletPanelView(snapshot({ offChainCharacters: [{ pid: 1, woc: 5 }] }));
    expect(one.showCharacterBreakdown).toBe(false);
    const two = buildWalletPanelView(
      snapshot({
        offChainCharacters: [
          { pid: 1, woc: 5 },
          { pid: 2, woc: 3 },
        ],
      }),
    );
    expect(two.showCharacterBreakdown).toBe(true);
    const oneNonzero = buildWalletPanelView(
      snapshot({
        offChainCharacters: [
          { pid: 1, woc: 5 },
          { pid: 2, woc: 0 },
        ],
      }),
    );
    expect(oneNonzero.showCharacterBreakdown).toBe(false);
  });

  it('canAttemptClaim requires every gate: connected, holding met, cooldown elapsed, balance > 0', () => {
    const base = {
      connection: connection({ kind: 'linked_connected', balance: 4000, linkedAddress: 'W1' }),
      holdingThresholdWoc: 4000,
      claimStatus: { lastClaimAt: null, cooldownElapsed: true, totalClaimedCopper: 0 },
      offChainTotalWoc: 10,
    };
    expect(buildWalletPanelView(snapshot(base)).canAttemptClaim).toBe(true);
    expect(
      buildWalletPanelView(
        snapshot({ ...base, claimStatus: { ...base.claimStatus, cooldownElapsed: false } }),
      ).canAttemptClaim,
    ).toBe(false);
    expect(buildWalletPanelView(snapshot({ ...base, offChainTotalWoc: 0 })).canAttemptClaim).toBe(
      false,
    );
    expect(
      buildWalletPanelView(snapshot({ ...base, holdingThresholdWoc: 5000 })).canAttemptClaim,
    ).toBe(false);
  });
});

describe('buildWalletPanelView: circulating supply', () => {
  it('passes through nulls before the first server read', () => {
    const view = buildWalletPanelView(snapshot());
    expect(view.circulatingSupplyWoc).toBeNull();
    expect(view.emissionCapWoc).toBeNull();
    expect(view.emissionCapPct).toBeNull();
  });

  it('derives the emission cap percentage from gross emitted / cap', () => {
    const view = buildWalletPanelView(
      snapshot({
        circulatingSupply: { netWoc: 180_000, grossEmittedWoc: 250_000, capWoc: 1_000_000 },
      }),
    );
    expect(view.circulatingSupplyWoc).toBe(180_000);
    expect(view.emissionCapWoc).toBe(1_000_000);
    expect(view.emissionCapPct).toBeCloseTo(25, 5);
  });

  it('clamps the percentage at 100 even if gross emission somehow exceeds the cap', () => {
    const view = buildWalletPanelView(
      snapshot({
        circulatingSupply: { netWoc: 900_000, grossEmittedWoc: 1_200_000, capWoc: 1_000_000 },
      }),
    );
    expect(view.emissionCapPct).toBe(100);
  });

  it('is null when the cap is 0 (division-by-zero guard)', () => {
    const view = buildWalletPanelView(
      snapshot({ circulatingSupply: { netWoc: 0, grossEmittedWoc: 0, capWoc: 0 } }),
    );
    expect(view.emissionCapPct).toBeNull();
  });
});

describe('claimFeeBreakdown', () => {
  it('splits 80/10/10', () => {
    expect(claimFeeBreakdown(100)).toEqual({ gross: 100, net: 80, treasury: 10, burn: 10 });
  });

  it('treats a non-positive or NaN amount as zero everywhere', () => {
    expect(claimFeeBreakdown(0)).toEqual({ gross: 0, net: 0, treasury: 0, burn: 0 });
    expect(claimFeeBreakdown(-5)).toEqual({ gross: 0, net: 0, treasury: 0, burn: 0 });
    expect(claimFeeBreakdown(Number.NaN)).toEqual({ gross: 0, net: 0, treasury: 0, burn: 0 });
  });
});

describe('claimAmountValid', () => {
  it('valid only for a positive amount at or under the available balance', () => {
    expect(claimAmountValid(10, 10)).toBe(true);
    expect(claimAmountValid(10.01, 10)).toBe(false);
    expect(claimAmountValid(0, 10)).toBe(false);
    expect(claimAmountValid(-1, 10)).toBe(false);
    expect(claimAmountValid(Number.NaN, 10)).toBe(false);
  });
});
