import type { GameConfig, GameEvent } from '@pitchside/core';

/** The exact shape `get_team_dashboard()` returns — see supabase/schema.sql. */
export interface DashboardTeam {
  id: string;
  name: string;
  age_group: string | null;
  formation: unknown;
  config: GameConfig;
  dashboard_enabled: boolean;
  updated_at: string;
}

export interface DashboardPlayer {
  id: string;
  team_id: string;
  name: string;
  number: string;
  active: number;
}

export interface DashboardGame {
  id: string;
  team_id: string;
  opponent: string | null;
  kickoff_at: string;
  config: GameConfig;
  formation: unknown;
  status: 'setup' | 'live' | 'final';
  /** 'fall' | 'spring' | 'tournament' | 'scrimmage' | null — see app/src/db.ts's GameTag. */
  tag: string | null;
}

export interface DashboardEvent {
  id: string;
  game_id: string;
  seq: number;
  payload: GameEvent;
}

export interface DashboardSnapshot {
  team: DashboardTeam;
  players: DashboardPlayer[];
  games: DashboardGame[];
  events: DashboardEvent[];
}

/** The exact shape `get_team_scoreboard()` returns — see
 *  supabase/schema.sql. Deliberately much smaller than DashboardSnapshot:
 *  no roster, no event log, no playing time — see that function's own
 *  comment for why that's a structural guarantee, not just this type. */
export interface ScoreboardGoal {
  period: number;
  clockMs: number;
  team: 'us' | 'them';
  scorerName: string | null;
  assistName: string | null;
  penalty: boolean;
  ownGoal: boolean;
}

export interface ScoreboardGame {
  opponent: string | null;
  kickoff_at: string;
  status: 'setup' | 'live' | 'final';
  tag: string | null;
  periods: { count: number; lengthMs: number };
  score_us: number;
  score_them: number;
  /** The reducer's own finer state, not `status` above — lets the page tell
   *  "half-time" and "paused" apart from "final". */
  clock_status: 'pregame' | 'running' | 'paused' | 'break' | 'final';
  clock_period: number;
  clock_ms: number;
  clock_anchor: { wallTs: number; clockMs: number } | null;
  period_elapsed_ms: number[];
  goals: ScoreboardGoal[];
}

export interface ScoreboardSnapshot {
  team: { name: string; age_group: string | null };
  /** Null for a team that's never published a game yet. */
  game: ScoreboardGame | null;
}
