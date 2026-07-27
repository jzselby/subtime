import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reducer.js';
import { fairness, fairnessIndex, playerStats, suggestSubsOff, suggestSubsOn } from '../src/stats.js';
import { defaultConfig } from '../src/types.js';
import { LogBuilder, MIN, slots } from './helpers.js';

const cfg = defaultConfig({
  periods: { count: 2, lengthMs: 20 * MIN, fieldPlayers: 5 },
});

const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const startingSlots = slots(['a', 'b', 'c', 'd', 'e'], ['GK', 'DF', 'DF', 'MF', 'ST']);

// Total field time is 2 × 20 × 5 = 200 minutes over 7 players ≈ 28:34 each.
const TARGET = (2 * 20 * 5 * MIN) / 7;

describe('fairness', () => {
  it('targets an equal share of total field time', () => {
    const b = new LogBuilder(cfg).attendance(roster).lineup(startingSlots);
    const { state } = reduce(b.events, cfg);
    const rows = fairness(state, 0);

    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row.targetMs).toBeCloseTo(TARGET, 5);
    // Nobody has played, and the starters are projected to play all 40 minutes,
    // so the two bench players are owed the most.
    expect(rows.slice(0, 2).map((r) => r.playerId)).toEqual(['f', 'g']);
    expect(rows[0]?.deficitMs).toBeCloseTo(TARGET, 5);
  });

  it('suggests the most-owed players to bring on', () => {
    const b = new LogBuilder(cfg)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .sub(10 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }])
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    // 'g' has played nothing at all, so they are owed more than 'e' (10 min).
    expect(suggestSubsOn(state, 0, 2)).toEqual(['g', 'e']);
  });

  it('never suggests taking the keeper off', () => {
    const b = new LogBuilder(cfg)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .sub(5 * MIN, ['b'], [{ playerId: 'f', position: 'DF' }]);

    const { state } = reduce(b.events, cfg);
    const off = suggestSubsOff(state, b.wallAt(0) + 10 * MIN, 5);
    expect(off).not.toContain('a');
    expect(off.length).toBe(4);
  });

  it('weights keeper minutes by gkWeight without altering reported minutes', () => {
    const halfCredit = defaultConfig({
      periods: cfg.periods,
      fairness: { gkWeight: 0.5, mode: 'equal' },
    });
    const b = new LogBuilder(halfCredit)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, halfCredit);
    const keeper = playerStats(state, 0).find((s) => s.playerId === 'a');
    // Reported minutes are untouched; only the fairness figure is discounted.
    expect(keeper?.playedMs).toBe(20 * MIN);
    expect(keeper?.weightedPlayedMs).toBe(10 * MIN);

    const rows = new Map(fairness(state, 0).map((r) => [r.playerId, r]));
    expect(rows.get('a')?.deficitMs).toBeGreaterThan(rows.get('b')?.deficitMs ?? 0);
  });

  it('supports weighted targets for attendance-based policies', () => {
    const b = new LogBuilder(cfg).attendance(roster).lineup(startingSlots);
    const { state } = reduce(b.events, cfg);
    // 'a' attended twice as much training as everyone else.
    const weights = new Map(roster.map((p) => [p, p === 'a' ? 2 : 1]));
    const rows = new Map(fairness(state, 0, weights).map((r) => [r.playerId, r]));
    expect(rows.get('a')?.targetMs).toBeCloseTo((rows.get('b')?.targetMs ?? 0) * 2, 5);
  });

  it('scores an evenly rotated game near 1 and a lopsided one well below', () => {
    const even = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c', 'd', 'e'])
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN);
    expect(fairnessIndex(reduce(even.events, cfg).state, 0)).toBe(1);

    const lopsided = new LogBuilder(cfg)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .sub(18 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }])
      .endPeriod(20 * MIN);
    const { state } = reduce(lopsided.events, cfg);
    // 'g' never played, so min/max is 0.
    expect(fairnessIndex(state, 0)).toBe(0);
  });

  it('ignores absent players when setting targets', () => {
    const b = new LogBuilder(cfg)
      .attendance(['a', 'b', 'c', 'd', 'e', 'f'])
      .attendance(['g'], 'absent')
      .lineup(startingSlots);
    const { state } = reduce(b.events, cfg);
    const rows = fairness(state, 0);
    expect(rows.map((r) => r.playerId)).not.toContain('g');
    expect(rows[0]?.targetMs).toBeCloseTo((2 * 20 * 5 * MIN) / 6, 5);
  });
});
