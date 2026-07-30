import { aggregatePlayerStats, playerStats, reduce, type PlayerSeasonStats } from '@pitchside/core';
import type { DashboardSnapshot } from './types';

/**
 * Exactly `Season.tsx`'s fold, run here instead of in the app: one
 * `playerStats()` per started game, summed by `aggregatePlayerStats()`. The
 * whole point of syncing the raw event log rather than pre-aggregated totals
 * is that this is the *same* code, not a second implementation of it — see
 * DESIGN.md's "avoid the two-implementations trap".
 *
 * Takes `games` separately from the rest of `snapshot` — not just
 * `snapshot.games` — so a caller filtering to one tag (or any other subset)
 * only has to filter that one array; the totals here, the results chart, and
 * the games list all end up looking at the same games rather than three
 * different ideas of "the season" on one page.
 */
export function seasonStats(
  games: DashboardSnapshot['games'],
  events: DashboardSnapshot['events'],
): {
  rows: PlayerSeasonStats[];
  gameCount: number;
} {
  const eventsByGame = new Map<string, DashboardSnapshot['events']>();
  for (const event of events) {
    const list = eventsByGame.get(event.game_id) ?? [];
    list.push(event);
    eventsByGame.set(event.game_id, list);
  }
  for (const list of eventsByGame.values()) list.sort((a, b) => a.seq - b.seq);

  const started = games.filter((g) => g.status !== 'setup');
  const perGame = started.map((game) => {
    const events = (eventsByGame.get(game.id) ?? []).map((e) => e.payload);
    const { state } = reduce(events, game.config, game.id);
    return playerStats(state, Date.now()).filter(
      (s) => state.attendance.get(s.playerId) !== 'absent',
    );
  });

  return { rows: aggregatePlayerStats(perGame), gameCount: started.length };
}
