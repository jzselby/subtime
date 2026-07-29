import { useEffect, useState } from 'react';
import { configured, supabase } from './supabase';
import type { DashboardSnapshot } from './types';

export type DashboardResult =
  | { status: 'loading' }
  | { status: 'not-configured' }
  | { status: 'no-token' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: DashboardSnapshot };

const POLL_MS = 20_000;

/**
 * There's a real security reason this polls `get_team_dashboard` rather than
 * subscribing to Postgres Realtime on `game_events`/`games` directly:
 * `postgres_changes` payloads aren't scoped by the RLS-denying policies on
 * those tables unless "Realtime RLS" (private channels) is set up, which
 * needs its own auth model this app doesn't have — a coach viewing one
 * team's dashboard could otherwise receive *every* team's raw insert/update
 * payloads over the wire. The RPC is the one thing here that's actually
 * scoped to a single team, so re-calling it is the safe way to get updates
 * without shipping that gap. Real push can follow later via Supabase's
 * "Broadcast from Database", which is built for exactly this.
 */
export function useDashboard(token: string | null): DashboardResult {
  const [result, setResult] = useState<DashboardResult>(
    !configured ? { status: 'not-configured' } : token ? { status: 'loading' } : { status: 'no-token' },
  );

  useEffect(() => {
    if (!configured || !supabase || !token) return;
    const client = supabase;

    let cancelled = false;

    const load = async () => {
      const { data, error } = await client.rpc('get_team_dashboard', { token });
      if (cancelled) return;
      if (error) {
        setResult({ status: 'error', message: error.message });
        return;
      }
      if (!data) {
        setResult({ status: 'error', message: 'No dashboard found for this link.' });
        return;
      }
      setResult({ status: 'ready', snapshot: data as DashboardSnapshot });
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
