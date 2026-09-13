// WoC Unleashed-exclusive: makes a character's $WOC balance a GENUINELY
// separate ledger from the shared `copper` field Claudemoon uses, without
// requiring every gameplay call site in the sim (100+ sites across 29 files:
// loot, quest rewards, vendors, banking, mail, the World Market, guild
// treasuries, repair) to be rewritten to know which field to touch.
//
// The mechanism: bindUnleashedCurrency redefines `meta.copper` as a live accessor
// that transparently reads/writes `meta.unleashedBalance` instead of a private
// backing value - the exact same "one field, redirected to the real backing
// source" pattern src/sim/sim_context.ts already uses throughout
// (SimContextHost's `get devCommands() { return sim.devCommands; }` and
// dozens of siblings). Every existing `meta.copper += x` / `-= x` / `< x`
// site keeps compiling and running completely unchanged, but on a bound
// character it is operating on unleashedBalance, never on copper - the two are
// never summed, never read from each other, and persist under separate
// JSONB keys (server/game.ts's save path and src/sim/sim.ts's load path own
// that half; see their WoC Unleashed comments).
//
// Called ONCE per character, at creation and at load (never mid-session):
// binding it lazily per-read would mean a stale closure could rebind against
// a `meta` that a later reassignment (e.g. state.copper = s.copper on load)
// replaces the object identity of - by installing the accessor on the exact
// object every other system holds a reference to, there is no such race.

import type { PlayerMeta } from './sim';

/** Install the copper<->unleashedBalance redirect on a WoC Unleashed character's
 *  meta object. A no-op when `enabled` is false (Claudemoon: copper stays an
 *  ordinary data field, never touched by this module) or when already bound
 *  (idempotent: a second call on the same object is harmless). */
export function bindUnleashedCurrency(meta: PlayerMeta, enabled: boolean): void {
  if (!enabled) return;
  const existing = Object.getOwnPropertyDescriptor(meta, 'copper');
  if (existing && typeof existing.get === 'function') return; // already bound
  if (meta.unleashedBalance === undefined) meta.unleashedBalance = 0;
  Object.defineProperty(meta, 'copper', {
    enumerable: true,
    configurable: true,
    get(): number {
      return meta.unleashedBalance ?? 0;
    },
    set(value: number): void {
      meta.unleashedBalance = value;
    },
  });
}
