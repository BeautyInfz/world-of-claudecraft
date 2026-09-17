// The touch-layout drag of the class engine indicators, DOM half
// (src/ui/touch_frame_drag.ts): a one-finger drag on the touch layout moves a
// frame by its saved center and persists on drop, the desktop layout refuses
// the gesture (the Unlock Interface editor owns the frame there), a saved spot
// applies at attach and re-clamps from STORAGE on resize, reset hands the frame
// back to its stylesheet seat, and the table-driven attach covers exactly the
// three engine indicators. The attacher writes only the two custom properties
// and the class; the mobile stylesheet places the frame from them, which the
// CSS pins at the end hold. Per the repo testing convention this drives a
// small hand-rolled fake element and host (no jsdom).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachTouchFrameDrag,
  attachTouchFrameDrags,
  type TouchDragHost,
} from '../src/ui/touch_frame_drag';
import {
  TOUCH_ANCHOR_X_PROP,
  TOUCH_ANCHOR_Y_PROP,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAGGING_CLASS,
  TOUCH_PLACED_CLASS,
  type TouchSafeArea,
} from '../src/ui/touch_frame_drag_core';

type Listener = (ev: PointerEvent) => void;

class FakeEl {
  classes = new Set<string>();
  props = new Map<string, string>();
  rect = { left: 100, top: 100, width: 60, height: 46 };
  captured: number[] = [];
  private handlers = new Map<string, Listener[]>();
  classList = {
    add: (name: string) => {
      this.classes.add(name);
    },
    remove: (name: string) => {
      this.classes.delete(name);
    },
  };
  style = {
    setProperty: (name: string, value: string) => {
      this.props.set(name, value);
    },
    removeProperty: (name: string) => {
      this.props.delete(name);
    },
  };
  getBoundingClientRect() {
    return this.rect;
  }
  addEventListener(type: string, listener: Listener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener);
    this.handlers.set(type, list);
  }
  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }
  fire(type: string, ev: PointerEvent): void {
    for (const listener of this.handlers.get(type) ?? []) listener(ev);
  }
}

interface FakePointer extends PointerEvent {
  prevented: boolean;
  stopped: boolean;
}

function pointer(
  clientX: number,
  clientY: number,
  over: Partial<{
    pointerId: number;
    isPrimary: boolean;
    button: number;
    target: unknown;
  }> = {},
): FakePointer {
  const ev = {
    clientX,
    clientY,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      ev.prevented = true;
    },
    stopPropagation() {
      ev.stopped = true;
    },
    ...over,
  };
  return ev as unknown as FakePointer;
}

interface FakeHost extends TouchDragHost {
  store: Map<string, string>;
  size: { w: number; h: number };
  insets: TouchSafeArea;
  resize(): void;
}

function fakeHost(seed: Record<string, string> = {}): FakeHost {
  const store = new Map(Object.entries(seed));
  const listeners: Array<() => void> = [];
  const host: FakeHost = {
    store,
    size: { w: 844, h: 390 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    viewport: () => ({ ...host.size }),
    safeArea: () => ({ ...host.insets }),
    onResize: (listener) => {
      listeners.push(listener);
    },
    resize: () => {
      for (const listener of listeners) listener();
    },
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
    },
  };
  return host;
}

const KEY = 'procOverlayAnchor';
const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

function attach(el: FakeEl, host: FakeHost, touch = true) {
  return attachTouchFrameDrag(el, { storageKey: KEY, isTouchLayout: () => touch, host });
}

