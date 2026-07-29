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
// Season aggregation
// ---------------------------------------------------------------------------

export interface PlayerSeasonStats {
  playerId: PlayerId;
  /** Games actually played — present or late, and on the field for some of it. */
  games: number;
  playedMs: number;
  benchMs: number;
  msByPosition: Record<PositionCode, number>;
  positionsPlayed: number;
  goals: number;
  assists: number;
  plusMinus: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
}

/**
 * Sum a season's worth of `playerStats()` calls into one row per player.
 *
 * Takes already-computed per-game rows rather than games or events, so it
 * stays framework-free and ignorant of storage — the caller folds each game's
 * log with `reduce()` + `playerStats()` however it likes (a database query in
 * the app, a fixture array in a test) and hands the results here.
 */
export function aggregatePlayerStats(perGame: readonly PlayerGameStats[][]): PlayerSeasonStats[] {
  const blank = (playerId: PlayerId): PlayerSeasonStats => ({
    playerId,
    games: 0,
    playedMs: 0,
    benchMs: 0,
    msByPosition: {},
    positionsPlayed: 0,
    goals: 0,
    assists: 0,
    plusMinus: 0,
    shots: 0,
    shotsOnTarget: 0,
    saves: 0,
    yellowCards: 0,
    redCards: 0,
  });

  const rows = new Map<PlayerId, PlayerSeasonStats>();
  const row = (playerId: PlayerId): PlayerSeasonStats => {
    let r = rows.get(playerId);
    if (!r) {
      r = blank(playerId);
      rows.set(playerId, r);
    }
    return r;
  };

  for (const game of perGame) {
    for (const s of game) {
      const r = row(s.playerId);
      if (s.playedMs > 0) r.games += 1;
      r.playedMs += s.playedMs;
      r.benchMs += s.benchMs;
      for (const [code, ms] of Object.entries(s.msByPosition)) {
        r.msByPosition[code] = (r.msByPosition[code] ?? 0) + ms;
      }
      r.goals += s.goals;
      r.assists += s.assists;
      r.plusMinus += s.plusMinus;
      r.shots += s.shots;
      r.shotsOnTarget += s.shotsOnTarget;
      r.saves += s.saves;
      r.yellowCards += s.yellowCards;
      r.redCards += s.redCards;
    }
  }

  for (const r of rows.values()) r.positionsPlayed = Object.keys(r.msByPosition).length;

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
  /**
   * Currently in goal under `gkWeight: 0` — not part of the equal-rotation
   * pool at all right now, rather than merely weighted low within it.
   * `targetMs`/`deficitMs` are both zero for exactly this reason; the UI
   * uses this to skip the "on track" / "ends N short" tag entirely rather
   * than show one that would otherwise read as a false all-clear.
   */
  excludedGk: boolean;
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
 *
 * `gkWeight: 0` ("Not at all", in Team settings) means the keeper is
 * *excluded*, not just weighted to zero within the same pool — whoever is
 * currently in goal carries no target and no deficit, and their slot's
 * minutes are not divided up among everyone else's targets either. Discounting
 * only their *credit* while still expecting them to hit the same target as
 * anyone else — which is what a naive zero-weight would do — made a keeper who
 * had played the entire game look exactly as "owed" as someone who had not
 * played at all, the opposite of what "excluded" is supposed to mean. This
 * is per-instant, not per-game: a rotating keeper picks the target back up
 * the moment they're subbed to an outfield position or the bench, and
 * because gkWeight discounted their time in goal, they still start that
 * next spell genuinely behind — which is the point of the setting for a
 * team that rotates keepers rather than dedicating one.
 */
export function fairness(
  state: GameState,
  nowWallTs: number,
  weights?: ReadonlyMap<PlayerId, number>,
): FairnessRow[] {
  const { count, lengthMs, fieldPlayers } = state.config.periods;
  const remaining = remainingInGameMs(state, nowWallTs);

  const roster = availablePlayers(state);
  const pool = roster.length > 0 ? roster : [...new Set(state.stints.map((s) => s.playerId))].sort();

  const gkExcluded = state.config.fairness.gkWeight === 0;
  const isExcludedGk = (playerId: PlayerId): boolean =>
    gkExcluded && state.onField.get(playerId) === state.config.gkPosition;

  const sharedPool = pool.filter((playerId) => !isExcludedGk(playerId));
  const excludedSlots = pool.length - sharedPool.length;
  const totalFieldMs = count * lengthMs * Math.max(0, fieldPlayers - excludedSlots);

  const weightOf = (playerId: PlayerId): number => weights?.get(playerId) ?? 1;
  const weightSum = sharedPool.reduce((acc, playerId) => acc + weightOf(playerId), 0);

  const stats = new Map(playerStats(state, nowWallTs).map((s) => [s.playerId, s]));

  const rows: FairnessRow[] = pool.map((playerId) => {
    const s = stats.get(playerId);
    const playedMs = s?.playedMs ?? 0;
    const weightedPlayedMs = s?.weightedPlayedMs ?? 0;
    const onField = state.onField.has(playerId);
    const projectedMs = weightedPlayedMs + (onField ? remaining : 0);
    const excludedGk = isExcludedGk(playerId);
    const targetMs = excludedGk
      ? 0
      : weightSum > 0
        ? (totalFieldMs * weightOf(playerId)) / weightSum
        : 0;
    return {
      playerId,
      onField,
      playedMs,
      weightedPlayedMs,
      projectedMs,
      targetMs,
      deficitMs: excludedGk ? 0 : targetMs - projectedMs,
      excludedGk,
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
 *
 * With `gkWeight: 0`, whoever is in goal (as of the state passed in — for a
 * finished game that's however the lineup stood at the final whistle) is left
 * out of the ratio for the same reason `fairness()` excludes them: a
 * dedicated keeper's very different minutes profile is not a rotation
 * fairness question, and folding it into a raw min/max would either make the
 * team look unfair for a decision that was never about equal rotation, or —
 * if the keeper never subs and so has the *most* minutes of anyone — inflate
 * the score by making them the max everyone else is compared against.
 */
export function fairnessIndex(state: GameState, nowWallTs: number): number {
  const pool = availablePlayers(state);
  const gkExcluded = state.config.fairness.gkWeight === 0;
  const stats = playerStats(state, nowWallTs).filter(
    (s) =>
      (pool.length === 0 || pool.includes(s.playerId)) &&
      !(gkExcluded && state.onField.get(s.playerId) === state.config.gkPosition),
  );
  if (stats.length === 0) return 1;
  const times = stats.map((s) => s.playedMs);
  const max = Math.max(...times);
  const min = Math.min(...times);
  if (max === 0) return 1;
  return min / max;
}
