# SubTime — UI/UX Design Review

Reviewer: senior product designer (mobile-first, one-handed, high-stakes-glance interfaces)
Date: 2026-07-28
Evidence: 320 screenshots in `/home/user/subtime/scripts/shots/rv/` (iPhone SE 375, iPhone 14 390, large phone 430) at 7v7 / 9v9 / 11v11; source in `/home/user/subtime/app/src/`; contrast computed from the CSS custom properties in `app/src/styles.css`.

## 1. Verdict

**This is a well-engineered app with a serious perception problem.**

The architecture is right and, in places, better than the commercial competition: an event-sourced game log with real undo and an editing screen, a full-bleed vertical pitch that gets the screen it deserves, the bench sitting directly under the thumb, wake lock, `dvh` sizing, tabular numerals so the clock never jitters, a page that never scrolls. Someone thought hard about the sideline. The CSS file opens with a statement of intent — dark, high-contrast, 44px targets, actions at the bottom, no hover — and most of the app honours it.

But the game screen, the only screen that matters at 3pm on a Saturday, fails its own brief in a specific and consistent way: **the information a coach needs is present but not perceptible.** The fairness signal — the entire point of the product — is a 3px ring whose colours measure **1.04:1 to 1.76:1** against the pitch behind them, on a red↔green hue axis, driven by a scale so saturated that for most of a match every starter looks identical and every substitute looks identical. The app computes exactly who should come on next (`suggestSubs` in `core`) and never once tells the coach. The clock runs past full time with no signal. A completed substitution produces no toast, no haptic, no sound and no live region — nothing at all. The controls that need the thumb (pause, end half) are in the top 50px at 38–40px; the thumb zone is spent on goal buttons. And a button styled exactly like a normal substitution will silently put the team a player down.

None of that is a rewrite. Every one of those is presentation sitting on top of data the engine already produces correctly. **The engine is ahead of the category; the glanceability is behind it.** Close that gap and this is genuinely competitive with SubTime, SubNow and Soccer Subs, with a better data model than any of them.

Rough grade: **engine and information architecture 8/10; sideline legibility and feedback 4/10; visual craft 7/10 with four specific defects that read as unfinished.**

## 2. Findings

### Measured contrast reference

Computed from `app/src/styles.css` (WCAG 2.1 relative luminance). Pitch background is the `linear-gradient(165deg, #4f9f4a, #45923f, #3c8437)` at `styles.css:781` with the `repeating-linear-gradient` stripe overlay; "pitch light stripe" below = `rgb(79,152,74)`, "dark stripe" = `rgb(66,139,60)`.

| Pair | Ratio | AA needed |
|---|---|---|
| `--text #e8f0f5` on `--bg #0f1720` | **15.65:1** | pass |
| `--muted #8ba0b5` on `--surface #172230` (score/period, 11px) | **5.96:1** | pass |
| `--muted` on `--bg` (bench time 10px, event times 13px) | **6.70:1** | pass |
| token time `#cfe6dc` on pitch light stripe (11px) | **2.70:1** | 4.5 — **fail** |
| token name `#e8f0f5` on pitch light stripe (12px) | **3.08:1** | 4.5 — **fail** |
| heat **RED** `hsl(0 88% 55%)` vs pitch light stripe | **1.17:1** | — |
| heat **AMBER** `hsl(39 88% 55%)` vs pitch light stripe | **1.76:1** | — |
| heat **GREEN** `hsl(162 45% 38%)` vs pitch light stripe | **1.14:1** (1.04:1 vs dark stripe) | — |
| heat RED vs heat AMBER (adjacent states) | **2.06:1** | — |
| heat AMBER vs heat GREEN | **2.01:1** | — |
| heat GREEN vs neutral `--line` | **2.87:1** | — |
| `--danger #e5484d` on `--surface` | **4.10:1** | 4.5 — marginal fail |
| bench shirt ring `--line #2b3a4d` on `--bg` | **1.56:1** | — |
| primary button `#06231a` on `--accent #38bd8a` | 6.98:1 | pass |
| `.gplay.on` / `.shiftpill` `#2a1c02` on `--warn #f0a02a` | 7.72:1 | pass |

---

### F1 — HIGH — The fairness heat ring is invisible on the pitch, and saturated for most of the game
**Screen:** Live / field view. **Files:** `app/src/components.tsx:143-148` (`heatColor`), `app/src/Pitch.tsx:187-196`, `app/src/styles.css:838-851` (`.token .shirt`), `core/src/stats.ts:256-271` (`deficitMs`).

**Observed.** The only thing on the pitch that tells a coach *who is owed minutes* is the 3px ring around each shirt (measured `borderWidth: 3px` on a 46px shirt, live DOM at 375px). Its colour comes from `heatColor(deficitMs)`. Measured against the pitch gradient:

- red `hsl(0 88% 55%)` vs pitch: **1.17:1**
- amber `hsl(39 88% 55%)` vs pitch: **1.76:1**
- green `hsl(162 45% 38%)` vs pitch: **1.14:1**, and **1.04:1** against the darker stripe

1.04:1 is, in luminance terms, not there. The ring is discriminable *only by hue* — and the hue axis chosen is red↔green, the one 8% of men cannot separate. Youth-coach demographics make that a live concern, not a checkbox.

