// WoC Unleashed item durability/repair system: pure logic only (no Sim
// instance needed - src/sim/CLAUDE.md's rule for a system module's decision
// logic). The hit-taken/death hooks in src/sim/combat/damage.ts are exercised
// indirectly through the existing combat integration tests once
// durabilitySystemEnabled is threaded through a real Sim; this file pins the
// module's own contract in isolation.

import { describe, expect, it } from 'vitest';
import {
  ARMOR_SLOTS,
  applyPveDeathDurabilityLoss,
  DURABILITY_MAX,
  durabilityOf,
  isDurabilityDepleted,
  itemStatsExcludedByDurability,
  PVE_DEATH_DURABILITY_LOSS_FRACTION,
  repairCostCopper,
  repairInstance,
  rollPveHitDurabilityLoss,
} from '../../src/sim/durability';
import type { PlayerEquipmentInstances } from '../../src/sim/entity';
import type { ItemDef, ItemInstancePayload } from '../../src/sim/types';

describe('durabilityOf / isDurabilityDepleted', () => {
  it('reads an absent durability field as full, never as depleted', () => {
    expect(durabilityOf(undefined)).toBe(DURABILITY_MAX);
    expect(durabilityOf({})).toBe(DURABILITY_MAX);
    expect(isDurabilityDepleted(undefined)).toBe(false);
    expect(isDurabilityDepleted({})).toBe(false);
  });

  it('is depleted at exactly 0 and only at or below 0', () => {
    expect(isDurabilityDepleted({ durability: 0 })).toBe(true);
    expect(isDurabilityDepleted({ durability: 1 })).toBe(false);
  });
});

describe('applyPveDeathDurabilityLoss', () => {
  it('takes exactly 10% (10 points) off every equipped item with an instance', () => {
    const equipmentInstance: PlayerEquipmentInstances = {
      chest: { durability: 100 },
      legs: { durability: 15 },
      // mainhand carries no instance payload; must be left untouched (no crash).
      mainhand: undefined,
    };
    applyPveDeathDurabilityLoss(equipmentInstance);
    expect(equipmentInstance.chest?.durability).toBe(90);
    // Clamped at 0, never negative.
    expect(equipmentInstance.legs?.durability).toBe(5);
    expect(equipmentInstance.mainhand).toBeUndefined();
  });

  it('clamps at 0 rather than going negative', () => {
    const equipmentInstance: PlayerEquipmentInstances = { feet: { durability: 3 } };
    applyPveDeathDurabilityLoss(equipmentInstance);
    expect(equipmentInstance.feet?.durability).toBe(0);
  });

  it('matches the spec fraction constant (10%)', () => {
    expect(PVE_DEATH_DURABILITY_LOSS_FRACTION).toBe(0.1);
  });
});

describe('rollPveHitDurabilityLoss', () => {
  it('never draws rng when no armor is equipped (draw-order discipline)', () => {
    let chanceCalls = 0;
    const chance = () => {
      chanceCalls++;
      return true;
    };
    const pick = <T>(arr: T[]): T => arr[0];
    const result = rollPveHitDurabilityLoss(chance, pick, {});
    expect(result).toBeNull();
    expect(chanceCalls).toBe(0);
  });

  it('decrements exactly one point on exactly one armor slot on a successful roll', () => {
    const equipmentInstance: PlayerEquipmentInstances = {
      helmet: { durability: 50 },
      chest: { durability: 50 },
    };
    const chance = () => true;
    const pick = <T>(arr: T[]): T => arr[0]; // deterministic: always the first eligible slot
    const slot = rollPveHitDurabilityLoss(chance, pick, equipmentInstance);
    expect(slot).not.toBeNull();
    const touched = slot as keyof PlayerEquipmentInstances;
    expect(equipmentInstance[touched]?.durability).toBe(49);
    // Exactly one slot changed.
    const others = ARMOR_SLOTS.filter((s) => s !== touched);
    for (const other of others) {
      if (equipmentInstance[other]) expect(equipmentInstance[other]?.durability).toBe(50);
    }
  });

  it('never touches weapon slots even when they carry an instance', () => {
    const equipmentInstance: PlayerEquipmentInstances = {
      mainhand: { durability: 50 },
      offhand: { durability: 50 },
    };
    const chance = () => true;
    const pick = <T>(arr: T[]): T => arr[0];
    const slot = rollPveHitDurabilityLoss(chance, pick, equipmentInstance);
    expect(slot).toBeNull();
    expect(equipmentInstance.mainhand?.durability).toBe(50);
    expect(equipmentInstance.offhand?.durability).toBe(50);
  });

  it('makes no change when the roll fails', () => {
    const equipmentInstance: PlayerEquipmentInstances = { helmet: { durability: 50 } };
    const slot = rollPveHitDurabilityLoss(
      () => false,
      (arr) => arr[0],
      equipmentInstance,
    );
    expect(slot).toBeNull();
    expect(equipmentInstance.helmet?.durability).toBe(50);
  });
});

describe('repairCostCopper', () => {
  it('follows base_item_value * repair_factor * (100 - durability) / 100', () => {
    expect(repairCostCopper(10000, 50, 0.5)).toBe(Math.floor(10000 * 0.5 * 0.5));
    expect(repairCostCopper(10000, 0, 1)).toBe(10000);
  });

  it('is zero for a fully-repaired item (a no-op repair, not a free one)', () => {
    expect(repairCostCopper(10000, 100, 1)).toBe(0);
  });

  it('never goes negative even past full durability', () => {
    expect(repairCostCopper(10000, 150, 1)).toBe(0);
  });
});

describe('repairInstance', () => {
  it('restores durability to exactly DURABILITY_MAX', () => {
    const instance: ItemInstancePayload = { durability: 12 };
    repairInstance(instance);
    expect(instance.durability).toBe(DURABILITY_MAX);
  });
});

describe('itemStatsExcludedByDurability', () => {
  const item = {} as ItemDef;

  it('excludes stats only when the item is defined AND durability is depleted', () => {
    expect(itemStatsExcludedByDurability(item, { durability: 0 })).toBe(true);
    expect(itemStatsExcludedByDurability(item, { durability: 1 })).toBe(false);
    expect(itemStatsExcludedByDurability(item, undefined)).toBe(false);
    expect(itemStatsExcludedByDurability(undefined, { durability: 0 })).toBe(false);
  });
});
