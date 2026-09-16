// @vitest-environment happy-dom
// The bag-stack step buttons: the material source picker's per-row pair
// (material_sources_dialog.ts) and the vault withdraw prompt's pair
// (bank_quantity_prompt.ts `step`). One press moves a whole carried stack
// (DEFAULT_STACK units) and clamps at the bound, so the last press tops the
// row out or empties it rather than doing nothing; the unit +/- pair keeps
// its exact one-unit stepping beside them.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STACK } from '../src/sim/bags';
import { showQuantityPrompt } from '../src/ui/bank_quantity_prompt';
import {
  closeMaterialSourcesDialog,
  openMaterialSourcesDialog,
} from '../src/ui/material_sources_dialog';

const composition = [
  { source: { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } }, count: 45 },
  { source: { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } }, count: 2 },
];

afterEach(() => {
  closeMaterialSourcesDialog(false);
  document.body.innerHTML = '';
});

function mountOpener(): HTMLButtonElement {
  document.body.innerHTML =
    '<div id="prompt-stack"></div><section class="window"><button id="opener">Sources</button></section>';
  return document.getElementById('opener') as HTMLButtonElement;
}

function rowControls(root: HTMLElement, sourceIndex: number) {
  const input = root.querySelector<HTMLInputElement>(
    `input[data-material-source-index="${sourceIndex}"]`,
  );
  const downBig = root.querySelector<HTMLButtonElement>(
    `[data-material-source-decrease-by="${sourceIndex}"]`,
  );
  const upBig = root.querySelector<HTMLButtonElement>(
    `[data-material-source-increase-by="${sourceIndex}"]`,
  );
  const up = root.querySelector<HTMLButtonElement>(
    `[data-material-source-increase="${sourceIndex}"]`,
  );
  if (!input || !downBig || !upBig || !up) throw new Error(`row ${sourceIndex} controls missing`);
  return { input, downBig, upBig, up };
}

describe('the source picker bag-stack steps', () => {
  it('moves a stack per press, clamps at the row bounds, and keeps the unit step exact', () => {
    expect(DEFAULT_STACK).toBe(20);
    const opener = mountOpener();
    openMaterialSourcesDialog({
      itemName: 'Copper Ore',
      sources: composition,
      opener,
      onConfirm: () => {},
    });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    const ana = rowControls(root, 0);
    expect(ana.upBig.textContent).toBe('+20');
    expect(ana.downBig.textContent).toMatch(/20$/);
    expect(ana.upBig.getAttribute('aria-label')).toBe('Increase units from Collected by Ana by 20');
    expect(ana.downBig.getAttribute('aria-label')).toBe(
      'Decrease units from Collected by Ana by 20',
    );
    expect(ana.downBig.disabled).toBe(true);
    expect(ana.upBig.disabled).toBe(false);

    ana.upBig.click();
    expect(ana.input.value).toBe('20');
    ana.up.click();
    expect(ana.input.value).toBe('21');
    ana.upBig.click();
    expect(ana.input.value).toBe('41');
    // 41 + 20 exceeds the row's 45: the press lands on the bound.
    ana.upBig.click();
    expect(ana.input.value).toBe('45');
    expect(ana.upBig.disabled).toBe(true);
    expect(ana.up.disabled).toBe(true);
    ana.downBig.click();
    expect(ana.input.value).toBe('25');
    ana.downBig.click();
    ana.downBig.click();
    expect(ana.input.value).toBe('0');
    expect(ana.downBig.disabled).toBe(true);

    // A two-unit row tops out at two on the first press.
    const bru = rowControls(root, 1);
    bru.upBig.click();
    expect(bru.input.value).toBe('2');
    expect(bru.upBig.disabled).toBe(true);
  });

  it('Move all fills every row and confirms the whole composition in one press', () => {
    const opener = mountOpener();
    const confirmed: Array<{ count: number; quantities: unknown }> = [];
    openMaterialSourcesDialog({
      itemName: 'Copper Ore',
      sources: composition,
      opener,
      onConfirm: (selected) => {
        confirmed.push({ count: selected.count, quantities: selected.quantities });
      },
    });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    const moveAll = root.querySelector<HTMLButtonElement>('.material-sources-move-all');
    expect(moveAll?.textContent).toBe('Move all units');
    // It sits beside Move selected units, which stays disabled until a row
    // is filled by hand.
    expect(root.querySelector<HTMLButtonElement>('.material-sources-confirm')?.disabled).toBe(true);
    moveAll?.click();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.count).toBe(47);
    expect(confirmed[0]?.quantities).toEqual([
      { sourceIndex: 0, count: 45 },
      { sourceIndex: 1, count: 2 },
    ]);
    expect(document.getElementById('material-sources-dialog')).toBeNull();
  });

  it('grows no step buttons on the read-only details list', () => {
    const opener = mountOpener();
    openMaterialSourcesDialog({ itemName: 'Copper Ore', sources: composition, opener });
    const root = document.getElementById('material-sources-dialog') as HTMLElement;
    expect(root.querySelectorAll('.material-sources-step')).toHaveLength(0);
    expect(root.querySelector('.material-sources-move-all')).toBeNull();
  });
});

