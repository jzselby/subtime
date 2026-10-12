/**
 * The sideline failure modes from a full play-through: a double-tap that
 * records a goal or a sub twice, a double-tap on the scorer that slips in an
 * assist, the last toast replaying every time the game is reopened, and the
 * kid who arrives late or goes off hurt mid-game. Plus the suggested-swap
 * chips that turn a fair change into two taps.
 *
 *   node scripts/gameday.mjs [--url http://localhost:4173]
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});

await page.goto(URL);
await page.waitForSelector('text=Pitchside');

await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Gameday FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');

await page.click('text=+ Add player');
for (const name of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']) {
  await page.fill('#player-name', name);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(25);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rovers');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
// Hal isn't here at kickoff.
await page.click('.sheet >> text=Hal');
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.click('[aria-label="Start clock"]');
await page.waitForSelector('[aria-label="Pause clock"]');
await page.waitForTimeout(1200);

const score = () => page.locator('.gscore').innerText();
const banner = () => page.locator('.banner.error').count();

// 1. Double-tap "No assist": one goal, not two.
await page.click('text=⚽ Us');
await page.locator('.sheet .chip').first().click();
await page.waitForTimeout(500);
await page.locator('.sheet >> text=No assist').dblclick();
await page.waitForTimeout(400);
check('double-tap No assist records one goal', await score(), '1–0');

// 2. Double-tap the scorer: the second tap must not become an assist.
await page.waitForTimeout(600);
await page.click('text=⚽ Us');
await page.locator('.sheet .chip').first().dblclick();
await page.waitForTimeout(150);
check('assist step still open after scorer double-tap', await page.locator('text=Assist?').count(), 1);
await page.waitForTimeout(400);
await page.locator('.sheet >> text=No assist').click();
await page.waitForTimeout(400);
check('second goal recorded', await score(), '2–0');
await page.click('[aria-label="Event log"]');
check(
  'no assist slipped in',
  await page.locator('.sheet .log >> text=assist').count(),
  0,
);
await page.click('.sheet-backdrop', { position: { x: 5, y: 5 } });
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

// 3. Double-tap Them: one goal.
await page.waitForTimeout(600);
await page.locator('text=⚽ Them').dblclick();
await page.waitForTimeout(400);
check('double-tap Them records one goal', await score(), '2–1');

// 4. Suggested swap: one tap selects the pair, the sub bar names it, a
// double-tap on confirm subs once.
await page.waitForTimeout(600);
const pair = page.locator('.nextpair').first();
check('a suggested swap is offered', await page.locator('.nextpair').count() > 0, true);
const pairText = await pair.innerText();
const [onName, offName] = pairText.split(' for ');
await pair.click();
const subBtn = page.locator('.subbar .btn.grow');
check('sub bar names the suggested swap', await subBtn.innerText(), `${onName} on for ${offName}`);
await subBtn.dblclick();
await page.waitForTimeout(600);
check('double-tap sub confirm leaves no error', await banner(), 0);
check('clock still running after double-tap', await page.locator('[aria-label="Pause clock"]').count(), 1);
check(
  'the subbed-on player is on the pitch',
  await page.locator(`.pitch .token .tname:text-is("${onName}")`).count(),
  1,
);

// 5. Leave and come back: the last event's toast must not replay.
await page.click('[aria-label="Back"]');
await page.waitForSelector('text=LIVE');
await page.click('text=LIVE');
await page.waitForSelector('.gclock');
await page.waitForTimeout(500);
check('no toast replays on reopening', await page.locator('.toast').count(), 0);

// 6. Late arrival: Hal joins the bench.
await page.click('[aria-label="More"]');
await page.click("text=Who's here");
await page.waitForSelector('text=Not here yet');
await page.locator('.herow', { hasText: 'Hal' }).locator('text=Arrived').click();
await page.waitForTimeout(300);
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
check('late arrival is on the bench', await page.locator('.benchgrid .tname:text-is("Hal")').count(), 1);

// 7. Injury on the field: off the pitch, off the bench, and never suggested.
await page.waitForTimeout(600);
const hurtName = (await page.locator('.pitch .token:not(.vacant) .tname').first().innerText()).trim();
await page.click('[aria-label="More"]');
await page.click("text=Who's here");
await page.locator('.herow', { hasText: hurtName }).locator('text=Hurt / left').click();
await page.waitForTimeout(300);
check('injured player listed as out', await page.locator('.sheet >> text=Out hurt').count(), 1);
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
check('injured player off the pitch', await page.locator(`.pitch .tname:text-is("${hurtName}")`).count(), 0);
check('injured player not on the bench', await page.locator(`.benchgrid .tname:text-is("${hurtName}")`).count(), 0);
check('injured player not suggested', await page.locator(`.nextpair:has-text("${hurtName} for")`).count(), 0);
check('a gap is left to fill', await page.locator('.pitch .token.vacant').count(), 1);
check('no error banner after the injury', await banner(), 0);

console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
if (checks.some((c) => !c)) process.exitCode = 1;
await browser.close();
