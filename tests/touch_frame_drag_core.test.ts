// The touch-layout drag of the class engine indicators, pure half
// (src/ui/touch_frame_drag_core.ts): the frames table resolves exactly the
// three engine indicators against the unlock registry under the pre-registry
// storage keys, the viewport-fraction clamp keeps a frame's VISUAL body inside
// the safe area, the storage round-trip survives malformed input, and the drag
// arithmetic keeps the grab offset. The DOM attacher is the thin consumer
// (tests/touch_frame_drag.test.ts).
import { describe, expect, it } from 'vitest';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
import { transferKeyAllowed } from '../src/ui/settings_transfer_core';
import {
  clampTouchFrameAnchor,
  draggedTouchFrameAnchor,
  parseTouchFrameAnchor,
  serializeTouchFrameAnchor,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAG_STORAGE_KEYS,
  touchFrameAnchorCss,
} from '../src/ui/touch_frame_drag_core';

describe('TOUCH_DRAG_FRAMES', () => {
  it('names exactly the three class engine indicators, resolved against the unlock registry', () => {
    expect(TOUCH_DRAG_FRAMES.map((row) => row.frameId)).toEqual([
      'procOverlay',
      'paladinDevotion',
      'doomMeter',
    ]);
    for (const row of TOUCH_DRAG_FRAMES) {
      const spec = HUD_FRAME_SPECS.find((s) => s.id === row.frameId);
      expect(spec, row.frameId).toBeDefined();
      expect(row.elementId, row.frameId).toBe(spec?.elementId);
    }
    // The elements the desktop editor moves, by their real ids.
    expect(TOUCH_DRAG_FRAMES.map((row) => row.elementId)).toEqual([
      'proc-overlay',
      'paladin-devotion-frame',
      'warlock-doom-frame',
    ]);
  });

  it('keeps the pre-registry storage keys, so a parked phoenix or medallion is found where it was left', () => {
    const keys = Object.fromEntries(TOUCH_DRAG_FRAMES.map((row) => [row.frameId, row.storageKey]));
    expect(keys).toEqual({
      procOverlay: 'procOverlayAnchor',
      paladinDevotion: 'paladinDevotionAnchor',
      doomMeter: 'warlockDoomAnchor',
    });
    expect(TOUCH_DRAG_STORAGE_KEYS).toEqual(TOUCH_DRAG_FRAMES.map((row) => row.storageKey));
    expect(new Set(TOUCH_DRAG_STORAGE_KEYS).size).toBe(TOUCH_DRAG_FRAMES.length);
  });

  it('never shares a key with a registry row: the desktop spot and the touch spot coexist', () => {
    const registryKeys = new Set(HUD_FRAME_SPECS.map((s) => s.storageKey));
    for (const key of TOUCH_DRAG_STORAGE_KEYS) expect(registryKeys.has(key), key).toBe(false);
  });

  it('rides the FULL transfer code like the two anchors always did, never the layout code', () => {
    for (const key of TOUCH_DRAG_STORAGE_KEYS) {
      expect(transferKeyAllowed('full', key), key).toBe(true);
      expect(transferKeyAllowed('frames', key), key).toBe(false);
    }
  });
});

describe('clampTouchFrameAnchor', () => {
  it('keeps the whole element on screen', () => {
    // 300x232 element in a 1600x900 viewport: half-width = 150/1600.
    expect(clampTouchFrameAnchor(0, 0, 300, 232, 1600, 900)).toEqual({
      fx: 150 / 1600,
      fy: 116 / 900,
    });
    expect(clampTouchFrameAnchor(1, 1, 300, 232, 1600, 900)).toEqual({
      fx: 1 - 150 / 1600,
      fy: 1 - 116 / 900,
    });
  });

  it('passes an in-bounds anchor through unchanged', () => {
    expect(clampTouchFrameAnchor(0.5, 0.42, 300, 232, 1600, 900)).toEqual({ fx: 0.5, fy: 0.42 });
  });

  it('keeps the whole element clear of asymmetric mobile safe areas', () => {
    const safeArea = { top: 0, right: 44, bottom: 21, left: 12 };
    const bottomLeft = clampTouchFrameAnchor(0, 1, 72, 72, 844, 390, safeArea);
    expect(bottomLeft.fx).toBeCloseTo((12 + 36) / 844);
    expect(bottomLeft.fy).toBeCloseTo((390 - 21 - 36) / 390);
    const topRight = clampTouchFrameAnchor(1, 0, 72, 72, 844, 390, safeArea);
    expect(topRight.fx).toBeCloseTo((844 - 44 - 36) / 844);
    expect(topRight.fy).toBeCloseTo(36 / 390);
  });

  it('clamps by the VISUAL size it is given, so a scaled-down phoenix can reach the edges', () => {
    // The 300x232 overlay at the touch layout's 0.2 scale measures 60x46: its
    // center may sit 30px from a side, not 150px.
    expect(clampTouchFrameAnchor(0, 0.5, 60, 46, 844, 390)).toEqual({ fx: 30 / 844, fy: 0.5 });
  });

  it('centers an element wider than the usable area instead of pinning it to one side', () => {
    const wide = clampTouchFrameAnchor(0, 0.5, 1000, 46, 844, 390);
    expect(wide.fx).toBe(0.5);
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    const a = clampTouchFrameAnchor(Number.NaN, 0.5, 300, 232, 0, 0);
    expect(a.fx).toBe(0.5);
    expect(Number.isFinite(a.fy)).toBe(true);
  });
});

describe('the storage round-trip', () => {
  it('serializes and parses an anchor exactly', () => {
    const raw = serializeTouchFrameAnchor({ fx: 0.25, fy: 0.75 });
    expect(JSON.parse(raw)).toEqual({ fx: 0.25, fy: 0.75 });
    expect(parseTouchFrameAnchor(raw)).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it('clamps a stored anchor into 0..1 and rejects anything malformed', () => {
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: 1.5, fy: -2 }))).toEqual({ fx: 1, fy: 0 });
    expect(parseTouchFrameAnchor(null)).toBeNull();
    expect(parseTouchFrameAnchor('')).toBeNull();
    expect(parseTouchFrameAnchor('garbage')).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: '0.5', fy: 0.5 }))).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: Number.NaN, fy: 0.5 }))).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fy: 0.5 }))).toBeNull();
  });
});

describe('draggedTouchFrameAnchor', () => {
  it('puts the center where the pointer is, minus the offset it grabbed the frame at', () => {
    // Grabbed 20px right of and 13px below the center, now at (420, 213).
    expect(draggedTouchFrameAnchor(420, 213, 20, 13, 1000, 500)).toEqual({ fx: 0.4, fy: 0.4 });
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    expect(draggedTouchFrameAnchor(10, 10, 0, 0, 0, 0)).toEqual({ fx: 0.5, fy: 0.5 });
  });
});

describe('touchFrameAnchorCss', () => {
  it('writes the anchor as two-decimal percentages', () => {
    expect(touchFrameAnchorCss({ fx: 0.5, fy: 0.42 })).toEqual({ x: '50.00%', y: '42.00%' });
    expect(touchFrameAnchorCss({ fx: 1 / 3, fy: 2 / 3 })).toEqual({ x: '33.33%', y: '66.67%' });
  });
});
