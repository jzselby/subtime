/**
 * End-to-end smoke test: drives a whole game through the real UI in a real
 * browser, then checks the numbers the app reports against what actually
 * happened. Screenshots land in scripts/shots/ for eyeballing the layout.
 *
 *   node scripts/smoke.mjs [--headed] [--url http://localhost:4173]
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:4173';

mkdirSync(SHOTS, { recursive: true });

const ROSTER = [
  ['1', 'Ana'], ['2', 'Bea'], ['3', 'Cal'], ['4', 'Dee'], ['5', 'Eli'],
  ['6', 'Fin'], ['7', 'Gus'], ['8', 'Hal'], ['9', 'Ivy'], ['10', 'Jo'],
  ['11', 'Kit'],
];

let step = 0;
const shot = async (page, name) =>
  page.screenshot({ path: join(SHOTS, `${String(++step).padStart(2, '0')}-${name}.png`) });

const checks = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  checks.push({ label, actual, expected, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — got ${actual}, want ${expected}`}`);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !args.includes('--headed'),
});
const page = await browser.newPage({
  viewport: { width: 414, height: 896 }, // a large phone, portrait
  deviceScaleFactor: 2,
});

page.on('pageerror', (err) => {
  console.error('PAGE ERROR:', err.message);
  process.exitCode = 1;
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

console.log(`\nDriving ${URL}\n`);
await page.goto(URL);
await page.waitForSelector('text=Touchline');

// -- team ------------------------------------------------------------------
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Riverside U11');
await page.fill('input[placeholder="U11"]', 'U11');
await page.selectOption('.sheet select', '7');   // 7 a side
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await shot(page, 'team-empty');

// -- roster ----------------------------------------------------------------
await page.click('text=+ Add player');
for (const [number, name] of ROSTER) {
  await page.fill('input[inputmode="numeric"]', number);
  await page.fill('#player-name', name);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(30);
}
await page.click('.sheet >> text=Close');
await page.waitForSelector(`text=Roster · ${ROSTER.length}`);
check('roster size', await page.locator('.plist .num-badge').count() >= ROSTER.length, true);
await shot(page, 'roster');

// -- settings: 2 x 10 min, keeper minutes at half credit -------------------
await page.click('text=Settings');
await page.selectOption('.sheet select >> nth=0', '2');
await page.fill('.sheet input[type="number"]', '10');
await page.selectOption('.sheet select >> nth=1', '0.5');
await page.click('.sheet >> text=Save');
await page.waitForTimeout(200);

// -- formation: switch shape and drag a position --------------------------
await page.click('text=Settings');
await page.click('text=/^Formation: /');
await page.waitForSelector('text=Shape');
check('pitch is drawn', await page.locator('.pitch-lines').count(), 1);
check('a slot per player', await page.locator('.token').count(), 7);
await shot(page, 'formation');

await page.click('.chips >> text=1-3-2-1');
await page.waitForTimeout(150);
check('preset changed the shape', await page.locator('.token').count(), 7);

// Drag the striker to the left. The pitch is normalised 0..1, so verify the
// slot's own left offset moved rather than trusting the gesture fired.
const striker = page.locator('.token', { hasText: 'ST' }).first();
const beforeBox = await striker.boundingBox();
const pitchBox = await page.locator('.pitch').boundingBox();
await striker.hover();
await page.mouse.down();
await page.mouse.move(pitchBox.x + pitchBox.width * 0.25, pitchBox.y + pitchBox.height * 0.3, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const afterBox = await striker.boundingBox();
check('dragging a position moves it', afterBox.x < beforeBox.x - 20, true);
await shot(page, 'formation-dragged');

await page.click('text=Save formation');
await page.waitForSelector('text=Roster · 11');

// -- game ------------------------------------------------------------------
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Northside');
await page.click('text=Create game');
// Attendance now opens by itself on arrival, everyone ticked.
await page.waitForSelector("text=Who's here?");
check('attendance opens on arrival', await page.locator('.sheet .check.on').count(), ROSTER.length);
await shot(page, 'setup-attendance');

// One player is away; the other ten are available for seven shirts.
await page.click('.sheet .prow:has-text("Kit")');
await page.click('.sheet >> text=Done');

/*
 * Wait for the sheet to actually go, not for "Starting lineup" — that heading
 * sits behind the sheet the whole time, so waiting on it returns instantly and
 * reads the count before attendance has been written and folded back.
 */
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.waitForFunction(
  (n) => document.body.innerText.includes(`${n} here`),
  `${ROSTER.length - 1} of ${ROSTER.length}`,
);
check(
  'one player marked away',
  await page.locator('button:has-text("here ›")').innerText(),
  `${ROSTER.length - 1} of ${ROSTER.length} here ›`,
);
await shot(page, 'setup-empty');

