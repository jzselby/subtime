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
  -- 'fall' | 'spring' | 'tournament' | 'scrimmage', or null for untagged.
  -- Not an enum: app/src/db.ts's GameTag is the source of truth for the
  -- fixed set, and a text column needs no migration if that set ever grows.
  tag text,
  updated_at timestamptz not null default now()
);

create table game_events (
  id text primary key,
  game_id text not null references games(id) on delete cascade,
  seq int not null,
  payload jsonb not null,
  unique (game_id, seq)
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
create or replace function get_team_dashboard(token uuid)
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
    ),
    'events', (
      select coalesce(jsonb_agg(e), '[]'::jsonb)
      from game_events e
      join games g on g.id = e.game_id
      where g.team_id = t.id
    )
  )
  from teams t
  where t.share_token = token
    and t.dashboard_enabled = true;
$$;

-- Callable by the public anon key: it's the only thing anon can do with
-- this function, and it only ever returns one enabled team's own data.
grant execute on function get_team_dashboard(uuid) to anon;

-- ---------------------------------------------------------------------------
-- Writes: publish_key in, an upsert of one team's data out.
-- ---------------------------------------------------------------------------
--
-- `team_id` and `share_token` are explicit parameters rather than fields
-- inside `data`, because a first-ever publish for a team has no row yet to
-- look up by `key` — the app already knows its own team id and the token
-- it just generated, so those two are what create the row, not what's
-- looked up by it. `share_token` is only used on that first insert; an
-- omitted (null) value is fine on every call after, since the update path
-- never touches it — a share link, once handed out, is never silently
-- rotated by a routine publish.
--
-- `data` shape (all optional/empty-array-safe, so a first publish and every
-- incremental one afterward look the same call):
--   {
--     "team":    { "name": ..., "age_group": ..., "formation": ..., "config": ...,
--                  "dashboard_enabled": ... },   -- the on/off toggle itself
--     "players": [{ "id": ..., "name": ..., "number": ..., "active": ... }, ...],
--     "games":   [{ "id": ..., "opponent": ..., "kickoff_at": ..., "config": ...,
--                   "formation": ..., "status": ..., "tag": ... }, ...],
--     "events":  [{ "id": ..., "game_id": ..., "seq": ..., "payload": ... }, ...]
--   }
--
-- Every child row's team_id/game_id is taken from `p_team_id` or validated
-- against it, never trusted from the payload — the `where game_id in
-- (select id from games where team_id = p_team_id)` guard on the events
-- upsert is what enforces that for events specifically, since an event's
-- game_id is the one reference not otherwise pinned to p_team_id by this
-- function's own inserts.
create or replace function publish_team_data(
  key uuid,
  p_team_id text,
  data jsonb,
  share_token uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from teams where id = p_team_id) then
    -- First publish for this team: the row doesn't exist yet, so this call
    -- creates it and claims it with `key` as its publish_key from now on.
    if share_token is null then
      raise exception 'share_token is required to create a new team';
    end if;
    insert into teams (id, name, age_group, formation, config, dashboard_enabled, share_token, publish_key)
    values (
      p_team_id,
      data->'team'->>'name',
      data->'team'->>'age_group',
      data->'team'->'formation',
      data->'team'->'config',
      coalesce((data->'team'->>'dashboard_enabled')::boolean, false),
      share_token,
      key
    );
  elsif not exists (select 1 from teams where id = p_team_id and publish_key = key) then
    -- A team with this id exists, but not owned by this key — reject
    -- outright rather than silently doing nothing, so a bug that sends the
    -- wrong key is loud rather than a quiet no-op.
    raise exception 'invalid publish key for this team';
  else
    update teams set
      name = coalesce(data->'team'->>'name', name),
      age_group = coalesce(data->'team'->>'age_group', age_group),
      formation = coalesce(data->'team'->'formation', formation),
      config = coalesce(data->'team'->'config', config),
      dashboard_enabled = coalesce((data->'team'->>'dashboard_enabled')::boolean, dashboard_enabled),
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
    active = excluded.active;

  insert into games (id, team_id, opponent, kickoff_at, config, formation, status, tag, updated_at)
  select
    g->>'id',
    p_team_id,
    g->>'opponent',
    (g->>'kickoff_at')::timestamptz,
    g->'config',
    g->'formation',
    g->>'status',
    g->>'tag',
    now()
  from jsonb_array_elements(coalesce(data->'games', '[]'::jsonb)) as g
  on conflict (id) do update set
    opponent = excluded.opponent,
    kickoff_at = excluded.kickoff_at,
    config = excluded.config,
    formation = excluded.formation,
    tag = excluded.tag,
    status = excluded.status,
    updated_at = now();

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
    payload = excluded.payload;

  -- Deletions have no id to conflict on, so they need their own pass: a
  -- full `publishNow()` always sends the *complete* current event log for
  -- every one of this team's games (see collectPayload in app/src/sync.ts),
  -- so anything stored here under one of this team's games that isn't in
  -- that batch was removed locally and should be removed here too. This
  -- assumption breaks if an incremental/queued publish is ever added that
  -- only sends new or changed events — that path would need to carry its
  -- own deleted-ids list rather than relying on absence.
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
      and not exists (
        select 1
        from jsonb_array_elements(data->'events') as e
        where e->>'id' = ge.id
      );
  end if;
end;
$$;

grant execute on function publish_team_data(uuid, text, jsonb, uuid) to anon;
