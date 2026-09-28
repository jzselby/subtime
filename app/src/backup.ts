import type { GameEvent } from '@pitchside/core';
import { db, type Game, type Player, type Team } from './db';

/**
 * Whole-device backup: every team, player, game and event in one JSON file.
 *
 * This app's IndexedDB is the only complete copy of a coach's data — the
 * dashboard only ever holds what's been published, and deleting the
 * home-screen icon on iOS deletes the storage with it. Local sync
 * bookkeeping (pendingSync, publishedGames, syncStatus) is deliberately
 * left out: it describes this device's relationship with the server, not
 * the season.
 *
 * Includes each team's publishKey, so a restore onto a new phone can keep
 * publishing to the same dashboard — which also means the file should be
 * kept private.
 */

const FORMAT = 'pitchside-backup';
const VERSION = 1;
const LAST_BACKUP_KEY = 'pitchside:lastBackupAt';

interface BackupFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  teams: Team[];
  players: Player[];
  games: Game[];
  events: GameEvent[];
}

async function buildBackup(): Promise<{ file: File; counts: string }> {
  const [teams, players, games, events] = await Promise.all([
    db.teams.toArray(),
    db.players.toArray(),
    db.games.toArray(),
    db.events.toArray(),
  ]);
  const backup: BackupFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    teams,
    players,
    games,
    events,
  };
  const day = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(backup)], `pitchside-backup-${day}.json`, {
    type: 'application/json',
  });
  return { file, counts: `${teams.length} team(s), ${games.length} game(s)` };
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Hands the backup to the OS share sheet where it can carry a file — on an
 * iPhone that includes "Save to Files", i.e. iCloud Drive — and downloads it
 * otherwise. Resolves false if the coach cancelled the share sheet.
 */
export async function saveBackup(): Promise<boolean> {
  const { file, counts } = await buildBackup();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: 'Pitchside backup', text: counts, files: [file] });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return false;
      download(file);
    }
  } else {
    download(file);
  }
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  } catch {
    // Only feeds the "last backup" hint.
  }
  return true;
}

export function lastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** Reads and checks a backup file without writing anything. */
export async function readBackup(file: File): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t a Pitchside backup (it isn’t valid JSON).');
  }
  const b = parsed as Partial<BackupFile> | null;
  if (!b || b.format !== FORMAT) throw new Error('That file isn’t a Pitchside backup.');
  if (typeof b.version !== 'number' || b.version > VERSION) {
    throw new Error('That backup was made by a newer version of Pitchside. Update the app first.');
  }
  for (const key of ['teams', 'players', 'games', 'events'] as const) {
    if (!Array.isArray(b[key])) throw new Error(`That backup is damaged (no ${key} list).`);
  }
  const hasId = (rows: unknown[]) => rows.every((r) => typeof (r as { id?: unknown })?.id === 'string');
  if (!hasId(b.teams!) || !hasId(b.players!) || !hasId(b.games!) || !hasId(b.events!)) {
    throw new Error('That backup is damaged (a record is missing its id).');
  }
  return b as BackupFile;
}

/**
 * Merges a backup into this device: every record in the file is written,
 * replacing any existing record with the same id; nothing that's only on
 * this device is removed. One transaction, so a failure part-way leaves the
 * database as it was.
 */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await db.transaction('rw', db.teams, db.players, db.games, db.events, async () => {
    await db.teams.bulkPut(backup.teams);
    await db.players.bulkPut(backup.players);
    await db.games.bulkPut(backup.games);
    await db.events.bulkPut(backup.events);
  });
}
