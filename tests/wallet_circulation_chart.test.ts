import { describe, expect, it } from 'vitest';
import { circulationGeometry } from '../src/ui/wallet_circulation_chart';

describe('circulationGeometry', () => {
  it('scales bars to the largest single-day total on either side', () => {
    const geo = circulationGeometry(
      [
        { day: '2026-09-01', inCopper: 100, outCopper: 50 },
        { day: '2026-09-02', inCopper: 40, outCopper: 200 },
      ],
      200,
      100,
    );
    expect(geo.maxCopper).toBe(200);
    expect(geo.bars).toHaveLength(2);
    expect(geo.bars[1].outHeight).toBeCloseTo(96, 0); // full height minus the 4px pad
  });

  it('handles an empty series without dividing by zero', () => {
    const geo = circulationGeometry([], 200, 100);
    expect(geo.bars).toEqual([]);
    expect(geo.maxCopper).toBe(1);
  });

  it('places a single day at the horizontal center', () => {
    const geo = circulationGeometry([{ day: '2026-09-01', inCopper: 10, outCopper: 10 }], 200, 100);
    expect(geo.bars[0].x).toBe(100);
  });
});
