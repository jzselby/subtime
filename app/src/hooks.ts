import type { EventInput, GameConfig, GameEvent, GameState, ReduceResult } from '@subtime/core';
import { appendEvent, reduce } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';

/**
 * Re-render on an interval so live clocks advance.
 *
 * Note what this does *not* do: it does not drive the clock. Time comes from the
 * fold against `Date.now()` on every read, so a missed tick — a backgrounded
 * tab, a locked phone, a throttled timer — costs nothing but a stale pixel. The
 * interval only decides how often the display refreshes.
 */
export function useNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    // Browsers throttle timers in background tabs; catch up the instant we
    // become visible again rather than waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);

  return now;
}

/**
 * Hold a screen wake lock while a game is running. Re-acquires on visibility
 * change, since the lock is dropped whenever the page is hidden.
 */
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        lockRef.current = await navigator.wakeLock.request('screen');
      } catch {
        // Denied or unsupported — the game still works, the screen just sleeps.
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}

export interface UseGameLog extends ReduceResult {
  events: GameEvent[];
  loading: boolean;
  /** Stamp an input against current state, persist it, and re-fold. */
  record: (input: EventInput, wallTs?: number) => Promise<void>;
  /** Append several events in one transaction, each folded onto the last. */
  recordMany: (inputs: EventInput[], wallTs?: number) => Promise<void>;
  /** Drop the most recent event. The event log makes undo this cheap. */
  undo: () => Promise<void>;
}

/**
 * Load a game's event log, fold it, and expose an append-and-refold action.
 *
 * The log is the source of truth and `state` is always derived — never patched
 * in place. Recording an event is: stamp, persist, re-fold.
 */
export function useGameLog(gameId: string | undefined, config: GameConfig): UseGameLog {
  const events = useLiveQuery(
    async () =>
      gameId
        ? db.events
            .where('[gameId+seq]')
            .between([gameId, Dexie_MIN], [gameId, Dexie_MAX])
            .toArray()
        : [],
    [gameId],
  );

  const loading = events === undefined;
  const log = useMemo(() => events ?? [], [events]);

  const folded = useMemo<ReduceResult>(
    () => reduce(log, config, gameId ?? 'game'),
    [log, config, gameId],
  );

  const recordMany = useCallback(
    async (inputs: EventInput[], wallTs: number = Date.now()) => {
      if (!gameId || inputs.length === 0) return;
      // Re-fold from storage inside the write so two rapid taps cannot both
      // stamp the same `seq`.
      await db.transaction('rw', db.events, async () => {
        const current = await db.events
          .where('[gameId+seq]')
          .between([gameId, Dexie_MIN], [gameId, Dexie_MAX])
          .toArray();
        const batch: GameEvent[] = [];
        for (const input of inputs) {
          // Fold each new event onto the previous one so `seq` and the derived
          // clock stay correct across the batch.
          const { state } = reduce([...current, ...batch], config, gameId);
          batch.push(appendEvent(state, input, wallTs));
        }
        await db.events.bulkAdd(batch);
      });
    },
    [gameId, config],
  );

  const record = useCallback(
    (input: EventInput, wallTs?: number) => recordMany([input], wallTs),
    [recordMany],
  );

  const undo = useCallback(async () => {
    if (!gameId) return;
    await db.transaction('rw', db.events, async () => {
      const last = await db.events
        .where('[gameId+seq]')
        .between([gameId, Dexie_MIN], [gameId, Dexie_MAX])
        .last();
      if (last) await db.events.delete(last.id);
    });
  }, [gameId]);

  return { ...folded, events: log, loading, record, recordMany, undo };
}

// Dexie range sentinels for the [gameId+seq] compound index.
const Dexie_MIN = -Infinity;
const Dexie_MAX = Infinity;

export type { EventInput, GameState };
