import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clockAt } from '../src/clock.js';
import { reduce } from '../src/reducer.js';
import {
  fairnessIndex,
  fieldTimeIntegralMs,
  playerStats,
  totalPlayedMs,
} from '../src/stats.js';
import type { GameConfig, GameEvent } from '../src/types.js';
import { defaultConfig } from '../src/types.js';
import { LogBuilder, MIN } from './helpers.js';

/**
 * Property tests for the stint fold.
 *
 * The headline property is the field-time invariant:
 *
 *     Σ (every player's time on the field)  ==  ∫ onFieldCount dt
 *
 * The right-hand side is computed by `fieldTimeIntegralMs`, a replay that
 * tracks only a scalar count and shares no code with the stint fold. Two
 * independent computations agreeing over thousands of random logs is the thing
 * that makes the timing engine trustworthy — it catches double-counted subs,
 * stints that are never closed, and pauses applied to the wrong period.
 *
 * Note the invariant is stated as an integral, not `fieldPlayers × elapsed`.
 * Red cards and short rosters mean the on-field count genuinely varies, and the
 * honest fix is a stronger right-hand side rather than a weaker assertion.
 */

const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'ST'];

const opArb = fc.record({
  kind: fc.constantFrom('sub', 'move', 'pause', 'goal', 'concede', 'red'),
  a: fc.nat({ max: 1000 }),
  b: fc.nat({ max: 1000 }),
  gapMs: fc.integer({ min: 0, max: 5 * MIN }),
});

const gameArb = fc.record({
  extraPlayers: fc.integer({ min: 1, max: 6 }),
  fieldPlayers: fc.integer({ min: 4, max: 11 }),
  periodLengthMin: fc.integer({ min: 10, max: 45 }),
  periodOps: fc.array(fc.array(opArb, { maxLength: 10 }), { minLength: 1, maxLength: 4 }),
});

type GameSpec = fc.Arbitrary<unknown> extends never ? never : ReturnType<typeof specOf>;
const specOf = () => ({}) as {
  extraPlayers: number;
  fieldPlayers: number;
  periodLengthMin: number;
  periodOps: { kind: string; a: number; b: number; gapMs: number }[][];
};

/**
 * Interpret a random spec into a *valid* event log. Validity is enforced during
 * construction (never sub on a player already on, never red-card the last
 * player standing) so that the properties test the arithmetic of the fold
 * rather than its error handling — which has its own unit tests.
 */
function buildGame(
  spec: GameSpec,
  opts: { leaveLastPeriodOpen?: boolean } = {},
): { events: GameEvent[]; config: GameConfig } {
  const { fieldPlayers } = spec;
  const roster = Array.from({ length: fieldPlayers + spec.extraPlayers }, (_, i) => `p${i}`);
  const config = defaultConfig({
    periods: {
      count: spec.periodOps.length,
      lengthMs: spec.periodLengthMin * MIN,
      fieldPlayers,
    },
  });

  const b = new LogBuilder(config);
  b.attendance(roster);

  const onField = new Map<string, string>();
  roster.slice(0, fieldPlayers).forEach((playerId, i) => {
    onField.set(playerId, POSITIONS[i % POSITIONS.length] ?? 'MF');
  });
  b.lineup([...onField].map(([playerId, position]) => ({ playerId, position })));

  const sentOff = new Set<string>();

  spec.periodOps.forEach((ops, index) => {
    b.startPeriod(index + 1);
    let clock = 0;

    for (const op of ops) {
      clock += op.gapMs;
      const on = [...onField.keys()];
      const bench = roster.filter((p) => !onField.has(p) && !sentOff.has(p));

      switch (op.kind) {
        case 'sub': {
          if (on.length === 0 || bench.length === 0) break;
          const off = on[op.a % on.length]!;
          const inc = bench[op.b % bench.length]!;
          const position = onField.get(off)!;
          b.sub(clock, [off], [{ playerId: inc, position }]);
          onField.delete(off);
          onField.set(inc, position);
          break;
        }
        case 'move': {
          if (on.length === 0) break;
          const playerId = on[op.a % on.length]!;
          const to = POSITIONS[op.b % POSITIONS.length]!;
          if (onField.get(playerId) === to) break;
          b.move(clock, playerId, to);
          onField.set(playerId, to);
          break;
        }
        case 'pause': {
          b.pause(clock);
          b.resume();
          break;
        }
        case 'goal': {
          if (on.length === 0) break;
          b.goal(clock, on[op.a % on.length]!);
          break;
        }
        case 'concede': {
          b.concede(clock);
          break;
        }
        case 'red': {
          // Keep at least one player on so the game stays coherent.
          if (on.length <= 1) break;
          const playerId = on[op.a % on.length]!;
          b.card(clock, playerId, 'red');
          onField.delete(playerId);
          sentOff.add(playerId);
          break;
        }
      }
    }

    const isLast = index === spec.periodOps.length - 1;
    if (!(isLast && opts.leaveLastPeriodOpen)) b.endPeriod(clock + 1000);
  });

  return { events: b.events, config };
}

const RUNS = 500;

