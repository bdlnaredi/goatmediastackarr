// Takes the README screenshots: starts the interface in demo mode (pretend apps, nothing real is touched)
// and photographs the main pages with a headless Chromium.
//   npm install --no-save playwright && npx playwright install chromium && node scripts/screenshots.js
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

const PORT = 2806, BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGES = [
  ['dash', 'dashboard'], ['disc', 'discover'], ['lib', 'library'], ['dl', 'downloads'], ['rq', 'requests'],
  ['up', 'upcoming'], ['idx', 'indexers'], ['hl', 'health'], ['stats', 'stats'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ui = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'ui'),
    env: { ...process.env, DEMO: '1', PORT: String(PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'goat-shots-')) },
    stdio: 'inherit',
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(200); }
    const browser = await chromium.launch();
    const shot = async (page, name) => { await sleep(2500); await page.screenshot({ path: path.join(OUT, name + '.png') }); console.log('saved', name); };

    // Sign-in page, before signing in.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const lp = await anon.newPage(); await lp.goto(BASE); await shot(lp, 'login'); await anon.close();

    const signIn = async ctx => {
      const r = await ctx.request.post(BASE + '/api/login', { data: { name: 'demo', password: 'demo-mediahub' } });
      if (!r.ok()) throw new Error('demo sign-in failed: ' + r.status());
    };

    // Desktop pages.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    await signIn(ctx);
    const page = await ctx.newPage(); await page.goto(BASE); await sleep(1500);
    for (const [tab, name] of PAGES) {
      const btn = page.locator(`[data-t="${tab}"]:visible`).first();
      if (!(await btn.count())) { console.log('no tab', tab); continue; }
      await btn.click(); await shot(page, name);
    }
    await ctx.close();

    // Phone.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    await signIn(phone);
    const pp = await phone.newPage(); await pp.goto(BASE); await shot(pp, 'phone-dashboard');
    await browser.close();
  } finally { ui.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
