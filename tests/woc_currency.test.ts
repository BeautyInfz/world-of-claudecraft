// WoC Unleashed-exclusive currency display (src/ui/woc_currency.ts): the
// $WOC branch of formatMoney/moneyHtml. Defaults off (Claudemoon-safe);
// setWocCurrencyActive flips it for these tests and must be reset after.

import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from '../src/ui/i18n';
import { moneyHtml } from '../src/ui/money_html';
import {
  copperToWocTokens,
  formatWocCurrency,
  setWocCurrencyActive,
  wocCurrencyActive,
} from '../src/ui/woc_currency';

afterEach(() => {
  setWocCurrencyActive(false);
});

describe('wocCurrencyActive', () => {
  it('defaults to false', () => {
    expect(wocCurrencyActive()).toBe(false);
  });
});

describe('copperToWocTokens', () => {
  it('converts at the fixed 10000-copper-per-$WOC rate (1 $WOC = 1 gold)', () => {
    expect(copperToWocTokens(10000)).toBe(1);
    expect(copperToWocTokens(25000)).toBe(2.5);
    expect(copperToWocTokens(0)).toBe(0);
  });

  it('clamps a negative or non-finite input to 0', () => {
    expect(copperToWocTokens(-500)).toBe(0);
    expect(copperToWocTokens(Number.NaN)).toBe(0);
  });
});

describe('formatWocCurrency', () => {
  it('renders "{amount} $WOC" with the shared two-decimal $WOC spelling', () => {
    expect(formatWocCurrency(12345)).toBe('1.23 $WOC');
    expect(formatWocCurrency(0)).toBe('0 $WOC');
  });
});

describe('formatMoney / moneyHtml branch on wocCurrencyActive', () => {
  it('formatMoney falls back to the classic gold/silver/copper spelling when inactive', () => {
    expect(formatMoney(12345)).toBe('1g 23s 45c');
  });

  it('formatMoney switches to $WOC terminology once active, ignoring style', () => {
    setWocCurrencyActive(true);
    expect(formatMoney(12345, 'compact')).toBe('1.23 $WOC');
    expect(formatMoney(12345, 'long')).toBe('1.23 $WOC');
  });

  it('moneyHtml renders the classic three-coin markup when inactive', () => {
    expect(moneyHtml(12345)).toContain('coin g');
    expect(moneyHtml(12345)).not.toContain('woc-currency');
  });

  it('moneyHtml renders a single $WOC readout once active', () => {
    setWocCurrencyActive(true);
    const html = moneyHtml(12345);
    expect(html).toContain('woc-currency');
    expect(html).toContain('1.23 $WOC');
    expect(html).not.toContain('coin g');
  });

  it('moneyHtml leads the $WOC readout with the woc_token coin art, not the gold coin', () => {
    setWocCurrencyActive(true);
    const html = moneyHtml(12345);
    expect(html).toContain('/ui/currency/woc_token.webp');
    expect(html).not.toContain('coin_gold');
    // the icon comes before the amount, matching the honor/delve_mark convention
    expect(html.indexOf('woc_token.webp')).toBeLessThan(html.indexOf('1.23 $WOC'));
  });
});
