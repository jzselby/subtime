import type { GameConfig, GameEvent } from '@pitchside/core';
import { appearsInLog, defaultConfig, reduce } from '@pitchside/core';
import Dexie, { type EntityTable } from 'dexie';
import type { Formation } from './formations';
import { defaultFormation } from './formations';

/**
 * Local-first storage. Everything a game needs lives here, so a match can be run
 * with no signal at all. This is still the only copy of the data for any team
 * that hasn't opted into the coaches dashboard (see `sync.ts`) — and even for
 * one that has, every write lands here first regardless of network state.
 * Because events are immutable and carry client-generated ids, syncing them
 * out is a one-way upsert by id with no conflict resolution to write; this
 * app is never the one reconciling someone else's edits, only ever the
 * source of truth for a game only it is running.
 */

export interface Team {
  id: string;
  name: string;
  ageGroup: string;
  /**
   * Position slots and where they stand. The source of truth for both the field
   * view and the position vocabulary — `codesOf(formation)` replaces what used
   * to be a separate string list.
   */
  formation: Formation;
  config: GameConfig;
  createdAt: number;
  /**
   * Off by default. `shareToken`/`publishKey` don't exist until a coach
   * first enables the dashboard for this team — see `sync.ts` — so both are
   * optional rather than backfilled for every team on a schema bump; a team
   * that never opts in never gets either one generated at all.
   */
  dashboardEnabled?: boolean;
  /** The secret in the dashboard URL. Read-only once shared: regenerating it
   *  would silently break a link a coach has already handed out. */
  shareToken?: string;
  /** Stays on this device. Gates writes to this team's row in Supabase —
   *  never rendered, copied, or shared alongside `shareToken`. */
  publishKey?: string;
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
  /** Snapshotted at creation, so changing the team's shape never rewrites history. */
  formation: Formation;
  status: 'setup' | 'live' | 'final';
  createdAt: number;
}

export class PitchsideDb extends Dexie {
  teams!: EntityTable<Team, 'id'>;
  players!: EntityTable<Player, 'id'>;
  games!: EntityTable<Game, 'id'>;
  events!: EntityTable<GameEvent, 'id'>;

  constructor() {
    // The literal database name, not the class above it: an existing install's
    // data lives under this exact string in the browser's IndexedDB. Renaming
    // it here would not migrate anything — Dexie would just open a second,
    // empty database beside the one a coach's games are already in — so this
    // stays 'subtime' regardless of what the product is called today.
    super('subtime');
    this.version(1).stores({
      teams: 'id, name, createdAt',
      players: 'id, teamId, [teamId+active]',
      games: 'id, teamId, kickoffAt, [teamId+status]',
      // Compound index so a game's log loads in sequence order in one query.
      events: 'id, gameId, [gameId+seq]',
    });

    // v2 replaced the flat `positions: string[]` with a positioned formation.
    // Existing rows get the standard formation for their squad size; their old
    // codes are not recoverable as coordinates, and a preset is a better
    // starting point than slots piled at the origin.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        const teams = tx.table<Record<string, unknown>>('teams');
        for (const team of await teams.toArray()) {
          if (team.formation) continue;
          const cfg = team.config as GameConfig | undefined;
          const size = cfg?.periods.fieldPlayers ?? 9;
          await teams.update(team.id as string, {
            formation: defaultFormation(size),
            positions: undefined,
          });
        }
        const games = tx.table<Record<string, unknown>>('games');
        for (const game of await games.toArray()) {
          if (game.formation) continue;
          const cfg = game.config as GameConfig | undefined;
          await games.update(game.id as string, {
            formation: defaultFormation(cfg?.periods.fieldPlayers ?? 9),
          });
        }
      });
  }
}

export const db = new PitchsideDb();

export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function createTeam(
  name: string,
  ageGroup: string,
  fieldPlayers = 9,
): Promise<string> {
  const id = uid();
  const config = defaultConfig();
  config.periods.fieldPlayers = fieldPlayers;
  await db.teams.add({
    id,
    name,
    ageGroup,
    formation: defaultFormation(fieldPlayers),
    config,
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
    // Snapshot config and shape: changing team defaults later must not rewrite
    // the rules of a game that has already been played.
    config: structuredClone(team.config),
    formation: structuredClone(team.formation),
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

/** What a player would take with them, and whether they are on a pitch right now. */
export interface PlayerHistory {
  /** Games whose log names this player, in any role. */
  games: number;
  /**
   * On the field in a game that has not finished.
   *
   * Deliberately narrower than "has an unfinished game". Retiring is safe at any
   * time — the live screen derives its squad from the event log, not the roster
   * table — so the only case worth refusing is pulling someone out from under a
   * match in progress. A game sitting half-set-up from last week must not stop a
   * coach tidying the roster.
   */
  onFieldNow: boolean;
}

export async function playerHistory(player: Player): Promise<PlayerHistory> {
  const games = await db.games.where('teamId').equals(player.teamId).toArray();
  let count = 0;
  let onFieldNow = false;
  for (const game of games) {
    const events = await db.events.where('gameId').equals(game.id).sortBy('seq');
    if (!appearsInLog(events, player.id)) continue;
    count += 1;
    if (game.status === 'final') continue;
    const { state } = reduce(events, game.config, game.id);
    if (state.onField.has(player.id)) onFieldNow = true;
  }
  return { games: count, onFieldNow };
}

/**
 * Take a player off the roster without taking them out of the record.
 *
 * The event log is the single source of truth for every number this app
 * reports, and it stores player *ids*. Deleting the row those ids point at does
 * not remove the player from a past game — it removes their *name*, leaving the
 * stint timeline, the summary and the exported CSV attributing goals to a raw
 * UUID, permanently and with no way back.
 *
 * So a player who has played is retired, not deleted: hidden from the roster and
 * from future team sheets, still named everywhere they appear. `active` has been
 * in the schema and indexed since v1 for exactly this. A player with no recorded
 * history — a mistyped name, a trialist who never turned up — has nothing to
 * orphan and is deleted outright.
 */
export async function removePlayer(player: Player): Promise<'retired' | 'deleted'> {
  const { games } = await playerHistory(player);
  if (games === 0) {
    await db.players.delete(player.id);
    return 'deleted';
  }
  await db.players.update(player.id, { active: 0 });
  return 'retired';
}

export async function restorePlayer(playerId: string): Promise<void> {
  await db.players.update(playerId, { active: 1 });
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
