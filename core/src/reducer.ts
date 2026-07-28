import type {
  AttendanceStatus,
  CardRecord,
  GameConfig,
  GameEvent,
  GoalRecord,
  PlayerId,
  PositionCode,
  ReduceError,
  Stint,
} from './types.js';

/**
 * Everything derivable from the event log, plus the bookkeeping the fold needs.
 *
 * `status` is a small state machine:
 *
 *   pregame ──PERIOD_START──▶ running ⇄ paused        (CLOCK_PAUSE/CLOCK_RESUME)
 *                                │
 *                            PERIOD_END
 *                                │
 *                                ▼
 *                       break ──PERIOD_START──▶ running     (more periods left)
 *                       final                               (last period ended)
 *
 * GAME_END is the other way into `final`: from any of pregame, running,
 * paused or break, called by the coach rather than derived from the period
 * count — a game stopped early is still a finished game.
 *
 * Substitutions are legal in every state. Subbing while stopped changes the
 * on-field set without accruing any time, which is exactly what you want for
 * setting the starting XI and for halftime changes.
 */
export interface GameStateShape {
  gameId: string;
  config: GameConfig;
  status: 'pregame' | 'running' | 'paused' | 'break' | 'final';
  /** 1-based; 0 before the first period starts. */
  period: number;
  /** Clock position within the current period, as of the last applied event. */
  clockMs: number;
  /**
   * Non-null exactly while the clock is running. Live elapsed time is derived
   * from this against wall time, so nothing has to tick and nothing can drift.
   */
  anchor: { wallTs: number; clockMs: number } | null;
  onField: Map<PlayerId, PositionCode>;
  attendance: Map<PlayerId, AttendanceStatus>;
  /** Includes still-open stints, which carry `endMs: null`. */
  stints: Stint[];
  goals: GoalRecord[];
  cards: CardRecord[];
  shots: Map<PlayerId, { total: number; onTarget: number }>;
  saves: Map<PlayerId, number>;
  score: { us: number; them: number };
  /** Final elapsed clock per completed period; index is `period - 1`. */
  periodElapsedMs: number[];
  notes: { clockMs: number; period: number; text: string }[];
  lastSeq: number;
  appliedCount: number;
  /** Index into `stints` of each player's currently open stint. */
  openStintIdx: Map<PlayerId, number>;
}

export type { GameStateShape as GameState };

export function initialState(gameId: string, config: GameConfig): GameStateShape {
  return {
    gameId,
    config,
    status: 'pregame',
    period: 0,
    clockMs: 0,
    anchor: null,
    onField: new Map(),
    attendance: new Map(),
    stints: [],
    goals: [],
    cards: [],
    shots: new Map(),
    saves: new Map(),
    score: { us: 0, them: 0 },
    periodElapsedMs: [],
    notes: [],
    lastSeq: -1,
    appliedCount: 0,
    openStintIdx: new Map(),
  };
}

const isRunning = (s: GameStateShape) => s.status === 'running';

/** Clock position an event should be applied at, clamped to never run backwards. */
function eventClock(s: GameStateShape, e: GameEvent): number {
  return isRunning(s) ? e.gameClockMs : s.clockMs;
}

function openStint(
  s: GameStateShape,
  playerId: PlayerId,
  position: PositionCode,
  atMs: number,
): void {
  if (s.openStintIdx.has(playerId)) return;
  s.openStintIdx.set(playerId, s.stints.length);
  s.stints.push({ playerId, position, period: s.period, startMs: atMs, endMs: null });
}

function closeStint(s: GameStateShape, playerId: PlayerId, atMs: number): void {
  const idx = s.openStintIdx.get(playerId);
  if (idx === undefined) return;
  const stint = s.stints[idx];
  if (stint) stint.endMs = Math.max(stint.startMs, atMs);
  s.openStintIdx.delete(playerId);
}

function closeAllStints(s: GameStateShape, atMs: number): void {
  for (const playerId of [...s.openStintIdx.keys()]) closeStint(s, playerId, atMs);
}

/** Put a player on the field, opening a stint if the clock is running. */
function putOn(s: GameStateShape, playerId: PlayerId, position: PositionCode, atMs: number): void {
  s.onField.set(playerId, position);
  if (isRunning(s)) openStint(s, playerId, position, atMs);
}

