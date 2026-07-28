import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db } from '../db';
import type { Formation } from '../formations';
import { defaultFormation, presetsFor } from '../formations';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

/**
 * Pick a shape and squad size, then drag any position to where you actually want
 * it. Slots are dragged empty — this is about the shape of the team, not who is
 * in it.
 *
 * Works against either a team (the default for its future games) or a single
 * game (this match only). Tournaments are the reason: a Saturday of 6v6 halves
 * should not rewrite what the team plays the rest of the season.
 */
export function FormationScreen({ teamId, gameId }: { teamId?: string; gameId?: string }) {
  const team = useLiveQuery(async () => (teamId ? db.teams.get(teamId) : undefined), [teamId]);
  const game = useLiveQuery(async () => (gameId ? db.games.get(gameId) : undefined), [gameId]);

  const target = teamId ? team : game;
  const [draft, setDraft] = useState<Formation | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (target && !draft) {
      setDraft(structuredClone(target.formation));
      setSize(target.config.periods.fieldPlayers);
    }
  }, [target, draft]);

  const back = () =>
    navigate(
      gameId
        ? { name: 'setup', gameId }
        : { name: 'team', teamId: teamId as string },
    );

  if (!target || !draft || size === null) return <Screen title="Loading…">{null}</Screen>;

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(target.formation) ||
    size !== target.config.periods.fieldPlayers;

  const changeSize = (next: number) => {
    setSize(next);
    setDraft(defaultFormation(next));
  };

  const move = (slotId: string, x: number, y: number) =>
    setDraft((f) =>
      f ? { ...f, slots: f.slots.map((s) => (s.id === slotId ? { ...s, x, y } : s)) } : f,
    );

  const save = async () => {
    const config = {
      ...target.config,
      periods: { ...target.config.periods, fieldPlayers: draft.slots.length },
    };
    if (gameId) await db.games.update(gameId, { formation: draft, config });
    else await db.teams.update(teamId as string, { formation: draft, config });
    back();
  };

  return (
    <Screen
      title="Formation"
      subtitle={`${draft.name} · ${draft.slots.length} a side${gameId ? ' · this game only' : ''}`}
      onBack={back}
      footer={
        <div className="actions">
          <button className="btn" onClick={() => setDraft(structuredClone(target.formation))}>
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
        Drag any position to move it. Pick a preset above to start over.
        {gameId
          ? ' This applies to this game only — the team keeps its own shape.'
          : ' Saved with the team and used for every new game.'}
      </p>

      {renaming && (
        <Sheet title="Name this formation" onClose={() => setRenaming(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Our 1-2-3-1"
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
