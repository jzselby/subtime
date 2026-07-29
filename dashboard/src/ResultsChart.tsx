import type { CSSProperties } from 'react';
import type { GameSummary } from './games';

const TRACK_PX = 80;
const HALF_PX = TRACK_PX / 2;

/** Diverging goal-differential bar chart, one column per game, oldest first. */
export function ResultsChart({ games }: { games: readonly GameSummary[] }) {
  const chronological = [...games].sort(
    (a, b) => new Date(a.game.kickoff_at).getTime() - new Date(b.game.kickoff_at).getTime(),
  );
  const maxDiff = Math.max(
    1,
    ...chronological.map((g) => Math.abs(g.state.score.us - g.state.score.them)),
  );

  return (
    <div className="card">
      <div className="results-chart">
        {chronological.map((g) => {
          const diff = g.state.score.us - g.state.score.them;
          const barPx = diff === 0 ? 3 : Math.max(4, (Math.abs(diff) / maxDiff) * (HALF_PX - 4));
          const style: CSSProperties =
            diff === 0
              ? { top: HALF_PX - 1.5, height: 3 }
              : diff > 0
                ? { bottom: HALF_PX, height: barPx }
                : { top: HALF_PX, height: barPx };
          const cls = g.result === 'W' ? 'win' : g.result === 'L' ? 'loss' : g.result === 'D' ? 'draw' : 'live';
          return (
            <div
              key={g.game.id}
              className="results-col"
              title={`vs ${g.game.opponent || 'TBD'} — ${g.state.score.us}–${g.state.score.them}`}
            >
              <div className="results-track" style={{ height: TRACK_PX }}>
                <span className="results-mid" style={{ top: HALF_PX }} />
                <span className={`results-bar ${cls}`} style={style} />
              </div>
              <span className="small muted results-tag">{g.result ?? '·'}</span>
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Goal difference per game, oldest to newest. Hover a bar for the score.
      </p>
    </div>
  );
}
