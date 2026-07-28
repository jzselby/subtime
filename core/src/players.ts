import type { GameEvent, PlayerId } from './types.js';

/**
 * Every player an event names, in any role.
 *
 * The switch is exhaustive on purpose: `never` in the default arm means adding
 * an event type that carries a player id and forgetting it here is a compile
 * error, not a player who silently looks unused. That matters because callers
 * use this to decide whether deleting a player would orphan recorded history.
 */
export function playerIdsIn(e: GameEvent): PlayerId[] {
  switch (e.type) {
    case 'ATTENDANCE':
    case 'POSITION_CHANGE':
    case 'CARD':
    case 'SHOT':
    case 'SAVE':
      return [e.playerId];
    case 'SET_LINEUP':
      return e.slots.map((s) => s.playerId);
    case 'SUB':
      return [...e.off, ...e.on.map((s) => s.playerId)];
    case 'GOAL':
      return [e.scorerId, e.assistId ?? null].filter((id): id is PlayerId => id !== null);
    case 'PERIOD_START':
    case 'PERIOD_END':
    case 'CLOCK_PAUSE':
    case 'CLOCK_RESUME':
    case 'OPPONENT_GOAL':
    case 'NOTE':
      return [];
    default: {
      const exhaustive: never = e;
      return exhaustive;
    }
  }
}

/**
 * Does this player appear anywhere in the log?
 *
 * Attendance alone counts. A player marked absent for a game is still part of
 * that game's record — the fairness numbers were computed around them.
 */
export function appearsInLog(events: readonly GameEvent[], playerId: PlayerId): boolean {
  return events.some((e) => playerIdsIn(e).includes(playerId));
}
