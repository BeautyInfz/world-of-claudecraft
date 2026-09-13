// items.repairItem (WoC Unleashed-exclusive, src/sim/durability.ts): the
// vendor repair action end to end through the real SimContext seam, mirroring
// tests/items.test.ts's buyItem style.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { DEFAULT_REPAIR_FACTOR, DURABILITY_MAX, repairCostCopper } from '../src/sim/durability';
import * as items from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as { ctx: SimContext }).ctx;
}

function makeWorld(durabilitySystemEnabled = true) {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, durabilitySystemEnabled });
}

// Stand the player next to Smith Haldren (src/sim/content/zone1.ts
// repairVendor: true) with a helm equipped and damaged.
function repairPlayer(sim: Sim, durability: number) {
  const anySim = sim as unknown as {
    entities: Map<number, Entity>;
    players: Map<
      number,
      {
        copper: number;
        equipment: Record<string, string>;
        equipmentInstance?: Record<string, { durability?: number }>;
      }
    >;
    rebucket(e: Entity): void;
  };
  const pid = sim.addPlayer('warrior', 'Aleph');
  const smith = [...anySim.entities.values()].find(
    (e) => (e as unknown as { templateId?: string }).templateId === 'smith_haldren',
  ) as Entity;
  const p = anySim.entities.get(pid) as Entity;
  p.pos.x = smith.pos.x + 2;
  p.pos.z = smith.pos.z;
  anySim.rebucket(p);
  sim.addItem('cryptbone_helm', 1, pid);
  items.equipItem(ctxOf(sim), 'cryptbone_helm', pid);
  const meta = anySim.players.get(pid)!;
  meta.equipmentInstance = meta.equipmentInstance ?? {};
  meta.equipmentInstance.helmet = { durability };
  meta.copper = 1_000_000;
  return { pid, smith, meta };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('items.repairItem', () => {
  it('is a no-op when durabilitySystemEnabled is off', () => {
    const sim = makeWorld(false);
    const { pid, smith, meta } = repairPlayer(sim, 40);
    const before = meta.copper;
    items.repairItem(ctxOf(sim), smith.id, 'helmet', pid);
    expect(meta.copper).toBe(before);
    expect(meta.equipmentInstance?.helmet?.durability).toBe(40);
  });

  it('charges repairCostCopper and restores durability to full', () => {
    const sim = makeWorld();
    const { pid, smith, meta } = repairPlayer(sim, 40);
    const before = meta.copper;
    const expectedCost = repairCostCopper(
      ITEMS.cryptbone_helm.sellValue,
      40,
      DEFAULT_REPAIR_FACTOR,
    );
    items.repairItem(ctxOf(sim), smith.id, 'helmet', pid);
    expect(meta.copper).toBe(before - expectedCost);
    expect(meta.equipmentInstance?.helmet?.durability).toBe(DURABILITY_MAX);
  });

  it('allows repair at ANY goods vendor, not just an explicit repairVendor NPC', () => {
    // fisherman_brandt (src/sim/content/zone1.ts) sells goods but carries no
    // repairVendor flag: canRepairAtVendor makes every goods vendor repair.
    const sim = makeWorld();
    const { pid, meta } = repairPlayer(sim, 40);
    const anySim = sim as unknown as { entities: Map<number, Entity> };
    const goodsVendor = [...anySim.entities.values()].find(
      (e) =>
        e.kind === 'npc' &&
        (e as unknown as { templateId?: string }).templateId === 'fisherman_brandt',
    ) as Entity;
    expect(goodsVendor.repairVendor).not.toBe(true);
    expect(goodsVendor.vendorItems.length).toBeGreaterThan(0);
    // Walk over to this vendor (repairPlayer positioned the player beside the
    // smith, not here): interact range is enforced regardless of NPC kind.
    const p = anySim.entities.get(pid) as Entity;
    p.pos.x = goodsVendor.pos.x + 2;
    p.pos.z = goodsVendor.pos.z;
    (anySim as unknown as { rebucket(e: Entity): void }).rebucket(p);
    const before = meta.copper;
    const expectedCost = repairCostCopper(
      ITEMS.cryptbone_helm.sellValue,
      40,
      DEFAULT_REPAIR_FACTOR,
    );
    items.repairItem(ctxOf(sim), goodsVendor.id, 'helmet', pid);
    expect(meta.copper).toBe(before - expectedCost);
    expect(meta.equipmentInstance?.helmet?.durability).toBe(DURABILITY_MAX);
  });

  it('refuses at an NPC that neither sells goods nor repairs', () => {
    // foreman_odell (src/sim/content/zone1.ts) is a pure quest-giver: no
    // vendorItems, no repairVendor flag.
    const sim = makeWorld();
    const { pid, meta } = repairPlayer(sim, 40);
    const anySim = sim as unknown as { entities: Map<number, Entity> };
    const nonVendorNpc = [...anySim.entities.values()].find(
      (e) =>
        e.kind === 'npc' &&
        (e as unknown as { templateId?: string }).templateId === 'foreman_odell',
    ) as Entity;
    expect(nonVendorNpc.repairVendor).not.toBe(true);
    expect(nonVendorNpc.vendorItems.length).toBe(0);
    const before = meta.copper;
    const events: SimEvent[] = [];
    const ctx = ctxOf(sim);
    const origError = ctx.error;
    ctx.error = (id, text) => {
      events.push({ type: 'error', text, pid: id });
      origError(id, text);
    };
    items.repairItem(ctx, nonVendorNpc.id, 'helmet', pid);
    expect(meta.copper).toBe(before);
    expect(errorTexts(events).length).toBeGreaterThan(0);
  });

  it('refuses when already at full durability', () => {
    const sim = makeWorld();
    const { pid, smith, meta } = repairPlayer(sim, DURABILITY_MAX);
    const before = meta.copper;
    items.repairItem(ctxOf(sim), smith.id, 'helmet', pid);
    expect(meta.copper).toBe(before);
  });

  it('refuses when the player cannot afford the repair', () => {
    const sim = makeWorld();
    const { pid, smith, meta } = repairPlayer(sim, 1);
    meta.copper = 0;
    items.repairItem(ctxOf(sim), smith.id, 'helmet', pid);
    expect(meta.equipmentInstance?.helmet?.durability).toBe(1);
  });
});
