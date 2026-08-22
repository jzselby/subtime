import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reducer.js';
import { currentRotationMs, stintDurationMs } from '../src/stats.js';
import { LogBuilder, MIN, slots } from './helpers.js';

describe('currentRotationMs', () => {
  it('is unaffected by a POSITION_CHANGE, unlike stintDurationMs', () => {
    const b = new LogBuilder().lineup(slots(['p1'], ['RB'])).startPeriod(1).move(5 * MIN, 'p1', 'LB');
    const { state } = reduce(b.events, b.config);
    const now = b.wallAt(0) + 8 * MIN;

    const idx = state.openStintIdx.get('p1');
    const openStint = idx !== undefined ? state.stints[idx] : undefined;
    expect(openStint && stintDurationMs(openStint, state, now)).toBe(3 * MIN);
    expect(currentRotationMs(state, 'p1', now)).toBe(8 * MIN);
  });

  it('chains through several position changes in one shift', () => {
    const b = new LogBuilder()
      .lineup(slots(['p1'], ['RB']))
      .startPeriod(1)
      .move(2 * MIN, 'p1', 'CB')
      .move(6 * MIN, 'p1', 'LB');
    const { state } = reduce(b.events, b.config);
    const now = b.wallAt(0) + 10 * MIN;

    expect(currentRotationMs(state, 'p1', now)).toBe(10 * MIN);
  });

  it('resets on a real substitution — off, bench time, then back on', () => {
    const b = new LogBuilder()
      .lineup(slots(['p1', 'p2'], ['RB', 'CB']))
      .startPeriod(1)
      .move(5 * MIN, 'p1', 'LB')
      .sub(8 * MIN, ['p1'], [{ playerId: 'p3', position: 'RB' }])
      .sub(12 * MIN, [], [{ playerId: 'p1', position: 'LB' }]);
    const { state } = reduce(b.events, b.config);
    const now = b.wallAt(0) + 15 * MIN;

    expect(currentRotationMs(state, 'p1', now)).toBe(3 * MIN);
  });

  it('resets at the start of a new period even with no subs at the break', () => {
    const b = new LogBuilder()
      .lineup(slots(['p1'], ['RB']))
      .startPeriod(1)
      .move(5 * MIN, 'p1', 'LB')
      .endPeriod(30 * MIN)
      .startPeriod(2);
    const { state } = reduce(b.events, b.config);
    const now = b.wallAt(0) + 4 * MIN;

    expect(currentRotationMs(state, 'p1', now)).toBe(4 * MIN);
  });

  it('returns null for a player who is not on the field', () => {
    const b = new LogBuilder().lineup(slots(['p1'], ['RB'])).startPeriod(1);
    const { state } = reduce(b.events, b.config);
    expect(currentRotationMs(state, 'benchwarmer', b.wallAt(0))).toBeNull();
  });
});
