import type { PlayerSlot } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { minutesOf, Screen, Sheet } from '../components';
import { db, deleteGame, type Game, type Player } from '../db';
import { useGameLog } from '../hooks';
import type { Occupant } from '../Pitch';
import { Pitch } from '../Pitch';
import { navigate } from '../router';
import type { DropTarget } from '../usePitchDrag';
import { usePitchDrag } from '../usePitchDrag';

export function SetupScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  /** slot id → player id */
  const [lineup, setLineup] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [attendance, setAttendance] = useState(false);

  const { state, recordMany } = useGameLog(gameId, game?.config ?? DEFAULT_CFG);

  /*
   * Retired players are off future team sheets but not out of games they are
   * already part of: one retired mid-season still appears on a game recorded
   * before it, and one retired by mistake mid-setup does not vanish from a
   * lineup that already names them.
   */
  const roster = useMemo(
    () =>
      (players ?? [])
        .filter((p) => p.active !== 0 || state.attendance.has(p.id))
        .sort(
          (a, b) =>
            (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
        ),
    [players, state.attendance],
  );

  /*
   * The lineup is keyed by slot id, so a formation change invalidates it —
   * different shape, different slots. Drop any assignment whose slot no longer
   * exists rather than leaving players attached to positions that are gone.
   */
  const slotIds = game?.formation.slots.map((s) => s.id).join(',') ?? '';
  useEffect(() => {
    const valid = new Set(slotIds.split(','));
    setLineup((l) => {
      const next = Object.fromEntries(Object.entries(l).filter(([slot]) => valid.has(slot)));
      return Object.keys(next).length === Object.keys(l).length ? l : next;
    });
  }, [slotIds]);

  /*
   * Who is here is recorded as ATTENDANCE events the moment it is confirmed,
   * not held in local state until kickoff. That is what lets it survive a trip
   * into the formation editor and back, and it means the fairness targets are
   * right before the first whistle rather than after it.
   */
  const attendanceKnown = state.attendance.size > 0;
  const absent = useMemo(
    () => new Set([...state.attendance].filter(([, v]) => v === 'absent').map(([id]) => id)),
    [state.attendance],
  );

  // Ask on arrival, once, while nobody has been marked either way.
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current && roster.length > 0 && !attendanceKnown) {
      asked.current = true;
      setAttendance(true);
    }
  }, [roster.length, attendanceKnown]);

  /*
   * Setup drags the same way the game does — the lineup here is plain state
   * rather than events, but the gesture must not differ. Onto an empty position
   * moves; onto an occupied one swaps; onto the bench unassigns.
   */
  const onDrop = (from: 'bench' | string, playerId: string, target: DropTarget) => {
    setLineup((prev) => {
      const next = { ...prev };
      if (target.onBench) {
        if (from !== 'bench') delete next[from];
        return next;
      }
      if (!target.slotId) return prev;
      const sitting = next[target.slotId];
      if (from === 'bench') {
        // Whoever was there goes back to the bench.
        next[target.slotId] = playerId;
        return next;
      }
      if (target.slotId === from) return prev;
      if (sitting) next[from] = sitting;
      else delete next[from];
      next[target.slotId] = playerId;
      return next;
    });
  };

  const { startDrag, ghost, dropSlotId, dragged } = usePitchDrag(onDrop);

  if (!game) return <Screen title="Loading…">{null}</Screen>;

  const formation = game.formation;
  const present = roster.filter((p) => !absent.has(p.id));
  const assigned = new Set(Object.values(lineup));
  const filled = Object.values(lineup).filter(Boolean).length;
  const needed = Math.min(formation.slots.length, present.length);
  const byId = new Map(roster.map((p) => [p.id, p]));

  const occupants = new Map<string, Occupant>();
  for (const [slotId, playerId] of Object.entries(lineup)) {
    const p = byId.get(playerId);
    if (p) occupants.set(slotId, { playerId, name: p.name, number: p.number, playedMs: 0 });
  }


  /** Fill every empty slot with the highest-numbered unassigned players. */
  const autoFill = () => {
    const next = { ...lineup };
    const free = present.filter((p) => !assigned.has(p.id));
    for (const slot of formation.slots) {
      if (next[slot.id]) continue;
      const p = free.shift();
      if (!p) break;
      next[slot.id] = p.id;
    }
    setLineup(next);
  };

  const start = async () => {
    const slots: PlayerSlot[] = formation.slots
      .filter((s) => lineup[s.id])
      .map((s) => ({ playerId: lineup[s.id] as string, position: s.code }));

    await recordMany([{ type: 'SET_LINEUP' as const, slots }]);
    await db.games.update(gameId, { status: 'live' });
    navigate({ name: 'live', gameId }, true);
  };

  return (
    <Screen
      title={`vs ${game.opponent || 'TBD'}`}
      subtitle={`${game.config.periods.count} × ${Math.round(game.config.periods.lengthMs / 60_000)} min · ${formation.name}`}
      fill
      onBack={() => navigate({ name: 'team', teamId: game.teamId })}
      action={
        <button className="btn ghost" onClick={() => setSettings(true)}>
          Setup
        </button>
      }
      footer={
        <div className="actions">
          {/*
           * The one-tap action that solves this whole screen used to be the
           * quiet grey button, while the loudest, greenest element was a
           * disabled restatement of the heading above it ("Pick 9 more") —
           * readable at about 2:1 contrast and not a control at all. Fill rest
           * is now what the eye lands on; Start game is a stable target that
           * says the same thing throughout instead of counting down.
           */}
          <button
            className={`btn${filled < needed ? ' primary' : ''}`}
            disabled={filled >= needed}
            onClick={autoFill}
          >
            Fill rest
          </button>
          <button
            className={`btn lg${filled >= needed && needed > 0 ? ' primary' : ''}`}
            disabled={filled < needed || needed === 0}
            onClick={() => void start()}
          >
            Start game
          </button>
        </div>
      }
    >
      <h2>Starting lineup · {filled} of {needed}</h2>
      <div className="pitchwrap">
        <Pitch
          formation={formation}
          occupants={occupants}
          dropSlotId={dropSlotId}
          onSlotTap={(slot) => {
            if (dragged.current) return;
            setPicking(slot.id);
          }}
          onTokenPointerDown={(slot, occupant, e) =>
            occupant &&
            startDrag(occupant.playerId, slot.id, occupant.number || occupant.name.slice(0, 2))(e)
          }
        />
      </div>

      <div className="row spread" style={{ marginTop: 2 }}>
        <h2 style={{ margin: 0 }}>Bench · {present.length - filled}</h2>
        <button className="btn ghost small" onClick={() => setAttendance(true)}>
          {present.length} of {roster.length} here ›
        </button>
      </div>
      <div className="benchstrip" data-bench>
        {present
          .filter((p) => !assigned.has(p.id))
          .map((p) => (
            <button
              key={p.id}
              className="bplayer"
              onPointerDown={startDrag(p.id, 'bench', p.number || p.name.slice(0, 2))}
            >
              <span className="shirt">{p.number || p.name.slice(0, 2)}</span>
              <span className="tname">{p.name}</span>
            </button>
          ))}
        {present.length === filled && (
          <p className="small muted">Everyone available is in the lineup.</p>
        )}
      </div>

      {ghost && (
        <div className="dragavatar" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.label}
        </div>
      )}

      {attendance && (
        <AttendanceSheet
          roster={roster}
          absent={absent}
          onClose={() => setAttendance(false)}
          onSave={async (nowAbsent) => {
            await recordMany(
              roster.map((p) => ({
                type: 'ATTENDANCE' as const,
                playerId: p.id,
                status: nowAbsent.has(p.id) ? ('absent' as const) : ('present' as const),
              })),
            );
            // Anyone marked absent cannot stay in the starting lineup.
            setLineup((l) =>
              Object.fromEntries(Object.entries(l).filter(([, id]) => !nowAbsent.has(id))),
            );
            setAttendance(false);
          }}
        />
      )}

      {settings && (
        <MatchSettings game={game} gameId={gameId} onClose={() => setSettings(false)} />
      )}

      {picking && (
        <Sheet
          title={`${formation.slots.find((s) => s.id === picking)?.code ?? ''} — pick a player`}
          onClose={() => setPicking(null)}
        >
          <div className="chips">
            {present.map((p) => {
              const isHere = lineup[picking] === p.id;
              const taken = assigned.has(p.id) && !isHere;
              return (
                <button
                  key={p.id}
                  className={`chip${isHere ? ' sel' : ''}`}
                  disabled={taken}
                  style={taken ? { opacity: 0.35 } : undefined}
                  onClick={() => {
                    setLineup((l) => ({ ...l, [picking]: p.id }));
                    setPicking(null);
                  }}
                >
                  {p.number && <b>{p.number}</b>} {p.name}
                </button>
              );
            })}
          </div>
          {lineup[picking] && (
            <button
              className="btn ghost block"
              style={{ marginTop: 12 }}
              onClick={() => {
                setLineup((l) => {
                  const next = { ...l };
                  delete next[picking];
                  return next;
                });
                setPicking(null);
              }}
            >
              Clear this position
            </button>
          )}
        </Sheet>
      )}
    </Screen>
  );
}

