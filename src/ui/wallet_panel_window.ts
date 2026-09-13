// WoC Unleashed wallet panel: thin consumer over wallet_panel_view.ts (the
// pure-core + thin-consumer split, src/ui/claudium_window.ts precedent, kept
// deliberately more compact than that file's full accessibility polish -
// focus-restore and a close button, not claudium's live-region/announce
// machinery - a conscious scope trim for this first pass, not an oversight).
//
// WoC Unleashed-exclusive: the icon/window that hosts this only exists when
// main.ts's wocUnleashedAdvert() resolves true (src/ui/hud.ts reveal call).

import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import { usdDollarsText } from './usd_text';
import { type CirculationDayInput, paintCirculationChart } from './wallet_circulation_chart';
import { type FlowDayInput, paintOnchainFlowChart } from './wallet_onchain_flow_chart';
import {
  buildWalletPanelView,
  claimAmountValid,
  claimFeeBreakdown,
  type WalletPanelSnapshot,
  type WalletPanelView,
} from './wallet_panel_view';

/** The data/action hooks main.ts injects once online (attachWalletPanel);
 *  null until then, in which case the window renders a clean empty state
 *  rather than crashing - the ClaudiumHooks/WocMarketHooks precedent. */
export interface WalletPanelHooks {
  snapshot(): Promise<WalletPanelSnapshot>;
  circulationSeries(): Promise<readonly CirculationDayInput[]>;
  onchainFlowSeries(): Promise<readonly FlowDayInput[]>;
  onConnect(): void;
  onDisconnect(): void;
  onClaim(amountWoc: number): Promise<{ signature: string; netWoc: number }>;
}

export interface WalletPanelDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hooks(): WalletPanelHooks | null;
}

const EMPTY_SNAPSHOT: WalletPanelSnapshot = {
  connection: {
    kind: 'disabled',
    enabled: false,
    linkedAddress: null,
    connectedAddress: null,
    balance: null,
    balanceVerified: false,
    action: 'none',
  },
  holdingThresholdWoc: null,
  offChainTotalWoc: null,
  offChainCharacters: [],
  claimStatus: null,
  reserveWoc: null,
  circulatingSupply: null,
};

const CHART_IN_COLOR = '#5fb865';
const CHART_OUT_COLOR = '#c85a5a';
const CHART_FLOW_COLOR = '#c8a838';

export class WalletPanelWindow {
  private openerFocus: HTMLElement | null = null;
  private renderSeq = 0;
  private view: WalletPanelView | null = null;
  private circulation: readonly CirculationDayInput[] = [];
  private onchainFlow: readonly FlowDayInput[] = [];
  private amountEntryOpen = false;
  private amountInput = '';
  private claimPending = false;
  private claimError: string | null = null;
  private claimResult: { signature: string; netWoc: number } | null = null;

