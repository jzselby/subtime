/**
 * Drag-to-sub, driven as a real pointer gesture.
 *
 * Covers the four drops the game screen supports: bench onto an occupied shirt
 * (a swap), bench onto an empty one, a player from the pitch onto the bench
 * (off), and one pitch player onto another (trading positions). Also checks
 * that a short press still registers as a tap, since tap-to-select shares the
 * same handler.
 *
 *   node scripts/drag.mjs [--headed]
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

/** A real press-move-release, with enough steps to clear the drag threshold. */
const dragTo = async (fromBox, toBox) => {
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

const shirtAt = async (slotIndex) =>
  (await page.locator(`.token >> nth=${slotIndex}`).getAttribute('aria-label')) ?? '';

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Drag FC');
await page.selectOption('.sheet select', '7');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

await page.click('text=+ Add player');
for (let i = 1; i <= 10; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `P${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector('.pitch');
// Attendance opens on arrival with everyone ticked; accept it as-is.
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
// -- 0. dragging works during setup too ----------------------------------
// Put one player on, then move them to a different position without ever
// sending them back to the bench.
await page.click('.token >> nth=1');
await page.click('.sheet .chip:not([disabled]) >> nth=0');
await page.waitForTimeout(150);
const setupName = (await page.locator('.token:not(.vacant) .tname').innerText()).trim();
await dragTo(
  await page.locator('.token:not(.vacant)').boundingBox(),
  await page.locator('.token.vacant >> nth=3').boundingBox(),
);
check('setup: a player can be dragged between positions', await page.locator('.token:not(.vacant)').count(), 1);
check(
  'setup: it is still the same player',
  (await page.locator('.token:not(.vacant) .tname').innerText()).trim(),
  setupName,
);
// And back to the bench.
await dragTo(
  await page.locator('.token:not(.vacant)').boundingBox(),
  await page.locator('.benchstrip').boundingBox(),
);
check('setup: dragging to the bench unassigns', await page.locator('.token:not(.vacant)').count(), 0);

await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(600);

// -- 1. bench onto an occupied shirt = swap -------------------------------
const benchName = await page.locator('.benchgrid .bplayer .tname >> nth=0').innerText();
const targetLabelBefore = await shirtAt(0);
const onPitchBefore = targetLabelBefore.split(',')[0];

await dragTo(
  await page.locator('.benchgrid .bplayer >> nth=0').boundingBox(),
  await page.locator('.token >> nth=0').boundingBox(),
);

const afterLabel = await shirtAt(0);
check('bench → shirt puts the dragged player there', afterLabel.startsWith(benchName), true);
check(
  'the player who was there went to the bench',
  (await page.locator('.benchgrid .bplayer .tname').allInnerTexts()).includes(onPitchBefore),
  true,
);
check('still 7 on the pitch', await page.locator('.token:not(.vacant)').count(), 7);
await page.screenshot({ path: 'scripts/shots/drag-1-swap.png' });

// -- 2. pitch onto the bench = off ----------------------------------------
await dragTo(
  await page.locator('.token:not(.vacant) >> nth=0').boundingBox(),
  await page.locator('.benchgrid').boundingBox(),
);
check('pitch → bench takes the player off', await page.locator('.token:not(.vacant)').count(), 6);
check('an empty position is left behind', await page.locator('.token.vacant').count(), 1);

// -- 3. bench onto the empty shirt = straight on --------------------------
await dragTo(
  await page.locator('.benchgrid .bplayer >> nth=0').boundingBox(),
  await page.locator('.token.vacant').boundingBox(),
);
check('bench → empty position fills it', await page.locator('.token:not(.vacant)').count(), 7);

// -- 4. one pitch player onto another = trade positions -------------------
const aBefore = (await shirtAt(1)).split(',');
const bBefore = (await shirtAt(2)).split(',');
await dragTo(
  await page.locator('.token >> nth=1').boundingBox(),
  await page.locator('.token >> nth=2').boundingBox(),
);
const aAfter = (await shirtAt(1)).split(',');
const bAfter = (await shirtAt(2)).split(',');
check('players traded positions', aAfter[0] === bBefore[0] && bAfter[0] === aBefore[0], true);
check('positions themselves did not move', aAfter[1] === aBefore[1] && bAfter[1] === bBefore[1], true);
check('still 7 on the pitch after the trade', await page.locator('.token:not(.vacant)').count(), 7);
await page.screenshot({ path: 'scripts/shots/drag-2-traded.png' });

// -- 5. a press without movement is still a tap ---------------------------
await page.click('.benchgrid .bplayer >> nth=0');
await page.waitForTimeout(150);
check('tapping still selects', await page.locator('.bplayer.picked').count(), 1);
// The bug this suite was written for: a drop that also fired the tap handler
// underneath it, leaving the "who goes on?" sheet covering the pitch.
check('no drag left a sheet open', await page.locator('.sheet-backdrop').count(), 0);

const errs = await page.locator('.banner.error').allInnerTexts();
check('no unapplied events', errs.length, 0);
if (errs.length) console.log('   banner:', JSON.stringify(errs));

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
