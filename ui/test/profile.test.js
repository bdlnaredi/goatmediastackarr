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

test('streaming data: counted per person per month from Plex and Jellyfin, limited, and streams stopped at the limit', async () => {
  const fake = fakes.create({ streams: 2 }), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '300' }), a = client(s.base); await setup(a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    for (const t of ['plex', 'jellyfin']) await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' });
    await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
    await a.post('/api/users', { name: 'riley', password: 'rileyriley', role: 'user' });
    const users = (await a.get('/api/users')).data, kid = users.find(u => u.name === 'kid'), riley = users.find(u => u.name === 'riley');
    // The default is 100 GB a month; kid (Plex user "alex") gets a tiny custom limit so the test reaches it.
    assert.deepEqual((await a.get('/api/streaming')).data.defaultGb, 100);
    assert.equal(kid.streamLimit, null);
    assert.equal((await a.put(`/api/users/${kid.id}`, { plexName: 'alex', streamLimit: 0.001 })).data.streamLimit, 0.001);
    for (let i = 0; i < 40 && !fake.state.calls.some(c => c.startsWith('plex terminate s0')); i++) await sleep(150);
    const stop = fake.state.calls.find(c => c.startsWith('plex terminate s0'));
    assert.ok(stop, 'kid\'s Plex stream was stopped'); assert.match(stop, /streamed your 0\.001 GB for this month/);
    assert.ok(!fake.state.calls.some(c => c.startsWith('jellyfin Playing/Stop')), 'riley is under the default limit');

    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    const mine = (await k.get('/api/usage')).data.stream;
    assert.ok(mine.bytes >= 1e6); assert.equal(mine.limitGb, 0.001); assert.equal(mine.custom, true); assert.equal(mine.defaultGb, 100);
    assert.equal((await k.get('/api/streaming')).status, 403, 'everyone\'s use is for admins only');
    const all = (await a.get('/api/streaming')).data.users;
    assert.ok(all.find(x => x.name === 'riley' && x.profile && x.bytes > 0), 'Jellyfin user matched by profile name');
    assert.ok(all.find(x => x.name === 'sam' && !x.profile && x.bytes > 0), 'a Plex account without a profile is counted');
    assert.equal(all.find(x => x.name === 'admin').limitGb, 0, 'admins have no limit');

    // Lowering the default applies to riley (Jellyfin): the stream gets a message, then is stopped.
    assert.equal((await a.put('/api/streaming', { defaultGb: 0.001 })).data.defaultGb, 0.001);
    for (let i = 0; i < 40 && !fake.state.calls.some(c => c.startsWith('jellyfin Playing/Stop')); i++) await sleep(150);
    assert.ok(fake.state.calls.some(c => c === 'jellyfin Message a1b2c3d4e5f60718293a4b5c6d7e8f90'));
    assert.ok(fake.state.calls.some(c => c === 'jellyfin Playing/Stop a1b2c3d4e5f60718293a4b5c6d7e8f90'));
    // Back to the default, or no limit at all (0).
    assert.equal((await a.put(`/api/users/${kid.id}`, { streamLimit: null })).data.streamLimit, null);
    assert.equal((await a.put(`/api/users/${riley.id}`, { streamLimit: 0 })).data.streamLimit, 0);
    assert.equal((await a.get('/api/streaming')).data.users.find(x => x.name === 'riley').limitGb, 0);
    assert.equal((await a.put('/api/streaming', { wanOnly: true })).data.wanOnly, true);
  } finally { await s.stop(); srv.close(); }
});

test('request stages follow the real download: searching, downloading with progress, importing, in the library, available on Plex', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, st = fake.state;
  const s = await boot({ MONITOR_MS: '60000', REQ_REFRESH_MS: '0' }), a = client(s.base); await setup(a);
  try {
    const ids = {};
    for (const t of ['radarr', 'seerr', 'plex']) ids[t] = (await a.post('/api/services', { type: t, name: t === 'plex' ? 'Plex' : t, url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    // 5004 is Parallel Sundays (Radarr movie 4), which has no file yet.
    const made = (await a.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5004, title: 'Parallel Sundays', year: '2025' })).data;
    assert.equal(made.stage, 'approved');
    const stage = async () => (await a.get('/api/requests')).data.find(x => x.id === made.id);
    assert.equal((await stage()).stage, 'searching', 'in Radarr, nothing downloading yet');
    st.queueDetails = [{ movieId: 4, size: 4e9, sizeleft: 1e9, timeleft: '00:10:00', status: 'downloading', trackedDownloadState: 'downloading' }];
    let x = await stage(); assert.equal(x.stage, 'downloading'); assert.equal(x.progress, 0.75); assert.equal(x.eta, '00:10:00');
    st.queueDetails = [{ movieId: 4, size: 4e9, sizeleft: 0, status: 'completed', trackedDownloadState: 'importing' }];
    assert.equal((await stage()).stage, 'importing', 'being copied or hardlinked into the library');
    st.queueDetails = []; st.movies[3].hasFile = true;
    assert.equal((await stage()).stage, 'library', 'the file is there, Plex has not found it yet');
    assert.ok(st.calls.includes('plex refresh'), 'Plex was asked to look for new files');
    st.plexLib = [{ type: 'movie', title: 'Parallel Sundays', year: 2025, Guid: [{ id: 'tmdb://5004' }] }];
    x = await stage(); assert.equal(x.stage, 'available'); assert.equal(x.where, 'Plex');
  } finally { await s.stop(); srv.close(); }
});
