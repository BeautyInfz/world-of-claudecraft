// The WoC Unleashed emission-cap admin endpoints (server/woc_unleashed_admin.ts):
// the shared admin auth gate, the get/set handlers through the routes table
// with the data seam faked (no Postgres), and the validation surface of
// woc_unleashed_emission_db's setEmissionCap. Real modules, no db module mock:
// nothing here is allowed to reach the pg pool (the ad_spend.test.ts idiom).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetAdminDbForTests, setAdminDbForTests } from '../../server/admin';
import {
  resetWocUnleashedEmissionDbForTests,
  routes,
  setWocUnleashedEmissionDbForTests,
} from '../../server/woc_unleashed_admin';
import type { EmissionState } from '../../server/woc_unleashed_emission_db';
import { fakeCtx } from './helpers';

const ADMIN_TOKEN = 'a'.repeat(64);
const PATH = '/admin/api/woc-unleashed/emission-cap';

function handlerFor(method: string, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route not found: ${method} ${path}`);
  return route;
}

async function runRoute(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; url?: string; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const route = handlerFor(method, path);
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    body: opts.body,
    headers: {
      authorization: `Bearer ${opts.token ?? ADMIN_TOKEN}`,
      'content-type': 'application/json',
    },
  });
  const chain = [...(route.middleware ?? [])];
  let i = 0;
  const next = async (): Promise<void> => {
    const mw = chain[i++];
    if (mw) await mw(ctx, next);
    else await route.handler(ctx);
  };
  await next();
  const res = ctx.res as unknown as {
    statusCode: number;
    body?: unknown;
    payload?: unknown;
    written?: string;
  };
  const raw =
    (res as { written?: string }).written ??
    (res as { payload?: unknown }).payload ??
    (res as { body?: unknown }).body;
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { status: res.statusCode, body };
}

const sampleState: EmissionState = {
  capCopper: 10_000_000_000,
  grossEmittedCopper: 1_234_500_000,
  netCirculatingCopper: 1_000_000_000,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  setAdminDbForTests({
    accountAndScopeForToken: async (token: string) =>
      token === ADMIN_TOKEN ? { accountId: 1, scope: 'full' as const } : null,
    adminRolesForAccount: async () => ({ username: 'ops', roles: ['admin'] }),
  });
  setWocUnleashedEmissionDbForTests({
    getEmissionState: async () => sampleState,
    setEmissionCap: async (capCopper) => ({ ...sampleState, capCopper }),
    listEmissionCapLog: async () => [
      {
        id: 1,
        changedBy: 'ops',
        oldCapCopper: 5_000_000_000,
        newCapCopper: sampleState.capCopper,
        createdAt: '2026-08-15T00:00:00.000Z',
      },
    ],
  });
});

afterEach(() => {
  resetWocUnleashedEmissionDbForTests();
  resetAdminDbForTests();
});

describe('auth gate', () => {
  it('rejects a missing or unknown bearer with the admin 401 envelope', async () => {
    const out = await runRoute('GET', PATH, { token: 'f'.repeat(64) });
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ success: false, error: 'admin authentication required' });
  });

  it('rejects a staff account without the write permission on POST', async () => {
    setAdminDbForTests({
      accountAndScopeForToken: async (token: string) =>
        token === ADMIN_TOKEN ? { accountId: 1, scope: 'full' as const } : null,
      adminRolesForAccount: async () => ({ username: 'viewer', roles: ['viewer'] }),
    });
    const read = await runRoute('GET', PATH);
    expect(read.status).toBe(403);
    const write = await runRoute('POST', PATH, { body: { capWoc: 2_000_000 } });
    expect(write.status).toBe(403);
  });
});

describe('handlers', () => {
  it('reads the current state and cap-change log', async () => {
    const out = await runRoute('GET', PATH);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      success: true,
      data: { state: sampleState, log: [{ changedBy: 'ops' }] },
    });
  });

  it('sets a new cap, converting the admin-facing $WOC unit to copper', async () => {
    const out = await runRoute('POST', PATH, { body: { capWoc: 2_000_000 } });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      success: true,
      data: { state: { capCopper: 2_000_000 * 10_000 } },
    });
  });

  it('rejects a missing or negative capWoc before touching the db', async () => {
    const missing = await runRoute('POST', PATH, { body: {} });
    expect(missing.status).toBe(400);
    const negative = await runRoute('POST', PATH, { body: { capWoc: -1 } });
    expect(negative.status).toBe(400);
  });

  it('maps a validation TypeError from setEmissionCap to a 400 admin envelope', async () => {
    setWocUnleashedEmissionDbForTests({
      setEmissionCap: async () => {
        throw new TypeError('capCopper must be a non-negative integer');
      },
    });
    const out = await runRoute('POST', PATH, { body: { capWoc: 1 } });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({
      success: false,
      error: 'capCopper must be a non-negative integer',
    });
  });
});
