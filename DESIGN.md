# Building a Sub Time alternative

A design brief for a self-hosted youth soccer game-management app: rosters, live
game timing and substitutions, event stats, and a reporting layer for the head coach.

---

## 1. What Sub Time actually does

Sub Time ("SubTime: Game Management", ~50k coaches, ~300k games) is a
game-management app rather than a plain sub timer. Its feature set:

| Area | What it does |
| --- | --- |
| Roster | Team rosters, attendance marking, guest players |
| Formations | Standard or custom formations; up to ~6 saved lineups per team |
| Timing | Tracks playtime *and* bench time per player; averages across games |
| Subs | Manual subs plus auto-generated rotation for equal playing time |
| Events | Goals, assists, and other per-sport events |
| Stats | Per-game stats views; CSV export of game history and player stats |
| Sharing | Live web view for parents/fans; emailed playing-time summaries |
| Multi-sport | Soccer, basketball, lacrosse, field hockey, rugby, custom sports |
| Paywall | Games >40 min, live sharing, and advanced auto-planning are paid |

**The parts worth copying:** playtime/bench-time tracking as the core primitive,
attendance gating the rotation, auto-rotation as a *suggestion*, and a share
surface that requires nothing of the recipient.

**The parts worth changing:** the multi-sport generality costs it soccer-specific
depth. There's no plus/minus, no position-variety tracking, no season-level
fairness reporting, and the reporting layer is essentially "export a CSV." That
gap is where a custom build earns its keep.

---

## 2. The one architectural decision that matters

**Model a game as an immutable, append-only event log. Derive everything else by
folding it.**

Do not keep mutable counters ticking. Do not store `player.minutesPlayed` and
increment it. Store events with timestamps and compute state on render.

This single choice buys you, for free:

- **Undo and post-game correction.** You *will* mistap on the sideline. Editing a
  log and re-folding is trivial; unwinding mutated counters is not.
- **No clock drift.** Elapsed time is `now - startedAt` minus stoppages, computed
  fresh each frame. A backgrounded phone, a locked screen, or a browser tab
  suspension does no damage.
- **Trivial offline sync.** Immutable events with client-generated UUIDs are
  idempotent. Sync is `upsert by id`. There is no conflict resolution to write.
- **A free reporting layer.** Every report — playing time, plus/minus, position
  variety, lineup effectiveness — is just a different fold over the same log.

### Event types

```ts
type GameEvent = {
  id: string;             // client-generated UUIDv7 (sortable)
  gameId: string;
  seq: number;            // monotonic per game, for stable ordering
  wallTs: number;         // epoch ms — for reconstruction and audit
  gameClockMs: number;    // derived clock position — for reporting
  period: number;
  type: EventType;
  payload: unknown;
};

type EventType =
  | 'PERIOD_START' | 'PERIOD_END'
  | 'CLOCK_PAUSE'  | 'CLOCK_RESUME'      // injury, ref stoppage
  | 'SUB'                                 // { off: PlayerId[], on: {playerId, position}[] }
  | 'POSITION_CHANGE'                     // { playerId, from, to }
  | 'GOAL'                                // { scorerId, assistId?, penalty?, ownGoal? }
  | 'OPPONENT_GOAL'
  | 'CARD' | 'SHOT' | 'SAVE'
  | 'ATTENDANCE'                          // { playerId, status }
  | 'NOTE';
```

Store **both** `wallTs` and `gameClockMs`. Wall time lets you reconstruct and audit;
game clock is what playing time should accrue against, since it excludes stoppages.

### Stints: the derived primitive

Fold `SUB` / `POSITION_CHANGE` / period events into **stints**:

```ts
type Stint = {
  playerId: string;
  position: Position;
  period: number;
  startClockMs: number;
  endClockMs: number | null;  // null = currently on
};
```

Every number in the app comes from stints:

- minutes played = Σ stint durations
- bench minutes = period duration − played
- minutes by position → **position variety**, a development metric
- stints overlapping a `GOAL` → **plus/minus** per player
- overlapping stint sets → **pairing effectiveness** (which combos concede)

### The invariant that keeps you honest

```
Σ (all players' played minutes) == fieldPlayerCount × elapsedGameMinutes
```

Assert this in property-based tests over randomly generated event logs. It catches
almost every timing bug — double-counted subs, stints never closed, pauses applied
to the wrong period. Adjust the right-hand side for short-handed play (red card,
short roster) rather than weakening the assertion.

