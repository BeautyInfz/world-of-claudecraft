// End-to-end proof that WoC Unleashed items actually carry durability, through
// the real Sim's grant hub (Sim.addItem / addItemInstance) and fresh-character
// construction, not just the isolated durability.ts unit tests. Before this,
// almost every granted item had no ItemInstancePayload at all (durability
// silently absent, never displayed, never lost), which is the bug this file
// pins the fix for.

import { describe, expect, it } from 'vitest';
import { DURABILITY_MAX, isDurabilityTrackedItem } from '../../src/sim/durability';
import type { PlayerMeta } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import type { ItemDef } from '../../src/sim/types';

function metaOf(sim: Sim, pid: number): PlayerMeta {
  return (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid)!;
}

describe('isDurabilityTrackedItem', () => {
  it('tracks weapons and held offhands', () => {
    expect(isDurabilityTrackedItem({ kind: 'weapon' } as ItemDef)).toBe(true);
    expect(isDurabilityTrackedItem({ kind: 'held_offhand' } as ItemDef)).toBe(true);
  });

  it('tracks armor except jewelry (neck/ring share the armor kind)', () => {
    expect(isDurabilityTrackedItem({ kind: 'armor', slot: 'chest' } as ItemDef)).toBe(true);
    expect(isDurabilityTrackedItem({ kind: 'armor', slot: 'helmet' } as ItemDef)).toBe(true);
    expect(isDurabilityTrackedItem({ kind: 'armor', slot: 'neck' } as ItemDef)).toBe(false);
    expect(isDurabilityTrackedItem({ kind: 'armor', slot: 'ring' } as ItemDef)).toBe(false);
  });

  it('ignores every other kind and an unknown item', () => {
    expect(isDurabilityTrackedItem({ kind: 'food' } as ItemDef)).toBe(false);
    expect(isDurabilityTrackedItem(undefined)).toBe(false);
  });
});

describe('Sim.addItem: durability stamp on grant', () => {
  it('Claudemoon: grants a plain copy with no instance, byte-identical to upstream', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'A');
    sim.addItem('worn_sword', 1, pid);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'worn_sword');
    expect(slot?.instance).toBeUndefined();
  });

  it('WoC Unleashed: a granted weapon starts at full durability', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'B');
    sim.addItem('worn_sword', 1, pid);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'worn_sword');
    expect(slot?.instance?.durability).toBe(DURABILITY_MAX);
  });

  it('WoC Unleashed: a granted armor piece starts at full durability', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'C');
    sim.addItem('recruit_tunic', 1, pid);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'recruit_tunic');
    expect(slot?.instance?.durability).toBe(DURABILITY_MAX);
  });

  it('WoC Unleashed: jewelry never gets a durability stamp', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'D');
    sim.addItem('wyrmfall_pendant', 1, pid);
    sim.addItem('warhewn_signet', 1, pid);
    const meta = metaOf(sim, pid);
    expect(meta.inventory.find((s) => s.itemId === 'wyrmfall_pendant')?.instance).toBeUndefined();
    expect(meta.inventory.find((s) => s.itemId === 'warhewn_signet')?.instance).toBeUndefined();
  });

  it('WoC Unleashed: a non-equippable material never gets a durability stamp', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'E');
    sim.addItem('copper_ore', 5, pid);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'copper_ore');
    expect(slot?.instance).toBeUndefined();
  });
});

describe('Sim.addItemInstance: durability backfill', () => {
  it('WoC Unleashed: stamps full durability onto an instanced grant missing one', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'F');
    sim.addItemInstance('worn_sword', {}, pid, 1);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'worn_sword');
    expect(slot?.instance?.durability).toBe(DURABILITY_MAX);
  });

  it('WoC Unleashed: never clobbers an already-set durability (a transfer of a worn item)', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'G');
    sim.addItemInstance('worn_sword', { durability: 42 }, pid, 1);
    const slot = metaOf(sim, pid).inventory.find((s) => s.itemId === 'worn_sword');
    expect(slot?.instance?.durability).toBe(42);
  });
});

describe('fresh-character starting gear', () => {
  it('Claudemoon: the starting weapon/chest carry no instance', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'H');
    expect(metaOf(sim, pid).equipmentInstance).toEqual({});
  });

  it('WoC Unleashed: the starting weapon and chest are stamped at full durability', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'I');
    const meta = metaOf(sim, pid);
    expect(meta.equipmentInstance.mainhand?.durability).toBe(DURABILITY_MAX);
    expect(meta.equipmentInstance.chest?.durability).toBe(DURABILITY_MAX);
  });
});
