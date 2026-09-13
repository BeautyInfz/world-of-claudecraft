// WoC Unleashed wallet panel: the "on-chain flow" chart (the claim source
// wallet's own $WOC balance over time - refills raise it, claims lower it).
// Pure geometry + a thin canvas painter, the src/ui/perf_graph_painter.ts
// split.

export interface FlowDayInput {
  day: string;
  balanceWoc: number;
}

export interface FlowPoint {
  x: number;
  y: number;
}

export interface FlowGeometry {
  maxWoc: number;
  minWoc: number;
  points: FlowPoint[];
}

/** Pure: maps daily reserve balances to a single auto-scaled line's
 *  coordinates. No canvas, no DOM. */
export function onchainFlowGeometry(
  days: readonly FlowDayInput[],
  cssW: number,
  cssH: number,
): FlowGeometry {
  const n = days.length;
  let maxWoc = 0;
  let minWoc = Number.POSITIVE_INFINITY;
  for (const d of days) {
    maxWoc = Math.max(maxWoc, d.balanceWoc);
    minWoc = Math.min(minWoc, d.balanceWoc);
  }
  if (!Number.isFinite(minWoc)) minWoc = 0;
  const range = maxWoc - minWoc || 1;
  const yOf = (v: number): number => cssH - 1 - ((v - minWoc) / range) * (cssH - 2);
  const xOf = (i: number): number => (n <= 1 ? 0 : (i / (n - 1)) * cssW);
  const points = days.map((d, i) => ({ x: xOf(i), y: yOf(d.balanceWoc) }));
  return { maxWoc, minWoc, points };
}

export interface PaintFlowOpts {
  days: readonly FlowDayInput[];
  cssW: number;
  cssH: number;
  color: string;
}

/** Draw the reserve-balance line into an already CSS-sized 2D context.
 *  No-op for fewer than two points. */
export function paintOnchainFlowChart(ctx: CanvasRenderingContext2D, o: PaintFlowOpts): void {
  ctx.clearRect(0, 0, o.cssW, o.cssH);
  const { points } = onchainFlowGeometry(o.days, o.cssW, o.cssH);
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(0, o.cssH);
  for (const p of points) ctx.lineTo(p.x, p.y);
  ctx.lineTo(o.cssW, o.cssH);
  ctx.closePath();
  ctx.fillStyle = withAlpha(o.color, 0.14);
  ctx.fill();
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = withAlpha(o.color, 0.9);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(200, 168, 56, ${alpha})`;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
