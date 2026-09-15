// The shared podium markup: three stepped plinths (silver, gold, bronze), each
// with its place disc, a name card, and the rank on the step. Every ranked
// board (each leaderboard tab today) paints its top three through here, so
// the podium looks and reads the same everywhere;
// each caller only supplies what its own card says (the name with its tags,
// the big number, and one detail line) as already-escaped HTML. The styles are
// the shared .lbp-* family in src/styles/components.css.
import { esc } from './esc';
import type { PodiumPlace } from './leaderboard_podium_view';

export interface PodiumSlotHtml {
  place: PodiumPlace;
  rankText: string;
  placeArt: string;
  /** False for an unclaimed place: the plinth stands, the card is empty. */
  filled: boolean;
  me: boolean;
  /** Escaped name markup (with any tag or "(You)" the caller adds). */
  nameHtml: string;
  /** Escaped main number markup; '' on an unclaimed place. */
  metricHtml: string;
  /** Escaped detail line markup; '' for none. */
  detailHtml: string;
}

function slotHtml(slot: PodiumSlotHtml): string {
  const classes =
    `lbp-slot lbp-slot-${slot.place}` +
    (slot.filled ? '' : ' lbp-slot-empty') +
    (slot.me ? ' lbp-mine' : '');
  const metric = slot.metricHtml ? `<span class="lbp-slot-metric">${slot.metricHtml}</span>` : '';
  const detail = slot.detailHtml ? `<span class="lbp-slot-detail">${slot.detailHtml}</span>` : '';
  return (
    `<li class="${classes}" data-podium-place="${slot.place}">` +
    `<span class="lbp-slot-medal" style="--lbp-medal:url('${esc(slot.placeArt)}')" aria-hidden="true"></span>` +
    `<span class="lbp-slot-card"><span class="lbp-slot-name">${slot.nameHtml}</span>${metric}${detail}</span>` +
    `<span class="lbp-plinth lbp-plinth-${slot.place}"><span class="lbp-plinth-rank">${esc(slot.rankText)}</span></span></li>`
  );
}

/** The whole podium list, or '' when there is nothing to stand on it. */
export function podiumHtml(slots: readonly PodiumSlotHtml[], label: string): string {
  if (slots.length === 0) return '';
  return `<ol class="lbp-podium" aria-label="${esc(label)}">${slots.map(slotHtml).join('')}</ol>`;
}