Second problem: `deficitMs = targetMs - projectedMs` where `projectedMs` assumes an on-field player stays on to full time (`stats.ts:261`). At kick-off in a 7v7 with 14 available and 2×30 min, every starter is at −30 min and every bench player at +30 min. `heatColor` saturates at ±10 min (`components.tsx:144`). So for the first two-thirds of a match the pitch is a wall of identical green rings and the bench a wall of identical red rings — confirmed in `se-9-14-live-running.png`, `se-11-14-live-running.png` and `probe-overrun-11.png`, where all seven/eleven starters and all bench players are visually identical. Only in `m375-9-43-shift-due.png` (later in the game) does the bench finally show amber, and even then all four bench rings are the same amber.

**Why it matters on a touchline.** This is the app's reason to exist. A coach glances for two seconds to answer "who goes on next?". Right now the answer is encoded in a low-contrast hue on a 3px ring, on a saturated scale that returns the same answer for every player. In sun, on a screen at 40% brightness with a polarised lens, the coach gets nothing and falls back to memory — which is the exact failure the app was built to prevent.

**Recommendation.** Stop encoding the primary signal as ring hue on green.
1. Rank rather than saturate: colour by *position in the owed-minutes order* (top 2 owed = strong signal, rest neutral), or clamp the ramp to the actual live spread rather than a fixed ±10 min.
2. Move the signal off the ring and onto something with luminance headroom: a filled badge/wedge on the shirt, or make the *number itself* invert. A white-on-solid badge reads at 8:1 against the pitch.
3. Add a non-colour channel — a small "+7" owed-minutes figure, or a ring thickness/dash difference — so it survives sun and colour blindness.

---

### F2 — HIGH — All clock control lives in the top bar; the bottom bar spends its space on goals
**Screen:** Live. **Files:** `app/src/screens/Live.tsx:255-315` (gamebar), `:428-444` (bottom `.actions.slim`), `app/src/styles.css:1071-1150`, `:1304-1326`.

**Observed (measured, 375×667).** `.gplay` (pause/resume) is 44×44 at **y=7**; `.gstop` (end half) is **38×38** at y=10; `.gbtn` back/log/••• are **40×40** at y=9. The bottom bar holds `⚽ Us`, `⚽ Them`, `↩ Undo` at 114×**42** each, y=619. Screenshot: `se-9-14-live-running.png`, `se-9-21-paused.png`.

Three things are wrong at once:

1. **Reach.** On a 667pt phone the top 50px is the least reachable region one-handed; on an iPhone 14/15 (844pt) it needs a grip shuffle. Pausing the clock is one of the most frequent mid-game actions — every injury, every ball over the fence, every ref stoppage — and every playing-time number the app exists to produce depends on it being pressed promptly. Goals happen 2–6 times a game and own the whole thumb zone.
2. **Target size.** `.gstop` at 38×38 and `.gbtn` at 40×40 are below 44px; the bottom buttons are 42px. `styles.css:1-8` states the rule as "touch targets no smaller than 44px" and `--tap: 48px` is defined at `:26` — the game screen is the one place the rule is broken, and it is the one screen used while not looking.
3. **Adjacency + mis-tap cost.** `.gplay` occupies x 237–281 and `.gstop` x 285–323 — a **4px gap** between "pause the clock" (recoverable) and "end the half" (a period boundary, guarded only by a native `confirm()`, `Live.tsx:295`). Two adjacent sub-44px targets with wildly asymmetric consequences is the classic cockpit error.

**Recommendation.** Put pause/resume in the bottom bar as the primary, thumb-sized control (min 56px tall, full-width-ish), demote `⚽ Them` behind the goal sheet or a long-press, and move `End half` out of the transport cluster entirely — it belongs at a period boundary, not next to pause. If it must stay in the bar, separate it by ≥24px and make it require a hold rather than a tap+confirm.

---

### F3 — HIGH — Transport colour semantics are inverted
**Screen:** Live gamebar. **Files:** `app/src/styles.css:1129-1146`, `app/src/screens/Live.tsx:284-291`.

**Observed.** `.gplay` is `--accent` green by default and `--warn` orange when `.on` (i.e. **while running**). Compare `se-9-14-live-running.png` (large **orange** circle, ❚❚) with `se-9-21-paused.png` (large **green** circle, ▶). The clock also flips: white when running, orange when paused (`.gclock .time.paused`, `:1116`).

**Why it matters.** The single largest, brightest object on the screen is the transport button — it is what the eye lands on first, ahead of the clock, ahead of the pitch. It says orange-alert when everything is fine and calm-green when the clock is stopped and minutes are silently not accruing. The two signals also disagree with each other: paused = green button + orange clock. A coach glancing from 30 metres of pitch away gets a colour, not a glyph.

There is a defensible read (the button shows the *action*, and orange = "the destructive-ish thing you'd do next"), but it is not what a glancing user decodes. Every stopwatch, every match clock, every media transport a coach has ever used maps green→running.

**Recommendation.** Make **state**, not action, the colour: running = green, paused = amber, and let the glyph carry the affordance. Add a persistent, unmissable paused treatment — desaturate or dim the pitch itself while paused. Right now the only paused cue on the field is an 11px word "STOPPED" (`.gclock .meta`) which is the smallest text on the screen.

---

### F4 — HIGH — A completed sub produces no confirmation of any kind
**Screen:** Live. **Files:** `app/src/screens/Live.tsx:153-164` (`makeSub`), `:415-427` (`.subbar`). No `aria-live`, `role="status"`, or toast exists anywhere in `app/src` (grep: zero hits).

