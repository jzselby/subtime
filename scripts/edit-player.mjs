/**
 * Correcting a player's name or number after they're on the roster.
 *
 * Before this, the only way to fix a typo was delete-and-re-add, which is
 * fine for someone who has never played but throws away nothing useful for
 * someone who has: their id, and everything the event log already says about
 * them. Editing in place instead means a corrected name shows up everywhere
 * that id is looked up — including a game recorded before the fix — with no
 * rewrite of history.
 *
 * Also checks that tapping a roster row opens the editor, but tapping the
 * Remove/Restore button on that same row does not — the row is a `div`
 * wearing `role="button"`, not a real `<button>`, specifically so it can
 * hold one without the nested-button trap, and a regression there would
 * make every remove/restore tap also pop the editor open underneath it.
 *
 *   node scripts/edit-player.mjs [--headed]
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

let confirms = [];
page.on('dialog', (d) => {
  confirms.push(d.message());
  d.accept();
});

await page.goto(URL);
await page.waitForSelector('text=Touchline');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Edit FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
await page.fill('input[inputmode="numeric"]', '9');
await page.fill('#player-name', 'Mistyped Nayme');
await page.click('.sheet .btn.primary');
await page.waitForTimeout(20);
await page.fill('input[inputmode="numeric"]', '2');
await page.fill('#player-name', 'Alice Adams');
await page.click('.sheet .btn.primary');
await page.waitForTimeout(20);
await page.click('.sheet >> text=Close');

// -- a game already records the misspelled name -----------------------------
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
await page.waitForTimeout(300);
await page.goto(URL);
await page.click('text=Edit FC');
await page.waitForSelector('text=Roster · 2');

// -- editing fixes the typo -------------------------------------------------
await page.click('.prow:has-text("Mistyped Nayme")');
await page.waitForSelector('text=Edit player');
check('the editor is pre-filled with the current name', await page.inputValue('input[placeholder="Alex Morgan"]'), 'Mistyped Nayme');
check('and the current number', await page.inputValue('input[inputmode="numeric"]'), '9');
await page.fill('input[placeholder="Alex Morgan"]', 'Corrected Name');
await page.fill('input[inputmode="numeric"]', '11');
await page.click('.sheet >> text=Save');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

check('the roster shows the corrected name', await page.locator('text=Corrected Name').count(), 1);
check('the old name is gone from the roster', await page.locator('text=Mistyped Nayme').count(), 0);
check('the roster shows the corrected number', await page.locator('.num-badge:has-text("11")').count(), 1);

// -- the correction reaches a game recorded before the fix -------------------
await page.click('text=vs Rivals');
await page.waitForSelector('.pitch');
const pitchNames = await page.locator('.token').allInnerTexts();
check('the game screen reads the corrected name too', pitchNames.some((t) => t.includes('Corrected Name')), true);
check('not the stale one', pitchNames.some((t) => t.includes('Mistyped')), false);

// -- Remove does not also open the editor ------------------------------------
// A fresh player, added after the game already exists and never part of its
// lineup — Alice, who "Fill rest" put on the pitch alongside the corrected
// player, is genuinely mid-match and would correctly refuse removal instead,
// which is a different check (see scripts/roster.mjs).
await page.goto(URL);
await page.click('text=Edit FC');
await page.waitForSelector('text=Roster · 2');
await page.click('text=+ Add player');
await page.fill('input[inputmode="numeric"]', '77');
await page.fill('#player-name', 'Untouched Player');
await page.click('.sheet .btn.primary');
await page.waitForTimeout(20);
await page.click('.sheet >> text=Close');
await page.waitForSelector('text=Roster · 3');

confirms = [];
await page.click('.prow:has-text("Untouched Player") >> text=Remove');
await page.waitForTimeout(300);
check('Remove fires its own confirm, not the editor', confirms.length, 1);
check('the editor did not open underneath it', await page.locator('text=Edit player').count(), 0);
check('the player who never played is gone, not retired', await page.locator('text=Roster · 2').count(), 1);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
