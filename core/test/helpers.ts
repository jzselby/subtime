import type { EventInput } from '../src/append.js';
import type { GameConfig, GameEvent, PlayerSlot } from '../src/types.js';
import { defaultConfig } from '../src/types.js';

/**
 * Test log builder. Writes events directly in clock coordinates so tests can
 * say "sub at minute 12" without simulating wall time.
 */
export class LogBuilder {
  readonly events: GameEvent[] = [];
  private seq = 0;
  private period = 1;
  private clockMs = 0;

  constructor(
    readonly config: GameConfig = defaultConfig(),
    readonly gameId = 'g1',
  ) {}

  private push(partial: EventInput): this {
    this.events.push({
      ...partial,
      id: `e${this.seq}`,
      gameId: this.gameId,
      seq: this.seq,
      // Wall time is deliberately offset from clock time so any code that
      // wrongly reads wallTs for stats produces obviously wrong numbers.
      wallTs: 1_700_000_000_000 + this.clockMs * 2,
      gameClockMs: this.clockMs,
      period: this.period,
    } as GameEvent);
    this.seq += 1;
    return this;
  }

  /** Advance the game clock by `ms`. */
  at(ms: number): this {
    this.clockMs = ms;
    return this;
  }

  attendance(playerIds: string[], status: 'present' | 'absent' = 'present'): this {
    for (const playerId of playerIds) this.push({ type: 'ATTENDANCE', playerId, status });
    return this;
  }

  lineup(slots: PlayerSlot[]): this {
    return this.push({ type: 'SET_LINEUP', slots });
  }

  startPeriod(period: number): this {
    this.period = period;
    this.clockMs = 0;
    return this.push({ type: 'PERIOD_START' });
  }

  endPeriod(atMs: number): this {
    this.clockMs = atMs;
    return this.push({ type: 'PERIOD_END' });
  }

  /** Finish the game right now, regardless of remaining configured periods. */
  gameEnd(atMs?: number): this {
    if (atMs !== undefined) this.clockMs = atMs;
    return this.push({ type: 'GAME_END' });
  }

  pause(atMs: number): this {
    this.clockMs = atMs;
    return this.push({ type: 'CLOCK_PAUSE' });
  }

  resume(): this {
    return this.push({ type: 'CLOCK_RESUME' });
  }

  sub(atMs: number, off: string[], on: PlayerSlot[]): this {
    this.clockMs = atMs;
    return this.push({ type: 'SUB', off, on });
  }

  move(atMs: number, playerId: string, to: string): this {
    this.clockMs = atMs;
    return this.push({ type: 'POSITION_CHANGE', playerId, to });
  }

  goal(atMs: number, scorerId: string | null, assistId?: string | null): this {
    this.clockMs = atMs;
    return this.push({ type: 'GOAL', scorerId, assistId: assistId ?? null });
  }

  ownGoal(atMs: number, scorerId: string): this {
    this.clockMs = atMs;
    return this.push({ type: 'GOAL', scorerId, ownGoal: true });
  }

  concede(atMs: number): this {
    this.clockMs = atMs;
    return this.push({ type: 'OPPONENT_GOAL' });
  }

  card(atMs: number, playerId: string, card: 'yellow' | 'red'): this {
    this.clockMs = atMs;
    return this.push({ type: 'CARD', playerId, card });
  }

  /** Wall timestamp corresponding to a clock position, matching `push`. */
  wallAt(clockMs: number): number {
    return 1_700_000_000_000 + clockMs * 2;
  }
}

export const MIN = 60_000;

export const slots = (ids: string[], positions: string[]): PlayerSlot[] =>
  ids.map((playerId, i) => ({ playerId, position: positions[i] ?? 'MF' }));