**Observed.** Compare `se-9-16-sub-pending.png` → `se-9-17-after-sub.png`. Tapping **Sub 1 ↔ 1** swaps `11 Kit Larsen` onto the pitch and `1 Ana Ruiz` onto the bench. The only evidence anything happened is that two 46px tokens exchanged places in two different regions of the screen — plus the sub bar reverting to `Us / Them / Undo`. There is no toast, no flash, no haptic, no sound. `beep()` (`components.tsx:239`) is wired only to the shift alarm, not to a sub.

**Why it matters.** The coach is looking at the field, not the phone, at exactly the moment a sub is made — they are calling names across a touchline. The interaction is "tap, tap, tap, look up". If the third tap missed, or landed on Cancel, nothing tells them. The failure is silent and only discovered later when the playing-time numbers are wrong, at which point it is unrecoverable without editing the event log.

**Recommendation.** A 1.5s toast in the bottom band — "**Kit Larsen on · Ana Ruiz off**" — plus a short distinct haptic/beep. It costs no permanent layout, it is readable in peripheral vision, and it makes the "look up immediately" pattern safe. Mirror it in an `aria-live="polite"` region so a screen reader announces it too.

---

### F5 — HIGH — `Sub N ↔ 0` and `Sub 0 ↔ N` are enabled and silently play short / over
**Screen:** Live sub bar. **Files:** `app/src/screens/Live.tsx:153-176`, `:419-425`.

**Observed.** `se-9-15-sub-onepicked.png`: one on-field player selected, no bench player, and the primary button reads **"Sub 1 ↔ 0"** in full green primary styling, fully enabled. Tapping it records `{ off: [id], on: [] }` — the team goes down to six players with no warning at all. Symmetrically, `Sub 0 ↔ 2` puts two extra players on. The pitch will then draw a vacant dashed slot (`m375-9-43-shift-due.png` shows the `CB · D` dashed slot) but nothing announces "you are a player short".

**Why it matters.** This is the highest-cost mis-tap in the app and it is styled identically to the correct action. The realistic sequence is: coach taps a player to select, gets distracted by play, taps the big green button by muscle memory. Playing a man down for four minutes because of a UI affordance is a real match consequence, not a data-quality one.

**Recommendation.** Change the label to describe the outcome rather than the arithmetic: `Sub 1 ↔ 1` stays, but `1 ↔ 0` should read **"Take Ana off — play 6"** in a warning treatment, and `0 ↔ 1` **"Put Kit on — play 8"**. Keep both possible (playing short is legitimate after a red card) but make them visibly different from a straight swap. Better still, show the resulting on-field count next to the button at all times.

---

### F6 — MEDIUM — Player names and minutes on the pitch fail contrast, and the keeper's label collides with the six-yard box
**Screen:** Live / Setup / Formation. **Files:** `app/src/styles.css:878-918`, `app/src/Pitch.tsx:197-210`, `:131-134` (y clamp 0.89).

**Observed.** Computed contrast on the pitch gradient: `.token .tname` `#e8f0f5` at 12px = **3.08:1**; `.token .ttime` `#cfe6dc` at 11px = **2.70:1**. Both fail AA (4.5:1 for text under 18.66px). The `text-shadow: 0 1px 3px rgba(0,0,0,.85)` softens this perceptually but does not fix it — a blurred 3px halo is exactly what disappears first under sunlight glare.

Separately: the `y` clamp of 0.89 (`Pitch.tsx:133`) puts the goalkeeper's token near the bottom, so name and time render on top of the six-yard box and penalty-area lines. In `se-9-14-live-running.png` and `se-11-14-live-running.png` "Ana Ruiz / 0:02" sits directly across the white six-yard box line, and the `0:02` butts against the pitch's bottom edge. Same in my own capture at 375×667.

**Why it matters.** The minutes number is the reason to look at the pitch view at all. It is the smallest (11px), lowest-contrast (2.70:1), lowest-weight (400) text on the screen, sitting on a mid-luminance green with white lines running through it.

**Recommendation.** Give the time a solid pill background rather than a text shadow (`rgba(6,26,16,.72)` behind `#eafff5` gets you >8:1 and costs 2px of padding), bump it to 12px/600, and drop the keeper's y clamp to ~0.84 so the label clears the six-yard box.

---

### F7 — MEDIUM — List view has no gutter: headings touch the bezel and misalign with the rows
**Screen:** Live → "Show as list". **Files:** `app/src/screens/Live.tsx:317-380`, `app/src/styles.css:168-176` (`.pane`), `:224-230` (`h2`).

**Observed.** `se-7-24-list-view.png`: "ON THE FIELD · 7" is flush against the left screen edge with the `O` visually clipped by the bezel; "BENCH · 2" the same. Measured live: `.pane` x=0 w=375, `h2` x=0 w=375 — zero horizontal padding. Every other screen puts `.pane` inside `main`, which has `padding: var(--pad)` (`styles.css:133`); the live screen renders `.pane` as a direct child of `.app`, so it inherits none.

Also visible in the same shot: the last visible bench row ("Ivy Chen") is cut through the middle by the action bar. `.pane` scrollHeight 980 vs clientHeight 553 with the action bar at y=612 — there is no bottom scroll padding, so the final row is always half-hidden until scrolled.