function takeOff(s: GameStateShape, playerId: PlayerId, atMs: number): void {
  s.onField.delete(playerId);
  closeStint(s, playerId, atMs);
}

/**
 * Apply one event, mutating `state`. Returns an error instead of applying when
 * the event is not legal in the current state.
 *
 * Mutating is deliberate: a season is tens of thousands of events and this fold
 * runs on every render of a live game. `reduce` owns the state it mutates, so
 * the impurity never escapes.
 */
function applyEvent(s: GameStateShape, e: GameEvent): string | null {
  if (s.status === 'final' && e.type !== 'NOTE') {
    return 'game is already final';
  }

  // A running clock must move forward. Rejecting this is what stops an
  // out-of-order or mis-edited log from producing negative-duration stints.
  //
  // PERIOD_START is exempt: it is the one event that legitimately carries a
  // period other than the current one, and it resets the clock to zero. Its own
  // handler below does the validation that actually applies to it.
  if (isRunning(s) && e.type !== 'PERIOD_START') {
    if (e.period !== s.period) {
      return `event period ${e.period} does not match running period ${s.period}`;
    }
    if (e.gameClockMs < s.clockMs) {
      return `clock moves backwards (${e.gameClockMs}ms < ${s.clockMs}ms)`;
    }
  }

  const at = eventClock(s, e);

  switch (e.type) {
    case 'ATTENDANCE': {
      s.attendance.set(e.playerId, e.status);
      break;
    }

    case 'SET_LINEUP': {
      const seen = new Set<PlayerId>();
      for (const slot of e.slots) {
        if (seen.has(slot.playerId)) return `player ${slot.playerId} listed twice in lineup`;
        seen.add(slot.playerId);
      }
      for (const playerId of [...s.onField.keys()]) {
        if (!seen.has(playerId)) takeOff(s, playerId, at);
      }
      for (const slot of e.slots) {
        const current = s.onField.get(slot.playerId);
        if (current === slot.position) continue;
        if (current !== undefined) closeStint(s, slot.playerId, at);
        putOn(s, slot.playerId, slot.position, at);
      }
      break;
    }

    case 'SUB': {
      for (const playerId of e.off) {
        if (!s.onField.has(playerId)) return `player ${playerId} is not on the field`;
      }
      for (const slot of e.on) {
        if (s.onField.has(slot.playerId) && !e.off.includes(slot.playerId)) {
          return `player ${slot.playerId} is already on the field`;
        }
      }
      // Off before on, so a straight swap frees its slot before it is refilled.
      for (const playerId of e.off) takeOff(s, playerId, at);
      for (const slot of e.on) putOn(s, slot.playerId, slot.position, at);
      break;
    }

    case 'POSITION_CHANGE': {
      if (!s.onField.has(e.playerId)) return `player ${e.playerId} is not on the field`;
      if (s.onField.get(e.playerId) === e.to) break;
      closeStint(s, e.playerId, at);
      putOn(s, e.playerId, e.to, at);
      break;
    }

    case 'PERIOD_START': {
      if (s.status === 'running' || s.status === 'paused') {
        return `period ${s.period} is still in progress`;
      }
      if (e.period !== s.period + 1) {
        return `expected period ${s.period + 1}, got ${e.period}`;
      }
      if (e.period > s.config.periods.count) {
        return `period ${e.period} exceeds configured period count ${s.config.periods.count}`;
      }
      s.period = e.period;
      s.clockMs = 0;
      s.status = 'running';
      s.anchor = { wallTs: e.wallTs, clockMs: 0 };
      // Whoever finished the break on the field starts the period on the field,
      // so the coach never re-enters an unchanged lineup.
      for (const [playerId, position] of s.onField) openStint(s, playerId, position, 0);
      break;
    }

    case 'PERIOD_END': {
      if (s.status !== 'running' && s.status !== 'paused') return 'no period in progress';
      if (e.period !== s.period) return `expected period ${s.period}, got ${e.period}`;
      const endAt = s.status === 'running' ? e.gameClockMs : s.clockMs;
      closeAllStints(s, endAt);
      s.periodElapsedMs[s.period - 1] = endAt;
      s.clockMs = endAt;
      s.anchor = null;
      s.status = s.period >= s.config.periods.count ? 'final' : 'break';
      break;
    }

    case 'GAME_END': {
      // Mirrors PERIOD_END's clock-closing when a period is actually live;
      // between periods (break) or before the first (pregame) there is
      // nothing open to close — PERIOD_END already did that on the way in.
      if (s.status === 'running' || s.status === 'paused') {
        const endAt = s.status === 'running' ? e.gameClockMs : s.clockMs;
        closeAllStints(s, endAt);
        s.periodElapsedMs[s.period - 1] = endAt;
        s.clockMs = endAt;
      }
      s.anchor = null;
      s.status = 'final';
      break;
    }

    case 'CLOCK_PAUSE': {
      if (s.status !== 'running') return 'clock is not running';
      s.clockMs = e.gameClockMs;
      s.anchor = null;
      s.status = 'paused';
      // Stints stay open: the game clock is frozen, so they accrue nothing.
      break;
    }

    case 'CLOCK_RESUME': {
      if (s.status !== 'paused') return 'clock is not paused';
      s.status = 'running';
      s.anchor = { wallTs: e.wallTs, clockMs: s.clockMs };
      break;
    }

    case 'GOAL': {
      s.goals.push({
        eventId: e.id,
        period: s.period,
        clockMs: at,
        team: 'us',
        scorerId: e.scorerId,
        assistId: e.assistId ?? null,
        penalty: e.penalty ?? false,
        ownGoal: e.ownGoal ?? false,
      });
      // An own goal by us is a goal for them.
      if (e.ownGoal) s.score.them += 1;
      else s.score.us += 1;
      break;
    }

    case 'OPPONENT_GOAL': {
      s.goals.push({
        eventId: e.id,
        period: s.period,
        clockMs: at,
        team: 'them',
        scorerId: null,
        assistId: null,
        penalty: false,
        ownGoal: false,
      });
      s.score.them += 1;
      break;
    }

    case 'CARD': {
      s.cards.push({
        eventId: e.id,
        playerId: e.playerId,
        card: e.card,
        period: s.period,
        clockMs: at,
      });
      // A red card removes the player and is not replaced — the short-handed
      // case the field-time invariant has to tolerate.
      if (e.card === 'red' && s.onField.has(e.playerId)) takeOff(s, e.playerId, at);
      break;
    }

    case 'SHOT': {
      const cur = s.shots.get(e.playerId) ?? { total: 0, onTarget: 0 };
      s.shots.set(e.playerId, {
        total: cur.total + 1,
        onTarget: cur.onTarget + (e.onTarget ? 1 : 0),
      });
      break;
    }

    case 'SAVE': {
      s.saves.set(e.playerId, (s.saves.get(e.playerId) ?? 0) + 1);
      break;
    }

    case 'NOTE': {
      s.notes.push({ clockMs: at, period: s.period, text: e.text });
      break;
    }
  }

  if (isRunning(s)) s.clockMs = e.gameClockMs;
  return null;
}

