/**
 * Correcting a recorded game.
 *
 * The claim the event log makes is that fixing one row fixes everything derived
 * from it, with no reconciliation anywhere. This checks that literally: attribute
 * a goal to the wrong player, correct it in the editor, and confirm the stats
 * screen moves the goal — and that deleting a substitution puts the squad back.
 *
 *   node scripts/edit.mjs [--headed]
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

/** Goals and assists for one player, off the stats screen. */
const statsRow = async (name) => {
  const row = page.locator(`table.tbl >> nth=1 >> tbody tr:has-text("${name}")`);
  const cells = await row.locator('td').allInnerTexts();
  return { goals: cells[4]?.trim() ?? '', assists: cells[5]?.trim() ?? '' };
};

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Edit FC');
await page.selectOption('.sheet select', '7');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

await page.click('text=+ Add player');
for (let i = 1; i <= 9; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `P${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(800);

// Record a goal for whoever the first chip is, and a sub.
await page.click('text=⚽ Us');
const scorer = (await page.locator('.sheet .chip >> nth=0').innerText()).replace(/^\d+\s*/, '').trim();
await page.click('.sheet .chip >> nth=0');
await page.click('.sheet >> text=No assist');
await page.waitForTimeout(300);

await page.click('.token:not(.vacant) >> nth=0');
await page.click('.benchgrid .bplayer >> nth=0');
await page.click('text=/^Sub 1 ↔ 1$/');
await page.waitForTimeout(400);
const onPitchAfterSub = await page.locator('.token:not(.vacant)').count();

// -- correct the scorer ----------------------------------------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Modify events');
await page.waitForSelector('text=Modify events');
// Attendance is collapsed by default; everything that happened is not.
check('attendance is collapsed', await page.locator('.prow:has-text("present")').count(), 0);
await page.click('text=/^Show attendance/');
await page.waitForTimeout(150);
check('attendance can be shown', (await page.locator('.prow:has-text("present")').count()) > 0, true);
await page.click('text=/^Hide attendance/');
await page.waitForTimeout(150);
check('the game itself is listed', (await page.locator('.plist .prow').count()) >= 4, true);
await page.screenshot({ path: 'scripts/shots/edit-1-log.png' });

await page.click(`.prow:has-text("Goal:")`);
await page.waitForSelector('text=Change scorer');
await page.click('text=Change scorer');
// Pick someone who is definitely not the current scorer.
const chips = await page.locator('.sheet .chip').allInnerTexts();
const replacement = chips.map((c) => c.replace(/^\d+\s*/, '').trim()).find((n) => n !== scorer && n !== 'Nobody');
await page.click(`.sheet .chip:has-text("${replacement}")`);
await page.waitForTimeout(400);
check(
  'the log shows the corrected scorer',
  (await page.locator('.prow:has-text("Goal:")').innerText()).includes(replacement),
  true,
);
await page.screenshot({ path: 'scripts/shots/edit-2-corrected.png' });

// -- the correction must reach the stats -----------------------------------
await page.click('[aria-label="Back"]');
await page.waitForSelector('.pitch');
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Stats and playing time');
await page.waitForSelector('text=Playing-time fairness');
check('goal moved to the right player', (await statsRow(replacement)).goals, '1');
check('goal removed from the wrong one', (await statsRow(scorer)).goals, '');

// -- deleting an event puts the squad back ---------------------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Modify events');
await page.waitForSelector('text=Modify events');
await page.click('.prow:has-text("Sub:")');
await page.click('text=Delete this event');
await page.waitForTimeout(400);
check('the sub is gone from the log', await page.locator('.prow:has-text("Sub:")').count(), 0);

await page.click('[aria-label="Back"]');
await page.waitForSelector('text=Playing-time fairness');
await page.click('text=Back to game');
await page.waitForSelector('.pitch');
check('squad is still complete', await page.locator('.token:not(.vacant)').count(), onPitchAfterSub);
check('no unapplied events', await page.locator('.banner.error').count(), 0);

// -- swap two positions without anyone going to the bench ------------------
const labelOf = async (i) => (await page.locator(`.token >> nth=${i}`).getAttribute('aria-label')) ?? '';
const a0 = (await labelOf(1)).split(',');
const b0 = (await labelOf(2)).split(',');
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Show as list');
await page.waitForTimeout(200);
// Tapping a player's position badge offers every position, occupied or not.
await page.click(`.plist .prow:has-text("${a0[0]}") .pos`);
await page.waitForSelector('text=Move ');
await page.click(`.sheet .chip:has-text("${b0[1].trim()}")`);
await page.waitForTimeout(400);
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Show the field');
await page.waitForTimeout(200);
const a1 = (await labelOf(1)).split(',');
const b1 = (await labelOf(2)).split(',');
check('the two players swapped', a1[0] === b0[0] && b1[0] === a0[0], true);
check('nobody went to the bench', await page.locator('.token:not(.vacant)').count(), onPitchAfterSub);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
