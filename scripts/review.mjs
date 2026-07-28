/* Design-review capture. Walks every journey at three phone sizes. */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = '/home/user/subtime/scripts/shots/rv';
mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:4173';

const DEVICES = [
  ['se', 375, 667],
  ['i14', 390, 844],
  ['max', 430, 932],
];
const size = Number(process.argv[2] ?? 9);
const only = process.argv[3];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const [tag, w, h] of DEVICES) {
  if (only && only !== tag) continue;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  const shot = (n) => p.screenshot({ path: `${OUT}/${tag}-${size}-${n}.png` });

  await p.goto(URL);
  await p.waitForSelector('text=Sub Time');
  await shot('00-home-empty');

  await p.click('text=+ New team');
  await shot('01-newteam-sheet');
  await p.fill('input[placeholder="Thunder"]', 'Riverside Rockets');
  await p.fill('input[placeholder="U11"]', 'U11');
  await p.selectOption('.sheet select', String(size));
  await p.click('text=Create team');
  await p.waitForSelector('text=Roster · 0');
  await shot('02-team-empty');

  await p.click('text=+ Add player');
  await shot('03-addplayer');
  const NAMES = ['Ana Ruiz','Bea Okonjo','Cal Nguyen','Dee Marsh','Eli Vance','Fin Doyle','Gus Park','Hal Rivera','Ivy Chen','Jo Adeyemi','Kit Larsen','Lou Bianchi','Mac Ferrer','Nia Boateng'];
  for (let i = 0; i < size + 3; i++) {
    await p.fill('input[inputmode="numeric"]', String(i + 1));
    await p.fill('#player-name', NAMES[i]);
    await p.click('.sheet .btn.primary');
    await p.waitForTimeout(20);
  }
  await p.click('.sheet >> text=Close');
  await shot('04-roster-full');

  await p.click('text=Settings');
  await shot('05-team-settings');
  await p.click('text=/^Formation: /');
  await p.waitForSelector('text=Shape');
  await shot('06-formation');
  {
    const t = p.locator('.token').first();
    const pb = await p.locator('.pitch').boundingBox();
    await t.hover();
    await p.mouse.down();
    const tb = await t.boundingBox();
    await p.mouse.move(tb.x + tb.width / 2 - 34, tb.y + tb.height / 2 + 6, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(200);
  }
  await shot('06b-formation-dragged');
  await p.click('text=Save formation');
  await p.waitForSelector('text=Roster ·');

  await p.click('text=+ New game');
  await p.fill('input[placeholder="Rovers"]', 'Northside United');
  await p.click('text=Create game');
  await p.waitForSelector("text=Who's here?");
  await shot('07-attendance');
  await p.click(`.sheet .prow:has-text("${NAMES[size + 2]}")`);
  await p.click('.sheet >> text=Done');
  await p.waitForSelector('.sheet-backdrop', { state: 'detached' });
  await shot('08-setup-empty');

  await p.click('.token >> nth=0');
  await shot('09-setup-pick');
  await p.click('.sheet .chip:not([disabled]) >> nth=0');
  await p.waitForTimeout(80);
  await shot('10-setup-one');
  await p.click('text=Fill rest');
  await p.waitForTimeout(200);
  await shot('11-setup-filled');

  await p.click('text=Setup');
  await shot('12-game-settings');
  await p.click('.sheet >> text=Save');
  await p.waitForTimeout(200);

  await p.click('text=Start game');
  await p.waitForSelector('.pitch');
  await shot('13-live-pregame');
  await p.click('[aria-label="Start clock"]');
  await p.waitForTimeout(2600);
  await shot('14-live-running');

  // tap-twice sub
  await p.click('.token:not(.vacant) >> nth=0');
  await shot('15-sub-onepicked');
  await p.click('.benchgrid .bplayer >> nth=0');
  await shot('16-sub-pending');
  await p.click('text=/^Sub 1 ↔ 1$/');
  await p.waitForTimeout(500);
  await shot('17-after-sub');

  // goal
  await p.click('text=⚽ Us');
  await shot('18-goal-scorer');
  await p.click('.sheet .chip >> nth=0');
  await shot('19-goal-assist');
  await p.click('.sheet .chip >> nth=0');
  await p.waitForTimeout(300);
  await p.click('text=⚽ Them');
  await p.waitForTimeout(300);
  await shot('20-after-goals');

  // pause
  await p.click('[aria-label="Pause clock"]');
  await p.waitForTimeout(300);
  await shot('21-paused');
  await p.click('[aria-label="Start clock"]');
  await p.waitForTimeout(600);

  // log + menu
  await p.click('[aria-label="Event log"]');
  await shot('22-log');
  await p.click('.sheet >> text=Close');
  await p.click('[aria-label="More"]');
  await shot('23-menu');
  await p.click('.sheet >> text=Show as list');
  await p.waitForTimeout(200);
  await shot('24-list-view');
  await p.click('[aria-label="More"]');
  await p.click('.sheet >> text=Show the field');
  await p.waitForTimeout(200);

  // vacant slot: drag someone to bench then look at vacant
  await p.click('text=↩ Undo');
  await p.waitForTimeout(300);
  await shot('25-after-undo');

  // end half
  p.on('dialog', (d) => d.accept());
  await p.click('[aria-label="More"]');
  await p.click('.sheet >> text=End 1H', { delay: 800 });
  await p.waitForTimeout(400);
  await shot('26-halftime');
  await p.click('[aria-label="Start clock"]');
  await p.waitForTimeout(1500);
  await p.click('.token:not(.vacant) >> nth=2');
  await p.click('.benchgrid .bplayer >> nth=0');
  await p.click('text=/^Sub 1 ↔ 1$/');
  await p.waitForTimeout(1400);
  await p.click('[aria-label="More"]');
  await p.click('.sheet >> text=End 2H', { delay: 800 });
  await p.waitForTimeout(500);
  await shot('27-fulltime');

  await p.click('[aria-label="More"]');
  await p.click('.sheet >> text=Stats and playing time');
  await p.waitForSelector('text=Playing-time fairness');
  await p.waitForTimeout(400);
  await shot('28-summary-top');
  await p.evaluate(() => document.querySelector('main').scrollTo(0, 600));
  await p.waitForTimeout(200);
  await shot('29-summary-mid');
  await p.evaluate(() => document.querySelector('main').scrollTo(0, 1400));
  await p.waitForTimeout(200);
  await shot('30-summary-low');
  await p.evaluate(() => document.querySelector('main').scrollTo(0, 9999));
  await p.waitForTimeout(200);
  await shot('31-summary-bottom');

  await p.click('.actions >> text=Export CSV');
  await p.waitForTimeout(300);
  await shot('32-export');
  await p.click('.sheet >> text=Close');

  await p.evaluate(() => document.querySelector('main').scrollTo(0, 0));
  await p.click('[aria-label="Back"]').catch(() => {});
  await p.waitForTimeout(300);

  await ctx.close();
  console.log('done', tag);
}
await b.close();