---

## 3. The fairness engine

This is the actual reason coaches use these apps. Build it in two layers.

**Reactive (build first).** A live table sorted by deficit:

```
target      = (totalFieldMinutesInGame) / presentPlayerCount
projected   = playedSoFar + (onField ? remainingMinutes : 0)
deficit     = target - projected
```

Sort ascending by `deficit`, color-code as a heat scale, and the next sub is the
top N non-GK rows. This is ~30 lines of code and delivers most of the value.

**Proactive (build later).** Pre-generate a shift plan: divide each period into
shifts (e.g. 4 × 10 min), assign players so totals converge, respecting position
eligibility and GK constraints. A greedy assignment plus local swaps is more than
adequate for a 14-player roster — do not reach for an ILP solver.

**Make the plan advisory.** Real games diverge from plans immediately. The planner
proposes the next lineup; the coach applies or overrides it; the log records what
*actually* happened; deficits recompute against reality. A planner that fights the
coach gets deleted after one game.

**Make the fairness policy configurable** — this is a genuine coaching debate and a
key reason to build your own:

- GK minutes weighted at 100%, 50%, or excluded entirely
- strict equal time vs. attendance-weighted (practice attendance earns minutes)
- position-weighted targets
- per-age-group defaults (U9 strict equal; U14 maybe not)

---

## 4. Recommended stack

**An offline-first PWA. React + TypeScript + Vite, Dexie (IndexedDB) locally,
Supabase (Postgres) for sync and reporting.**

| Layer | Choice | Why |
| --- | --- | --- |
| Client | React + TS + Vite | One codebase, instant deploys, no app store |
| Local store | Dexie / IndexedDB | Full offline game capture |
| Sync | Upsert events to Supabase by UUID | Immutable + idempotent = no merge logic |
| Backend | Supabase (Postgres, auth, RLS) | Real SQL matters for the reporting layer |
| Charts | Recharts or Observable Plot | Both fine; Plot is terser for exploratory work |
| Hosting | Vercel / Netlify / Cloudflare Pages | Free tier is ample |

### Why PWA over React Native

You get install-to-home-screen, no app store review, one codebase for your phone
and an iPad on the bench, and a share link the head coach opens with zero
installs. The classic PWA objection — "background timers are unreliable on iOS" —
**does not apply here**, because deriving elapsed time from timestamps means a
suspended tab loses nothing.

### Honest iOS caveats

- **Wake Lock API** (keep screen on during a game): Safari 16.4+. Supported, but
  test it; fall back to a "keep screen awake" instruction if it fails.
- **IndexedDB eviction:** Safari can evict storage for non-installed sites after
  ~7 days unused. Mitigate with an installed PWA, `navigator.storage.persist()`,
  and syncing to the server. Do not treat the device as the only copy.
- **Web Push** needs an installed PWA (iOS 16.4+). You likely don't need push at
  all — sub alerts are in-app audio plus visual.
- **Haptics** are limited on iOS Safari. Use audio + a large visual alert for the
  sub buzzer, not vibration.

If any of these prove fatal in practice, the React port is a UI rewrite only —
the event log, reducer, and reporting logic are plain TypeScript and carry over
unchanged. Keep them in a framework-free `core/` package from day one.

---

## 5. Data model

```sql
teams          (id, name, age_group, season_id, fairness_policy jsonb)
seasons        (id, name, starts_on, ends_on)
players        (id, first_name, last_name)
team_players   (team_id, player_id, jersey, eligible_positions text[], active)

games          (id, team_id, opponent, kickoff_at, venue,
                period_config jsonb,   -- {periods: 2, lengthMin: 30, stoppage: true}
                formation jsonb,       -- {name: '3-2-3', slots: [...]}
                status)                -- scheduled | live | final

game_players   (game_id, player_id, attendance, is_guest)

game_events    (id uuid PK, game_id, seq int, type text,
                wall_ts timestamptz, game_clock_ms int, period int,
                payload jsonb)
                -- UNIQUE (game_id, seq); append-only; the source of truth

-- Derived, written once on game finalize:
stints             (game_id, player_id, position, period, start_ms, end_ms)
player_game_stats  (game_id, player_id, minutes, bench_minutes, goals,
                    assists, plus_minus, minutes_by_position jsonb)
```

### Avoid the two-implementations trap

You need the fold live in the browser (TypeScript) and for reports (SQL). Writing
it twice guarantees they'll disagree.

