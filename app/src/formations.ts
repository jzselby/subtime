/**
 * Formations: named sets of position slots at coordinates on the pitch.
 *
 * Coordinates are normalised to 0..1 on a vertical pitch — y near 1 is your own
 * goal line, y near 0 is the opponent's. Normalised means the
 * same formation renders correctly at any screen size, and a dragged slot keeps
 * its meaning on a different phone.
 *
 * Slot codes are unique within a formation (LCB and RCB, not two CBs). The
 * engine treats a position as an opaque string, so uniqueness is what lets
 * "minutes by position" and free-slot assignment stay meaningful.
 */

/** Broad line a position belongs to, the way a team sheet groups them. */
export type Role = 'GK' | 'D' | 'M' | 'F';

export interface Slot {
  /** Stable across drags and renames, so a lineup survives editing. */
  id: string;
  /** The label shown on the shirt: GK, LCB, CM, ST. */
  code: string;
  /** Shown as "ST · F", and the grouping for minutes-by-line reporting. */
  role: Role;
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

function bandFor(lineIndex: number, lineCount: number): keyof typeof CODES {
  if (lineIndex === 0) return 'D';
  if (lineIndex === lineCount - 1) return 'F';
  if (lineCount >= 4) return lineIndex === 1 ? 'DM' : 'AM';
  return 'M';
}

/** Holding and attacking midfield are both midfield on a team sheet. */
const ROLE_OF: Record<string, Role> = { D: 'D', DM: 'M', M: 'M', AM: 'M', F: 'F' };

/**
 * How wide a line spreads, as the inset from each touchline.
 *
 * One number for every line was wrong in both directions: it pinned a strike
 * pair out on the corners of the penalty area, and pulled full-backs infield
 * where a back four should be hugging the touchline.
 */
const MARGIN: Record<string, Record<number, number>> = {
  D: { 2: 0.25, 3: 0.15, 4: 0.1, 5: 0.07 },
  M: { 2: 0.3, 3: 0.16, 4: 0.11, 5: 0.09 },
  F: { 2: 0.34, 3: 0.17 },
};

/**
 * Per-line depth offsets, positive meaning deeper (toward our own goal).
 *
 * Real teams do not stand in flat rows: full-backs push up past the centre-backs,
 * a midfield three holds through the middle, and wingers play off the shoulder of
 * the striker. Small offsets, but they are the difference between a formation and
 * a row of dots.
 */
const STAGGER: Record<string, Record<number, number[]>> = {
  D: {
    3: [-0.015, 0.025, -0.015],
    4: [-0.03, 0.015, 0.015, -0.03],
    5: [-0.05, 0.01, 0.025, 0.01, -0.05],
  },
  M: {
    3: [-0.025, 0.045, -0.025],
    4: [-0.02, 0.02, 0.02, -0.02],
    5: [-0.04, 0, 0.035, 0, -0.04],
  },
  F: { 2: [0.015, 0.015], 3: [0.05, -0.01, 0.05] },
};

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
   * Rows spread evenly across this band, the keeper counted as one of them.
   * Treating GK as a special case parked on the goal line left it far closer to
   * the back line than the other rows were to each other, and on a small phone
   * the keeper's shirt collided with the centre-back's.
   *
   * BACK is deep enough that the keeper stands inside the penalty area rather
   * than on its line, and short of 1.0 because a token's name and time render
   * below the shirt and would otherwise be clipped by the touchline.
   */
  const BACK = 0.9;
  const FRONT = 0.14;
  const rows = lines.length + (gk ? 1 : 0);
  const rowY = (i: number) =>
    rows === 1 ? 0.5 : BACK - i * ((BACK - FRONT) / (rows - 1));

  if (gk) slots.push({ id: 'gk', code: 'GK', role: 'GK', x: 0.5, y: rowY(0) });

  const used = new Set<string>();

  lines.forEach((count, lineIndex) => {
    const y = rowY(lineIndex + (gk ? 1 : 0));
    const band = bandFor(lineIndex, lines.length);
    const codes = codesFor(band, count);
    const role = ROLE_OF[band] ?? 'M';

    const stagger = STAGGER[role]?.[count];
    const margin = MARGIN[role]?.[count] ?? (count > 3 ? 0.11 : 0.17);

    for (let j = 0; j < count; j++) {
      const x = count === 1 ? 0.5 : margin + (j * (1 - 2 * margin)) / (count - 1);
      const yj = y + (stagger?.[j] ?? 0);
      let code = codes[j] ?? `P${slots.length + 1}`;
      // Guard against a collision between lines (a lone CB behind a lone CM is
      // fine, but two lines could both want CM in an unusual spec).
      let n = 2;
      while (used.has(code)) code = `${codes[j] ?? 'P'}${n++}`;
      used.add(code);
      slots.push({ id: `s${lineIndex}-${j}`, code, role, x, y: yj });
    }
  });

  return { name, slots };
}

/**
 * Formation names count the keeper, the way coaches and team sheets write them:
 * a 7-a-side 2-3-1 is "1-2-3-1". Derived from the line spec so a name can never
 * drift from the shape it describes.
 */
export const formationName = (lines: number[], gk = true): string =>
  (gk ? [1, ...lines] : lines).join('-');

interface PresetSpec {
  name?: string;
  lines: number[];
  gk?: boolean;
}

/** Common youth formats, keyed by total players on the field including keeper. */
const SPECS: Record<number, PresetSpec[]> = {
  4: [
    { lines: [1, 2] },
    { lines: [2, 1] },
    { name: 'Diamond (no keeper)', lines: [1, 2, 1], gk: false },
  ],
  5: [
    { lines: [2, 2] },
    { lines: [1, 2, 1] },
    { lines: [2, 1, 1] },
  ],
  6: [
    { lines: [2, 1, 2] },
    { lines: [3, 2] },
    { lines: [2, 3] },
  ],
  7: [
    { lines: [2, 3, 1] },
    { lines: [3, 2, 1] },
    { lines: [2, 1, 2, 1] },
    { lines: [3, 1, 2] },
  ],
  8: [
    { lines: [3, 3, 1] },
    { lines: [2, 3, 2] },
    { lines: [3, 2, 2] },
  ],
  9: [
    { lines: [3, 2, 3] },
    { lines: [3, 3, 2] },
    { lines: [2, 3, 3] },
    { lines: [3, 4, 1] },
  ],
  10: [
    { lines: [3, 3, 3] },
    { lines: [4, 3, 2] },
    { lines: [3, 4, 2] },
  ],
  11: [
    { lines: [4, 4, 2] },
    { lines: [4, 3, 3] },
    { lines: [4, 2, 3, 1] },
    { lines: [3, 5, 2] },
    { lines: [5, 3, 2] },
  ],
};

export function presetsFor(fieldPlayers: number): Formation[] {
  const specs = SPECS[fieldPlayers];
  if (specs) {
    return specs.map((spec) => {
      const gk = spec.gk ?? true;
      return buildFormation(spec.name ?? formationName(spec.lines, gk), spec.lines, gk);
    });
  }
  // Any size we have no named set for: one line of outfielders behind a keeper.
  const lines = [Math.max(1, fieldPlayers - 1)];
  return [buildFormation(formationName(lines), lines)];
}

export function defaultFormation(fieldPlayers: number): Formation {
  return presetsFor(fieldPlayers)[0] ?? buildFormation('Custom', [Math.max(1, fieldPlayers - 1)]);
}

/** Slot codes in formation order — the vocabulary for the position picker. */
export const codesOf = (formation: Formation): string[] => formation.slots.map((s) => s.code);
