// @vitest-environment happy-dom
//
// The leaderboard window's podium and standing bar over happy-dom: every tab
// stands its top three on the shared podium (discs by place, unclaimed places
// kept), lists rank 4 onward under it, and pins the viewer's own standing
// (the players off-page standing, the viewer's guild, contributor and daily
// rows, the Renown account line). A later page drops the podium.
import { describe, expect, it } from 'vitest';
import { LeaderboardWindow } from '../src/ui/leaderboard_window';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function paged<T>(leaders: T[], extra: Record<string, unknown> = {}) {
  return Promise.resolve({
    leaders,
    page: 0,
    pageSize: 50,
    pageCount: 1,
    total: leaders.length,
    ...extra,
  });
}

function players(count: number, meName = '') {
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    name: i + 1 === 5 && meName ? meName : `Hero${i + 1}`,
    cls: 'warrior',
    level: 20,
    virtualLevel: 30 - i,
    lifetimeXp: 900_000 - i * 1000,
    prestigeRank: 0,
    title: null,
  }));
}

function rig(world: Record<string, unknown>) {
  const el = document.createElement('div');
  el.id = 'leaderboard-window';
  el.className = 'window panel';
  document.body.appendChild(el);
  const lb = new LeaderboardWindow({
    root: () => el,
    world: () =>
      ({
        realm: 'Testrealm',
        player: { name: 'Ari', level: 12, guild: 'Moonwardens', githubLogin: 'ari-dev' },
        lifetimeXp: 1234,
        activeTitle: null,
        ...world,
      }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showDevBadges: () => true,
  });
  return { el, lb };
}

async function openOn(el: HTMLElement, lb: LeaderboardWindow, tab?: string) {
  lb.toggle();
  await flush();
  if (tab) {
    (el.querySelector(`[data-leaderboard-tab="${tab}"]`) as HTMLButtonElement).click();
    await flush();
  }
}

function places(el: HTMLElement): (string | null)[] {
  return Array.from(el.querySelectorAll('.lbp-slot')).map((s) =>
    s.getAttribute('data-podium-place'),
  );
}

describe('leaderboard window podium', () => {
  it('players: podium silver, gold, bronze with place discs, rows from rank 4, ranked standing', async () => {
    const { el, lb } = rig({ leaderboard: () => paged(players(8, 'Ari')) });
    await openOn(el, lb);
    expect(places(el)).toEqual(['2', '1', '3']);
    const discs = Array.from(el.querySelectorAll('.lbp-slot-medal')).map((d) =>
      d.getAttribute('style'),
    );
    expect(discs[0]).toContain('medal_silver.webp');
    expect(discs[1]).toContain('medal_gold.webp');
    expect(discs[2]).toContain('medal_bronze.webp');
    expect(el.querySelector('.lbp-slot-1 .lbp-slot-name')?.textContent).toContain('Hero1');
    const listed = Array.from(el.querySelectorAll('.lb-row-players:not(.lb-head) .lb-rank'))
      .filter((cell) => !cell.closest('.lb-standing'))
      .map((cell) => cell.textContent);
    expect(listed).toEqual(['4', '5', '6', '7', '8']);
    const standing = el.querySelector('.lb-standing');
    expect(standing?.querySelector('.lb-rank')?.textContent).toBe('5');
    expect(standing?.textContent).toContain('Ari');
  });

  it('players: off the page the standing bar keeps the placeholder rank', async () => {
    const { el, lb } = rig({ leaderboard: () => paged(players(4)) });
    await openOn(el, lb);
    const standing = el.querySelector('.lb-standing');
    expect(standing?.querySelector('.lb-rank')?.textContent).toBe(String.fromCharCode(0x2014));
    expect(standing?.textContent).toContain('Ari');
  });

  it('keeps unclaimed places standing when fewer than three are ranked', async () => {
    const { el, lb } = rig({ leaderboard: () => paged(players(1)) });
    await openOn(el, lb);
    expect(places(el)).toEqual(['2', '1', '3']);
    expect(el.querySelectorAll('.lbp-slot-empty')).toHaveLength(2);
    expect(el.querySelector('.lbp-slot-2 .lbp-slot-name')?.textContent).toBe('Unclaimed');
  });

  it('drops the podium on a later page', async () => {
    const later = players(3).map((p) => ({ ...p, rank: p.rank + 50 }));
    const { el, lb } = rig({
      leaderboard: () => paged(later, { page: 1, pageCount: 2, total: 53 }),
    });
    await openOn(el, lb);
    expect(el.querySelector('.lbp-podium')).toBeNull();
    expect(el.querySelectorAll('.lb-row-players:not(.lb-head)').length).toBeGreaterThanOrEqual(3);
  });

  it("guilds: podium plus the viewer's own guild pinned when it is on the page", async () => {
    const guilds = ['Ironvow', 'Ashen Circle', 'Gale Riders', 'Moonwardens'].map((name, i) => ({
      rank: i + 1,
      name,
      memberCount: 30 - i,
      totalLifetimeXp: 9_000_000 - i * 100_000,
      topLevel: 20,
    }));
    const { el, lb } = rig({ guildLeaderboard: () => paged(guilds) });
    await openOn(el, lb, 'guilds');
    expect(places(el)).toEqual(['2', '1', '3']);
    expect(el.querySelector('.lb-standing .lb-name')?.textContent).toBe('Moonwardens');
  });

  it('guilds: no bar when the viewer guild is not ranked on the page', async () => {
    const guilds = [{ rank: 1, name: 'Ironvow', memberCount: 3, totalLifetimeXp: 10, topLevel: 5 }];
    const { el, lb } = rig({ guildLeaderboard: () => paged(guilds) });
    await openOn(el, lb, 'guilds');
    expect(el.querySelector('.lb-standing')).toBeNull();
  });

  it('renown: the account self line becomes the standing bar', async () => {
    const deeds = players(4).map((p) => ({
      rank: p.rank,
      name: p.name,
      realm: 'Testrealm',
      cls: 'mage',
      level: 20,
      renown: 5000 - p.rank,
      title: null,
    }));
    const { el, lb } = rig({
      deedsLeaderboard: () => paged(deeds, { self: { rank: 4, topPercent: 9, renown: 4996 } }),
    });
    await openOn(el, lb, 'deeds');
    expect(places(el)).toEqual(['2', '1', '3']);
    expect(el.querySelector('.lb-self.lb-standing')?.textContent).toMatch(/4,996/);
  });

  it('developers and daily: the viewer row pins only when it is on the page', async () => {
    const devs = [1, 2, 3, 4].map((rank) => ({
      rank,
      login: rank === 4 ? 'ari-dev' : `dev${rank}`,
      mergedPrs: 50 - rank,
      devTier: 0,
    }));
    const daily = [1, 2].map((rank) => ({ rank, name: `P${rank}`, points: 10 - rank, me: false }));
    const { el, lb } = rig({
      devLeaderboard: () => paged(devs),
      dailyRewardLeaderboard: () => paged(daily, { day: '2026-09-15' }),
    });
    await openOn(el, lb, 'devs');
    expect(el.querySelector('.lb-standing .lb-name')?.textContent).toContain('@ari-dev');
    (el.querySelector('[data-leaderboard-tab="daily"]') as HTMLButtonElement).click();
    await flush();
    expect(places(el)).toEqual(['2', '1', '3']);
    expect(el.querySelector('.lb-standing')).toBeNull();
  });
});
