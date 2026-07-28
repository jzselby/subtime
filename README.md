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

**Step 1 is manual and unavoidable.** Go to **Settings → Pages → Build and
deployment → Source: GitHub Actions**. Until that is set, every run fails at
`configure-pages` with *"Get Pages site failed … Not Found"*. The workflow
cannot do it for you: creating a Pages site needs repo admin, and the
`GITHUB_TOKEN` a workflow runs with only ever gets write. `pages: write` is
enough to deploy to a site that exists, not to bring one into being.

Then:

2. Push, or re-run the workflow from the Actions tab.
3. Open `https://<you>.github.io/subtime/` on your phone **in Safari**.
4. **Share → Add to Home Screen.**

Pages on a *private* repo also needs a paid GitHub plan.

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
   actually play them. That's the default for new games.
4. New game → a **Who's here?** checklist opens with the whole roster ticked;
   untick anyone who's away → tap positions on the pitch to fill them (or
   **Fill rest**) → **Start**.

Attendance is saved as you confirm it, so nipping into the formation editor and
back doesn't lose it. Reopen the checklist any time from the **N of M here**
button above the bench.

**Tournaments and odd fixtures:** on a game's setup screen, **Setup** sets the
periods, their length, and the formation **for that game only**. A Saturday of
four 8-minute quarters at 6v6 doesn't touch what the team plays the rest of the
season.

It works with no signal. Everything lives on the device.

### On the sideline

**Nothing scrolls during a game.** The shell is locked to the viewport: header,
clock, controls, pitch, bench, and action bar all fit on screen, and the pitch
sizes itself to whatever room is left. Verified on iPhone SE through Pro Max, at
7v7, 9v9, and 11v11 — see `scripts/checkfit.mjs` below.

The game screen is the pitch. Everything else is deliberately small: clock, score
and the start/stop button share one thin strip, and things you touch twice a game
— ending a period, jumping to the stats, switching to the list — live behind the
**•••** menu rather than spending a row of height each.

Every shirt shows number, name, and minutes played. (On a small phone the pitch
drops the name and keeps number and minutes — three lines of label per player is
what makes rows collide.) The formation is captioned top-left.

- **Drag to sub.** Drag a shirt from the bench onto a player to swap them, onto
  an empty position to fill it, or drag someone off the pitch onto the bench to
  take them off. Dragging one player onto another trades their positions. Drops
  snap to the nearest position, so they don't have to be precise.
- **Or tap twice**, if you prefer: a player on the pitch, then one on the bench.
  Both take multiple selections, so a four-player change at a stoppage is one
  action. The incoming player inherits the position.
- **The bench is ordered by who is owed the most time**, so the leftmost shirt is
  always the app's suggestion. The ring colour says the same thing without numbers.
- **Tap an empty position** to fill it from the bench. Or select one player on the
  pitch first, then tap an empty position, to move them there.
- **"ends 6:00 over"** under a name is a projection — where that player finishes
  if you change nothing — not a statement about right now.
- **Stop clock** for injuries. Stoppage time never counts as playing time.
- **Undo** removes the last event. Tapping the wrong name costs one tap to fix.
- **Modify events** (in the ••• menu) corrects anything already recorded — a goal
  given to the wrong player, a card on the wrong name, a substitution that never
  happened. Every number re-derives from the corrected log, so fixing it there
  fixes the minutes, the stats and the timeline at once.
- **Delete game** is in the same menu, and in ••• on the stats screen.

## What works today

Rosters and teams · attendance · **formations from 4v4 to 11v11 with named
presets and drag-anywhere custom shapes** · configurable periods, length, and
keeper weighting · **a field view with a shirt per position** plus a list view ·
live clock with stoppages · subs and position changes · goals, assists, and
opponent goals · live fairness ordering and sub suggestions · shift alarm · undo
and a full event log · per-game report with playing-time bars, a who-was-on-when
timeline, plus/minus and **minutes in each position by name** · copy-to-clipboard
summary and CSV export · installable, offline, survives a reload mid-game.

### Formations

Named the way a team sheet writes them, with the keeper counted: a 7-a-side 2-3-1
is **1-2-3-1**. Presets for every squad size (7v7 gives 1-2-3-1, 1-3-2-1,
1-2-1-2-1, 1-3-1-2; 11v11 gives 1-4-4-2, 1-4-3-3, 1-4-2-3-1, 1-3-5-2, 1-5-3-2).

Positions carry their line — `ST · F`, `CM · M`, `LB · D` — and lines are not
flat rows: full-backs push up past the centre-backs, a midfield three holds
through the middle, wingers play off the striker's shoulder, and a strike pair
stays central while a back four hugs the touchline.

Pick a shape, then drag any position where you actually want it and save it to the
team. Coordinates are normalised, so your shape looks the same on any screen. Each
game snapshots the formation it was played in, so changing your shape later never
rewrites an old game.

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
node scripts/drag.mjs                     # drag-to-sub, as real pointer gestures
node scripts/edit.mjs                     # correcting a recorded game
node scripts/checkfit.mjs                 # layout fits every phone, no overlaps
```

`scripts/smoke.mjs` plays a full two-half game through the actual UI — roster,
lineup, kickoff, subs, goals, a stoppage, undo, full time — and checks the
numbers the app reports, including the field-time invariant end to end. It writes
screenshots to `scripts/shots/`. Pass `--headed` to watch either script.

`scripts/resume.mjs` covers the failure mode that matters most on a sideline:
it starts a game, closes the tab entirely, waits, and reopens. Game time must
have kept accruing across the gap — it is derived from timestamps, not ticked —
and the app must land back on the live screen, still substitutable.

`scripts/drag.mjs` performs each of the four drops as a genuine press-move-release
and checks the resulting squad, plus that a press without movement is still a tap.
It caught a drop that also fired the tap handler underneath it and left a sheet
covering the pitch.

`scripts/edit.mjs` tests the claim the event log makes: it attributes a goal to
the wrong player, corrects it in the editor, and confirms the stats screen moves
the goal — then deletes a substitution and confirms the squad goes back.

`scripts/checkfit.mjs` runs the game screen at three phone sizes × three squad sizes and
asserts the page does not scroll, the whole pitch is on screen, and **no two
player tokens overlap**. That last check is the point: a squashed pitch still
"fits" while being unusable, which a pure size assertion misses.

The engine's own guarantee is documented in [`core/README.md`](./core/README.md):
`Σ player minutes == ∫ onFieldCount dt`, verified two independent ways over
thousands of generated games, and mutation-tested to confirm the check has teeth.
