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
await page.waitForSelector('text=Sub Time');

// -- team ------------------------------------------------------------------
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Riverside U11');
await page.fill('input[placeholder="U11"]', 'U11');
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

// -- settings: 2 x 10 min, 7 a side ---------------------------------------
await page.click('text=Settings');
await page.selectOption('select >> nth=0', '2');
await page.fill('input[type="number"] >> nth=0', '10');
await page.fill('input[type="number"] >> nth=1', '7');
await page.selectOption('select >> nth=1', '0.5'); // keeper minutes at half credit
await page.fill('input[value*="GK"]', 'GK LB CB RB LM CM ST');
await page.click('.sheet >> text=Save');
await page.waitForTimeout(200);

// -- game ------------------------------------------------------------------
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Northside');
await page.click('text=Create game');
await page.waitForSelector('text=Starting lineup');
await shot(page, 'setup-empty');

// One player is away; the other ten are available for seven shirts.
await page.click('.chips >> text=Kit');

for (let slot = 0; slot < 7; slot++) {
  await page.click(`.plist .prow >> nth=${slot}`);
  await page.click(`.sheet .chip >> nth=${slot}`);
  await page.waitForTimeout(40);
}
await shot(page, 'setup-filled');
check('start enabled', await page.locator('text=Start game').isEnabled(), true);

await page.click('text=Start game');
await page.waitForSelector('text=On the field');
await shot(page, 'live-pregame');

// -- kick off --------------------------------------------------------------
await page.click('text=Start 1st half');
await page.waitForSelector('text=Stop clock');
await page.waitForTimeout(2500);
await shot(page, 'live-running');

const clockText = await page.locator('.clock .time').innerText();
check('clock is advancing', /0:0[1-9]/.test(clockText), true);

// -- a substitution --------------------------------------------------------
// Bench is sorted most-owed-first, so the top bench row is the app's own
// suggestion. Take the top on-field row off for them.
const benchName = await page.locator('h2:has-text("Bench") + .plist .name >> nth=0').innerText();
await page.click('h2:has-text("On the field") + .plist .prow >> nth=0');
await page.click('h2:has-text("Bench") + .plist .prow >> nth=0');
await shot(page, 'live-sub-pending');
await page.click('text=/^Sub 1 ↔ 1$/');
await page.waitForTimeout(400);

const onFieldNames = await page.locator('h2:has-text("On the field") + .plist .name').allInnerTexts();
check('subbed player came on', onFieldNames.includes(benchName), true);
check('still 7 on the field', onFieldNames.length, 7);
await shot(page, 'live-after-sub');

// -- goals -----------------------------------------------------------------
await page.click('text=⚽ Goal');
await page.click('.sheet .chip >> nth=0');
await page.click('.sheet .chip >> nth=0');
await page.waitForTimeout(300);
await page.click('text=Opponent scored');
await page.waitForTimeout(300);
check('score reads 1–1', (await page.locator('.scoreline').innerText()).replace(/\s+/g, ''), '1–1');

// -- stoppage: the clock must freeze --------------------------------------
await page.click('text=Stop clock');
await page.waitForTimeout(200);
const frozen = await page.locator('.clock .time').innerText();
await page.waitForTimeout(1800);
check('clock frozen while stopped', await page.locator('.clock .time').innerText(), frozen);
await shot(page, 'live-paused');

await page.click('text=Restart clock');
await page.waitForTimeout(1200);
check(
  'clock resumes from the pause point',
  (await page.locator('.clock .time').innerText()) !== frozen,
  true,
);

// -- undo ------------------------------------------------------------------
await page.click('text=☰ Log');
const logLines = await page.locator('.log div').count();
await page.click('.sheet >> text=Close');
await page.click('text=↩ Undo');
await page.waitForTimeout(300);
await page.click('text=☰ Log');
check('undo removed one event', await page.locator('.log div').count(), logLines - 1);
await shot(page, 'live-log');
await page.click('.sheet >> text=Close');

// -- run out both halves ---------------------------------------------------
page.on('dialog', (d) => d.accept());
await page.click('text=End 1st');
await page.waitForSelector('text=Start 2nd half');
await page.click('text=Start 2nd half');
await page.waitForTimeout(1500);

// A second sub in the second half, so the timeline has something to show.
await page.click('h2:has-text("On the field") + .plist .prow >> nth=0');
await page.click('h2:has-text("Bench") + .plist .prow >> nth=0');
await page.click('text=/^Sub 1 ↔ 1$/');
await page.waitForTimeout(1200);

await page.click('text=End 2nd');
await page.waitForSelector('text=Full time');
await shot(page, 'live-fulltime');

// -- summary ---------------------------------------------------------------
await page.click('text=Full time — see the stats');
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
