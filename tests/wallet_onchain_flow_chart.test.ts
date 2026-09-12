import { describe, expect, it } from 'vitest';
import { onchainFlowGeometry } from '../src/ui/wallet_onchain_flow_chart';

describe('onchainFlowGeometry', () => {
  it('auto-scales the y range to the min/max balance in the window', () => {
    const geo = onchainFlowGeometry(
      [
        { day: '2026-09-01', balanceWoc: 100 },
        { day: '2026-09-02', balanceWoc: 50 },
        { day: '2026-09-03', balanceWoc: 200 },
      ],
      300,
      100,
    );
    expect(geo.minWoc).toBe(50);
    expect(geo.maxWoc).toBe(200);
    expect(geo.points).toHaveLength(3);
    // The max-balance point sits near the top (small y); the min sits near
    // the bottom (large y).
    expect(geo.points[2].y).toBeLessThan(geo.points[1].y);
  });

  it('handles a flat series (no range) without dividing by zero', () => {
    const geo = onchainFlowGeometry(
      [
        { day: '2026-09-01', balanceWoc: 100 },
        { day: '2026-09-02', balanceWoc: 100 },
      ],
      300,
      100,
    );
    expect(Number.isFinite(geo.points[0].y)).toBe(true);
    expect(Number.isFinite(geo.points[1].y)).toBe(true);
  });

  it('handles an empty series', () => {
    const geo = onchainFlowGeometry([], 300, 100);
    expect(geo.points).toEqual([]);
    expect(geo.minWoc).toBe(0);
  });
});
