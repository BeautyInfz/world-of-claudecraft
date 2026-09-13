// End-to-end proof that WoC Unleashed's $WOC balance is a genuinely separate
// ledger from Claudemoon's `copper`, through the real Sim (construction,
// save, load), not just the isolated bindUnleashedCurrency unit tests.

import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../../src/sim/character_state';
import type { PlayerMeta } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';

function metaOf(sim: Sim, pid: number): PlayerMeta {
  return (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(pid)!;
}

describe('WoC Unleashed currency: end to end through the real Sim', () => {
  it('Claudemoon (durabilitySystemEnabled off): copper behaves exactly as always, no unleashedBalance', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'A');
    const meta = metaOf(sim, pid);
    meta.copper += 12_345;
    expect(meta.copper).toBe(12_345);
    expect(meta.unleashedBalance).toBeUndefined();
    const saved = sim.serializeCharacter(pid);
    expect(saved?.copper).toBe(12_345);
    expect(saved?.unleashedBalance).toBeUndefined();
  });

  it('WoC Unleashed: a fresh character starts at 0 $WOC, gameplay mutations land in unleashedBalance', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'B');
    const meta = metaOf(sim, pid);
    expect(meta.copper).toBe(0);
    expect(meta.unleashedBalance).toBe(0);
    // Every existing gameplay call site keeps saying meta.copper - it now
    // transparently operates on unleashedBalance instead.
    meta.copper += 50_000; // a loot/quest-reward-shaped grant
    expect(meta.unleashedBalance).toBe(50_000);
    meta.copper -= 20_000; // a vendor purchase/repair-shaped spend
    expect(meta.unleashedBalance).toBe(30_000);
    expect(meta.copper).toBe(30_000);
  });

  it('WoC Unleashed: the persisted save genuinely decouples the two fields', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const pid = sim.addPlayer('warrior', 'C');
    const meta = metaOf(sim, pid);
    meta.copper += 77_000;
    const saved = sim.serializeCharacter(pid);
    // The legacy field never carries the $WOC value: it saves as 0, exactly
    // like a brand new Claudemoon character, never 77_000.
    expect(saved?.copper).toBe(0);
    expect(saved?.unleashedBalance).toBe(77_000);
  });

  it('WoC Unleashed: a loaded character resumes from unleashedBalance, never from a stale copper value', () => {
    const sim = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      durabilitySystemEnabled: true,
    });
    const firstPid = sim.addPlayer('warrior', 'D');
    const realState = sim.serializeCharacter(firstPid) as CharacterState;
    // A real saved blob, with a stray legacy 999_999 that must never be read
    // (as if a bug or a manual DB edit left copper non-zero) and the real
    // authoritative unleashedBalance.
    const state: CharacterState = { ...realState, copper: 999_999, unleashedBalance: 8_500 };
    const pid = sim.addPlayer('warrior', 'E', { state });
    const meta = metaOf(sim, pid);
    // The legacy 999_999 in the saved blob (as if it were a stray/leftover
    // value) is never read; only unleashedBalance is authoritative.
    expect(meta.copper).toBe(8_500);
    expect(meta.unleashedBalance).toBe(8_500);
  });
});
