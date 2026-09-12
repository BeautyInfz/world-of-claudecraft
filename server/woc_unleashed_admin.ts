// The WoC Unleashed emission-cap admin API (registry-only RouteDefs, the
// new-route rule: no legacy ladder arm). Two thin handlers over
// woc_unleashed_emission_db.ts:
//
//   GET  /admin/api/woc-unleashed/emission-cap   read the current counters + cap
//   POST /admin/api/woc-unleashed/emission-cap   set a new cap (audit-logged)
//
// Permissions (admin_permissions.ts + admin_routes.ts): the read rides
// woc.emission.read, the write rides woc.emission.manage, so a viewer-tier
// role can never move the cap. Bodies use the legacy admin envelope
// ({ success, data, error }) like every /admin/api route.
//
// These routes exist regardless of WOC_UNLEASHED (an admin should be able to
// inspect/configure the cap before flipping the flag on a deployment), but
// every OTHER WoC Unleashed system (durability, the claim flow, the wallet
// panel) must still gate on WOC_UNLEASHED itself, not on these routes being
// reachable.

import { requireAdmin } from './admin';
import { pool } from './db';
import { withBody } from './http/middleware/body';
import { ADMIN_META, adminIdentityOf } from './http/middleware/require_admin';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import {
  type EmissionCapLogRow,
  type EmissionState,
  getEmissionState,
  listEmissionCapLog,
  setEmissionCap,
} from './woc_unleashed_emission_db';

// ---------------------------------------------------------------------------
// Db seam (the ad_spend.ts shape): the real bundle, swappable in tests.
// ---------------------------------------------------------------------------

const REAL_WOC_EMISSION_DB = {
  getEmissionState: (): Promise<EmissionState> => getEmissionState(pool),
  setEmissionCap: (capCopper: number, changedBy: string): Promise<EmissionState> =>
    setEmissionCap(pool, capCopper, changedBy),
  listEmissionCapLog: (limit: number): Promise<EmissionCapLogRow[]> =>
    listEmissionCapLog(pool, limit),
};
let wocEmissionDb = REAL_WOC_EMISSION_DB;

/** Override the emission db bundle with a fake (test-only; merges over the
 *  CURRENT bundle; resetWocUnleashedEmissionDbForTests restores the real one). */
export function setWocUnleashedEmissionDbForTests(
  overrides: Partial<typeof REAL_WOC_EMISSION_DB>,
): void {
  wocEmissionDb = { ...wocEmissionDb, ...overrides };
}

/** Restore the real bundle after a setWocUnleashedEmissionDbForTests override
 *  (test-only). */
export function resetWocUnleashedEmissionDbForTests(): void {
  wocEmissionDb = REAL_WOC_EMISSION_DB;
}

const ok = (ctx: Ctx, data: unknown): void =>
  json(ctx.res, 200, { success: true, data, error: null });
const failBody = (ctx: Ctx, status: number, error: string): void =>
  json(ctx.res, status, { success: false, data: null, error });

/** GET /admin/api/woc-unleashed/emission-cap: current counters + cap, plus the
 *  trailing cap-change audit log. */
async function getHandler(ctx: Ctx): Promise<void> {
  const [state, log] = await Promise.all([
    wocEmissionDb.getEmissionState(),
    wocEmissionDb.listEmissionCapLog(50),
  ]);
  ok(ctx, { state, log });
}

/** POST /admin/api/woc-unleashed/emission-cap: set a new cap (in $WOC, not
 *  copper - the admin-facing unit), audit-logged under the caller's username. */
async function setHandler(ctx: Ctx): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const capWoc = body.capWoc;
  if (typeof capWoc !== 'number' || !Number.isFinite(capWoc) || capWoc < 0) {
    failBody(ctx, 400, 'capWoc must be a non-negative number');
    return;
  }
  const changedBy = adminIdentityOf(ctx).username;
  try {
    const state = await wocEmissionDb.setEmissionCap(Math.round(capWoc * 10000), changedBy);
    ok(ctx, { state });
  } catch (err) {
    if (err instanceof TypeError) {
      failBody(ctx, 400, err.message);
      return;
    }
    throw err;
  }
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/admin/api/woc-unleashed/emission-cap',
    surface: 'admin',
    middleware: [requireAdmin],
    meta: ADMIN_META,
    handler: getHandler,
  },
  {
    method: 'POST',
    path: '/admin/api/woc-unleashed/emission-cap',
    surface: 'admin',
    middleware: [requireAdmin, withBody()],
    meta: ADMIN_META,
    handler: setHandler,
  },
];
