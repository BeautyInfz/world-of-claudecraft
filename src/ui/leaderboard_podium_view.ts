// Pure view core for the top-three podium every ranked board shares: each tab
// of the leaderboard window, and any later ranked window that wants the same top three.
//
// It splits one resolved page into the podium (ranks 1 to 3, first page only)
// and the rows listed under it, and fixes the podium's own rules in one place:
// display order silver, gold, bronze (the tallest step in the middle), the
// disc art ALWAYS by place and never by anything a row earned, and an
// unclaimed place still standing as an empty plinth. It also decides the
// viewer's standing bar for the boards whose page can answer it without a
// server round trip. DOM-free; leaderboard_podium_html.ts paints the slots.
import { formatNumber } from './i18n';

export type PodiumPlace = 1 | 2 | 3;
export type PodiumMedal = 'gold' | 'silver' | 'bronze';

/** Where the medal art lives (public/, served verbatim). A missing file
 *  degrades to the stylesheet's gradient, so a podium never breaks on art. */
export const LEADERBOARD_MEDAL_ART_DIR = 'ui/leaderboard';

export function leaderboardMedalArt(medal: PodiumMedal): string {
  return `${LEADERBOARD_MEDAL_ART_DIR}/medal_${medal}.webp`;
}

/** Silver left, gold centre, bronze right. */
export const PODIUM_DISPLAY_ORDER: readonly PodiumPlace[] = [2, 1, 3];

export const PODIUM_PLACE_MEDAL: Readonly<Record<PodiumPlace, PodiumMedal>> = {
  1: 'gold',
  2: 'silver',
  3: 'bronze',
};

export interface PodiumSlot<T> {
  place: PodiumPlace;
  rankText: string;
  /** The disc: gold, silver, bronze by place. */
  placeArt: string;
  /** The row holding the place, or null for an unclaimed plinth. */
  entry: T | null;
}

export interface PodiumSplit<T> {
  /** Display order; empty off the first page or on an empty page. */
  podium: PodiumSlot<T>[];
  /** The rows under the podium: rank 4 on the first page, every row after. */
  listed: T[];
}

/** Split one page into its podium and the rows listed beneath it. */
export function podiumSplit<T>(
  pageIndex: number,
  entries: readonly T[],
  rankOf: (entry: T) => number,
): PodiumSplit<T> {
  if (pageIndex !== 0 || entries.length === 0) return { podium: [], listed: [...entries] };
  const podium = PODIUM_DISPLAY_ORDER.map((place) => ({
    place,
    rankText: formatNumber(place, { maximumFractionDigits: 0 }),
    placeArt: leaderboardMedalArt(PODIUM_PLACE_MEDAL[place]),
    entry: entries.find((entry) => rankOf(entry) === place) ?? null,
  }));
  return { podium, listed: entries.filter((entry) => rankOf(entry) > 3) };
}

/** The viewer's own row on the loaded page (a `me`-flagged board), or null. */
export function viewerRowOnPage<T extends { me: boolean }>(rows: readonly T[]): T | null {
  return rows.find((row) => row.me) ?? null;
}

/** The players board's standing bar: the viewer's ranked row when it is on
 *  the page, else the off-page standing the core already derived (no rank),
 *  else nothing. */
export function playersStandingBar<S extends object>(
  rows: readonly (S & { me: boolean; rank: number })[],
  offPage: S | null,
): (S & { rank: number | null }) | null {
  const mine = viewerRowOnPage(rows);
  if (mine) return mine;
  return offPage ? { ...offPage, rank: null } : null;
}

/** The guilds board's standing bar: the viewer's own guild when it is ranked
 *  on this page; guilds carry no server-side self line, so otherwise none. */
export function guildStandingRow<G extends { name: string }>(
  rows: readonly G[],
  viewerGuild: string | null | undefined,
): G | null {
  if (!viewerGuild) return null;
  return rows.find((row) => row.name === viewerGuild) ?? null;
}
