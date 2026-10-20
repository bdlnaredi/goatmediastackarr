// GoatMediaStackarr: the UI picks up the engines that live inside the container from managed.json.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup } = require('./helpers');

test('built-in engines appear automatically, update in place and leave hand-added apps alone', async () => {
  const dir = tmp(), run = tmp(), mf = path.join(dir, 'managed.json');
  const write = services => fs.writeFileSync(mf, JSON.stringify({ version: 1, services }));
  write([
    { key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:8989/engines/sonarr', apiKey: 'k1' },
    { key: 'qbittorrent', type: 'qbittorrent', name: 'qBittorrent', url: 'http://127.0.0.1:8080', user: 'goat', pass: 'p' },
  ]);
  fs.writeFileSync(path.join(run, 'vpn.json'), JSON.stringify({ enabled: true, state: 'up', ip: '1.2.3.4' }));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run }, dir);
  try {
    const c = client(s.base); await setup(c);
    let r = await c.get('/api/services');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.map(x => x.name).sort(), ['Sonarr', 'qBittorrent']);
    assert.ok(r.data.every(x => x.managed));

    r = await c.post('/api/services', { type: 'unraid', name: 'Tower', url: 'http://10.0.0.2', apiKey: 'u' });
    assert.equal(r.status, 200);

    const st = await c.get('/api/goat/status');
    assert.equal(st.status, 200);
    assert.equal(st.data.vpn.state, 'up');
    assert.equal(st.data.engines.length, 2);
  } finally { await s.stop(); }

  // Turning qBittorrent off and adding Radarr is picked up at the next start; the hand-added app stays.
  write([
    { key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:8989/engines/sonarr', apiKey: 'k2' },
    { key: 'radarr', type: 'radarr', name: 'Radarr', url: 'http://127.0.0.1:7878/engines/radarr', apiKey: 'k3' },
  ]);
  const s2 = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run }, dir);
  try {
    const c = client(s2.base);
    assert.equal((await c.post('/api/login', { name: 'admin', password: 'correct-horse' })).status, 200);
    const names = (await c.get('/api/services')).data.map(x => x.name).sort();
    assert.deepEqual(names, ['Radarr', 'Sonarr', 'Tower']);
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(db.services.filter(x => x.managed === 'sonarr').length, 1, 'no duplicate Sonarr');
    assert.ok(!JSON.stringify(db).includes('"k2"'), 'API keys are stored encrypted');
  } finally { await s2.stop(); }
});

test('the status page is for admins only', async () => {
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [] }));
  const s = await boot({ GOAT_MANAGED: mf }, dir);
  try {
    const c = client(s.base);
    assert.equal((await c.get('/api/goat/status')).status, 401);
  } finally { await s.stop(); }
});

