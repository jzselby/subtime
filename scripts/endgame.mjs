/**
 * Ending a game explicitly, rather than only as a side effect of ending the
 * last configured period.
 *
 * Reported: "There's nothing to end a game. It appears to end when you stop
 * a second half and go back." True — PERIOD_END on the last period already
 * finalises a game played to schedule, but there was no way to finish one
 * early (weather, an injury pile-up, a tournament that cuts a game short)
 * without holding through periods never meant to be played. This drives the
 * new GAME_END event and its "Hold to end the game" control from both the
 * live screen and the stats screen, and checks the recovery path: deleting
 * the GAME_END event un-finalises the game, same as deleting a PERIOD_END.
 *
 *   node scripts/endgame.mjs [--headed]
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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !args.includes('--headed'),
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});
page.on('dialog', (d) => d.accept());

await page.goto(URL);
await page.waitForSelector('text=Pitchside');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'End FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (let i = 1; i <= 6; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `P${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

// Two periods, so ending after only the first is genuinely "early".
await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(150);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1500);

// -- the menu offers it, and a plain tap does not fire it -------------------
await page.click('[aria-label="More"]');
await page.waitForSelector('text=Hold to end the game');
await page.click('.sheet >> text=Hold to end the game'); // a normal, quick click
await page.waitForTimeout(200);
check('a quick tap does not end the game', await page.locator('text=Playing-time fairness').count(), 0);
check('the menu is still open — nothing fired', await page.locator('text=Hold to end the game').count(), 1);

// -- holding it ends the game early, mid-first-half -------------------------
await page.click('.sheet >> text=Hold to end the game', { delay: 800 });
await page.waitForSelector('text=Playing-time fairness');
check('holding it navigates to the final summary', await page.locator('text=Playing-time fairness').count(), 1);
check('the header reads the final score', (await page.locator('header.top h1').innerText()).length > 0, true);

// -- it is genuinely final: only one of two periods was played --------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Modify events');
await page.waitForSelector('text=Modify events');
check(
  'the log records the game ending, not a second period',
  await page.locator('text=Game ended').count(),
  1,
);
check('the second period never started', await page.locator('text=Period 2 started').count(), 0);

// -- the option disappears once the game is final ----------------------------
await page.click('[aria-label="Back"]');
await page.waitForSelector('text=Playing-time fairness');
await page.click('[aria-label="More"]');
await page.waitForTimeout(200);
check(
  'a final game does not offer to end itself again',
  await page.locator('text=Hold to end the game').count(),
  0,
);
await page.keyboard.press('Escape');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// -- recovery: deleting the event un-finalises the game ----------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Modify events');
await page.waitForSelector('text=Game ended');
await page.click('.prow:has-text("Game ended")');
await page.waitForSelector('text=Delete this event');
await page.click('text=Delete this event');
await page.waitForTimeout(300);
check('the event is gone from the log', await page.locator('text=Game ended').count(), 0);

// Back from Events returns to wherever it was opened from — Summary, in this
// flow — and the game is no longer final, so the game screen is reachable
// again and the option to end it is back too.
await page.click('[aria-label="Back"]');
await page.waitForTimeout(300);
check(
  'the game is playable again — Back to game is offered',
  await page.locator('text=Back to game').count(),
  1,
);
await page.click('[aria-label="More"]');
await page.waitForTimeout(200);
check('the "end the game" option is back', await page.locator('text=Hold to end the game').count(), 1);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
