/* Confirms the game screen fits the viewport on real phone sizes. */
import { chromium } from 'playwright';

const DEVICES = [
  ['iPhone SE',      375, 667],
  ['iPhone 13/14',   390, 844],
  ['iPhone Pro Max', 430, 932],
];

// Squad sizes to check. 11v11 on the smallest phone is the worst case for
// vertical room, so it has to be in here.
const SIZES = [7, 9, 11];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const [label, w, h] of DEVICES) {
 for (const size of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await p.goto('http://localhost:4173');
  await p.waitForSelector('text=Sub Time');
  await p.click('text=+ New team');
  await p.fill('input[placeholder="Thunder"]', 'Fit');
  await p.selectOption('.sheet select', String(size));
  await p.click('text=Create team');
  await p.waitForSelector('text=Roster · 0');
  await p.click('text=+ Add player');
  for (let i = 0; i < size + 3; i++) {
    await p.fill('input[inputmode="numeric"]', String(i + 1));
    await p.fill('#player-name', `P${i + 1}`);
    await p.click('.sheet .btn.primary');
    await p.waitForTimeout(15);
  }
  await p.click('.sheet >> text=Close');
  await p.click('text=+ New game'); await p.click('text=Create game');
  await p.waitForSelector('.pitch');
  await p.click('text=Fill rest');
  await p.waitForTimeout(200);
  await p.click('text=Start game');
  await p.waitForSelector('.pitch');
  await p.click('text=Start 1st half');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `/home/user/subtime/scripts/shots/fit-${w}-${size}v${size}.png` });

  /*
   * Three things must hold: the page does not scroll, the whole pitch is on
   * screen, and no two player tokens overlap. The last one is the reason this
   * script exists — a squashed pitch still "fits" while being unusable, and
   * that is exactly the bug a screenshot caught by eye and a size check missed.
   */
  const m = await p.evaluate(() => {
    const pitch = document.querySelector('.pitch')?.getBoundingClientRect();
    const tokens = [...document.querySelectorAll('.token')].map((t) => {
      const r = t.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    let overlaps = 0;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const a = tokens[i], c = tokens[j];
        if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) overlaps++;
      }
    }
    return {
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      pitchTop: pitch?.top ?? 0,
      pitchBottom: pitch?.bottom ?? 0,
      tokenTop: Math.min(...tokens.map((t) => t.top)),
      tokenBottom: Math.max(...tokens.map((t) => t.bottom)),
      overlaps,
    };
  });

  const noScroll = m.scrollH <= m.innerH + 1;
  const pitchOnScreen = m.pitchTop >= 0 && m.pitchBottom <= m.innerH + 1;
  // Labels hang below the shirt, so tokens must stay inside the pitch too.
  const inside = m.tokenTop >= m.pitchTop - 1 && m.tokenBottom <= m.pitchBottom + 1;
  const ok = noScroll && pitchOnScreen && inside && m.overlaps === 0;

  const why = [
    noScroll ? '' : `page scrolls (${m.scrollH}>${m.innerH})`,
    pitchOnScreen ? '' : 'pitch off screen',
    inside ? '' : `tokens outside pitch by ${Math.round(m.tokenBottom - m.pitchBottom)}px`,
    m.overlaps ? `${m.overlaps} token overlap(s)` : '',
  ].filter(Boolean).join(', ');

  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label} ${size}v${size}${ok ? '' : ' — ' + why}`);
  if (!ok) bad++;
  await ctx.close();
 }
}

await b.close();
console.log(
  bad
    ? `\n${bad} of ${DEVICES.length * SIZES.length} layouts have problems\n`
    : `\nAll ${DEVICES.length * SIZES.length} layouts fit: no page scroll, no overlapping players\n`,
);
if (bad) process.exitCode = 1;
