# @pitchside/core

The game engine: event log, reducer, stint fold, and derived stats. No React, no
database, no platform APIs — the same code runs in the PWA, in tests, and
server-side when a finished game is folded down into report tables.

See [`../DESIGN.md`](../DESIGN.md) for why it is built this way.

```bash
npm install
npm test          # 51 tests, including ~3,000 generated games
npm run typecheck
npm run build
```

## The model in one page

A game is an **immutable, append-only event log**. Everything else is derived by
folding it. Nothing ticks; no counter is ever incremented in place.

```ts
import { reduce, appendEvent, playerStats, fairness, defaultConfig } from '@pitchside/core';

const config = defaultConfig({
  periods: { count: 2, lengthMs: 30 * 60_000, fieldPlayers: 9 },
  fairness: { gkWeight: 0.5, mode: 'equal' },   // keeper minutes count half
});

const { state, errors } = reduce(events, config);

playerStats(state, Date.now());   // minutes, bench, goals/assists, minutes by position
fairness(state, Date.now());      // live table, most-owed first
```

Sum that across a team's games for a season total — `aggregatePlayerStats()`
takes an array of `playerStats()` results, one per game, and folds them into
one row per player: games played, minutes, positions, goals, assists, +/-.

To record something, stamp it against current state and append it:

```ts
const event = appendEvent(state, {
  type: 'SUB',
  off: ['player-7'],
  on: [{ playerId: 'player-12', position: 'ST' }],
});
// persist `event`, then re-run reduce()
```

### Two conventions everything depends on

1. **`gameClockMs` is authoritative; `wallTs` is audit metadata.** Stats are
   computed from clock positions, never wall time. Correcting a mistap after the
   game is just editing a number. `appendEvent` is the single place wall time is
   converted into a clock position.

2. **The clock is per-period and restarts at zero.** Stints carry their period, so
   the arithmetic never deals in cumulative offsets. There is deliberately no
   continuous-clock helper: periods do not reliably run their configured length,
   so the only honest running total is `elapsedGameMs`, the sum of what was
   actually played.

A consequence worth internalising: because stints live in game-clock coordinates,
**clock pauses are invisible to them**. Stoppage time is excluded from playing
time for free, with no special handling in the fold.

## Why nothing ticks

Elapsed time is always `anchor.clockMs + (now - anchor.wallTs)`, computed at the
moment you ask. A suspended tab, a locked phone, or a backgrounded PWA costs
nothing — which is why "background timers are unreliable on iOS", the usual
argument against building this as a web app, does not apply.

## What the fold gives you

`Stint { playerId, position, period, startMs, endMs }` is the derived primitive,
half-open on `[startMs, endMs)` so a sub at minute 20 is never counted twice.
Everything else reads off it: minutes played, bench time, minutes by position
(development), goals and assists, and the live fairness table.

`fairness.gkWeight` is `1` / `0.5` / `0` — how much a minute in goal counts
toward a player's own target. `0` means the keeper is *excluded*, not merely
weighted to zero: whoever's in goal right now carries no target and no
deficit, and the outfield target is worked out over the outfield spots only,
not diluted by a slot that was never actually shared. This is per-instant, not
per-game — a rotating keeper rejoins the pool the moment they sub to an
outfield spot, and because their time in goal earned no credit, they pick up
a genuine target for whatever they play next.

## Errors are data, not exceptions

`reduce` returns `{ state, errors, applied }`. An illegal event — subbing on a
player already on the field, a clock that moves backwards — is skipped with a
reason attached, and the fold continues. One bad event in a 400-event log must
never make a live game unusable. Surface `errors` in the UI rather than ignoring
them.

## Testing

The suite's centrepiece is the field-time invariant:

```
Σ (every player's time on the field)  ==  ∫ onFieldCount dt
```

The right-hand side is computed by `fieldTimeIntegralMs`, a replay that tracks
only a scalar count and **shares no code with the stint fold**. Two independent
computations agreeing across ~3,000 generated games is what makes the timing
engine trustworthy.

It is stated as an integral rather than `fieldPlayers × elapsed` because red
cards and short rosters mean the on-field count genuinely varies — the honest fix
is a stronger right-hand side, not a weaker assertion.

The invariant was mutation-tested. Five deliberately introduced bugs — a period
start that fails to reopen stints, a sub opening its stint at the wrong clock, a
pause that fails to stop the clock, an inclusive goal boundary, and a period end
that leaves stints open — are each caught by at least one test.

## Not yet built

`fairness()` covers equal and weighted targets and suggests subs, but the
**shift planner** (pre-generating a whole rotation) is Phase 3.

Season-level rollups are `aggregatePlayerStats()`: sum an array of `playerStats()`
results, one per game, into one row per player. It takes already-computed rows
rather than events or a database handle, so it stays framework-free — the
caller folds each game's log with `reduce()` + `playerStats()` however it
likes and hands the results here. No persisted rollup table; a team's history
is already the full record; a season total is a read, not new state.