describe('attachTouchFrameDrag', () => {
  it('leaves a frame with no saved spot on its stylesheet seat', () => {
    const el = new FakeEl();
    const drag = attach(el, fakeHost());
    expect(drag.anchor).toBeNull();
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(false);
    expect(el.props.size).toBe(0);
  });

  it('moves the frame by its center on a touch-layout drag and persists the spot on drop', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host);
    // Grabbed 20px left of and 13px above the 60x46 frame's center (130, 123).
    const down = pointer(110, 110);
    el.fire('pointerdown', down);
    expect(down.prevented).toBe(true);
    expect(down.stopped).toBe(true);
    expect(el.captured).toEqual([1]);
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(true);
    // The center follows the finger with the grab offset kept: (420, 213).
    el.fire('pointermove', pointer(400, 200));
    expect(drag.anchor).toEqual({ fx: 420 / 844, fy: 213 / 390 });
    expect(el.props.get(TOUCH_ANCHOR_X_PROP)).toBe(pct(420 / 844));
    expect(el.props.get(TOUCH_ANCHOR_Y_PROP)).toBe(pct(213 / 390));
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    // Nothing reaches storage until the drop.
    expect(host.store.has(KEY)).toBe(false);
    el.fire('pointerup', pointer(400, 200));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    expect(JSON.parse(host.store.get(KEY) ?? '')).toEqual({ fx: 420 / 844, fy: 213 / 390 });
  });

  it('refuses the gesture on the desktop layout, where the Unlock Interface editor owns the frame', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host, false);
    const down = pointer(110, 110);
    el.fire('pointerdown', down);
    el.fire('pointermove', pointer(400, 200));
    el.fire('pointerup', pointer(400, 200));
    expect(down.prevented).toBe(false);
    expect(down.stopped).toBe(false);
    expect(drag.anchor).toBeNull();
    expect(el.classes.size).toBe(0);
    expect(host.store.has(KEY)).toBe(false);
  });

  it('ignores a second finger, a non-primary press, and a press on a control inside the frame', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(110, 110, { isPrimary: false }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    el.fire('pointerdown', pointer(110, 110, { target: { closest: () => ({}) } }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    // A live drag: another pointer's down and moves never steer it.
    el.fire('pointerdown', pointer(110, 110));
    el.fire('pointerdown', pointer(500, 300, { pointerId: 2 }));
    el.fire('pointermove', pointer(700, 350, { pointerId: 2 }));
    expect(drag.anchor).toBeNull();
    el.fire('pointerup', pointer(700, 350, { pointerId: 2 }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(true);
    el.fire('pointermove', pointer(400, 200));
    expect(drag.anchor).toEqual({ fx: 420 / 844, fy: 213 / 390 });
    el.fire('pointercancel', pointer(400, 200));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    expect(host.store.has(KEY)).toBe(true);
  });

  it('keeps the whole visual body inside the viewport and the safe area', () => {
    const el = new FakeEl();
    const host = fakeHost();
    host.insets = { top: 0, right: 44, bottom: 21, left: 12 };
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(-500, -500));
    expect(drag.anchor?.fx).toBeCloseTo((12 + 30) / 844);
    expect(drag.anchor?.fy).toBeCloseTo(23 / 390);
    el.fire('pointermove', pointer(5000, 5000));
    expect(drag.anchor?.fx).toBeCloseTo((844 - 44 - 30) / 844);
    expect(drag.anchor?.fy).toBeCloseTo((390 - 21 - 23) / 390);
  });

  it('applies a saved spot at attach and re-clamps it from STORAGE on resize', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.9, fy: 0.9 }) });
    const drag = attach(el, host);
    expect(drag.anchor).toEqual({ fx: 0.9, fy: 0.9 });
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    expect(el.props.get(TOUCH_ANCHOR_X_PROP)).toBe('90.00%');
    // A smaller viewport clamps the 46px-tall frame's center up to 1 - 23/200.
    host.size = { w: 300, h: 200 };
    host.resize();
    expect(drag.anchor?.fx).toBeCloseTo(0.9);
    expect(drag.anchor?.fy).toBeCloseTo(1 - 23 / 200);
    // Growing back restores the exact saved spot: the clamp was never persisted.
    host.size = { w: 844, h: 390 };
    host.resize();
    expect(drag.anchor).toEqual({ fx: 0.9, fy: 0.9 });
    expect(JSON.parse(host.store.get(KEY) ?? '')).toEqual({ fx: 0.9, fy: 0.9 });
  });

  it('leaves a mid-drag resize to the live drag', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.2, fy: 0.2 }) });
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(400, 200));
    host.resize();
    expect(drag.anchor).toEqual({ fx: 400 / 844, fy: 200 / 390 });
  });

  it('keeps the seat on malformed storage', () => {
    const el = new FakeEl();
    const drag = attach(el, fakeHost({ [KEY]: 'garbage' }));
    expect(drag.anchor).toBeNull();
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(false);
  });

  it('survives a store that throws', () => {
    const el = new FakeEl();
    const host = fakeHost();
    host.storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(400, 200));
    el.fire('pointerup', pointer(400, 200));
    expect(drag.anchor).toEqual({ fx: 400 / 844, fy: 200 / 390 });
    expect(() => drag.reset()).not.toThrow();
  });

  it('reset forgets the saved spot and hands the frame back to its seat', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) });
    const drag = attach(el, host);
    drag.reset();
    expect(drag.anchor).toBeNull();
    expect(el.classes.size).toBe(0);
    expect(el.props.size).toBe(0);
    expect(host.store.has(KEY)).toBe(false);
    // And a resize after the reset re-places nothing.
    host.resize();
    expect(el.classes.size).toBe(0);
  });
});

