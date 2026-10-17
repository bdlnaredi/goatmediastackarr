// End-to-end checks for the parts that keep MediaHub safe. Needs only Node 20+.
// Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), path = require('node:path');

const { tmp, sleep, boot, client, setup } = require('./helpers');

test('health check and security headers', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/health');
    assert.equal(r.status, 200);
    const d = await r.json(); assert.equal(d.ok, true); assert.match(d.version, /\d/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    const home = await fetch(s.base + '/');
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  } finally { await s.stop(); }
});

test('the setup code is required when SETUP_TOKEN is set, and passwords need 8+ characters', async () => {
  const s = await boot({ SETUP_TOKEN: 'let-me-in-123' });
  try {
    const c = client(s.base);
    assert.equal((await c.get('/api/me')).data.setupCode, true);
    assert.equal((await c.post('/api/setup', { name: 'admin', password: 'correct-horse' })).status, 403);
    assert.equal((await c.post('/api/setup', { name: 'admin', password: 'correct-horse', token: 'wrong' })).status, 403);
    assert.equal((await c.post('/api/setup', { name: 'admin', password: 'short', token: 'let-me-in-123' })).status, 400);
    assert.equal((await c.post('/api/setup', { name: 'admin', password: 'correct-horse', token: 'let-me-in-123' })).status, 200);
    assert.equal((await c.get('/api/me')).data.user.role, 'admin');
    assert.equal((await client(s.base).post('/api/setup', { name: 'x', password: 'correct-horse', token: 'let-me-in-123' })).status, 403, 'setup only works once');
  } finally { await s.stop(); }
});

