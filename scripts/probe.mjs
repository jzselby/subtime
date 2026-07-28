/* Token sizes at 11v11 on the smallest phone, a11y names, and clock overrun. */
import { chromium } from 'playwright';
const URL = 'http://localhost:4173';
const SIZE = Number(process.argv[2] ?? 11);
const W = Number(process.argv[3] ?? 375), H = Number(process.argv[4] ?? 667);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept());
await p.goto(URL);
await p.waitForSelector('text=Touchline');
await p.click('text=+ New team');
await p.fill('input[placeholder="Thunder"]', 'T');
await p.selectOption('.sheet select', String(SIZE));
await p.click('text=Create team');
await p.waitForSelector('text=Roster · 0');
await p.click('text=+ Add player');
for (let i = 0; i < SIZE + 3; i++) {
  await p.fill('input[inputmode="numeric"]', String(i + 1));
  await p.fill('#player-name', `Player ${i + 1}`);
  await p.click('.sheet .btn.primary');
  await p.waitForTimeout(15);
}
await p.click('.sheet >> text=Close');
await p.click('text=Settings');
await p.fill('.sheet input[type="number"]', '1');
await p.click('.sheet >> text=Save');
await p.waitForTimeout(200);
await p.click('text=+ New game');
await p.click('text=Create game');
await p.waitForSelector("text=Who's here?");
await p.click('.sheet >> text=Done');
await p.waitForSelector('.sheet-backdrop', { state: 'detached' });

// setup screen: are vacant labels visible?
console.log('SETUP vacant label visible:', await p.evaluate(() => {
  const e = document.querySelector('.token.vacant .tname');
  const cs = e && getComputedStyle(e);
  const pitch = document.querySelector('.pitch').getBoundingClientRect();
  return { display: cs?.display, text: e?.textContent, pitchH: Math.round(pitch.height), pitchW: Math.round(pitch.width) };
}));

await p.click('text=Fill rest');
await p.waitForTimeout(200);
await p.click('text=Start game');
await p.waitForSelector('.pitch');
await p.click('[aria-label="Start clock"]');
await p.waitForTimeout(1200);

console.log('LIVE token metrics:', await p.evaluate(() => {
  const s = document.querySelector('.token .shirt').getBoundingClientRect();
  const t = document.querySelector('.token').getBoundingClientRect();
  const nm = document.querySelector('.token .tname');
  const pitch = document.querySelector('.pitch').getBoundingClientRect();
  // nearest-neighbour distance between token centres
  const cs = [...document.querySelectorAll('.token')].map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; });
  let min = 1e9;
  for (let i = 0; i < cs.length; i++) for (let j = i+1; j < cs.length; j++)
    min = Math.min(min, Math.hypot(cs[i][0]-cs[j][0], cs[i][1]-cs[j][1]));
  return { shirt: +s.width.toFixed(1), tokenBox: [+t.width.toFixed(1), +t.height.toFixed(1)],
    nameFont: nm ? getComputedStyle(nm).fontSize : null, nameShown: nm ? getComputedStyle(nm).display : null,
    timeFont: getComputedStyle(document.querySelector('.token .ttime')).fontSize,
    pitchH: Math.round(pitch.height), minCentreGap: +min.toFixed(1) };
}));

// accessible names on the live screen
console.log('A11Y live snapshot:', JSON.stringify(await p.evaluate(() => {
  const names = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute('aria-label') || e.textContent.replace(/\s+/g, ' ').trim());
  return {
    tokens: names('.token').slice(0, 3),
    bench: names('.benchgrid .bplayer').slice(0, 3),
    clock: document.querySelector('.gclock').textContent,
    clockLive: document.querySelector('[aria-live]') ? 'has aria-live' : 'NO aria-live anywhere',
    subbarRole: document.querySelector('.subbar') ? 'present' : 'absent',
  };
}), null, 1));

// clock overrun: 1-minute halves, watch past 1:00
await p.waitForTimeout(62000);
console.log('clock at/after period length:', await p.locator('.gclock .time').innerText(),
  '| meta:', await p.locator('.gclock .meta').innerText(),
  '| clock colour:', await p.evaluate(() => getComputedStyle(document.querySelector('.gclock .time')).color));
await p.screenshot({ path: `/home/user/subtime/scripts/shots/rv/probe-overrun-${SIZE}.png` });
await b.close();
