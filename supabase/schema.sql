-- Pitchside coaches dashboard: schema, RLS, and the two RPC functions that
-- are the only way in or out for the anon key. See DESIGN.md §4/§5/§7 and
-- the plan this implements for the reasoning; the short version is: no
-- coach login, so a per-team `share_token` gates reads (the dashboard URL)
-- and a separate `publish_key` gates writes (kept on the coach's device,
-- never shown). Direct table access is denied for anon; both keys only ever
-- go through get_team_dashboard() / publish_team_data() below.
--
-- Run this once, in order, in the Supabase SQL editor for a fresh project.
--
-- IDs are `text`, not `uuid`: local ids come from `uid()` in app/src/db.ts,
-- which is `crypto.randomUUID()` where available but falls back to a
-- non-UUID string (`id-<ts>-<rand>`) on browsers without it. A `uuid` column
-- would reject that fallback outright, so entity ids stay `text` throughout
-- — only `share_token`/`publish_key`, generated server-side, are real uuids.

create extension if not exists pgcrypto;

create table teams (
  id text primary key,
  name text not null,
  age_group text,
  formation jsonb not null,
  config jsonb not null,
  dashboard_enabled boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  publish_key uuid not null default gen_random_uuid(),
  -- The parent-facing scoreboard link (get_team_scoreboard below). Separate
  -- from share_token on purpose: that one gates the *full* dashboard —
  -- rosters, goals, playing time per player — and this one gates a link
  -- meant to be handed out widely, which must never resolve to any of that.
  -- Gated by the same dashboard_enabled flag as share_token; there is no
  -- independent on/off switch for this one.
  --
  -- Nullable, unlike share_token/publish_key: a fresh team's INSERT always
  -- supplies a real value (see publish_team_data's INSERT branch below), so
  -- this only actually reads as null for a row that existed before this
  -- column did — which is exactly what lets that UPDATE branch tell "never
  -- assigned yet, adopt whatever the app sends" apart from "already has one,
  -- never silently rotate it." A `not null default gen_random_uuid()` here
  -- would hand a legacy row a value the app doesn't know and has never sent,
  -- permanently rejecting the token it generates instead.
  parent_share_token uuid,
  updated_at timestamptz not null default now()
);

create table players (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  name text not null,
  number text not null,
  active smallint not null
);

create table games (
  id text primary key,
  team_id text not null references teams(id) on delete cascade,
  opponent text,
  kickoff_at timestamptz not null,
  config jsonb not null,
  formation jsonb not null,
  status text not null,
  -- 'fall' | 'spring' | 'indoor' | 'tournament' | 'scrimmage', or null for untagged.
  -- Not an enum: app/src/db.ts's GameTag is the source of truth for the
  -- fixed set, and a text column needs no migration if that set ever grows.
  tag text,
  -- A pre-computed live summary, folded from the event log by the app's own
  -- reduce() at publish time (see collectPayload in app/src/sync.ts) — the
  -- same "one fold, many callers" reducer this whole engine is built on, not
  -- a second implementation of the game-state machine in SQL. The point of
  -- computing these here rather than in get_team_scoreboard below is data
  -- minimization: the raw event log carries subs and position changes, which
  -- is exactly the playing-time detail the parent scoreboard must never see
  -- — so these columns are the *only* thing about a live game that function
  -- is allowed to read, structurally, not just by convention.
  score_us int not null default 0,
  score_them int not null default 0,
  -- The reducer's own finer state — 'pregame' | 'running' | 'paused' |
  -- 'break' | 'final' — not the coarser games.status above, because a
  -- scoreboard needs to tell "half-time" and "paused" apart from "final".
  clock_status text not null default 'pregame',
  clock_period int not null default 0,
  -- Clock position (ms) as of the last applied event — frozen unless
  -- clock_anchor is set.
  clock_ms int not null default 0,
  -- {wallTs, clockMs}, mirroring GameState['anchor'] exactly — present only
  -- while clock_status = 'running', so a viewer can tick a live clock
  -- between polls with the same clockAt() formula the app itself uses,
  -- instead of only updating once every poll interval.
  clock_anchor jsonb,
  period_elapsed_ms jsonb not null default '[]',
  -- GoalRecord[] minus eventId — scorerId/assistId only, not names. Bare ids
  -- reveal nothing about playing time, so this is safe to store next to the
  -- other summary fields; get_team_scoreboard resolves the names at read
  -- time by joining players, which is also what keeps a renamed player's
  -- past goals showing their current name.
  goals jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table game_events (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  seq int not null,
  payload jsonb not null,
  -- Deferred to commit, not checked row by row: Undo deletes the last event
  -- and the next one recorded reuses its seq under a new id. The upsert in
  -- publish_team_data inserts the new row *before* its deletion pass removes
  -- the undone one, so an immediate check rejected every publish from then
  -- on — permanently, since every retry carried the same pair.
  constraint game_events_game_id_seq_key unique (game_id, seq) deferrable initially deferred
);

create index players_team_id_idx on players (team_id);
create index games_team_id_idx on games (team_id);
create index game_events_game_id_idx on game_events (game_id);

-- Default-deny: no policy is added for anon on any table, so `enable row
-- level security` with zero policies blocks every direct select/insert/
-- update/delete for that role. The two SECURITY DEFINER functions below
-- run as the table owner and bypass RLS entirely, which is what makes them
-- the only path in — the anon key alone grants nothing against these tables.
alter table teams enable row level security;
alter table players enable row level security;
alter table games enable row level security;
alter table game_events enable row level security;

-- ---------------------------------------------------------------------------
-- Reads: token in, a full team snapshot out.
-- ---------------------------------------------------------------------------
--
-- Never resolves a team with dashboard_enabled = false, so switching the
-- toggle off in the app actually revokes access rather than just hiding a
-- button — a coach who saved the link before disabling gets nothing back.
--
-- `since` makes polling incremental: with it, `games`/`events` hold only
-- games updated after that instant (a game's row is re-upserted whenever
-- anything in it changes, events included), and `game_ids` lists every
-- current game so the dashboard can drop deleted ones. Without it — the
-- first load — everything comes back, same as before. The dashboard passes
-- back the previous response's `as_of`, which is set a minute behind now():
-- now() is a transaction's *start* time, so a publish still committing
-- during this read stamps rows slightly in the past, and the overlap makes
-- sure the next poll still picks them up.
--
-- Dropped first because adding a parameter makes a new overload rather
-- than replacing the old one, and a call with just `token` would then be
-- ambiguous between the two.
drop function if exists get_team_dashboard(uuid);

create or replace function get_team_dashboard(token uuid, since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'team', (to_jsonb(t) - 'share_token' - 'publish_key'),
    'players', (
      select coalesce(jsonb_agg(p), '[]'::jsonb)
      from players p
      where p.team_id = t.id
    ),
    'games', (
      select coalesce(jsonb_agg(g), '[]'::jsonb)
      from games g
      where g.team_id = t.id
        and (since is null or g.updated_at > since)
    ),
    'events', (
      select coalesce(jsonb_agg(e), '[]'::jsonb)
      from game_events e
      join games g on g.id = e.game_id
      where g.team_id = t.id
        and (since is null or g.updated_at > since)
    ),
    'game_ids', (
      select coalesce(jsonb_agg(g.id), '[]'::jsonb)
      from games g
      where g.team_id = t.id
    ),
    'as_of', now() - interval '1 minute',
    'partial', since is not null
  )
  from teams t
  where t.share_token = token
    and t.dashboard_enabled = true;
$$;

-- Callable by the public anon key: it's the only thing anon can do with
-- this function, and it only ever returns one enabled team's own data.
grant execute on function get_team_dashboard(uuid, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- Writes: publish_key in, an upsert of one team's data out.
-- ---------------------------------------------------------------------------
--
-- `team_id`, `share_token` and `parent_share_token` are explicit parameters
-- rather than fields inside `data`, because a first-ever publish for a team
-- has no row yet to look up by `key` — the app already knows its own team
-- id and the tokens it just generated, so those are what create the row,
-- not what's looked up by it. Both tokens are only used on that first
-- insert; an omitted (null) value is fine on every call after, since the
-- update path never touches either — a share link, once handed out, is
-- never silently rotated by a routine publish.
--
-- `data` shape (all optional/empty-array-safe, so a first publish and every
-- incremental one afterward look the same call):
--   {
--     "team":    { "name": ..., "age_group": ..., "formation": ..., "config": ...,
--                  "dashboard_enabled": ... },   -- the on/off toggle itself
--     "players": [{ "id": ..., "name": ..., "number": ..., "active": ... }, ...],
--     "games":   [{ "id": ..., "opponent": ..., "kickoff_at": ..., "config": ...,
--                   "formation": ..., "status": ..., "tag": ...,
--                   "score_us": ..., "score_them": ..., "clock_status": ...,
--                   "clock_period": ..., "clock_ms": ..., "clock_anchor": ...,
--                   "period_elapsed_ms": ..., "goals": ... }, ...],
--     "game_ids": ["<every current game id>", ...],   -- deletions; see below
--     "events":  [{ "id": ..., "game_id": ..., "seq": ..., "payload": ... }, ...]
--   }
--
-- `games` carries only games that changed since the app's last successful
-- publish, each with its complete event log in `events`.
--
-- Every child row's team_id/game_id is taken from `p_team_id` or validated
-- against it, never trusted from the payload — the `where game_id in
-- (select id from games where team_id = p_team_id)` guard on the events
-- upsert is what enforces that for events specifically, since an event's
-- game_id is the one reference not otherwise pinned to p_team_id by this
-- function's own inserts.
--
-- Dropped first, not just `create or replace`: adding `parent_share_token`
-- changes the argument list, and Postgres treats a changed signature as a
-- new overload rather than a true replacement. Left un-dropped, the old
-- 4-argument version would keep existing alongside this one, and a call
-- that omits both token arguments (disableDashboard's) would become
-- ambiguous between the two. This statement is safe to (re)run — it only
-- matters the first time this migration lands on a project that still has
-- the old signature.
drop function if exists publish_team_data(uuid, text, jsonb, uuid);
-- And the 5-argument version that returned void: a changed return type
-- can't be applied with `create or replace`.
drop function if exists publish_team_data(uuid, text, jsonb, uuid, uuid);

create or replace function publish_team_data(
  key uuid,
  p_team_id text,
  data jsonb,
  share_token uuid default null,
  parent_share_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from teams where id = p_team_id) then
    -- First publish for this team: the row doesn't exist yet, so this call
    -- creates it and claims it with `key` as its publish_key from now on.
    if share_token is null or parent_share_token is null then
      raise exception 'share_token and parent_share_token are required to create a new team';
    end if;
    insert into teams (id, name, age_group, formation, config, dashboard_enabled, share_token, parent_share_token, publish_key)
    values (
      p_team_id,
      data->'team'->>'name',
      data->'team'->>'age_group',
      data->'team'->'formation',
      data->'team'->'config',
      coalesce((data->'team'->>'dashboard_enabled')::boolean, false),
      share_token,
      parent_share_token,
      key
    );
  elsif not exists (select 1 from teams where id = p_team_id and publish_key = key) then
    -- A team with this id exists, but not owned by this key — reject
    -- outright rather than silently doing nothing, so a bug that sends the
    -- wrong key is loud rather than a quiet no-op.
    raise exception 'invalid publish key for this team';
  else
    -- parent_share_token: adopt the app's value the first time it shows up
    -- (a team that enabled the dashboard before this column existed has
    -- none yet), then never touch it again — `teams.parent_share_token`
    -- winning the coalesce once it's non-null is what keeps a link already
    -- handed out from being silently rotated by a routine publish, same
    -- guarantee share_token already has. Both sides are qualified because
    -- the parameter and the column share a name: unqualified, PL/pgSQL
    -- raises "column reference is ambiguous" here rather than guessing.
    update teams set
      name = coalesce(data->'team'->>'name', name),
      age_group = coalesce(data->'team'->>'age_group', age_group),
      formation = coalesce(data->'team'->'formation', formation),
      config = coalesce(data->'team'->'config', config),
      dashboard_enabled = coalesce((data->'team'->>'dashboard_enabled')::boolean, dashboard_enabled),
      parent_share_token = coalesce(teams.parent_share_token, publish_team_data.parent_share_token),
      updated_at = now()
    where id = p_team_id;
  end if;

  insert into players (id, team_id, name, number, active)
  select
    p->>'id',
    p_team_id,
    p->>'name',
    p->>'number',
    (p->>'active')::smallint
  from jsonb_array_elements(coalesce(data->'players', '[]'::jsonb)) as p
  on conflict (id) do update set
    name = excluded.name,
    number = excluded.number,
    active = excluded.active
  -- The conflicting row must already be this team's. Without this, anyone
  -- could register a throwaway team with the public anon key and "upsert" a
  -- row id belonging to someone else's team, overwriting it in place. Same
  -- guard on games and game_events below.
  where players.team_id = p_team_id;

  insert into games (
    id, team_id, opponent, kickoff_at, config, formation, status, tag,
    score_us, score_them, clock_status, clock_period, clock_ms, clock_anchor,
    period_elapsed_ms, goals, updated_at
  )
  select
    g->>'id',
    p_team_id,
    g->>'opponent',
    (g->>'kickoff_at')::timestamptz,
    g->'config',
    g->'formation',
    g->>'status',
    g->>'tag',
    coalesce((g->>'score_us')::int, 0),
    coalesce((g->>'score_them')::int, 0),
    coalesce(g->>'clock_status', 'pregame'),
    coalesce((g->>'clock_period')::int, 0),
    coalesce((g->>'clock_ms')::int, 0),
    g->'clock_anchor',
    coalesce(g->'period_elapsed_ms', '[]'::jsonb),
    coalesce(g->'goals', '[]'::jsonb),
    now()
  from jsonb_array_elements(coalesce(data->'games', '[]'::jsonb)) as g
  on conflict (id) do update set
    opponent = excluded.opponent,
    kickoff_at = excluded.kickoff_at,
    config = excluded.config,
    formation = excluded.formation,
    tag = excluded.tag,
    status = excluded.status,
    score_us = excluded.score_us,
    score_them = excluded.score_them,
    clock_status = excluded.clock_status,
    clock_period = excluded.clock_period,
    clock_ms = excluded.clock_ms,
    clock_anchor = excluded.clock_anchor,
    period_elapsed_ms = excluded.period_elapsed_ms,
    goals = excluded.goals,
    updated_at = now()
  where games.team_id = p_team_id;

  -- Same reasoning as the event-deletion pass below: a full publishNow()
  -- always sends the *complete* current games list for the team (see
  -- collectPayload in app/src/sync.ts), so a game stored here that isn't in
  -- that batch was deleted locally (deleteGame in db.ts) and should be
  -- deleted here too — otherwise a deleted game just sits on the dashboard
  -- forever. Cascades to game_events via that table's own `on delete
  -- cascade`, so no separate cleanup is needed for the deleted game's
  -- events. Gated on `data ? 'games'` for the same reason as the events
  -- gate below: disableDashboard() sends a `data` with no `games` key at
  -- all, and coalescing that absence to `[]` would read as "every game was
  -- deleted" and wipe the team's whole history on a routine toggle-off.
  --
  -- `game_ids`, when present, is the authoritative list instead: the app now
  -- sends full rows only for games that changed since its last successful
  -- publish, plus every current game's id so deletions still land. A payload
  -- without it (an older app version still cached on someone's phone) is a
  -- full resync and keeps the original behaviour.
  if data ? 'game_ids' then
    delete from games gg
    where gg.team_id = p_team_id
      and not exists (
        select 1
        from jsonb_array_elements_text(data->'game_ids') as gid
        where gid = gg.id
      );
  elsif data ? 'games' then
    delete from games gg
    where gg.team_id = p_team_id
      and not exists (
        select 1
        from jsonb_array_elements(data->'games') as g
        where g->>'id' = gg.id
      );
  end if;

  -- Events are *not* immutable in the app — "Modify events" (Events.tsx)
  -- lets a coach correct a mis-recorded scorer/assist/card in place (same
  -- id, changed payload) or delete one outright — so a conflicting id here
  -- is a real edit to reconcile, not just the same event arriving twice.
  insert into game_events (id, game_id, seq, payload)
  select
    e->>'id',
    e->>'game_id',
    (e->>'seq')::int,
    e->'payload'
  from jsonb_array_elements(coalesce(data->'events', '[]'::jsonb)) as e
  where e->>'game_id' in (select id from games where team_id = p_team_id)
  on conflict (id) do update set
    seq = excluded.seq,
    payload = excluded.payload
  -- The filter above only checks the *incoming* row's game_id; this checks
  -- the existing row's, which is the one actually being overwritten.
  where game_events.game_id in (select id from games where team_id = p_team_id);

  -- Deletions have no id to conflict on, so they need their own pass. Every
  -- game present in `data->'games'` arrives with its *complete* current
  -- event log (see collectPayload in app/src/sync.ts — a game is sent whole
  -- or not at all), so for exactly those games, anything stored here that
  -- isn't in the batch was removed locally and is removed here too. Games
  -- left out of the payload (unchanged since the last publish) keep their
  -- events untouched. An older app's full resync sends every game, which
  -- makes this the same as the original team-wide pass.
  --
  -- Gated on `data ? 'events'` — key *presence*, not the coalesced value —
  -- because disableDashboard() calls this function with a `data` that omits
  -- `events`/`players`/`games` entirely (just `{"team": {"dashboard_enabled":
  -- false}}`). Without this guard, coalescing that absent key to `[]` reads
  -- as "the local event log for every game is now empty" and this would
  -- delete every event for the team on every single toggle-off.
  if data ? 'events' then
    -- `not exists` rather than `not in`: a bare `not in (select ...)` goes
    -- false for every row — silently deleting nothing — the instant any
    -- element of that subquery is null, which a malformed payload could
    -- trigger. `not exists` has no such trap.
    delete from game_events ge
    where ge.game_id in (select id from games where team_id = p_team_id)
      and ge.game_id in (
        select g->>'id' from jsonb_array_elements(coalesce(data->'games', '[]'::jsonb)) as g
      )
      and not exists (
        select 1
        from jsonb_array_elements(data->'events') as e
        where e->>'id' = ge.id
      );
  end if;

  -- Tells the app this server understands incremental publishes (`game_ids`
  -- plus only the changed games). Until it sees this, the app keeps sending
  -- every game — an older version of this function would read a partial
  -- `games` list as "the rest were deleted".
  return jsonb_build_object('incremental', true);
end;
$$;

grant execute on function publish_team_data(uuid, text, jsonb, uuid, uuid) to anon;

-- ---------------------------------------------------------------------------
-- Reads: the parent scoreboard. A token in, one game's live score and clock
-- out — never a roster, never an event, never a minute of playing time.
-- ---------------------------------------------------------------------------
--
-- Deliberately touches only teams, games, and (for goal-scorer names)
-- players — never game_events. That's what makes "no playing time leaks
-- through this link" a structural guarantee rather than a promise the
-- query has to keep by being careful: the score/clock/goals columns on
-- games are the *only* record of a live game this function can even see,
-- and they were computed by the app's own reduce() at publish time (see
-- games.goals's comment above), not folded here from anything richer.
--
-- Resolves the same set of games a coach's dashboard would show (see
-- foldGames in dashboard/src/games.ts — 'setup' games excluded there too):
-- every game that's live or already played, ordered live-first then most
-- recent kickoff first. `games[0]` is what the app treats as "current" —
-- the team's live game if one is running, else the most recent one played
-- — and the rest is the "Past Games" list, so no separate query or
-- endpoint is needed for that: one array serves both. Returns `[]` for a
-- team with nothing past 'setup' yet — a token for a brand new team, or
-- one with only a future game scheduled, is a valid link, just with
-- nothing to show.
create or replace function get_team_scoreboard(token uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'team', jsonb_build_object('name', t.name, 'age_group', t.age_group),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'opponent', g.opponent,
        'kickoff_at', g.kickoff_at,
        'status', g.status,
        'tag', g.tag,
        'periods', g.config->'periods',
        'score_us', g.score_us,
        'score_them', g.score_them,
        'clock_status', g.clock_status,
        'clock_period', g.clock_period,
        'clock_ms', g.clock_ms,
        'clock_anchor', g.clock_anchor,
        'period_elapsed_ms', g.period_elapsed_ms,
        'goals', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'period', (goal->>'period')::int,
            'clockMs', (goal->>'clockMs')::int,
            'team', goal->>'team',
            'scorerName', scorer.name,
            'assistName', assist.name,
            'penalty', coalesce((goal->>'penalty')::boolean, false),
            'ownGoal', coalesce((goal->>'ownGoal')::boolean, false)
          ) order by (goal->>'period')::int, (goal->>'clockMs')::int), '[]'::jsonb)
          from jsonb_array_elements(g.goals) as goal
          left join players scorer on scorer.id = goal->>'scorerId' and scorer.team_id = t.id
          left join players assist on assist.id = goal->>'assistId' and assist.team_id = t.id
        )
      ) order by (g.status = 'live') desc, g.kickoff_at desc), '[]'::jsonb)
      from games g
      -- 'setup' excluded, same as foldGames() on the coach dashboard: a
      -- game scheduled ahead of kickoff isn't "current" to a parent, and
      -- without this a future 'setup' game with a later kickoff_at would
      -- sort ahead of today's actual live or just-finished game, hiding
      -- the real result behind a "Kickoff soon" placeholder for a game
      -- that hasn't happened yet.
      where g.team_id = t.id
        and g.status <> 'setup'
    )
  )
  from teams t
  where t.parent_share_token = token
    and t.dashboard_enabled = true;
$$;

grant execute on function get_team_scoreboard(uuid) to anon;
