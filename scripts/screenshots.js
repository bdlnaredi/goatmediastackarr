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
  ['up', 'upcoming'], ['idx', 'indexers'], ['hl', 'health'], ['stats', 'stats'], ['nzb', 'usenet'], ['goat', 'stack'],
];

// Pretend container status for the Stack page: VPN connected, everything wired, logins made.
function goatDemo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-shots-c-')), cfg = path.join(d, 'config'), run = path.join(d, 'run');
  fs.mkdirSync(path.join(cfg, 'goat'), { recursive: true }); fs.mkdirSync(path.join(cfg, 'vpn'), { recursive: true }); fs.mkdirSync(run);
  fs.writeFileSync(path.join(cfg, 'goat', 'secrets.json'), JSON.stringify({ jellyfinUser: 'goat-admin', jellyfinPass: 'demo-password', qbitUser: 'goat', qbitPass: 'demo-password' }));
  fs.writeFileSync(path.join(cfg, 'vpn', 'proton-NL-42.conf'), '[Interface]\n');
  fs.writeFileSync(path.join(run, 'vpn.json'), JSON.stringify({ enabled: true, state: 'up', ip: '185.107.56.12', country: 'NL', port: '51234', type: 'wireguard', apps: ['qbittorrent', 'sabnzbd', 'prowlarr'], message: 'Connected' }));
  const ok = r => ({ ok: true, result: r });
  fs.writeFileSync(path.join(cfg, 'goat', 'wired.json'), JSON.stringify({ at: Date.now(), steps: { sonarr: ok({}), radarr: ok({}), lidarr: ok({}), prowlarr: ok({}), jellyfin: ok({}), seerr: ok({}) } }));
  const mf = path.join(cfg, 'goat', 'managed.json'); fs.writeFileSync(mf, JSON.stringify({ services: [] }));
  return { GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_CONFIG_DIR: cfg, GOAT_WIRED: path.join(cfg, 'goat', 'wired.json'), GOAT_BIN: path.join(__dirname, '..', 'goat') };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ui = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'ui'),
    env: { ...process.env, ...goatDemo(), DEMO: '1', PORT: String(PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'goat-shots-')) },
    stdio: 'inherit',
  });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await sleep(200); }
    const browser = await chromium.launch();
    const shot = async (page, name, fullPage = false) => { await sleep(2500); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage }); console.log('saved', name); };

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
    // A new install opens on the Stack page with its setup checklist.
    await shot(page, 'stack-setup');
    for (const [tab, name] of PAGES) {
      const btn = page.locator(`[data-t="${tab}"]:visible`).first();
      if (!(await btn.count())) { console.log('no tab', tab); continue; }
      await btn.click(); await shot(page, name, tab === 'goat');
      // Every tab has its own address: the address bar must follow the click.
      const want = { dash: '/', disc: '/discover', lib: '/library', dl: '/downloads', rq: '/requests', up: '/upcoming', idx: '/indexers', hl: '/health', stats: '/stats', nzb: '/usenet', goat: '/stack' }[tab];
      const got = new URL(page.url()).pathname;
      if (want && got !== want) throw new Error(`after opening ${tab} the address is ${got}, expected ${want}`);
    }
    // Opening an address directly shows that page, and Back returns to the previous one.
    await page.goto(BASE + '/settings/apps'); await sleep(1500);
    if (!(await page.locator('[data-t="set"][aria-current="page"]').count())) throw new Error('/settings/apps did not open Settings');
    await shot(page, 'settings-apps');
    await page.locator('[data-t="dl"]:visible').first().click(); await sleep(800);
    await page.goBack(); await sleep(800);
    if (new URL(page.url()).pathname !== '/settings/apps') throw new Error('Back did not return to /settings/apps');
    // A show or movie opened from the library gets its own address; Back closes it; the address opens it again.
    await page.goto(BASE + '/library'); await sleep(2500);
    await page.locator('#g [data-v]').first().click(); await sleep(1500);
    const item = new URL(page.url()).pathname;
    if (!/^\/library\/(tv|movies)\/[^/]+\/[^/]+$/.test(item)) throw new Error(`opening a library item gave the address ${item}`);
    if (!(await page.locator('.ov').count())) throw new Error('the library item did not open');
    await shot(page, 'library-item');
    await page.goBack(); await sleep(800);
    if (await page.locator('.ov').count()) throw new Error('Back did not close the library item');
    if (new URL(page.url()).pathname !== '/library') throw new Error('Back from an item did not return to /library');
    await page.goto(BASE + item); await sleep(3000);
    if (!(await page.locator('.ov').count())) throw new Error(`opening ${item} directly did not show the item`);
    await ctx.close();

    // Phone.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    await signIn(phone);
    const pp = await phone.newPage(); await pp.goto(BASE); await shot(pp, 'phone-dashboard');
    await browser.close();
  } finally { ui.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
