// @vitest-environment jsdom
// The two extra desktop doors into the exact-source picker at the bank:
//
// - a sourced material stack in the BAGS, right-clicked while a storage tab is
//   open, opens the exact-source DEPOSIT picker (bags_window.ts, the
//   contextmenu arm) instead of depositing the whole stack; a sourceless stack
//   keeps that whole-stack deposit, and
// - the Materials Vault row's chosen-quantity button opens the exact-source
//   WITHDRAW picker on a sourced special row (vault_window.ts) instead of the
//   plain quantity prompt, which a compact (sourceless) row keeps.
//
// Both drive the REAL windows (the bags_guild_deposit_routing.test.ts and
// vault_window.test.ts harness shapes) and record what the picker opener
// receives, then confirm through the captured session to prove the command
// carries the selection the picker chose.
import { beforeEach, describe, expect, it } from 'vitest';
import type { MaterialComposition } from '../src/sim/material_sources';
import type { InvSlot } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { BankWindow, type BankWindowDeps } from '../src/ui/bank_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { MaterialSourcesDialogOptions } from '../src/ui/material_sources_dialog';
import type { BankInfo, IWorld, VaultInfo, VaultSpecialRef } from '../src/world_api';

const ORE = 'copper_ore';

function sources(): MaterialComposition {
  return [
    { source: { gatherer: { kind: 'character', id: 1, name: 'Ana' } }, count: 2 },
    { source: { gatherer: { kind: 'character', id: 2, name: 'Bru' } }, count: 3 },
  ];
}

function rightClick(element: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return element.dispatchEvent(event);
}

function personalInfo(): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    bonusSources: [],
    socketsUnlocked: 0,
    socketBags: [null, null, null, null],
    nextSocketCost: 1000000,
    generalCapacity: 24,
    materialsCapacity: 0,
    generalUsed: 0,
    materialsUsed: 0,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="prompt-stack"></div>';
  document.body.className = '';
  localStorage.clear();
});

interface BagsHarness {
  root: HTMLElement;
  calls: string[];
  opened: MaterialSourcesDialogOptions[];
  bankRoot: HTMLElement;
}

/** The real BagsWindow at the OPEN personal bank tab (the storage pane whose
 *  right-click is under test), with every reachable deposit command recorded
 *  and the picker opener captured rather than mounted. */
function bagsAtBank(inventory: InvSlot[]): BagsHarness {
  const calls: string[] = [];
  const opened: MaterialSourcesDialogOptions[] = [];
  // storageSourceSelection ties the picker's lifetime to #bank-window.
  const bankRoot = document.createElement('div');
  bankRoot.id = 'bank-window';
  document.body.appendChild(bankRoot);
  const sink =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(
        `${name}:${a
          .filter((x) => x !== undefined)
          .map((x) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)))
          .join(',')}`,
      );
  const world = {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    bankInfo: personalInfo(),
    bankDeposit: sink('bankDeposit'),
    bankSocketBag: sink('bankSocketBag'),
    guildBankDeposit: sink('guildBankDeposit'),
    vaultDeposit: sink('vaultDeposit'),
    useItem: sink('useItem'),
    equipBag: sink('equipBag'),
    unequipBag: sink('unequipBag'),
    discardItem: sink('discardItem'),
    feedPet: sink('feedPet'),
    sellItem: sink('sellItem'),
    moveInventoryItem: sink('moveInventoryItem'),
  } as unknown as IWorld;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world,
    wocBalanceHtml: () => '',
    claudiumLauncherHtml: () => '',
    openClaudium: noop,
    openWallet: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    cancelPetFeed: noop,
    captureFocus: () => null,
    restoreFocus: noop,
    renderCharIfOpen: noop,
    vendorOpen: () => false,
    tradeOpen: () => false,
    isMarketSell: () => false,
    isMailAttach: () => false,
    isBankOpen: () => true,
    isPersonalBankTab: () => true,
    isGuildBankTab: () => false,
    isVaultBankTab: () => false,
    pendingPetFeed: () => false,
    closeVendor: noop,
    closeBank: noop,
    onClosed: noop,
    addItemToTrade: noop,
    stageMarketSell: noop,
    stageMailParcel: noop,
    insertItemChatLink: noop,
    showError: noop,
    setPendingPetFeed: noop,
    resetPetBarSig: noop,
    isHotbarItemId: () => false,
    useGatherTool: () => false,
    setDragAction: noop,
    clearActionDropTargets: noop,
    dragState: new ItemDragState(),
    isTouchHud: () => false,
    confirmVendorSell: () => true,
    markEquipDropTargets: noop,
    dropOnEquipSlot: noop,
    dropOnActionSlot: noop,
    dropOnActionRingSlot: noop,
    openItemActionMenu: noop,
    openMaterialSources: (options) => {
      opened.push(options);
    },
  };
  new BagsWindow(deps).render();
  return { root, calls, opened, bankRoot };
}

function oreCell(root: HTMLElement): HTMLElement {
  const cell = root.querySelector<HTMLElement>('button.bag-item');
  expect(cell, 'no bag cell rendered').not.toBeNull();
  return cell as HTMLElement;
}

