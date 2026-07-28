/* Measures live-screen targets and contrast, plus captures the states the
   main review pass could not reach: shift alarm, vacant slot, drag, events. */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = '/home/user/subtime/scripts/shots/rv';
mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:4173';
const W = Number(process.argv[2] ?? 375);
const H = Number(process.argv[3] ?? 667);
const SIZE = Number(process.argv[4] ?? 9);
const tag = `m${W}-${SIZE}`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
p.on('dialog', (d) => d.accept());
const shot = (n) => p.screenshot({ path: `${OUT}/${tag}-${n}.png` });

await p.goto(URL);
await p.waitForSelector('text=Touchline');
await p.click('text=+ New team');
await p.fill('input[placeholder="Thunder"]', 'Riverside Rockets');
await p.selectOption('.sheet select', String(SIZE));
await p.click('text=Create team');
await p.waitForSelector('text=Roster · 0');
const NAMES = ['Ana Ruiz','Bea Okonjo','Cal Nguyen','Dee Marsh','Eli Vance','Fin Doyle','Gus Park','Hal Rivera','Ivy Chen','Jo Adeyemi','Kit Larsen','Lou Bianchi','Mac Ferrer','Nia Boateng'];
await p.click('text=+ Add player');
for (let i = 0; i < SIZE + 3; i++) {
  await p.fill('input[inputmode="numeric"]', String(i + 1));
  await p.fill('#player-name', NAMES[i]);
  await p.click('.sheet .btn.primary');
  await p.waitForTimeout(20);
}
await p.click('.sheet >> text=Close');

// Short halves so the shift alarm fires inside a minute.
await p.click('text=Settings');
await p.fill('.sheet input[type="number"]', '2');
await p.click('.sheet >> text=Save');
await p.waitForTimeout(200);

await p.click('text=+ New game');
await p.fill('input[placeholder="Rovers"]', 'Northside United');
await p.click('text=Create game');
await p.waitForSelector("text=Who's here?");
await p.click('.sheet >> text=Done');
await p.waitForSelector('.sheet-backdrop', { state: 'detached' });
await p.click('text=Fill rest');
await p.waitForTimeout(200);
await p.click('text=Start game');
await p.waitForSelector('.pitch');
await p.click('[aria-label="Start clock"]');
await p.waitForTimeout(1500);

// --- measurements ---------------------------------------------------------
const measured = await p.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) };
  };
  const out = {};
  for (const sel of [
    '[aria-label="Back"]', '[aria-label="Event log"]', '[aria-label="More"]',
    '[aria-label="Pause clock"]', '.tstop', '.gclock .time', '.gclock .meta',
    '.transport-row2 .btn', '.benchgrid .bplayer', '.benchgrid .shirt',
    '.token', '.token .shirt', '.pitch', '.gamebar', '.benchgrid', '.actions.transport',
  ]) out[sel] = box(sel);
  // gaps between the three bottom action buttons
  const acts = [...document.querySelectorAll('.transport-row2 .btn')].map((e) => e.getBoundingClientRect());
  out.actionGap = acts.length > 1 ? +(acts[1].x - (acts[0].x + acts[0].width)).toFixed(1) : null;
  const bar = document.querySelector('.gamebar');
  const kids = [...bar.children].map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: e.className, label: e.getAttribute('aria-label') || e.textContent.slice(0, 12), w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1) };
  });
  out.gamebarKids = kids;
  out.vh = window.innerHeight;
  // font sizes
  const fs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontSize : null; };
  out.fonts = {
    clock: fs('.gclock .time'), meta: fs('.gclock .meta'),
    tname: fs('.token .tname'), ttime: fs('.token .ttime'),
    benchName: fs('.benchgrid .tname'), benchTime: fs('.benchgrid .ttime'),
    action: fs('.actions.slim .btn'), shirt: fs('.token .shirt'),
  };
  // heat ring colours actually in use
  out.rings = {
    onField: [...document.querySelectorAll('.token .shirt')].map((e) => e.style.borderColor).slice(0, 4),
    bench: [...document.querySelectorAll('.benchgrid .shirt')].map((e) => e.style.borderColor),
  };
  return out;
});
console.log(JSON.stringify(measured, null, 1));

// --- states ---------------------------------------------------------------
// drag a bench player onto an occupied shirt
{
  const bench = p.locator('.benchgrid .bplayer').first();
  const tok = p.locator('.token:not(.vacant)').nth(3);
  const bb = await bench.boundingBox();
  const tb = await tok.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + 20);
  await p.mouse.down();
  await p.mouse.move(bb.x + bb.width / 2, bb.y - 40, { steps: 4 });
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 20, { steps: 10 });
  await shot('40-dragging');
  await p.mouse.up();
  await p.waitForTimeout(400);
  await shot('41-after-drag');
}

// drag someone to the bench => vacant slot
{
  const tok = p.locator('.token:not(.vacant)').nth(2);
  const tb = await tok.boundingBox();
  const bench = await p.locator('.benchgrid').boundingBox();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 20);
  await p.mouse.down();
  await p.mouse.move(tb.x + tb.width / 2, tb.y + 60, { steps: 4 });
  await p.mouse.move(bench.x + bench.width / 2, bench.y + 30, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  await shot('42-vacant-slot');
  const vac = await p.locator('.token.vacant').count();
  console.log('vacant slots after dropping to bench:', vac);
  const onfield = await p.locator('.token:not(.vacant)').count();
  console.log('on field now:', onfield, 'of', SIZE);
}

// shift alarm: 2-min halves -> shiftMs 60s
console.log('waiting for the shift alarm…');
await p.waitForSelector('.shiftpill', { timeout: 90000 }).catch(() => console.log('NO SHIFT PILL'));
await shot('43-shift-due');
const pill = await p.evaluate(() => {
  const e = document.querySelector('.shiftpill');
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { text: e.textContent, w: +r.width.toFixed(1), h: +r.height.toFixed(1), fs: getComputedStyle(e).fontSize };
});
console.log('shiftpill', JSON.stringify(pill));

// what happens when the period clock runs past its configured length
await p.waitForTimeout(40000);
await shot('44-past-full-time');
console.log('clock at overrun:', await p.locator('.gclock .time').innerText());

// events screen
await p.click('[aria-label="More"]');
await p.click('.sheet >> text=Modify events');
await p.waitForSelector('text=Modify events');
await p.waitForTimeout(300);
await shot('45-events');
await p.click('.prow:has-text("Sub") >> nth=0').catch(() => {});
await p.waitForTimeout(300);
await shot('46-event-edit');

await b.close();