// Assign two by tapping the pitch, then let "Fill rest" do the remainder.
for (let slot = 0; slot < 2; slot++) {
  await page.click(`.token >> nth=${slot}`);
  // Already-assigned players are disabled in the picker, so take the first
  // one that is still selectable.
  await page.click('.sheet .chip:not([disabled]) >> nth=0');
  await page.waitForTimeout(60);
}
await page.click('text=Fill rest');
await page.waitForTimeout(150);
await shot(page, 'setup-filled');
check('lineup is on the pitch', await page.locator('.token:not(.vacant)').count(), 7);
check('start enabled', await page.locator('text=Start game').isEnabled(), true);

await page.click('text=Start game');
await page.waitForSelector('.pitch');
await shot(page, 'live-pregame');

// -- kick off --------------------------------------------------------------
await page.click('[aria-label="Start clock"]');
await page.waitForSelector('[aria-label="Pause clock"]');
await page.waitForTimeout(2500);
await shot(page, 'live-running');

const clockText = await page.locator('.gclock .time').innerText();
check('clock is advancing', /0:0[1-9]/.test(clockText), true);

// The pause button used to be 56px — bigger than it needs to be for a
// control tapped once a stoppage. `.transport-row`'s `align-items: stretch`
// means shrinking only .tplay's min-height would do nothing on its own; the
// row would just stretch it back up to match .tstop, which has to shrink
// with it.
const playHeight = await page
  .locator('[aria-label="Pause clock"]')
  .evaluate((el) => el.getBoundingClientRect().height);
const stopHeight = await page.locator('.tstop').evaluate((el) => el.getBoundingClientRect().height);
check('the pause button is the smaller, tap-minimum size', playHeight, 48);
check("the hold-to-end button matches it, not stretched back up", stopHeight, 48);

// -- a substitution --------------------------------------------------------
// Bench is sorted most-owed-first, so the top bench row is the app's own
// suggestion. Take the top on-field row off for them.
check('field view is the default', await page.locator('.pitch').count(), 1);
const benchName = await page.locator('.benchgrid .bplayer .tname >> nth=0').innerText();
await page.click('.token:not(.vacant) >> nth=0');

/*
 * Taking a player off with nobody picked to replace them used to read "Sub 1
 * ↔ 0" in the same green as a straight swap, and tapping it quietly played
 * the team a man short. The label now states the outcome, and the button
 * warns rather than inviting the tap.
 */
check(
  'an uneven sub states the consequence, not the arithmetic',
  await page.locator('.subbar >> text=/^Take .+ off — play \\d$/').count(),
  1,
);
check('an uneven sub is styled as a warning, not primary', await page.locator('.subbar .warn').count(), 1);

await page.click('.benchgrid .bplayer >> nth=0');
check(
  'picking a replacement returns to a plain swap label',
  await page.locator('text=/^Sub 1 ↔ 1$/').count(),
  1,
);
check('a straight swap is not styled as a warning', await page.locator('.subbar .warn').count(), 0);
await shot(page, 'live-sub-pending');
await page.click('text=/^Sub 1 ↔ 1$/');
await page.waitForTimeout(400);

const onPitch = await page.locator('.token:not(.vacant) .tname').allInnerTexts();
check('subbed player came on', onPitch.includes(benchName), true);
check('still 7 on the pitch', onPitch.length, 7);
await shot(page, 'live-after-sub');

// The list view must stay in step with the pitch.
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Show as list');
await page.waitForTimeout(150);
check(
  'list view agrees with the pitch',
  await page.locator('h2:has-text("On the field") + .plist .prow').count(),
  7,
);
await shot(page, 'live-list');
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Show the field');
await page.waitForTimeout(150);

