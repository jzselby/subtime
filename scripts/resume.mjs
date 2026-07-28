/**
 * The failure mode that matters most in a real game: you leave the app
 * mid-match — phone locks, you back out, the browser evicts the tab — and come
 * back. Playing time must have kept accruing on the game clock, and the app must
 * land you back on the live screen rather than the setup screen.
 *
 *   node scripts/resume.mjs [--url http://localhost:4173]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const URL = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:4173';

const checks = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  checks.push(ok);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — got ${actual}, want ${expected}`}`);
};
const secs = (t) => {
  const [m, s] = t.trim().split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !args.includes('--headed'),
});
// One context for the whole run: `browser.newPage()` would create an isolated
// one, giving the "reopened" tab an empty IndexedDB and testing nothing.
const context = await browser.newContext({ viewport: { width: 414, height: 896 } });
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Resume FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

await page.click('text=+ Add player');
for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
  await page.fill('#player-name', name);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(25);
}
await page.click('.sheet >> text=Close');



await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Away');
await page.click('text=Create game');
await page.waitForSelector('text=Starting lineup');
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('[aria-label="Start clock"]');
await page.click('[aria-label="Start clock"]');
await page.waitForSelector('[aria-label="Stop clock"]');
await page.waitForTimeout(2000);

const before = secs(await page.locator('.gclock .time').innerText());

// Leave the way a coach actually would: back out to the team screen.
await page.click('[aria-label="Back"]');
await page.waitForSelector('text=Roster · 6');
check('a live game is listed as LIVE', await page.locator('text=LIVE').count(), 1);

// Kill the tab entirely — harsher than a lock screen.
await page.close();

// Wait with nothing running. This is the whole point of the test: reopening
// quickly proves nothing, because a second of drift is invisible at this
// resolution. Four seconds of genuine absence is unambiguous.
const AWAY_MS = 4000;
await new Promise((r) => setTimeout(r, AWAY_MS));

const fresh = await context.newPage();
fresh.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});
await fresh.goto(URL);
await fresh.waitForSelector('text=Resume FC');
await fresh.click('text=Resume FC');
await fresh.waitForSelector('text=Roster · 6');

// Tapping the live game must land on the live screen, not setup.
await fresh.click('.prow:has-text("vs Away")');
await fresh.waitForSelector('.pitch', { timeout: 5000 });
check('reopens on the live screen', await fresh.locator('[aria-label="Stop clock"]').count(), 1);

const after = secs(await fresh.locator('.gclock .time').innerText());
// The clock is derived from timestamps rather than ticked, so it must reflect
// the wall time that passed while the app was not even loaded.
check('clock kept running while the app was closed', after - before >= AWAY_MS / 1000, true);
check('clock did not jump absurdly', after - before < AWAY_MS / 1000 + 10, true);
console.log(`        clock ${before}s before, ${after}s after (away ${AWAY_MS / 1000}s)`);

const played = await fresh.locator('.token:not(.vacant) .ttime').allInnerTexts();
check(
  'playing time matches the clock',
  played.every((t) => Math.abs(secs(t) - after) <= 1),
  true,
);

// And it must still be substitutable, not just readable.
await fresh.click('.token:not(.vacant) >> nth=0');
await fresh.click('.benchgrid .bplayer >> nth=0');
await fresh.click('text=/^Sub 1 ↔ 1$/');
await fresh.waitForTimeout(400);
check(
  'still 5 on the pitch after a resumed sub',
  await fresh.locator('.token:not(.vacant)').count(),
  5,
);
check('no unapplied events', await fresh.locator('.banner.error').count(), 0);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
