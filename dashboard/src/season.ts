import { aggregatePlayerStats, playerStats, reduce, type PlayerSeasonStats } from '@touchline/core';
import type { DashboardSnapshot } from './types';

/**
 * Exactly `Season.tsx`'s fold, run here instead of in the app: one
 * `playerStats()` per started game, summed by `aggregatePlayerStats()`. The
 * whole point of syncing the raw event log rather than pre-aggregated totals
 * is that this is the *same* code, not a second implementation of it — see
 * DESIGN.md's "avoid the two-implementations trap".
 */
export function seasonStats(snapshot: DashboardSnapshot): {
  rows: PlayerSeasonStats[];
  gameCount: number;
} {
  const eventsByGame = new Map<string, DashboardSnapshot['events']>();
  for (const event of snapshot.events) {
    const list = eventsByGame.get(event.game_id) ?? [];
    list.push(event);
    eventsByGame.set(event.game_id, list);
  }
  for (const list of eventsByGame.values()) list.sort((a, b) => a.seq - b.seq);

  const started = snapshot.games.filter((g) => g.status !== 'setup');
  const perGame = started.map((game) => {
    const events = (eventsByGame.get(game.id) ?? []).map((e) => e.payload);
    const { state } = reduce(events, game.config, game.id);
    return playerStats(state, Date.now()).filter(
      (s) => state.attendance.get(s.playerId) !== 'absent',
    );
  });

  return { rows: aggregatePlayerStats(perGame), gameCount: started.length };
}