describe('attachTouchFrameDrags', () => {
  function fakeDocument(present: string[]) {
    const els = new Map(present.map((id) => [id, new FakeEl()]));
    return {
      els,
      doc: {
        getElementById: (id: string) => (els.get(id) as unknown as HTMLElement) ?? null,
      } as Pick<Document, 'getElementById'>,
    };
  }

  it('attaches the three engine indicators by their registry element ids', () => {
    const ids = TOUCH_DRAG_FRAMES.map((row) => row.elementId);
    const { els, doc } = fakeDocument(ids);
    const host = fakeHost(
      Object.fromEntries(
        TOUCH_DRAG_FRAMES.map((row) => [row.storageKey, JSON.stringify({ fx: 0.4, fy: 0.6 })]),
      ),
    );
    const drags = attachTouchFrameDrags(doc, () => true, host);
    expect(drags.drags).toHaveLength(3);
    for (const id of ids) expect(els.get(id)?.classes.has(TOUCH_PLACED_CLASS), id).toBe(true);
    drags.resetAll();
    for (const id of ids) expect(els.get(id)?.classes.size, id).toBe(0);
    expect(host.store.size).toBe(0);
  });

  it('skips a frame missing from the document, like the unlock registry does', () => {
    const { doc } = fakeDocument(['proc-overlay']);
    const drags = attachTouchFrameDrags(doc, () => true, fakeHost());
    expect(drags.drags).toHaveLength(1);
    expect(() => drags.refreshAll()).not.toThrow();
  });
});

// The stylesheet half of the contract: the attacher writes only the class and
// the two custom properties, so the touch layer must (a) hand pointer events
// back and pin touch-action on the grabbable states and (b) place a stamped
// frame from those properties, the doom meter re-anchored off its bottom seat.
describe('the touch layer places a stamped engine indicator', () => {
  const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
  const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('hands pointer events back on the lit phoenix, the warlock artwork, the medallion and the doom meter', () => {
    const block = mobileCss.match(
      /body\.mobile-touch #proc-overlay\.preview,[\s\S]*?body\.mobile-touch \.warlock-doom-frame \{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    const selectors = block?.[0] ?? '';
    for (const lit of [
      '#proc-overlay.heating',
      '#proc-overlay.hot',
      '#proc-overlay.combustion',
      '#proc-overlay.chrono.c1',
      '#proc-overlay.frost.f1',
      '#proc-overlay.necromancy .soul-rail',
      '#proc-overlay.necromancy .soul-crystal',
      '#proc-overlay.destruction .ruin-ritual',
      '#proc-overlay.destruction .ruin-mark',
      '.paladin-devotion-frame',
      '.warlock-doom-frame',
    ])
      expect(selectors, lit).toContain(`body.mobile-touch ${lit}`);
    const body = block?.[1] ?? '';
    expect(body).toContain('pointer-events: auto;');
    expect(body).toContain('touch-action: none;');
    expect(body).toContain('-webkit-touch-callout: none;');
  });

  it('places the proc overlay and the medallion from the anchor properties under the placed class', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `body\\.mobile-touch #proc-overlay\\.${TOUCH_PLACED_CLASS},\\s*body\\.mobile-touch \\.paladin-devotion-frame\\.${TOUCH_PLACED_CLASS} \\{\\s*left: var\\(${TOUCH_ANCHOR_X_PROP}\\);\\s*top: var\\(${TOUCH_ANCHOR_Y_PROP}\\);\\s*\\}`,
      ),
    );
  });

  it('re-anchors the doom meter off its bottom seat and centres it on both axes', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `body\\.mobile-touch \\.warlock-doom-frame\\.${TOUCH_PLACED_CLASS} \\{\\s*left: var\\(${TOUCH_ANCHOR_X_PROP}\\);\\s*top: var\\(${TOUCH_ANCHOR_Y_PROP}\\);\\s*bottom: auto;\\s*transform: translate\\(-50%, -50%\\);\\s*\\}`,
      ),
    );
  });

  it('is attached by the Hud beside the desktop editor and reset with the layout', () => {
    expect(hudTs).toContain(
      'this.touchFrameDrags = attachTouchFrameDrags(document, isMobileLayout);',
    );
    const reset = hudTs.slice(hudTs.indexOf('resetUnitFrames(): void {'));
    expect(reset.slice(0, reset.indexOf('\n  }\n'))).toContain('this.touchFrameDrags?.resetAll();');
  });
});
