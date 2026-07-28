/**
 * Nothing covers a sheet.
 *
 * Reported: Delete game, at the bottom of the ••• sheet, sat underneath the
 * Copy summary / Export CSV footer on an iPhone and could not be tapped. The
 * header and footer are blurred, WebKit promotes a blurred element to its own
 * compositing layer, and that layer painted over a sheet nested between them.
 *
 * Chromium sorts the same markup correctly, so a screenshot proves nothing.
 * What this checks instead is structural, and would have caught it: every
 * button inside every sheet must be the topmost element at its own centre, and
 * the sheet must not be rendered inside the scroll pane between the two bars.
 *
 *   node scripts/sheets.mjs [--headed]
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
page.on('dialog', (d) => d.dismiss());

/**
 * Every button in the open sheet must receive its own clicks. `elementFromPoint`
 * asks the browser what is actually on top at that pixel, which is the question
 * the bug turned on — a button can be laid out perfectly and still be buried.
 */
const sheetIsClickable = async (label) => {
  const buried = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    if (!sheet) return ['no sheet'];
    const bad = [];
    for (const btn of sheet.querySelectorAll('button')) {
      const r = btn.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!btn.contains(hit)) {
        bad.push(`${(btn.textContent || '?').trim().slice(0, 24)} < ${hit?.className || '?'}`);
      }
    }
    return bad;
  });
  if (buried.length) console.log(`        buried: ${buried.join(' | ')}`);
  check(`${label}: every button is on top`, buried.length, 0);
};

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Sheet FC');
await page.selectOption('.sheet select', '7');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (let i = 1; i <= 9; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `Player ${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rivals');
await page.click('text=Create game');

// -- setup screen ----------------------------------------------------------
await page.waitForSelector("text=Who's here?");
await page.waitForTimeout(400);
await sheetIsClickable('attendance');
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// A sheet is a child of <body>, not of the scroll pane between the two bars.
await page.click('header.top >> text=Setup');
await page.waitForSelector('text=Delete game');
await page.waitForTimeout(400);
check(
  'the sheet is a direct child of body',
  await page.evaluate(() => document.querySelector('.sheet-backdrop')?.parentElement?.tagName),
  'BODY',
);
check(
  'the blurred bars are out of the way',
  await page.evaluate(() => {
    const bar = document.querySelector('.actions');
    return !bar || getComputedStyle(bar).visibility === 'hidden';
  }),
  true,
);
await sheetIsClickable('match settings');
await page.keyboard.press('Escape');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
check(
  'the bars come back when the sheet closes',
  await page.evaluate(() => document.body.classList.contains('sheet-open')),
  false,
);

await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(900);

// -- game screen -----------------------------------------------------------
await page.click('[aria-label="More"]');
await page.waitForTimeout(400);
await sheetIsClickable('game menu');
// The reported one: the destructive action lives at the bottom, nearest the bar.
check(
  'Delete game takes its own click',
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sheet button')].find((b) =>
      b.textContent?.includes('Delete game'),
    );
    if (!btn) return 'missing';
    const r = btn.getBoundingClientRect();
    return btn.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }),
  true,
);
await page.keyboard.press('Escape');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

await page.click('text=⚽ Us');
await page.waitForSelector('text=Who scored?');
await page.waitForTimeout(300);
await sheetIsClickable('goal');
// Swapping one sheet for another must not leave the page marked closed.
await page.click('.sheet .chip >> nth=0');
await page.waitForTimeout(300);
check(
  'a sheet swap keeps the page marked open',
  await page.evaluate(
    () => !document.querySelector('.sheet') || document.body.classList.contains('sheet-open'),
  ),
  true,
);
if (await page.locator('.sheet >> text=No assist').count()) {
  await page.click('.sheet >> text=No assist');
  await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
}

// -- stats screen ----------------------------------------------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Stats and playing time');
await page.waitForSelector('text=Playing-time fairness');

await page.click('[aria-label="More"]');
await page.waitForTimeout(400);
await sheetIsClickable('stats menu');
await page.keyboard.press('Escape');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

await page.click('.actions >> text=Export CSV');
await page.waitForSelector('text=Export stats');
await page.waitForTimeout(400);
await sheetIsClickable('export');

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
