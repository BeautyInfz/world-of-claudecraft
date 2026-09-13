// Identifies whether this realm process is running as "WoC Unleashed" - the
// experimental $WOC-currency, on-chain-claim server variant - as opposed to the
// original "Claudemoon" server. Every WoC Unleashed-exclusive system (item
// durability/repair, the $WOC claim flow, the emission cap, the wallet UI panel)
// must gate on resolveWocUnleashed()/WOC_UNLEASHED so that, with the flag unset
// (the Claudemoon default), those code paths never run at all: Claudemoon stays
// behaviorally identical to upstream, not merely "toggled off". A domain
// feature-config getter that owns its own env read, same category as
// woc_balance.ts (see server/http/config.ts's header, exception (3)) - kept out
// of the validated Config on purpose so this flag has exactly one source of
// truth, never a config.ts mirror that could drift from a direct env read.
//
// Deliberately a SEPARATE flag from REALM_NAME/REALM_TYPE (server/realm.ts):
// realm identity is which shard a player is on, not which optional systems are
// compiled into that shard's behavior. Set WOC_UNLEASHED=1 only in the WoC
// Unleashed deployment's own env; every other deployment (including every
// Claudemoon realm process) must leave it unset.

const WOC_UNLEASHED_ON = '1';

// Pure so tests can exercise every input without touching process.env or
// reimporting the module. Mirrors realm.ts's resolveRealm: tolerant, never
// throws, unrecognized values fall back to the safe (off) default rather than
// crashing a boot over a typo'd env var.
export function resolveWocUnleashed(raw: string | undefined): boolean {
  return raw === WOC_UNLEASHED_ON;
}

export const WOC_UNLEASHED: boolean = resolveWocUnleashed(process.env.WOC_UNLEASHED);

// The item durability/repair system is WoC Unleashed-exclusive. For this first
// pass it tracks WOC_UNLEASHED 1:1 rather than getting its own env var: two
// independently-settable flags could drift (durability on without WoC
// Unleashed, or vice versa), which is exactly the kind of leakage the
// isolation principle forbids. If a future need arises to decouple them, give
// this its own validated flag rather than widening this one's meaning.
export const DURABILITY_SYSTEM_ENABLED: boolean = WOC_UNLEASHED;
