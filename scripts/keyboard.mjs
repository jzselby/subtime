/**
 * A sheet with an autofocusing input must not end up behind the keyboard.
 *
 * Reported: tapping + New team, + Add player, + New game or Rename — every
 * sheet whose input grabs focus immediately — opened with the input already
 * hidden under the on-screen keyboard. The cause: `.sheet-backdrop` was
 * `position: fixed; inset: 0`, sized against the *layout* viewport, which
 * iOS Safari does not shrink for the keyboard. Only `visualViewport.height`
 * does. A bottom-anchored sheet inside a box still sized to the full,
 * keyboard-unaware height keeps anchoring to a bottom that's now off-screen.
 *
 * Headless Chromium has no real on-screen keyboard, so this drives the same
 * mechanism the fix actually depends on: it overrides `visualViewport.height`
 * and fires the `resize` event the fix listens for, then checks the backdrop
 * — and the sheet inside it — actually shrink to fit above that line rather
 * than continuing to span the full window.
 *
 *   node scripts/keyboard.mjs [--headed]
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

/**
 * Waits for the reflow to catch up to a state update, but degrades to "just
 * read whatever it settled on" rather than hanging the whole run — a real
 * regression should surface as a normal FAIL from the checks below it, not
 * an uncaught timeout that skips them.
 */
const waitForHeight = (expected) =>
  page
    .waitForFunction(
      (h) => document.querySelector('.sheet-backdrop')?.getBoundingClientRect().height === h,
      expected,
      { timeout: 2000 },
    )
    .catch(() => {});

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: !args.includes('--headed'),
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

await page.goto(URL);
await page.waitForSelector('text=Touchline');

// -- before any keyboard, the sheet spans the full window --------------------
await page.click('text=+ New team');
await page.waitForSelector('text=Create team');
// Let the sheet's own opening animation (a 180ms rise) finish settling before
// measuring anything, so its transform isn't still mid-flight when the
// keyboard gets simulated a moment later.
await page.waitForTimeout(250);
const fullHeight = await page.evaluate(() => window.innerHeight);
const heightBefore = await page.evaluate(
  () => document.querySelector('.sheet-backdrop')?.getBoundingClientRect().height,
);
check('with no keyboard, the backdrop spans the full window', heightBefore, fullHeight);

// -- simulate the keyboard: visualViewport shrinks, and fires resize --------
const KEYBOARD_PX = 320;
await page.evaluate((shrinkBy) => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', {
    configurable: true,
    get: () => window.innerHeight - shrinkBy,
  });
  vv.dispatchEvent(new Event('resize'));
}, KEYBOARD_PX);
// The React state update from the resize listener lands a tick or two after
// the event fires, not synchronously with it — wait for the reflow to catch
// up rather than a fixed delay racing it.
await waitForHeight(fullHeight - KEYBOARD_PX);

const backdrop = await page.evaluate(() => {
  const el = document.querySelector('.sheet-backdrop');
  const r = el?.getBoundingClientRect();
  return r && { height: r.height, bottom: r.bottom };
});
const sheetBottom = await page.evaluate(
  () => document.querySelector('.sheet')?.getBoundingClientRect().bottom,
);

console.log('full window:', fullHeight, 'simulated visible height:', fullHeight - KEYBOARD_PX);
console.log('backdrop after keyboard:', backdrop, 'sheet bottom:', sheetBottom);

check('the backdrop shrinks to the visible height', backdrop?.height, fullHeight - KEYBOARD_PX);
check(
  'and its own bottom edge sits at the top of the keyboard, not off-screen',
  backdrop?.bottom,
  fullHeight - KEYBOARD_PX,
);
check(
  "the sheet inside it — where the focused input lives — stays above the keyboard's top edge",
  sheetBottom <= fullHeight - KEYBOARD_PX,
  true,
);

// -- the keyboard closing (viewport height recovers) is picked up too -------
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight });
  vv.dispatchEvent(new Event('resize'));
});
await waitForHeight(fullHeight);
const heightAfter = await page.evaluate(
  () => document.querySelector('.sheet-backdrop')?.getBoundingClientRect().height,
);
check('closing the keyboard restores the full-height backdrop', heightAfter, fullHeight);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