test('engine pages open through the sign-in, including live updates', async () => {
  const http = require('node:http'), net = require('node:net');
  const seen = [];
  const eng = http.createServer((req, res) => { seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie || '' }); res.writeHead(200, { 'X-Engine': 'yes' }); res.end('engine ' + req.url); });
  eng.on('upgrade', (req, sock) => { sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); sock.end('hello ' + req.url); });
  await new Promise(r => eng.listen(0, '127.0.0.1', r));
  const port = eng.address().port;
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [
    { key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: `http://127.0.0.1:${port}/engines/sonarr`, apiKey: '0123456789abcdef0123456789abcdef' },
    { key: 'qbittorrent', type: 'qbittorrent', name: 'qBittorrent', url: `http://127.0.0.1:${port}`, user: 'u', pass: 'p' },
    { key: 'seerr', type: 'seerr', name: 'Seerr', url: `http://127.0.0.1:${port}`, apiKey: 's' }] }));
  const s = await boot({ GOAT_MANAGED: mf }, dir);
  try {
    let r = await fetch(s.base + '/engines/sonarr/', { redirect: 'manual' });
    assert.equal(r.status, 302, 'signed-out visitors are sent to the sign-in page');
    assert.equal(seen.length, 0);

    const c = client(s.base); await setup(c);
    const get = u => fetch(s.base + u, { redirect: 'manual', headers: { Cookie: c.cookie + '; theme=dark' } });
    r = await get('/engines/sonarr/calendar?x=1');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'engine /engines/sonarr/calendar?x=1');
    assert.equal(r.headers.get('x-engine'), 'yes');
    assert.equal(r.headers.get('content-security-policy'), null, "the engine's own page is not held to the dashboard's rules");
    assert.equal(seen.at(-1).host, `127.0.0.1:${port}`);
    assert.equal(seen.at(-1).cookie, 'theme=dark', 'the dashboard sign-in cookie is not passed on');

    r = await get('/engines/qbittorrent/api/v2/app/version');
    assert.equal(await r.text(), 'engine /api/v2/app/version', 'qBittorrent has no sub-path, so it is removed');
    r = await get('/engines/qbittorrent');
    assert.equal(r.status, 301); assert.equal(r.headers.get('location'), '/engines/qbittorrent/');
    assert.equal((await get('/engines/seerr/')).status, 404);
    assert.equal((await get('/engines/nope/')).status, 404);

    const ws = cookie => new Promise(resolve => {
      const sock = net.connect(new URL(s.base).port, '127.0.0.1', () => sock.write(`GET /engines/sonarr/signalr/messages HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${cookie ? 'Cookie: ' + cookie + '\r\n' : ''}\r\n`));
      let d = ''; sock.on('data', x => d += x); sock.on('close', () => resolve(d)); sock.on('error', () => resolve(d));
    });
    assert.match(await ws(c.cookie), /101 Switching Protocols[\s\S]*hello \/engines\/sonarr\/signalr\/messages/);
    assert.match(await ws(''), /403/);
    // Phone apps (nzb360, LunaSea…) send the app's own API key instead of signing in.
    const key = '0123456789abcdef0123456789abcdef';
    r = await fetch(s.base + '/engines/sonarr/api/v3/system/status', { redirect: 'manual', headers: { 'X-Api-Key': key } });
    assert.equal(r.status, 200, 'the right API key is let through'); assert.equal(await r.text(), 'engine /engines/sonarr/api/v3/system/status');
    assert.equal((await fetch(s.base + '/engines/sonarr/api/v3/system/status?apikey=' + key, { redirect: 'manual' })).status, 200);
    assert.equal((await fetch(s.base + '/engines/sonarr/api/v3/system/status', { redirect: 'manual', headers: { 'X-Api-Key': key.replace('0', '1') } })).status, 302, 'a wrong key is not');
    assert.equal((await fetch(s.base + '/engines/qbittorrent/api/v2/app/version', { redirect: 'manual', headers: { 'X-Api-Key': key } })).status, 302, 'one app\'s key does not open another');
    assert.match(await ws('x=1\r\nX-Api-Key: ' + key), /101 Switching Protocols/);
    // Where Jellyfin, Seerr and Plex are from outside the home.
    assert.equal((await c.post('/api/goat/outside', { jellyfin: 'ftp://nope' })).status, 400);
    assert.deepEqual((await c.post('/api/goat/outside', { jellyfin: 'https://jellyfin.example.com/', seerr: '' })).data, { jellyfin: 'https://jellyfin.example.com' });
    assert.equal((await c.get('/api/goat/status')).data.outside.jellyfin, 'https://jellyfin.example.com');

    const user = await c.post('/api/users', { name: 'viewer', password: 'viewer-pass-1', role: 'user' });
    assert.equal(user.status, 200);
    const v = client(s.base); await v.post('/api/login', { name: 'viewer', password: 'viewer-pass-1' });
    assert.equal((await fetch(s.base + '/engines/sonarr/', { redirect: 'manual', headers: { Cookie: v.cookie } })).status, 302, 'only admins');
  } finally { await s.stop(); eng.close(); }
});

