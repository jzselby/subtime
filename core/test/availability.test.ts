import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reducer.js';
import {
  availabilityShares,
  fairness,
  fairnessIndex,
  playerStats,
  suggestSubsOn,
} from '../src/stats.js';
import { defaultConfig } from '../src/types.js';
import { LogBuilder, MIN, slots } from './helpers.js';

const cfg = defaultConfig({
  periods: { count: 2, lengthMs: 20 * MIN, fieldPlayers: 2 },
});
const starters = slots(['a', 'b'], ['GK', 'ST']);

describe('availability', () => {
  it('owes a half-time arrival half a game', () => {
    const b = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c'])
      .lineup(starters)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .attendance(['d'], 'late');
    const { state } = reduce(b.events, cfg);

    expect(availabilityShares(state).get('d')).toBeCloseTo(0.5, 5);
    const target = new Map(fairness(state, 0).map((r) => [r.playerId, r.targetMs]));
    // 80 field-minutes over 3.5 player-games.
    expect(target.get('a')).toBeCloseTo((80 * MIN) / 3.5, 0);
    expect(target.get('d')).toBeCloseTo((40 * MIN) / 3.5, 0);
    // The targets still share out exactly the game's field time.
    const sum = [...target.values()].reduce((x, y) => x + y, 0);
    expect(sum).toBeCloseTo(80 * MIN, 0);
  });

  it('keeps an injured player’s minutes but never suggests them', () => {
    const b = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c'])
      .lineup(starters)
      .startPeriod(1)
      .sub(10 * MIN, ['b'], [{ playerId: 'c', position: 'ST' }])
      .at(10 * MIN)
      .attendance(['b'], 'injured')
      .endPeriod(20 * MIN);
    const { state } = reduce(b.events, cfg);

    const rows = new Map(fairness(state, 0).map((r) => [r.playerId, r]));
    expect(rows.get('b')?.available).toBe(false);
    expect(rows.get('b')?.playedMs).toBe(10 * MIN);
    // Gone at 10 of 40 minutes: a quarter of the game.
    expect(availabilityShares(state).get('b')).toBeCloseTo(0.25, 5);
    expect(suggestSubsOn(state, 0, 3)).not.toContain('b');
    // b played every minute they were there for — not the unfair one.
    expect(playerStats(state, 0).find((s) => s.playerId === 'b')?.playedMs).toBe(10 * MIN);
    expect(fairnessIndex(state, 0)).toBeGreaterThan(0);
  });

  it('opens a fresh span when an injured player comes back', () => {
    const b = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c'])
      .lineup(starters)
      .startPeriod(1)
      .at(5 * MIN)
      .attendance(['c'], 'injured')
      .at(15 * MIN)
      .attendance(['c'], 'present');
    const { state } = reduce(b.events, cfg);
    // Out for 10 of 40 minutes.
    expect(availabilityShares(state).get('c')).toBeCloseTo(0.75, 5);
    expect(fairness(state, 0).find((r) => r.playerId === 'c')?.available).toBe(true);
  });

  it('treats the pre-game register as whole-game, and an absence as none', () => {
    const b = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c'])
      .attendance(['c'], 'absent')
      .attendance(['c'], 'present')
      .attendance(['b'], 'absent');
    const { state } = reduce(b.events, cfg);
    const shares = availabilityShares(state);
    expect(shares.get('c')).toBe(1);
    expect(shares.has('b')).toBe(false);
    expect(fairness(state, 0).map((r) => r.playerId)).toEqual(
      expect.arrayContaining(['a', 'c']),
    );
    expect(fairness(state, 0).some((r) => r.playerId === 'b')).toBe(false);
  });
});
