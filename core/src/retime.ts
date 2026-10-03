import { formatClock } from './clock.js';
import { reduce } from './reducer.js';
import type { GameConfig, GameEvent } from './types.js';

/** Events that define the game's structure; moving them would redraw the halves themselves. */
const FIXED: ReadonlySet<GameEvent['type']> = new Set([
  'ATTENDANCE',
  'SET_LINEUP',
  'PERIOD_START',
  'PERIOD_END',
  'GAME_END',
  'CLOCK_PAUSE',
  'CLOCK_RESUME',
]);

export const canRetime = (e: GameEvent): boolean => !FIXED.has(e.type) && e.period >= 1;

export type RetimeResult =
  | {
      ok: true;
      /** Only the events whose clock or position in the log changed — what to write back. */
      changed: GameEvent[];
    }
  | { ok: false; reason: string };

/**
 * Move one event to a different moment within its own period — a sub tapped
 * two minutes late, a goal entered after the fact — and re-order the log so
 * it still reads in clock order.
 *
 * Nothing is recalculated by hand: the moved log is folded again, and the
 * change is refused if any event that applied before no longer does (subbing
 * off a player who, at the new time, isn't on yet, say). Minutes, positions,
 * the timeline and fairness then all follow from the corrected log exactly as
 * they do from a live one.
 *
 * The set of `seq` values is kept and reassigned in the new order, so nothing
 * else in the log changes identity and sync just sees updated rows.
 */
export function retimeEvent(
  events: readonly GameEvent[],
  eventId: string,
  newClockMs: number,
  config: GameConfig,
  gameId = events[0]?.gameId ?? 'game',
): RetimeResult {
  const log = [...events].sort((a, b) => a.seq - b.seq);
  const target = log.find((e) => e.id === eventId);
  if (!target) return { ok: false, reason: 'That event no longer exists.' };
  if (!canRetime(target)) return { ok: false, reason: 'This kind of event can’t be moved.' };

  const before = reduce(log, config, gameId);
  const periodEnd =
    before.state.periodElapsedMs[target.period - 1] ??
    (before.state.period === target.period ? before.state.clockMs : undefined);
  const t = Math.round(newClockMs);
  if (!Number.isFinite(t) || t < 0 || (periodEnd !== undefined && t > periodEnd)) {
    return {
      ok: false,
      reason:
        periodEnd !== undefined
          ? `Pick a time between 0:00 and ${formatClock(periodEnd)}.`
          : 'Pick a time from 0:00 up.',
    };
  }

  const rest = log.filter((e) => e.id !== eventId);
  const start = rest.findIndex((e) => e.type === 'PERIOD_START' && e.period === target.period);
  if (start < 0) return { ok: false, reason: 'That period has no start in the log.' };
  // After everything in this period at or before the new time, but always
  // ahead of the whistle that ends it.
  let at = start + 1;
  while (at < rest.length) {
    const e = rest[at]!;
    if (e.period !== target.period || e.type === 'PERIOD_END' || e.type === 'GAME_END') break;
    if (e.gameClockMs > t) break;
    at += 1;
  }

  const moved: GameEvent = {
    ...target,
    gameClockMs: t,
    wallTs: target.wallTs + (t - target.gameClockMs),
  };
  const seqs = log.map((e) => e.seq);
  const reordered = [...rest.slice(0, at), moved, ...rest.slice(at)].map((e, i) =>
    e.seq === seqs[i] ? e : { ...e, seq: seqs[i]! },
  );

  const after = reduce(reordered, config, gameId);
  const failedBefore = new Set(before.errors.map((e) => e.eventId));
  const broken = after.errors.find((e) => !failedBefore.has(e.eventId));
  if (broken) {
    return {
      ok: false,
      reason: `That time doesn’t fit the rest of the game — it would make a ${broken.type
        .toLowerCase()
        .replace('_', ' ')} invalid (${broken.reason}).`,
    };
  }

  const original = new Map(log.map((e) => [e.id, e]));
  const changed = reordered.filter((e) => {
    const o = original.get(e.id)!;
    return o.seq !== e.seq || o.gameClockMs !== e.gameClockMs;
  });
  return { ok: true, changed };
}
