import { formatClock } from '@touchline/core';

export { formatClock as mmss };

export const mins = (ms: number): number => Math.round(ms / 60_000);

/** "CM 42m · LB 8m", longest total spell first, top 3. */
export function byPositionMinutes(msByPosition: Record<string, number>): string {
  return Object.entries(msByPosition)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, ms]) => `${code} ${mins(ms)}m`)
    .join(' · ');
}

/** "CM 12:30 · LB 8:00", for a single game where seconds matter, top 3. */
export function byPositionClock(msByPosition: Record<string, number>): string {
  return Object.entries(msByPosition)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, ms]) => `${code} ${formatClock(ms)}`)
    .join(' · ');
}
