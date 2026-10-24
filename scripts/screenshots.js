// Takes the README screenshots: starts the interface in demo mode (pretend apps, nothing real is touched)
// and photographs the main pages with a headless Chromium.
//   npm install --no-save playwright && npx playwright install chromium && node scripts/screenshots.js
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

const PORT = 2806, BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));


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
    const shot = async (page, name, fullPage = false) => { await sleep(2200); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage }); console.log('saved', name); };
    const signIn = async ctx => {
      const r = await ctx.request.post(BASE + '/api/login', { data: { name: 'demo', password: 'demo-mediahub' } });
      if (!r.ok()) throw new Error('demo sign-in failed: ' + r.status());
    };
    // A browser with a chosen style (Appearance → Style) and theme.
    const open = async (style, o = {}) => {
      const ctx = await browser.newContext({ viewport: o.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: o.phone ? 2 : 1,
        isMobile: !!o.phone, hasTouch: !!o.phone, colorScheme: o.light ? 'light' : 'dark' });
      await ctx.addInitScript(([st, th]) => { try { localStorage.setItem('mh-ui', JSON.stringify({ style: st, theme: th, seenVer: 'demo' })); } catch {} }, [style, o.light ? 'light' : 'dark']);
      await signIn(ctx);
      const page = await ctx.newPage(); page.on('pageerror', e => { throw e; });
      return { ctx, page };
    };
    const go = async (page, url) => { await page.goto(BASE + url); await sleep(1800); };

    // Sign-in page, before signing in.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const lp = await anon.newPage(); await lp.goto(BASE); await shot(lp, 'login'); await anon.close();

    // A new install opens on the Stack page with its setup checklist. After "I'm done" it opens on the dashboard.
    { const { ctx, page } = await open('cinema'); await go(page, '/'); await shot(page, 'stack-setup'); await ctx.close(); }

    // The dashboard in each of the four styles, on a computer and on a phone.
    for (const st of ['cinema', 'dash', 'glass', 'compact']) {
      let { ctx, page } = await open(st); await go(page, '/dashboard'); await shot(page, 'style-' + st); await ctx.close();
      ({ ctx, page } = await open(st, { phone: true })); await go(page, '/dashboard'); await shot(page, 'phone-' + st); await ctx.close();
    }
    const light = await open('dash', { light: true }); await go(light.page, '/downloads'); await shot(light.page, 'style-dash-light'); await light.ctx.close();

    // Every main page, in the Cinema style. Every page has its own address.
    const { ctx, page } = await open('cinema');
    const PAGES = [['/discover', 'discover'], ['/library', 'library'], ['/downloads', 'downloads'], ['/requests', 'requests'], ['/upcoming', 'upcoming'],
      ['/indexers', 'indexers'], ['/health', 'health'], ['/stats', 'stats'], ['/usenet', 'usenet'], ['/stack', 'stack'], ['/settings/apps', 'settings-apps']];
    for (const [url, name] of PAGES) {
      await go(page, url);
      if (new URL(page.url()).pathname !== url) throw new Error(`${url} moved to ${new URL(page.url()).pathname}`);
      await shot(page, name, name === 'stack');
    }
    // The menu as a bar across the top, with a group open.
    await go(page, '/dashboard'); await page.hover('.ng:nth-child(3) .ngh'); await sleep(400); await page.screenshot({ path: path.join(OUT, 'menu-cinema.png') }); console.log('saved menu-cinema');
    // A movie opened from the library: its own address, cast and More like this; Back closes it.
    await go(page, '/library'); await page.locator('#g [data-v]').first().click(); await sleep(1500);
    const item = new URL(page.url()).pathname;
    if (!/^\/library\/(tv|movies)\/[^/]+\/[^/]+$/.test(item)) throw new Error(`opening a library item gave the address ${item}`);
    await shot(page, 'library-item');
    await page.goBack(); await sleep(800);
    if (await page.locator('.ov').count()) throw new Error('Back did not close the library item');
    // A title page and an actor's filmography.
    await page.evaluate(() => titlePage('movie', 5001, {})); await shot(page, 'title');
    await page.locator('.ov .cst').first().click(); await shot(page, 'person');
    await page.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.close && o.close()));
    // What's new and the style picker.
    await page.evaluate(() => whatsNew()); await shot(page, 'whats-new');
    await page.evaluate(() => document.querySelectorAll('.ov').forEach(o => o.close && o.close()));
    await page.evaluate(() => appearance()); await shot(page, 'appearance');
    await ctx.close();

    // Phone: the menu sheet.
    const ph = await open('cinema', { phone: true }); await go(ph.page, '/dashboard'); await ph.page.click('#dm'); await shot(ph.page, 'phone-menu'); await ph.ctx.close();
    await browser.close();
  } finally { ui.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