**Why it matters.** This is the view a coach switches to precisely when the pitch view is too fiddly — i.e. when they are already struggling. Arriving at a screen where the section labels are clipped and the last row is sliced reads as broken, and the clipped bottom row genuinely hides a player.

**Recommendation.** Add `padding: 0 var(--pad)` and `padding-bottom: 12px` to the live `.pane`. Also add a scroll-shadow or count so it is obvious the bench continues below.

---

### F8 — MEDIUM — Nothing indicates the app already knows who should come on
**Screen:** Live bench. **Files:** `app/src/screens/Live.tsx:382-412`, `core/src/stats.ts:278+` (`suggestSubs`), `app/src/screens/Team.tsx:328`.

**Observed.** `core` exports `suggestSubs` — "Who to bring on next: the most-owed players who are not currently on" — and it is **never imported anywhere in `app/src`** (grep: zero references). The bench grid is sorted most-owed-first (`fairness()` sorts by descending deficit) but that ordering is completely undeclared: in `probe-overrun-11.png` the bench reads `12, 13, 14`, in my 375 capture `9, 14, 8, 13, 10, 12, 11` — a jumbled sequence with no visible logic. Meanwhile `Team.tsx:328` tells the coach the setting "affects the fairness targets and **sub suggestions**" — suggestions the UI never shows.

**Why it matters.** The three-second sideline decision is *who*, not *how*. The app has computed the answer and hidden it in an unlabelled sort order behind a colour that doesn't read. This is the single largest gap between what the app knows and what the coach sees.

**Recommendation.** Label the first one or two bench entries — a "NEXT" chip, or a one-line strip above the bench: **"Next on: Kit, Lou"** — and make the shift-due pill actually name them: "Shift due — Kit, Lou". That turns the alarm from a nag into an instruction.

---

### F9 — MEDIUM — "Shift due" is a passive amber pill in the least-looked-at corner
**Screen:** Live. **Files:** `app/src/screens/Live.tsx:104-119`, `:339`, `app/src/styles.css:1214-1226`.

**Observed.** `m375-9-43-shift-due.png` / `probe-overrun-11.png`: a 12px amber pill reading "Shift due" in the **top-right of the pitch**, at 1.65:1 against the green. It fires a double `beep()` once per shift window (`Live.tsx:113-118`), which on a touchline with 40 kids and two games running is inaudible, and on iOS is silent unless the audio context was already unlocked by a tap.

The top-right of a portrait phone held one-handed is the corner the palm and thumb-web most often occlude, and the corner the eye scans last.

**Why it matters.** The whole shift-alarm feature currently depends on a small pill in a bad corner plus an 880Hz beep that will not be heard outdoors. The feature exists and is effectively invisible.

**Recommendation.** Escalate it into the bottom band where the eye and thumb already are: turn the action bar amber and replace `⚽ Us / ⚽ Them / ↩ Undo` with a single **"Shift due — sub 2"** action that pre-selects the two most-owed on-field and two most-owed bench players. Add `navigator.vibrate` alongside the beep.

---

### F10 — MEDIUM — Menu sheet: "Delete game" sits in the prime thumb position, guarded only by a native `confirm()`
**Screen:** Live → •••. **Files:** `app/src/screens/Live.tsx:453-500`.

**Observed (measured, 375×667).** Sheet buttons top-to-bottom: `End 1H (or ■ in the bar)` y=383, `Show as list` y=439, `Stats and playing time` y=495, `Modify events` y=551, **`Delete game` y=607** — the last item, 48px tall, ending 12px from the bottom of the screen. That is the single most thumb-reachable point on the phone. The only guard is `confirm('Delete this game and everything recorded in it?')` — a native iOS dialog whose default/right-hand button is OK.

Immediately above it, "Modify events" and the destructive "End 1H" share the same 48px stack with identical geometry, distinguished only by text colour (`--danger #e5484d` on `--surface` = **4.10:1**, marginally below AA) and `--warn`.

**Why it matters.** Two taps, both in the thumb arc, destroy an entire game's record with no undo. The menu is opened mid-game to switch views or check stats, so the coach *is* in this sheet while distracted.

(`se-9-23-menu.png` catches the sheet mid-entrance and looks alarming, but the animations are only 0.14s/0.18s — `styles.css:553,565` — so that is a capture artifact, not a defect. The settled backdrop measures `rgba(3,8,13,.66)` and is fine.)

**Recommendation.** Move `Delete game` out of the live-game menu entirely (it belongs in the summary/settings screen, `Summary.tsx:254` already has it). If it stays, put it last *below a divider and a spacer*, and require a hold-to-confirm rather than a native dialog. Raise `--danger` to ≥4.5:1 on `--surface`.

---

### F11 — MEDIUM — Accessibility: no live regions, no headings on the game screen, and the minutes are stripped from the pitch labels
**Screen:** Live. **Files:** `app/src/Pitch.tsx:183-185`, `app/src/screens/Live.tsx:382-412`.

