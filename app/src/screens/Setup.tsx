import type { PlayerSlot } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db, deleteGame } from '../db';
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

  const { recordMany } = useGameLog(gameId, game?.config ?? DEFAULT_CFG);

  const roster = useMemo(
    () =>
      [...(players ?? [])].sort(
        (a, b) =>
          (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
      ),
    [players],
  );

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
        <button
          className="btn ghost"
          onClick={() => {
            if (confirm('Delete this game?')) {
              void deleteGame(gameId).then(() => navigate({ name: 'team', teamId: game.teamId }));
            }
          }}
        >
          Delete
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

// Placeholder config used only while the game record is still loading.
const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};
