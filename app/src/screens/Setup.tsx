import type { PlayerSlot } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db, deleteGame, type Game } from '../db';
import { useGameLog } from '../hooks';
import type { Occupant } from '../Pitch';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

export function SetupScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const [absent, setAbsent] = useState<Set<string>>(new Set());
  /** slot id → player id */
  const [lineup, setLineup] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);

  const { recordMany } = useGameLog(gameId, game?.config ?? DEFAULT_CFG);

  const roster = useMemo(
    () =>
      [...(players ?? [])].sort(
        (a, b) =>
          (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
      ),
    [players],
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

    await recordMany([
      ...roster.map((p) => ({
        type: 'ATTENDANCE' as const,
        playerId: p.id,
        status: absent.has(p.id) ? ('absent' as const) : ('present' as const),
      })),
      { type: 'SET_LINEUP' as const, slots },
    ]);
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
          <button className="btn" disabled={filled >= needed} onClick={autoFill}>
            Fill rest
          </button>
          <button
            className="btn primary lg"
            disabled={filled < needed || needed === 0}
            onClick={() => void start()}
          >
            {filled < needed ? `Pick ${needed - filled} more` : 'Start game'}
          </button>
        </div>
      }
    >
      <h2>Who's here · {present.length} of {roster.length}</h2>
      <div className="chipscroll">
      <div className="chips">
        {roster.map((p) => (
          <button
            key={p.id}
            className={`chip${absent.has(p.id) ? '' : ' sel'}`}
            onClick={() =>
              setAbsent((prev) => {
                const next = new Set(prev);
                if (next.has(p.id)) next.delete(p.id);
                else {
                  next.add(p.id);
                  // Dropping someone from attendance must drop them from the XI.
                  setLineup((l) =>
                    Object.fromEntries(Object.entries(l).filter(([, id]) => id !== p.id)),
                  );
                }
                return next;
              })
            }
          >
            {p.number && <b>{p.number}</b>} {p.name}
          </button>
        ))}
      </div>
      </div>

      <h2>Starting lineup · {filled} of {needed}</h2>
      <div className="pitchwrap">
        <Pitch
          formation={formation}
          occupants={occupants}
          onSlotTap={(slot) => setPicking(slot.id)}
        />
      </div>

      <div className="benchstrip">
        {present
          .filter((p) => !assigned.has(p.id))
          .map((p) => (
            <div key={p.id} className="bplayer">
              <span className="shirt">{p.number || p.name.slice(0, 2)}</span>
              <span className="tname">{p.name}</span>
            </div>
          ))}
        {present.length === filled && (
          <p className="small muted">Everyone available is in the lineup.</p>
        )}
      </div>

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
  const [lengthMin, setLengthMin] = useState(Math.round(game.config.periods.lengthMs / 60_000));
  const [opponent, setOpponent] = useState(game.opponent);

  const save = async () => {
    await db.games.update(gameId, {
      opponent: opponent.trim(),
      config: {
        ...game.config,
        periods: { ...game.config.periods, count: periods, lengthMs: lengthMin * 60_000 },
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
            <input
              type="number"
              min={1}
              value={lengthMin}
              onChange={(e) => setLengthMin(Math.max(1, Number(e.target.value)))}
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
