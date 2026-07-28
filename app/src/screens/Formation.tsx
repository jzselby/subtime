import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db } from '../db';
import type { Formation } from '../formations';
import { defaultFormation, presetsFor } from '../formations';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

/**
 * Pick a shape and squad size, then drag any slot to where you actually want it
 * and save it as your own. Slots are dragged empty — this is about the shape of
 * the team, not who is in it.
 */
export function FormationScreen({ teamId }: { teamId: string }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const [draft, setDraft] = useState<Formation | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (team && !draft) {
      setDraft(structuredClone(team.formation));
      setSize(team.config.periods.fieldPlayers);
    }
  }, [team, draft]);

  if (!team || !draft || size === null) return <Screen title="Loading…">{null}</Screen>;

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(team.formation) ||
    size !== team.config.periods.fieldPlayers;

  const changeSize = (next: number) => {
    setSize(next);
    setDraft(defaultFormation(next));
  };

  const move = (slotId: string, x: number, y: number) =>
    setDraft((f) =>
      f ? { ...f, slots: f.slots.map((s) => (s.id === slotId ? { ...s, x, y } : s)) } : f,
    );

  const save = async () => {
    await db.teams.update(teamId, {
      formation: draft,
      config: {
        ...team.config,
        periods: { ...team.config.periods, fieldPlayers: draft.slots.length },
      },
    });
    navigate({ name: 'team', teamId });
  };

  return (
    <Screen
      title="Formation"
      subtitle={`${draft.name} · ${draft.slots.length} a side`}
      onBack={() => navigate({ name: 'team', teamId })}
      footer={
        <div className="actions">
          <button className="btn" onClick={() => setDraft(structuredClone(team.formation))}>
            Reset
          </button>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save formation' : 'Saved'}
          </button>
        </div>
      }
    >
      <label className="field">
        <span>Players on the field (including keeper)</span>
        <select value={size} onChange={(e) => changeSize(Number(e.target.value))}>
          {[4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
            <option key={n} value={n}>
              {n} v {n}
            </option>
          ))}
        </select>
      </label>

      <h2>Shape</h2>
      <div className="chips">
        {presetsFor(size).map((preset) => (
          <button
            key={preset.name}
            className={`chip${preset.name === draft.name ? ' sel' : ''}`}
            onClick={() => setDraft(preset)}
          >
            {preset.name}
          </button>
        ))}
        <button
          className="chip"
          onClick={() => {
            setName(draft.name);
            setRenaming(true);
          }}
        >
          Rename…
        </button>
      </div>

      <Pitch formation={draft} occupants={new Map()} onSlotMove={move} />
      <p className="small muted">
        Drag any position to move it. Pick a preset above to start over. Your
        layout is saved with the team and used for every new game.
      </p>

      {renaming && (
        <Sheet title="Name this formation" onClose={() => setRenaming(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Our 2-3-1"
            />
            <button
              className="btn primary block"
              onClick={() => {
                if (name.trim()) setDraft({ ...draft, name: name.trim() });
                setRenaming(false);
              }}
            >
              Rename
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
