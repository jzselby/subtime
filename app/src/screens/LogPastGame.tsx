import type { EventInput } from '@pitchside/core';
import { useState } from 'react';
import { Sheet } from '../components';
import { GAME_TAG_LABELS, logPastGame, type GameTag, type Player, type Team } from '../db';
import { navigate } from '../router';

/**
 * For a game this app wasn't running for — logged after the fact from memory
 * rather than lived through, live-clock event by event. There is deliberately
 * no lineup, no periods, no clock: `logPastGame` (db.ts) writes straight to a
 * 'final' game with just `ATTENDANCE` for who was there, `GOAL`/`OPPONENT_GOAL`
 * for the score, and `GAME_END`. No stints means no playing time — the same
 * "games played" a normal live game credits only for real minutes on the
 * field (see `aggregatePlayerStats` in core) is correctly *not* credited here
 * either, for anyone this sheet marks played; that is an intentional,
 * already-tested rule this screen doesn't get to bend, not a gap in it.
 */

interface PastGoal {
  id: string;
  scorerId: string | null;
  assistId: string | null;
}

export function LogPastGameSheet({
  team,
  roster,
  onClose,
}: {
  team: Team;
  roster: Player[];
  onClose: () => void;
}) {
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tag, setTag] = useState<GameTag | ''>('');
  const [played, setPlayed] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<PastGoal[]>([]);
  const [theirGoals, setTheirGoals] = useState(0);
  const [pickingGoal, setPickingGoal] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameOf = (id: string) => roster.find((p) => p.id === id)?.name ?? 'Unknown';
  const playedRoster = roster.filter((p) => played.has(p.id));

  const togglePlayed = (id: string) =>
    setPlayed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    const kickoffAt = new Date(`${date}T12:00:00`).getTime() || Date.now();
    const inputs: EventInput[] = [
      ...playedRoster.map(
        (p): EventInput => ({ type: 'ATTENDANCE', playerId: p.id, status: 'present' }),
      ),
      ...goals.map((g): EventInput => ({ type: 'GOAL', scorerId: g.scorerId, assistId: g.assistId })),
      ...Array.from({ length: theirGoals }, (): EventInput => ({ type: 'OPPONENT_GOAL' })),
      { type: 'GAME_END' },
    ];
    const id = await logPastGame(team, opponent.trim(), kickoffAt, tag || undefined, inputs);
    onClose();
    navigate({ name: 'summary', gameId: id });
  };

  return (
    <Sheet title="Log a past game" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="small muted" style={{ marginTop: -4 }}>
          For a game this app wasn't running for. No playing time comes out of
          this — just the final score, and who scored or assisted.
        </p>

        <label className="field">
          <span>Opponent</span>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Rovers"
          />
        </label>
        <div className="row">
          <label className="field grow">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Tag</span>
            <select value={tag} onChange={(e) => setTag(e.target.value as GameTag | '')}>
              <option value="">None</option>
              {Object.entries(GAME_TAG_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row spread" style={{ marginTop: 4 }}>
          <h2 style={{ margin: 0 }}>Who played · {played.size}</h2>
        </div>
        <div className="chips">
          {roster.map((p) => (
            <button
              key={p.id}
              className={`chip${played.has(p.id) ? ' sel' : ''}`}
              onClick={() => togglePlayed(p.id)}
            >
              {p.number && <b>{p.number}</b>} {p.name}
            </button>
          ))}
          {roster.length === 0 && <p className="muted">No players on the roster.</p>}
        </div>

        <div className="row spread" style={{ marginTop: 4 }}>
          <h2 style={{ margin: 0 }}>
            Score · {goals.length}–{theirGoals}
          </h2>
        </div>
        {goals.length > 0 && (
          <div className="plist">
            {goals.map((g) => (
              <div key={g.id} className="prow">
                <span className="grow">
                  <span className="name">{g.scorerId ? nameOf(g.scorerId) : 'Unknown scorer'}</span>
                  {g.assistId && (
                    <span className="small muted" style={{ display: 'block' }}>
                      assist: {nameOf(g.assistId)}
                    </span>
                  )}
                </span>
                <button
                  className="btn ghost small"
                  style={{ minHeight: 36, padding: '0 10px' }}
                  onClick={() => setGoals((gs) => gs.filter((x) => x.id !== g.id))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="btn block" onClick={() => setPickingGoal(true)}>
          + Add our goal
        </button>

        <div className="row spread" style={{ alignItems: 'center' }}>
          <span>Their goals</span>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <button
              className="btn ghost small"
              style={{ minHeight: 36, minWidth: 36 }}
              disabled={theirGoals === 0}
              onClick={() => setTheirGoals((n) => Math.max(0, n - 1))}
            >
              −
            </button>
            <span style={{ minWidth: 20, textAlign: 'center' }}>{theirGoals}</span>
            <button
              className="btn ghost small"
              style={{ minHeight: 36, minWidth: 36 }}
              onClick={() => setTheirGoals((n) => n + 1)}
            >
              +
            </button>
          </div>
        </div>

        <button className="btn primary block" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save game'}
        </button>
      </div>

      {pickingGoal && (
        <PastGoalSheet
          pool={playedRoster}
          onClose={() => setPickingGoal(false)}
          onSubmit={(scorerId, assistId) => {
            setGoals((gs) => [...gs, { id: `g${gs.length}-${Date.now()}`, scorerId, assistId }]);
            setPickingGoal(false);
          }}
        />
      )}
    </Sheet>
  );
}

/** Same two-tap shape as Live.tsx's GoalSheet, against the who-played pool instead of who's on the field. */
function PastGoalSheet({
  pool,
  onClose,
  onSubmit,
}: {
  pool: Player[];
  onClose: () => void;
  onSubmit: (scorerId: string | null, assistId: string | null) => void;
}) {
  const [scorer, setScorer] = useState<string | null>(null);

  if (!scorer) {
    return (
      <Sheet title="Who scored?" onClose={onClose}>
        {pool.length === 0 && (
          <p className="small muted" style={{ marginTop: -4 }}>
            Nobody is marked as having played yet — tick them under "Who
            played" first, or record this one as unknown.
          </p>
        )}
        <div className="chips">
          {pool.map((p) => (
            <button key={p.id} className="chip" onClick={() => setScorer(p.id)}>
              {p.number && <b>{p.number}</b>} {p.name}
            </button>
          ))}
          <button className="chip" onClick={() => onSubmit(null, null)}>
            Not sure
          </button>
        </div>
      </Sheet>
    );
  }

  const scorerName = pool.find((p) => p.id === scorer)?.name ?? 'Unknown';
  return (
    <Sheet title="Assist?" onClose={onClose}>
      <p className="small muted">Goal: {scorerName}</p>
      <div className="chips">
        {pool
          .filter((p) => p.id !== scorer)
          .map((p) => (
            <button key={p.id} className="chip" onClick={() => onSubmit(scorer, p.id)}>
              {p.number && <b>{p.number}</b>} {p.name}
            </button>
          ))}
        <button className="chip sel" onClick={() => onSubmit(scorer, null)}>
          No assist
        </button>
      </div>
    </Sheet>
  );
}
