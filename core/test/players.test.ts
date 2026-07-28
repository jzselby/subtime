import { describe, expect, it } from 'vitest';
import { appearsInLog, playerIdsIn } from '../src/players.js';
import type { GameEvent } from '../src/types.js';

const meta = { id: 'e1', gameId: 'g1', seq: 1, wallTs: 0, gameClockMs: 0, period: 1 };
const ev = (e: Partial<GameEvent> & { type: GameEvent['type'] }) =>
  ({ ...meta, ...e }) as GameEvent;

describe('playerIdsIn', () => {
  it('finds the player on every event that names one', () => {
    const cases: [GameEvent, string[]][] = [
      [ev({ type: 'ATTENDANCE', playerId: 'p1', status: 'present' }), ['p1']],
      [ev({ type: 'POSITION_CHANGE', playerId: 'p1', to: 'CM' }), ['p1']],
      [ev({ type: 'CARD', playerId: 'p1', card: 'yellow' }), ['p1']],
      [ev({ type: 'SHOT', playerId: 'p1', onTarget: true }), ['p1']],
      [ev({ type: 'SAVE', playerId: 'p1' }), ['p1']],
      [
        ev({
          type: 'SET_LINEUP',
          slots: [
            { playerId: 'p1', position: 'GK' },
            { playerId: 'p2', position: 'CB' },
          ],
        }),
        ['p1', 'p2'],
      ],
      [
        ev({ type: 'SUB', off: ['p1'], on: [{ playerId: 'p2', position: 'CM' }] }),
        ['p1', 'p2'],
      ],
      [ev({ type: 'GOAL', scorerId: 'p1', assistId: 'p2' }), ['p1', 'p2']],
    ];
    for (const [event, expected] of cases) {
      expect(playerIdsIn(event), event.type).toEqual(expected);
    }
  });

  /*
   * A goal can have no scorer and no assist — a scramble nobody claimed. Those
   * nulls must not survive as ids, or a player-id lookup matches "no one".
   */
  it('drops the nulls on an unattributed goal', () => {
    expect(playerIdsIn(ev({ type: 'GOAL', scorerId: null }))).toEqual([]);
    expect(playerIdsIn(ev({ type: 'GOAL', scorerId: null, assistId: null }))).toEqual([]);
    expect(playerIdsIn(ev({ type: 'GOAL', scorerId: null, assistId: 'p2' }))).toEqual(['p2']);
  });

  it('names nobody on events about the game rather than a player', () => {
    for (const type of [
      'PERIOD_START',
      'PERIOD_END',
      'CLOCK_PAUSE',
      'CLOCK_RESUME',
      'OPPONENT_GOAL',
    ] as const) {
      expect(playerIdsIn(ev({ type })), type).toEqual([]);
    }
    expect(playerIdsIn(ev({ type: 'NOTE', text: 'windy' }))).toEqual([]);
  });
});

describe('appearsInLog', () => {
  const log = [
    ev({ type: 'ATTENDANCE', playerId: 'p1', status: 'present' }),
    ev({ type: 'ATTENDANCE', playerId: 'p2', status: 'absent' }),
    ev({ type: 'SET_LINEUP', slots: [{ playerId: 'p1', position: 'GK' }] }),
  ];

  it('finds a player who played', () => {
    expect(appearsInLog(log, 'p1')).toBe(true);
  });

  /*
   * Being marked absent still counts. The fairness targets for that game were
   * computed around who was available, so the record is not complete without
   * them — and deleting the name would orphan the row either way.
   */
  it('counts a player who was marked absent', () => {
    expect(appearsInLog(log, 'p2')).toBe(true);
  });

  it('does not find a player who was never mentioned', () => {
    expect(appearsInLog(log, 'p3')).toBe(false);
  });
});
