/**
 * Real touch input on the bench, not mouse simulation.
 *
 * Reported: "I can't scroll sideways through players to see the whole team.
 * It just selects a player to place." The setup screen's bench is a
 * horizontally scrolling strip, and `.bplayer` carries `touch-action: none`
 * so drag-to-pitch gets every pointer sample reliably — which also meant a
 * sideways swipe had nothing left to scroll it: the browser had no native
 * gesture to fall back to, and the drag code only tracks a player's position,
 * it never scrolled the container itself. A swipe through the roster silently
 * became "pick up this shirt."
 *
 * The first fix tried was CSS (`touch-action: pan-x`), and it broke the other
 * half of the same gesture: a browser holding `pan-x` decides "scroll" from
 * the first couple of pixels, and a drag toward any slot that isn't directly
 * overhead starts out just as sideways as a real scroll does — measured, a
 * drag toward an off-centre slot moved 12px right and 10px up on its first
 * sample and got cancelled before it had a chance to become a drag. The fix
 * that stuck keeps `touch-action: none` and disambiguates in JS instead
 * (`usePitchDrag.ts`), once, at the moment slop is exceeded, off whichever
 * axis moved further — and only when the bench found under the touch start
 * actually has something to scroll, so the live screen's bench (a wrapping
 * grid with no horizontal overflow) is never affected.
 *
 * None of this is reachable with mouse-simulated drags — `touch-action` only
 * governs touch input — which is why scripts/drag.mjs never caught it. This
 * drives real touch events through Chromium via CDP.
 *
 *   node scripts/bench-touch.mjs [--headed]
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
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});
page.on('dialog', (d) => d.accept());
const client = await ctx.newCDPSession(page);

/** A real touch gesture, dispatched via CDP so touch-action is honoured. */
async function touchGesture(x1, y1, x2, y2, steps = 12) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x1 + (x2 - x1) * (i / steps);
    const y = y1 + (y2 - y1) * (i / steps);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(15);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const rightmostBox = async (locator) => {
  let best = null;
  let maxX = -Infinity;
  for (const el of await locator.all()) {
    const box = await el.boundingBox();
    if (box && box.x > maxX) {
      maxX = box.x;
      best = box;
    }
  }
  return best;
};

const NAMES = ['Ana', 'Bea', 'Cal', 'Dee', 'Eli', 'Fin', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Mac', 'Nia'];

await page.goto(URL);
await page.waitForSelector('text=Pitchside');
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Touch FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (let i = 0; i < NAMES.length; i++) {
  await page.fill('input[inputmode="numeric"]', String(i + 1));
  await page.fill('#player-name', NAMES[i]);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(15);
}
await page.click('.sheet >> text=Close');
await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// -- setup screen: a horizontal swipe scrolls the strip ---------------------
const strip = page.locator('.benchstrip');
check('the bench overflows on a 5-a-side squad of 14', await strip.evaluate((el) => el.scrollWidth > el.clientWidth), true);
const box = await strip.boundingBox();
await touchGesture(box.x + box.width - 20, box.y + box.height / 2, box.x + 20, box.y + box.height / 2);
await page.waitForTimeout(200);
check('a horizontal swipe over a bench shirt scrolls the strip', await strip.evaluate((el) => el.scrollLeft > 0), true);
await strip.evaluate((el) => { el.scrollLeft = 0; });
await page.waitForTimeout(100);

// -- setup screen: a diagonal drag toward an off-centre slot still places --
const benchName = await page.locator('.benchstrip .bplayer .tname >> nth=0').innerText();
const benchBox = await page.locator('.benchstrip .bplayer >> nth=0').boundingBox();
const target = await rightmostBox(page.locator('.token'));
await touchGesture(
  benchBox.x + benchBox.width / 2, benchBox.y + benchBox.height / 2,
  target.x + target.width / 2, target.y + target.height / 2,
);
await page.waitForTimeout(300);
let onPitch = await page.locator('.token:not(.vacant) .tname').allInnerTexts();
check('a drag toward an off-centre slot still places the player', onPitch.includes(benchName), true);

// -- live screen: the wrapping bench grid never scrolls, so any-direction
// drags there must be completely unaffected by the bench-scroll guard -------
await page.click('text=Fill rest');
await page.waitForTimeout(150);
await page.click('text=Start game');
await page.waitForSelector('.pitch');

const liveBenchName = await page.locator('.benchgrid .bplayer .tname >> nth=0').innerText();
const liveBenchBox = await page.locator('.benchgrid .bplayer >> nth=0').boundingBox();
const liveTarget = await rightmostBox(page.locator('.token:not(.vacant)'));
await touchGesture(
  liveBenchBox.x + liveBenchBox.width / 2, liveBenchBox.y + liveBenchBox.height / 2,
  liveTarget.x + liveTarget.width / 2, liveTarget.y + liveTarget.height / 2,
);
await page.waitForTimeout(300);
onPitch = await page.locator('.token:not(.vacant) .tname').allInnerTexts();
check('the live screen\'s non-scrolling bench still drags by touch', onPitch.includes(liveBenchName), true);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
