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

## Running it at a game

1. `npm run build && npm run preview --workspace app`, or deploy `app/dist` to any
   static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages — no server needed).
2. Open it on your phone and **Add to Home Screen**. Installing matters: it keeps
   the screen-wake lock working and stops Safari evicting your data.
3. Add a team, add the roster, open **Settings** to set your format.
4. New game → mark who is here → tap the seven (or nine, or eleven) shirts → **Start**.

It works with no signal. Everything lives on the device.

### On the sideline

- **Two taps to sub:** a player on the field, then a player on the bench. Both
  lists take multiple selections, so a four-player change at a stoppage is one action.
- **The bench is sorted by who is owed the most time**, so the top row is always
  the app's suggestion. The coloured edge is the same signal without the numbers.
- **"ends 6:00 over"** under a name is a projection — where that player finishes
  if you change nothing — not a statement about right now.
- **Stop clock** for injuries. Stoppage time never counts as playing time.
- **Undo** removes the last event. Tapping the wrong name costs one tap to fix.
- Tap a player's **position badge** to move them without subbing.

## What works today

Rosters and teams · attendance · configurable formats (periods, length, squad
size, positions) · live clock with stoppages · subs and position changes · goals,
assists, and opponent goals · live fairness table and sub suggestions · shift
alarm · undo and a full event log · per-game report with playing-time bars, a
who-was-on-when timeline, plus/minus and position variety · copy-to-clipboard
summary and CSV export · installable, offline, survives a reload mid-game.

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
```

`scripts/smoke.mjs` plays a full two-half game through the actual UI — roster,
lineup, kickoff, subs, goals, a stoppage, undo, full time — and checks the
numbers the app reports, including the field-time invariant end to end. It writes
screenshots to `scripts/shots/`. Pass `--headed` to watch it.

The engine's own guarantee is documented in [`core/README.md`](./core/README.md):
`Σ player minutes == ∫ onFieldCount dt`, verified two independent ways over
thousands of generated games, and mutation-tested to confirm the check has teeth.
