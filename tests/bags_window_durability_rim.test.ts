// @vitest-environment jsdom
// WoC Unleashed-exclusive: a depleted-durability item's bag cell wears the
// .item-broken red rim class (src/ui/bags_window.ts), pinned against the real
// BagsWindow painter (the bags_window_instance_marker.test.ts idiom).
import { describe, expect, it } from 'vitest';
import type { InvSlot, QuestProgress } from '../src/sim/types';
import { BagsWindow, type BagsWindowDeps } from '../src/ui/bags_window';
import { ItemDragState } from '../src/ui/item_drag_state';
import type { IWorld } from '../src/world_api';

function fakeWorld(inventory: InvSlot[]): IWorld {
  return {
    inventory,
    bags: [null, null, null, null],
    bagCapacity: 16,
    copper: 0,
    questLog: new Map<string, QuestProgress>(),
  } as unknown as IWorld;
}

function windowFor(inventory: InvSlot[]): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const noop = (): void => {};
  const deps: BagsWindowDeps = {
    itemIcon: () => '<span class="item-icon"></span>',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: noop,
    root: () => root,
    world: () => fakeWorld(inventory),
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
    isBankOpen: () => false,
    isPersonalBankTab: () => false,
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
  };
  new BagsWindow(deps).render();
  return root;
}

describe('bags grid: depleted-durability rim', () => {
  it('wears .item-broken only on a copy at exactly 0 durability', () => {
    const root = windowFor([
      { itemId: 'copper_ore', count: 1, instance: { durability: 0 } },
      { itemId: 'copper_ore', count: 1, instance: { durability: 1 } },
      { itemId: 'copper_ore', count: 1 },
    ]);
    const cells = root.querySelectorAll('button.bag-item');
    expect(cells.length).toBe(3);
    expect(cells[0].classList.contains('item-broken')).toBe(true);
    expect(cells[1].classList.contains('item-broken')).toBe(false);
    expect(cells[2].classList.contains('item-broken')).toBe(false);
  });
});
