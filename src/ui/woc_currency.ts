// WoC Unleashed-exclusive currency display: on that server variant $WOC
// replaces gold/silver/copper terminology 1:1 (1 $WOC = 1 gold = 10000
// copper - the same raw integer the sim already stores, only the DISPLAY
// changes). Claudemoon is untouched: the module-scope flag below defaults
// false, and formatMoney/moneyHtml (src/ui/i18n.ts, src/ui/money_html.ts)
// only branch into this module when a WoC Unleashed realm has told the
// client so (main.ts pushes the value in here off Api.wocUnleashedAdvert(),
// the exact WALLET_ENABLED/setWalletUiEnabled shape this file mirrors).
//
// Scope note: this is CURRENCY terminology only. The "copper" MATERIAL item
// (Copper Ore and its "Fine" variant, src/sim/content/items.ts) is a
// completely separate identifier and is never touched here or anywhere in
// this module.
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES): the
// numeric formatting reuses wocTokensText, the one spelling every other
// $WOC token figure in the game already shares (the Exchange, the trade
// window's $WOC arm, the wallet balance chip).

import { t } from './i18n';
import { wocTokensText } from './woc_tokens_text';

let realmActive = false;

/** Whether the connected realm is WoC Unleashed (main.ts sets this once at
 *  boot/realm-switch off Api.wocUnleashedAdvert()). Claudemoon never sets
 *  this true, so formatMoney/moneyHtml stay byte-identical to upstream there. */
export function wocCurrencyActive(): boolean {
  return realmActive;
}

export function setWocCurrencyActive(value: boolean): void {
  realmActive = value;
}

/** copper -> $WOC token amount. 1 $WOC = 1 gold = 10000 copper (the same
 *  fixed rate src/sim/format_money.ts and src/ui/i18n.ts moneyParts use for
 *  the gold denomination); $WOC has no silver/copper subdivision. */
export function copperToWocTokens(copper: number): number {
  const safeCopper = Number.isFinite(copper) ? Math.max(0, copper) : 0;
  return safeCopper / 10000;
}

/** The $WOC-terminology equivalent of formatMoney: "{amount} $WOC". `$WOC`
 *  is a token brand name, never translated (see the catalog key's own
 *  comment, itemUi.money.wocAmount, and the identical wallet.balanceAmount
 *  convention already used for the wallet panel). */
export function formatWocCurrency(copper: number): string {
  return t('itemUi.money.wocAmount', { amount: wocTokensText(copperToWocTokens(copper)) });
}
