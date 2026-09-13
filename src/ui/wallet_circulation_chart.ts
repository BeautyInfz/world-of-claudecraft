// WoC Unleashed wallet panel: the "in-game circulation" chart (loot/quest/
// boss $WOC entering vs. repair/fee/claim $WOC leaving, per day). Pure
// geometry + a thin canvas painter, the src/ui/perf_graph_painter.ts split.

export interface CirculationDayInput {
  day: string;
  inCopper: number;
  outCopper: number;
}

export interface CirculationBar {
  x: number;
  inHeight: number;
  outHeight: number;
}

export interface CirculationGeometry {
  maxCopper: number;
  barWidth: number;
  bars: CirculationBar[];
}

/** Pure: maps daily in/out totals to paired-bar coordinates, auto-scaled to
 *  the largest single-day total on either side. No canvas, no DOM. */
export function circulationGeometry(
  days: readonly CirculationDayInput[],
  cssW: number,
  cssH: number,
): CirculationGeometry {
  const n = days.length;
  let maxCopper = 1;
  for (const d of days) maxCopper = Math.max(maxCopper, d.inCopper, d.outCopper);
  const barWidth = n > 0 ? cssW / n / 2.5 : 0;
  const bars: CirculationBar[] = days.map((d, i) => ({
    x: n <= 1 ? cssW / 2 : (i / Math.max(1, n - 1)) * (cssW - barWidth * 2) + barWidth,
    inHeight: (d.inCopper / maxCopper) * (cssH - 4),
    outHeight: (d.outCopper / maxCopper) * (cssH - 4),
  }));
  return { maxCopper, barWidth, bars };
}

export interface PaintCirculationOpts {
  days: readonly CirculationDayInput[];
  cssW: number;
  cssH: number;
  inColor: string;
  outColor: string;
}

/** Draw paired in/out bars into an already CSS-sized 2D context. No-op for
 *  an empty series. */
export function paintCirculationChart(
  ctx: CanvasRenderingContext2D,
  o: PaintCirculationOpts,
): void {
  ctx.clearRect(0, 0, o.cssW, o.cssH);
  if (o.days.length === 0) return;
  const { barWidth, bars } = circulationGeometry(o.days, o.cssW, o.cssH);
  ctx.fillStyle = o.inColor;
  for (const bar of bars) {
    ctx.fillRect(bar.x - barWidth, o.cssH - bar.inHeight, barWidth * 0.9, bar.inHeight);
  }
  ctx.fillStyle = o.outColor;
  for (const bar of bars) {
    ctx.fillRect(bar.x + barWidth * 0.1, o.cssH - bar.outHeight, barWidth * 0.9, bar.outHeight);
  }
}
