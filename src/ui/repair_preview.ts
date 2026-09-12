// WoC Unleashed-exclusive (src/sim/durability.ts): the vendor window's
// "Repair All" preview - total cost and item count for every equipped item
// below full durability. Pure, host-agnostic (DOM-free); the vendor window
// only renders the button renderVendorWindow's deps.repairAll returns.

import { ITEMS } from '../sim/data';
import {
  DEFAULT_REPAIR_FACTOR,
  DURABILITY_MAX,
  durabilityOf,
  repairCostCopper,
} from '../sim/durability';
import { ALL_EQUIP_SLOTS, type EquipSlot, type ItemInstancePayload } from '../sim/types';

export interface RepairAllPreview {
  totalCopper: number;
  count: number;
}

/** null when this NPC does not repair, or repairs but nothing needs it
 *  (renderVendorWindow renders no button either way). */
export function repairAllPreview(
  isRepairVendor: boolean,
  equipment: Partial<Record<EquipSlot, string>>,
  equipmentInstances: Partial<Record<EquipSlot, ItemInstancePayload>>,
): RepairAllPreview | null {
  if (!isRepairVendor) return null;
  let totalCopper = 0;
  let count = 0;
  for (const slot of ALL_EQUIP_SLOTS) {
    const instance = equipmentInstances[slot];
    if (!instance) continue;
    const durability = durabilityOf(instance);
    if (durability >= DURABILITY_MAX) continue;
    const itemId = equipment[slot];
    const baseValue = (itemId ? ITEMS[itemId]?.sellValue : undefined) ?? 0;
    totalCopper += repairCostCopper(baseValue, durability, DEFAULT_REPAIR_FACTOR);
    count++;
  }
  return count > 0 ? { totalCopper, count } : null;
}
