import { reduce } from '@pitchside/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, uid, type SyncStatusRow, type Team } from './db';

/**
 * The coaches dashboard, one-way: this app publishes, the dashboard
 * (`dashboard/`) reads. Off by default per team — nothing here runs for a
 * team that has never called `enableDashboard`. See supabase/schema.sql for
 * the two RPC functions this talks to, and the plan this implements for why
 * there's no coach login: `shareToken` gates reads (goes in the URL),
 * `publishKey` gates writes (stays on this device, never shown).
 *
 * `publishNow` sends the team, its roster, and every game that changed since
 * its last successful publish — each changed game whole, with its complete
 * event log, which is what `publish_team_data`'s per-game deletion pass
 * relies on (see supabase/schema.sql). `startBackgroundSync` builds "live"
 * on top of that same call: db.ts's table hooks mark a team dirty in `pendingSync` on every write,
 * and the flush loop here just calls `publishNow` again for whichever teams
 * are dirty, on a timer and on `online`/visibility/dirty events. A coach
 * never has to remember to tap Publish, and nothing here blocks or delays
 * the local write that triggered it — the flush always happens after.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const dashboardBaseUrl = import.meta.env.VITE_DASHBOARD_URL as string | undefined;

export const dashboardConfigured = Boolean(supabaseUrl && supabaseAnonKey && dashboardBaseUrl);

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'The coaches dashboard is not set up in this build — it needs a Supabase URL and key.',
    );
  }
  client ??= createClient(supabaseUrl, supabaseAnonKey);
  return client;
}

export function dashboardUrl(team: Team): string | null {
  if (!team.shareToken || !dashboardBaseUrl) return null;
  const url = new URL(dashboardBaseUrl);
  url.searchParams.set('t', team.shareToken);
  return url.toString();
}

/** The parent scoreboard link — score and clock only, never a roster or a
 *  minute of playing time. See supabase/schema.sql's get_team_scoreboard. */
export function scoreboardUrl(team: Team): string | null {
  if (!team.parentShareToken || !dashboardBaseUrl) return null;
  const url = new URL(dashboardBaseUrl);
  url.searchParams.set('p', team.parentShareToken);
  return url.toString();
}

/** cyrb53: a fast 53-bit string hash. Only used to notice that a game changed;
 *  a collision would just skip one publish of that game until its next edit. */
function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Everything a team needs to publish, read straight off the local tables.
 *
 * A game goes up whole — its row plus its complete event log — or not at
 * all: `known` holds each game's fingerprint as of the last successful
 * publish, and games that still match are left out. Re-sending a finished
 * season on every tap is what made a late-season publish (and every
 * dashboard poll) cost hundreds of KB. `gameIds` always lists every game so
 * the server can still drop ones deleted here. `known = null` sends all.
 */
async function collectPayload(teamId: string, known: Map<string, string> | null) {
  const [players, games] = await Promise.all([
    db.players.where('teamId').equals(teamId).toArray(),
    db.games.where('teamId').equals(teamId).toArray(),
  ]);
  const eventsByGame = await Promise.all(
    games.map((g) => db.events.where('gameId').equals(g.id).toArray()),
  );
  const changed = games.flatMap((g, i) => {
    const events = eventsByGame[i] ?? [];
    // Score/clock/goals are folded here with the same reduce() the live app
    // and the coach dashboard already use — "one fold, many callers" — and
    // published as their own columns (see games.goals's comment in
    // schema.sql) specifically so the parent scoreboard's RPC never has to
    // touch the raw event log to answer "what's the score." The raw events
    // still go up too, unchanged, for the coach dashboard's fuller view.
    const { state } = reduce(events, g.config, g.id);
    const row = {
      id: g.id,
      opponent: g.opponent,
      kickoff_at: new Date(g.kickoffAt).toISOString(),
      config: g.config,
      formation: g.formation,
      status: g.status,
      tag: g.tag ?? null,
      score_us: state.score.us,
      score_them: state.score.them,
      clock_status: state.status,
      clock_period: state.period,
      clock_ms: state.clockMs,
      clock_anchor: state.anchor,
      period_elapsed_ms: state.periodElapsedMs,
      goals: state.goals.map((goal) => ({
        period: goal.period,
        clockMs: goal.clockMs,
        team: goal.team,
        scorerId: goal.scorerId,
        assistId: goal.assistId,
        penalty: goal.penalty,
        ownGoal: goal.ownGoal,
      })),
    };
    const eventRows = events.map((e) => ({ id: e.id, game_id: e.gameId, seq: e.seq, payload: e }));
    const hash = hashOf(JSON.stringify([row, eventRows]));
    return known?.get(g.id) === hash ? [] : [{ row, eventRows, hash }];
  });
  return {
    players: players.map((p) => ({ id: p.id, name: p.name, number: p.number, active: p.active })),
    gameIds: games.map((g) => g.id),
    games: changed.map((c) => c.row),
    events: changed.flatMap((c) => c.eventRows),
    fingerprints: changed.map((c) => ({ gameId: c.row.id, teamId, hash: c.hash })),
  };
}

