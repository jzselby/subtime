import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db, uid, type Team } from './db';

/**
 * The coaches dashboard, one-way: this app publishes, the dashboard
 * (`dashboard/`) reads. Off by default per team — nothing here runs for a
 * team that has never called `enableDashboard`. See supabase/schema.sql for
 * the two RPC functions this talks to, and the plan this implements for why
 * there's no coach login: `shareToken` gates reads (goes in the URL),
 * `publishKey` gates writes (stays on this device, never shown).
 *
 * This is step 2 of the phased build: `publishNow` is a manual, full
 * resync — there is no background queue yet, so "live" today means
 * "re-tap Publish." That queue (a `pendingSync` table plus hooks on every
 * write) is the deliberately separate next step, not an oversight here.
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

/** Everything a team needs to publish, read straight off the local tables. */
async function collectPayload(teamId: string) {
  const [players, games] = await Promise.all([
    db.players.where('teamId').equals(teamId).toArray(),
    db.games.where('teamId').equals(teamId).toArray(),
  ]);
  const eventsByGame = await Promise.all(
    games.map((g) => db.events.where('gameId').equals(g.id).toArray()),
  );
  return {
    players: players.map((p) => ({ id: p.id, name: p.name, number: p.number, active: p.active })),
    games: games.map((g) => ({
      id: g.id,
      opponent: g.opponent,
      kickoff_at: new Date(g.kickoffAt).toISOString(),
      config: g.config,
      formation: g.formation,
      status: g.status,
    })),
    events: eventsByGame.flat().map((e) => ({
      id: e.id,
      game_id: e.gameId,
      seq: e.seq,
      payload: e,
    })),
  };
}

/**
 * A full resync of one team's current local data. Safe to call repeatedly —
 * `publish_team_data` upserts every table by id, and events are
 * insert-only (a repeat is just the same row landing twice, which the
 * `on conflict (id) do nothing` in schema.sql already no-ops).
 *
 * `share_token` rides along on every call, not just the first — harmless,
 * since `publish_team_data` only actually uses it the one time it's
 * creating the row — which keeps this one function usable for both
 * `enableDashboard`'s first publish and every routine one after.
 */
export async function publishNow(
  team: Team,
  opts: { dashboardEnabled?: boolean } = {},
): Promise<void> {
  if (!team.publishKey || !team.shareToken) {
    throw new Error('This team has not enabled the dashboard yet.');
  }
  const { players, games, events } = await collectPayload(team.id);
  const { error } = await getClient().rpc('publish_team_data', {
    key: team.publishKey,
    p_team_id: team.id,
    share_token: team.shareToken,
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
      games,
      events,
    },
  });
  if (error) throw new Error(error.message);
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
export async function enableDashboard(team: Team): Promise<string> {
  const shareToken = team.shareToken ?? uid();
  const publishKey = team.publishKey ?? uid();
  const candidate: Team = { ...team, dashboardEnabled: true, shareToken, publishKey };

  await publishNow(candidate, { dashboardEnabled: true });

  await db.teams.update(team.id, { dashboardEnabled: true, shareToken, publishKey });

  const url = dashboardUrl(candidate);
  if (!url) throw new Error('The dashboard link could not be built for this build.');
  return url;
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
