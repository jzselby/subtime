import { describe, expect, it } from 'vitest';
import { clockAt, elapsedGameMs, formatClock, remainingInGameMs } from '../src/clock.js';
import { reduce } from '../src/reducer.js';
import { playerStats, totalPlayedMs } from '../src/stats.js';
import { defaultConfig } from '../src/types.js';
import { LogBuilder, MIN, slots } from './helpers.js';

const cfg = defaultConfig({
  periods: { count: 2, lengthMs: 20 * MIN, fieldPlayers: 5 },
});

const five = ['a', 'b', 'c', 'd', 'e'];
const bench = ['f', 'g'];
const startingSlots = slots(five, ['GK', 'DF', 'DF', 'MF', 'ST']);

describe('stint fold', () => {
  it('accrues playing time only while a period is running', () => {
    const b = new LogBuilder(cfg)
      .attendance([...five, ...bench])
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      // A halftime sub must not accrue any time.
      .sub(0, ['a'], [{ playerId: 'f', position: 'GK' }])
      .startPeriod(2)
      .endPeriod(20 * MIN);

    const { state, errors } = reduce(b.events, cfg);
    expect(errors).toEqual([]);
    expect(state.status).toBe('final');

    const stats = new Map(playerStats(state, 0).map((s) => [s.playerId, s]));
    expect(stats.get('a')?.playedMs).toBe(20 * MIN);
    expect(stats.get('f')?.playedMs).toBe(20 * MIN);
    expect(stats.get('b')?.playedMs).toBe(40 * MIN);
    expect(stats.get('g')?.playedMs).toBe(0);
    expect(stats.get('g')?.benchMs).toBe(40 * MIN);
  });

  it('excludes paused time from playing time', () => {
    const b = new LogBuilder(cfg)
      .attendance(five)
      .lineup(startingSlots)
      .startPeriod(1)
      .pause(5 * MIN)
      .resume()
      .endPeriod(15 * MIN);

    const { state, errors } = reduce(b.events, cfg);
    expect(errors).toEqual([]);
    // The stoppage is invisible because stints live in game-clock coordinates:
    // the pause simply stops the clock advancing, and nothing special happens.
    expect(playerStats(state, 0)[0]?.playedMs).toBe(15 * MIN);
  });

  it('does not double-count a player across a sub boundary', () => {
    const b = new LogBuilder(cfg)
      .attendance([...five, ...bench])
      .lineup(startingSlots)
      .startPeriod(1)
      .sub(10 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }])
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    const stats = new Map(playerStats(state, 0).map((s) => [s.playerId, s]));
    expect(stats.get('e')?.playedMs).toBe(10 * MIN);
    expect(stats.get('f')?.playedMs).toBe(10 * MIN);
    expect(totalPlayedMs(state, 0)).toBe(5 * 20 * MIN);
  });

  it('splits a stint on a position change but keeps total time intact', () => {
    const b = new LogBuilder(cfg)
      .attendance(five)
      .lineup(startingSlots)
      .startPeriod(1)
      .move(8 * MIN, 'e', 'MF')
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    const e = playerStats(state, 0).find((s) => s.playerId === 'e');
    expect(e?.playedMs).toBe(20 * MIN);
    expect(e?.stintCount).toBe(2);
    expect(e?.positionsPlayed).toBe(2);
    expect(e?.msByPosition).toEqual({ ST: 8 * MIN, MF: 12 * MIN });
  });

  it('leaves stints open mid-period and values them at the live clock', () => {
    const b = new LogBuilder(cfg).attendance(five).lineup(startingSlots).startPeriod(1);
    const { state } = reduce(b.events, cfg);

    expect(state.status).toBe('running');
    expect(state.stints.every((s) => s.endMs === null)).toBe(true);

    // Anchored at the PERIOD_START wall time, so +7 minutes of wall time is
    // +7 minutes of clock. Nothing ticked; the value is computed on read.
    const now = b.wallAt(0) + 7 * MIN;
    expect(clockAt(state, now)).toBe(7 * MIN);
    expect(playerStats(state, now)[0]?.playedMs).toBe(7 * MIN);
    expect(totalPlayedMs(state, now)).toBe(5 * 7 * MIN);
  });
});

describe('live clock', () => {
  const paused = () =>
    new LogBuilder(cfg).attendance(five).lineup(startingSlots).startPeriod(1).pause(5 * MIN);

  it('freezes while paused, however long the stoppage runs', () => {
    const b = paused();
    const { state } = reduce(b.events, cfg);
    expect(state.status).toBe('paused');

    // Wall time keeps moving during an injury stoppage. Game time must not, and
    // neither must anyone's playing time.
    const later = b.wallAt(5 * MIN) + 3 * MIN;
    expect(clockAt(state, later)).toBe(5 * MIN);
    expect(playerStats(state, later)[0]?.playedMs).toBe(5 * MIN);
    expect(totalPlayedMs(state, later)).toBe(5 * 5 * MIN);
  });

  it('resumes from the pause point rather than catching up', () => {
    const b = paused().resume();
    const { state } = reduce(b.events, cfg);
    expect(state.status).toBe('running');

    const resumeWall = b.wallAt(5 * MIN);
    expect(clockAt(state, resumeWall)).toBe(5 * MIN);
    expect(clockAt(state, resumeWall + 2 * MIN)).toBe(7 * MIN);
    expect(playerStats(state, resumeWall + 2 * MIN)[0]?.playedMs).toBe(7 * MIN);
  });
});

