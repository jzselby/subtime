/**
 * Shirt circles: jersey number when set, first-and-last initial when it isn't.
 *
 * Reported: the circles were hard to identify a player from. The fallback for
 * a player with no number was `name.slice(0, 2)` — the first two characters
 * of the whole string, "Leo Selby" → "Le" — which reads as arbitrary rather
 * than as the person. Real initials ("LS") read as the person instead.
 *
 *   node scripts/initials.mjs [--headed]
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
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Initials FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');

// A numbered player, a multi-word name with no number, and a one-word name
// with no number — the three cases the fallback has to cover.
const ROSTER = [
  ['9', 'Cal Diaz'],
  ['', 'Leo Selby'],
  ['', 'Cher'],
  ['1', 'Ana Ruiz'],
  ['', 'Kit Larsen'],
  ['', 'Bo Park'],
];
for (const [num, name] of ROSTER) {
  if (num) await page.fill('input[inputmode="numeric"]', num);
  await page.fill('#player-name', name);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// -- setup screen: bench shirts, before anyone is placed ---------------------
const shirts = await page.locator('.benchstrip .bplayer .shirt').allInnerTexts();
console.log('setup bench shirts:', shirts);
check('a numbered player still shows the number', shirts.includes('9'), true);
check('a two-word name with no number shows real initials', shirts.includes('LS'), true);
check('a one-word name with no number falls back sensibly', shirts.includes('CH'), true);
check('the old truncated-name fallback is gone', shirts.includes('Le'), false);

// -- placed on the pitch -------------------------------------------------------
await page.click('text=Fill rest');
await page.waitForTimeout(150);
const pitchShirts = await page.locator('.token .shirt').allInnerTexts();
console.log('pitch shirts:', pitchShirts);
check('initials show on the pitch too', pitchShirts.includes('KL') || pitchShirts.includes('BP'), true);

// -- live screen: bench grid, once the game has started -----------------------
await page.click('text=Start game');
await page.waitForSelector('.pitch');
const liveBench = await page.locator('.benchgrid .bplayer .shirt').allInnerTexts();
console.log('live bench shirts:', liveBench);
check('the live screen bench uses initials too', liveBench.length > 0 ? !liveBench.includes('Le') : true, true);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
