// Profile pictures, what each person uses (space and watch time), the admin's space limit, the title page and
// download categories. GoatMediaStackarr runs for real against the pretend apps in lib/demo.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

async function world() {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '60000' }), a = client(s.base); await setup(a);
  const ids = {};
  for (const t of ['sonarr', 'radarr', 'qbittorrent', 'seerr', 'tautulli'])
    ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k', user: 'u', pass: 'p' })).data.id;
  await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
  const kid = (await a.get('/api/users')).data.find(u => u.name === 'kid');
  await a.put(`/api/users/${kid.id}/access`, { access: Object.values(ids) });
  const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
  return { s, a, k, kid, fake, ids, stop: async () => { await s.stop(); srv.close(); } };
}

// A real (tiny) PNG: the signature, then enough bytes to pass the size check.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);

test('profile picture: upload, shown to others, replaced, removed; only real pictures', async () => {
  const w = await world();
  try {
    const { a, k, kid } = w;
    assert.equal((await k.put('/api/me/avatar', { type: 'image/png', data: Buffer.from('hello world').toString('base64') })).status, 400, 'not a picture');
    assert.equal((await k.put('/api/me/avatar', { type: 'image/gif', data: png.toString('base64') })).status, 400, 'unsupported type');
    assert.equal((await k.put('/api/me/avatar', { type: 'image/png', data: Buffer.concat([png, Buffer.alloc(2.1e6)]).toString('base64') })).status, 400, 'too big');
    const up = await k.put('/api/me/avatar', { type: 'image/png', data: 'data:image/png;base64,' + png.toString('base64') });
    assert.equal(up.status, 200); assert.match(up.data.avatar, new RegExp(`^/api/avatar/${kid.id}\\?v=\\d+$`));
    const me = (await k.get('/api/me')).data.user; assert.equal(me.avatar, up.data.avatar);
    // The admin (another person) can see it; someone signed out cannot.
    const r = await fetch(w.s.base + up.data.avatar, { headers: { Cookie: a.cookie } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
    assert.equal((await fetch(w.s.base + up.data.avatar)).status, 401);
    assert.equal((await k.del('/api/me/avatar')).data.avatar, '');
    assert.equal((await a.get(`/api/avatar/${kid.id}`)).status, 404);
  } finally { await w.stop(); }
});

test('usage: space taken by what someone asked for, their watch time, and the admin space limit', async () => {
  const w = await world();
  try {
    const { a, k, kid, ids } = w;
    await a.put(`/api/users/${kid.id}`, { autoApprove: true, plexName: 'alex' });
    // 5001 is Glass Meridian in the pretend Radarr: it is downloaded and 4.2 GB.
    assert.equal((await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5001, title: 'Glass Meridian', year: '2024' })).status, 200);
    let u = (await k.get('/api/usage')).data;
    assert.equal(u.requests.total, 1); assert.equal(u.requests.approved, 1);
    assert.equal(u.space.bytes, 4.2e9); assert.equal(u.space.items[0].title, 'Glass Meridian');
    assert.equal(u.limitGb, 0);
    assert.deepEqual(u.watch.find(x => x.days === 30), { days: 30, plays: 60, seconds: 162000 });
    assert.ok(u.devices >= 1);
    // The same title asked for twice is only counted once.
    await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5001, title: 'Glass Meridian', year: '2024' });
    assert.equal((await k.get('/api/usage')).data.space.bytes, 4.2e9);

    // Only an admin sets the limit, and sees other people's use.
    assert.equal((await k.put(`/api/users/${kid.id}`, { dataLimit: 999 })).status, 403);
    assert.equal((await k.get(`/api/users/${kid.id}/usage`)).status, 403);
    assert.equal((await a.put(`/api/users/${kid.id}`, { dataLimit: 4 })).data.dataLimit, 4);
    assert.equal((await a.get(`/api/users/${kid.id}/usage`)).data.limitGb, 4);
    const no = await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5002, title: 'Salt & Ember', year: '2023' });
    assert.equal(no.status, 429); assert.match(no.data.error, /4\.2 GB of the 4 GB/);
    await a.put(`/api/users/${kid.id}`, { dataLimit: 0 });
    assert.equal((await a.get('/api/users')).data.find(x => x.id === kid.id).dataLimit, 0);
    assert.equal((await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5002, title: 'Salt & Ember', year: '2023' })).status, 200);
    // An admin is never limited, and someone without Plex has no watch time.
    assert.equal((await a.get('/api/usage')).data.watch, null);
  } finally { await w.stop(); }
});

test('title page: details from Seerr, with cast, trailer, seasons and where it is in the library', async () => {
  const w = await world();
  try {
    const { k, ids } = w;
    const m = (await k.get('/api/title?type=movie&id=5001')).data;
    assert.equal(m.title, 'Demo movie 5001'); assert.equal(m.year, '2025'); assert.equal(m.runtime, 118); assert.equal(m.trailer, 'dQw4w9WgXcQ');
    assert.deepEqual(m.genres, ['Drama', 'Sci-Fi']); assert.equal(m.cast.length, 3); assert.equal(m.studio, 'Demo Pictures');
    assert.deepEqual(m.library, { sid: ids.radarr, id: 1, kind: 'movie' }, 'it is already in Radarr');
    const t = (await k.get('/api/title?type=tv&id=7002')).data;
    assert.deepEqual(t.seasons.map(x => x.n), [1, 2, 3], 'specials are left out');
    assert.equal(t.runtime, 44); assert.deepEqual(t.library, { sid: ids.sonarr, id: 2, kind: 'tv' });
    assert.equal((await k.get('/api/title?type=movie&id=0')).status, 400);
  } finally { await w.stop(); }
});

test('episodes carry their overview; download categories can be added, with clear errors', async () => {
  const w = await world();
  try {
    const { a, k, ids } = w;
    const ep = (await k.get(`/api/series/${ids.sonarr}/1`)).data.episodes[0];
    assert.match(ep.overview, /^In episode 1 of season 1/); assert.equal(ep.runtime, 44);
    const q = ids.qbittorrent;
    assert.equal((await k.post(`/api/qb/${q}/cat`, { op: 'create', name: 'kids' })).status, 403, 'admins only');
    assert.equal((await a.post(`/api/qb/${q}/cat`, { op: 'create', name: 'kids', path: '/downloads/kids' })).status, 200);
    assert.deepEqual((await a.get(`/api/qb/${q}/meta`)).data.categories.find(c => c.name === 'kids'), { name: 'kids', path: '/downloads/kids' });
    const dup = await a.post(`/api/qb/${q}/cat`, { op: 'create', name: 'Kids' });
    assert.equal(dup.status, 400); assert.match(dup.data.error, /already a category/);
    assert.match((await a.post(`/api/qb/${q}/cat`, { op: 'create', name: '/bad' })).data.error, /slash/);
    assert.equal((await a.post(`/api/qb/${q}/cat`, { op: 'remove', name: 'kids' })).status, 200);
    assert.ok(!(await a.get(`/api/qb/${q}/meta`)).data.categories.some(c => c.name === 'kids'));
  } finally { await w.stop(); }
});
