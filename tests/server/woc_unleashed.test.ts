// Pins the WoC Unleashed identity flag: unset/garbage must resolve to false (the
// Claudemoon-safe default), and only the exact '1' turns it on. This is the gate
// every WoC Unleashed-exclusive system (durability, claim flow, emission cap,
// wallet panel) is required to check, so a regression here would silently leak
// those systems onto every Claudemoon deployment.
import { describe, expect, it } from 'vitest';
import { resolveWocUnleashed } from '../../server/woc_unleashed';

describe('resolveWocUnleashed', () => {
  it('defaults to false when WOC_UNLEASHED is unset or empty', () => {
    expect(resolveWocUnleashed(undefined)).toBe(false);
    expect(resolveWocUnleashed('')).toBe(false);
  });

  it('is true only for the exact literal "1"', () => {
    expect(resolveWocUnleashed('1')).toBe(true);
  });

  it('treats any other value as off, including near-misses', () => {
    expect(resolveWocUnleashed('true')).toBe(false);
    expect(resolveWocUnleashed('yes')).toBe(false);
    expect(resolveWocUnleashed('01')).toBe(false);
    expect(resolveWocUnleashed(' 1')).toBe(false);
    expect(resolveWocUnleashed('0')).toBe(false);
  });
});

describe('module-scope WOC_UNLEASHED / DURABILITY_SYSTEM_ENABLED', () => {
  it('default to false for a process that never sets WOC_UNLEASHED (the Claudemoon case)', async () => {
    // This test process does not set WOC_UNLEASHED, so importing the real module
    // proves the actual boot-time default a Claudemoon deployment gets, not just
    // the pure function in isolation.
    const mod = await import('../../server/woc_unleashed');
    expect(mod.WOC_UNLEASHED).toBe(false);
    expect(mod.DURABILITY_SYSTEM_ENABLED).toBe(false);
  });
});