test('container settings, VPN file upload, control commands and the leak test', async () => {
  const net = require('node:net'), http = require('node:http');
  const dir = tmp(), cfg = path.join(dir, 'config'), run = tmp();
  fs.mkdirSync(path.join(cfg, 'goat'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'goat', 'secrets.json'), JSON.stringify({ jellyfinUser: 'goat-admin', jellyfinPass: 'jfpw', qbitUser: 'goat', qbitPass: 'qbpw' }));
  const mf = path.join(dir, 'managed.json'); fs.writeFileSync(mf, JSON.stringify({ services: [] }));
  fs.writeFileSync(path.join(run, 'vpn.json'), JSON.stringify({ enabled: true, state: 'up', ip: '203.0.113.9', country: 'NL' }));
  // Pretend control service.
  const sockPath = path.join(run, 'control.sock'), got = [];
  const ctl = net.createServer(s => s.on('data', d => { const m = JSON.parse(String(d)); got.push(m); s.end(JSON.stringify(m.cmd === 'restart' && m.engine === 'nope' ? { ok: false, error: 'Unknown app' } : { ok: true }) + '\n'); }));
  await new Promise(r => ctl.listen(sockPath, r));
  // Pretend "what is my address" service.
  const ipsrv = http.createServer((q, s) => s.end('fl=1\nip=198.51.100.7\nloc=IN\n'));
  await new Promise(r => ipsrv.listen(0, '127.0.0.1', r));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_CONFIG_DIR: cfg, GOAT_CONTROL_SOCK: sockPath,
    GOAT_BIN: path.join(__dirname, '..', '..', 'goat'), GOAT_IPCHECK_URL: `http://127.0.0.1:${ipsrv.address().port}/` }, dir);
  try {
    const c = client(s.base); await setup(c);
    let r = await c.get('/api/goat/status');
    assert.equal(r.data.logins.jellyfin.pass, 'jfpw');
    assert.equal(r.data.container, true);

    r = await c.post('/api/goat/settings', { vpn: { enabled: true, pass: 'secret' } });
    assert.equal(r.status, 200); assert.equal(r.data.settings.vpn.enabled, true); assert.equal(r.data.settings.vpn.pass, '••••');
    assert.equal((await c.post('/api/goat/settings', { vpn: { type: 'pptp' } })).status, 400);

    assert.equal((await c.post('/api/goat/vpn-file', { name: 'x.txt', content: 'hi' })).status, 400);
    assert.equal((await c.post('/api/goat/vpn-file', { name: 'p.conf', content: 'not wireguard' })).status, 400);
    r = await c.post('/api/goat/vpn-file', { name: '../../proton NL#1.conf', content: '[Interface]\nPrivateKey = x\n[Peer]\n' });
    assert.equal(r.status, 200); assert.deepEqual(r.data.vpnFiles, ['proton_NL_1.conf']);
    assert.ok(fs.existsSync(path.join(cfg, 'vpn', 'proton_NL_1.conf')), 'saved inside the vpn folder only');
    r = await c.post('/api/goat/vpn-file', { name: 'surf.ovpn', content: 'client\nremote nl.example 1194\n' });
    assert.deepEqual(r.data.vpnFiles, ['surf.ovpn'], 'the old file is replaced'); assert.equal(r.data.settings.vpn.type, 'openvpn');

    assert.equal((await c.post('/api/goat/apply-vpn', {})).status, 200);
    assert.equal((await c.post('/api/goat/restart', { engine: 'sonarr' })).status, 200);
    assert.equal((await c.post('/api/goat/restart', { engine: 'nope' })).status, 500);
    assert.equal((await c.post('/api/goat/stop', { engine: 'radarr' })).status, 200);
    assert.equal((await c.post('/api/goat/start', { engine: 'radarr' })).status, 200);
    assert.deepEqual(got.map(g => g.cmd + (g.engine ? ':' + g.engine : '')), ['apply-vpn', 'restart:sonarr', 'restart:nope', 'stop:radarr', 'start:radarr']);
    fs.writeFileSync(mf, JSON.stringify({ services: [], extras: [{ key: 'sonarr', name: 'Sonarr' }, { key: 'flaresolverr', name: 'FlareSolverr' }] }));
    fs.writeFileSync(path.join(run, 'stopped.json'), JSON.stringify(['sonarr']));
    const eng = (await c.get('/api/goat/status')).data.engines;
    assert.equal(eng.find(e => e.key === 'sonarr').stopped, true, 'a stopped app says so'); assert.equal(eng.filter(e => e.stopped).length, 1);
    fs.unlinkSync(path.join(run, 'stopped.json'));

    r = await c.post('/api/goat/leaktest', {});
    assert.equal(r.data.safe, true); assert.equal(r.data.home.ip, '198.51.100.7'); assert.equal(r.data.vpn.country, 'NL');
    fs.writeFileSync(path.join(run, 'vpn.json'), JSON.stringify({ enabled: true, state: 'up', ip: '198.51.100.7' }));
    assert.equal((await c.post('/api/goat/leaktest', {})).data.safe, false, 'same address as home is a leak');

    // Not for regular users.
    await c.post('/api/users', { name: 'viewer', password: 'viewer-pass-1', role: 'user' });
    const v = client(s.base); await v.post('/api/login', { name: 'viewer', password: 'viewer-pass-1' });
    assert.equal((await v.get('/api/goat/status')).status, 403);
    assert.equal((await v.post('/api/goat/restart', { engine: 'sonarr' })).status, 403);
    assert.equal((await v.post('/api/goat/stop', { engine: 'sonarr' })).status, 403);
  } finally { await s.stop(); ctl.close(); ipsrv.close(); }
});

