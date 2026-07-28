/**
 * Custom formations: a preset is a starting point, not a ceiling. Covers
 * adding a position, editing its code and line, the duplicate-code guard
 * (codes must stay unique — the engine and "minutes by position" both key off
 * them), removing a position, and that the result actually saves and persists.
 *
 *   node scripts/formation-editor.mjs [--headed]
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
await page.fill('input[placeholder="Thunder"]', 'Shape FC');
await page.selectOption('.sheet select', '7');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

await page.click('text=Settings');
await page.click('text=/^Formation: /');
await page.waitForSelector('text=Shape');
const before = await page.locator('.token').count();

// -- more presets than before -------------------------------------------------
// 6 named shapes for 7-a-side (was 4) plus Rename… and + Add position.
check('7-a-side offers the expanded set of named shapes', await page.locator('.chips .chip').count(), 8);

// -- add a position -----------------------------------------------------------
await page.click('text=+ Add position');
await page.waitForTimeout(150);
check('a slot was added', await page.locator('.token').count(), before + 1);
check('the subtitle counts it too', (await page.locator('header.top .sub').innerText()).includes(`${before + 1} a side`), true);

// -- editing it: code, line, and the duplicate-code guard --------------------
// The new slot is the last one added, so the last token in the list.
await page.locator('.token').last().click();
await page.waitForSelector('text=Line');
await page.fill('input[placeholder="SW"]', 'GK'); // collides with the real keeper
await page.click('.sheet >> text=Keeper');
await page.click('.sheet >> text=Save');
await page.waitForTimeout(150);
const codes = await page.locator('.token .shirt').evaluateAll(
  (els) => els.map((e) => e.nextSibling?.textContent ?? ''),
);
const gkCodes = codes.filter((c) => c.startsWith('GK'));
check('both the real keeper and the renamed slot are present', gkCodes.length, 2);
// The point of the guard: two slots literally both coded "GK" isn't just
// cosmetic — the app maps codes to slots (`slotByCode` in Live.tsx), and a
// duplicate would make one of the pair silently unreachable during a game.
check('a colliding code was auto-suffixed, not silently merged into one code', new Set(gkCodes).size, 2);
check('exactly one slot kept the plain "GK" code', codes.includes('GK'), true);

// -- removing a position -------------------------------------------------------
await page.locator('.token').last().click();
await page.waitForSelector('text=Remove this position');
await page.click('text=Remove this position');
await page.waitForTimeout(150);
check('the slot is gone', await page.locator('.token').count(), before);

// A formation of one position cannot lose its last slot.
for (let i = 0; i < before - 1; i++) {
  await page.locator('.token').first().click();
  await page.waitForSelector('text=Remove this position');
  await page.click('text=Remove this position');
  await page.waitForTimeout(80);
}
check('down to the last position', await page.locator('.token').count(), 1);
await page.locator('.token').first().click();
await page.waitForSelector('text=Line');
check(
  'the last position cannot be removed',
  await page.locator('.sheet .btn.danger').isDisabled(),
  true,
);
check(
  'the button says why',
  await page.locator("text=Can't remove the only position").count(),
  1,
);
await page.click('.sheet >> text=Close');

// -- reset discards the draft, save persists it -------------------------------
// Scoped to the footer: "text=Reset" also substring-matches "preset" in the
// explanatory paragraph above, and the paragraph comes first in DOM order.
await page.click('.actions >> text=Reset');
await page.waitForTimeout(150);
check('reset restores the original shape', await page.locator('.token').count(), before);

await page.click('text=+ Add position');
await page.waitForTimeout(100);
await page.click('text=Save formation');
await page.waitForSelector('text=Roster · 0');
await page.click('text=Settings');
await page.click('text=/^Formation: /');
await page.waitForSelector('text=Shape');
check('the custom shape survived a reload of the editor', await page.locator('.token').count(), before + 1);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