**Measured on the live DOM at 375×667:**
- `[aria-live] / [role=status] / [role=alert]` count: **0**. No sub, goal, undo, period change or shift alarm is announced.
- `h1/h2/h3` count on the field view: **0**. There is no landmark structure — a screen reader user gets an undifferentiated run of buttons.
- Pitch token accessible names are `"Ana Ruiz, GK"`, `"Bea Okonjo, LB"` … — the **playing time is omitted entirely** (`Pitch.tsx:183`), so the one number that matters is unavailable non-visually.
- Bench buttons have no `aria-label`; their computed name is the raw text concatenation `"9 Ivy Chen 0:00"` — an unlabelled number, an unlabelled duration.
- Tokens and bench chips are selection toggles (`Live.tsx:166-176`) with **no `aria-pressed`**, so selected/unselected is conveyed only by the `.picked` green fill.

**Why it matters.** Beyond the obvious: this also affects the sighted coach with the phone in a jacket pocket. There is no audio channel at all except a bare 880Hz beep.

**Recommendation.** Add `aria-pressed` to the toggles; extend the token label to `"Ana Ruiz, goalkeeper, 12 minutes played, 4 minutes owed"`; add one `aria-live="polite"` region carrying the same string as the sub toast in F4.

---

### F12 — LOW/MEDIUM — Bench grid eats a quarter of the screen at the roster size the app is for
**Screen:** Live field view. **Files:** `app/src/styles.css:1171-1190` (`.benchgrid`, `max-height: 27vh`), `app/src/screens/Live.tsx:382-412`.

**Observed (my capture, 375×667, 7v7 with 14 in the squad, 7 on the bench).** `.benchgrid` measures **375×173 — 26% of the viewport** across two rows, leaving the pitch 380px (57%). Every one of the seven bench rings is the same saturated red (see F1), so 26% of the screen is spent on seven identical circles.

**Why it matters.** 14 kids at 7v7 is the stated target case — the brief's "7–14 kids". This is the configuration where the pitch is most squeezed and the bench conveys least.

**Recommendation.** Cap the bench at a single row of the 3–4 most-owed with a "+3 more" chip that expands, or shrink bench shirts to 36px once the count exceeds five. Reclaim the height for the pitch, where the tap targets actually need it.

---

### F13 — LOW — Undo occupies the best button real estate and says nothing about what it will undo
**Screen:** Live. **Files:** `app/src/screens/Live.tsx:438-441`.

**Observed.** `↩ Undo` sits bottom-right (x=251, y=619) — for a right-handed one-handed grip, the single easiest target on the phone. It is a bare label; it does not say what will be undone, and there is no confirmation after it fires (compare `se-9-24-list-view.png` → `se-9-25-after-undo.png`: the only difference is state, with no message). It pops the last event whatever that is — a goal, a sub, a period start.

**Why it matters.** Prime thumb position + no preview + no confirmation is a bad combination for the one control that mutates history. A coach who taps it twice believing the first didn't register removes two events.

**Recommendation.** Label it with its target — `↩ Undo sub` / `↩ Undo goal` — and pair it with the F4 toast ("Undid: Kit on, Ana off"). Consider swapping its position with the pause control per F2.

---

### F14 — HIGH — Nothing happens when the half runs past its configured length
**Screen:** Live gamebar. **Files:** `app/src/screens/Live.tsx:264-277`, `core/src/clock.ts` (`clockAt`/`formatClock`).

**Observed (Playwright probe against the live build at 375×667, half length set to 1 min, run to 1:06).** At six seconds past full time the clock reads `1:06` with `class="time"` — no `paused`/overrun modifier — colour still `rgb(232,240,245)`, meta still `1H · 0–0`, no banner, nothing. It counts serenely past the end of the half forever. `m375-9-44-past-full-time.png` shows the same: a clock past the configured length, styled exactly like a clock at 0:30.

**Why it matters.** In youth soccer the coach frequently *is* the timekeeper, or is at least the one who has to know when to expect the whistle so the last rotation lands before the half ends. The app is told the half length at setup (`2 × 30 min`, shown in the header of `se-9-08-setup-empty.png`) and then never uses it for anything the coach can see. A coach glancing at a big white `31:42` has no way to tell whether that is fine or four minutes into a half that should have ended.

**Recommendation.** At the configured length, flip the clock to `--warn` and switch the meta line to a count-*up* overrun (`1H · +1:42 · 0–0`). Ideally count **down** to full time by default — that is what a coach actually wants to know, and it is what most match-clock apps do.

---

### F15 — HIGH — On a small phone the setup pitch hides every position label, so the empty slots are indistinguishable
**Screen:** Setup (starting lineup). **Files:** `app/src/styles.css:899-909` (`@container (max-height: 360px) { .token .tname { display:none } }`), `app/src/Pitch.tsx:199-204`.

**Observed (probe at 375×667).** The setup pitch measures **261×337**, which trips the `max-height: 360px` container query. Computed style of `.token .vacantlabel` is **`display: none`** — its text content is `"GK · GK"` but it is not rendered. Confirmed visually in `se-9-08-setup-empty.png` and `se-7-08-setup-empty.png`: nine identical dashed circles containing only `+`, with no indication which is the keeper, which is the striker, which is left back.

The container query was written to stop *names* colliding on a crowded live pitch (the comment at `styles.css:894-898` says exactly that) — but `.vacantlabel` is a `.tname`, so it disappears with them. The live view keeps its labels because the full-bleed pitch is taller than 360px; the setup view, which is the one that needs them, does not.

Minor, same area: the label composes as `"GK · GK"` for the goalkeeper — code and role are the same token, so it reads as a stutter.