test('every page address opens the app, while files, the API and status pages keep working', async () => {
  const s = await boot();
  try {
    for (const p of ['/downloads', '/settings/apps', '/library', '/stack', '/STACK']) {
      const r = await fetch(s.base + p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/, p);
      assert.match(await r.text(), /<title>GoatMediaStackarr<\/title>/, p);
    }
    assert.match((await fetch(s.base + '/cinema.js')).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(s.base + '/api/health')).status, 200);
  } finally { await s.stop(); }
});

test('usenet news servers: add, test with the saved password, change, remove', async () => {
  const http = require('node:http');
  const servers = {}, seen = [];
  const sabSrv = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams; seen.push(Object.fromEntries(q));
    if (q.get('apikey') !== 'sabkey') { res.writeHead(403); return res.end(); }
    const out = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const m = q.get('mode');
    if (m === 'get_config') return out({ config: { servers: Object.values(servers) } });
    if (m === 'set_config') { const k = q.get('keyword'); servers[k] = { ...(servers[k] || {}), name: k, displayname: q.get('displayname'), host: q.get('host'), port: q.get('port'), ssl: q.get('ssl'), username: q.get('username'), connections: q.get('connections'), enable: q.get('enable'), password: q.has('password') ? '*****' : (servers[k] || {}).password || '' }; return out({ config: {} }); }
    if (m === 'del_config') { delete servers[q.get('keyword')]; return out({ status: true }); }
    if (m === 'config' && q.get('name') === 'test_server') return out({ value: { result: q.get('host') === 'news.good.example', message: q.get('host') === 'news.good.example' ? 'Connection Successful!' : 'Server address is invalid' } });
    out({});
  });
  await new Promise(r => sabSrv.listen(0, '127.0.0.1', r));
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [{ key: 'sabnzbd', type: 'sabnzbd', name: 'SABnzbd', url: `http://127.0.0.1:${sabSrv.address().port}`, apiKey: 'sabkey' }] }));
  const s = await boot({ GOAT_MANAGED: mf }, dir);
  try {
    const c = client(s.base); await setup(c);
    const sid = (await c.get('/api/services')).data[0].id, base = `/api/sab/${sid}/servers`;
    assert.deepEqual((await c.get(base)).data, []);
    assert.equal((await c.post(base, { host: 'bad host;rm', port: 563 })).status, 400);
    assert.equal((await c.post(base, { host: 'news.good.example', port: 99999 })).status, 400);
    assert.equal((await c.post(base, { host: 'news.good.example', port: 563, ssl: true })).status, 400, 'a new server needs its password');

    let r = await c.post(base + '/test', { host: 'news.good.example', port: 563, ssl: true, username: 'me', password: 'pw' });
    assert.deepEqual(r.data, { ok: true, message: 'Connection Successful!' });
    r = await c.post(base, { host: 'news.good.example', port: 563, ssl: true, connections: 20, username: 'me', password: 'pw' });
    assert.equal(r.status, 200);
    assert.equal(r.data[0].host, 'news.good.example'); assert.equal(r.data[0].ssl, true); assert.equal(r.data[0].connections, 20); assert.equal(r.data[0].hasPassword, true);
    assert.equal(seen.at(-2).password, 'pw');

    // Testing a saved server without retyping the password sends SABnzbd's "use the stored one" marker.
    r = await c.post(base + '/test', { name: 'news.good.example', host: 'news.good.example', port: 563, ssl: true, username: 'me' });
    assert.equal(seen.at(-1).password, '*****'); assert.equal(seen.at(-1).server, 'news.good.example');
    // Changing other details keeps the saved password (no password sent at all).
    r = await c.post(base, { name: 'news.good.example', host: 'news.good.example', port: 443, ssl: true, connections: 10, username: 'me' });
    assert.equal(r.data[0].port, 443);
    assert.ok(!('password' in seen.find(x => x.mode === 'set_config' && x.port === '443')));

    r = await c.del(base + '/news.good.example');
    assert.deepEqual(r.data, []);
    // Not for regular users.
    await c.post('/api/users', { name: 'viewer', password: 'viewer-pass-1', role: 'user' });
    const v = client(s.base); await v.post('/api/login', { name: 'viewer', password: 'viewer-pass-1' });
    assert.equal((await v.get(base)).status, 403);
  } finally { await s.stop(); sabSrv.close(); }
});

