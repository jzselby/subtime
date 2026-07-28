# Touchline

Playing time, substitutions, and stats for youth soccer. An offline-first PWA
you install on your phone and run from the sideline.

- **[`DESIGN.md`](./DESIGN.md)** — why it is built this way, and what comes next
- **[`core/`](./core/)** — the game engine: event log, reducer, stint fold, stats
- **[`app/`](./app/)** — the PWA

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine tests: 46, incl. ~3,000 generated games
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
what makes rows collide.) The formation is captioned top-left. A player with no
jersey number set shows their initials instead — first and last, "Leo Selby" as
"LS" — rather than the first two letters of whatever the name happens to start
with.

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
- **Transport lives in the bottom bar**, in the thumb's reach: a big **Pause /
  Resume**, coloured by state rather than by action — green while running,
  amber while stopped — and a separate **hold-to-end** button beside it for the
  half. A tap can't fire it by accident; hold it down and let go once you mean
  it. While paused the pitch dims slightly and a **Paused** badge sits on it, so
  "the clock isn't running" is obvious without reading the clock.
- **Every sub, goal and card gets a toast** — "Kit Larsen on · Ana Selby off" —
  because you're watching the field, not the phone, at the exact moment you make
  the change. **Undo** now says what it will remove ("Undo sub", "Undo goal"),
  not just "Undo".
- **A sub that would leave the wrong number of players on the field says so**:
  "Take Ana off — play 6" in a warning colour, instead of the same green as a
  normal swap.
- **The clock reads within the period**, next to `1H` / `2H` (or `Q1`…`Q4`). It
  is not a padded running total: a half you end at four minutes is four minutes,
  and the second half opens at 0:00. The whole-game figure — the sum of what was
  actually played — is on the stats screen. Run past the half's configured
  length and the clock turns amber and shows the overrun (`+1:42`) instead of
  counting on in silence.
- **Modify events** (in the ••• menu) corrects anything already recorded — a goal
  given to the wrong player, a card on the wrong name, a substitution that never
  happened. Every number re-derives from the corrected log, so fixing it there
  fixes the minutes, the stats and the timeline at once.
- **Hold to end the game** (in the same menu, live and on the stats screen)
  finishes the game right now, whatever period it's on — the other way to reach
  full time besides holding ■ through the last configured period. It's what a
  weather stoppage, an injury pile-up, or a tournament game cut short calls for:
  no waiting through periods that were never going to be played. It's an event
  like any other, so deleting it from Modify events un-finishes the game — the
  same recovery an accidental "End half" already gets.
- **Delete game** is in the same menu, and in ••• on the stats screen.

### Removing a player

**Remove** on the roster means one of two things, and the confirm says which. A
player who has never played is deleted outright. A player who *has* played is
**retired**: off the roster and off future team sheets, still named in every game
they played, and restorable from the Retired list underneath the roster.

That is not politeness, it is the price of an event log. The log stores player
*ids*, so deleting the row those ids point at does not remove the player from a
game already played — it removes their *name*, and the summary, the timeline and
the exported CSV start attributing goals to a raw UUID with no way back.

## What works today

Rosters and teams · attendance · **formations from 4v4 to 11v11 with named
presets and drag-anywhere custom shapes** · configurable periods, length, and
keeper weighting · **a field view with a shirt per position** plus a list view ·
live clock with stoppages · subs and position changes · goals, assists, and
opponent goals · live fairness ordering and sub suggestions · shift alarm · undo
and a full event log · per-game report with playing-time bars, a who-was-on-when
timeline, plus/minus and **minutes in each position by name** · copy-to-clipboard
summary · **a styled HTML report, or CSV, by download, share sheet or email** ·
installable, offline, survives a reload mid-game.

The report is what's meant to be opened and read: a styled HTML page, one clean
table — player, number, minutes, bench, positions played, goals, assists,
+/-, shots, saves, stints — under a header naming the team, opponent, date,
score and fairness. It opens in any browser, on any device, with no
spreadsheet app required, which is the point of building it separately from
the CSV rather than dressing the CSV up. The CSV stays underneath for a coach
who wants to build their own spreadsheet: cells are quoted only where the
syntax actually needs it, so the raw file reads as text and not as a wall of
`"..."`, and a value starting with `=`, `+`, `-` or `@` is defused with a
leading apostrophe so an imported name can't run as a formula. Sharing or
emailing always hands over the report — mailto can't attach one, so Email
saves it and puts the readable summary in the draft instead of pasting a
table into the body.

### Formations

Named the way a team sheet writes them, with the keeper counted: a 7-a-side 2-3-1
is **1-2-3-1**. Several named presets per squad size from 5v5 to 11v11 (7v7 gives
1-2-3-1, 1-3-2-1, 1-2-1-2-1, 1-3-1-2, 1-2-2-2, 1-1-4-1; 9v9 gives 1-3-2-3, 1-3-3-2,
1-2-3-3, 1-3-4-1, 1-2-4-2, 1-3-3-1-1; 11v11 gives 1-4-4-2, 1-4-3-3, 1-4-2-3-1,
1-3-5-2, 1-5-3-2, 1-4-5-1, 1-3-4-3, 1-4-1-4-1, 1-4-3-2-1, 1-3-4-1-2, 1-5-4-1).

Positions carry their line — `ST · F`, `CM · M`, `LB · D` — and lines are not
flat rows: full-backs push up past the centre-backs, a midfield three holds
through the middle, wingers play off the striker's shoulder, and a strike pair
stays central while a back four hugs the touchline.

