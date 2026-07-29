import { fairnessIndex, reduce } from '@touchline/core';
import { useMemo } from 'react';
import { seasonStats } from './season';
import { useDashboard } from './useDashboard';

/** "CM 42m · LB 8m", longest total spell first — same as Season.tsx. */
const byPosition = (msByPosition: Record<string, number>): string =>
  Object.entries(msByPosition)
    .sort((a, b) => b[1] - a[1])
    .map(([code, ms]) => `${code} ${Math.round(ms / 60_000)}m`)
    .join(' · ');

function useToken(): string | null {
  return useMemo(() => new URLSearchParams(window.location.search).get('t'), []);
}

export function App() {
  const token = useToken();
  const result = useDashboard(token);

  if (result.status === 'not-configured') {
    return (
      <div className="page">
        <div className="empty">
          This dashboard isn't configured — it's missing its Supabase URL/key
          at build time.
        </div>
      </div>
    );
  }
  if (result.status === 'no-token') {
    return (
      <div className="page">
        <div className="empty">
          This link is missing its token. Ask the coach for the link from
          Team settings → Coaches dashboard.
        </div>
      </div>
    );
  }
  if (result.status === 'loading') {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (result.status === 'error') {
    return (
      <div className="page">
        <div className="empty">
          Couldn't load this dashboard — the link may be wrong, or the coach
          may have turned it off. ({result.message})
        </div>
      </div>
    );
  }

  const { snapshot } = result;
  const { team, games } = snapshot;
  const { rows, gameCount } = seasonStats(snapshot);
  const sorted = [...rows].sort((a, b) => b.playedMs - a.playedMs);
  const nameOf = new Map(snapshot.players.map((p) => [p.id, p.name]));
  const numberOf = new Map(snapshot.players.map((p) => [p.id, p.number]));
  const maxMs = Math.max(1, ...sorted.map((r) => r.playedMs));

  const startedGames = [...games]
    .filter((g) => g.status !== 'setup')
    .sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime());
  const eventsByGame = new Map<string, typeof snapshot.events>();
  for (const e of snapshot.events) {
    const list = eventsByGame.get(e.game_id) ?? [];
    list.push(e);
    eventsByGame.set(e.game_id, list);
  }

  return (
    <div className="page">
      <h1>{team.name}</h1>
      <p className="muted">
        {team.age_group ? `${team.age_group} · ` : ''}
        {gameCount} game{gameCount === 1 ? '' : 's'} this season
      </p>

      <h2>Season stats</h2>
      {sorted.length === 0 ? (
        <div className="empty">No games played yet this season.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th>GP</th>
                <th>Min</th>
                <th>Positions</th>
                <th>G</th>
                <th>A</th>
                <th>+/&minus;</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    {numberOf.get(r.playerId) && (
                      <span className="small muted">#{numberOf.get(r.playerId)} </span>
                    )}
                    {nameOf.get(r.playerId) ?? r.playerId}
                  </td>
                  <td>{r.games}</td>
                  <td>{Math.round(r.playedMs / 60_000)}</td>
                  <td style={{ textAlign: 'left' }}>{byPosition(r.msByPosition) || '—'}</td>
                  <td>{r.goals || ''}</td>
                  <td>{r.assists || ''}</td>
                  <td>{r.plusMinus > 0 ? `+${r.plusMinus}` : r.plusMinus || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Minutes this season</h2>
      <div className="card">
        {sorted.map((r) => (
          <div className="bar-row" key={r.playerId}>
            <span className="small">{nameOf.get(r.playerId) ?? r.playerId}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${(r.playedMs / maxMs) * 100}%` }}
              />
            </span>
            <span className="small muted" style={{ textAlign: 'right' }}>
              {Math.round(r.playedMs / 60_000)}m
            </span>
          </div>
        ))}
      </div>

      <h2>Games</h2>
      {startedGames.length === 0 ? (
        <div className="empty">No games played yet.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opponent</th>
                <th>Fairness</th>
              </tr>
            </thead>
            <tbody>
              {startedGames.map((game) => {
                const events = (eventsByGame.get(game.id) ?? [])
                  .slice()
                  .sort((a, b) => a.seq - b.seq)
                  .map((e) => e.payload);
                const { state } = reduce(events, game.config, game.id);
                const index = fairnessIndex(state, Date.now());
                return (
                  <tr key={game.id}>
                    <td style={{ textAlign: 'left' }}>
                      {new Date(game.kickoff_at).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'left' }}>vs {game.opponent || 'TBD'}</td>
                    <td>{Math.round(index * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="small muted" style={{ marginTop: 24 }}>
        Updates automatically — this page checks for new games every 20
        seconds while it's open.
      </p>
    </div>
  );
}