test('no media server inside: your own Plex is passed on to Seerr and the apps connected again', async () => {
  const net = require('node:net');
  const dir = tmp(), cfg = path.join(dir, 'config'), run = tmp(), mf = path.join(dir, 'managed.json');
  fs.mkdirSync(path.join(cfg, 'goat'), { recursive: true });
  fs.writeFileSync(mf, JSON.stringify({ services: [{ key: 'seerr', type: 'seerr', name: 'Seerr', url: 'http://127.0.0.1:5055', apiKey: '' }] }));
  const sockPath = path.join(run, 'control.sock'), got = [];
  const ctl = net.createServer(x => x.on('data', d => { got.push(JSON.parse(String(d)).cmd); x.end('{"ok":true}\n'); }));
  await new Promise(r => ctl.listen(sockPath, r));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_CONFIG_DIR: cfg, GOAT_CONTROL_SOCK: sockPath, GOAT_SYNC_MS: '200',
    GOAT_BIN: path.join(__dirname, '..', '..', 'goat'), GOAT_VERSION: 'v0.2.3' }, dir);
  const wait = async f => { for (let i = 0; i < 50 && !f(); i++) await new Promise(r => setTimeout(r, 100)); };
  const file = () => { try { return JSON.parse(fs.readFileSync(path.join(cfg, 'goat', 'settings.json'), 'utf8')); } catch { return {}; } };
  try {
    const c = client(s.base); await setup(c);
    assert.equal((await c.get('/api/me')).data.version, '0.2.3', 'the installed release is shown, not package.json');
    assert.equal((await c.post('/api/services', { type: 'plex', name: 'My Plex', url: 'http://192.168.1.10:32400/', apiKey: 'myplextoken' })).status, 200);
    await wait(() => got.includes('rewire'));
    assert.deepEqual(file().plex, { url: 'http://192.168.1.10:32400', token: 'myplextoken' });
    assert.deepEqual(got, ['rewire']);
    assert.equal((await c.get('/api/goat/status')).data.settings.plex.token, '••••');
    await new Promise(r => setTimeout(r, 600));
    assert.deepEqual(got, ['rewire'], 'only once, not every few seconds');
  } finally { await s.stop(); ctl.close(); }
});