// -- goals -----------------------------------------------------------------
await page.click('text=⚽ Us');
await page.click('.sheet .chip >> nth=0');
await page.click('.sheet .chip >> nth=0');
await page.waitForTimeout(300);
await page.click('text=⚽ Them');
await page.waitForTimeout(300);
// The score sits beside the clock, on its own — larger than the meta line
// it used to share with the period label, and readable at a glance.
check('score reads 1–1', (await page.locator('.gscore').innerText()).trim(), '1–1');

// The header has two buttons on the left (Back, the event log) and one on
// the right (•••), so centering the clock block the ordinary flex way — one
// box squeezed between two unequal groups — put it visibly off to one side.
// It's absolutely positioned against the bar itself now, not the leftover
// space, specifically so it can't drift with however many buttons end up on
// either side.
const clockCenter = await page.locator('.gclock').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return (r.left + r.right) / 2;
});
const windowWidth = await page.evaluate(() => window.innerWidth);
check(
  'the clock and score are centred on the bar, not the leftover space beside it',
  Math.abs(clockCenter - windowWidth / 2) < 2,
  true,
);

// -- stoppage: the clock must freeze --------------------------------------
await page.click('[aria-label="Pause clock"]');
await page.waitForTimeout(200);
const frozen = await page.locator('.gclock .time').innerText();
await page.waitForTimeout(1800);
check('clock frozen while stopped', await page.locator('.gclock .time').innerText(), frozen);
await shot(page, 'live-paused');

await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1200);
check(
  'clock resumes from the pause point',
  (await page.locator('.gclock .time').innerText()) !== frozen,
  true,
);

// -- undo ------------------------------------------------------------------
await page.click('[aria-label="Event log"]');
const logLines = await page.locator('.log div').count();
await page.click('.sheet >> text=Close');
await page.click('text=↩ Undo');
await page.waitForTimeout(300);
await page.click('[aria-label="Event log"]');
check('undo removed one event', await page.locator('.log div').count(), logLines - 1);
await shot(page, 'live-log');
await page.click('.sheet >> text=Close');

// -- run out both halves ---------------------------------------------------
page.on('dialog', (d) => d.accept());
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=End 1H', { delay: 800 });
await page.waitForTimeout(300);
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1500);

// A second sub in the second half, so the timeline has something to show.
await page.click('.token:not(.vacant) >> nth=0');
await page.click('.benchgrid .bplayer >> nth=0');
await page.click('text=/^Sub 1 ↔ 1$/');
await page.waitForTimeout(1200);

await page.click('[aria-label="More"]');
await page.click('.sheet >> text=End 2H', { delay: 800 });
await page.waitForTimeout(300);
await shot(page, 'live-fulltime');

// -- summary ---------------------------------------------------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Stats and playing time');
await page.waitForSelector('text=Playing-time fairness');
await page.waitForTimeout(300);
await shot(page, 'summary');

check('no unapplied events', await page.locator('.banner.error').count(), 0);
check('every player has a row', await page.locator('.tbl >> nth=1 >> tbody tr').count(), 10);
check('timeline drawn', (await page.locator('.gseg').count()) > 0, true);

await page.locator('h2:has-text("Everything else")').scrollIntoViewIfNeeded();
await shot(page, 'summary-table');

/*
 * The load-bearing check, now against the real UI rather than a unit test:
 * total playing time must equal the on-field count integrated over elapsed
 * time. It was seven a side with no red cards throughout, so that is exactly
 * 7 × elapsed. Read the m:ss column rather than the rounded minutes one — with
 * a game this short, whole minutes would make the assertion vacuous.
 */
const toSeconds = (text) => {
  const [m, s] = text.trim().split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};
const played = await page.locator('.bar em').allInnerTexts();
const summed = played.reduce((acc, t) => acc + toSeconds(t), 0);
const elapsed = toSeconds((await page.locator('.top .sub').innerText()).match(/\d+:\d+/)?.[0] ?? '0:0');
// Every reading is floored to the second, so allow a second per player.
check(
  `Σ played = 7 × elapsed (${summed}s vs ${7 * elapsed}s)`,
  Math.abs(summed - 7 * elapsed) <= played.length,
  true,
);
check('game was long enough to be meaningful', elapsed > 3, true);

// -- reload: the game must survive a cold start ----------------------------
await page.reload();
await page.waitForSelector('text=Playing-time fairness');
check('survives a reload', (await page.locator('.tbl >> nth=1 >> tbody tr').count()), 10);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`screenshots in ${SHOTS}\n`);
if (failed.length) process.exitCode = 1;
