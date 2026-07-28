/**
 * The match clock across a period boundary.
 *
 * Reported: a first half ended at ~5 minutes, and the second half opened
 * reading over two hours. This plays a short first half, ends it, starts the
 * second, and reads the clock at each step.
 *
 *   node scripts/clock.mjs [--headed]
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
  const parts = t.trim().split(':').map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
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

const clock = async () => (await page.locator('.gclock .time').innerText()).trim();

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Clock FC');
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

// Two halves of 30 minutes — the default — but we will only play seconds of it.
await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');

page.on('dialog', (d) => d.accept());

// -- first half ------------------------------------------------------------
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(4000);
const firstHalf = await clock();
console.log(`   first half reads ${firstHalf}`);
check('first half counts up from zero', secs(firstHalf) >= 3 && secs(firstHalf) <= 8, true);

check('period label reads 1H', (await page.locator('.gclock .meta').innerText()).startsWith('1H'), true);

// -- end it, from the stop button rather than the ••• menu ------------------
await page.click('[aria-label="End 1H"]');
await page.waitForTimeout(400);
const atBreak = await clock();
console.log(`   at half time reads ${atBreak}`);
// One second of slack: the reading is taken a moment after the button.
check(
  'half time holds the time played',
  Math.abs(secs(atBreak) - secs(firstHalf)) <= 1,
  true,
);

// -- second half -----------------------------------------------------------
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1200);
const secondHalf = await clock();
console.log(`   second half reads ${secondHalf}`);

/*
 * The clock reads *within the period*, beside a period label, so a second half
 * opens at 0:0x. The bug this guards was a running total padded by the
 * *configured* period length: a short half — a tournament game, or one the
 * referee cut — jumped the clock forward by the difference, and a four-second
 * first half opened the second at 30:01.
 */
check('second half restarts at zero', secs(secondHalf) <= 4, true);
check('period label reads 2H', (await page.locator('.gclock .meta').innerText()).startsWith('2H'), true);

// The whole-game total is the honest running figure, and it is the sum of what
// was actually played rather than of what was scheduled.
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Stats and playing time');
await page.waitForSelector('text=Playing-time fairness');
const played = (await page.locator('header.top .sub').innerText()).match(/(\d+:\d+) played/);
console.log(`   total played reads ${played?.[1]}`);
check(
  'total played is both halves, not a padded one',
  secs(played?.[1] ?? '0:00') >= secs(firstHalf) && secs(played?.[1] ?? '0:00') <= secs(firstHalf) + 8,
  true,
);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
