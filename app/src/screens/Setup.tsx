import type { PlayerSlot } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Screen, Sheet } from '../components';
import { db, deleteGame } from '../db';
import { useGameLog } from '../hooks';
import { navigate } from '../router';

export function SetupScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const team = useLiveQuery(
    async () => (game ? db.teams.get(game.teamId) : undefined),
    [game?.teamId],
  );
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [lineup, setLineup] = useState<Record<number, string>>({});
  const [picking, setPicking] = useState<number | null>(null);

  const { recordMany } = useGameLog(gameId, game?.config ?? DEFAULT_CFG);

  const roster = useMemo(
    () =>
      [...(players ?? [])].sort(
        (a, b) =>
          (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
      ),
    [players],
  );

  if (!game || !team) return <Screen title="Loading…">{null}</Screen>;

  const fieldPlayers = game.config.periods.fieldPlayers;
  const slotPositions = Array.from(
    { length: fieldPlayers },
    (_, i) => team.positions[i] ?? `P${i + 1}`,
  );

  const present = roster.filter((p) => !absent.has(p.id));
  const assigned = new Set(Object.values(lineup));
  const filled = Object.values(lineup).filter(Boolean).length;
  const needed = Math.min(fieldPlayers, present.length);
  const byId = new Map(roster.map((p) => [p.id, p]));

  const start = async () => {
    const slots: PlayerSlot[] = slotPositions
      .map((position, i) => ({ playerId: lineup[i] ?? '', position }))
      .filter((s) => s.playerId);

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
      subtitle={`${game.config.periods.count} × ${Math.round(game.config.periods.lengthMs / 60_000)} min · ${fieldPlayers} a side`}
      onBack={() => navigate({ name: 'team', teamId: game.teamId })}
      footer={
        <div className="actions">
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
      <p className="small muted">Tap to mark someone absent. Only players who are here get playing-time targets.</p>

      <h2 style={{ marginTop: 8 }}>Starting lineup · {filled} of {needed}</h2>
      <div className="plist">
        {slotPositions.map((position, i) => {
          const player = lineup[i] ? byId.get(lineup[i] as string) : undefined;
          return (
            <button key={i} className={`prow${player ? ' on' : ''}`} onClick={() => setPicking(i)}>
              <span className="pos">{position}</span>
              <span className="grow">
                <span className={player ? 'name' : 'name muted'}>
                  {player ? player.name : 'Tap to assign'}
                </span>
              </span>
              {player?.number && <span className="num-badge">{player.number}</span>}
            </button>
          );
        })}
      </div>

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

      {picking !== null && (
        <Sheet title={`${slotPositions[picking]} — pick a player`} onClose={() => setPicking(null)}>
          <div className="chips">
            {present.map((p) => {
              const takenAt = Object.entries(lineup).find(([, id]) => id === p.id)?.[0];
              const isHere = takenAt === String(picking);
              return (
                <button
                  key={p.id}
                  className={`chip${isHere ? ' sel' : ''}`}
                  disabled={assigned.has(p.id) && !isHere}
                  style={assigned.has(p.id) && !isHere ? { opacity: 0.35 } : undefined}
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
              Clear this slot
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
