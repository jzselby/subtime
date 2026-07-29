/**
 * The four ways stats leave the app: download report, download CSV, share, email.
 *
 * The report is the one meant to be read: a styled HTML table, opened in any
 * browser, with no spreadsheet app required. The CSV stays for coaches who
 * want to build their own spreadsheet. Share and email now hand off the
 * report — not the CSV — as the attachment, since that's the readable one.
 *
 * Download is checked end to end — the file really lands and really parses.
 * Share and email hand off to the OS, which a browser test cannot follow, so
 * those are checked at the boundary: the Web Share call and the mailto URL are
 * intercepted and their payloads inspected.
 *
 *   node scripts/export.mjs [--headed]
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.error('PAGE ERROR:', e.message);
  process.exitCode = 1;
});
page.on('dialog', (d) => d.accept());

/*
 * Stub the two hand-offs before any app code runs. navigator.share is absent in
 * headless Chromium anyway, so defining it also exercises the file branch.
 */
await page.addInitScript(() => {
  window.__shared = null;
  window.__mailto = null;
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (data) => {
      window.__shared = {
        title: data.title,
        text: data.text,
        files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type })),
      };
    },
  });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
});

await page.goto(URL);
await page.waitForSelector('text=Touchline');

// -- a game with something worth exporting ---------------------------------
await page.click('text=+ New team');
await page.fill('input[placeholder="Thunder"]', 'Export FC');
await page.selectOption('.sheet select', '5');
await page.click('text=Create team');
await page.waitForSelector('text=Roster · 0');
await page.click('text=+ Add player');
// Player 6's name doubles as an HTML-injection probe for the report — a name
// is free text a coach types, and the report is HTML, not a sandboxed app
// screen, so anything that lands unescaped runs as markup the moment the
// file is opened.
const INJECT_NAME = '<b>Six</b> & "Quotes"';
for (let i = 1; i <= 6; i++) {
  await page.fill('input[inputmode="numeric"]', String(i));
  await page.fill('#player-name', i === 6 ? INJECT_NAME : `Player${i}`);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(20);
}
await page.click('.sheet >> text=Close');

await page.click('text=+ New game');
await page.fill('input[placeholder="Rovers"]', 'Rivals');
await page.click('text=Create game');
await page.waitForSelector("text=Who's here?");
await page.click('.sheet >> text=Done');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });
await page.click('text=Fill rest');
await page.waitForTimeout(200);
await page.click('text=Start game');
await page.waitForSelector('.pitch');
await page.click('[aria-label="Start clock"]');
await page.waitForTimeout(1500);

// A goal, so the summary has more than minutes in it.
await page.click('text=⚽ Us');
await page.waitForSelector('text=Who scored?');
await page.click('.sheet .chip >> nth=0');
await page.click('.sheet >> text=No assist');
await page.waitForSelector('.sheet-backdrop', { state: 'detached' });

await page.click('[aria-label="Stats and playing time"]');
await page.waitForSelector('text=Playing-time fairness');

// -- the sheet -------------------------------------------------------------
await page.click('.actions >> text=Export');
await page.waitForSelector('text=Export stats');
check('offers a report download', await page.locator('.sheet >> text=Download report').count(), 1);
check('offers a CSV download', await page.locator('.sheet >> text=Download CSV').count(), 1);
check('offers share', await page.locator('.sheet >> text=Text or share').count(), 1);
check('offers email', await page.locator('.sheet >> text=Email').count(), 1);

// -- download report ---------------------------------------------------------
const [reportDl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.sheet >> text=Download report'),
]);
const html = (await (await import('node:fs/promises')).readFile(await reportDl.path())).toString();
check('report filename is safe for a filesystem', /^[\w.-]+\.html$/.test(reportDl.suggestedFilename()), true);
check('report names the teams and the date', /Export-FC-vs-Rivals-\d{4}-\d{2}-\d{2}\.html/.test(reportDl.suggestedFilename()), true);
check('report is a real HTML document', html.trim().startsWith('<!doctype html>'), true);
check('report has a table', /<table>/.test(html), true);
check('report has one data row per present player', (html.match(/<tr>/g) ?? []).length - 1, 6);
check('report names the fixture in its title', html.includes('<title>Export FC'), true);
check('report shows the fairness figure', /Playing-time fairness: \d+%/.test(html), true);
check('a player name with markup is escaped, not live', html.includes('<b>Six</b>'), false);
check('the escaped name is still readable in the table', html.includes('&lt;b&gt;Six&lt;/b&gt; &amp; &quot;Quotes&quot;'), true);
check('sheet closes after downloading', await page.locator('text=Export stats').count(), 0);

