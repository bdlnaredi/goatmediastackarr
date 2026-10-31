// The site browser: a pretend tracker is browsed through GoatMediaStackarr (signing in, links, pictures, a magnet link
// and a .torrent download that go to qBittorrent), straight and through the VPN helper (goat/sitefetch.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), path = require('node:path'), { spawn } = require('node:child_process');
const { boot, client, setup, free, sleep } = require('./helpers');
const fakes = require('../lib/demo');
const sites = require('../lib/sites');

test('rewriting keeps links, pictures and forms inside the browser', () => {
  const pre = '/site/TOKEN', base = 'https://tracker.example/browse.php?c=1';
  assert.equal(sites.prox('/details.php?id=1', base, pre), '/site/TOKEN/~/https/tracker.example/details.php?id=1');
  assert.equal(sites.prox('https://img.host/a.jpg', base, pre), '/site/TOKEN/~/https/img.host/a.jpg');
  assert.equal(sites.prox('//cdn.example/x.css', base, pre), '/site/TOKEN/~/https/cdn.example/x.css');
  assert.equal(sites.prox('details.php?id=2', base, pre), 'details.php?id=2', 'relative links already work');
  assert.equal(sites.prox('#top', base, pre), '#top');
  assert.match(sites.prox('magnet:?xt=urn:btih:abc&amp;dn=X', base, pre), /^\/site\/TOKEN\/_grab\?m=magnet%3A%3Fxt%3Durn%3Abtih%3Aabc%26dn%3DX$/);
  assert.equal(sites.real('~/https/tracker.example/a/b.php', '?x=1').href, 'https://tracker.example/a/b.php?x=1');
  const h = sites.rwHtml('<html><head><meta http-equiv="Content-Security-Policy" content="x"></head><body><a href="/t?id=1&amp;y=2">t</a><img src="https://i.host/p.png" srcset="/a.png 1x, /b.png 2x" integrity="sha-x"><form action="/login.php"><div style="background:url(/bg.png)"></div></body></html>', base, pre, 'Label');
  assert.match(h, /href="\/site\/TOKEN\/~\/https\/tracker\.example\/t\?id=1&amp;y=2"/);
  assert.match(h, /src="\/site\/TOKEN\/~\/https\/i\.host\/p\.png"/);
  assert.match(h, /srcset="\/site\/TOKEN\/~\/https\/tracker\.example\/a\.png 1x, \/site\/TOKEN\/~\/https\/tracker\.example\/b\.png 2x"/);
  assert.match(h, /action="\/site\/TOKEN\/~\/https\/tracker\.example\/login\.php"/);
  assert.match(h, /url\(\/site\/TOKEN\/~\/https\/tracker\.example\/bg\.png\)/);
  assert.doesNotMatch(h, /Content-Security-Policy|integrity/); assert.match(h, /<head><script>/);
  const jar = {};
  sites.store(jar, 'www.tracker.example', ['uid=7; Domain=.tracker.example; Path=/', 'pass=x; Max-Age=3600', 'gone=1; Max-Age=0']);
  assert.equal(sites.cookieHeader(jar, 'tracker.example', '/'), 'uid=7');
  assert.equal(sites.cookieHeader(jar, 'www.tracker.example', '/'), 'uid=7; pass=x');
  assert.equal(sites.cookieHeader(jar, 'other.example', '/'), '');
});

