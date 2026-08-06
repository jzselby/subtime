/**
 * A sheet with an autofocusing input must not end up behind the keyboard,
 * or off the top of the visible screen.
 *
 * Two separate reports, two dimensions of the same fix:
 *
 * 1. Tapping + New team, + Add player, + New game or Rename — every sheet
 *    whose input grabs focus immediately — opened with the input already
 *    hidden under the on-screen keyboard. The cause: `.sheet-backdrop` was
 *    `position: fixed; inset: 0`, sized against the *layout* viewport, which
 *    iOS Safari does not shrink for the keyboard. Only
 *    `visualViewport.height` does. A bottom-anchored sheet inside a box
 *    still sized to the full, keyboard-unaware height keeps anchoring to a
 *    bottom that's now off-screen.
 *
 * 2. "+ New game," opened from partway down a scrolled team screen, popped
 *    up off the top of the visible area — reachable only by scrolling back
 *    up to where the page used to be. Fixing (1) covers *how tall* the
 *    backdrop should be once the keyboard is up, but not *where it starts*:
 *    focusing an input makes the browser scroll the visual viewport to
 *    reveal it, independently of the layout viewport a `position: fixed`
 *    box anchors to by default, and a box still pinned at `top: 0` renders
 *    above wherever the visible area actually starts once that's happened.
 *
 * Headless Chromium has no real on-screen keyboard and doesn't scroll for a
 * simulated one either, so this drives the same mechanism the fix actually
 * depends on directly: it overrides `visualViewport.height`/`.offsetTop`
 * and fires the `resize` event the fix listens for, then checks the
 * backdrop — and the sheet inside it — actually track both rather than
 * continuing to assume the full, unscrolled window.
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
await page.waitForSelector('text=Pitchside');

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

/*
 * `visualViewport.offsetTop`: focusing an input well down a scrolled page
 * (reported against "+ New game," opened from partway down a team's game
 * list) makes the browser scroll the *visual* viewport down to reveal it,
 * independently of the layout viewport a `position: fixed` box anchors to
 * by default. A backdrop still pinned at `top: 0` in that state renders
 * above where the visible screen actually starts — reachable only by
 * scrolling back up to where the page used to be. This simulates that
 * (offsetTop and height both changing, as they would together) and checks
 * the fix reads `top` from it rather than assuming the visible area always
 * starts at the very top of the page.
 */
const waitForTop = (expected) =>
  page
    .waitForFunction(
      (t) => document.querySelector('.sheet-backdrop')?.getBoundingClientRect().top === t,
      expected,
      { timeout: 2000 },
    )
    .catch(() => {});

const SCROLLED_PX = 180;
await page.evaluate(
  ({ shrinkBy, scrolledBy }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', {
      configurable: true,
      get: () => window.innerHeight - shrinkBy,
    });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => scrolledBy });
    vv.dispatchEvent(new Event('resize'));
  },
  { shrinkBy: KEYBOARD_PX, scrolledBy: SCROLLED_PX },
);
await waitForTop(SCROLLED_PX);

const scrolled = await page.evaluate(() => {
  const backdrop = document.querySelector('.sheet-backdrop')?.getBoundingClientRect();
  const closeBtn = document.querySelector('.sheet .btn.ghost')?.getBoundingClientRect();
  return { backdropTop: backdrop?.top, backdropHeight: backdrop?.height, closeBtnTop: closeBtn?.top };
});
console.log('with the visible area scrolled', SCROLLED_PX, 'px down:', scrolled);

check("the backdrop's top follows the visible area, not the page's own top", scrolled.backdropTop, SCROLLED_PX);
check('its height still reflects the keyboard', scrolled.backdropHeight, fullHeight - KEYBOARD_PX);
check(
  "the sheet's own close button — up near its title bar — stays at or below the visible area's top edge",
  scrolled.closeBtnTop >= SCROLLED_PX,
  true,
);

// -- resetting both recovers the untouched full-window backdrop -------------
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight });
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
  vv.dispatchEvent(new Event('resize'));
});
await waitForTop(0);
const afterReset = await page.evaluate(() => {
  const r = document.querySelector('.sheet-backdrop')?.getBoundingClientRect();
  return r && { top: r.top, height: r.height };
});
check('resetting both restores the backdrop to the top of the window', afterReset?.top, 0);
check('and its full height', afterReset?.height, fullHeight);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
