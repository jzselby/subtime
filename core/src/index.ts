/**
 * @pitchside/core — the game engine.
 *
 * Framework-free on purpose. Nothing in here imports React, a database, or a
 * platform API, so the same code runs in the PWA, in tests, and server-side when
 * a finished game is folded down into report tables. If the PWA ever has to
 * become a native app, this package is the part that does not get rewritten.
 */

export * from './types.js';
export { initialState, reduce } from './reducer.js';
export type { GameState, ReduceResult } from './reducer.js';
export {
  clockAt,
  elapsedGameMs,
  formatClock,
  remainingInGameMs,
  remainingInPeriodMs,
} from './clock.js';
export { appendEvent, newEventId } from './append.js';
export type { EventInput } from './append.js';
export { appearsInLog, playerIdsIn } from './players.js';
export {
  aggregatePlayerStats,
  availablePlayers,
  currentRotationMs,
  fairness,
  fairnessIndex,
  fieldTimeIntegralMs,
  playerStats,
  stintDurationMs,
  stintEndMs,
  suggestSubsOff,
  suggestSubsOn,
  totalPlayedMs,
} from './stats.js';
export type { FairnessRow, PlayerGameStats, PlayerSeasonStats } from './stats.js';
