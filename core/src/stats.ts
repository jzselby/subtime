import { clockAt, elapsedGameMs, remainingInGameMs } from './clock.js';
import type { GameState } from './reducer.js';
import type { GameEvent, PlayerId, PositionCode, Stint } from './types.js';

/**
 * Everything derived from the stint fold. Each of these is "a different fold
 * over the same log" — the payoff of the event-sourced model.
 */

/** End of a stint, treating a still-open one as ending at the live clock. */
export function stintEndMs(stint: Stint, state: GameState, nowWallTs: number): number {
  return stint.endMs ?? clockAt(state, nowWallTs);
}

export function stintDurationMs(stint: Stint, state: GameState, nowWallTs: number): number {
  return Math.max(0, stintEndMs(stint, state, nowWallTs) - stint.startMs);
}

/**
 * Independent replay that tracks only the *number* of players on the field and
 * integrates it over game-clock time: ∫ onFieldCount dt.
 *
 * This deliberately shares no code with the stint fold. Its whole reason to
 * exist is to be a second opinion — if `Σ stint durations` and this disagree,
 * the stint bookkeeping has a bug. See `test/invariant.test.ts`.
 *
 * Pass `applied` from `reduce()`, not the raw log, so that skipped events are
 * excluded here exactly as they were there.
 *
 * @param endClockMs Clock position to accrue up to if the log ends mid-period.
 *                   A no-op when the clock is not running.
 */
export function fieldTimeIntegralMs(
  applied: readonly GameEvent[],
  endClockMs?: number,
): number {
  const onField = new Set<PlayerId>();
  let running = false;
  let clock = 0;
  let total = 0;

  const accrue = (to: number): void => {
    if (!running) return;
    total += onField.size * Math.max(0, to - clock);
    clock = Math.max(clock, to);
  };

  for (const e of applied) {
    switch (e.type) {
      case 'PERIOD_START':
        running = true;
        clock = 0;
        break;
      case 'PERIOD_END':
      case 'CLOCK_PAUSE':
        accrue(e.gameClockMs);
        running = false;
        break;
      case 'CLOCK_RESUME':
        running = true;
        break;
      case 'SET_LINEUP':
        accrue(e.gameClockMs);
        onField.clear();
        for (const slot of e.slots) onField.add(slot.playerId);
        break;
      case 'SUB':
        accrue(e.gameClockMs);
        for (const playerId of e.off) onField.delete(playerId);
        for (const slot of e.on) onField.add(slot.playerId);
        break;
      case 'CARD':
        accrue(e.gameClockMs);
        if (e.card === 'red') onField.delete(e.playerId);
        break;
      default:
        // POSITION_CHANGE and the pure stat events cannot change the count.
        break;
    }
  }

  if (endClockMs !== undefined) accrue(endClockMs);
  return total;
}

/** Total of every player's time on the field. The other side of the invariant. */
export function totalPlayedMs(state: GameState, nowWallTs: number): number {
  let total = 0;
  for (const stint of state.stints) total += stintDurationMs(stint, state, nowWallTs);
  return total;
}

export interface PlayerGameStats {
  playerId: PlayerId;
  playedMs: number;
  benchMs: number;
  /** Playing time after `gkWeight` is applied. Used for fairness, not reporting. */
  weightedPlayedMs: number;
  msByPosition: Record<PositionCode, number>;
  /** How many distinct positions — the development metric. */
  positionsPlayed: number;
  stintCount: number;
  onField: boolean;
  goals: number;
  assists: number;
  /** Goal differential while this player was on the field. */
  plusMinus: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
}

/** Players to report on: anyone marked in attendance, plus anyone who played. */
function rosterOf(state: GameState): PlayerId[] {
  const ids = new Set<PlayerId>(state.attendance.keys());
  for (const stint of state.stints) ids.add(stint.playerId);
  for (const goal of state.goals) {
    if (goal.scorerId) ids.add(goal.scorerId);
    if (goal.assistId) ids.add(goal.assistId);
  }
  return [...ids].sort();
}