Pick a shape, then drag any position where you actually want it and save it to the
team, or build one from scratch: **+ Add position** drops a new slot onto the
pitch, tap any slot to rename its code or change its role, and Remove clears one
back off (a formation always keeps at least one). Coordinates are normalised, so
your shape looks the same on any screen. Each game snapshots the formation it
was played in, so changing your shape later never rewrites an old game.

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
node scripts/bench-touch.mjs              # the bench, under real touch input
node scripts/initials.mjs                 # shirt circles: number, else initials
node scripts/edit.mjs                     # correcting a recorded game
node scripts/clock.mjs                    # the clock across a period boundary
node scripts/export.mjs                   # the HTML report and CSV: download, share, email
node scripts/sheets.mjs                   # nothing covers a sheet's buttons
node scripts/roster.mjs                   # removing a player keeps the record
node scripts/endgame.mjs                  # ending a game early, and un-ending it
node scripts/formation-editor.mjs         # more shapes, and building a custom one
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

`scripts/bench-touch.mjs` drives real touch input through Chromium via CDP,
which is the only way to exercise `touch-action` at all — mouse-simulated drags
(everything above) never touch that code path. Reported: a coach couldn't swipe
sideways through the bench to see the whole roster; it just picked up whichever
player the swipe started on. The bench strip and the drag gesture share one
touch surface, and CSS alone can't split them correctly — `touch-action: pan-x`
was tried first and broke the other half: a browser holding it decides "scroll"
from the first couple of pixels, and a drag toward any slot that isn't directly
overhead starts out just as sideways as a real scroll does. The fix disambiguates
in JS instead, once, off whichever axis moved further, and only when the bench
under the touch actually has something to scroll. The test covers all three: the
strip scrolls, a diagonal drag to an off-centre slot still places the player, and
the live screen's non-scrolling bench (a wrapping grid, nothing to scroll) is
untouched by any of it.

`scripts/edit.mjs` tests the claim the event log makes: it attributes a goal to
the wrong player, corrects it in the editor, and confirms the stats screen moves
the goal — then deletes a substitution and confirms the squad goes back.

`scripts/clock.mjs` plays a deliberately short first half, ends it from the ■
button, and starts the second. It exists because a real reading was wrong: the
clock used to pad each finished period by its *configured* length, so a
four-second first half opened the second at 30:01. It now asserts the period
clock restarts, the period label follows, and the whole-game total is the sum of
what was played.

`scripts/export.mjs` takes the report and the CSV out all four ways. Both
downloads are checked end to end: the CSV's metadata block, header and goal
column are parsed back, and the report is confirmed to be a real HTML document
with a table row per player and the fairness figure in the header. It also
covers a player named `<b>Six</b> & "Quotes"` — a name is free text a coach
types, the report is HTML rather than a sandboxed app screen, so anything that
lands unescaped runs as markup the moment the file is opened, and the test
asserts the name appears as text, not live tags. Share and email hand off to
the OS, so those are caught at the boundary: `navigator.share` is stubbed and
its file and text inspected, and the `mailto:` navigation is intercepted and
its subject and body read — including that Email actually saves the report
rather than only inlining it, and that neither route ever dumps the raw table
into a message body.

`scripts/sheets.mjs` guards a bug that only appeared on iOS. The header and the
footer action bar are blurred, WebKit promotes a blurred element to its own
compositing layer, and that layer painted over a sheet rendered between them —
so **Delete game** sat underneath *Copy summary* and *Export* and could not
be tapped. Chromium sorted the same markup correctly, which is why a screenshot
proved nothing. Sheets now render through a portal into `<body>` and the blurred
bars stand down while one is open; the test asserts both, and that every button
in every sheet is the topmost element at its own centre.

`scripts/roster.mjs` covers the rule that removing a player must not rewrite
history, and the CSV formula guard. It retires a player who has played, then
reads their name back off the summary and the exported CSV; it deletes one who
never played; it refuses to remove one who is on the pitch mid-match; and it
checks a player named `=1+1` is defused on CSV export while a negative
plus/minus stays a number.

`scripts/endgame.mjs` covers ending a game early. From mid-first-half it checks
that a quick tap on "Hold to end the game" does nothing, that holding it does,
that the log records `GAME_END` rather than a second period ever starting, that
the option disappears once the game is final, and that deleting the event from
Modify events un-finishes the game — the same recovery a mis-tapped period end
already gets, since it's an event in the log like any other.

`scripts/formation-editor.mjs` covers the expanded preset list and building a
custom shape: adding a position, editing its code and line, removing one down to
— but never past — the last, and the duplicate-code guard, which matters because
the engine and the position-minutes report both key off the code string, so two
positions sharing one would silently merge. Verified with teeth: temporarily
removing the guard in `Formation.tsx` and re-running fails the test.

`scripts/checkfit.mjs` runs the game screen at three phone sizes × three squad sizes and
asserts the page does not scroll, the whole pitch is on screen, and **no two
player tokens overlap**. That last check is the point: a squashed pitch still
"fits" while being unusable, which a pure size assertion misses.

The engine's own guarantee is documented in [`core/README.md`](./core/README.md):
`Σ player minutes == ∫ onFieldCount dt`, verified two independent ways over
thousands of generated games, and mutation-tested to confirm the check has teeth.
