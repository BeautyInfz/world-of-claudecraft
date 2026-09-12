// Server-side capture of WoC Unleashed currency-affecting SimEvents into the
// off-chain ledger (server/woc_unleashed_wallet_db.ts) and the emission-cap
// net-circulating counter (server/woc_unleashed_emission_db.ts). Sim code
// cannot import server/ code (src/sim/ has zero server/db dependencies by
// invariant), so this is the server-side half of every WoC Unleashed
// currency sink/source: it scans the drained per-tick SimEvent batch the
// same way detectActivity/parseCapture already do (server/game.ts) and
// writes the durable rows the sim itself could never write.
//
// Kept OUT of server/game.ts (a monolith-ratchet-capped file already at its
// line ceiling) so the tick loop's footprint there stays a single call.
//
// Currently handles one event: 'wocRepair' (src/sim/types.ts SimEvent,
// emitted by src/sim/items.ts's repairItem). A future claim/loot/quest sink
// or source lands here as a sibling branch, not a new game.ts hook.

import type { SimEvent } from '../src/sim/types';
import { pool } from './db';
import { WOC_UNLEASHED } from './woc_unleashed';
import { recordSink } from './woc_unleashed_emission_db';
import { recordLedgerEvent } from './woc_unleashed_wallet_db';

/** The two identity fields this module needs off a session; a real
 *  ClientSession (server/game.ts) satisfies this structurally. */
export interface WocUnleashedLedgerIdentity {
  accountId: number;
  characterId: number;
}

/** Resolve a SimEvent's pid to the session identity that owns it, or
 *  undefined when no session is live for that pid (a stale/offline pid can
 *  never reach here in practice, since the event fired off a live player's
 *  own command, but the lookup stays total rather than assuming). */
export type WocUnleashedLedgerSessionLookup = (
  pid: number,
) => WocUnleashedLedgerIdentity | undefined;

/** Scan one tick's drained event batch for WoC Unleashed currency effects and
 *  persist them. Fire-and-forget (errors are logged, never thrown into the
 *  tick loop - a dropped ledger row must not crash a live realm); a no-op
 *  entirely when WOC_UNLEASHED is unset, so Claudemoon's tick loop does not
 *  even scan the batch for events it can never contain. */
export function recordWocUnleashedLedgerEvents(
  events: readonly SimEvent[],
  sessionForPid: WocUnleashedLedgerSessionLookup,
): void {
  if (!WOC_UNLEASHED) return;
  for (const ev of events) {
    if (ev.type !== 'wocRepair' || ev.pid === undefined) continue;
    const identity = sessionForPid(ev.pid);
    if (!identity) continue;
    void recordLedgerEvent(pool, {
      accountId: identity.accountId,
      characterId: identity.characterId,
      sourceSink: 'repair',
      amountCopper: -ev.amountCopper,
    }).catch((err) => console.error('woc unleashed repair ledger event failed:', err));
    void recordSink(pool, ev.amountCopper).catch((err) =>
      console.error('woc unleashed repair sink counter failed:', err),
    );
  }
}