export function playerStats(state: GameState, nowWallTs: number): PlayerGameStats[] {
  const { gkWeight } = state.config.fairness;
  const gkPosition = state.config.gkPosition;
  const elapsed = elapsedGameMs(state, nowWallTs);

  const blank = (playerId: PlayerId): PlayerGameStats => ({
    playerId,
    playedMs: 0,
    benchMs: 0,
    weightedPlayedMs: 0,
    msByPosition: {},
    positionsPlayed: 0,
    stintCount: 0,
    onField: state.onField.has(playerId),
    goals: 0,
    assists: 0,
    plusMinus: 0,
    shots: 0,
    shotsOnTarget: 0,
    saves: 0,
    yellowCards: 0,
    redCards: 0,
  });

  const rows = new Map<PlayerId, PlayerGameStats>();
  for (const playerId of rosterOf(state)) rows.set(playerId, blank(playerId));
  const row = (playerId: PlayerId): PlayerGameStats => {
    let r = rows.get(playerId);
    if (!r) {
      r = blank(playerId);
      rows.set(playerId, r);
    }
    return r;
  };

  for (const stint of state.stints) {
    const r = row(stint.playerId);
    const ms = stintDurationMs(stint, state, nowWallTs);
    r.playedMs += ms;
    r.weightedPlayedMs += stint.position === gkPosition ? ms * gkWeight : ms;
    r.msByPosition[stint.position] = (r.msByPosition[stint.position] ?? 0) + ms;
    r.stintCount += 1;
  }

  for (const goal of state.goals) {
    // An own goal is credited to us but counts against us on the scoreboard and
    // in plus/minus.
    const against = goal.ownGoal ? true : goal.team === 'them';
    if (goal.scorerId && !goal.ownGoal) row(goal.scorerId).goals += 1;
    if (goal.assistId) row(goal.assistId).assists += 1;
    for (const stint of state.stints) {
      if (stint.period !== goal.period) continue;
      const end = stintEndMs(stint, state, nowWallTs);
      // Half-open [start, end): a goal at the instant of a sub belongs to the
      // player coming on, and is counted exactly once.
      if (goal.clockMs >= stint.startMs && goal.clockMs < end) {
        row(stint.playerId).plusMinus += against ? -1 : 1;
      }
    }
  }

  for (const [playerId, s] of state.shots) {
    const r = row(playerId);
    r.shots += s.total;
    r.shotsOnTarget += s.onTarget;
  }
  for (const [playerId, n] of state.saves) row(playerId).saves += n;
  for (const card of state.cards) {
    const r = row(card.playerId);
    if (card.card === 'yellow') r.yellowCards += 1;
    else r.redCards += 1;
  }

  for (const r of rows.values()) {
    r.positionsPlayed = Object.keys(r.msByPosition).length;
    r.benchMs = Math.max(0, elapsed - r.playedMs);
  }

  return [...rows.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
}

// ---------------------------------------------------------------------------
// Fairness
// ---------------------------------------------------------------------------

export interface FairnessRow {
  playerId: PlayerId;
  onField: boolean;
  playedMs: number;
  weightedPlayedMs: number;
  /** Weighted minutes this player finishes with if nothing changes from now on. */
  projectedMs: number;
  /** This player's fair share of total field time. */
  targetMs: number;
  /** `target - projected`. Positive means owed time; sub them on. */
  deficitMs: number;
}

export function availablePlayers(state: GameState): PlayerId[] {
  const out: PlayerId[] = [];
  for (const [playerId, status] of state.attendance) {
    if (status === 'present' || status === 'late') out.push(playerId);
  }
  return out.sort();
}

/**
 * Live fairness table, sorted most-owed first — the top rows are who to bring on.
 *
 * `weights` implements the fairness *mode*: omit it for strict equal time, or
 * pass per-player weights (practice attendance, say) for a weighted target.
 * A player's target is `totalFieldTime × wᵢ / Σw`.
 */
export function fairness(
  state: GameState,
  nowWallTs: number,
  weights?: ReadonlyMap<PlayerId, number>,
): FairnessRow[] {
  const { count, lengthMs, fieldPlayers } = state.config.periods;
  const totalFieldMs = count * lengthMs * fieldPlayers;
  const remaining = remainingInGameMs(state, nowWallTs);

  const roster = availablePlayers(state);
  const pool = roster.length > 0 ? roster : [...new Set(state.stints.map((s) => s.playerId))].sort();

  const weightOf = (playerId: PlayerId): number => weights?.get(playerId) ?? 1;
  const weightSum = pool.reduce((acc, playerId) => acc + weightOf(playerId), 0);

  const stats = new Map(playerStats(state, nowWallTs).map((s) => [s.playerId, s]));

  const rows: FairnessRow[] = pool.map((playerId) => {
    const s = stats.get(playerId);
    const playedMs = s?.playedMs ?? 0;
    const weightedPlayedMs = s?.weightedPlayedMs ?? 0;
    const onField = state.onField.has(playerId);
    const projectedMs = weightedPlayedMs + (onField ? remaining : 0);
    const targetMs = weightSum > 0 ? (totalFieldMs * weightOf(playerId)) / weightSum : 0;
    return {
      playerId,
      onField,
      playedMs,
      weightedPlayedMs,
      projectedMs,
      targetMs,
      deficitMs: targetMs - projectedMs,
    };
  });

  return rows.sort((a, b) => b.deficitMs - a.deficitMs || a.playerId.localeCompare(b.playerId));
}

/**
 * Who to bring on next: the most-owed players who are not currently on.
 * Advisory only — the coach applies or overrides, and the log records reality.
 */
export function suggestSubsOn(state: GameState, nowWallTs: number, howMany: number): PlayerId[] {
  return fairness(state, nowWallTs)
    .filter((r) => !r.onField)
    .slice(0, howMany)
    .map((r) => r.playerId);
}

/** Who to take off next: the on-field players furthest *over* their share. */
export function suggestSubsOff(state: GameState, nowWallTs: number, howMany: number): PlayerId[] {
  const gkPosition = state.config.gkPosition;
  return fairness(state, nowWallTs)
    .filter((r) => r.onField && state.onField.get(r.playerId) !== gkPosition)
    .reverse()
    .slice(0, howMany)
    .map((r) => r.playerId);
}

/**
 * How equal the playing time actually was, as one number in [0, 1] where 1 is
 * perfectly equal — the "are we being fair?" answer for a season report.
 *
 * This is `min / max` of playing time across available players: blunt, but it
 * cannot be gamed by an outlier the way a mean-based measure can, and coaches
 * read it without explanation.
 */
export function fairnessIndex(state: GameState, nowWallTs: number): number {
  const pool = availablePlayers(state);
  const stats = playerStats(state, nowWallTs).filter(
    (s) => pool.length === 0 || pool.includes(s.playerId),
  );
  if (stats.length === 0) return 1;
  const times = stats.map((s) => s.playedMs);
  const max = Math.max(...times);
  const min = Math.min(...times);
  if (max === 0) return 1;
  return min / max;
}
