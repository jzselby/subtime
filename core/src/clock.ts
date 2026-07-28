import type { GameState } from './reducer.js';

/**
 * Clock derivation.
 *
 * Nothing here ticks. Every reading is computed from an anchor timestamp against
 * the wall clock at the moment you ask, which is why a suspended tab, a locked
 * phone, or a backgrounded PWA costs nothing — and why the classic "background
 * timers are unreliable on iOS" objection does not apply to this design.
 */

/** Clock position within the current period, live as of `nowWallTs`. */
export function clockAt(state: GameState, nowWallTs: number): number {
  if (!state.anchor) return state.clockMs;
  return state.anchor.clockMs + Math.max(0, nowWallTs - state.anchor.wallTs);
}

/** Total game time elapsed across all periods, live as of `nowWallTs`. */
export function elapsedGameMs(state: GameState, nowWallTs: number): number {
  let total = 0;
  for (let p = 1; p < state.period; p++) total += state.periodElapsedMs[p - 1] ?? 0;
  if (state.period > 0) {
    total +=
      state.status === 'break' || state.status === 'final'
        ? (state.periodElapsedMs[state.period - 1] ?? state.clockMs)
        : clockAt(state, nowWallTs);
  }
  return total;
}

/** Regulation time left in the current period. Zero once a period runs over. */
export function remainingInPeriodMs(state: GameState, nowWallTs: number): number {
  if (state.period === 0) return state.config.periods.lengthMs;
  if (state.status === 'final') return 0;
  if (state.status === 'break') return 0;
  return Math.max(0, state.config.periods.lengthMs - clockAt(state, nowWallTs));
}

/** Regulation time left in the whole game, across all remaining periods. */
export function remainingInGameMs(state: GameState, nowWallTs: number): number {
  const { count, lengthMs } = state.config.periods;
  if (state.status === 'final') return 0;
  const periodsNotStarted = Math.max(0, count - Math.max(state.period, 0));
  return periodsNotStarted * lengthMs + remainingInPeriodMs(state, nowWallTs);
}

/*
 * There is deliberately no "continuous match clock" helper here.
 *
 * One existed and padded each earlier period by its *configured* length, so a
 * half that ended early — a tournament game, a referee cutting it short —
 * jumped the clock forward by the difference: four seconds played, second half
 * opening at 30:01. Periods do not reliably run their configured length, so the
 * only honest running total is `elapsedGameMs`, which sums what was actually
 * played. Screens show the period clock next to the period label instead.
 */

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
