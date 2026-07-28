/**
 * Portrait only — this is a one-handed sideline app, not a wide one.
 *
 * `screen.orientation.lock()` (App.tsx) is the hard version, but it only
 * works on Android Chrome once installed as a standalone app; neither iOS
 * nor a plain browser tab implements it at all. `.landscape-guard` is the
 * fallback that works everywhere: a live `@media (orientation: landscape)`
 * query that covers the screen — sheets included — the moment the device
 * turns sideways, rather than a value read once at load.
 *
 * Headless Chromium has no real accelerometer, but `orientation: landscape`
 * is purely a function of viewport aspect ratio, so resizing the viewport
 * itself exercises the exact mechanism the CSS depends on.
 *
 *   node scripts/orientation.mjs [--headed]
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
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const page = await browser.newPage({ viewport: PORTRAIT });
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

await page.goto(URL);
await page.waitForSelector('text=Touchline');

const guardDisplay = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('.landscape-guard')).display);
const topmostAt = (x, y) =>
  page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.className, [x, y]);
const topmostIsIn = (x, y, selector) =>
  page.evaluate(
    ([px, py, sel]) => !!document.elementFromPoint(px, py)?.closest(sel),
    [x, y, selector],
  );

// -- portrait: the guard is inert -------------------------------------------
check('the guard is hidden in portrait', await guardDisplay(), 'none');
check(
  'the header actually receives taps, not the (hidden) guard',
  await topmostIsIn(PORTRAIT.width / 2, 40, '.top'),
  true,
);

// -- rotate: the guard takes over -------------------------------------------
await page.setViewportSize(LANDSCAPE);
check('the guard shows in landscape', await guardDisplay(), 'flex');
check(
  'it sits above everything and actually catches the tap',
  (await topmostAt(LANDSCAPE.width / 2, LANDSCAPE.height / 2)) === 'landscape-guard',
  true,
);
check(
  'the app underneath is hidden, not just covered',
  await page.evaluate(() => getComputedStyle(document.querySelector('.app')).visibility),
  'hidden',
);

// -- it also catches an open sheet, not just the home screen -----------------
await page.setViewportSize(PORTRAIT);
await page.click('text=+ New team');
await page.waitForSelector('text=Create team');
await page.setViewportSize(LANDSCAPE);
check(
  'a sheet open at the moment of rotation is covered too',
  (await topmostAt(LANDSCAPE.width / 2, LANDSCAPE.height / 2)) === 'landscape-guard',
  true,
);

// -- rotate back: the guard stands down --------------------------------------
await page.setViewportSize(PORTRAIT);
check('the guard hides again back in portrait', await guardDisplay(), 'none');

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
