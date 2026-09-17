// Always-on one-finger drag for the class engine indicators on the TOUCH
// layout (the proc overlay, the paladin devotion medallion, the warlock doom
// meter): the touch counterpart of the desktop "Unlock interface" editor,
// which every touch layout refuses (MovableFrame no-ops its gestures there and
// the options row is never offered). Event-driven only (pointer events, one
// resize listener), no per-frame cost, so this is a plain sibling module the
// Hud attaches once, not a painter. The table, the clamp and the storage
// round-trip are the pure core touch_frame_drag_core.ts; this file is the DOM
// consumer, registered in tests/architecture.test.ts UI_DOM_MODULES.
//
// It never writes left/top itself. A drag stamps the anchor into two custom
// properties plus a class, and the mobile stylesheet places the frame from
// those (hud.mobile.css, the engine indicator block), so the desktop mover's
// inline geometry and this drag can never fight over one property: on a
// desktop layout the class rules are inert, and the mover's own mobile-layout
// pass, which strips its inline left/top there, leaves the touch spot intact.

import {
  clampTouchFrameAnchor,
  draggedTouchFrameAnchor,
  parseTouchFrameAnchor,
  serializeTouchFrameAnchor,
  TOUCH_ANCHOR_X_PROP,
  TOUCH_ANCHOR_Y_PROP,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAGGING_CLASS,
  TOUCH_PLACED_CLASS,
  type TouchFrameAnchor,
  type TouchSafeArea,
  touchFrameAnchorCss,
} from './touch_frame_drag_core';

/** The frame surface the drag needs: enough of HTMLElement for the gesture,
 *  and small enough for a hand-rolled test fake. */
export interface TouchDragElement {
  classList: { add(name: string): void; remove(name: string): void };
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(type: string, listener: (ev: PointerEvent) => void): void;
  setPointerCapture?(pointerId: number): void;
}

/** The persisted-anchor store: localStorage, or nothing when it is unavailable. */
export interface TouchDragStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Everything the attacher reaches outside the element: the viewport, the
 *  safe-area insets, the resize signal and the store. The browser host below
 *  is the production one; tests pass a fake. */
export interface TouchDragHost {
  viewport(): { w: number; h: number };
  safeArea(): TouchSafeArea;
  onResize(listener: () => void): void;
  storage: TouchDragStorage | null;
}

export interface TouchFrameDragDeps {
  storageKey: string;
  /** True on the touch layout (body.mobile-touch), the only layout the
   *  gesture is live on; the desktop editor owns the frame otherwise. */
  isTouchLayout(): boolean;
  host?: TouchDragHost;
}

export interface TouchFrameDrag {
  /** Re-clamp and re-apply the SAVED spot (a viewport change): from storage
   *  rather than the last render, so leaving a smaller viewport restores the
   *  exact saved location instead of making the clamp permanent. */
  refresh(): void;
  /** Forget the saved spot and hand the frame back to its stylesheet seat. */
  reset(): void;
  /** The anchor currently applied; null while the frame sits on its seat. */
  readonly anchor: TouchFrameAnchor | null;
}

function targetIsControl(ev: PointerEvent): boolean {
  const target = ev.target as { closest?: (selector: string) => unknown } | null;
  return !!target?.closest?.('button');
}

/**
 * Make `el` draggable on the touch layout and persistent under `storageKey`.
 * Applies the stored anchor immediately (if any) and re-clamps on resize.
 * The frame is expected to be grabbable only while its indicator is showing:
 * the stylesheet hands pointer events back per lit state, so an unlit overlay
 * never eats a tap meant for the world behind it.
 */