test('the checklist counts Prowlarr indexers and SABnzbd news servers', async () => {
  const http = require('node:http');
  const eng = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/engines/prowlarr/api/v1/indexer') && req.headers['x-api-key'] === 'pk') return res.end(JSON.stringify([{ id: 1 }, { id: 2 }]));
    if (req.url.startsWith('/api?') && req.url.includes('apikey=sk') && req.url.includes('section=servers')) return res.end(JSON.stringify({ config: { servers: [{ name: 'news' }] } }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => eng.listen(0, '127.0.0.1', r));
  const port = eng.address().port, dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [
    { key: 'prowlarr', type: 'prowlarr', name: 'Prowlarr', url: `http://127.0.0.1:${port}/engines/prowlarr`, apiKey: 'pk' },
    { key: 'sabnzbd', type: 'sabnzbd', name: 'SABnzbd', url: `http://127.0.0.1:${port}`, apiKey: 'sk' }] }));
  const s = await boot({ GOAT_MANAGED: mf }, dir);
  try {
    const c = client(s.base); await setup(c);
    assert.deepEqual((await c.get('/api/goat/status')).data.counts, { indexers: 2, newsServers: 1 });
  } finally { await s.stop(); eng.close(); }
});

test('app versions: the first start remembers them, an update says what changed', async () => {
  const dir = tmp(), run = tmp(), mf = path.join(dir, 'managed.json'), vf = path.join(dir, 'versions.json');
  fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [{ key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:1/engines/sonarr', apiKey: 'k1' }] }));
  const env = { GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_VERSIONS: vf, GOAT_VERSION_CHECK_MS: '150' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  fs.writeFileSync(vf, JSON.stringify({ built: 'x', apps: { sonarr: '4.0.15', seerr: '3.5.0', jellyfin: '10.11.2' } }));
  let s = await boot(env, dir);
  try {
    const c = client(s.base); await setup(c); await wait(600);
    const st = (await c.get('/api/goat/status')).data;
    assert.equal(st.engines.find(e => e.key === 'sonarr').version, '4.0.15');
    assert.deepEqual(st.appUpdates, [], 'nothing to compare with on the first start');
  } finally { await s.stop(); }
  // The weekly image brought a newer Sonarr and Seerr.
  fs.writeFileSync(vf, JSON.stringify({ built: 'y', apps: { sonarr: '4.0.16', seerr: '3.6.0', jellyfin: '10.11.2' } }));
  s = await boot(env, dir);
  try {
    const c = client(s.base); await c.post('/api/login', { name: 'admin', password: 'correct-horse' }); await wait(600);
    const st = (await c.get('/api/goat/status')).data;
    assert.equal(st.appUpdates.length, 1);
    assert.deepEqual(st.appUpdates[0].changes.map(x => `${x.name} ${x.from}→${x.to}`), ['Sonarr 4.0.15→4.0.16', 'Seerr 3.5.0→3.6.0']);
    const feed = (await c.get('/api/notifications')).data;
    assert.ok(JSON.stringify(feed).includes('Sonarr 4.0.15 → 4.0.16'), 'admins see it in the bell');
    assert.ok((await c.get('/api/alerts')).data.events.includes('appUpdates'), 'alert channels can be told');
  } finally { await s.stop(); }
});
