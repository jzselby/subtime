import type { GameEvent } from '@touchline/core';
import { formatClock } from '@touchline/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { periodTag, Screen, Sheet } from '../components';
import { db } from '../db';
import { describeEvent, isEditable } from '../describe';
import { useGameLog } from '../hooks';
import { navigate } from '../router';

const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};

/**
 * Correct anything already recorded.
 *
 * This is the payoff of storing a game as an event log rather than a pile of
 * counters: fixing a mis-attributed goal is editing one row, and every number
 * in the app — minutes, plus/minus, the fairness table, the timeline — re-derives
 * from the corrected log with no reconciliation anywhere.
 *
 * Ids, sequence numbers and clock positions are preserved on an edit. Only the
 * payload changes, because what is being corrected is the recording, not when
 * it happened.
 */
export function EventsScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const config = game?.config ?? DEFAULT_CFG;
  const { events, errors } = useGameLog(gameId, config);
  const [editing, setEditing] = useState<GameEvent | null>(null);
  const [showAttendance, setShowAttendance] = useState(false);

  const roster = useMemo(
    () =>
      [...(players ?? [])].sort(
        (a, b) =>
          (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name),
      ),
    [players],
  );
  const nameOf = useMemo(() => {
    const map = new Map(roster.map((p) => [p.id, p]));
    return (id: string) => map.get(id);
  }, [roster]);

  if (!game) return <Screen title="Loading…">{null}</Screen>;

  /*
   * Go back where you came from. This screen is reachable from both the game
   * and the stats, and picking a destination by game status sent you to the
   * live screen even when you had arrived from the summary.
   */
  const back = () => {
    if (window.history.length > 1) window.history.back();
    else navigate(game.status === 'final' ? { name: 'summary', gameId } : { name: 'live', gameId });
  };

  // Newest first: a mistake is nearly always one you just made.
  const ordered = [...events].reverse();
  /*
   * Attendance is one row per player, so on a real roster it buries everything
   * that actually happened. It is edited from the Who's here checklist anyway —
   * hidden here by default, one tap away when you want it.
   */
  const attendanceCount = ordered.filter((e) => e.type === 'ATTENDANCE').length;
  const shown = showAttendance ? ordered : ordered.filter((e) => e.type !== 'ATTENDANCE');

  return (
    <Screen
      title="Modify events"
      subtitle={`${events.length} recorded · vs ${game.opponent || 'TBD'}`}
      onBack={back}
    >
      {errors.length > 0 && (
        <div className="banner error">
          {errors.length} event{errors.length === 1 ? '' : 's'} no longer applies —{' '}
          {errors[errors.length - 1]?.reason}. Deleting an event the rest of the game
          depended on can do this; undo it by putting the change back.
        </div>
      )}

      <p className="small muted">
        Tap anything to correct or remove it. Minutes, stats and the timeline all
        recalculate from the log, so a fix here fixes everything.
      </p>

      <div className="plist">
        {shown.map((e) => (
          <button key={e.id} className="prow" onClick={() => setEditing(e)}>
            <span className="evtime">
              {periodTag(config.periods.count, e.period)} {formatClock(e.gameClockMs)}
            </span>
            <span className="grow">
              <span className="name">{describeEvent(e, nameOf)}</span>
            </span>
            <span className="muted">›</span>
          </button>
        ))}
        {events.length === 0 && <div className="empty">Nothing recorded yet.</div>}
      </div>

      {attendanceCount > 0 && (
        <button className="btn block" onClick={() => setShowAttendance((v) => !v)}>
          {showAttendance ? 'Hide' : 'Show'} attendance ({attendanceCount})
        </button>
      )}

      {editing && (
        <EditSheet
          event={editing}
          roster={roster}
          nameOf={nameOf}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            // Identity, order and clock position are preserved: a mis-tap is a
            // wrong recording of a real moment, not a different moment.
            await db.events.update(editing.id, patch);
            setEditing(null);
          }}
          onDelete={async () => {
            await db.events.delete(editing.id);
            setEditing(null);
          }}
        />
      )}
    </Screen>
  );
}

function EditSheet({
  event,
  roster,
  nameOf,
  onClose,
  onSave,
  onDelete,
}: {
  event: GameEvent;
  roster: { id: string; name: string; number: string }[];
  nameOf: (id: string) => { name: string } | undefined;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [pick, setPick] = useState<'scorer' | 'assist' | 'player' | null>(null);

  const chips = (selected: string | null, onPick: (id: string | null) => void) => (
    <div className="chips">
      {roster.map((p) => (
        <button
          key={p.id}
          className={`chip${selected === p.id ? ' sel' : ''}`}
          onClick={() => onPick(p.id)}
        >
          {p.number && <b>{p.number}</b>} {p.name}
        </button>
      ))}
      <button className={`chip${selected === null ? ' sel' : ''}`} onClick={() => onPick(null)}>
        Nobody
      </button>
    </div>
  );

  if (pick === 'scorer' && event.type === 'GOAL') {
    return (
      <Sheet title="Who actually scored?" onClose={() => setPick(null)}>
        {chips(event.scorerId, (id) => void onSave({ scorerId: id }))}
      </Sheet>
    );
  }
  if (pick === 'assist' && event.type === 'GOAL') {
    return (
      <Sheet title="Who actually assisted?" onClose={() => setPick(null)}>
        {chips(event.assistId ?? null, (id) => void onSave({ assistId: id }))}
      </Sheet>
    );
  }
  if (pick === 'player' && event.type === 'CARD') {
    return (
      <Sheet title="Who was carded?" onClose={() => setPick(null)}>
        {chips(event.playerId, (id) => id && void onSave({ playerId: id }))}
      </Sheet>
    );
  }

  return (
    <Sheet title={describeEvent(event, nameOf)} onClose={onClose}>
      <div style={{ display: 'grid', gap: 8 }}>
        {event.type === 'GOAL' && (
          <>
            <button className="btn block" onClick={() => setPick('scorer')}>
              Change scorer — {event.scorerId ? nameOf(event.scorerId)?.name : 'unknown'} ›
            </button>
            <button className="btn block" onClick={() => setPick('assist')}>
              Change assist — {event.assistId ? nameOf(event.assistId)?.name : 'none'} ›
            </button>
            <button
              className="btn block"
              onClick={() => void onSave({ ownGoal: !event.ownGoal })}
            >
              {event.ownGoal ? 'Not an own goal' : 'Mark as own goal'}
            </button>
          </>
        )}

        {event.type === 'CARD' && (
          <>
            <button className="btn block" onClick={() => setPick('player')}>
              Change player — {nameOf(event.playerId)?.name ?? '?'} ›
            </button>
            <button
              className="btn block"
              onClick={() => void onSave({ card: event.card === 'yellow' ? 'red' : 'yellow' })}
            >
              Change to {event.card === 'yellow' ? 'red' : 'yellow'}
            </button>
          </>
        )}

        {!isEditable(event) && (
          <p className="small muted">
            There is nothing to correct on this one — remove it and record it again if
            it is wrong.
          </p>
        )}

        <button className="btn danger block" onClick={() => void onDelete()}>
          Delete this event
        </button>
      </div>
    </Sheet>
  );
}
