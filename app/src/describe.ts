import type { GameEvent } from '@touchline/core';

/** Human-readable line for an event. Narrows on the discriminated union. */
export function describeEvent(
  e: GameEvent,
  nameOf: (id: string) => { name: string } | undefined,
): string {
  const nm = (id: string | null | undefined) => (id ? (nameOf(id)?.name ?? '?') : 'unknown');
  switch (e.type) {
    case 'PERIOD_START':
      return `Period ${e.period} started`;
    case 'PERIOD_END':
      return `Period ${e.period} ended`;
    case 'GAME_END':
      return 'Game ended';
    case 'CLOCK_PAUSE':
      return 'Clock stopped';
    case 'CLOCK_RESUME':
      return 'Clock restarted';
    case 'SUB': {
      const off = e.off.map(nm).join(', ') || '—';
      const on = e.on.map((s) => nm(s.playerId)).join(', ') || '—';
      return `Sub: ${off} off, ${on} on`;
    }
    case 'POSITION_CHANGE':
      return `${nm(e.playerId)} → ${e.to}`;
    case 'GOAL':
      return `Goal: ${nm(e.scorerId)}${e.assistId ? ` (assist ${nm(e.assistId)})` : ''}${e.ownGoal ? ' — own goal' : ''}`;
    case 'OPPONENT_GOAL':
      return 'Opponent scored';
    case 'SET_LINEUP':
      return `Lineup set (${e.slots.length} players)`;
    case 'ATTENDANCE':
      return `${nm(e.playerId)}: ${e.status}`;
    case 'CARD':
      return `${e.card} card: ${nm(e.playerId)}`;
    case 'SHOT':
      return `Shot: ${nm(e.playerId)}${e.onTarget ? ' (on target)' : ''}`;
    case 'SAVE':
      return `Save: ${nm(e.playerId)}`;
    case 'NOTE':
      return e.text;
    default:
      return (e as GameEvent).type;
  }
}

/** Whether an event carries something worth correcting rather than deleting. */
export const isEditable = (e: GameEvent): boolean =>
  e.type === 'GOAL' || e.type === 'CARD' || e.type === 'NOTE';