/*
 * Whether the server has said it understands incremental publishes. Until it
 * has, every publish sends every game: the version of publish_team_data
 * before this existed reads a partial games list as "the rest were deleted".
 * Per device rather than per team, since there's one server per build.
 */
const INCREMENTAL_KEY = 'pitchside:incrementalPublish';

function serverTakesIncremental(): boolean {
  try {
    return localStorage.getItem(INCREMENTAL_KEY) === '1';
  } catch {
    return false;
  }
}

function markServerIncremental(): void {
  try {
    localStorage.setItem(INCREMENTAL_KEY, '1');
  } catch {
    // Storage unavailable: keep sending everything, which is always safe.
  }
}

async function recordSyncError(teamId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const prev = await db.syncStatus.get(teamId);
  await db.syncStatus.put({ ...prev, teamId, lastErrorAt: Date.now(), lastError: message });
}

/**
 * Publishes one team's changes: the team row and roster every time (small),
 * plus every game that changed since the last successful publish. Safe to
 * call repeatedly — `publish_team_data` upserts every table by id. `full`
 * ignores the fingerprints and sends every game, for a first enable and for
 * the coach's own "Publish now" (the way to repair a server that lost data).
 *
 * `share_token` rides along on every call, not just the first — harmless,
 * since `publish_team_data` only actually uses it the one time it's
 * creating the row — which keeps this one function usable for both
 * `enableDashboard`'s first publish and every routine one after.
 */
export async function publishNow(
  team: Team,
  opts: { dashboardEnabled?: boolean; full?: boolean } = {},
): Promise<void> {
  if (!team.publishKey || !team.shareToken) {
    throw new Error('This team has not enabled the dashboard yet.');
  }
  // A team enabled before the parent scoreboard existed has no
  // parentShareToken yet. Generate one transparently on its next publish —
  // same as a brand-new enable does — so a coach who already turned the
  // dashboard on doesn't have to do anything to pick up the new link.
  let parentShareToken = team.parentShareToken;
  if (!parentShareToken) {
    parentShareToken = uid();
    await db.teams.update(team.id, { parentShareToken });
  }
  const known = opts.full || !serverTakesIncremental()
    ? null
    : new Map(
        (await db.publishedGames.where('teamId').equals(team.id).toArray()).map((r) => [r.gameId, r.hash]),
      );
  const { players, gameIds, games, events, fingerprints } = await collectPayload(team.id, known);
  try {
    const { data: result, error } = await getClient().rpc('publish_team_data', {
      key: team.publishKey,
      p_team_id: team.id,
      share_token: team.shareToken,
      parent_share_token: parentShareToken,
      data: {
        team: {
          name: team.name,
          age_group: team.ageGroup,
          formation: team.formation,
          config: team.config,
          ...(opts.dashboardEnabled !== undefined
            ? { dashboard_enabled: opts.dashboardEnabled }
            : {}),
        },
        players,
        game_ids: gameIds,
        games,
        events,
      },
    });
    if (error) throw new Error(error.message);
    if ((result as { incremental?: boolean } | null)?.incremental) markServerIncremental();
  } catch (err) {
    await recordSyncError(team.id, err);
    throw err;
  }
  // Fingerprints are of what was *sent*, so an edit that landed while this
  // was in flight still reads as changed next time.
  await db.transaction('rw', db.publishedGames, db.syncStatus, async () => {
    await db.publishedGames
      .where('teamId')
      .equals(team.id)
      .filter((r) => !gameIds.includes(r.gameId))
      .delete();
    await db.publishedGames.bulkPut(fingerprints);
    await db.syncStatus.put({ teamId: team.id, lastOkAt: Date.now() });
  });
}

