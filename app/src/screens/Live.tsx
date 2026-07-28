import type { GameEvent, PlayerSlot } from '@subtime/core';
import { clockAt, displayClockMs, fairness, formatClock, playerStats } from '@subtime/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { beep, heatColor, mmss, PlayerRow, Screen, Sheet } from '../components';
import { db } from '../db';
import { codesOf } from '../formations';
import { useGameLog, useNow, useWakeLock } from '../hooks';
import type { Occupant } from '../Pitch';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};

export function LiveScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const team = useLiveQuery(
    async () => (game ? db.teams.get(game.teamId) : undefined),
    [game?.teamId],
  );
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const config = game?.config ?? DEFAULT_CFG;
  const { state, errors, events, record, undo } = useGameLog(gameId, config);

  const running = state.status === 'running';
  const now = useNow(running);
  useWakeLock(running || state.status === 'paused');

  const [view, setView] = useState<'field' | 'list'>('field');
  const [pickedOff, setPickedOff] = useState<Set<string>>(new Set());
  const [pickedOn, setPickedOn] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'goal' | 'log' | null>(null);
  const [movingPlayer, setMovingPlayer] = useState<string | null>(null);
  const [fillingSlot, setFillingSlot] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map((players ?? []).map((p) => [p.id, p]));
    return (id: string) => map.get(id);
  }, [players]);

  // Keep the stored game status in step with the folded state, so the games
  // list and deep links land on the right screen.
  useEffect(() => {
    if (!game) return;
    const want = state.status === 'final' ? 'final' : 'live';
    if (game.status !== want) void db.games.update(gameId, { status: want });
  }, [state.status, game, gameId]);

  const rows = useMemo(() => fairness(state, now), [state, now]);
  const stats = useMemo(
    () => new Map(playerStats(state, now).map((s) => [s.playerId, s])),
    [state, now],
  );

  const onFieldRows = rows.filter((r) => r.onField);
  const benchRows = rows.filter((r) => !r.onField);
  const clock = clockAt(state, now);

  // Shift alarm: nudge when it has been a while since the last change.
  const lastSubClock = useMemo(() => {
    let last = 0;
    for (const e of events) {
      if ((e.type === 'SUB' || e.type === 'PERIOD_START') && e.period === state.period) {
        last = e.type === 'PERIOD_START' ? 0 : e.gameClockMs;
      }
    }
    return last;
  }, [events, state.period]);

  const shiftMs = Math.max(60_000, Math.round(config.periods.lengthMs / 4));
  const shiftDue = running && clock - lastSubClock >= shiftMs;
  const alarmed = useRef(false);
  useEffect(() => {
    if (shiftDue && !alarmed.current) {
      alarmed.current = true;
      beep(2);
    }
    if (!shiftDue) alarmed.current = false;
  }, [shiftDue]);

  if (!game || !team) return <Screen title="Loading…">{null}</Screen>;

  const formation = game.formation;
  const positions = codesOf(formation);
  const deficitOf = new Map(rows.map((r) => [r.playerId, r.deficitMs]));

  /*
   * The engine stores a position code per player; the pitch needs a slot id.
   * Codes are unique within a formation, so one lookup bridges the two — which
   * is exactly why `buildFormation` goes to the trouble of de-duplicating them.
   */
  const slotByCode = new Map(formation.slots.map((s) => [s.code, s]));
  const occupants = new Map<string, Occupant>();
  for (const [playerId, code] of state.onField) {
    const slot = slotByCode.get(code);
    if (!slot) continue;
    const p = nameOf(playerId);
    occupants.set(slot.id, {
      playerId,
      name: p?.name ?? playerId,
      number: p?.number ?? '',
      playedMs: stats.get(playerId)?.playedMs ?? 0,
      ...(deficitOf.has(playerId) ? { deficitMs: deficitOf.get(playerId) as number } : {}),
    });
  }
  const freeCodes = formation.slots.filter((s) => !occupants.has(s.id)).map((s) => s.code);

  const makeSub = async () => {
    const off = [...pickedOff];
    const on = [...pickedOn];
    const freed = off.map((id) => state.onField.get(id) ?? positions[0] ?? 'MF');
    const spare = [...freeCodes];

    const slots: PlayerSlot[] = on.map((playerId, i) => ({
      playerId,
      // A straight swap inherits the outgoing player's position. Anyone extra
      // fills a position nobody is occupying.
      position: freed[i] ?? spare.shift() ?? positions[0] ?? 'MF',
    }));

    await record({ type: 'SUB', off, on: slots });
    setPickedOff(new Set());
    setPickedOn(new Set());
  };

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  /**
   * Tapping an empty position does one of two things, whichever the current
   * selection implies: move the single selected player there, or open the bench
   * to fill it.
   */
  const tapVacant = (slotCode: string, slotId: string) => {
    if (pickedOff.size === 1) {
      const playerId = [...pickedOff][0] as string;
      void record({ type: 'POSITION_CHANGE', playerId, to: slotCode });
      setPickedOff(new Set());
      return;
    }
    setFillingSlot(slotId);
  };

  const periodLabel =
    state.period === 0
      ? 'Not started'
      : config.periods.count === 2
        ? state.period === 1
          ? '1st half'
          : '2nd half'
        : `Period ${state.period}`;

  const hasSelection = pickedOff.size > 0 || pickedOn.size > 0;

  return (
    <Screen
      title={`${team.name} vs ${game.opponent || 'TBD'}`}
      subtitle={`${periodLabel} · ${formation.name}`}
      onBack={() => navigate({ name: 'team', teamId: game.teamId })}
      action={
        <button className="btn ghost" onClick={() => navigate({ name: 'summary', gameId })}>
          Stats
        </button>
      }
      footer={
        hasSelection ? (
          <div className="subbar">
            <div className="row spread small">
              <span className="muted">
                Off: {[...pickedOff].map((id) => nameOf(id)?.name ?? '?').join(', ') || '—'}
              </span>
              <span className="muted">
                On: {[...pickedOn].map((id) => nameOf(id)?.name ?? '?').join(', ') || '—'}
              </span>
            </div>
            <div className="row">
              <button
                className="btn ghost"
                onClick={() => {
                  setPickedOff(new Set());
                  setPickedOn(new Set());
                }}
              >
                Cancel
              </button>
              <button className="btn primary grow lg" onClick={() => void makeSub()}>
                Sub {pickedOff.size} ↔ {pickedOn.size}
              </button>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button className="btn" onClick={() => setSheet('goal')} disabled={state.period === 0}>
              ⚽ Us
            </button>
            <button
              className="btn"
              onClick={() => void record({ type: 'OPPONENT_GOAL' })}
              disabled={state.period === 0}
            >
              ⚽ Them
            </button>
            <button className="btn" onClick={() => void undo()} disabled={events.length === 0}>
              ↩ Undo
            </button>
            <button className="btn" onClick={() => setSheet('log')}>
              ☰ Log
            </button>
          </div>
        )
      }
    >
      {errors.length > 0 && (
        <div className="banner error">
          {errors.length} event{errors.length === 1 ? '' : 's'} could not be applied.{' '}
          {errors[errors.length - 1]?.reason}
        </div>
      )}

      {/*
        The pitch is the interface during a game, so everything above it is kept
        as short as it can be — a tall clock card looks impressive and pushes the
        thing you actually tap below the fold.
      */}
      <div className="card livebar">
        <div className="lb-clock">
          <span className={`time${state.status === 'paused' ? ' paused' : ''}`}>
            {formatClock(displayClockMs(config, Math.max(state.period, 1), clock))}
          </span>
          <span className="meta">
            {state.status === 'paused'
              ? 'stopped'
              : state.status === 'final'
                ? 'full time'
                : state.status === 'break'
                  ? `${periodLabel} done`
                  : periodLabel}
          </span>
        </div>
        <div className="scoreline">
          <span>{state.score.us}</span>
          <span className="vs">–</span>
          <span>{state.score.them}</span>
        </div>
      </div>
      {shiftDue && (
        <div className="banner error">
          Shift due — last change {mmss(clock - lastSubClock)} ago
        </div>
      )}

      <PeriodControls
        status={state.status}
        period={state.period}
        count={config.periods.count}
        onStart={() => void record({ type: 'PERIOD_START' })}
        onPause={() => void record({ type: 'CLOCK_PAUSE' })}
        onResume={() => void record({ type: 'CLOCK_RESUME' })}
        onEnd={() => void record({ type: 'PERIOD_END' })}
        onSummary={() => navigate({ name: 'summary', gameId })}
      />

      <div className="seg" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={view === 'field'}
          className={view === 'field' ? 'on' : ''}
          onClick={() => setView('field')}
        >
          Field
        </button>
        <button
          role="tab"
          aria-selected={view === 'list'}
          className={view === 'list' ? 'on' : ''}
          onClick={() => setView('list')}
        >
          List
        </button>
      </div>

      {view === 'field' ? (
        <>
          <Pitch
            formation={formation}
            occupants={occupants}
            selected={pickedOff}
            onSlotTap={(slot, occupant) =>
              occupant
                ? toggle(pickedOff, occupant.playerId, setPickedOff)
                : tapVacant(slot.code, slot.id)
            }
          />

          <h2>Bench · {benchRows.length}</h2>
          {benchRows.length === 0 ? (
            <div className="empty">Everyone is on.</div>
          ) : (
            <div className="benchstrip">
              {benchRows.map((row) => {
                const p = nameOf(row.playerId);
                return (
                  <button
                    key={row.playerId}
                    className={`bplayer${pickedOn.has(row.playerId) ? ' picked' : ''}`}
                    onClick={() => toggle(pickedOn, row.playerId, setPickedOn)}
                  >
                    <span className="shirt" style={{ borderColor: heatColor(row.deficitMs) }}>
                      {p?.number || p?.name.slice(0, 2) || '?'}
                    </span>
                    <span className="tname">{p?.name ?? row.playerId}</span>
                    <span className="ttime">{mmss(stats.get(row.playerId)?.playedMs ?? 0)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="small muted">
            Tap a player on the pitch, then one on the bench, to swap them. Bench
            is ordered by who is owed the most time; the ring colour says the same
            thing. Tap an empty position to fill it — or select one player first
            and tap an empty position to move them there.
          </p>
        </>
      ) : (
        <>
          <h2>On the field · {onFieldRows.length}</h2>
          <div className="plist">
            {onFieldRows.map((row) => {
              const p = nameOf(row.playerId);
              return (
                <PlayerRow
                  key={row.playerId}
                  name={p?.name ?? row.playerId}
                  number={p?.number ?? ''}
                  position={state.onField.get(row.playerId)}
                  playedMs={stats.get(row.playerId)?.playedMs ?? 0}
                  deficitMs={row.deficitMs}
                  picked={pickedOff.has(row.playerId)}
                  onClick={() => toggle(pickedOff, row.playerId, setPickedOff)}
                  onPositionClick={() => setMovingPlayer(row.playerId)}
                />
              );
            })}
          </div>

          <h2>Bench · {benchRows.length}</h2>
          {benchRows.length === 0 && <div className="empty">Everyone is on.</div>}
          <div className="plist">
            {benchRows.map((row) => {
              const p = nameOf(row.playerId);
              return (
                <PlayerRow
                  key={row.playerId}
                  name={p?.name ?? row.playerId}
                  number={p?.number ?? ''}
                  playedMs={stats.get(row.playerId)?.playedMs ?? 0}
                  deficitMs={row.deficitMs}
                  picked={pickedOn.has(row.playerId)}
                  onClick={() => toggle(pickedOn, row.playerId, setPickedOn)}
                />
              );
            })}
          </div>
          <p className="small muted">
            Sorted by who is owed the most time. Tap a player on the field, then a
            player on the bench, to swap them.
          </p>
        </>
      )}

      {fillingSlot && (
        <Sheet
          title={`${formation.slots.find((s) => s.id === fillingSlot)?.code ?? ''} — who goes on?`}
          onClose={() => setFillingSlot(null)}
        >
          <div className="chips">
            {benchRows.map((row) => {
              const p = nameOf(row.playerId);
              const code = formation.slots.find((s) => s.id === fillingSlot)?.code ?? 'MF';
              return (
                <button
                  key={row.playerId}
                  className="chip"
                  onClick={() => {
                    void record({
                      type: 'SUB',
                      off: [],
                      on: [{ playerId: row.playerId, position: code }],
                    });
                    setFillingSlot(null);
                  }}
                >
                  {p?.number && <b>{p.number}</b>} {p?.name ?? row.playerId}
                </button>
              );
            })}
            {benchRows.length === 0 && <p className="muted">Nobody is on the bench.</p>}
          </div>
        </Sheet>
      )}

      {sheet === 'goal' && (
        <GoalSheet
          onField={[...state.onField.keys()]}
          nameOf={nameOf}
          onClose={() => setSheet(null)}
          onSubmit={(scorerId, assistId) => {
            void record({ type: 'GOAL', scorerId, assistId });
            setSheet(null);
          }}
        />
      )}

      {sheet === 'log' && (
        <Sheet title="Event log" onClose={() => setSheet(null)}>
          <div className="log">
            {[...events].reverse().map((e) => (
              <div key={e.id}>
                <time>{formatClock(displayClockMs(config, Math.max(e.period, 1), e.gameClockMs))}</time>
                <span>{describe(e, nameOf)}</span>
              </div>
            ))}
            {events.length === 0 && <p className="muted">Nothing recorded yet.</p>}
          </div>
        </Sheet>
      )}

      {movingPlayer && (
        <Sheet
          title={`Move ${nameOf(movingPlayer)?.name ?? 'player'}`}
          onClose={() => setMovingPlayer(null)}
        >
          <div className="chips">
            {positions.map((position) => (
              <button
                key={position}
                className={`chip${state.onField.get(movingPlayer) === position ? ' sel' : ''}`}
                onClick={() => {
                  void record({ type: 'POSITION_CHANGE', playerId: movingPlayer, to: position });
                  setMovingPlayer(null);
                }}
              >
                {position}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

function PeriodControls({
  status,
  period,
  count,
  onStart,
  onPause,
  onResume,
  onEnd,
  onSummary,
}: {
  status: string;
  period: number;
  count: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onSummary: () => void;
}) {
  if (status === 'final') {
    return (
      <button className="btn primary block lg" onClick={onSummary}>
        Full time — see the stats
      </button>
    );
  }
  if (status === 'pregame' || status === 'break') {
    return (
      <button className="btn primary block lg" onClick={onStart}>
        Start {ordinal(period + 1)} {count === 2 ? 'half' : 'period'}
      </button>
    );
  }
  return (
    <div className="row">
      {status === 'running' ? (
        <button className="btn warn grow lg" onClick={onPause}>
          Stop clock
        </button>
      ) : (
        <button className="btn primary grow lg" onClick={onResume}>
          Restart clock
        </button>
      )}
      <button
        className="btn grow lg"
        onClick={() => {
          if (confirm(`End the ${ordinal(period)} period?`)) onEnd();
        }}
      >
        End {ordinal(period)}
      </button>
    </div>
  );
}

function GoalSheet({
  onField,
  nameOf,
  onClose,
  onSubmit,
}: {
  onField: string[];
  nameOf: (id: string) => { name: string; number: string } | undefined;
  onClose: () => void;
  onSubmit: (scorerId: string | null, assistId: string | null) => void;
}) {
  const [scorer, setScorer] = useState<string | null>(null);

  // Two taps, both from the on-field set only — nobody wants to scroll a full
  // roster while the team is still celebrating.
  if (!scorer) {
    return (
      <Sheet title="Who scored?" onClose={onClose}>
        <div className="chips">
          {onField.map((id) => (
            <button key={id} className="chip" onClick={() => setScorer(id)}>
              {nameOf(id)?.number && <b>{nameOf(id)?.number}</b>} {nameOf(id)?.name ?? id}
            </button>
          ))}
          <button className="chip" onClick={() => onSubmit(null, null)}>
            Not sure
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Assist?" onClose={onClose}>
      <p className="small muted">Goal: {nameOf(scorer)?.name}</p>
      <div className="chips">
        {onField
          .filter((id) => id !== scorer)
          .map((id) => (
            <button key={id} className="chip" onClick={() => onSubmit(scorer, id)}>
              {nameOf(id)?.number && <b>{nameOf(id)?.number}</b>} {nameOf(id)?.name ?? id}
            </button>
          ))}
        <button className="chip sel" onClick={() => onSubmit(scorer, null)}>
          No assist
        </button>
      </div>
    </Sheet>
  );
}

const ordinal = (n: number): string => ['0th', '1st', '2nd', '3rd', '4th'][n] ?? `${n}th`;

/** Human-readable line for the event log. Narrows on the discriminated union. */
function describe(e: GameEvent, nameOf: (id: string) => { name: string } | undefined): string {
  const nm = (id: string | null | undefined) => (id ? (nameOf(id)?.name ?? '?') : 'unknown');
  switch (e.type) {
    case 'PERIOD_START':
      return `Period ${e.period} started`;
    case 'PERIOD_END':
      return `Period ${e.period} ended`;
    case 'CLOCK_PAUSE':
      return 'Clock stopped';
    case 'CLOCK_RESUME':
      return 'Clock restarted';
    case 'SUB': {
      const off = e.off.map(nm).join(', ') || '—';
      const on = e.on.map((s) => nm(s.playerId)).join(', ') || '—';
      return `Sub: ${off} off, ${on} on`;
    }
    case 'POSITION_CHANGE':
      return `${nm(e.playerId)} → ${e.to}`;
    case 'GOAL':
      return `Goal: ${nm(e.scorerId)}${e.assistId ? ` (assist ${nm(e.assistId)})` : ''}${e.ownGoal ? ' — own goal' : ''}`;
    case 'OPPONENT_GOAL':
      return 'Opponent scored';
    case 'SET_LINEUP':
      return `Lineup set (${e.slots.length} players)`;
    case 'ATTENDANCE':
      return `${nm(e.playerId)}: ${e.status}`;
    case 'CARD':
      return `${e.card} card: ${nm(e.playerId)}`;
    case 'NOTE':
      return e.text;
    default:
      return e.type;
  }
}
