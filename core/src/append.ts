import { clockAt } from './clock.js';
import type { GameState } from './reducer.js';
import type { GameEvent } from './types.js';

/**
 * The parts of an event a caller supplies; the rest is derived from state.
 *
 * Distributive on purpose: a bare `Omit` over a discriminated union collapses to
 * the keys the members share, which would throw away every payload field.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type EventInput = DistributiveOmit<
  GameEvent,
  'id' | 'gameId' | 'seq' | 'wallTs' | 'gameClockMs' | 'period'
>;

let counter = 0;

/** UUIDv7-ish: time-ordered, so event ids sort by creation. */
export function newEventId(wallTs: number = Date.now()): string {
  const time = wallTs.toString(16).padStart(12, '0');
  const seq = (counter = (counter + 1) & 0xffff).toString(16).padStart(4, '0');
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${seq.slice(1)}-${rand.slice(0, 4)}-${rand.slice(4)}${seq}${time.slice(0, 4)}`;
}

/**
 * Stamp an event with the metadata the reducer needs: sequence, wall time, and
 * — the important one — the clock position derived from `state` at `wallTs`.
 *
 * This is the single place wall time is converted into a clock position. Every
 * other part of the system works in clock coordinates, which is what makes
 * post-game correction just an edit of `gameClockMs`.
 */
export function appendEvent(
  state: GameState,
  input: EventInput,
  wallTs: number = Date.now(),
  id: string = newEventId(wallTs),
): GameEvent {
  const isStart = input.type === 'PERIOD_START';
  return {
    ...input,
    id,
    gameId: state.gameId,
    seq: state.lastSeq + 1,
    wallTs,
    gameClockMs: isStart ? 0 : clockAt(state, wallTs),
    period: isStart ? state.period + 1 : Math.max(1, state.period),
  } as GameEvent;
}
