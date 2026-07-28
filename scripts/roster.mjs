/**
 * Removing a player must not rewrite history.
 *
 * The event log stores player *ids*. Deleting the row those ids point at does
 * not remove the player from a game already played — it removes their name, and
 * the summary, the timeline and the exported CSV start attributing goals to a
 * raw UUID with no way back. A player who has played is retired instead; one who
 * has never played has nothing to orphan and is deleted outright.
 *
 * Also covers the CSV formula guard, which has to defuse a name beginning `=`
 * without turning a legitimately negative plus/minus into text.
 *
 *   node scripts/roster.mjs [--headed]
 */
import { readFile } from 'node:fs/promises';
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

let confirms = [];
page.on('dialog', (d) => {
  confirms.push(d.message());
  d.accept();
});

await page.goto(URL);
await page.waitForSelector('text=Sub Time');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Roster FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

/*
 * One player is named `=1+1` on purpose. It is the formula-injection case, and
 * it also proves the CSV guard runs over real recorded data rather than a
 * hand-built string.
 */
const names = ['Alice Adams', 'Bo Brooks', 'Cal Chen', 'Dee Diaz', 'Eve Ellis', '=1+1', 'Gus Gray'];
await page.click('text=+ Add player');
for (let i = 0; i < names.length; i++) {
  await page.fill('input[inputmode="numeric"]', String(i + 1));
  await page.fill('#player-name', names[i]);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');
await page.waitForSelector('text=Roster · 7');

// -- a player who has never played is deleted outright ---------------------
confirms = [];
await page.click('.prow:has-text("Gus Gray") >> text=Remove');
await page.waitForSelector('text=Roster · 6');
check('a player who never played is removed', await page.locator('text=Gus Gray').count(), 0);
check('and is not filed as retired', await page.locator('text=Retired ·').count(), 0);
check(
  'the confirm says nothing is recorded against them',
  confirms[0]?.includes('not played a game'),
  true,
);

// -- play a game, so the rest have history ---------------------------------
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rivals');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1200);

// A goal for Alice, and one for the opposition so plus/minus goes negative.
await page.click('text=⚽ Us');
await page.waitForSelector('text=Who scored?');
await page.click(`.sheet .chip:has-text("Alice Adams")`);
await page.click('.sheet >> text=No assist');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=⚽ Them');
await page.waitForTimeout(200);
await page.click('text=⚽ Them');
await page.waitForTimeout(300);

// -- the CSV, before anyone is retired -------------------------------------
await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Stats and playing time');
await page.waitForSelector('text=Playing-time fairness');
await page.click('.actions >> text=Export CSV');
await page.waitForSelector('text=Export stats');
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.sheet >> text=Download CSV'),
]);
const csv = (await readFile(await dl.path())).toString();
check('a formula name is defused', csv.includes(`"'=1+1"`), true);
check('and is not left live', /(^|,)"=1\+1"/.test(csv), false);
// plus_minus is the seventh column and is legitimately negative here.
const minus = csv.trim().split('\n').slice(1).map((r) => r.split(',')[6]);
check('a negative plus/minus stays a number', minus.some((v) => v === '"-1"'), true);
check('no negative number was quoted as text', minus.some((v) => v?.includes("'")), false);
check('every player is in the file', csv.trim().split('\n').length, 7);

// -- someone on the pitch right now is not removable -----------------------
await page.goto(URL);
await page.click('text=Roster FC');
await page.waitForSelector('text=Roster · 6');
confirms = [];
await page.click('.prow:has-text("Alice Adams") >> text=Remove');
await page.waitForTimeout(400);
check('removing a player mid-match is refused', confirms[0]?.includes('on the field'), true);
check('and they stay on the roster', await page.locator('text=Roster · 6').count(), 1);
check('and are not retired', await page.locator('text=Retired ·').count(), 0);

// -- retiring a player who has played --------------------------------------
await page.click('text=vs Rivals');
await page.waitForSelector('.pitch');
await page.click('[aria-label="End 1H"]', { delay: 800 });
await page.waitForTimeout(300);
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(600);
await page.click('[aria-label="End 2H"]', { delay: 800 });
await page.waitForTimeout(500);
await page.goto(URL);
await page.click('text=Roster FC');
await page.waitForSelector('text=Roster · 6');

confirms = [];
await page.click('.prow:has-text("Alice Adams") >> text=Remove');
await page.waitForSelector('text=Retired · 1');
check(
  'the confirm says how many games they played',
  confirms[0]?.includes('played 1 game'),
  true,
);
check('the confirm promises the record survives', confirms[0]?.includes('still named'), true);
check('the roster shrinks', await page.locator('text=Roster · 5').count(), 1);
check(
  'they are listed as retired',
  await page.locator('h2:has-text("Retired") ~ .plist >> text=Alice Adams').count(),
  1,
);

// -- the record still reads their name -------------------------------------
await page.click('text=vs Rivals');
await page.waitForSelector('text=Playing-time fairness');
const summary = await page.locator('main').innerText();
check('the summary still names them', summary.includes('Alice Adams'), true);
check('no raw id leaked into the summary', /[0-9a-f]{8}-[0-9a-f]{4}/.test(summary), false);

await page.click('.actions >> text=Export CSV');
await page.waitForSelector('text=Export stats');
const [dl2] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.sheet >> text=Download CSV'),
]);
const csv2 = (await readFile(await dl2.path())).toString();
check('the CSV still names them', csv2.includes('Alice Adams'), true);
check('their goal is still theirs', /"Alice Adams",[^\n]*,"1",/.test(csv2), true);

// -- a retired player is off future team sheets ----------------------------
await page.goto(URL);
await page.click('text=Roster FC');
await page.waitForSelector('text=Retired · 1');
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Next Week');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.waitForTimeout(300);
check(
  'a retired player is not on the next team sheet',
  await page.locator('.sheet >> text=Alice Adams').count(),
  0,
);
check(
  'the rest of the roster is',
  await page.locator('.sheet >> text=Bo Brooks').count(),
  1,
);
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// -- restoring ---------------------------------------------------------------
await page.goto(URL);
await page.click('text=Roster FC');
await page.waitForSelector('text=Retired · 1');
await page.click('.prow:has-text("Alice Adams") >> text=Restore');
await page.waitForSelector('text=Roster · 6');
check('a restored player is back on the roster', await page.locator('text=Retired ·').count(), 0);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
