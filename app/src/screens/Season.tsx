import { aggregatePlayerStats, playerStats, reduce } from '@pitchside/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { mins, Screen } from '../components';
import { db } from '../db';
import { navigate } from '../router';

/** "CM 42m · LB 8m", longest total spell first, top 3. */
const byPosition = (msByPosition: Record<string, number>): string =>
  Object.entries(msByPosition)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, ms]) => `${code} ${mins(ms)}m`)
    .join(' · ');

/**
 * Season totals: one `playerStats()` fold per started game, summed by
 * `aggregatePlayerStats()`. No separate season table to keep in sync — a
 * team's games and their event logs are already the full record, so this is
 * a read, not new storage. Setup games are skipped; they haven't been played.
 */
export function SeasonScreen({ teamId }: { teamId: string }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId],
  );

  const season = useLiveQuery(async () => {
    const games = await db.games.where('teamId').equals(teamId).toArray();
    const started = games.filter((g) => g.status !== 'setup');
    const perGame = await Promise.all(
      started.map(async (game) => {
        const events = await db.events.where('gameId').equals(game.id).sortBy('seq');
        const { state } = reduce(events, game.config, game.id);
        return playerStats(state, Date.now()).filter(
          (s) => state.attendance.get(s.playerId) !== 'absent',
        );
      }),
    );
    return { rows: aggregatePlayerStats(perGame), gameCount: started.length };
  }, [teamId]);

  const nameOf = useMemo(() => {
    const map = new Map((players ?? []).map((p) => [p.id, p]));
    return (id: string) => map.get(id)?.name ?? id;
  }, [players]);
  const numberOf = (id: string) => players?.find((p) => p.id === id)?.number ?? '';

  if (!team || !season) return <Screen title="Loading…">{null}</Screen>;

  const rows = [...season.rows].sort(
    (a, b) => b.playedMs - a.playedMs || nameOf(a.playerId).localeCompare(nameOf(b.playerId)),
  );

  return (
    <Screen
      title="Season stats"
      subtitle={`${team.name} · ${season.gameCount} game${season.gameCount === 1 ? '' : 's'}`}
      onBack={() => navigate({ name: 'team', teamId })}
    >
      {rows.length === 0 ? (
        <div className="empty">No games played yet this season.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>GP</th>
                <th>Min</th>
                <th>G</th>
                <th>A</th>
                <th>Positions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    {numberOf(r.playerId) && (
                      <span className="small muted">#{numberOf(r.playerId)} </span>
                    )}
                    {nameOf(r.playerId)}
                  </td>
                  <td>{r.games}</td>
                  <td>{mins(r.playedMs)}</td>
                  <td>{r.goals || ''}</td>
                  <td>{r.assists || ''}</td>
                  <td style={{ textAlign: 'left' }}>{byPosition(r.msByPosition) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        Totals across every started game this season — minutes, goals and
        assists sum across appearances, and positions show combined minutes in
        each one played. GP counts games this player actually took the field
        for, not just attended.
      </p>
    </Screen>
  );
}
