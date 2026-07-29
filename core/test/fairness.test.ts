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

  it('excludes the keeper entirely under gkWeight 0, rather than just discounting their credit', () => {
    const excluded = defaultConfig({
      periods: cfg.periods,
      fairness: { gkWeight: 0, mode: 'equal' },
    });
    const b = new LogBuilder(excluded)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, excluded);
    const rows = new Map(fairness(state, 0).map((r) => [r.playerId, r]));

    // The keeper has played the entire game and carries no target or deficit
    // of their own — the naive "discount their credit within the same pool"
    // behaviour this replaces would instead have made them look exactly as
    // owed as someone who had not played a single minute.
    const keeper = rows.get('a');
    expect(keeper?.excludedGk).toBe(true);
    expect(keeper?.targetMs).toBe(0);
    expect(keeper?.deficitMs).toBe(0);

    // The outfield target is worked out over the outfield spots only (4, not
    // 5) shared among the 6 non-keeper players, not diluted by a slot that
    // was never actually up for rotation.
    const outfieldTarget = (2 * 20 * 4 * MIN) / 6;
    expect(rows.get('b')?.targetMs).toBeCloseTo(outfieldTarget, 5);
  });

  it('picks the target back up once an excluded keeper subs to an outfield spot', () => {
    const excluded = defaultConfig({
      periods: cfg.periods,
      fairness: { gkWeight: 0, mode: 'equal' },
    });
    const b = new LogBuilder(excluded)
      .attendance(roster)
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      // 'a' moves from goal to bench, 'f' takes over in goal.
      .startPeriod(2)
      .sub(0, ['a'], [{ playerId: 'f', position: 'GK' }]);

    const { state } = reduce(b.events, excluded);
    const rows = new Map(fairness(state, b.wallAt(5 * MIN)).map((r) => [r.playerId, r]));

    // 'a' is on the bench now, not in goal, so they're back in the pool —
    // and because gkWeight discounted their 20 minutes in goal to zero
    // credit, they show up genuinely owed time, same as anyone else who'd
    // sat out the first half.
    expect(rows.get('a')?.excludedGk).toBe(false);
    expect(rows.get('a')?.weightedPlayedMs).toBe(0);
    expect(rows.get('a')?.deficitMs).toBeGreaterThan(0);
    // 'f', now in goal, carries the exclusion instead.
    expect(rows.get('f')?.excludedGk).toBe(true);
  });

  it('leaves the excluded keeper out of the fairness-index ratio too', () => {
    const excluded = defaultConfig({
      periods: cfg.periods,
      fairness: { gkWeight: 0, mode: 'equal' },
    });
    // The keeper plays both periods straight through — 40 minutes, never
    // subbed. The eight outfield players swap out entirely at the half, so
    // each of them plays exactly one period: 20 minutes apiece, a perfectly
    // fair rotation among themselves that the keeper's very different total
    // would distort if folded into the same ratio.
    const firstHalfOutfield = slots(['b', 'c', 'd', 'e'], ['DF', 'DF', 'MF', 'ST']);
    const secondHalfOutfield = slots(['f', 'g', 'h', 'i'], ['DF', 'DF', 'MF', 'ST']);
    const b = new LogBuilder(excluded)
      .attendance(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
      .lineup([{ playerId: 'a', position: 'GK' }, ...firstHalfOutfield])
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .sub(0, ['b', 'c', 'd', 'e'], secondHalfOutfield)
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, excluded);
    expect(fairnessIndex(state, 0)).toBe(1);
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