describe('field-time invariant', () => {
  it('Σ player minutes equals ∫ onFieldCount dt', () => {
    fc.assert(
      fc.property(gameArb, (spec) => {
        const { events, config } = buildGame(spec as GameSpec);
        const { state, errors, applied } = reduce(events, config);
        expect(errors).toEqual([]);
        expect(totalPlayedMs(state, 0)).toBe(fieldTimeIntegralMs(applied));
      }),
      { numRuns: RUNS },
    );
  });

  it('reduces to a fully closed, non-negative set of stints', () => {
    fc.assert(
      fc.property(gameArb, (spec) => {
        const { events, config } = buildGame(spec as GameSpec);
        const { state } = reduce(events, config);
        expect(state.status).toBe('final');
        for (const stint of state.stints) {
          expect(stint.endMs).not.toBeNull();
          expect(stint.endMs ?? 0).toBeGreaterThanOrEqual(stint.startMs);
          expect(stint.period).toBeGreaterThanOrEqual(1);
          expect(stint.period).toBeLessThanOrEqual(config.periods.count);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('agrees with the per-player breakdown', () => {
    fc.assert(
      fc.property(gameArb, (spec) => {
        const { events, config } = buildGame(spec as GameSpec);
        const { state } = reduce(events, config);
        const summed = playerStats(state, 0).reduce((acc, s) => acc + s.playedMs, 0);
        expect(summed).toBe(totalPlayedMs(state, 0));
      }),
      { numRuns: RUNS },
    );
  });

  it('never lets a player be counted in two places at once', () => {
    fc.assert(
      fc.property(gameArb, (spec) => {
        const { events, config } = buildGame(spec as GameSpec);
        const { state } = reduce(events, config);
        const byPlayer = new Map<string, { period: number; startMs: number; endMs: number }[]>();
        for (const stint of state.stints) {
          const list = byPlayer.get(stint.playerId) ?? [];
          list.push({ period: stint.period, startMs: stint.startMs, endMs: stint.endMs ?? 0 });
          byPlayer.set(stint.playerId, list);
        }
        for (const list of byPlayer.values()) {
          list.sort((x, y) => x.period - y.period || x.startMs - y.startMs);
          for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1]!;
            const cur = list[i]!;
            if (prev.period !== cur.period) continue;
            expect(cur.startMs).toBeGreaterThanOrEqual(prev.endMs);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('is independent of the order events arrive in', () => {
    fc.assert(
      fc.property(gameArb, fc.integer(), (spec, seed) => {
        const { events, config } = buildGame(spec as GameSpec);
        // Offline sync hands events back in arbitrary order; `seq` must be the
        // only thing that decides the fold.
        const shuffled = [...events].sort(
          (x, y) => Math.sin(x.seq * seed) - Math.sin(y.seq * seed),
        );
        const a = reduce(events, config).state;
        const b = reduce(shuffled, config).state;
        expect(totalPlayedMs(b, 0)).toBe(totalPlayedMs(a, 0));
        expect(b.score).toEqual(a.score);
        expect(b.stints).toEqual(a.stints);
        expect(b.status).toBe(a.status);
      }),
      { numRuns: RUNS },
    );
  });

  /**
   * The properties above all run to a finished game, where every stint is closed
   * and carries an explicit clock value — so none of them ever reads the live
   * anchor. These two cover the mid-game path, where playing time is derived
   * against wall time. That is where stoppage-time bugs live.
   */
  it('holds mid-period, with stints still open', () => {
    fc.assert(
      fc.property(gameArb, fc.integer({ min: 0, max: 10 * MIN }), (spec, extraMs) => {
        const { events, config } = buildGame(spec as GameSpec, { leaveLastPeriodOpen: true });
        const { state, applied } = reduce(events, config);
        if (state.status !== 'running' || !state.anchor) return;

        // Derive the wall time that yields a chosen clock position, so the
        // assertion stays exact rather than approximate.
        const target = state.clockMs + extraMs;
        const now = state.anchor.wallTs + (target - state.anchor.clockMs);

        expect(clockAt(state, now)).toBe(target);
        expect(totalPlayedMs(state, now)).toBe(fieldTimeIntegralMs(applied, target));
      }),
      { numRuns: RUNS },
    );
  });

  it('accrues nothing while the clock is paused', () => {
    fc.assert(
      fc.property(gameArb, fc.integer({ min: 0, max: 10 * MIN }), (spec, waitMs) => {
        const { events, config } = buildGame(spec as GameSpec, { leaveLastPeriodOpen: true });
        const { state } = reduce(events, config);
        if (state.status !== 'running' || !state.anchor) return;

        // Pause on the spot, then let arbitrary wall time pass.
        const pausedAt = state.clockMs + 1000;
        const pauseWall = state.anchor.wallTs + (pausedAt - state.anchor.clockMs);
        const withPause = [
          ...events,
          {
            type: 'CLOCK_PAUSE' as const,
            id: 'pause',
            gameId: state.gameId,
            seq: state.lastSeq + 1,
            wallTs: pauseWall,
            gameClockMs: pausedAt,
            period: state.period,
          },
        ];
        const after = reduce(withPause, config).state;

        expect(after.status).toBe('paused');
        expect(clockAt(after, pauseWall + waitMs)).toBe(pausedAt);
        expect(totalPlayedMs(after, pauseWall + waitMs)).toBe(totalPlayedMs(after, pauseWall));
      }),
      { numRuns: RUNS },
    );
  });

  it('keeps the fairness index in range', () => {
    fc.assert(
      fc.property(gameArb, (spec) => {
        const { events, config } = buildGame(spec as GameSpec);
        const { state } = reduce(events, config);
        const index = fairnessIndex(state, 0);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(1);
      }),
      { numRuns: RUNS },
    );
  });
});
