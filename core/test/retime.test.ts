import { describe, expect, it } from 'vitest';
import { reduce } from '../src/reducer.js';
import { retimeEvent } from '../src/retime.js';
import { fieldTimeIntegralMs, playerStats, totalPlayedMs } from '../src/stats.js';
import type { GameEvent } from '../src/types.js';
import { LogBuilder, MIN, slots } from './helpers.js';

const played = (events: GameEvent[], config: LogBuilder['config'], id: string) => {
  const { state } = reduce(events, config);
  return playerStats(state, 0).find((s) => s.playerId === id)?.playedMs ?? 0;
};

/** Apply a successful retime's changed rows over the original log. */
const applyChanged = (events: GameEvent[], changed: GameEvent[]) => {
  const byId = new Map(changed.map((e) => [e.id, e]));
  return events.map((e) => byId.get(e.id) ?? e);
};

const game = () =>
  new LogBuilder()
    .attendance(['p1', 'p2', 'p3'])
    .lineup(slots(['p1', 'p2'], ['A', 'B']))
    .startPeriod(1)
    .goal(4 * MIN, 'p1')
    .sub(15 * MIN, ['p2'], [{ playerId: 'p3', position: 'B' }])
    .endPeriod(20 * MIN)
    .gameEnd();

describe('retimeEvent', () => {
  it('moving a sub earlier moves the minutes between the two players', () => {
    const b = game();
    const sub = b.events.find((e) => e.type === 'SUB')!;
    expect(played(b.events, b.config, 'p2')).toBe(15 * MIN);

    const r = retimeEvent(b.events, sub.id, 10 * MIN, b.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fixed = applyChanged(b.events, r.changed);
    expect(played(fixed, b.config, 'p2')).toBe(10 * MIN);
    expect(played(fixed, b.config, 'p3')).toBe(10 * MIN);
    expect(played(fixed, b.config, 'p1')).toBe(20 * MIN);
    const { state, applied, errors } = reduce(fixed, b.config);
    expect(errors).toEqual([]);
    expect(totalPlayedMs(state, 0)).toBe(fieldTimeIntegralMs(applied));
  });

  it('re-orders the log when an event moves past another, keeping the same set of seqs', () => {
    const b = game();
    const goal = b.events.find((e) => e.type === 'GOAL')!;
    const r = retimeEvent(b.events, goal.id, 17 * MIN, b.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fixed = applyChanged(b.events, r.changed);
    expect(new Set(fixed.map((e) => e.seq))).toEqual(new Set(b.events.map((e) => e.seq)));
    const ordered = [...fixed].sort((a, x) => a.seq - x.seq);
    const iSub = ordered.findIndex((e) => e.type === 'SUB');
    const iGoal = ordered.findIndex((e) => e.type === 'GOAL');
    expect(iGoal).toBeGreaterThan(iSub);
    const { state } = reduce(fixed, b.config);
    expect(state.goals[0]?.clockMs).toBe(17 * MIN);
    expect(state.score.us).toBe(1);
    // only what actually moved is reported for writing back
    expect(r.changed.map((e) => e.type).sort()).toEqual(['GOAL', 'SUB']);
  });

  it('refuses a time outside the period', () => {
    const b = game();
    const sub = b.events.find((e) => e.type === 'SUB')!;
    const r = retimeEvent(b.events, sub.id, 21 * MIN, b.config);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('20:00');
    expect(retimeEvent(b.events, sub.id, -1, b.config).ok).toBe(false);
  });

  it('can land exactly on the final whistle without crossing it', () => {
    const b = game();
    const sub = b.events.find((e) => e.type === 'SUB')!;
    const r = retimeEvent(b.events, sub.id, 20 * MIN, b.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { errors, state } = reduce(applyChanged(b.events, r.changed), b.config);
    expect(errors).toEqual([]);
    expect(state.status).toBe('final');
  });

  it('refuses a move that contradicts a later change involving the same player', () => {
    const b = new LogBuilder()
      .lineup(slots(['p1', 'p2'], ['A', 'B']))
      .startPeriod(1)
      .sub(5 * MIN, ['p2'], [{ playerId: 'p3', position: 'B' }])
      .sub(10 * MIN, ['p3'], [{ playerId: 'p2', position: 'B' }])
      .endPeriod(20 * MIN);
    const first = b.events.find((e) => e.type === 'SUB')!;
    const r = retimeEvent(b.events, first.id, 12 * MIN, b.config);
    expect(r.ok).toBe(false);
  });

  it('refuses to move the structure of the game itself', () => {
    const b = game();
    const end = b.events.find((e) => e.type === 'PERIOD_END')!;
    expect(retimeEvent(b.events, end.id, 10 * MIN, b.config).ok).toBe(false);
  });

  it('keeps a moved event inside its own half', () => {
    const b = new LogBuilder()
      .lineup(slots(['p1', 'p2'], ['A', 'B']))
      .startPeriod(1)
      .endPeriod(20 * MIN)
      .startPeriod(2)
      .sub(8 * MIN, ['p2'], [{ playerId: 'p3', position: 'B' }])
      .endPeriod(20 * MIN);
    const sub = b.events.find((e) => e.type === 'SUB')!;
    const r = retimeEvent(b.events, sub.id, 2 * MIN, b.config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { state, errors } = reduce(applyChanged(b.events, r.changed), b.config);
    expect(errors).toEqual([]);
    const p3 = playerStats(state, 0).find((s) => s.playerId === 'p3')!;
    expect(p3.playedMs).toBe(18 * MIN);
  });
});
