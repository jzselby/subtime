/**
 * Season stats: one `playerStats()` fold per started game, summed across a
 * team's whole history — no new storage, just a read over what's already
 * there. This plays two games for the same team and checks the season screen
 * actually sums across them rather than only reflecting the latest one.
 *
 *   node scripts/season.mjs [--headed]
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
await page.waitForSelector('text=Touchline');

// -- a team with an exact 5-a-side roster, so nobody sits every game out ----
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Season FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (let i = 1; i <= 5; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `Player${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

// Before any game, the season is empty.
await page.click('text=Season stats');
await page.waitForSelector('h1:has-text("Season stats")');
check('no games played yet', await page.locator('text=No games played yet').count(), 1);
await page.click('.back');
await page.waitForSelector('text=Roster · 5');

const playAGame = async (opponent) => {
  await page.click('text=+ New game');
  await page.fill('input[placeholder="Rovers"]', opponent);
  await page.click('text=Create game');
  await page.waitForSelector("text=Who's here?");
  await page.click('.sheet >> text=Done');
  await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
  await page.click('text=Fill rest');
  await page.waitForTimeout(150);
  await page.click('text=Start game');
  await page.waitForSelector('.pitch');
  await page.click('[aria-label="Start clock"]');
  await page.waitForTimeout(400);

  await page.click('text=⚽ Us');
  await page.waitForSelector('text=Who scored?');
  const scorer = (await page.locator('.sheet .chip >> nth=0').innerText()).trim();
  await page.click('.sheet .chip >> nth=0');
  await page.click('.sheet >> text=No assist');
  await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
  return scorer;
};

const scorer1 = await playAGame('Rivals');
await page.goto(URL);
await page.click('text=Season FC');
await page.waitForSelector('text=Roster · 5');
const scorer2 = await playAGame('Foxes');

check(
  'the same starting lineup produces the same scorer chip both games',
  scorer1,
  scorer2,
);

// -- the season screen sums both games ---------------------------------------
await page.goto(URL);
await page.click('text=Season FC');
await page.waitForSelector('text=Roster · 5');
await page.click('text=Season stats');
await page.waitForSelector('h1:has-text("Season stats")');

check('the subtitle counts both started games', await page.locator('text=2 games').count(), 1);

const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.tbl tbody tr')].map((tr) => {
    const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '');
    return { name: cells[0], gp: cells[1], min: cells[2], goals: cells[3], positions: cells[5] };
  }),
);
console.log('season rows:', rows);

check('every one of the 5 players has a row', rows.length, 5);
check('nobody sat either game out', rows.every((r) => r.gp === '2'), true);
check('minutes agree across an unrotated lineup', new Set(rows.map((r) => r.min)).size, 1);
check('positions were recorded, not left blank', rows.every((r) => r.positions !== '—'), true);

const scorerRow = rows.find((r) => scorer1.includes(r.name.replace(/^#\d+\s*/, '')));
check('the two-game scorer shows 2 goals in the season total', scorerRow?.goals, '2');
const otherGoals = rows.filter((r) => r !== scorerRow).reduce((n, r) => n + Number(r.goals || 0), 0);
check('nobody else was credited with a goal', otherGoals, 0);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
