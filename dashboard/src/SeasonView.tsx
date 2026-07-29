import { byPositionMinutes, mins } from './format';
import type { GameSummary, TeamRecord } from './games';
import { ResultsChart } from './ResultsChart';
import { seasonStats } from './season';
import type { DashboardSnapshot } from './types';

const RESULT_LABEL: Record<'W' | 'L' | 'D', string> = { W: 'W', L: 'L', D: 'D' };

export function SeasonView({
  snapshot,
  games,
  record,
  onSelectGame,
}: {
  snapshot: DashboardSnapshot;
  games: readonly GameSummary[];
  record: TeamRecord;
  onSelectGame: (gameId: string) => void;
}) {
  const { team } = snapshot;
  const { rows, gameCount } = seasonStats(snapshot);
  const sorted = [...rows].sort((a, b) => b.playedMs - a.playedMs);
  const nameOf = new Map(snapshot.players.map((p) => [p.id, p.name]));
  const numberOf = new Map(snapshot.players.map((p) => [p.id, p.number]));
  const maxMs = Math.max(1, ...sorted.map((r) => r.playedMs));
  const decided = record.wins + record.losses + record.draws;

  return (
    <>
      <h1>{team.name}</h1>
      <p className="muted">
        {team.age_group ? `${team.age_group} · ` : ''}
        {gameCount} game{gameCount === 1 ? '' : 's'} this season
      </p>

      {decided > 0 && (
        <div className="kpi-row">
          <div className="stat-tile">
            <span className="stat-label">Record</span>
            <span className="stat-value">
              {record.wins}-{record.losses}-{record.draws}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Games played</span>
            <span className="stat-value">{gameCount}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Goals for</span>
            <span className="stat-value">{record.goalsFor}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Goals against</span>
            <span className="stat-value">{record.goalsAgainst}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Goal diff</span>
            <span
              className={`stat-value${record.goalsFor - record.goalsAgainst > 0 ? ' good' : record.goalsFor - record.goalsAgainst < 0 ? ' critical' : ''}`}
            >
              {record.goalsFor - record.goalsAgainst > 0 ? '+' : ''}
              {record.goalsFor - record.goalsAgainst}
            </span>
          </div>
        </div>
      )}

      {games.length > 0 && (
        <>
          <h2>Results</h2>
          <ResultsChart games={games} />
        </>
      )}

      <h2>Season stats</h2>
      {sorted.length === 0 ? (
        <div className="empty">No games played yet this season.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th style={{ width: '1%' }}>GP</th>
                <th style={{ width: '1%' }}>Min</th>
                <th style={{ textAlign: 'left' }}>Positions</th>
                <th style={{ width: '1%' }}>G</th>
                <th style={{ width: '1%' }}>A</th>
                <th style={{ width: '1%' }}>+/&minus;</th>
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
                  <td>{mins(r.playedMs)}</td>
                  <td style={{ textAlign: 'left' }}>{byPositionMinutes(r.msByPosition) || '—'}</td>
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
              <span className="bar-fill" style={{ width: `${(r.playedMs / maxMs) * 100}%` }} />
            </span>
            <span className="small muted" style={{ textAlign: 'right' }}>
              {mins(r.playedMs)}m
            </span>
          </div>
        ))}
      </div>

      <h2>Games</h2>
      {games.length === 0 ? (
        <div className="empty">No games played yet.</div>
      ) : (
        <div className="card game-list">
          {games.map((g) => (
            <button key={g.game.id} className="game-row" onClick={() => onSelectGame(g.game.id)}>
              <span className="game-row-date">
                {new Date(g.game.kickoff_at).toLocaleDateString()}
              </span>
              <span className="game-row-opp">vs {g.game.opponent || 'TBD'}</span>
              <span className="game-row-score">
                {g.state.score.us}–{g.state.score.them}
              </span>
              {g.result && (
                <span className={`result-chip small ${g.result.toLowerCase()}`}>
                  {RESULT_LABEL[g.result]}
                </span>
              )}
              {!g.result && g.game.status === 'live' && (
                <span className="result-chip small live">Live</span>
              )}
              <span className="game-row-arrow">›</span>
            </button>
          ))}
        </div>
      )}

      <p className="small muted" style={{ marginTop: 24 }}>
        Updates automatically — this page checks for new games every 20
        seconds while it's open.
      </p>
    </>
  );
}
