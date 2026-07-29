import { elapsedGameMs, playerStats } from '@pitchside/core';
import { byPositionClock, mmss } from './format';
import { periodOffsets, stintDurationMs, stintEndMs, type GameSummary } from './games';
import type { DashboardPlayer } from './types';

const RESULT_LABEL: Record<'W' | 'L' | 'D', string> = { W: 'Win', L: 'Loss', D: 'Draw' };

export function GameView({
  summary,
  players,
  onBack,
}: {
  summary: GameSummary;
  players: DashboardPlayer[];
  onBack: () => void;
}) {
  const { game, state, result, fairness } = summary;
  const now = Date.now();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  const stats = playerStats(state, now).filter((s) => state.attendance.get(s.playerId) !== 'absent');
  const byMinutes = [...stats].sort((a, b) => b.playedMs - a.playedMs);
  const maxMs = Math.max(1, ...byMinutes.map((s) => s.playedMs));
  const scorers = stats
    .filter((s) => s.goals > 0 || s.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists);

  const offsets = periodOffsets(state);
  const timelineTotal = Math.max(1, elapsedGameMs(state, now));

  return (
    <>
      <button className="link-back" onClick={onBack}>
        ← Season
      </button>

      <h1>
        {state.score.us}–{state.score.them} vs {game.opponent || 'TBD'}
      </h1>
      <p className="muted">
        {new Date(game.kickoff_at).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
        {result && <span className={`result-chip ${result.toLowerCase()}`}>{RESULT_LABEL[result]}</span>}
        {!result && game.status === 'live' && <span className="result-chip live">In progress</span>}
      </p>

      {scorers.length > 0 && (
        <>
          <h2>Goals and assists</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th style={{ width: '1%' }}>G</th>
                  <th style={{ width: '1%' }}>A</th>
                </tr>
              </thead>
              <tbody>
                {scorers.map((s) => (
                  <tr key={s.playerId}>
                    <td>{nameOf(s.playerId)}</td>
                    <td>{s.goals || ''}</td>
                    <td>{s.assists || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Playing time</h2>
      {byMinutes.length === 0 ? (
        <div className="empty">No playing time recorded for this game.</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <tbody>
              {byMinutes.map((s) => (
                <tr key={s.playerId}>
                  <td>
                    {nameOf(s.playerId)}
                    {s.positionsPlayed > 0 && (
                      <span className="small muted" style={{ display: 'block' }}>
                        {byPositionClock(s.msByPosition)}
                      </span>
                    )}
                  </td>
                  <td className="bar" style={{ width: '52%' }}>
                    <span style={{ width: `${(s.playedMs / maxMs) * 100}%` }} />
                    <em>{mmss(s.playedMs)}</em>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        className={`card meter ${fairness >= 0.8 ? 'good' : fairness >= 0.5 ? 'warning' : 'critical'}`}
        style={{ marginTop: 16 }}
      >
        <div className="meter-top">
          <span className="meter-label">Playing-time fairness</span>
          <span className="meter-value">{Math.round(fairness * 100)}%</span>
        </div>
        <span className="meter-track">
          <span className="meter-fill" style={{ width: `${Math.round(fairness * 100)}%` }} />
        </span>
        <span className="meter-caption">
          The least-played available player got {Math.round(fairness * 100)}% of the
          most-played player's minutes.
        </span>
      </div>

      {state.stints.length > 0 && (
        <>
          <h2>Who was on, when</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <div className="gantt">
              {byMinutes.map((s) => (
                <div key={s.playerId} className="grow-row">
                  <span className="glabel">{nameOf(s.playerId)}</span>
                  <span className="gtrack">
                    {state.stints
                      .filter((st) => st.playerId === s.playerId)
                      .map((st, i) => {
                        const start = (offsets[st.period - 1] ?? 0) + st.startMs;
                        const end = (offsets[st.period - 1] ?? 0) + stintEndMs(st, state, now);
                        return (
                          <span
                            key={i}
                            className="gseg"
                            title={`${st.position} ${mmss(stintDurationMs(st, state, now))}`}
                            style={{
                              left: `${(start / timelineTotal) * 100}%`,
                              width: `${Math.max(0.8, ((end - start) / timelineTotal) * 100)}%`,
                            }}
                          >
                            {st.position}
                          </span>
                        );
                      })}
                  </span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Each bar is one spell on the field. Labels show the position.
            </p>
          </div>
        </>
      )}
    </>
  );
}