/**
 * Who is here, as a checklist that starts with everybody ticked — the common
 * case is a full squad, so the work is unticking the two who are away.
 */
function AttendanceSheet({
  roster,
  absent,
  onClose,
  onSave,
}: {
  roster: Player[];
  absent: Set<string>;
  onClose: () => void;
  onSave: (absent: Set<string>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(absent));
  const here = roster.length - draft.size;

  const toggle = (id: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Sheet title={`Who's here? · ${here} of ${roster.length}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: -4 }}>
        Everyone starts ticked. Untick anyone who is not at this game.
      </p>
      <div className="plist" style={{ marginTop: 10 }}>
        {roster.map((p) => {
          const isHere = !draft.has(p.id);
          return (
            <button
              key={p.id}
              className={`prow${isHere ? ' on' : ''}`}
              onClick={() => toggle(p.id)}
              aria-pressed={isHere}
            >
              <span className={`check${isHere ? ' on' : ''}`}>{isHere ? '✓' : ''}</span>
              <span className="num-badge">{p.number || '–'}</span>
              <span className="grow">
                <span className={isHere ? 'name' : 'name muted'}>{p.name}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => setDraft(new Set())}>
          All here
        </button>
        <button className="btn primary grow" onClick={() => void onSave(draft)}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Per-game match settings.
 *
 * Deliberately a copy of the team's, not a reference to it: tournaments run
 * short halves and odd squad sizes, and a Saturday of 6v6 must not rewrite what
 * the team plays for the rest of the season.
 */
function MatchSettings({
  game,
  gameId,
  onClose,
}: {
  game: Game;
  gameId: string;
  onClose: () => void;
}) {
  const [periods, setPeriods] = useState(game.config.periods.count);
  const [lengthMin, setLengthMin] = useState(String(Math.round(game.config.periods.lengthMs / 60_000)));
  const [opponent, setOpponent] = useState(game.opponent);

  const save = async () => {
    await db.games.update(gameId, {
      opponent: opponent.trim(),
      config: {
        ...game.config,
        periods: { ...game.config.periods, count: periods, lengthMs: minutesOf(lengthMin) * 60_000 },
      },
    });
    onClose();
  };

  return (
    <Sheet title="This game" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span>Opponent</span>
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Rovers" />
        </label>

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
            {/* Held as text while editing. Clamping on every keystroke turned an
                empty field into "1", so clearing 30 to type 25 left you with 125
                and no way to reach a number below ten. Clamp on commit. */}
            <input
              type="number"
              min={1}
              value={lengthMin}
              onChange={(e) => setLengthMin(e.target.value)}
              onBlur={() => setLengthMin(String(minutesOf(lengthMin)))}
              inputMode="numeric"
            />
          </label>
        </div>

        <button
          className="btn block"
          onClick={() => {
            void save().then(() => navigate({ name: 'gameFormation', gameId }));
          }}
        >
          Formation: {game.formation.name} · {game.formation.slots.length} a side ›
        </button>

        <p className="small muted" style={{ marginTop: -6 }}>
          These apply to this game only. The team's own defaults are untouched.
        </p>

        <button className="btn primary block" onClick={() => void save()}>
          Save
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            if (confirm('Delete this game?')) {
              void deleteGame(gameId).then(() => navigate({ name: 'team', teamId: game.teamId }));
            }
          }}
        >
          Delete game
        </button>
      </div>
    </Sheet>
  );
}

// Placeholder config used only while the game record is still loading.
const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};
