/**
 * Changing formation mid-game: everyone lands on the nearest position in the
 * new shape (the keeper stays in goal), nobody drops off the pitch, and Undo
 * takes the whole change back as one.
 *
 *   node scripts/formation-change.mjs [--url http://localhost:4173]
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
  executablePath: '/opt/pw-browsers/chromium',
  headless: !args.includes('--headed'),
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

await page.goto(URL);
await page.waitForSelector('text=Pitchside');
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Shape FC');
await page.selectOption('.sheet select', '7');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
for (const name of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy']) {
  await page.fill('#player-name', name);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(25);
}
await page.click('.sheet >> text=Close');
await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rovers');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.click('[aria-label="Start clock"]');
await page.waitForSelector('[aria-label="Pause clock"]');
await page.waitForTimeout(1200);

/** "Ava, GK" for every occupied shirt, sorted. */
const lineup = async () =>
  (await page.locator('.pitchwrap .token:not(.vacant)').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')),
  )).sort();
const before = await lineup();
const keeper = before.find((l) => l.endsWith(', GK'))?.split(',')[0];
const shapeBefore = (await page.locator('.fname').innerText()).trim();

await page.click('[aria-label="More"]');
await page.click('text=/^Change formation/');
await page.waitForSelector('text=Pick a shape');
const target = page.locator('.sheet .chip:not([disabled])').first();
const targetName = (await target.innerText()).trim();
await target.click();
check(
  'preview shows the whole team in the new shape',
  await page.locator('.formpreview .token:not(.vacant)').count(),
  7,
);
await page.click(`.sheet >> text=Use ${targetName}`);
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.waitForTimeout(300);

const after = await lineup();
check('formation label updated', (await page.locator('.fname').innerText()).trim(), targetName);
check('still 7 on the pitch', after.length, 7);
check('same seven players', after.map((l) => l.split(',')[0]).sort().join(), before.map((l) => l.split(',')[0]).sort().join());
check('keeper stays in goal', after.find((l) => l.endsWith(', GK'))?.split(',')[0], keeper);
check('no error banner', await page.locator('.banner.error').count(), 0);
check('toast names the formation', await page.locator(`.toast:has-text("Formation: ${targetName}")`).count(), 1);
check('clock still running', await page.locator('[aria-label="Pause clock"]').count(), 1);
check('undo offers the formation as one', await page.locator('text=↩ Undo formation').count(), 1);

await page.waitForTimeout(600);
await page.click('text=↩ Undo formation');
await page.waitForTimeout(400);
check('undo restores the old shape', (await page.locator('.fname').innerText()).trim(), shapeBefore);
check('undo puts everyone back', (await lineup()).join('|'), before.join('|'));
check('no error banner after undo', await page.locator('.banner.error').count(), 0);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
if (checks.some((c) => !c)) process.exitCode = 1;
await browser.close();
