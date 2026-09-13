// WoC Unleashed-exclusive item durability/repair system (SimContext seam,
// src/sim/CLAUDE.md "New sim SYSTEM behavior"). Every function here is a
// no-op unless the caller has already checked ctx.durabilitySystemEnabled
// (SimConfig.durabilitySystemEnabled, default off): Claudemoon, every
// existing test, the offline browser Sim, and the headless RL env never call
// these at all, so their behavior is byte-identical to upstream.
//
// Durability lives on ItemInstancePayload.durability (src/sim/types.ts): an
// integer 0-100, absent meaning "full" (see that field's own doc comment for
// why absent must never be read as depleted). At 0 the item's stat bonuses
// are excluded by recalcPlayerStats (src/sim/entity.ts) but the item stays
// equipped/visible - it is never destroyed or unequipped.
//
// Every durability-tracked item (isDurabilityTrackedItem below: every weapon,
// held offhand, and non-jewelry armor piece) is stamped with an explicit
// durability: DURABILITY_MAX the moment it is granted (Sim.addItem /
// addItemInstance), so the tooltip shows "100/100" from the start instead of
// staying silent until the item first takes damage.
//
// Loss rules (spec): PvP causes zero loss, ever. A PvE death costs -10% (10
// points) on every equipped item. A PvE hit taken is a probabilistic 3%
// (pveHitDurabilityLossChance) per-hit roll; on success, ONE random equipped
// ARMOR slot (weapons excluded) loses 1 point. Repair is vendor-only, restores
// to full, and costs base_item_value * repair_factor * (100 - durability) / 100.

import type { PlayerEquipmentInstances } from './entity';
import type { EquipSlot, ItemDef, ItemInstancePayload } from './types';

export const DURABILITY_MAX = 100;