/** One line for the coach: is the dashboard actually receiving this team? */
export function describeSync(
  status: SyncStatusRow | undefined,
  pending: boolean,
  now = Date.now(),
): { tone: 'ok' | 'waiting' | 'bad'; text: string } {
  const ago = (t: number) => {
    const min = Math.round((now - t) / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  if (status?.lastErrorAt && status.lastErrorAt > (status.lastOkAt ?? 0)) {
    return {
      tone: 'bad',
      text: status.lastOkAt
        ? `Not publishing — last success ${ago(status.lastOkAt)}. ${status.lastError ?? ''}`
        : `Not publishing. ${status.lastError ?? ''}`,
    };
  }
  if (pending) return { tone: 'waiting', text: 'Publishing changes…' };
  if (status?.lastOkAt) return { tone: 'ok', text: `Published ${ago(status.lastOkAt)}` };
  return { tone: 'waiting', text: 'No publish recorded on this phone yet — tap Publish now to check.' };
}

/**
 * Publishes first, using tokens generated but not yet persisted anywhere —
 * only once that call actually succeeds does the team get marked enabled
 * locally. Persisting `dashboardEnabled: true` before the publish attempt
 * (the first version of this function did that) left a failed enable
 * looking successful: the settings sheet would show a real-looking share
 * link and a "Turn off" button for a team that, in fact, had never reached
 * the server at all. Re-enabling a previously-disabled team reuses its
 * existing tokens either way — the share link a coach already saved keeps
 * working rather than silently breaking the moment it's toggled back on.
 */
export async function enableDashboard(
  team: Team,
): Promise<{ dashboardUrl: string; scoreboardUrl: string }> {
  const shareToken = team.shareToken ?? uid();
  const parentShareToken = team.parentShareToken ?? uid();
  const publishKey = team.publishKey ?? uid();
  const candidate: Team = {
    ...team,
    dashboardEnabled: true,
    shareToken,
    parentShareToken,
    publishKey,
  };

  await publishNow(candidate, { dashboardEnabled: true, full: true });

  await db.teams.update(team.id, { dashboardEnabled: true, shareToken, parentShareToken, publishKey });

  const dashUrl = dashboardUrl(candidate);
  const scoreUrl = scoreboardUrl(candidate);
  if (!dashUrl || !scoreUrl) throw new Error('The dashboard link could not be built for this build.');
  return { dashboardUrl: dashUrl, scoreboardUrl: scoreUrl };
}

/**
 * Pauses access rather than deleting synced data — a coach flipping this
 * off and back on shouldn't lose the season they already published. A
 * harder "forget this team" is a separate, more explicit action to add
 * later, the same split this app already makes between retiring and
 * deleting a player (see `removePlayer` in `db.ts`).
 */
export async function disableDashboard(team: Team): Promise<void> {
  await db.teams.update(team.id, { dashboardEnabled: false });
  if (!team.publishKey) return;
  const { error } = await getClient().rpc('publish_team_data', {
    key: team.publishKey,
    p_team_id: team.id,
    data: { team: { dashboard_enabled: false } },
  });
  if (error) throw new Error(error.message);
}

/**
 * One pass over every dirty team: publish it, or — if it turns out not to be
 * enabled, or its tokens are missing (e.g. `enableDashboard` never actually
 * finished) — just drop the queue entry, since there is nothing valid to
 * publish it with. A team whose publish fails (offline, a transient error)
 * stays queued and is retried on the next pass; the failure never reaches
 * the coach, since nothing here runs on the UI's critical path.
 */
async function flushPendingSync(): Promise<void> {
  const rows = await db.pendingSync.toArray();
  for (const row of rows) {
    const team = await db.teams.get(row.teamId);
    if (!team?.dashboardEnabled || !team.publishKey || !team.shareToken) {
      await db.pendingSync.delete(row.teamId);
      continue;
    }
    try {
      await publishNow(team);
      // Only clear the mark this pass actually published. A write that
      // landed while the upload was in flight re-marked the team with a new
      // rev, and wasn't in the payload — deleting unconditionally dropped it
      // until the coach's next edit, which for ending a game (GAME_END, then
      // status 'final', back to back) could mean never.
      await db.transaction('rw', db.pendingSync, async () => {
        const current = await db.pendingSync.get(row.teamId);
        if (current && current.rev === row.rev) await db.pendingSync.delete(row.teamId);
      });
    } catch {
      // Left queued on purpose — the next timer tick, reconnect, or dirty
      // write tries again. publishNow recorded the failure for the status
      // line in Team settings; nothing interrupts a coach mid-game.
    }
  }
}

let flushInFlight: Promise<void> | null = null;
let flushAgain = false;

/** Coalesces overlapping triggers (timer + online + dirty-write) into one
 *  pass, and runs one more straight after if any arrived during it. */
function requestFlush(): void {
  if (!dashboardConfigured) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (flushInFlight) {
    flushAgain = true;
    return;
  }
  flushInFlight = flushPendingSync().finally(() => {
    flushInFlight = null;
    if (flushAgain) {
      flushAgain = false;
      requestFlush();
    }
  });
}

/**
 * Starts the background sync flush loop: an immediate pass, then a timer
 * every 20s (matching how often the dashboard itself polls, so the two
 * together stay within about 40s of "live"), plus early triggers on
 * reconnect, on the tab becoming visible again, and on the
 * `pitchside:sync-dirty` event `markDirty` (in db.ts) fires right after a
 * write — so an active coach sees a change propagate well under the timer's
 * 20s, without polling harder than that in the idle case. A no-op build
 * with no Supabase config returns a no-op cleanup.
 */
export function startBackgroundSync(): () => void {
  if (!dashboardConfigured) return () => {};

  requestFlush();
  const onDirty = () => requestFlush();
  const onOnline = () => requestFlush();
  const onVisible = () => {
    if (document.visibilityState === 'visible') requestFlush();
  };
  window.addEventListener('pitchside:sync-dirty', onDirty);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(requestFlush, 20_000);

  return () => {
    window.removeEventListener('pitchside:sync-dirty', onDirty);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
