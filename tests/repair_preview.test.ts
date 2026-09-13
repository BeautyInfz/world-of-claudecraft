// WoC Unleashed vendor "Repair All" preview (src/ui/repair_preview.ts): pure,
// host-agnostic total-cost/count computation over the live equipment mirror.

import { describe, expect, it } from 'vitest';
import type { ItemInstancePayload } from '../src/sim/types';
import { repairAllPreview } from '../src/ui/repair_preview';

describe('repairAllPreview', () => {
  it('returns null for a non-repair vendor regardless of equipped damage', () => {
    const equipment = { chest: 'x' };
    const equipmentInstances = { chest: { durability: 10 } as ItemInstancePayload };
    expect(repairAllPreview(false, equipment, equipmentInstances)).toBeNull();
  });

  it('returns null at a repair vendor when nothing needs repair', () => {
    const equipment = { chest: 'x' };
    const equipmentInstances = { chest: { durability: 100 } as ItemInstancePayload };
    expect(repairAllPreview(true, equipment, equipmentInstances)).toBeNull();
    // Absent durability reads as full too.
    expect(repairAllPreview(true, equipment, { chest: {} as ItemInstancePayload })).toBeNull();
  });

  it('sums cost and count across every slot below full durability, skipping full ones', () => {
    const equipment = { chest: 'chest_item', legs: 'legs_item', feet: 'feet_item' };
    const equipmentInstances = {
      chest: { durability: 50 } as ItemInstancePayload,
      legs: { durability: 100 } as ItemInstancePayload,
      feet: { durability: 0 } as ItemInstancePayload,
    };
    const result = repairAllPreview(true, equipment, equipmentInstances);
    expect(result).not.toBeNull();
    expect(result?.count).toBe(2); // chest + feet, legs is full
  });

  it('skips a slot with no instance payload', () => {
    const equipment = { chest: 'x' };
    const equipmentInstances = {};
    expect(repairAllPreview(true, equipment, equipmentInstances)).toBeNull();
  });
});