test('requests from other websites are blocked', async () => {
  const s = await boot();
  try {
    const c = client(s.base); await setup(c);
    const evil = await c.post('/api/login', { name: 'admin', password: 'correct-horse' }, { Origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const own = await c.post('/api/login', { name: 'admin', password: 'correct-horse' }, { Origin: s.base });
    assert.equal(own.status, 200);
  } finally { await s.stop(); }
});

test('sign-in is rate limited, and forged proxy headers do not help unless TRUST_PROXY is on', async () => {
  const s = await boot();
  try {
    const c = client(s.base); await setup(c);
    let last;
    for (let i = 0; i < 9; i++) last = await client(s.base).post('/api/login', { name: 'admin', password: 'wrong-' + i }, { 'X-Forwarded-For': '10.0.0.' + i });
    assert.equal(last.status, 429, 'a different forged address each time must not reset the limit');
  } finally { await s.stop(); }
  const t = await boot({ TRUST_PROXY: 'true' });
  try {
    const c = client(t.base); await setup(c);
    let last;
    for (let i = 0; i < 9; i++) last = await client(t.base).post('/api/login', { name: 'admin', password: 'wrong-' + i }, { 'X-Forwarded-For': '203.0.113.' + i });
    assert.equal(last.status, 401, 'behind a trusted proxy each real client address is counted separately');
    for (let i = 0; i < 9; i++) last = await client(t.base).post('/api/login', { name: 'admin', password: 'wrong' }, { 'X-Forwarded-For': '198.51.100.7' });
    assert.equal(last.status, 429);
  } finally { await t.stop(); }
});

test('app keys are encrypted on disk and still work after a restart; sessions survive restarts', async () => {
  const dir = tmp();
  let s = await boot({}, dir);
  const c = client(s.base);
  try {
    await setup(c);
    assert.equal((await c.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:9', apiKey: 'SUPER-SECRET-KEY-123' })).status, 200);
    const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
    assert.ok(!raw.includes('SUPER-SECRET-KEY-123'), 'the key must not be readable in db.json');
    assert.match(raw, /"apiKey": "enc:/);
    assert.ok(fs.existsSync(path.join(dir, 'secret.key')));
    assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')), 'saves are atomic: no temp file left behind');
  } finally { await s.stop(); }
  s = await boot({}, dir); c.base = s.base;
  try {
    const me = await c.get('/api/me');
    assert.equal(me.data.user && me.data.user.name, 'admin', 'the same cookie still works after a restart');
    assert.equal((await c.get('/api/services')).data.length, 1);
  } finally { await s.stop(); }
});

test('profile permissions are enforced by the server, not just hidden in the page', async () => {
  const s = await boot();
  try {
    const admin = client(s.base); await setup(admin);
    const svc = (await admin.post('/api/services', { type: 'qbittorrent', name: 'qB', url: 'http://127.0.0.1:9', user: 'u', pass: 'p' })).data;
    const kid = (await admin.post('/api/users', { name: 'kid', password: 'kid-password-1' })).data;
    await admin.put(`/api/users/${kid.id}/access`, { access: [svc.id] });
    await admin.put(`/api/users/${kid.id}`, { perms: { add: false, control: false, remove: false, request: false } });
    const k = client(s.base); assert.equal((await k.post('/api/login', { name: 'kid', password: 'kid-password-1' })).status, 200);
    const add = await k.post('/api/torrent/add', { sid: svc.id, url: 'magnet:?xt=urn:btih:abc' });
    assert.equal(add.status, 403); assert.match(add.data.error, /cannot add downloads/);
    assert.equal((await k.post(`/api/qb/${svc.id}/act`, { action: 'pause', hashes: ['a'.repeat(40)] })).status, 403);
    assert.equal((await k.post(`/api/qb/${svc.id}/act`, { action: 'delete', hashes: ['a'.repeat(40)] })).status, 403);
    assert.equal((await k.get('/api/users')).status, 403, 'regular profiles cannot list users');
    assert.equal((await k.post('/api/services', { type: 'sonarr', name: 'x', url: 'http://127.0.0.1:9' })).status, 403);
  } finally { await s.stop(); }
});

test('backup and restore round trip', async () => {
  const s = await boot();
  try {
    const c = client(s.base); await setup(c);
    await c.post('/api/services', { type: 'radarr', name: 'Radarr', url: 'http://127.0.0.1:9', apiKey: 'k' });
    assert.equal((await c.post('/api/backup', { passphrase: 'short' })).status, 400);
    const bk = (await c.post('/api/backup', { passphrase: 'a long passphrase' })).data;
    assert.ok(bk.data && bk.salt && bk.iv && bk.tag);
    assert.ok(!JSON.stringify(bk).includes('correct-horse'));
    const id = (await c.get('/api/services')).data[0].id;
    await c.del('/api/services/' + id);
    assert.equal((await c.get('/api/services')).data.length, 0);
    assert.equal((await c.post('/api/restore', { passphrase: 'not the passphrase', backup: bk })).status, 400);
    assert.equal((await c.post('/api/restore', { passphrase: 'a long passphrase', backup: bk })).status, 200);
    assert.equal((await c.get('/api/me')).data.user, null, 'everyone is signed out after a restore');
    assert.equal((await c.post('/api/login', { name: 'admin', password: 'correct-horse' })).status, 200);
    assert.equal((await c.get('/api/services')).data.length, 1);
  } finally { await s.stop(); }
});

test('a damaged database is never silently replaced; the automatic copy is used if there is one', async () => {
  const dir = tmp();
  let s = await boot({}, dir);
  try { await setup(client(s.base)); } finally { await s.stop(); }
  fs.copyFileSync(path.join(dir, 'db.json'), path.join(dir, 'db.json.bak'));
  fs.writeFileSync(path.join(dir, 'db.json'), '{ this is not json');
  s = await boot({}, dir);
  try {
    assert.match(s.log(), /db\.json\.bak/);
    assert.equal((await client(s.base).post('/api/login', { name: 'admin', password: 'correct-horse' })).status, 200, 'accounts came back from the copy');
  } finally { await s.stop(); }
  const dir2 = tmp(); fs.writeFileSync(path.join(dir2, 'db.json'), 'garbage');
  const bad = await boot({}, dir2);
  await sleep(300);
  assert.equal(bad.child.exitCode, 1, 'with no usable copy the server refuses to start');
  assert.match(bad.log(), /Refusing to start/);
  assert.equal(fs.readFileSync(path.join(dir2, 'db.json'), 'utf8'), 'garbage', 'the damaged file was left untouched');
});

test('files outside the public folder cannot be read', async () => {
  const s = await boot();
  try {
    for (const u of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/public/../server.js']) {
      const r = await fetch(s.base + u); const t = await r.text();
      assert.ok(!t.includes("require('http')"), 'server source must never be served: ' + u);
    }
  } finally { await s.stop(); }
});

test('monitoring changes reach Sonarr correctly, bad input is refused, and permission is required', async () => {
  const seen = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'); seen.push([req.method, u.pathname, b]); res.setHeader('Content-Type', 'application/json');
      if (u.pathname === '/api/v3/series/1' && req.method === 'GET') return res.end(JSON.stringify({ id: 1, title: 'Show', monitored: true, seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }] }));
      if (u.pathname === '/api/v3/episode' && req.method === 'GET') return res.end(JSON.stringify([
        { id: 11, seasonNumber: 1, episodeNumber: 1, title: 'A', monitored: true, hasFile: true, episodeFileId: 5 },
        { id: 21, seasonNumber: 2, episodeNumber: 1, title: 'B', monitored: true }, { id: 22, seasonNumber: 2, episodeNumber: 2, title: 'C', monitored: true }]));
      if (u.pathname === '/api/v3/episodefile') return res.end(JSON.stringify([{ id: 5, quality: { quality: { name: 'WEBDL-1080p' } }, size: 1000 }]));
      if (u.pathname === '/api/v3/command') return res.end('{"id":1}');
      res.end('{}');
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const s = await boot();
  try {
    const admin = client(s.base); await setup(admin);
    const svc = (await admin.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: 'http://127.0.0.1:' + mock.address().port, apiKey: 'k' })).data;
    const d = (await admin.get(`/api/series/${svc.id}/1`)).data;
    assert.equal(d.title, 'Show'); assert.equal(d.episodes.length, 3);
    assert.equal(d.episodes[0].quality, 'WEBDL-1080p'); assert.deepEqual(d.seasons.map(x => x.n), [1, 2]);
    // turning a season off updates the season AND every episode in it
    seen.length = 0;
    assert.equal((await admin.post('/api/monitor', { sid: svc.id, kind: 'season', id: 1, season: 2, monitored: false })).status, 200);
    const putSeries = seen.find(x => x[0] === 'PUT' && x[1] === '/api/v3/series/1');
    assert.deepEqual(JSON.parse(putSeries[2]).seasons.map(x => x.monitored), [true, false]);
    assert.deepEqual(JSON.parse(seen.find(x => x[1] === '/api/v3/episode/monitor')[2]), { episodeIds: [21, 22], monitored: false });
    // single episodes, whole series
    seen.length = 0;
    await admin.post('/api/monitor', { sid: svc.id, kind: 'episodes', ids: [11], monitored: false });
    assert.deepEqual(JSON.parse(seen.find(x => x[1] === '/api/v3/episode/monitor')[2]), { episodeIds: [11], monitored: false });
    await admin.post('/api/monitor', { sid: svc.id, kind: 'series', id: 1, monitored: false });
    assert.equal(JSON.parse(seen.filter(x => x[0] === 'PUT' && x[1] === '/api/v3/series/1').pop()[2]).monitored, false);
    // searches
    seen.length = 0;
    await admin.post('/api/auto', { sid: svc.id, id: 1, scope: 'season', season: 2 });
    assert.deepEqual(JSON.parse(seen.find(x => x[1] === '/api/v3/command')[2]), { name: 'SeasonSearch', seriesId: 1, seasonNumber: 2 });
    // bad input never reaches Sonarr
    seen.length = 0;
    assert.equal((await admin.post('/api/monitor', { sid: svc.id, kind: 'episodes', ids: [], monitored: true })).status, 400);
    assert.equal((await admin.post('/api/monitor', { sid: svc.id, kind: 'movie', id: 1, monitored: true })).status, 400);
    assert.equal((await admin.post('/api/monitor', { sid: svc.id, kind: 'season', id: 1, season: 99, monitored: true })).status, 404);
    assert.equal((await admin.post('/api/auto', { sid: svc.id, id: 1, scope: 'season' })).status, 400);
    assert.ok(!seen.some(x => x[0] === 'PUT'), 'nothing was changed in Sonarr');
    // a profile without the "add" permission can look but not change
    const kid = (await admin.post('/api/users', { name: 'kid', password: 'kid-password-1' })).data;
    await admin.put(`/api/users/${kid.id}/access`, { access: [svc.id] });
    await admin.put(`/api/users/${kid.id}`, { perms: { add: false, control: true, remove: true, request: true } });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get(`/api/series/${svc.id}/1`)).status, 200);
    seen.length = 0;
    assert.equal((await k.post('/api/monitor', { sid: svc.id, kind: 'episodes', ids: [11], monitored: true })).status, 403);
    assert.equal((await k.post('/api/auto', { sid: svc.id, id: 1, scope: 'series' })).status, 403);
    assert.equal(seen.length, 0, 'nothing reached Sonarr');
  } finally { await s.stop(); mock.close(); }
});