  constructor(private readonly deps: WalletPanelDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    root.style.display = 'block';
    this.ensureShell();
    void this.render();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    root.style.display = 'none';
    this.amountEntryOpen = false;
    this.claimResult = null;
    this.claimError = null;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  private ensureShell(): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'wallet-panel-title' });
    if (root.querySelector('.wp-body')) return;
    root.innerHTML =
      `<div class="panel-title"><span id="wallet-panel-title">${esc(t('hudChrome.walletPanel.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.walletPanel.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="wp-body"></div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    this.ensureShell();
    const hooks = this.deps.hooks();
    const [snapshot, circulation, onchainFlow] = hooks
      ? await Promise.all([hooks.snapshot(), hooks.circulationSeries(), hooks.onchainFlowSeries()])
      : [EMPTY_SNAPSHOT, [], []];
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.view = buildWalletPanelView(snapshot);
    this.circulation = circulation;
    this.onchainFlow = onchainFlow;
    this.paint();
  }

  private paint(): void {
    const body = this.deps.root().querySelector<HTMLElement>('.wp-body');
    if (!body || !this.view) return;
    body.innerHTML =
      this.connectionHtml(this.view) +
      this.balancesHtml(this.view) +
      this.claimSectionHtml(this.view) +
      this.reserveHtml(this.view) +
      this.circulatingSupplyHtml(this.view) +
      this.chartsHtml();
    this.wire(body, this.view);
    this.paintCharts();
  }

  private connectionHtml(view: WalletPanelView): string {
    if (!view.connected) {
      return (
        `<div class="wp-connect">` +
        `<button type="button" data-wp-connect>${esc(t('hudChrome.walletPanel.connect'))}</button>` +
        `</div>`
      );
    }
    const addr = view.connectedAddress ?? '';
    const short = addr.length > 10 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
    return (
      `<div class="wp-connect wp-connected">` +
      `<span class="wp-address">${esc(short)}</span>` +
      `<button type="button" data-wp-disconnect>${esc(t('hudChrome.walletPanel.disconnect'))}</button>` +
      `</div>`
    );
  }

  private balancesHtml(view: WalletPanelView): string {
    const onChain = view.connected
      ? `<div class="wp-balance-row"><span>${esc(t('hudChrome.walletPanel.onChainBalance'))}</span>` +
        `<strong>${esc(formatNumber(view.onChainBalanceWoc ?? 0, { maximumFractionDigits: 2 }))} $WOC` +
        (view.onChainBalanceUsd !== null
          ? ` (${esc(usdDollarsText(view.onChainBalanceUsd))})`
          : '') +
        `</strong></div>` +
        `<div class="wp-gate-row ${view.holdingMet ? 'wp-gate-met' : 'wp-gate-unmet'}">` +
        `${esc(
          t('hudChrome.walletPanel.holdingGate', {
            amount: formatNumber(view.holdingThresholdWoc ?? 0, { maximumFractionDigits: 0 }),
          }),
        )}` +
        ` ${view.holdingMet ? esc(t('hudChrome.walletPanel.gateMet')) : esc(t('hudChrome.walletPanel.gateUnmet'))}` +
        `</div>`
      : '';
    const offChain =
      `<div class="wp-balance-row"><span>${esc(t('hudChrome.walletPanel.offChainBalance'))}</span>` +
      `<strong>${esc(formatNumber(view.offChainTotalWoc ?? 0, { maximumFractionDigits: 2 }))} $WOC</strong></div>` +
      (view.showCharacterBreakdown
        ? `<ul class="wp-character-list">${view.offChainCharacters
            .filter((c) => c.woc > 0)
            .map(
              (c) =>
                `<li>${esc(t('hudChrome.walletPanel.characterBalance', { amount: formatNumber(c.woc, { maximumFractionDigits: 2 }) }))}</li>`,
            )
            .join('')}</ul>`
        : '');
    return `<section class="wp-section">${onChain}${offChain}</section>`;
  }

  private claimSectionHtml(view: WalletPanelView): string {
    if (this.claimResult) {
      return (
        `<section class="wp-section wp-claim-result" role="status">` +
        `<p>${esc(t('hudChrome.walletPanel.claimSuccess', { amount: formatNumber(this.claimResult.netWoc, { maximumFractionDigits: 2 }) }))}</p>` +
        `</section>`
      );
    }
    if (!this.amountEntryOpen) {
      const disabled = !view.canAttemptClaim || this.claimPending;
      const cooldownNote = !view.cooldownElapsed
        ? `<p class="wp-note">${esc(t('hudChrome.walletPanel.cooldownActive'))}</p>`
        : '';
      const gateNote =
        view.connected && !view.holdingMet
          ? `<p class="wp-note">${esc(t('hudChrome.walletPanel.gateNote'))}</p>`
          : '';
      return (
        `<section class="wp-section">` +
        `<button type="button" data-wp-claim-open ${disabled ? 'disabled' : ''}>${esc(t('hudChrome.walletPanel.claimButton'))}</button>` +
        cooldownNote +
        gateNote +
        `</section>`
      );
    }
    const available = view.offChainTotalWoc ?? 0;
    const amount = Number(this.amountInput);
    const fees = claimFeeBreakdown(Number.isFinite(amount) ? amount : 0);
    const valid = claimAmountValid(amount, available);
    const errorHtml = this.claimError
      ? `<p class="wp-error" role="alert">${esc(this.claimError)}</p>`
      : '';
    return (
      `<section class="wp-section wp-claim-entry">` +
      `<label>${esc(t('hudChrome.walletPanel.amountLabel'))}` +
      `<input type="number" min="0" max="${esc(String(available))}" step="0.01" data-wp-amount value="${esc(this.amountInput)}"></label>` +
      `<div class="wp-fee-breakdown">` +
      `<div>${esc(t('hudChrome.walletPanel.feeGross', { amount: formatNumber(fees.gross, { maximumFractionDigits: 2 }) }))}</div>` +
      `<div>${esc(t('hudChrome.walletPanel.feeNet', { amount: formatNumber(fees.net, { maximumFractionDigits: 2 }) }))}</div>` +
      `<div>${esc(t('hudChrome.walletPanel.feeTreasury', { amount: formatNumber(fees.treasury, { maximumFractionDigits: 2 }) }))}</div>` +
      `<div>${esc(t('hudChrome.walletPanel.feeBurn', { amount: formatNumber(fees.burn, { maximumFractionDigits: 2 }) }))}</div>` +
      `</div>` +
      errorHtml +
      `<div class="wp-claim-actions">` +
      `<button type="button" data-wp-claim-confirm ${valid && !this.claimPending ? '' : 'disabled'}>${esc(this.claimPending ? t('hudChrome.walletPanel.claimPending') : t('hudChrome.walletPanel.confirmButton'))}</button>` +
      `<button type="button" data-wp-claim-cancel ${this.claimPending ? 'disabled' : ''}>${esc(t('hudChrome.walletPanel.cancelButton'))}</button>` +
      `</div>` +
      `</section>`
    );
  }

  private reserveHtml(view: WalletPanelView): string {
    return (
      `<section class="wp-section wp-reserve">` +
      `<span>${esc(t('hudChrome.walletPanel.reserveLabel'))}</span>` +
      `<strong>${esc(view.reserveWoc === null ? '--' : formatNumber(view.reserveWoc, { maximumFractionDigits: 0 }))} $WOC</strong>` +
      `</section>`
    );
  }

  private circulatingSupplyHtml(view: WalletPanelView): string {
    const capNote =
      view.circulatingSupplyWoc !== null && view.emissionCapPct !== null && view.emissionCapWoc
        ? `<p class="wp-note">${esc(
            t('hudChrome.walletPanel.circulatingSupplyCap', {
              pct: formatNumber(view.emissionCapPct, { maximumFractionDigits: 1 }),
              cap: formatNumber(view.emissionCapWoc, { maximumFractionDigits: 0 }),
            }),
          )}</p>`
        : '';
    return (
      `<section class="wp-section wp-circulating">` +
      `<span>${esc(t('hudChrome.walletPanel.circulatingSupplyLabel'))}</span>` +
      `<strong>${esc(
        view.circulatingSupplyWoc === null
          ? '--'
          : formatNumber(view.circulatingSupplyWoc, { maximumFractionDigits: 0 }),
      )} $WOC</strong>` +
      capNote +
      `</section>`
    );
  }

  private chartsHtml(): string {
    return (
      `<section class="wp-section wp-charts">` +
      `<div class="wp-chart"><h4>${esc(t('hudChrome.walletPanel.circulationChartTitle'))}</h4><canvas data-wp-circulation-canvas></canvas></div>` +
      `<div class="wp-chart"><h4>${esc(t('hudChrome.walletPanel.flowChartTitle'))}</h4><canvas data-wp-flow-canvas></canvas></div>` +
      `</section>`
    );
  }

  private paintCharts(): void {
    const root = this.deps.root();
    this.paintOneChart(
      root.querySelector<HTMLCanvasElement>('[data-wp-circulation-canvas]'),
      (ctx, cssW, cssH) =>
        paintCirculationChart(ctx, {
          days: this.circulation,
          cssW,
          cssH,
          inColor: CHART_IN_COLOR,
          outColor: CHART_OUT_COLOR,
        }),
    );
    this.paintOneChart(
      root.querySelector<HTMLCanvasElement>('[data-wp-flow-canvas]'),
      (ctx, cssW, cssH) =>
        paintOnchainFlowChart(ctx, { days: this.onchainFlow, cssW, cssH, color: CHART_FLOW_COLOR }),
    );
  }

  private paintOneChart(
    canvas: HTMLCanvasElement | null,
    draw: (ctx: CanvasRenderingContext2D, cssW: number, cssH: number) => void,
  ): void {
    if (!canvas) return;
    const cssW = canvas.clientWidth || 260;
    const cssH = canvas.clientHeight || 80;
    const dpr = Math.min(2, window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, cssW, cssH);
  }

  private wire(body: HTMLElement, view: WalletPanelView): void {
    body
      .querySelector('[data-wp-connect]')
      ?.addEventListener('click', () => this.deps.hooks()?.onConnect());
    body
      .querySelector('[data-wp-disconnect]')
      ?.addEventListener('click', () => this.deps.hooks()?.onDisconnect());
    body.querySelector('[data-wp-claim-open]')?.addEventListener('click', () => {
      this.amountEntryOpen = true;
      this.amountInput = String(view.offChainTotalWoc ?? 0);
      this.claimError = null;
      this.paint();
    });
    body.querySelector('[data-wp-claim-cancel]')?.addEventListener('click', () => {
      this.amountEntryOpen = false;
      this.claimError = null;
      this.paint();
    });
    body.querySelector<HTMLInputElement>('[data-wp-amount]')?.addEventListener('input', (e) => {
      this.amountInput = (e.target as HTMLInputElement).value;
      this.paint();
    });
    body.querySelector('[data-wp-claim-confirm]')?.addEventListener('click', () => {
      const amount = Number(this.amountInput);
      const hooks = this.deps.hooks();
      if (!hooks || !claimAmountValid(amount, view.offChainTotalWoc ?? 0) || this.claimPending) {
        return;
      }
      this.claimPending = true;
      this.claimError = null;
      this.paint();
      void hooks
        .onClaim(amount)
        .then((result) => {
          this.claimResult = result;
          this.amountEntryOpen = false;
        })
        .catch((err) => {
          this.claimError = err instanceof Error && err.message ? err.message : 'Claim failed';
        })
        .finally(() => {
          this.claimPending = false;
          this.paint();
        });
    });
  }
}