**Why it matters.** Building a lineup is the pre-game task done while parents are talking at you and the warm-up is running. "Put Ana in goal" becomes: tap a circle, read the sheet title to find out which position you just tapped, back out, tap another. That is a 30-second task turned into two minutes.

**Recommendation.** Scope the container query to occupied tokens only (`.token:not(.vacant) .tname`) — empty slots have no shirt number, so the code is the *only* identifying information they carry and must never be dropped. De-dupe the keeper label to just `GK`.

---

### F16 — MEDIUM — The setup bench is a horizontally scrolling strip with no scroll affordance; 61% of the squad is off-screen
**Screen:** Setup. **Files:** `app/src/styles.css:920-930` (`.benchstrip`, `overflow-x:auto`, `scrollbar-width:none`, `::-webkit-scrollbar{display:none}`).

**Observed (probe, 375×667, 12-player squad).** `.benchstrip` `scrollWidth: 906` vs `clientWidth: 351` — **only 39% of the bench is visible**, and there is no scrollbar (explicitly hidden), no fade mask, no chevron. The sole cue that more exists is that the fifth name happens to be cut mid-word: `se-9-08-setup-empty.png` shows `Eli Van` truncated at the right edge.

Contrast this with the *live* screen, which correctly uses a wrapping `.benchgrid` (`styles.css:1171`) precisely so "a full squad is visible at once" — the right decision, made on one screen and not the other.

**Why it matters.** Assigning a lineup means finding specific children by name. A hidden horizontal scroll means the coach flicks blindly to find "Lou", and cannot see at a glance who is still unassigned.

**Recommendation.** Use the same wrapping grid the live screen uses. If the strip must stay, add an edge fade and a count ("12 available →").

---

### F17 — MEDIUM — The setup screen's primary button is a disabled status label at 2.17:1, while the real action is styled as secondary
**Screen:** Setup action bar. **Files:** `app/src/screens/Setup.tsx` (action bar), `app/src/styles.css` (`.btn.primary`, `:disabled`).

**Observed (probe).** Two 173×60 buttons. Left: **"Fill rest"**, enabled, `--surface-2` grey. Right: **"Pick 9 more"**, `disabled: true`, `--accent` fill at `opacity: 0.4`. Composited, its label is **2.17:1** against its own fill and the fill is **2.24:1** against the page — see `se-9-08-setup-empty.png`, where "Pick 9 more" reads as a smear.

So the largest, greenest, most visually primary element on the screen is (a) not a control, (b) a restatement of the heading directly above it ("STARTING LINEUP · 0 OF 9"), and (c) illegible. The one-tap action a coach actually wants — auto-fill the lineup — is the quiet grey one on the left.

**Why it matters.** The eye lands on green-and-large. On this screen green-and-large is dead. Meanwhile "Fill rest" solves the whole screen in one tap and looks optional.

**Recommendation.** Make **Fill rest** the primary, put the remaining count in the heading only, and replace the right-hand button with the real next step — `Start game`, disabled until the lineup is complete, so the bar shows a stable "get me to the game" target throughout.

---

### F18 — MEDIUM — Summary: last row clipped by the action bar; the fairness banner alarms on meaningless samples
**Screen:** Summary. **Files:** `app/src/screens/Summary.tsx`, `core/src/stats.ts:306-317` (`fairnessIndex`).

**Observed.** `se-9-28-summary-top.png`: the last visible row ("Bea Okonjo / LB 0:08") is sliced horizontally by the `Copy summary / Export CSV` bar — the same missing bottom scroll padding as F7. And a full-width `--danger`-tinted banner announces **"Playing-time fairness: 20%"** on a game that has been running for eight seconds; `fairnessIndex` is `min/max` with no minimum-sample guard (`stats.ts:311-316`), so it will read catastrophically red for the whole first half of every real match, when the spread between a starter and a late sub is *supposed* to be large.

**Why it matters.** This is the number a coach might show a parent. A metric that reads "20% — failing" during normal play trains the coach to ignore the banner, which destroys its value at full time when it is actually meaningful.

**Recommendation.** Suppress or grey the banner until the game is `final` (or until >50% of scheduled time has elapsed); at full time keep it prominent. Add `padding-bottom` to the scroll pane.

---

### F19 — LOW — The score is the smallest text on the game screen
**Screen:** Live gamebar. **Files:** `app/src/styles.css:1120-1127` (`.gclock .meta`).

**Observed.** `1H · 0–0` renders at **11px/700, uppercase, letter-spacing .08em, `--muted`** (5.96:1 — contrast is fine, size is not), directly under a 30px/800 clock. In `se-9-14-live-running.png` the score is smaller than the player names on the pitch.

**Why it matters.** "What's the score?" is the most common question a coach is asked from the sideline, and this app is where the answer lives. It also carries the paused indicator ("STOPPED", see F3) and the period, so three distinct pieces of state share the smallest type on the screen.

**Recommendation.** Split them: score at 15–17px in `--text` next to or under the clock; period as a small pill; paused state expressed as colour on the clock plus a field-level treatment rather than a word at 11px.

---

