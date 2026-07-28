import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db } from '../db';
import type { Formation, Role, Slot } from '../formations';
import { defaultFormation, presetsFor } from '../formations';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

const ROLES: Role[] = ['GK', 'D', 'M', 'F'];

/**
 * A code unique among the *other* slots. Mirrors the collision guard in
 * `buildFormation` — codes are how the engine and the position-minutes report
 * tell slots apart, so two slots sharing one silently merges them.
 */
function uniqueCode(slots: Slot[], code: string, exceptId?: string): string {
  const taken = new Set(slots.filter((s) => s.id !== exceptId).map((s) => s.code));
  if (!taken.has(code)) return code;
  let n = 2;
  while (taken.has(`${code}${n}`)) n++;
  return `${code}${n}`;
}

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
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editRole, setEditRole] = useState<Role>('M');

  useEffect(() => {
    if (target && !draft) {
      setDraft(structuredClone(target.formation));
      setSize(target.config.periods.fieldPlayers);
    }
  }, [target, draft]);

  /*
   * Back goes where the game actually is, not where it was when the only route
   * in was from the setup screen. Assuming `setup` is correct today and would
   * strand anyone the moment a second entry point opened this mid-game.
   */
  const back = () => {
    if (!gameId) return navigate({ name: 'team', teamId: teamId as string });
    if (game?.status === 'live') return navigate({ name: 'live', gameId });
    if (game?.status === 'final') return navigate({ name: 'summary', gameId });
    navigate({ name: 'setup', gameId });
  };

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

  /*
   * A preset is a starting point, not a ceiling — a coach whose team plays a
   * shape no preset covers builds it from here: add a slot, drag it where it
   * belongs, tap it to give it a real code and line. New slots land spread
   * across the middle third rather than stacked on one point, so there is
   * something to drag apart from the first tap.
   */
  const addSlot = () => {
    const n = draft.slots.length + 1;
    const code = uniqueCode(draft.slots, `P${n}`);
    const spread = ((n * 37) % 100) / 100;
    const slot: Slot = {
      id: `custom-${Date.now()}-${n}`,
      code,
      role: 'M',
      x: 0.2 + spread * 0.6,
      y: 0.5,
    };
    const slots = [...draft.slots, slot];
    setDraft({ ...draft, slots });
    setSize(slots.length);
  };

  const openSlotEditor = (slot: Slot) => {
    setEditCode(slot.code);
    setEditRole(slot.role);
    setEditingSlot(slot);
  };

  const saveSlotEdit = () => {
    if (!editingSlot) return;
    const code = uniqueCode(draft.slots, editCode.trim() || editingSlot.code, editingSlot.id);
    const slots = draft.slots.map((s) =>
      s.id === editingSlot.id ? { ...s, code, role: editRole } : s,
    );
    setDraft({ ...draft, slots });
    setEditingSlot(null);
  };

  const removeSlot = () => {
    if (!editingSlot || draft.slots.length <= 1) return;
    const slots = draft.slots.filter((s) => s.id !== editingSlot.id);
    setDraft({ ...draft, slots });
    setSize(slots.length);
    setEditingSlot(null);
  };

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
        <button className="chip" onClick={addSlot}>
          + Add position
        </button>
      </div>

      <Pitch
        formation={draft}
        occupants={new Map()}
        onSlotMove={move}
        onSlotTap={(slot) => openSlotEditor(slot)}
      />
      <p className="small muted">
        Drag any position to move it, or tap one to rename it, change its line,
        or remove it. Pick a preset above to start over.
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

      {editingSlot && (
        <Sheet title={`Edit ${editingSlot.code}`} onClose={() => setEditingSlot(null)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>Code, shown on the shirt</span>
              <input
                autoFocus
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toUpperCase().slice(0, 5))}
                placeholder="SW"
              />
            </label>
            <label className="field">
              <span>Line</span>
              <div className="chips">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    className={`chip${editRole === r ? ' sel' : ''}`}
                    onClick={() => setEditRole(r)}
                  >
                    {r === 'GK' ? 'Keeper' : r === 'D' ? 'Defence' : r === 'M' ? 'Midfield' : 'Forward'}
                  </button>
                ))}
              </div>
            </label>
            <button className="btn primary block" onClick={saveSlotEdit}>
              Save
            </button>
            <button
              className="btn danger block"
              disabled={draft.slots.length <= 1}
              onClick={removeSlot}
            >
              {draft.slots.length <= 1 ? "Can't remove the only position" : 'Remove this position'}
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
