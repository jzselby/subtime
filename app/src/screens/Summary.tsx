import { elapsedGameMs, fairnessIndex, formatClock, playerStats } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { mins, mmss, Screen } from '../components';
import { db } from '../db';
import { useGameLog, useNow } from '../hooks';
import { navigate } from '../router';

const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};

export function SummaryScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const team = useLiveQuery(
    async () => (game ? db.teams.get(game.teamId) : undefined),
    [game?.teamId],
  );
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const config = game?.config ?? DEFAULT_CFG;
  const { state, errors } = useGameLog(gameId, config);
  const now = useNow(state.status === 'running');
  const [copied, setCopied] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map((players ?? []).map((p) => [p.id, p]));
    return (id: string) => map.get(id)?.name ?? id;
  }, [players]);

  const stats = useMemo(
    () => playerStats(state, now).filter((s) => state.attendance.get(s.playerId) !== 'absent'),
    [state, now],
  );

  if (!game || !team) return <Screen title="Loading…">{null}</Screen>;

  const elapsed = elapsedGameMs(state, now);
  const maxMs = Math.max(1, ...stats.map((s) => s.playedMs));
  const index = fairnessIndex(state, now);
  const byMinutes = [...stats].sort((a, b) => b.playedMs - a.playedMs);

  // Where each period begins on a single continuous timeline.
  const offsets = state.periodElapsedMs.reduce<number[]>((acc, ms, i) => {
    acc.push((acc[i - 1] ?? 0) + (i === 0 ? 0 : (state.periodElapsedMs[i - 1] ?? 0)));
    return acc;
  }, []);
  const timelineTotal = Math.max(1, elapsed);

  const summaryText = () => {
    const lines = [
      `${team.name} ${state.score.us}–${state.score.them} ${game.opponent || 'Opponent'}`,
      new Date(game.kickoffAt).toLocaleDateString(),
      '',
      'Playing time:',
      ...byMinutes.map((s) => `  ${nameOf(s.playerId)} — ${mmss(s.playedMs)}`),
    ];
    const scorers = stats.filter((s) => s.goals > 0 || s.assists > 0);
    if (scorers.length) {
      lines.push('', 'Goals and assists:');
      for (const s of scorers) {
        const bits = [s.goals && `${s.goals}G`, s.assists && `${s.assists}A`].filter(Boolean);
        lines.push(`  ${nameOf(s.playerId)} — ${bits.join(' ')}`);
      }
    }
    lines.push('', `Playing-time fairness: ${Math.round(index * 100)}%`);
    return lines.join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const exportCsv = () => {
    const header = [
      'player', 'minutes', 'bench_minutes', 'positions', 'goals', 'assists',
      'plus_minus', 'shots', 'saves', 'stints',
    ];
    const rows = byMinutes.map((s) => [
      nameOf(s.playerId),
      (s.playedMs / 60_000).toFixed(1),
      (s.benchMs / 60_000).toFixed(1),
      Object.entries(s.msByPosition)
        .map(([pos, ms]) => `${pos}:${(ms / 60_000).toFixed(0)}`)
        .join(' '),
      s.goals, s.assists, s.plusMinus, s.shots, s.saves, s.stintCount,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${team.name}-vs-${game.opponent || 'game'}-${new Date(game.kickoffAt).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Screen
      title={`${state.score.us}–${state.score.them} vs ${game.opponent || 'TBD'}`}
      subtitle={`${team.name} · ${formatClock(elapsed)} played`}
      onBack={() =>
        navigate(
          state.status === 'final'
            ? { name: 'team', teamId: game.teamId }
            : { name: 'live', gameId },
        )
      }
      footer={
        <div className="actions">
          <button className="btn" onClick={() => void copy()}>
            {copied ? '✓ Copied' : 'Copy summary'}
          </button>
          <button className="btn" onClick={exportCsv}>
            Export CSV
          </button>
          {state.status !== 'final' && (
            <button className="btn primary" onClick={() => navigate({ name: 'live', gameId })}>
              Back to game
            </button>
          )}
        </div>
      }
    >
      {errors.length > 0 && (
        <div className="banner error">
          {errors.length} event{errors.length === 1 ? '' : 's'} in this game's log could
          not be applied, so these numbers may be incomplete.
        </div>
      )}

      <div className={`banner${index >= 0.8 ? ' ok' : ''}`}>
        <b>Playing-time fairness: {Math.round(index * 100)}%</b>
        <br />
        The least-played available player got {Math.round(index * 100)}% of the
        most-played player's minutes.
      </div>

      <h2>Playing time</h2>
      <div className="card">
        <table className="tbl">
          <tbody>
            {byMinutes.map((s) => (
              <tr key={s.playerId}>
                <td>{nameOf(s.playerId)}</td>
                <td className="bar" style={{ width: '55%' }}>
                  <span style={{ width: `${(s.playedMs / maxMs) * 100}%` }} />
                  <em>{mmss(s.playedMs)}</em>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.stints.length > 0 && (
        <>
          <h2>Who was on, when</h2>
          <div className="card">
            <div className="gantt">
              {byMinutes.map((s) => (
                <div key={s.playerId} className="grow-row">
                  <span className="glabel">{nameOf(s.playerId)}</span>
                  <span className="gtrack">
                    {state.stints
                      .filter((st) => st.playerId === s.playerId)
                      .map((st, i) => {
                        const start = (offsets[st.period - 1] ?? 0) + st.startMs;
                        const end =
                          (offsets[st.period - 1] ?? 0) +
                          (st.endMs ?? state.clockMs);
                        return (
                          <span
                            key={i}
                            className="gseg"
                            title={`${st.position} ${mmss(end - start)}`}
                            style={{
                              left: `${(start / timelineTotal) * 100}%`,
                              width: `${Math.max(0.8, ((end - start) / timelineTotal) * 100)}%`,
                            }}
                          >
                            {(end - start) / timelineTotal > 0.13 ? st.position : ''}
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

      <h2>Everything else</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Player</th>
              <th>Min</th>
              <th>Bench</th>
              <th>Pos</th>
              <th>G</th>
              <th>A</th>
              <th>+/−</th>
            </tr>
          </thead>
          <tbody>
            {byMinutes.map((s) => (
              <tr key={s.playerId}>
                <td>{nameOf(s.playerId)}</td>
                <td>{mins(s.playedMs)}</td>
                <td className="muted">{mins(s.benchMs)}</td>
                <td title={Object.keys(s.msByPosition).join(', ')}>{s.positionsPlayed}</td>
                <td>{s.goals || ''}</td>
                <td>{s.assists || ''}</td>
                <td className={s.plusMinus > 0 ? '' : s.plusMinus < 0 ? 'muted' : 'muted'}>
                  {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus || ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        “Pos” is how many different positions a player covered — the development
        number. “+/−” is the goal difference while they were on.
      </p>
    </Screen>
  );
}
