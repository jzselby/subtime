/*
 * Confirms the install hint appears exactly when it should.
 *
 * iOS never volunteers that a web app can be installed, so this banner is the
 * only thing telling a coach to add it to the home screen — and run as a browser
 * tab the app loses the wake lock, the full-bleed pitch, and storage that
 * outlives a week unopened. It is worth a test that it has not gone missing,
 * and equally that it does not nag people who have already installed it.
 */
import { chromium, devices } from 'playwright';

const URL = 'http://localhost:4173/';
const IPHONE = devices['iPhone 13'];

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let bad = 0;

const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) bad++;
};

const visit = async (opts, init) => {
  const ctx = await b.newContext(opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(400);
  return { ctx, page, banner: page.locator('.install-banner') };
};

// Safari on an iPhone, not yet installed: the one case that needs the hint.
{
  const { ctx, page, banner } = await visit(IPHONE);
  check(await banner.isVisible(), 'iOS Safari sees the install hint');
  check(/Add to Home Screen/.test(await banner.textContent()), 'hint names the gesture');

  await page.locator('.install-banner .btn').click();
  check(!(await banner.isVisible()), 'dismiss hides it');
  await page.reload();
  await page.waitForTimeout(400);
  check(!(await page.locator('.install-banner').isVisible()), 'dismissal survives a reload');
  await ctx.close();
}

// Chrome on iOS is WebKit underneath but cannot add to the home screen at all,
// so pointing at the Share menu would be a dead end.
{
  const { ctx, banner } = await visit({
    ...IPHONE,
    userAgent: IPHONE.userAgent.replace('Version/', 'CriOS/118.0 Version/'),
  });
  check(/Open this in Safari/.test(await banner.textContent()), 'Chrome on iOS is sent to Safari');
  await ctx.close();
}

// Already installed: nothing left to suggest.
{
  const { ctx, banner } = await visit(IPHONE, () => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
  });
  check(!(await banner.isVisible()), 'installed app shows no hint');
  await ctx.close();
}

// Desktop is not an install target, and no update is waiting on a cold load.
{
  const { ctx, page, banner } = await visit({ viewport: { width: 1280, height: 800 } });
  check(!(await banner.isVisible()), 'desktop sees no hint');
  check(!(await page.locator('.update-chip').isVisible()), 'no update chip when none waits');
  await ctx.close();
}

await b.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nInstall hint shows and hides correctly');
process.exit(bad ? 1 : 0);
