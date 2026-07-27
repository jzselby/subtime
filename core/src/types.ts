/**
 * Core domain types.
 *
 * Two conventions matter and are relied on everywhere else:
 *
 * 1. **`gameClockMs` is authoritative; `wallTs` is audit metadata.** All derived
 *    stats are computed from clock positions, never from wall time. This is what
 *    makes post-game correction sane: the coach edits "that sub was at 12:30" and
 *    the fold just works. The live app converts wall time to clock position when
 *    it appends an event (see `clockAt`).
 *
 * 2. **The clock is per-period and restarts at 0 each period.** Stints carry their
 *    period, so the maths never has to reason about cumulative offsets. Use
 *    `displayClockMs` when you want the continuous 45:00+ reading for the UI.
 *
 * A consequence of (2) worth internalising: because stints live in game-clock
 * coordinates, clock pauses are *invisible* to them. Stoppage time is excluded
 * from playing time for free, with no special handling in the stint fold.
 */

export type PlayerId = string;

/**
 * Position codes are deliberately open strings, not an enum — formations and
 * position taxonomies differ by age group and by coach, and pinning them here
 * would defeat the point of building your own app.
 */
export type PositionCode = string;

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'injured';

export interface PeriodConfig {
  /** Number of periods: 2 for halves, 4 for quarters. */
  count: number;
  /** Regulation length of a single period, in ms. */
  lengthMs: number;
  /** Players on the field per side, including the keeper (7 for 7v7). */
  fieldPlayers: number;
}

export interface FairnessPolicy {
  /**
   * How much a minute in goal counts toward a player's fairness total.
   * 1 = a minute is a minute, 0.5 = keeper time counts half, 0 = excluded.
   * Genuinely contested among coaches, which is exactly why it is configurable.
   */
  gkWeight: number;
  mode: 'equal' | 'attendance-weighted';
}

export interface GameConfig {
  periods: PeriodConfig;
  fairness: FairnessPolicy;
  /** Which position code counts as the keeper for `gkWeight` purposes. */
  gkPosition: PositionCode;
}

export const defaultConfig = (overrides: Partial<GameConfig> = {}): GameConfig => ({
  periods: { count: 2, lengthMs: 30 * 60_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' },
  gkPosition: 'GK',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventType =
  | 'ATTENDANCE'
  | 'SET_LINEUP'
  | 'PERIOD_START'
  | 'PERIOD_END'
  | 'CLOCK_PAUSE'
  | 'CLOCK_RESUME'
  | 'SUB'
  | 'POSITION_CHANGE'
  | 'GOAL'
  | 'OPPONENT_GOAL'
  | 'CARD'
  | 'SHOT'
  | 'SAVE'
  | 'NOTE';

export interface EventMeta {
  /** Client-generated, ideally UUIDv7 so it sorts by creation. Sync key. */
  id: string;
  gameId: string;
  /** Monotonic per game. The ordering key — `id` is only the identity key. */
  seq: number;
  /** Epoch ms. Audit and reconstruction only; never drives stats. */
  wallTs: number;
  /**
   * Clock position within `period`. Authoritative for all derived stats.
   * Ignored by the reducer for events applied while the clock is not running.
   */
  gameClockMs: number;
  /** 1-based. Use the upcoming (or just-ended) period for untimed events. */
  period: number;
}

export type PlayerSlot = { playerId: PlayerId; position: PositionCode };

export type GameEvent = EventMeta &
  (
    | { type: 'ATTENDANCE'; playerId: PlayerId; status: AttendanceStatus }
    /** Idempotent replace of the whole on-field set. What the pre-game screen emits. */
    | { type: 'SET_LINEUP'; slots: PlayerSlot[] }
    | { type: 'PERIOD_START' }
    | { type: 'PERIOD_END' }
    | { type: 'CLOCK_PAUSE'; reason?: string }
    | { type: 'CLOCK_RESUME' }
    /** Incremental change. `off` and `on` need not be the same length. */
    | { type: 'SUB'; off: PlayerId[]; on: PlayerSlot[] }
    | { type: 'POSITION_CHANGE'; playerId: PlayerId; to: PositionCode }
    | {
        type: 'GOAL';
        scorerId: PlayerId | null;
        assistId?: PlayerId | null;
        penalty?: boolean;
        ownGoal?: boolean;
      }
    | { type: 'OPPONENT_GOAL' }
    | { type: 'CARD'; playerId: PlayerId; card: 'yellow' | 'red' }
    | { type: 'SHOT'; playerId: PlayerId; onTarget: boolean }
    | { type: 'SAVE'; playerId: PlayerId }
    | { type: 'NOTE'; text: string }
  );

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

/**
 * A continuous span on the field in one position, in game-clock coordinates.
 * Half-open: `[startMs, endMs)`. The half-open convention is what stops a sub
 * at minute 20 from being double-counted against both players.
 */
export interface Stint {
  playerId: PlayerId;
  position: PositionCode;
  period: number;
  startMs: number;
  /** `null` while the player is still on the field. */
  endMs: number | null;
}

export interface GoalRecord {
  eventId: string;
  period: number;
  clockMs: number;
  team: 'us' | 'them';
  scorerId: PlayerId | null;
  assistId: PlayerId | null;
  penalty: boolean;
  ownGoal: boolean;
}

export interface CardRecord {
  eventId: string;
  playerId: PlayerId;
  card: 'yellow' | 'red';
  period: number;
  clockMs: number;
}

/** A non-fatal problem with one event. The event is skipped, the fold continues. */
export interface ReduceError {
  eventId: string;
  seq: number;
  type: EventType;
  reason: string;
}
