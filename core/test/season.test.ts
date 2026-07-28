import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reducer.js';
import { aggregatePlayerStats, playerStats } from '../src/stats.js';
import { defaultConfig } from '../src/types.js';
import { LogBuilder, MIN, slots } from './helpers.js';

const cfg = defaultConfig({
  periods: { count: 2, lengthMs: 20 * MIN, fieldPlayers: 5 },
});

const startingSlots = slots(['a', 'b', 'c', 'd', 'e'], ['GK', 'DF', 'DF', 'MF', 'ST']);

describe('aggregatePlayerStats', () => {
  it('sums minutes, goals and positions across games, and skips a game a bench player never entered', () => {
    // Game 1: 'a' plays the full game at GK and scores nothing; 'f' is on the
    // bench the whole time.
    const g1 = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c', 'd', 'e', 'f'])
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .goal(10 * MIN, 'e')
      .endPeriod(20 * MIN);
    const state1 = reduce(g1.events, cfg, 'g1').state;

    // Game 2: 'a' plays at DF this time (two positions across the season), 'f'
    // comes on as a sub and scores.
    const g2 = new LogBuilder(cfg, 'g2')
      .attendance(['a', 'b', 'c', 'd', 'e', 'f'])
      .lineup(slots(['a', 'b', 'c', 'd', 'e'], ['DF', 'DF', 'DF', 'MF', 'ST']))
      .startPeriod(1)
      .sub(10 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }])
      .goal(15 * MIN, 'f')
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .endPeriod(20 * MIN);
    const state2 = reduce(g2.events, cfg, 'g2').state;

    const perGame = [playerStats(state1, 0), playerStats(state2, 0)];
    const season = new Map(aggregatePlayerStats(perGame).map((r) => [r.playerId, r]));

    // 'a' played all 40 minutes of both games, in two different positions.
    expect(season.get('a')?.games).toBe(2);
    expect(season.get('a')?.playedMs).toBe(80 * MIN);
    expect(season.get('a')?.positionsPlayed).toBe(2);
    expect(season.get('a')?.msByPosition).toEqual({ GK: 40 * MIN, DF: 40 * MIN });

    // 'f' sat out game 1 entirely and played the last 30 of game 2, scoring once.
    expect(season.get('f')?.games).toBe(1);
    expect(season.get('f')?.playedMs).toBe(30 * MIN);
    expect(season.get('f')?.goals).toBe(1);

    // 'e' played 30 of game 2's first half before being subbed off, plus all
    // of game 1 — two appearances either way.
    expect(season.get('e')?.games).toBe(2);
    expect(season.get('e')?.goals).toBe(1);
  });

  it('returns nothing for an empty season', () => {
    expect(aggregatePlayerStats([])).toEqual([]);
  });
});
