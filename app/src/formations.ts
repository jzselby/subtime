/**
 * Formations: named sets of position slots at coordinates on the pitch.
 *
 * Coordinates are normalised to 0..1 on a vertical pitch — (0.5, 0.93) is in
 * front of your own goal, (0.5, 0.1) is the opponent's. Normalised means the
 * same formation renders correctly at any screen size, and a dragged slot keeps
 * its meaning on a different phone.
 *
 * Slot codes are unique within a formation (LCB and RCB, not two CBs). The
 * engine treats a position as an opaque string, so uniqueness is what lets
 * "minutes by position" and free-slot assignment stay meaningful.
 */

export interface Slot {
  /** Stable across drags and renames, so a lineup survives editing. */
  id: string;
  /** The label shown on the shirt: GK, LCB, CM, ST. */
  code: string;
  x: number;
  y: number;
}

export interface Formation {
  name: string;
  slots: Slot[];
}

/** Position labels per line role and per number of players in that line. */
const CODES: Record<string, Record<number, string[]>> = {
  D: {
    1: ['CB'],
    2: ['LB', 'RB'],
    3: ['LB', 'CB', 'RB'],
    4: ['LB', 'LCB', 'RCB', 'RB'],
    5: ['LWB', 'LCB', 'CB', 'RCB', 'RWB'],
  },
  DM: { 1: ['CDM'], 2: ['LDM', 'RDM'], 3: ['LDM', 'CDM', 'RDM'] },
  M: {
    1: ['CM'],
    2: ['LM', 'RM'],
    3: ['LM', 'CM', 'RM'],
    4: ['LM', 'LCM', 'RCM', 'RM'],
    5: ['LM', 'LCM', 'CM', 'RCM', 'RM'],
  },
  AM: { 1: ['CAM'], 2: ['LAM', 'RAM'], 3: ['LAM', 'CAM', 'RAM'] },
  F: { 1: ['ST'], 2: ['LS', 'RS'], 3: ['LW', 'ST', 'RW'] },
};

function roleFor(lineIndex: number, lineCount: number): keyof typeof CODES {
  if (lineIndex === 0) return 'D';
  if (lineIndex === lineCount - 1) return 'F';
  if (lineCount >= 4) return lineIndex === 1 ? 'DM' : 'AM';
  return 'M';
}

function codesFor(role: keyof typeof CODES, count: number): string[] {
  const table = CODES[role];
  const exact = table?.[count];
  if (exact) return [...exact];
  // Wider than any named set: fall back to numbered slots in that role.
  return Array.from({ length: count }, (_, i) => `${role}${i + 1}`);
}

/**
 * Build a formation from a line spec: `[2, 3, 1]` is two defenders, three
 * midfielders, one forward, plus a keeper.
 */
export function buildFormation(name: string, lines: number[], gk = true): Formation {
  const slots: Slot[] = [];

  /*
   * Rows are spread evenly across the band *including* the keeper. Treating GK
   * as a special case parked near the goal line left it far closer to the back
   * line than the other rows were to each other, and on a small phone the
   * keeper's shirt collided with the centre-back's.
   *
   * BACK stops short of 1.0 because a token's name and time render below the
   * shirt and would otherwise be clipped by the touchline.
   */
  const BACK = 0.86;
  const FRONT = 0.13;
  const rows = lines.length + (gk ? 1 : 0);
  const rowY = (i: number) =>
    rows === 1 ? 0.5 : BACK - i * ((BACK - FRONT) / (rows - 1));

  if (gk) slots.push({ id: 'gk', code: 'GK', x: 0.5, y: rowY(0) });

  const used = new Set<string>();

  lines.forEach((count, lineIndex) => {
    const y = rowY(lineIndex + (gk ? 1 : 0));
    const codes = codesFor(roleFor(lineIndex, lines.length), count);

    for (let j = 0; j < count; j++) {
      const margin = count > 3 ? 0.11 : 0.17;
      const x = count === 1 ? 0.5 : margin + (j * (1 - 2 * margin)) / (count - 1);
      let code = codes[j] ?? `P${slots.length + 1}`;
      // Guard against a collision between lines (a lone CB behind a lone CM is
      // fine, but two lines could both want CM in an unusual spec).
      let n = 2;
      while (used.has(code)) code = `${codes[j] ?? 'P'}${n++}`;
      used.add(code);
      slots.push({ id: `s${lineIndex}-${j}`, code, x, y });
    }
  });

  return { name, slots };
}

interface PresetSpec {
  name: string;
  lines: number[];
  gk?: boolean;
}

/** Common youth formats, keyed by total players on the field including keeper. */
const SPECS: Record<number, PresetSpec[]> = {
  4: [
    { name: '1-2', lines: [1, 2] },
    { name: '2-1', lines: [2, 1] },
    { name: 'Diamond (no keeper)', lines: [1, 2, 1], gk: false },
  ],
  5: [
    { name: '2-2', lines: [2, 2] },
    { name: '1-2-1', lines: [1, 2, 1] },
    { name: '2-1-1', lines: [2, 1, 1] },
  ],
  6: [
    { name: '2-1-2', lines: [2, 1, 2] },
    { name: '3-2', lines: [3, 2] },
    { name: '2-3', lines: [2, 3] },
  ],
  7: [
    { name: '2-3-1', lines: [2, 3, 1] },
    { name: '3-2-1', lines: [3, 2, 1] },
    { name: '2-1-2-1', lines: [2, 1, 2, 1] },
    { name: '3-1-2', lines: [3, 1, 2] },
  ],
  8: [
    { name: '3-3-1', lines: [3, 3, 1] },
    { name: '2-3-2', lines: [2, 3, 2] },
    { name: '3-2-2', lines: [3, 2, 2] },
  ],
  9: [
    { name: '3-2-3', lines: [3, 2, 3] },
    { name: '3-3-2', lines: [3, 3, 2] },
    { name: '2-3-3', lines: [2, 3, 3] },
    { name: '3-4-1', lines: [3, 4, 1] },
  ],
  10: [
    { name: '3-3-3', lines: [3, 3, 3] },
    { name: '4-3-2', lines: [4, 3, 2] },
    { name: '3-4-2', lines: [3, 4, 2] },
  ],
  11: [
    { name: '4-4-2', lines: [4, 4, 2] },
    { name: '4-3-3', lines: [4, 3, 3] },
    { name: '4-2-3-1', lines: [4, 2, 3, 1] },
    { name: '3-5-2', lines: [3, 5, 2] },
    { name: '5-3-2', lines: [5, 3, 2] },
  ],
};

export function presetsFor(fieldPlayers: number): Formation[] {
  const specs = SPECS[fieldPlayers];
  if (specs) return specs.map((s) => buildFormation(s.name, s.lines, s.gk ?? true));
  // Any size we have no named set for: one line of outfielders behind a keeper.
  return [buildFormation(`${fieldPlayers} a side`, [Math.max(1, fieldPlayers - 1)])];
}

export function defaultFormation(fieldPlayers: number): Formation {
  return presetsFor(fieldPlayers)[0] ?? buildFormation('Custom', [Math.max(1, fieldPlayers - 1)]);
}

/** Slot codes in formation order — the vocabulary for the position picker. */
export const codesOf = (formation: Formation): string[] => formation.slots.map((s) => s.code);
