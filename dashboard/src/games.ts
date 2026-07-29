import {
  fairnessIndex,
  formatClock,
  reduce,
  stintDurationMs,
  stintEndMs,
  type GameState,
} from '@pitchside/core';
import type { DashboardGame, DashboardSnapshot } from './types';

export interface GameSummary {
  game: DashboardGame;
  state: GameState;
  /** Only set for a finished game — a live game's score isn't a result yet. */
  result: 'W' | 'L' | 'D' | null;
  fairness: number;
}

/** Every non-setup game, folded once, newest first. */
export function foldGames(snapshot: DashboardSnapshot): GameSummary[] {
  const eventsByGame = new Map<string, DashboardSnapshot['events']>();
  for (const event of snapshot.events) {
    const list = eventsByGame.get(event.game_id) ?? [];
    list.push(event);
    eventsByGame.set(event.game_id, list);
  }
  for (const list of eventsByGame.values()) list.sort((a, b) => a.seq - b.seq);

  const now = Date.now();
  return snapshot.games
    .filter((g) => g.status !== 'setup')
    .map((game) => {
      const events = (eventsByGame.get(game.id) ?? []).map((e) => e.payload);
      const { state } = reduce(events, game.config, game.id);
      const result =
        game.status === 'final'
          ? state.score.us > state.score.them
            ? 'W'
            : state.score.us < state.score.them
              ? 'L'
              : 'D'
          : null;
      return {
        game,
        state,
        result,
        fairness: fairnessIndex(state, now),
      } satisfies GameSummary;
    })
    .sort((a, b) => new Date(b.game.kickoff_at).getTime() - new Date(a.game.kickoff_at).getTime());
}

export interface TeamRecord {
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** Record over finished games only — a live game's score isn't decided yet. */
export function teamRecord(games: readonly GameSummary[]): TeamRecord {
  const record: TeamRecord = { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0 };
  for (const g of games) {
    if (g.result === null) continue;
    if (g.result === 'W') record.wins += 1;
    else if (g.result === 'L') record.losses += 1;
    else record.draws += 1;
    record.goalsFor += g.state.score.us;
    record.goalsAgainst += g.state.score.them;
  }
  return record;
}

/** Where each period begins on a single continuous timeline — same as Summary.tsx. */
export function periodOffsets(state: GameState): number[] {
  return state.periodElapsedMs.reduce<number[]>((acc, ms, i) => {
    acc.push((acc[i - 1] ?? 0) + (i === 0 ? 0 : (state.periodElapsedMs[i - 1] ?? 0)));
    return acc;
  }, []);
}

export { formatClock, stintDurationMs, stintEndMs };
