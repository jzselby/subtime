# Sub Time

Playing time, substitutions, and stats for youth soccer. An offline-first PWA
you install on your phone and run from the sideline.

- **[`DESIGN.md`](./DESIGN.md)** — why it is built this way, and what comes next
- **[`core/`](./core/)** — the game engine: event log, reducer, stint fold, stats
- **[`app/`](./app/)** — the PWA

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests: 34, incl. ~3,000 generated games
npm run typecheck
npm run build      # app/dist — a static bundle, deploy anywhere
```

## Getting it onto your iPhone

The app is a static bundle, so any HTTPS host will do. **HTTPS is the part that
matters** — iOS will not install a web app or run its service worker over plain
HTTP, so a LAN address like `http://192.168.1.20:5173` loads the page but gives
you no home-screen icon and no offline.

### GitHub Pages (already wired up)

`.github/workflows/deploy.yml` builds and publishes on every push.

1. In the repo: **Settings → Pages → Source: GitHub Actions**.
2. Push. The workflow runs tests, builds, and deploys.
3. Open `https://<you>.github.io/subtime/` on your phone **in Safari**.
4. **Share → Add to Home Screen.**

One caveat: Pages on a *private* repo needs a paid GitHub plan. If this repo is
private and you're on the free tier, either make it public or use the option
below.

### Netlify Drop (no account, 30 seconds)

`npm run build`, then drag the `app/dist` folder onto
[app.netlify.com/drop](https://app.netlify.com/drop). You get an HTTPS URL
immediately. Same Safari → Add to Home Screen step.

### Why installing matters

Launched from the home screen the app keeps the screen awake during a game, gets
persistent storage that Safari won't evict after a week, and runs full-screen
with no browser chrome eating the pitch.

## Running it at a game

1. Add a team — pick your format (4v4 up to 11v11) when you create it.
2. Add the roster.
3. **Team → Settings → Formation** to choose a shape and drag positions where you
   actually play them.
4. New game → mark who is here → tap positions on the pitch to fill them (or
   **Fill rest**) → **Start**.

It works with no signal. Everything lives on the device.

### On the sideline

The game screen opens on the **field view**: your shape, with a shirt at every
position showing number, name, and minutes played. A **List** toggle gives the
same thing as sorted rows when you want the numbers instead.

- **Two taps to sub:** a player on the pitch, then a player on the bench strip
  underneath. Both take multiple selections, so a four-player change at a
  stoppage is one action. The incoming player inherits the position.
- **The bench is ordered by who is owed the most time**, so the leftmost shirt is
  always the app's suggestion. The ring colour says the same thing without numbers.
- **Tap an empty position** to fill it from the bench. Or select one player on the
  pitch first, then tap an empty position, to move them there.
- **"ends 6:00 over"** under a name is a projection — where that player finishes
  if you change nothing — not a statement about right now.
- **Stop clock** for injuries. Stoppage time never counts as playing time.
- **Undo** removes the last event. Tapping the wrong name costs one tap to fix.

## What works today

Rosters and teams · attendance · **formations from 4v4 to 11v11 with named
presets and drag-anywhere custom shapes** · configurable periods, length, and
keeper weighting · **a field view with a shirt per position** plus a list view ·
live clock with stoppages · subs and position changes · goals, assists, and
opponent goals · live fairness ordering and sub suggestions · shift alarm · undo
and a full event log · per-game report with playing-time bars, a who-was-on-when
timeline, plus/minus and position variety · copy-to-clipboard summary and CSV
export · installable, offline, survives a reload mid-game.

### Formations

Presets for every squad size (7v7 gives you 2-3-1, 3-2-1, 2-1-2-1, 3-1-2; 11v11
gives 4-4-2, 4-3-3, 4-2-3-1, 3-5-2, 5-3-2). Pick one, then drag any position to
where you want it and save it to the team. Coordinates are normalised, so your
shape looks the same on any screen. Each game snapshots the formation it was
played in, so changing your shape later never rewrites an old game.

## What doesn't yet

Server sync and multi-device (Phase 2) · the shift **planner** that pre-generates
a whole rotation, as opposed to the live suggestions that exist now (Phase 3) ·
season-level rollups across games and read-only share links for the head coach
(Phase 4). See [`DESIGN.md`](./DESIGN.md).

Today the phone holds the only copy of your data. The app asks the browser for
persistent storage, but that is best-effort — export a CSV after games you care
about until sync lands.

## Testing

```bash
npm test                                  # engine: unit + property tests
npm run build --workspace app             # then, in another shell:
npx vite preview --port 4173 --workspace app
node scripts/smoke.mjs                    # drives a whole game in a real browser
node scripts/resume.mjs                   # leaves mid-game and comes back
```

`scripts/smoke.mjs` plays a full two-half game through the actual UI — roster,
lineup, kickoff, subs, goals, a stoppage, undo, full time — and checks the
numbers the app reports, including the field-time invariant end to end. It writes
screenshots to `scripts/shots/`. Pass `--headed` to watch either script.

`scripts/resume.mjs` covers the failure mode that matters most on a sideline:
it starts a game, closes the tab entirely, waits, and reopens. Game time must
have kept accruing across the gap — it is derived from timestamps, not ticked —
and the app must land back on the live screen, still substitutable.

The engine's own guarantee is documented in [`core/README.md`](./core/README.md):
`Σ player minutes == ∫ onFieldCount dt`, verified two independent ways over
thousands of generated games, and mutation-tested to confirm the check has teeth.
