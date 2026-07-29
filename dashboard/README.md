# @pitchside/dashboard

The coaches dashboard: a small, always-online, read-only site — not part of
the installable PWA in `../app`, and holds no local data of its own. A coach
opens a link (`?t=<share token>`), this fetches that one team's data from
Supabase, and renders season stats the same way `../app/src/screens/Season.tsx`
does — literally the same `@pitchside/core` fold, just fed remote events
instead of Dexie's. See `../supabase/schema.sql` for the backend side and
`../DESIGN.md`'s "Coaches dashboard" section for the reasoning.

```bash
npm install          # from the repo root; this is an npm workspace
cp .env.example .env.local
# fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — same project as ../app
npm run dev --workspace dashboard
```

Without those two variables set, the page renders a plain "not configured"
message rather than crashing — see `src/supabase.ts`.

## Why it polls instead of subscribing to Realtime

`useDashboard.ts` re-calls the `get_team_dashboard` RPC every 20 seconds
rather than subscribing to Postgres `postgres_changes` on `game_events`/
`games` directly. That's deliberate, not a missing optimization: those
tables' Realtime payloads aren't scoped by the RLS-denying policies on them
unless "Realtime RLS" (private channels) is configured, which needs its own
auth model this app doesn't have — a coach viewing one team's dashboard
could otherwise receive every team's raw insert/update payloads over the
wire. The RPC is the one thing here that's actually scoped to a single
team, so re-calling it is the safe way to get updates. Real push can follow
later via Supabase's "Broadcast from Database," which is built for exactly
this case.

## What's here

- `src/supabase.ts` — the client, and whether one could even be built from
  the configured env vars.
- `src/types.ts` — the shape `get_team_dashboard()` returns.
- `src/season.ts` — `seasonStats()`: groups events by game, folds each with
  `reduce()` + `playerStats()`, sums with `aggregatePlayerStats()`. Exactly
  `Season.tsx`'s fold, reused rather than reimplemented.
- `src/games.ts` — `foldGames()`: the same per-game fold, kept separate from
  `season.ts` because the season leaderboard and the game-by-game views need
  different shapes out of it (a `GameState` and a W/L/D per game here, a
  summed `PlayerSeasonStats` row there). Also `teamRecord()` (W-L-D, goals
  for/against) and `periodOffsets()`, shared with `GameView.tsx`'s timeline.
- `src/useDashboard.ts` — reads the token from the URL, loads and polls.
- `src/App.tsx` — routing only: which game (if any) is selected, kept in
  `?g=` so a drill-down is a shareable, back-button-able URL, no router
  dependency needed for two screens.
- `src/SeasonView.tsx` — team record card, a results chart (goal
  differential per game), the season leaderboard, a minutes bar chart, and a
  clickable games list. No fairness here — see below.
- `src/GameView.tsx` — one game's detail, opened by tapping a row in the
  games list: score, fairness (moved here from the season page, since it's
  a per-game question, not a season one), playing time, a "who was on,
  when" timeline, and goals/assists. Mirrors `Summary.tsx`'s layout in the
  main app.
- `src/ResultsChart.tsx` — the diverging goal-differential bar chart on the
  season page.
- `src/format.ts` — the small formatting helpers (`mins`, `mmss`,
  position-summary strings) shared across the views.

Charts are hand-rolled SVG/CSS throughout, same as `Summary.tsx`'s bars and
gantt in the main app — no charting dependency yet.
