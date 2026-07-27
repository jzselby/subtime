import type { GameConfig, GameEvent } from '@subtime/core';
import { defaultConfig } from '@subtime/core';
import Dexie, { type EntityTable } from 'dexie';

/**
 * Local-first storage. Everything a game needs lives here, so a match can be run
 * with no signal at all. Sync to a server is Phase 2 — and because events are
 * immutable and carry client-generated ids, that sync is an upsert by id with no
 * conflict resolution to write.
 */

export interface Team {
  id: string;
  name: string;
  ageGroup: string;
  /** Position codes offered in the lineup picker, in formation order. */
  positions: string[];
  config: GameConfig;
  createdAt: number;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  number: string;
  active: number; // 0/1 — Dexie cannot index booleans
}

export interface Game {
  id: string;
  teamId: string;
  opponent: string;
  kickoffAt: number;
  config: GameConfig;
  status: 'setup' | 'live' | 'final';
  createdAt: number;
}

export class SubTimeDb extends Dexie {
  teams!: EntityTable<Team, 'id'>;
  players!: EntityTable<Player, 'id'>;
  games!: EntityTable<Game, 'id'>;
  events!: EntityTable<GameEvent, 'id'>;

  constructor() {
    super('subtime');
    this.version(1).stores({
      teams: 'id, name, createdAt',
      players: 'id, teamId, [teamId+active]',
      games: 'id, teamId, kickoffAt, [teamId+status]',
      // Compound index so a game's log loads in sequence order in one query.
      events: 'id, gameId, [gameId+seq]',
    });
  }
}

export const db = new SubTimeDb();

export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 9v9 is the most common youth format, so it is the default for a new team. */
export const DEFAULT_POSITIONS = ['GK', 'LB', 'CB', 'RB', 'LM', 'CM', 'RM', 'LW', 'ST'];

export async function createTeam(name: string, ageGroup: string): Promise<string> {
  const id = uid();
  await db.teams.add({
    id,
    name,
    ageGroup,
    positions: DEFAULT_POSITIONS,
    config: defaultConfig(),
    createdAt: Date.now(),
  });
  return id;
}

export async function createGame(team: Team, opponent: string, kickoffAt: number): Promise<string> {
  const id = uid();
  await db.games.add({
    id,
    teamId: team.id,
    opponent,
    kickoffAt,
    // Snapshot the team's config: changing team defaults later must not rewrite
    // the rules of a game that has already been played.
    config: structuredClone(team.config),
    status: 'setup',
    createdAt: Date.now(),
  });
  return id;
}

export async function deleteGame(gameId: string): Promise<void> {
  await db.transaction('rw', db.games, db.events, async () => {
    await db.events.where('gameId').equals(gameId).delete();
    await db.games.delete(gameId);
  });
}

export async function deleteTeam(teamId: string): Promise<void> {
  await db.transaction('rw', db.teams, db.players, db.games, db.events, async () => {
    const games = await db.games.where('teamId').equals(teamId).toArray();
    for (const game of games) await db.events.where('gameId').equals(game.id).delete();
    await db.games.where('teamId').equals(teamId).delete();
    await db.players.where('teamId').equals(teamId).delete();
    await db.teams.delete(teamId);
  });
}

/**
 * Ask the browser to exempt our data from eviction. Safari will otherwise clear
 * an unvisited site's storage after about a week, which for this app means
 * losing a season. Best-effort: the grant is not guaranteed, which is one reason
 * server sync is Phase 2 rather than optional.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
