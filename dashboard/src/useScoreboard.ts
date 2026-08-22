import { useEffect, useState } from 'react';
import { configured, supabase } from './supabase';
import type { ScoreboardSnapshot } from './types';

export type ScoreboardResult =
  | { status: 'loading' }
  | { status: 'not-configured' }
  | { status: 'no-token' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: ScoreboardSnapshot };

const POLL_MS = 20_000;

/**
 * Same poll-based shape as useDashboard, and the same reason: RLS on
 * `games`/`teams` denies anon directly, so a live subscription would need
 * "Realtime RLS" this app doesn't set up — see useDashboard's own comment.
 * Kept as its own hook, not a parameterized version of useDashboard, because
 * the two call different RPCs against structurally different response
 * shapes — sharing the fetch/poll plumbing here would only save a few
 * lines at the cost of coupling two things (a coach's full dashboard, a
 * link meant to be handed out to any parent) that need to stay easy to
 * reason about separately.
 */
export function useScoreboard(token: string | null): ScoreboardResult {
  const [result, setResult] = useState<ScoreboardResult>(
    !configured ? { status: 'not-configured' } : token ? { status: 'loading' } : { status: 'no-token' },
  );

  useEffect(() => {
    if (!configured || !supabase || !token) return;
    const client = supabase;

    let cancelled = false;

    const load = async () => {
      const { data, error } = await client.rpc('get_team_scoreboard', { token });
      if (cancelled) return;
      if (error) {
        setResult({ status: 'error', message: error.message });
        return;
      }
      if (!data) {
        setResult({ status: 'error', message: 'No scoreboard found for this link.' });
        return;
      }
      setResult({ status: 'ready', snapshot: data as ScoreboardSnapshot });
    };

    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token]);

  return result;
}