// -- download CSV ------------------------------------------------------------
await page.click('.actions >> text=Export');
await page.waitForSelector('text=Export stats');
const [csvDl] = await Promise.all([
  page.waitForEvent('download'),
  page.click('.sheet >> text=Download CSV'),
]);
const csv = (await (await import('node:fs/promises')).readFile(await csvDl.path())).toString();
// CRLF line endings (RFC 4180); a metadata block identifies the game, then a
// blank line, then the header and one row per present player.
const lines = csv.replace(/\r\n/g, '\n').trim().split('\n');
const blank = lines.indexOf('');
const meta = lines.slice(0, blank);
const [header, ...rows] = lines.slice(blank + 1);

check('CSV filename is safe for a filesystem', /^[\w.-]+\.csv$/.test(csvDl.suggestedFilename()), true);
check('CSV names the teams and the date', /Export-FC-vs-Rivals-\d{4}-\d{2}-\d{2}\.csv/.test(csvDl.suggestedFilename()), true);
check('the file identifies the game without the filename', meta.some((l) => l.startsWith('Opponent,Rivals')), true);
check('header names the columns, unquoted', header, 'Player,Number,Minutes,Bench Minutes,Positions Played,Goals,Assists,Plus/Minus,Shots,Saves,Stints');
check('one row per present player', rows.length, 6);
// Goals is the sixth column; exactly one player should own the one goal.
const goalsColumn = rows.map((r) => r.split(',')[5]);
check('the goal lands on exactly one player', goalsColumn.filter((g) => g === '1').length, 1);

// -- share -----------------------------------------------------------------
await page.click('.actions >> text=Export');
await page.waitForSelector('text=Export stats');
await page.click('.sheet >> text=Text or share');
await page.waitForTimeout(200);
const shared = await page.evaluate(() => window.__shared);
check('share carries the report as a file', shared?.files?.[0]?.type, 'text/html');
check('the shared file is the report', shared?.files?.[0]?.name, reportDl.suggestedFilename());
check('share text is the readable summary', shared?.text?.includes('Playing time:'), true);
check('share is titled with the fixture', shared?.title?.includes('vs Rivals'), true);

// -- email -----------------------------------------------------------------
await page.click('.actions >> text=Export');
await page.waitForSelector('text=Export stats');
/*
 * mailto cannot attach a file on any platform, so Email now saves the report
 * to downloads first and puts only the readable summary in the body — the
 * raw table used to be inlined below a length threshold that a normal-sized
 * roster was always under, so every email got a wall of cells instead of a
 * draft a human would want to read.
 *
 * The mailto navigation would take the page away from the app, so it is
 * caught at the route level and the URL inspected instead of followed.
 */
await page.route('mailto:**', (r) => r.abort());
const [emailDownload, mailto] = await Promise.all([
  page.waitForEvent('download'),
  new Promise(async (resolve) => {
    page.once('request', (r) => r.url().startsWith('mailto:') && resolve(r.url()));
    page.on('framenavigated', (f) => f.url().startsWith('mailto:') && resolve(f.url()));
    await page.click('.sheet >> text=Email');
    setTimeout(() => resolve(''), 2500);
  }),
]);
const decoded = decodeURIComponent(mailto);
check('email saves the report rather than only inlining it', emailDownload.suggestedFilename(), reportDl.suggestedFilename());
check('email opens a draft', mailto.startsWith('mailto:?subject='), true);
check('subject carries the score line', /Export FC \d+–\d+ Rivals — stats/.test(decoded), true);
check('body carries the summary', decoded.includes('Playing time:'), true);
check('body does not dump the raw table', decoded.includes('<table>'), false);
check('body says the file was saved', decoded.includes('saved to your downloads'), true);

await browser.close();
const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed\n`);
if (failed) process.exitCode = 1;