describe('the quantity prompt bag-stack steps', () => {
  function open(step: boolean, maxCount = 45): HTMLElement {
    document.body.innerHTML = '<div id="prompt-stack"></div>';
    showQuantityPrompt(
      {
        installPromptDialog: (_prompt, _opener, close) => ({
          dismiss: close,
          dismissAndReturn: close,
        }),
        dismissSiblings: () => {},
      },
      {
        className: 'test-quantity-prompt',
        titleText: 'Withdraw Copper Ore',
        inputAriaText: 'Quantity to withdraw',
        confirmText: 'Withdraw',
        cancelText: 'Cancel',
        maxCount,
        resolveCount: (requested) => requested,
        send: () => {},
        afterClose: () => {},
        ...(step
          ? {
              step: {
                size: 20,
                downText: '-20',
                upText: '+20',
                downAriaText: 'Decrease the quantity by 20',
                upAriaText: 'Increase the quantity by 20',
                unitDownAriaText: 'Decrease the quantity by 1',
                unitUpAriaText: 'Increase the quantity by 1',
              },
            }
          : {}),
      },
    );
    return document.querySelector('.test-quantity-prompt') as HTMLElement;
  }

  it('steps the seeded count by a stack or a unit and clamps to [1, max]', () => {
    const prompt = open(true);
    const input = prompt.querySelector('input') as HTMLInputElement;
    const [down, unitDown, unitUp, up] = Array.from(
      prompt.querySelectorAll<HTMLButtonElement>('.prompt-step'),
    );
    expect(down.textContent).toBe('-20');
    expect(up.getAttribute('aria-label')).toBe('Increase the quantity by 20');
    expect(unitDown.getAttribute('aria-label')).toBe('Decrease the quantity by 1');
    expect(unitUp.getAttribute('aria-label')).toBe('Increase the quantity by 1');
    expect(input.value).toBe('1');
    up.click();
    expect(input.value).toBe('21');
    unitUp.click();
    expect(input.value).toBe('22');
    unitDown.click();
    expect(input.value).toBe('21');
    up.click();
    expect(input.value).toBe('41');
    up.click();
    expect(input.value).toBe('45');
    unitUp.click();
    expect(input.value).toBe('45');
    down.click();
    expect(input.value).toBe('25');
    down.click();
    expect(input.value).toBe('5');
    down.click();
    expect(input.value).toBe('1');
    unitDown.click();
    expect(input.value).toBe('1');
    // Stack pair outside, unit pair inside, confirm and cancel behind them.
    expect(
      Array.from(prompt.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['-20', '\u2212', '+', '+20', 'Withdraw', 'Cancel']);
  });

  it('renders no step pair when the caller passes none', () => {
    const prompt = open(false);
    expect(prompt.querySelectorAll('.prompt-step')).toHaveLength(0);
    expect(
      Array.from(prompt.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(['Withdraw', 'Cancel']);
  });
});
