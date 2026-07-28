import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Screen, Sheet } from '../components';
import { createTeam, db } from '../db';
import { navigate } from '../router';

export function HomeScreen() {
  const teams = useLiveQuery(() => db.teams.orderBy('createdAt').toArray(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [fieldPlayers, setFieldPlayers] = useState(9);

  const submit = async () => {
    if (!name.trim()) return;
    const id = await createTeam(name.trim(), ageGroup.trim(), fieldPlayers);
    setAdding(false);
    setName('');
    setAgeGroup('');
    navigate({ name: 'team', teamId: id });
  };

  return (
    <Screen title="Touchline" subtitle="Playing time, subs, and stats">
      {teams?.length === 0 && (
        <div className="empty">
          No teams yet.
          <br />
          Add one to get started.
        </div>
      )}

      <div className="plist">
        {teams?.map((team) => (
          <button
            key={team.id}
            className="prow"
            onClick={() => navigate({ name: 'team', teamId: team.id })}
          >
            <span className="grow">
              <span className="name">{team.name}</span>
              {team.ageGroup && <span className="small muted"> · {team.ageGroup}</span>}
            </span>
            <span className="muted">›</span>
          </button>
        ))}
      </div>

      <button className="btn primary block" onClick={() => setAdding(true)}>
        + New team
      </button>

      {adding && (
        <Sheet title="New team" onClose={() => setAdding(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>Team name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Thunder"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <label className="field">
              <span>Age group (optional)</span>
              <input
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                placeholder="U11"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <label className="field">
              <span>Format</span>
              <select
                value={fieldPlayers}
                onChange={(e) => setFieldPlayers(Number(e.target.value))}
              >
                {[4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                  <option key={n} value={n}>
                    {n} v {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted" style={{ marginTop: -6 }}>
              Sets the starting formation. You can change the shape and drag
              positions afterwards.
            </p>
            <button className="btn primary block" disabled={!name.trim()} onClick={() => void submit()}>
              Create team
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