export function attachTouchFrameDrag(
  el: TouchDragElement,
  deps: TouchFrameDragDeps,
): TouchFrameDrag {
  const host = deps.host ?? browserTouchDragHost();
  let anchor: TouchFrameAnchor | null = null;
  let dragId: number | null = null;
  // Pointer-to-center offset at grab (px), held for the whole drag so the
  // frame never jumps under the thumb.
  let grabDx = 0;
  let grabDy = 0;

  const apply = (next: TouchFrameAnchor): void => {
    const rect = el.getBoundingClientRect();
    const { w, h } = host.viewport();
    anchor = clampTouchFrameAnchor(
      next.fx,
      next.fy,
      rect.width,
      rect.height,
      w,
      h,
      host.safeArea(),
    );
    const css = touchFrameAnchorCss(anchor);
    el.style.setProperty(TOUCH_ANCHOR_X_PROP, css.x);
    el.style.setProperty(TOUCH_ANCHOR_Y_PROP, css.y);
    el.classList.add(TOUCH_PLACED_CLASS);
  };
  const readSaved = (): TouchFrameAnchor | null => {
    try {
      return parseTouchFrameAnchor(host.storage?.getItem(deps.storageKey) ?? null);
    } catch {
      return null;
    }
  };
  const persist = (): void => {
    if (!anchor) return;
    try {
      host.storage?.setItem(deps.storageKey, serializeTouchFrameAnchor(anchor));
    } catch {
      /* storage unavailable */
    }
  };

  const saved = readSaved();
  if (saved) apply(saved);

  el.addEventListener('pointerdown', (ev) => {
    if (dragId !== null || !deps.isTouchLayout() || !ev.isPrimary || ev.button !== 0) return;
    if (targetIsControl(ev)) return;
    const rect = el.getBoundingClientRect();
    dragId = ev.pointerId;
    grabDx = ev.clientX - (rect.left + rect.width / 2);
    grabDy = ev.clientY - (rect.top + rect.height / 2);
    el.setPointerCapture?.(ev.pointerId);
    el.classList.add(TOUCH_DRAGGING_CLASS);
    ev.preventDefault();
    ev.stopPropagation();
  });
  el.addEventListener('pointermove', (ev) => {
    if (dragId !== ev.pointerId) return;
    const { w, h } = host.viewport();
    apply(draggedTouchFrameAnchor(ev.clientX, ev.clientY, grabDx, grabDy, w, h));
  });
  const drop = (ev: PointerEvent): void => {
    if (dragId !== ev.pointerId) return;
    dragId = null;
    el.classList.remove(TOUCH_DRAGGING_CLASS);
    persist();
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);

  const refresh = (): void => {
    // A mid-gesture resize is left alone: the live drag owns the spot and its
    // drop persists anyway.
    if (dragId !== null) return;
    const basis = readSaved() ?? anchor;
    if (basis) apply(basis);
  };
  host.onResize(refresh);

  const reset = (): void => {
    anchor = null;
    dragId = null;
    el.classList.remove(TOUCH_DRAGGING_CLASS);
    el.classList.remove(TOUCH_PLACED_CLASS);
    el.style.removeProperty(TOUCH_ANCHOR_X_PROP);
    el.style.removeProperty(TOUCH_ANCHOR_Y_PROP);
    try {
      host.storage?.removeItem(deps.storageKey);
    } catch {
      /* storage unavailable */
    }
  };

  return {
    refresh,
    reset,
    get anchor(): TouchFrameAnchor | null {
      return anchor;
    },
  };
}

export interface TouchFrameDrags {
  /** The attached drags, in TOUCH_DRAG_FRAMES order (a frame missing from the
   *  document is skipped, like the unlock registry skips it). */
  readonly drags: readonly TouchFrameDrag[];
  /** Forget every saved touch spot: the layout reset's touch half. */
  resetAll(): void;
  refreshAll(): void;
}

/** Attach the drag to every TOUCH_DRAG_FRAMES element in `doc`: the one call
 *  the Hud makes after registering the desktop movers. */
export function attachTouchFrameDrags(
  doc: Pick<Document, 'getElementById'>,
  isTouchLayout: () => boolean,
  host: TouchDragHost = browserTouchDragHost(),
): TouchFrameDrags {
  const drags = TOUCH_DRAG_FRAMES.flatMap((row) => {
    const el = doc.getElementById(row.elementId);
    return el
      ? [attachTouchFrameDrag(el, { storageKey: row.storageKey, isTouchLayout, host })]
      : [];
  });
  return {
    drags,
    resetAll: () => {
      for (const drag of drags) drag.reset();
    },
    refreshAll: () => {
      for (const drag of drags) drag.refresh();
    },
  };
}

// --- The browser host --------------------------------------------------------

/** One hidden inset probe per document: a fixed full-viewport box whose
 *  padding is the four env(safe-area-inset-*) values, read back as px. */
const SAFE_AREA_PROBES = new WeakMap<Document, HTMLElement>();

function safeAreaProbe(doc: Document): HTMLElement {
  const existing = SAFE_AREA_PROBES.get(doc);
  if (existing) return existing;
  const probe = doc.createElement('div');
  Object.assign(probe.style, {
    position: 'fixed',
    inset: '0',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  probe.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(probe);
  SAFE_AREA_PROBES.set(doc, probe);
  return probe;
}

function storageOf(win: Window): TouchDragStorage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/** The production host: the window's viewport and resize, the document's
 *  safe-area probe, and localStorage (null when the browser refuses it). */
export function browserTouchDragHost(
  doc: Document = document,
  win: Window = window,
): TouchDragHost {
  const pixels = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    viewport: () => ({ w: win.innerWidth, h: win.innerHeight }),
    safeArea: () => {
      const style = win.getComputedStyle(safeAreaProbe(doc));
      return {
        top: pixels(style.paddingTop),
        right: pixels(style.paddingRight),
        bottom: pixels(style.paddingBottom),
        left: pixels(style.paddingLeft),
      };
    },
    onResize: (listener) => win.addEventListener('resize', listener),
    storage: storageOf(win),
  };
}
