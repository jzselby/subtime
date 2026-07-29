/**
 * "Not at all" (Team settings → keeper minutes count toward fair share) used
 * to only discount the keeper's own credit within the same equal-target pool
 * as everyone else — so a keeper who had played the entire game showed up
 * looking exactly as "owed" as someone who had not played a minute, the
 * opposite of what "excluded" says on the tin. Fixed in core (see
 * fairness.test.ts for the underlying math); this checks the visible
 * consequence: with the keeper excluded, their row on the live screen
 * carries no "on track" / "ends N short" tag at all, while an outfield
 * player's still does.
 *
 *   node scripts/gk-fairness.mjs [--headed]
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
await page.waitForSelector('text=Pitchside');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'GK FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (let i = 1; i <= 5; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', `Player${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(15);
}
await page.click('.sheet >> text=Close');

// -- exclude the keeper from fairness ----------------------------------------
await page.click('text=Settings');
await page.waitForSelector('text=Team settings');
await page
  .locator('label:has-text("Keeper minutes count toward fair share") select')
  .selectOption('0');
await page.click('.sheet >> text=Save');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// -- play the game, keeper never subbed --------------------------------------
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rivals');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(150);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(600);

await page.click('[aria-label="More"]');
await page.click('.sheet >> text=Show as list');
await page.waitForSelector('text=On the field');

const keeperRow = page.locator('.prow', { hasText: 'GK' }).first();
check('the keeper row is on the field list', await keeperRow.count(), 1);
const keeperText = await keeperRow.innerText();
console.log('keeper row text:', JSON.stringify(keeperText));
check(
  'the excluded keeper carries no "on track" / "ends N short" tag',
  /on track|ends \d/.test(keeperText),
  false,
);

const outfieldRow = page.locator('.prow:not(:has-text("GK"))').first();
const outfieldText = await outfieldRow.innerText();
console.log('outfield row text:', JSON.stringify(outfieldText));
check(
  'an outfield player still carries a fairness tag',
  /on track|ends \d/.test(outfieldText),
  true,
);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