describe('goals and plus/minus', () => {
  it('credits goals and assists and scores the game', () => {
    const b = new LogBuilder(cfg)
      .attendance(five)
      .lineup(startingSlots)
      .startPeriod(1)
      .goal(5 * MIN, 'e', 'd')
      .concede(9 * MIN)
      .ownGoal(12 * MIN, 'b')
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    expect(state.score).toEqual({ us: 1, them: 2 });

    const stats = new Map(playerStats(state, 0).map((s) => [s.playerId, s]));
    expect(stats.get('e')?.goals).toBe(1);
    expect(stats.get('d')?.assists).toBe(1);
    // An own goal is not a goal for the scorer.
    expect(stats.get('b')?.goals).toBe(0);
    // Everyone was on for all three: +1 scored, -1 conceded, -1 own goal.
    expect(stats.get('a')?.plusMinus).toBe(-1);
  });

  it('assigns a goal at a sub boundary to the player coming on', () => {
    const b = new LogBuilder(cfg)
      .attendance([...five, ...bench])
      .lineup(startingSlots)
      .startPeriod(1)
      .sub(10 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }])
      .goal(10 * MIN, 'f')
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    const stats = new Map(playerStats(state, 0).map((s) => [s.playerId, s]));
    // Half-open [start, end): counted exactly once, for the incoming player.
    expect(stats.get('f')?.plusMinus).toBe(1);
    expect(stats.get('e')?.plusMinus).toBe(0);
  });
});

describe('short-handed play', () => {
  it('takes a red-carded player off and does not replace them', () => {
    const b = new LogBuilder(cfg)
      .attendance(five)
      .lineup(startingSlots)
      .startPeriod(1)
      .card(10 * MIN, 'e', 'red')
      .endPeriod(20 * MIN);

    const { state } = reduce(b.events, cfg);
    // The on-field set survives PERIOD_END by design, so an unchanged lineup
    // never has to be re-entered at the break. Four, not five: no replacement.
    expect(state.onField.size).toBe(4);
    expect(state.onField.has('e')).toBe(false);
    const stats = new Map(playerStats(state, 0).map((s) => [s.playerId, s]));
    expect(stats.get('e')?.playedMs).toBe(10 * MIN);
    expect(stats.get('e')?.redCards).toBe(1);
    // Four players for the last ten minutes, not five.
    expect(totalPlayedMs(state, 0)).toBe(5 * 10 * MIN + 4 * 10 * MIN);
  });
});

describe('validation', () => {
  const base = () =>
    new LogBuilder(cfg).attendance([...five, ...bench]).lineup(startingSlots).startPeriod(1);

  it('rejects subbing on a player who is already on the field', () => {
    const b = base().sub(5 * MIN, ['e'], [{ playerId: 'b', position: 'ST' }]);
    const { errors, state } = reduce(b.events, cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.reason).toMatch(/already on the field/);
    expect(state.onField.has('e')).toBe(true); // event skipped wholesale
  });

  it('rejects subbing off a player who is not on the field', () => {
    const b = base().sub(5 * MIN, ['g'], []);
    const { errors } = reduce(b.events, cfg);
    expect(errors[0]?.reason).toMatch(/not on the field/);
  });

  it('rejects a clock that moves backwards', () => {
    const b = base().sub(10 * MIN, ['e'], [{ playerId: 'f', position: 'ST' }]);
    b.sub(4 * MIN, ['d'], [{ playerId: 'g', position: 'MF' }]);
    const { errors } = reduce(b.events, cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.reason).toMatch(/backwards/);
  });

  it('rejects starting a period that is already running', () => {
    const b = base().startPeriod(2);
    const { errors } = reduce(b.events, cfg);
    expect(errors[0]?.reason).toMatch(/still in progress/);
  });

  it('rejects a period beyond the configured count', () => {
    const b = new LogBuilder(cfg)
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .endPeriod(20 * MIN);
    b.startPeriod(3);
    const { errors } = reduce(b.events, cfg);
    // Reaching the configured count ends the game, so later events are refused.
    expect(errors[0]?.reason).toMatch(/already final/);
  });

  it('keeps folding after a bad event', () => {
    const b = base()
      .sub(5 * MIN, ['nobody'], [])
      .goal(6 * MIN, 'e')
      .endPeriod(20 * MIN);
    const { state, errors } = reduce(b.events, cfg);
    expect(errors).toHaveLength(1);
    expect(state.status).toBe('break');
    expect(state.score.us).toBe(1);
  });

  it('drops duplicate sequence numbers rather than applying them twice', () => {
    const b = base().goal(5 * MIN, 'e');
    const dup = b.events[b.events.length - 1];
    if (!dup) throw new Error('expected an event');
    const { state, errors } = reduce([...b.events, { ...dup, id: 'copy' }], cfg);
    expect(state.score.us).toBe(1);
    expect(errors[0]?.reason).toMatch(/duplicate seq/);
  });
});

describe('clock helpers', () => {
  it('reports elapsed and remaining across periods', () => {
    const b = new LogBuilder(cfg)
      .lineup(startingSlots)
      .startPeriod(1)
      .endPeriod(22 * MIN) // ran two minutes long
      .startPeriod(2);

    const { state } = reduce(b.events, cfg);
    const now = b.wallAt(0) + 5 * MIN;
    expect(elapsedGameMs(state, now)).toBe(27 * MIN);
    expect(remainingInGameMs(state, now)).toBe(15 * MIN);
  });

  it('formats clock readings', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});
