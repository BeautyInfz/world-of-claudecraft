// The shared top-three podium core (src/ui/leaderboard_podium_view.ts): the
// page split both ranked windows use, the place-ordered discs, and the
// viewer standing decisions the leaderboard tabs make without a server read.
import { describe, expect, it } from 'vitest';
import {
  guildStandingRow,
  LEADERBOARD_MEDAL_ART_DIR,
  leaderboardMedalArt,
  playersStandingBar,
  podiumSplit,
  viewerRowOnPage,
} from '../src/ui/leaderboard_podium_view';

interface Row {
  rank: number;
  name: string;
  me: boolean;
}

function rows(count: number, meRank = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    name: `Hero${i + 1}`,
    me: i + 1 === meRank,
  }));
}

describe('podiumSplit', () => {
  it('stands ranks 1 to 3 silver, gold, bronze and lists rank 4 onward on the first page', () => {
    const split = podiumSplit(0, rows(6), (r) => r.rank);
    expect(split.podium.map((s) => [s.place, s.rankText, s.entry?.name])).toEqual([
      [2, '2', 'Hero2'],
      [1, '1', 'Hero1'],
      [3, '3', 'Hero3'],
    ]);
    expect(split.listed.map((r) => r.rank)).toEqual([4, 5, 6]);
  });

  it('colors the discs by place, whatever the rows hold', () => {
    const split = podiumSplit(0, rows(3), (r) => r.rank);
    expect(split.podium.map((s) => s.placeArt)).toEqual([
      `${LEADERBOARD_MEDAL_ART_DIR}/medal_silver.webp`,
      `${LEADERBOARD_MEDAL_ART_DIR}/medal_gold.webp`,
      `${LEADERBOARD_MEDAL_ART_DIR}/medal_bronze.webp`,
    ]);
    expect(leaderboardMedalArt('gold')).toBe('ui/leaderboard/medal_gold.webp');
  });

  it('leaves an unheld place standing empty', () => {
    const split = podiumSplit(0, rows(1), (r) => r.rank);
    expect(split.podium.map((s) => [s.place, s.entry])).toEqual([
      [2, null],
      [1, rows(1)[0]],
      [3, null],
    ]);
    expect(split.listed).toEqual([]);
  });

  it('drops the podium on a later page and lists every row', () => {
    const later = rows(3).map((r) => ({ ...r, rank: r.rank + 50 }));
    const split = podiumSplit(1, later, (r) => r.rank);
    expect(split.podium).toEqual([]);
    expect(split.listed.map((r) => r.rank)).toEqual([51, 52, 53]);
  });

  it('has no podium for an empty page', () => {
    expect(podiumSplit(0, [] as Row[], (r) => r.rank)).toEqual({ podium: [], listed: [] });
  });
});

describe('standing decisions', () => {
  it('finds the viewer row on the page, or nothing', () => {
    expect(viewerRowOnPage(rows(5, 4))?.rank).toBe(4);
    expect(viewerRowOnPage(rows(5))).toBeNull();
  });

  it('players: the ranked row on the page wins over the off-page standing', () => {
    const offPage = { name: 'Hero4', level: 20 };
    const onPage = rows(5, 4).map((r) => ({ ...r, level: 20 }));
    expect(playersStandingBar(onPage, offPage)).toMatchObject({ rank: 4, name: 'Hero4' });
  });

  it('players: off the page the standing carries no rank', () => {
    const offPage = { name: 'Ari', level: 12 };
    const bar = playersStandingBar(
      rows(5).map((r) => ({ ...r, level: 20 })),
      offPage,
    );
    expect(bar).toEqual({ name: 'Ari', level: 12, rank: null });
  });

  it('players: no viewer at all shows no bar', () => {
    expect(
      playersStandingBar(
        rows(3).map((r) => ({ ...r, level: 1 })),
        null,
      ),
    ).toBeNull();
  });

  it("guilds: the viewer's own guild when it is on the page, exact name only", () => {
    const guilds = [
      { rank: 1, name: 'Ironvow' },
      { rank: 2, name: 'Moonwardens' },
    ];
    expect(guildStandingRow(guilds, 'Moonwardens')?.rank).toBe(2);
    expect(guildStandingRow(guilds, 'moonwardens')).toBeNull();
    expect(guildStandingRow(guilds, 'Thornveil')).toBeNull();
    expect(guildStandingRow(guilds, null)).toBeNull();
    expect(guildStandingRow(guilds, '')).toBeNull();
  });
});