test('browsing a tracker: sign in once, links stay inside, magnet links and .torrent files go to qBittorrent, the VPN way too', async () => {
  const seen = [];
  const tracker = http.createServer((req, res) => {
    seen.push({ url: req.url, tag: req.headers['x-goat-tag'] || '', cookie: req.headers.cookie || '', referer: req.headers.referer || '' });
    const signed = /session=abc/.test(req.headers.cookie || '');
    if (req.url === '/login.php' && req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => {
      if (b === 'user=ann&pass=pw') { res.writeHead(302, { Location: '/browse.php', 'Set-Cookie': 'session=abc; Path=/; HttpOnly' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('wrong'); }); return; }
    if (req.url === '/browse.php') {
      if (!signed) { res.writeHead(302, { Location: '/login.php' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<html><head><title>Browse</title></head><body><a href="/details.php?id=1">Movie.2024.1080p</a> <a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Movie.2024">magnet</a> <a href="/download.php?id=1">dl</a><img src="/poster.jpg"></body></html>`);
    }
    if (req.url === '/download.php?id=1') { if (!signed) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/x-bittorrent', 'Content-Disposition': 'attachment; filename="Movie.2024.1080p.torrent"' }); return res.end('d8:announce3:urle'); }
    if (req.url === '/poster.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'cf_bm=refresh; Path=/' }); return res.end('JPEGDATA'); }
    if (req.url === '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end('body{background:url(/bg.png)}\n' + '.row{padding:4px;margin:0}\n'.repeat(200)); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<form method="post" action="/login.php"><input name="user"></form>');
  });
  await new Promise(r => tracker.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${tracker.address().port}`;
  const fake = fakes.create(), fsrv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => fsrv.once('listening', r));
  const sfPort = await free();
  const helper = spawn(process.execPath, [path.join(__dirname, '..', '..', 'goat', 'sitefetch.js')], { env: { ...process.env, SITEFETCH_PORT: String(sfPort), SITEFETCH_TAG: 'vpn' }, stdio: 'ignore' });
  const s = await boot({ MONITOR_MS: '60000', SITES_ALLOW_PRIVATE: '1', SITEFETCH_URL: `http://127.0.0.1:${sfPort}` }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'qbittorrent', name: 'qBittorrent', url: `http://127.0.0.1:${fsrv.address().port}/qbittorrent`, user: 'u', pass: 'p' });
    const site = (await a.post('/api/sites', { name: 'Pretend tracker', url: T + '/browse.php', vpn: false, category: 'movies' })).data;
    assert.equal(site.vpn, false); assert.equal(site.signedIn, false);
    assert.equal((await a.post('/api/sites', { url: 'http://localhost:1/' })).status, 200, 'private addresses are only allowed in this test');
    const { url } = (await a.post(`/api/sites/${site.id}/open`, {})).data;
    assert.match(url, /^\/site\/[\w-]+\/~\/http\/127\.0\.0\.1:\d+\/browse\.php$/);
    const pre = url.split('/~/')[0];
    const go = (u, opt = {}) => fetch(s.base + u, { redirect: 'manual', ...opt });
    // Not signed in: the tracker sends us to its login page, inside the browser.
    let r = await go(url); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), pre + '/~/http/127.0.0.1:' + tracker.address().port + '/login.php');
    r = await go(r.headers.get('location')); assert.match(await r.text(), /action="\/site\/[\w-]+\/~\/http\/127\.0\.0\.1:\d+\/login\.php"/);
    assert.match(r.headers.get('content-security-policy'), /^sandbox /, 'tracker pages run in a sandbox, apart from GoatMediaStackarr');
    // Sign in: the cookie is kept on the server, not given to the browser.
    r = await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/login.php`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=ann&pass=pw' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('set-cookie'), null);
    assert.equal((await a.get('/api/sites')).data[0].signedIn, true);
    const page = await (await go(url)).text();
    assert.match(page, /href="\/site\/[\w-]+\/~\/http\/127\.0\.0\.1:\d+\/details\.php\?id=1"/);
    assert.match(page, /href="\/site\/[\w-]+\/_grab\?m=magnet/); assert.match(page, /Pretend tracker · without the VPN/);
    assert.equal(seen.at(-1).cookie, 'session=abc');
    const img = await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/poster.jpg`); assert.equal(await img.text(), 'JPEGDATA');
    // Speed: the same site keeps the same address, pictures and styles are kept for the next page, and text is compressed.
    assert.equal((await a.post(`/api/sites/${site.id}/open`, {})).data.url, url, 'opening it again gives the same address, so the phone can use its own cache');
    assert.match(img.headers.get('cache-control'), /max-age/);
    const hits = seen.length, again = await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/poster.jpg`);
    assert.equal(await again.text(), 'JPEGDATA'); assert.equal(again.headers.get('x-goat-cache'), 'hit'); assert.equal(seen.length, hits, 'the second time it did not go to the site');
    const css1 = await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/style.css`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(css1.headers.get('content-encoding'), 'gzip'); const cssText = await css1.text();
    assert.match(cssText, /url\(\/site\/[\w-]+\/~\/http\/127\.0\.0\.1:\d+\/bg\.png\)/, 'still rewritten');
    const css2 = await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/style.css`);
    assert.equal(css2.headers.get('x-goat-cache'), 'hit'); assert.equal(await css2.text(), cssText);
    // A magnet link and a .torrent file both end up in qBittorrent, in the site's category.
    const mg = page.match(/href="([^"]*_grab[^"]*)"/)[1].replace(/&amp;/g, '&');
    assert.match(await (await go(mg)).text(), /Added to qBittorrent/);
    assert.ok(fake.state.calls.some(c => /qb \/api\/v2\/torrents\/add .*magnet:\?xt=urn:btih:0123.*"category":"movies"/.test(c)), 'magnet sent to qBittorrent');
    const before = fake.state.calls.length;
    assert.match(await (await go(pre + `/~/http/127.0.0.1:${tracker.address().port}/download.php?id=1`)).text(), /Movie\.2024\.1080p\.torrent is downloading in the movies category/);
    assert.ok(fake.state.calls.slice(before).some(c => /torrents\/add/.test(c)), '.torrent file uploaded to qBittorrent');
    assert.match(seen.at(-1).referer, /browse\.php/, 'the tracker sees the page the link was on');
    // Through the VPN: the same pages, fetched by the VPN helper.
    await a.put(`/api/sites/${site.id}`, { vpn: true });
    const v = (await a.post(`/api/sites/${site.id}/open`, {})).data.url;
    assert.match(await (await go(v)).text(), /Pretend tracker · through the VPN/);
    assert.equal(seen.at(-1).tag, 'vpn', 'fetched by the VPN helper');
    const vp = v.split('/~/')[0], vimg = await go(vp + `/~/http/127.0.0.1:${tracker.address().port}/poster.jpg`);
    assert.equal(await vimg.text(), 'JPEGDATA'); assert.equal(vimg.headers.get('x-goat-cache'), null, 'changing the site starts its cache again');
    assert.equal(seen.at(-1).tag, 'vpn', 'pictures come through the VPN helper as they arrive');
    // Expired or made-up links do nothing; other profiles cannot see or open sites.
    assert.equal((await go('/site/' + 'x'.repeat(32) + '/~/http/127.0.0.1:1/')).status, 403);
    await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.get('/api/sites')).status, 403);
    assert.equal((await a.post(`/api/sites/${site.id}/signout`)).data.signedIn, false);
  } finally { await s.stop(); fsrv.close(); tracker.close(); helper.kill(); }
});

test('pages without their own phone layout get one, pages with one keep it', () => {
  const pre = '/site/t';
  const a = sites.rwHtml('<html><head><title>x</title></head><body><table></table></body></html>', 'https://t.example/', pre, 'VPN');
  assert.match(a, /name="viewport" content="width=device-width, initial-scale=1"/);
  const b = sites.rwHtml('<html><head><meta name="viewport" content="width=1200"></head><body></body></html>', 'https://t.example/', pre, 'VPN');
  assert.equal((b.match(/name="viewport"/g) || []).length, 1);
  assert.match(b, /width=1200/);
});