### F20 — LOW — Craft notes
- **Time labels are unlabelled numbers.** `0:02` under a token, `0:00` under a bench chip, `0:08` in a summary bar — nothing says whether that is time played this stint, this half, or the whole game (it is total played, `Live.tsx:139`). On the bench the number is always minutes-played, which reads as "how long they have been sitting" to a first-time user. One word ("played") in the section header would fix it.
- **`ends 13:16 over`** (list view, `se-7-24-list-view.png`) is unparseable as English. It appears to mean "if this player stays on, they finish 13:16 over their fair share". Rewrite as `+13:16 if left on`.
- **`--danger #e5484d` on `--surface` = 4.10:1** — below AA for the 14–16px text it is used for (Delete game, error banners).
- **Own stated rules broken only on the game screen.** `styles.css:1-8` promises "touch targets no smaller than 44px" and `--tap: 48px`; the game screen ships 38px (`.gstop`), 40px (`.gbtn`) and 42px (`.actions.slim .btn`). Every other screen honours it (`.prow` min-height 56, sheet buttons 48, setup buttons 60).
- **Empty states are good.** `se-9-XX-00-home-empty.png` and the "Everyone is on the field." / "Nobody is on the bench." strings are appropriately plain and specific — no complaint here.
- **Tabular numerals throughout** (`.num`, `font-variant-numeric: tabular-nums` on every clock and time) is exactly right and worth keeping; the clock does not jitter, which is rare in this category.

## 3. Competitive comparison

**Caveat on evidence quality.** Direct fetches of App Store / Play Store listings and the vendors' own sites (`subtimeapp.com`, `smartsubs.app`, `fairsub.app`, Play Store) all returned **HTTP 403** through the proxy, so this section rests on search-result summaries rather than first-hand reading of screenshots and full review text. Treat the feature claims as directional, and the review sentiment as thin. I have flagged where I am confident versus inferring.

### The market SubTime is entering

The category is crowded and has consolidated around one job: *tell me who to sub and when, so every kid gets fair minutes*. The incumbents are **SubTime: Game Management** (the original this is modelled on — "over 300,000 games served, trusted by more than 50,000 coaches"), **SubNow**, **Soccer Subs**, **SmartSubs**, **FairSub**, **CoachAny**, **Pitch Planner**, plus the general team-admin apps **TeamSnap** and **Spond** which barely address this at all.

### Where SubTime (this app) is ahead

- **Event-sourced, editable history.** The `Modify events` screen and a real undo stack are unusual. Most competitors let you sub and that is that; correcting a mis-tap means restarting or living with bad numbers. This is a genuine differentiator and it is well built.
- **Drag-to-sub and drag-to-reposition on a real pitch.** The original SubTime advertises dragging *unoccupied positions* to build custom formations; this app additionally lets you drag a live player from the pitch to the bench or onto another player to swap. That is a superset.
- **Full-bleed pitch as the interface.** Giving 57–65% of the screen to the field, with the bench directly beneath it in thumb reach, is the right architecture and better than the list-first designs several competitors use.
- **PWA / offline-first, no account, no subscription.** Every named competitor is a store app; several gate rotation planning behind a purchase. For a volunteer coach this matters.
- **Craft details competitors mostly miss:** tabular numerals so the clock does not jitter, `dvh` sizing so Safari's toolbars do not eat the action bar, wake lock during a game, and a page that never scrolls.

### Where SubTime is behind

1. **No sub *recommendation* surfaced.** This is the biggest gap and it is unanimous across the category. Soccer Subs: "tells you exactly when **and who** to sub… smart substitution recommendations." SubNow: "see exactly **who's on and off next**, and **confirm each substitution** as you go." SmartSubs: "players knowing exactly who they are subbing in for, when to get ready and what position." SubTime-the-original: "generate an automatic rotation to ensure all players get equal playing time." This app *computes* the answer (`core/src/stats.ts` exports `suggestSubs`) and never shows it (F8). Competitors treat "who" as the headline feature; here it is a hidden sort order behind an invisible ring.

2. **No pre-planned rotation.** SubNow and SmartSubs generate a substitution *plan* before kick-off, so the coach is confirming a schedule rather than making decisions under pressure. SubTime is purely reactive: every sub is an improvised decision on the touchline. For the target user — a volunteer, not a tactician — a plan they merely approve is a much lower cognitive load.

3. **Alerting is a generation behind.** FairSub: "**Sounds, haptics and a lock-screen notification** tell you when it's time to sub." SubNow: an audio "**Prepare Subs**" warning *ahead* of the rotation, so the bench can get ready. SmartSubs shows the bench a countdown. SubTime has a bare 880 Hz WebAudio double-beep (`components.tsx:239`) and a low-contrast pill in the worst corner of the screen (F9). No haptics, no notification, no advance warning, no way for a bench kid to see it coming. As a PWA it cannot do lock-screen notifications easily — but `navigator.vibrate` and a full-width in-app takeover are both free.

4. **Count-up only.** Competitors emphasise countdowns to the next rotation and to full time. SubTime counts up and gives no signal at all when the configured half length passes (F14). This is the kind of thing that reads as unfinished rather than opinionated.

5. **No shift timer.** A reviewer of Soccer Subs specifically asked for "viewing **shift length** for players on the field alongside total game time." SubTime shows only cumulative total (`Live.tsx:139`, `stats.playedMs`). "How long has this kid been on *this stint*" is the question that drives the next sub; total minutes is the question that settles the post-game parent conversation. SubTime answers the second and not the first.

6. **Fairness is shown as a colour, not a number.** Competitors lean on explicit ordering and countdowns. SubTime's only in-game fairness display is the heat ring, which measures 1.04–1.76:1 against the pitch (F1).

### Where the whole category struggles, and SubTime should not copy it