// The classic-MMO armor set: excludes weapons (mainhand/offhand, per spec)
// AND jewelry (neck/ring1/ring2, which classic durability systems never
// touch either) - only the seven wearable armor pieces take hit-taken loss.
export const ARMOR_SLOTS: readonly EquipSlot[] = [
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

/** Default 3%; tunable, never hardcoded at the call site (config-thread
 *  precedent: STORAGE_PRICES/server/storage_prices.ts). */
export const DEFAULT_PVE_HIT_DURABILITY_LOSS_CHANCE = 0.03;

/** PROVISIONAL: the WoC Unleashed spec leaves repair_factor's value (and
 *  whether it should vary per item rarity/level) as an explicitly open design
 *  decision, not for this implementation to resolve unilaterally. 0.5 (half
 *  the item's vendor sell value to fully repair from 0) is a placeholder so
 *  the vendor action has something to charge; treat any production tuning of
 *  this number as a maintainer/design call, not a code review nit. */
export const DEFAULT_REPAIR_FACTOR = 0.5;

/** Fraction of DURABILITY_MAX lost on a PvE death, applied to every equipped
 *  item (spec: -10% = 10 of 100 points). */
export const PVE_DEATH_DURABILITY_LOSS_FRACTION = 0.1;

/** Whether an NPC repairs gear: an explicitly flagged repair specialist
 *  (repairVendor: true, e.g. an armorer with no goods stock of their own), OR
 *  any goods vendor at all (a nonempty vendorItems stock) - repair is a
 *  standard service every merchant offers in WoC Unleashed, not a single
 *  gatekept NPC. Structural (no Entity import) so both the server gate
 *  (src/sim/items.ts repairItem) and the client preview gate (src/ui/hud.ts)
 *  share one rule. */
export function canRepairAtVendor(npc: {
  repairVendor?: boolean;
  vendorItems: readonly string[];
}): boolean {
  return npc.repairVendor === true || npc.vendorItems.length > 0;
}

/** Whether `def` is a durability-tracked item: every weapon and held
 *  offhand, and every armor piece EXCEPT jewelry (neck/ring - classic
 *  durability systems never touch those either, the same exclusion
 *  ARMOR_SLOTS makes for the hit-taken roll). Jewelry shares armor's `kind`
 *  (JewelryItemDef, src/sim/types.ts) so `slot` is what actually tells them
 *  apart. The grant hub (Sim.addItem/addItemInstance) calls this to decide
 *  whether a granted copy starts at full durability. */
export function isDurabilityTrackedItem(def: ItemDef | undefined): boolean {
  if (!def) return false;
  if (def.kind === 'weapon' || def.kind === 'held_offhand') return true;
  return def.kind === 'armor' && def.slot !== 'neck' && def.slot !== 'ring';
}

/** Absent reads as full (see ItemInstancePayload.durability's doc comment). */
export function durabilityOf(instance: ItemInstancePayload | undefined): number {
  return instance?.durability ?? DURABILITY_MAX;
}

export function isDurabilityDepleted(instance: ItemInstancePayload | undefined): boolean {
  return durabilityOf(instance) <= 0;
}

function clampDurability(value: number): number {
  return Math.max(0, Math.min(DURABILITY_MAX, Math.round(value)));
}

/** Apply the flat -10%-of-max loss to every equipped item (PvE death). Mutates
 *  in place; a slot with no instance payload is skipped - every
 *  durability-tracked item is granted with one already (isDurabilityTrackedItem),
 *  so a missing instance here means the equipped item was never
 *  durability-tracked (jewelry) or predates this system (a carried-over save). */
export function applyPveDeathDurabilityLoss(equipmentInstance: PlayerEquipmentInstances): void {
  const lossPoints = Math.round(DURABILITY_MAX * PVE_DEATH_DURABILITY_LOSS_FRACTION);
  for (const slot of Object.keys(equipmentInstance) as EquipSlot[]) {
    const instance = equipmentInstance[slot];
    if (!instance) continue;
    instance.durability = clampDurability(durabilityOf(instance) - lossPoints);
  }
}

/** The single RNG draw for a PvE hit-taken roll (src/sim/rng.ts Rng.chance),
 *  and, only on success, which armor slot loses the point. Callers MUST only
 *  invoke this when the hit is confirmed player-target + mob-source (never
 *  PvP) AND the durability system is enabled, per the draw-order discipline
 *  in src/sim/CLAUDE.md: an early-bail before this call must never itself
 *  draw rng, so a Claudemoon/disabled Sim's replay draw order is never
 *  perturbed by a branch it can never take. Returns the slot that lost a
 *  point, or null (no roll success, or no eligible armor equipped). */
export function rollPveHitDurabilityLoss(
  chance: (p: number) => boolean,
  pick: <T>(arr: T[]) => T,
  equipmentInstance: PlayerEquipmentInstances,
  lossChance: number = DEFAULT_PVE_HIT_DURABILITY_LOSS_CHANCE,
): EquipSlot | null {
  const equippedArmorSlots = ARMOR_SLOTS.filter((slot) => equipmentInstance[slot] !== undefined);
  if (equippedArmorSlots.length === 0) return null;
  if (!chance(lossChance)) return null;
  const slot = pick(equippedArmorSlots);
  const instance = equipmentInstance[slot];
  if (!instance) return null;
  instance.durability = clampDurability(durabilityOf(instance) - 1);
  return slot;
}

/** repair_cost = base_item_value * repair_factor * (100 - durability) / 100,
 *  floored to a whole-copper integer (currency has no fractional unit). A
 *  fully-repaired item (durability >= 100) costs 0: repairing it is a no-op,
 *  not a paid action, so a vendor UI can safely offer "repair all" without an
 *  extra full-durability guard. */
export function repairCostCopper(
  baseItemValueCopper: number,
  durability: number,
  repairFactor: number,
): number {
  const missing = Math.max(0, DURABILITY_MAX - durability);
  return Math.floor(baseItemValueCopper * repairFactor * (missing / DURABILITY_MAX));
}

/** Restore one instance to full durability in place. Pure mutation, no
 *  currency/ledger side effect - the caller (the vendor repair action) is
 *  responsible for the copper deduction and the ledger event. */
export function repairInstance(instance: ItemInstancePayload): void {
  instance.durability = DURABILITY_MAX;
}

/** The single gate recalcPlayerStats (src/sim/entity.ts) must call before
 *  accumulating an equipped item's stat/set-credit contribution: a depleted
 *  item stays equipped and visible but contributes nothing. `item` is passed
 *  (rather than gating by slot alone) so a future non-stat-bearing "item" with
 *  no bonuses to gate is unaffected either way. */
export function itemStatsExcludedByDurability(
  item: ItemDef | undefined,
  instance: ItemInstancePayload | undefined,
): boolean {
  return item !== undefined && isDurabilityDepleted(instance);
}