export interface ReduceResult {
  state: GameStateShape;
  /**
   * Events that could not be applied, with the reason. Never empty-and-ignored:
   * surface these in the UI. Skipping rather than throwing is deliberate — one
   * bad event in a 400-event log must not make a live game unusable.
   */
  errors: ReduceError[];
  /**
   * The events that actually made it into `state`, in applied order. Lets an
   * independent consumer (notably `fieldTimeIntegralMs`) replay exactly what the
   * reducer saw without having to re-derive which events were skipped.
   */
  applied: GameEvent[];
}

/**
 * Fold an event log into game state.
 *
 * Events are sorted by `seq` first, so callers may pass them in any order
 * (which is what an offline sync will hand you).
 */
export function reduce(
  events: readonly GameEvent[],
  config: GameConfig,
  gameId = events[0]?.gameId ?? 'game',
): ReduceResult {
  const state = initialState(gameId, config);
  const errors: ReduceError[] = [];
  const applied: GameEvent[] = [];
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  for (const event of ordered) {
    if (event.seq === state.lastSeq) {
      errors.push({
        eventId: event.id,
        seq: event.seq,
        type: event.type,
        reason: `duplicate seq ${event.seq}`,
      });
      continue;
    }
    const reason = applyEvent(state, event);
    if (reason) {
      errors.push({ eventId: event.id, seq: event.seq, type: event.type, reason });
      continue;
    }
    state.lastSeq = event.seq;
    state.appliedCount += 1;
    applied.push(event);
  }

  return { state, errors, applied };
}
