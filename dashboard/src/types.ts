import type { GameConfig, GameEvent } from '@touchline/core';

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
