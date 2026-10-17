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
    { key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: `http://127.0.0.1:${port}/engines/sonarr`, apiKey: 'k' },
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

    const user = await c.post('/api/users', { name: 'viewer', password: 'viewer-pass-1', role: 'user' });
    assert.equal(user.status, 200);
    const v = client(s.base); await v.post('/api/login', { name: 'viewer', password: 'viewer-pass-1' });
    assert.equal((await fetch(s.base + '/engines/sonarr/', { redirect: 'manual', headers: { Cookie: v.cookie } })).status, 302, 'only admins');
  } finally { await s.stop(); eng.close(); }
});