describe('a sourced bag stack right-clicked at an open bank tab', () => {
  it('opens the exact-source deposit picker instead of depositing the stack', () => {
    const h = bagsAtBank([{ itemId: ORE, count: 5, materialSources: sources() }]);
    // Desktop: no per-cell Sources button, the right-click is the door.
    expect(h.root.querySelector('.material-sources-action')).toBeNull();
    expect(rightClick(oreCell(h.root))).toBe(false);
    expect(h.calls).toEqual([]);
    expect(h.opened).toHaveLength(1);
    const picker = h.opened[0];
    expect(picker?.itemName).toBe('Copper Ore');
    expect(picker?.sources).toHaveLength(2);
    expect(picker?.onConfirm).toBeDefined();
    expect(picker?.associatedOwners).toEqual([h.bankRoot]);
    // Confirming the captured session deposits exactly the chosen units from
    // the pinned stack (index 0), never the whole stack.
    picker?.onConfirm?.({
      sources: picker.sources as MaterialComposition,
      quantities: [{ sourceIndex: 1, count: 2 }],
      count: 2,
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatch(/^bankDeposit:0,2,/);
  });

  it('keeps the whole-stack deposit for a stack without sources', () => {
    const h = bagsAtBank([{ itemId: ORE, count: 5 }]);
    expect(rightClick(oreCell(h.root))).toBe(false);
    expect(h.opened).toHaveLength(0);
    expect(h.calls).toEqual(['bankDeposit:0']);
  });

  it('refuses (opens nothing, deposits nothing) once the stack has left the bags', () => {
    const inventory: InvSlot[] = [{ itemId: ORE, count: 5, materialSources: sources() }];
    const h = bagsAtBank(inventory);
    const cell = oreCell(h.root);
    // The live inventory moved under the rendered cell (a server correction
    // landing): the pinned stack is no longer held, so the gesture refuses
    // rather than opening a picker over a stale read-only view.
    inventory.length = 0;
    rightClick(cell);
    expect(h.opened).toHaveLength(0);
    expect(h.calls).toEqual([]);
  });
});

interface VaultHarness {
  window: BankWindow;
  root: HTMLElement;
  calls: string[];
  opened: MaterialSourcesDialogOptions[];
}

/** The real BankWindow with its composed VaultTab, the picker opener captured. */
function vaultHarness(vault: VaultInfo): VaultHarness {
  const root = document.createElement('div');
  root.id = 'bank-window';
  document.body.appendChild(root);
  const calls: string[] = [];
  const opened: MaterialSourcesDialogOptions[] = [];
  const world = {
    bankInfo: personalInfo(),
    guildBankInfo: null,
    vaultInfo: vault,
    inventory: [] as InvSlot[],
    bags: [null, null, null, null] as (string | null)[],
    copper: 100_000,
    player: { dead: false },
    bankDeposit: (...a: unknown[]) => calls.push(`bankDeposit:${a.join(',')}`),
    bankWithdraw: (...a: unknown[]) => calls.push(`bankWithdraw:${a.join(',')}`),
    bankBuySlots: () => calls.push('bankBuySlots'),
    vaultDeposit: (...a: unknown[]) => calls.push(`vaultDeposit:${a.join(',')}`),
    vaultWithdraw: (itemId: string, count?: number, special?: VaultSpecialRef) => {
      const countArg = count === undefined ? '' : `,${count}`;
      const specialArg = special === undefined ? '' : `,${JSON.stringify(special)}`;
      calls.push(`vaultWithdraw:${itemId}${countArg}${specialArg}`);
    },
    vaultDepositAll: () => calls.push('vaultDepositAll'),
    vaultBuyUpgrade: () => calls.push('vaultBuyUpgrade'),
  };
  const noop = (): void => {};
  const deps: BankWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: (c: number) => `<span class="money-inline">${c}</span>`,
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => world as unknown as IWorld,
    closeOthers: noop,
    hideTooltip: noop,
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: noop,
    onClosed: noop,
    onInventoryChanged: noop,
    openMaterialSources: (options) => {
      opened.push(options);
    },
  };
  const window = new BankWindow(deps);
  window.open();
  (root.querySelector('.bank-tab[data-tab="vault"]') as HTMLElement).click();
  return { window, root, calls, opened };
}

const quantityPrompt = (): Element | null =>
  document.querySelector('#prompt-stack .vault-quantity-prompt');

describe("the vault row's chosen-quantity button", () => {
  it('opens the exact-source withdraw picker on a sourced special row', () => {
    const h = vaultHarness({
      stock: {},
      special: [{ itemId: ORE, count: 5, materialSources: sources() }],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    });
    const partial = h.root.querySelector<HTMLButtonElement>('.vault-row-partial');
    expect(partial).not.toBeNull();
    partial?.click();
    expect(quantityPrompt()).toBeNull();
    expect(h.opened).toHaveLength(1);
    const picker = h.opened[0];
    expect(picker?.itemName).toBe('Copper Ore');
    expect(picker?.opener).toBe(partial);
    expect(picker?.sources).toHaveLength(2);
    expect(picker?.onConfirm).toBeDefined();
    expect(h.calls).toEqual([]);
    picker?.onConfirm?.({
      sources: picker.sources as MaterialComposition,
      quantities: [{ sourceIndex: 0, count: 1 }],
      count: 1,
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatch(/^vaultWithdraw:copper_ore,1,\{"index":0/);
    expect(h.calls[0]).toContain('"selection"');
  });

  it('keeps the plain quantity prompt on a compact row with no sources', () => {
    const h = vaultHarness({
      stock: { [ORE]: 7 },
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    });
    const partial = h.root.querySelector<HTMLButtonElement>('.vault-row-partial');
    expect(partial).not.toBeNull();
    partial?.click();
    expect(h.opened).toHaveLength(0);
    expect(quantityPrompt()).not.toBeNull();
  });
});
