import { useEffect, useState } from 'react';
import { mmss } from './format';
import type { ScoreboardGame, ScoreboardSnapshot } from './types';
import { useScoreboard } from './useScoreboard';

const TAG_LABELS: Record<string, string> = {
  fall: 'Fall season',
  spring: 'Spring season',
  tournament: 'Tournament',
  scrimmage: 'Scrimmage',
};

/** "1H" / "Q3" / "P1" — same shorthand as the app's own periodTag, kept as
 *  its own small copy since it's presentation, not shared game logic, and
 *  the two workspaces don't share a UI-components package. */
function periodTag(count: number, period: number): string {
  if (period < 1) return 'Pre';
  if (count === 2) return `${period}H`;
  if (count === 4) return `Q${period}`;
  return `P${period}`;
}

/** Re-renders once a second, but only while `enabled` — a live game's clock
 *  needs to tick between polls; anything else (paused, final, not started)
 *  has nothing to tick, so no timer runs for it. */
function useTick(enabled: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
}

/**
 * The same math as core's clockAt(), inlined rather than imported: that
 * function takes a full GameState, and the entire point of this page is to
 * never hold one — see games.goals's comment in supabase/schema.sql for why.
 */
function liveClockMs(game: ScoreboardGame): number {
  if (game.clock_status === 'running' && game.clock_anchor) {
    return game.clock_anchor.clockMs + Math.max(0, Date.now() - game.clock_anchor.wallTs);
  }
  return game.clock_ms;
}

function StatusPill({ game }: { game: ScoreboardGame }) {
  useTick(game.clock_status === 'running');

  if (game.clock_status === 'pregame') {
    return <p className="sb-status">Kickoff soon</p>;
  }
  if (game.clock_status === 'final') {
    return <p className="sb-status">Final</p>;
  }
  if (game.clock_status === 'break') {
    return <p className="sb-status">Half-time</p>;
  }
  const tag = periodTag(game.periods.count, game.clock_period);
  return (
    <p className="sb-status">
      {tag} · {mmss(liveClockMs(game))}
      {game.clock_status === 'paused' && ' · Paused'}
    </p>
  );
}

function GoalRow({ goal, periodCount }: { goal: ScoreboardGame['goals'][number]; periodCount: number }) {
  const scored = goal.team === 'us' ? goal.scorerName ?? 'Unknown' : null;
  const label =
    goal.team === 'them'
      ? `Opponent goal`
      : `${scored}${goal.assistName ? ` (assist: ${goal.assistName})` : ''}${
          goal.penalty ? ' — penalty' : ''
        }${goal.ownGoal ? ' — own goal' : ''}`;
  return (
    <li className={`sb-goal${goal.team === 'them' ? ' sb-goal-them' : ''}`}>
      <span className="sb-goal-tick" />
      <span className="sb-goal-time">
        {periodTag(periodCount, goal.period)} {mmss(goal.clockMs)}
      </span>
      <span className="sb-goal-who">{label}</span>
    </li>
  );
}

/** Team-name initial, for the crest circle — the first letter that isn't
 *  whitespace, so a name starting with a space (unlikely, but free to
 *  guard) doesn't render a blank badge. */
function crestInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function ScoreboardBody({ snapshot }: { snapshot: ScoreboardSnapshot }) {
  const { team, game } = snapshot;

  return (
    <>
      <div className="sb-band">
        <p className="sb-brand">Pitchside · Live</p>
        <div className="sb-team-row">
          <div className="sb-crest">{crestInitial(team.name)}</div>
          <div>
            <p className="sb-team-name">{team.name}</p>
            {game && (
              <p className="sb-meta">
                vs {game.opponent || 'TBD'}
                {game.tag ? ` · ${TAG_LABELS[game.tag] ?? game.tag}` : ''}
              </p>
            )}
          </div>
        </div>
        {!game && <p className="sb-empty-note">No game yet.</p>}
      </div>

      {game && (
        <>
          <div className="sb-card">
            <div className="sb-score">
              {game.score_us}
              <span>–</span>
              {game.score_them}
            </div>
            <StatusPill game={game} />
          </div>
          {game.goals.length > 0 && (
            <ul className="sb-goals">
              {[...game.goals].reverse().map((goal, i) => (
                <GoalRow key={i} goal={goal} periodCount={game.periods.count} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

export function Scoreboard({ token }: { token: string | null }) {
  const result = useScoreboard(token);

  if (result.status === 'ready') {
    return (
      <div className="sb-page">
        <ScoreboardBody snapshot={result.snapshot} />
      </div>
    );
  }

  return (
    <div className="sb-page sb-simple">
      <p className="sb-brand">Pitchside · Live</p>
      {result.status === 'not-configured' && (
        <div className="empty">This page isn't configured — it's missing its Supabase URL/key.</div>
      )}
      {result.status === 'no-token' && (
        <div className="empty">
          This link is missing its token. Ask the coach for the "Share live
          score with parents" link from Team settings.
        </div>
      )}
      {result.status === 'loading' && <p className="muted">Loading…</p>}
      {result.status === 'error' && (
        <div className="empty">
          Couldn't load this scoreboard — the link may be wrong, or the coach
          may have turned it off. ({result.message})
        </div>
      )}
    </div>
  );
}
