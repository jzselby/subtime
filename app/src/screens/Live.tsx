import type { GameEvent, PlayerSlot } from '@touchline/core';
import { clockAt, fairness, formatClock, playerStats } from '@touchline/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  beep,
  confirmCue,
  heatColor,
  HoldButton,
  initials,
  mmss,
  periodTag,
  PlayerRow,
  Sheet,
  useToast,
} from '../components';
import { db, deleteGame } from '../db';
import { describeEvent } from '../describe';
import { codesOf } from '../formations';
import type { EventInput } from '../hooks';
import { useGameLog, useNow, useWakeLock } from '../hooks';
import type { DropTarget } from '../usePitchDrag';
import { usePitchDrag } from '../usePitchDrag';
import type { Occupant } from '../Pitch';
import { Pitch } from '../Pitch';
import { navigate } from '../router';

const EMPTY_FORMATION = { name: '', slots: [] };

const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};

/**
 * The game screen.
 *
 * The pitch is the interface, so it gets the screen: full-bleed and taking every
 * pixel not needed by the bar above and the bench below. Everything else is
 * deliberately small — the clock, score and transport live in one thin strip,
 * and infrequent controls (ending a period, jumping to stats) sit behind a menu
 * rather than spending a row of height each.
 */
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
  const { state, errors, events, record, recordMany, undo } = useGameLog(gameId, config);

  const running = state.status === 'running';
  const now = useNow(running);
  useWakeLock(running || state.status === 'paused');

  const [view, setView] = useState<'field' | 'list'>('field');
  const [pickedOff, setPickedOff] = useState<Set<string>>(new Set());
  const [pickedOn, setPickedOn] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'goal' | 'log' | 'menu' | null>(null);
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

  /*
   * Drop anyone from a selection the moment they change sides. A selection that
   * outlives its player is not harmless: "take this one off" still pointing at
   * someone already on the bench turned a tap on an empty shirt into a position
   * change for a player who was not on the field.
   */
  const onFieldKey = [...state.onField.keys()].sort().join(',');
  useEffect(() => {
    const on = new Set(onFieldKey ? onFieldKey.split(',') : []);
    const prune = (keep: (id: string) => boolean) => (prev: Set<string>) => {
      const next = new Set([...prev].filter(keep));
      return next.size === prev.size ? prev : next;
    };
    setPickedOff(prune((id) => on.has(id)));
    setPickedOn(prune((id) => !on.has(id)));
  }, [onFieldKey]);

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

  /*
   * Confirmation is driven off the log rather than the call sites, so anything
   * that records an event confirms itself — a tap, a drag, a sheet, a swap —
   * and a new kind of action cannot be added without one. It also means the
   * wording is the same as the event log's, so a toast and the log agree.
   *
   * Only growth speaks. A shrink is an undo, which announces itself from the
   * button with the description of what it removed.
   */
  const { notify, toast } = useToast();
  const seen = useRef(-1);
  useEffect(() => {
    const count = events.length;
    const before = seen.current;
    seen.current = count;
    // The first fold is the game loading, not something the coach just did.
    if (before < 0 || count <= before) return;
    const e = events[count - 1];
    if (!e) return;
    notify(describeEvent(e, nameOf));
    /*
     * Silent for the four that already have their own unmissable signal: a
     * position change is a drag the coach is watching, and pause/resume/end
     * are the transport button itself flipping colour under their thumb.
     * Everything else — a sub, a goal, a card — happens while the coach is
     * looking at the field, not the phone, and needs a sound to reach them.
     */
    const silent: GameEvent['type'][] = [
      'POSITION_CHANGE',
      'CLOCK_PAUSE',
      'CLOCK_RESUME',
      'PERIOD_START',
      'PERIOD_END',
    ];
    if (!silent.includes(e.type)) confirmCue();
  }, [events, nameOf, notify]);

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

  // Falls back to an empty shape while the game record loads, so every hook
  // below runs unconditionally.
  const formation = game?.formation ?? EMPTY_FORMATION;
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
    if (dragged.current) return;
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  /*
   * Where a dropped player lands. Bench onto an occupied shirt is a straight
   * swap; onto an empty one is just on. A player dropped on the bench comes
   * off, and one dropped on another trades places with them.
   */
  const onDrop = (from: 'bench' | string, playerId: string, target: DropTarget) => {
    if (from === 'bench') {
      if (!target.slotId) return;
      const slot = formation.slots.find((s) => s.id === target.slotId);
      if (!slot) return;
      const sitting = occupants.get(target.slotId);
      void record({
        type: 'SUB',
        off: sitting ? [sitting.playerId] : [],
        on: [{ playerId, position: slot.code }],
      });
      return;
    }

    if (target.onBench) {
      void record({ type: 'SUB', off: [playerId], on: [] });
      return;
    }
    if (!target.slotId || target.slotId === from) return;
    const slot = formation.slots.find((s) => s.id === target.slotId);
    const fromSlot = formation.slots.find((s) => s.id === from);
    if (!slot) return;
    const sitting = occupants.get(target.slotId);
    if (sitting && fromSlot) {
      // One batch, so the fold never rests with both holding the same code.
      const swap: EventInput[] = [
        { type: 'POSITION_CHANGE', playerId, to: slot.code },
        { type: 'POSITION_CHANGE', playerId: sitting.playerId, to: fromSlot.code },
      ];
      void recordMany(swap);
    } else {
      void record({ type: 'POSITION_CHANGE', playerId, to: slot.code });
    }
  };

  const { startDrag, ghost, dropSlotId, dragged } = usePitchDrag(onDrop);

  if (!game || !team) return <div className="app" />;

  /**
   * Tapping an empty position does one of two things, whichever the current
   * selection implies: move the single selected player there, or open the bench
   * to fill it.
   */
  const tapVacant = (slotCode: string, slotId: string) => {
    // A drag that ends over a vacant shirt still delivers pointerup to it, so
    // this fires on the tail of every bench→pitch drop unless it is guarded.
    if (dragged.current) return;
    if (pickedOff.size === 1) {
      const playerId = [...pickedOff][0] as string;
      void record({ type: 'POSITION_CHANGE', playerId, to: slotCode });
      setPickedOff(new Set());
      return;
    }
    setFillingSlot(slotId);
  };

  const periodLabel = periodTag(config.periods.count, state.period);

  const statusLabel =
    state.status === 'final'
      ? 'FT'
      : state.status === 'break'
        ? `${periodLabel} done`
        : state.status === 'paused'
          ? 'stopped'
          : periodLabel;

  const hasSelection = pickedOff.size > 0 || pickedOn.size > 0;
  const canPlay = state.status !== 'final';
  const inPeriod = state.status === 'running' || state.status === 'paused';

  /*
   * The app is told the half length at setup and then never used it for anything
   * the coach could see: the clock counted serenely past full time in the same
   * white as a clock at 0:30. In youth soccer the coach is often the timekeeper,
   * and is always the one who needs the last rotation to land before the whistle.
   */
  const overrunMs = inPeriod ? clock - config.periods.lengthMs : 0;
  const overrun = overrunMs > 0;

  const transport = () => {
    if (state.status === 'running') void record({ type: 'CLOCK_PAUSE' });
    else if (state.status === 'paused') void record({ type: 'CLOCK_RESUME' });
    else if (state.status === 'pregame' || state.status === 'break')
      void record({ type: 'PERIOD_START' });
  };

  const transportLabel =
    state.status === 'running'
      ? 'Pause'
      : state.status === 'paused'
        ? 'Resume'
        : state.status === 'break'
          ? `Start ${periodTag(config.periods.count, state.period + 1)}`
          : state.status === 'pregame'
            ? 'Start'
            : 'Full time';

  const undoLast = () => {
    const last = events[events.length - 1];
    const what = last ? describeEvent(last, nameOf) : '';
    void undo().then(() => {
      notify(what ? `Undid — ${what}` : 'Undone');
      confirmCue();
    });
  };

  /*
   * "↩ Undo" sits at the single easiest thumb target on the phone and used to
   * say nothing about what it would remove — a coach who suspected a tap had
   * not registered had every reason to tap it again "to be sure", and a bare
   * label gave them no way to tell that would remove two events instead of
   * confirming one. Naming the target is the cheaper fix; the toast above
   * confirms what actually happened once it has.
   */
  const undoNoun: Partial<Record<GameEvent['type'], string>> = {
    SUB: 'sub',
    GOAL: 'goal',
    OPPONENT_GOAL: 'goal',
    POSITION_CHANGE: 'move',
    CARD: 'card',
    PERIOD_START: 'start',
    PERIOD_END: 'end',
    CLOCK_PAUSE: 'pause',
    CLOCK_RESUME: 'resume',
  };
  const lastEvent = events[events.length - 1];
  const undoLabel = lastEvent
    ? `↩ Undo ${undoNoun[lastEvent.type] ?? lastEvent.type.toLowerCase()}`
    : '↩ Undo';

  /*
   * The sub button used to read "Sub 1 ↔ 0" in full primary green and, tapped,
   * would quietly play the team a man short. The arithmetic was the label; the
   * consequence was invisible. Now the button says what will be true afterwards,
   * and anything that leaves the wrong number on the field is a warning rather
   * than the same green as a straight swap.
   */
  const resultingOnField = state.onField.size - pickedOff.size + pickedOn.size;
  const wrongCount = resultingOnField !== config.periods.fieldPlayers;
  const listNames = (ids: Iterable<string>) => {
    const all = [...ids].map((id) => nameOf(id)?.name ?? '?');
    return all.length <= 2 ? all.join(' and ') : `${all.length} players`;
  };
  const subLabel =
    pickedOn.size === 0
      ? `Take ${listNames(pickedOff)} off — play ${resultingOnField}`
      : pickedOff.size === 0
        ? `Put ${listNames(pickedOn)} on — play ${resultingOnField}`
        : `Sub ${pickedOff.size} ↔ ${pickedOn.size}${wrongCount ? ` — play ${resultingOnField}` : ''}`;

  return (
    <div className="app">
      {/* Clock and score live in one thin strip; transport moved to the bottom
          bar, in the thumb's reach, rather than sharing this row with it. */}
      <header className="gamebar">
        <div className="gbar-side">
          <button
            className="gbtn"
            onClick={() => navigate({ name: 'team', teamId: game.teamId })}
            aria-label="Back"
          >
            ‹
          </button>
          <button className="gbtn" onClick={() => setSheet('log')} aria-label="Event log">
            ☰
          </button>
        </div>

        {/*
         * Absolutely positioned and centered on the bar itself, not just
         * within whatever space the side buttons leave behind. Two buttons
         * sit on the left (Back, the event log) and one on the right (•••),
         * so centering this the ordinary flex-item way — one flex-auto box
         * squeezed between two unequal groups — put it visibly off-centre,
         * shifted toward the lighter side. This can't drift with however
         * many buttons end up on either side.
         */}
        <div className="gclock">
          {/* Score sits beside the clock rather than folded into the small
              meta line beneath it — same row, so the bar's height (and with
              it the pitch below) doesn't grow, but the score itself reads at
              a size a coach can actually catch at a glance, not squeezed in
              at 11px next to the period label. */}
          <span className="gtoprow">
            <span
              className={`time${state.status === 'paused' ? ' paused' : overrun ? ' overrun' : ''}`}
            >
              {formatClock(clock)}
            </span>
            <span className="gscore">
              {state.score.us}–{state.score.them}
            </span>
          </span>
          <span className="meta">
            {statusLabel}
            {overrun && ` · +${formatClock(overrunMs)}`}
          </span>
        </div>

        <div className="gbar-side">
          {/*
           * Used to live one tap deeper, inside the ••• menu. Coaches check
           * this mid-game often enough that a menu in between was a real
           * cost, worth the header's width over adding it to the ••• menu
           * where it now just duplicates this — text, not a fourth
           * unlabelled glyph next to ‹ ☰ •••, so what it does is legible at
           * a glance.
           */}
          <button
            className="gbtn wide"
            onClick={() => navigate({ name: 'summary', gameId })}
            aria-label="Stats and playing time"
          >
            Stats
          </button>
          <button className="gbtn" onClick={() => setSheet('menu')} aria-label="More">
            •••
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="banner error" style={{ margin: '8px 12px 0' }}>
          {errors.length} event{errors.length === 1 ? '' : 's'} could not be applied.{' '}
          {errors[errors.length - 1]?.reason}
        </div>
      )}

      {view === 'field' ? (
        <div className={`pitchwrap bleed${state.status === 'paused' ? ' paused' : ''}`}>
          <Pitch
            formation={formation}
            occupants={occupants}
            selected={pickedOff}
            onSlotTap={(slot, occupant) =>
              occupant
                ? toggle(pickedOff, occupant.playerId, setPickedOff)
                : tapVacant(slot.code, slot.id)
            }
            onTokenPointerDown={(slot, occupant, e) =>
              occupant &&
              startDrag(
                occupant.playerId,
                slot.id,
                occupant.number || initials(occupant.name),
              )(e)
            }
            dropSlotId={dropSlotId}
          >
            <span className="fname">{formation.name}</span>
            {shiftDue && <span className="shiftpill">Shift due</span>}
            {state.status === 'paused' && <span className="pausebadge">⏸ Paused</span>}
          </Pitch>
        </div>
      ) : (
        <div className="pane">
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
        </div>
      )}

      {view === 'field' && (
        <div className="benchgrid" data-bench>
          {benchRows.length === 0 ? (
            <p className="small muted">Everyone is on the field.</p>
          ) : (
            benchRows.map((row) => {
              const p = nameOf(row.playerId);
              return (
                <button
                  key={row.playerId}
                  className={`bplayer${pickedOn.has(row.playerId) ? ' picked' : ''}`}
                  onPointerDown={startDrag(
                    row.playerId,
                    'bench',
                    p?.number || (p ? initials(p.name) : '?'),
                  )}
                  onClick={() => toggle(pickedOn, row.playerId, setPickedOn)}
                >
                  <span className="shirt" style={{ borderColor: heatColor(row.deficitMs) }}>
                    {p?.number || (p ? initials(p.name) : '?')}
                  </span>
                  <span className="tname">{p?.name ?? row.playerId}</span>
                  <span className="ttime">{mmss(stats.get(row.playerId)?.playedMs ?? 0)}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {toast}

      {hasSelection ? (
        <div className="subbar">
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
            <button
              className={`btn grow${wrongCount ? ' warn' : ' primary'}`}
              onClick={() => void makeSub()}
            >
              {subLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions transport">
          {/*
           * Pause/resume and end-half used to live in the top strip: 44px and
           * 38px targets, 4px apart, in the least reachable spot on the phone
           * one-handed — while the bottom bar, the actual thumb zone, spent
           * its space on goals, which happen a handful of times a game next
           * to a control that gates every playing-time number the app
           * produces. They live here now, full-sized, with real separation.
           */}
          <div className="transport-row">
            <button
              className={`tplay${running ? ' running' : state.status === 'paused' ? ' paused' : ''}`}
              onClick={transport}
              disabled={!canPlay}
              aria-label={running ? 'Pause clock' : 'Start clock'}
            >
              <span className="ticon">{running ? '❚❚' : '▶'}</span>
              {transportLabel}
            </button>
            {/* A hold cannot be produced by the mis-tap that a native confirm()
                dialog was defenseless against, so the fill itself is the guard —
                nothing else is needed next to the button that pauses the clock. */}
            <HoldButton
              className="tstop"
              onHold={() => void record({ type: 'PERIOD_END' })}
              disabled={!inPeriod}
              aria-label={`End ${periodLabel}`}
            >
              <span className="ticon">■</span>
              <span className="tsub">hold</span>
            </HoldButton>
          </div>
          <div className="transport-row2">
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
            <button className="btn" onClick={undoLast} disabled={events.length === 0}>
              {undoLabel}
            </button>
          </div>
        </div>
      )}

      {ghost && (
        <div className="dragavatar" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.label}
        </div>
      )}

      {sheet === 'menu' && (
        <Sheet title={`${team.name} vs ${game.opponent || 'TBD'}`} onClose={() => setSheet(null)}>
          <div style={{ display: 'grid', gap: 8 }}>
            <p className="small muted">
              {formation.name} · {config.periods.count} × {Math.round(config.periods.lengthMs / 60_000)} min
            </p>
            {inPeriod && (
              <HoldButton
                className="btn warn block"
                onHold={() => {
                  setSheet(null);
                  void record({ type: 'PERIOD_END' });
                }}
              >
                Hold to end {periodLabel} (or ■ in the bar)
              </HoldButton>
            )}
            {/*
             * PERIOD_END on the last configured period already finishes a game
             * played to schedule — that's the ■ button above. This is the other
             * case: weather, an injury pile-up, a tournament that cuts a game
             * short. Waiting for period N to end was not an option, and the
             * only way to get there was to hold ■ through periods you never
             * meant to play.
             */}
            {canPlay && (
              <HoldButton
                className="btn danger block"
                onHold={() => {
                  setSheet(null);
                  void record({ type: 'GAME_END' }).then(() =>
                    navigate({ name: 'summary', gameId }),
                  );
                }}
              >
                Hold to end the game
              </HoldButton>
            )}
            <button
              className="btn block"
              onClick={() => {
                setView(view === 'field' ? 'list' : 'field');
                setSheet(null);
              }}
            >
              {view === 'field' ? 'Show as list' : 'Show the field'}
            </button>
            {/* Stats and playing time moved to the header — a Stats button
                sits next to ••• now, so this menu doesn't offer it twice. */}
            <button className="btn block" onClick={() => navigate({ name: 'events', gameId })}>
              Modify events
            </button>
            <button
              className="btn danger block"
              onClick={() => {
                if (confirm(`Delete this game and everything recorded in it?`)) {
                  void deleteGame(gameId).then(() =>
                    navigate({ name: 'team', teamId: game.teamId }),
                  );
                }
              }}
            >
              Delete game
            </button>
          </div>
        </Sheet>
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
                <time>
                  {periodTag(config.periods.count, e.period)} {formatClock(e.gameClockMs)}
                </time>
                <span>{describeEvent(e, nameOf)}</span>
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
                  /*
                   * If someone is already there the two trade places. Sending a
                   * player to an occupied position without moving its occupant
                   * left both holding the same code, and the pitch can only draw
                   * one of them.
                   */
                  const sitting = [...state.onField.entries()].find(
                    ([id, code]) => code === position && id !== movingPlayer,
                  )?.[0];
                  const mine = state.onField.get(movingPlayer);
                  if (sitting && mine) {
                    void recordMany([
                      { type: 'POSITION_CHANGE', playerId: movingPlayer, to: position },
                      { type: 'POSITION_CHANGE', playerId: sitting, to: mine },
                    ]);
                  } else {
                    void record({ type: 'POSITION_CHANGE', playerId: movingPlayer, to: position });
                  }
                  setMovingPlayer(null);
                }}
              >
                {position}
              </button>
            ))}
          </div>
        </Sheet>
      )}
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