**Recommendation: write the reducer once in TypeScript.** On game finalize, run it
and persist `stints` and `player_game_stats`. Reports then query flat tables with
plain SQL — one source of truth for the logic, fast reports, and the raw log still
available to re-derive if the reducer changes. Version the reducer and stamp the
version on derived rows so you can detect and rebuild stale data.

---

## 6. Sideline UX

This is where these apps live or die. The user is standing, one-handed, in sun or
rain, watching the game — not the screen.

- **Two-tap sub:** tap the player coming off, tap the player coming on. Support
  multi-select for batch swaps at a stoppage.
- **Thumb zone.** Primary actions at the bottom. Large targets. Assume gloves.
- **Always visible:** game clock, score, and a "next up" queue sorted by deficit.
- **Heat-coded roster.** Colour each player by minutes deficit for an instant read.
- **Prominent undo,** plus a full event-log editor for post-game cleanup.
- **Two views:** a list view (fastest for subs) and a pitch view (for positions).
  List is the default; coaches sub far more often than they reposition.
- **Sub interval alarm:** optional buzz every N minutes at a natural stoppage.
- **Goal entry in one flow:** tap GOAL → pick scorer from the on-field six → pick
  assist or skip. Never make the coach scroll the full roster mid-celebration.

---

## 7. The reporting layer

The explicit ask, and the biggest gap in Sub Time. Design around what a head coach
actually needs to answer.

**Per game**
- Playing-time bar chart, target line overlaid
- Stint timeline (Gantt) — who was on, when, in which position
- Goals/assists, score progression, plus/minus per player

**Per season**
- Minutes distribution with a **fairness index** (min/max ratio, or coefficient of
  variation) — one number that answers "are we being fair?"
- Goals/assists leaderboard
- **Minutes by position per player** — did every kid play multiple roles?
- Attendance vs. minutes, to validate an attendance-weighted policy

**Head-coach specific.** They care about three things:
1. **Parent defense** — evidence that playing time was equitable
2. **Development** — position variety and progression over the season
3. **Effectiveness** — goal differential per minute by player and by pairing

**Delivery: a read-only share link.** A signed, expiring token URL that renders the
report in a browser. No login, no install, no app. Offer CSV and PDF export
alongside it, but the link is the primary channel — it is the single biggest UX
win over emailing a CSV.

---

## 8. Build order

Ship in this sequence. Each phase should be usable in a real game before the next
one starts.

| Phase | Scope | Done when |
| --- | --- | --- |
| **0** ✅ | `core/`: event types, reducer, stint fold, property tests | Invariant holds under random logs — [built](./core/) |
| **1** | Single game: timer, roster, subs, live playing time. Local only. | **You run one real game on it** |
| **2** | Goals/assists/events, teams & seasons, Supabase sync | A season's data persists |
| **3** | Fairness deficits, then the shift planner | Suggestions are good enough to accept |
| **4** | Reporting + share links + exports | Head coach opens a link and gets it |

**Do not skip the "use it in a real game" gate on Phase 1.** One live game will
invalidate a meaningful fraction of your UI assumptions — better to learn that
before building the planner on top of them.

---

## 9. Where a custom build beats Sub Time

Worth being clear-eyed: Sub Time is mature, cheap, and works. Build your own only
for things it structurally can't give you:

1. **Plus/minus and pairing effectiveness** — falls out of the stint model for free
2. **Position-variety development tracking** — a real coaching need, unserved
3. **Configurable fairness policy**, including GK weighting
4. **A genuine reporting layer** with share links, not a CSV export
5. **Multi-team views** — you coach several teams; compare and roll up across them
6. **Your own data**, no paywall on game length or sharing

---

## Sources

- [SubTime — official site](https://www.subtimeapp.com/)
- [SubTime: Game Management — App Store](https://apps.apple.com/us/app/subtime-game-management/id1248650528)
- [SubTime: Game Management — Google Play](https://play.google.com/store/apps/details?id=com.gametimes&hl=en_US)
- [10 Best Youth Soccer Substitution Apps For Coaches — Pitch Planner](https://pitch-planner.app/blog/best-youth-soccer-substitution-apps/)
- [Soccer Time! Soccer Subs App](https://apps.apple.com/us/app/soccer-time-soccer-subs-app/id6450653830)
- [Game Time Coach](https://gametimecoach.app/)
- [Mingle Sport](https://mingle.sport/tutorial/scorekeeping-for-soccer/)