- **Complexity is the number-one complaint against the original SubTime**: coaches ask that it "keep things simple and not over-complicate features, as too much complexity makes it impossible to use in the heat of the game." SubTime-the-clone is currently *simpler* than the original and should protect that. The recommendations in this review are deliberately about removing ambiguity (F5, F14), not adding screens.
- **TeamSnap and Spond are not competitors here.** TeamSnap users report the mobile app is "clunky", "difficult to read header information", and — decisively — that "availability doubles as attendance… if coaches need to look back and see who actually played, there's **no reliable record**." SubTime's event log and CSV export beat both outright on this axis. That is a positioning opportunity, not a design problem.

**Net read on positioning.** SubTime's engine and data model are ahead of the category; its *in-game glanceability* is behind it. Everything in the "behind" list above is a presentation change on top of data the app already has.

Sources: [SubTime: Game Management (App Store)](https://apps.apple.com/us/app/subtime-game-management/id1248650528), [SubTime (Google Play)](https://play.google.com/store/apps/details?id=com.gametimes&hl=en_US), [subtimeapp.com](https://www.subtimeapp.com/), [Soccer Subs (App Store)](https://apps.apple.com/us/app/soccer-subs/id6758869521), [SubNow](https://www.subnowapp.com/), [SmartSubs](https://smartsubs.app/), [FairSub](https://fairsub.app/), [Pitch Planner — best youth soccer substitution apps](https://pitch-planner.app/blog/best-youth-soccer-substitution-apps/), [TeamSnap reviews (Capterra)](https://www.capterra.com/p/123208/TeamSnap/reviews/), [Spond alternatives (G2)](https://www.g2.com/products/spond/competitors/alternatives)

## 4. The three changes worth doing first

Ranked by impact on a coach standing on a touchline, not by effort.

### 1. Make "who goes on next" a legible instruction instead of a colour
*(fixes F1, F8, F9 — the app's whole reason to exist)*

Today the answer is a 3px ring at **1.04–1.76:1** against the pitch, on a red↔green hue axis, from a scale that saturates so hard that every starter is identical green and every substitute identical red for most of the match. Meanwhile `suggestSubs` sits unused in `core`.

Do three things: put a **"Next on: Kit, Lou"** line above the bench; label the shift alarm with names (**"Shift due — sub Kit and Lou"**) and escalate it into the bottom action bar where the thumb and eye already are; and re-base the heat ramp on the *live spread* rather than a fixed ±10 min so the ring discriminates during play. Nothing here needs new data — the engine already computes all of it.

**Why first:** every other finding is about making a task safer or clearer. This one is about the app actually answering the question it was built to answer. A coach who cannot get the answer in two seconds stops opening the app.

### 2. Move the clock to the thumb, and confirm every action
*(fixes F2, F4, F5, F13, and half of F3)*

Right now: pause/resume, end-half and the menu are all in the top 50px of the screen (`.gplay` 44px at y=7, `.gstop` **38px** at y=10, 4px apart); the thumb zone is spent on `⚽ Us / ⚽ Them / ↩ Undo` at 42px; a completed sub produces **no toast, no haptic, no sound, no live region**; and `Sub 1 ↔ 0` — which silently plays the team a man short — is styled identically to a normal swap.

Swap the priorities. Pause/resume becomes a ≥56px control in the bottom bar. `⚽ Them` demotes. Every state change fires a 1.5s bottom toast plus a haptic — "**Kit Larsen on · Ana Ruiz off**", "**Undid: goal, Bea Okonjo**". `Sub N ↔ 0` relabels to state its consequence ("Take Ana off — play 6") in a warning treatment. `End half` moves out of the transport cluster.

**Why second:** this is the difference between an app you can use without looking and one you have to stop and read. The mis-tap costs here — a half ended by accident, a sub that never registered, a team playing short — are match consequences, not data-quality ones. It is also mostly layout and copy, not new capability.

### 3. Fix the four things that make it read as unfinished
*(F14, F15, F7, F17)*

Four defects that a coach will hit in the first ten minutes of the first game and that each take under an hour:

- **The half runs past full time with no signal at all** (probed: 1:06 into a 1:00 half, clock still plain white, meta still `1H · 0–0`). Turn it amber and show the overrun.
- **The setup pitch hides every position label on a small phone** — the `@container (max-height: 360px)` rule at `styles.css:899` kills `.vacantlabel` along with player names, so building a lineup on an iPhone SE means tapping nine identical dashed circles to find out which is the keeper. Scope the rule to `.token:not(.vacant)`.
- **The live list view has no gutter** — headings clip against the bezel, and the last row is sliced by the action bar. Add `padding: 0 var(--pad)` and bottom padding. Same fix on the summary pane.
- **The setup screen's primary button is a disabled label at 2.17:1** ("Pick 9 more") while the actual one-tap action ("Fill rest") is styled as secondary. Invert them.

**Why third:** none of these change what the app can do, but they are the four moments where it visibly stops looking like a finished product. Everything else in this review is a judgement call about hierarchy; these four are just wrong.

---

### What not to change

The dark palette, the full-bleed vertical pitch, the bench directly under the thumb, the event log with real undo, the wake lock, the tabular numerals, the never-scrolling page, and the plain-spoken empty states are all correct and better than most of the category. The problems are almost entirely in *signalling* — what the coach can perceive in two seconds — not in structure.
