import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Screen, Sheet } from '../components';
import { createGame, db, deleteTeam, uid, type Team } from '../db';
import { navigate } from '../router';

export function TeamScreen({ teamId }: { teamId: string }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId],
  );
  const games = useLiveQuery(
    () => db.games.where('teamId').equals(teamId).reverse().sortBy('kickoffAt'),
    [teamId],
  );

  const [sheet, setSheet] = useState<'player' | 'game' | 'settings' | null>(null);

  if (!team) return <Screen title="Loading…">{null}</Screen>;

  const roster = [...(players ?? [])].sort(
    (a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
  );

  return (
    <Screen
      title={team.name}
      subtitle={team.ageGroup || undefined}
      onBack={() => navigate({ name: 'home' })}
      action={
        <button className="btn ghost" onClick={() => setSheet('settings')}>
          Settings
        </button>
      }
    >
      <h2>Games</h2>
      {games?.length === 0 && <div className="empty">No games yet.</div>}
      <div className="plist">
        {games?.map((game) => (
          <button
            key={game.id}
            className="prow"
            onClick={() =>
              navigate(
                game.status === 'final'
                  ? { name: 'summary', gameId: game.id }
                  : game.status === 'live'
                    ? { name: 'live', gameId: game.id }
                    : { name: 'setup', gameId: game.id },
              )
            }
          >
            <span className="grow">
              <span className="name">vs {game.opponent || 'TBD'}</span>
              <span className="small muted" style={{ display: 'block' }}>
                {new Date(game.kickoffAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
            <span className={`pos${game.status === 'final' ? ' bench' : ''}`}>
              {game.status === 'setup' ? 'SETUP' : game.status === 'live' ? 'LIVE' : 'FINAL'}
            </span>
          </button>
        ))}
      </div>
      <button
        className="btn primary block"
        disabled={roster.length === 0}
        onClick={() => setSheet('game')}
      >
        + New game
      </button>
      {roster.length === 0 && (
        <p className="small muted center">Add players before creating a game.</p>
      )}

      <h2 style={{ marginTop: 10 }}>Roster · {roster.length}</h2>
      <div className="plist">
        {roster.map((player) => (
          <div key={player.id} className="prow" style={{ cursor: 'default' }}>
            <span className="num-badge">{player.number || '–'}</span>
            <span className="grow">
              <span className="name">{player.name}</span>
            </span>
            <button
              className="btn ghost small"
              style={{ minHeight: 36, padding: '0 10px' }}
              onClick={() => void db.players.delete(player.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={() => setSheet('player')}>
        + Add player
      </button>

      {sheet === 'player' && (
        <AddPlayerSheet teamId={teamId} onClose={() => setSheet(null)} />
      )}
      {sheet === 'game' && <NewGameSheet team={team} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet team={team} onClose={() => setSheet(null)} />}
    </Screen>
  );
}

/**
 * Adding players is the most repetitive job in the app, so the form stays open
 * and refocuses after each save — a whole roster goes in without leaving.
 */
function AddPlayerSheet({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [added, setAdded] = useState(0);

  const submit = async () => {
    if (!name.trim()) return;
    await db.players.add({
      id: uid(),
      teamId,
      name: name.trim(),
      number: number.trim(),
      active: 1,
    });
    setName('');
    setNumber('');
    setAdded((n) => n + 1);
    document.getElementById('player-name')?.focus();
  };

  return (
    <Sheet title="Add players" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <label className="field" style={{ width: 92 }}>
            <span>Number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              placeholder="7"
            />
          </label>
          <label className="field grow">
            <span>Name</span>
            <input
              id="player-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>
        </div>
        <button className="btn primary block" disabled={!name.trim()} onClick={() => void submit()}>
          Add player
        </button>
        {added > 0 && (
          <p className="small muted center">
            {added} player{added === 1 ? '' : 's'} added
          </p>
        )}
      </div>
    </Sheet>
  );
}

function NewGameSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const submit = async () => {
    const kickoffAt = new Date(`${date}T12:00:00`).getTime() || Date.now();
    const id = await createGame(team, opponent.trim(), kickoffAt);
    onClose();
    navigate({ name: 'setup', gameId: id });
  };

  return (
    <Sheet title="New game" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span>Opponent</span>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Rovers"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="small muted">
          Uses this team's format: {team.config.periods.count} ×{' '}
          {Math.round(team.config.periods.lengthMs / 60_000)} min,{' '}
          {team.formation.slots.length} a side in {team.formation.name}.
        </p>
        <button className="btn primary block" onClick={() => void submit()}>
          Create game
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The configurability that justifies building this instead of buying it: period
 * shape, squad size, position vocabulary, and how much a minute in goal counts
 * toward a fair share.
 */
function SettingsSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const [periods, setPeriods] = useState(team.config.periods.count);
  const [lengthMin, setLengthMin] = useState(Math.round(team.config.periods.lengthMs / 60_000));
  const [gkWeight, setGkWeight] = useState(team.config.fairness.gkWeight);

  const save = async () => {
    await db.teams.update(team.id, {
      config: {
        ...team.config,
        periods: { ...team.config.periods, count: periods, lengthMs: lengthMin * 60_000 },
        fairness: { ...team.config.fairness, gkWeight },
      },
    });
    onClose();
  };

  return (
    <Sheet title="Team settings" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <label className="field grow">
            <span>Periods</span>
            <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2 halves</option>
              <option value={3}>3</option>
              <option value={4}>4 quarters</option>
            </select>
          </label>
          <label className="field grow">
            <span>Minutes each</span>
            <input
              type="number"
              min={1}
              value={lengthMin}
              onChange={(e) => setLengthMin(Math.max(1, Number(e.target.value)))}
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="field">
          <span>Keeper minutes count toward fair share</span>
          <select value={gkWeight} onChange={(e) => setGkWeight(Number(e.target.value))}>
            <option value={1}>Fully — a minute is a minute</option>
            <option value={0.5}>Half credit</option>
            <option value={0}>Not at all</option>
          </select>
        </label>
        <p className="small muted" style={{ marginTop: -6 }}>
          Only affects the fairness targets and sub suggestions. Reported minutes
          are always the real ones.
        </p>

        <button
          className="btn block"
          onClick={() => {
            onClose();
            navigate({ name: 'formation', teamId: team.id });
          }}
        >
          Formation: {team.formation.name} · {team.formation.slots.length} a side ›
        </button>
        <p className="small muted" style={{ marginTop: -6 }}>
          Squad size and positions live on the formation, where you can drag them
          into the shape you actually play.
        </p>

        <button className="btn primary block" onClick={() => void save()}>
          Save
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            if (confirm(`Delete ${team.name} and all its games? This cannot be undone.`)) {
              void deleteTeam(team.id).then(() => navigate({ name: 'home' }));
            }
          }}
        >
          Delete team
        </button>
      </div>
    </Sheet>
  );
}
