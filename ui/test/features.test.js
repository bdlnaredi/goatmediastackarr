// End-to-end checks for the library, request, music/book, subtitle, indexer and Usenet features.
// MediaHub is started for real and talks to the pretend apps in lib/demo.js, so these prove MediaHub's own behaviour,
// not that a real Sonarr or Bazarr accepts the same calls. Run with: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, sleep, tmp } = require('./helpers');
const fakes = require('../lib/demo');

async function world(env = {}) {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '500', ...env }), a = client(s.base); await setup(a);
  const ids = {};
  for (const t of ['sonarr', 'radarr', 'qbittorrent', 'plex', 'seerr', 'prowlarr', 'lidarr', 'readarr', 'bazarr', 'sabnzbd'])
    ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k', user: 'u', pass: 'p' })).data.id;
  return { s, a, fake, st: fake.state, ids, stop: async () => { await s.stop(); srv.close(); } };
}
const lastCalls = (st, re) => st.calls.filter(c => re.test(c));

test('bulk edit: monitor, quality profile, search, presets, and remove is for admins only', async () => {
  const w = await world();
  try {
    const { a, st, ids } = w, sid = ids.sonarr;
    assert.equal((await a.post('/api/bulk', { sid, ids: [1, 2], action: 'unmonitor' })).status, 200);
    assert.deepEqual(st.shows.slice(0, 3).map(x => x.monitored), [false, false, true]);
    await a.post('/api/bulk', { sid, ids: [1, 2], action: 'monitor' });
    assert.equal(st.shows[0].monitored, true);
    await a.post('/api/bulk', { sid, ids: [3], action: 'profile', qualityProfileId: 3 });
    assert.equal(st.shows[2].qualityProfileId, 3);
    assert.equal((await a.post('/api/bulk', { sid, ids: [3], action: 'profile' })).status, 400, 'profile needs a value');
    assert.equal((await a.post('/api/bulk', { sid, ids: [], action: 'monitor' })).status, 400);
    assert.equal((await a.post('/api/bulk', { sid, ids: [1], action: 'explode' })).status, 400);
    await a.post('/api/bulk', { sid, ids: [1, 2], action: 'search' });
    assert.equal(lastCalls(st, /sonarr POST \/api\/v3\/command.*SeriesSearch/).length, 2);

    // Presets: latest season only, then future episodes only
    await a.post('/api/bulk', { sid, ids: [2], action: 'preset', preset: 'latest' });
    const lo = st.shows[1]; assert.ok(lo.eps.filter(e => e.seasonNumber === 3).every(e => e.monitored)); assert.ok(lo.eps.filter(e => e.seasonNumber < 3).every(e => !e.monitored));
    assert.deepEqual(lo.seasons.map(x => x.monitored), [false, false, true]);
    await a.post('/api/bulk', { sid, ids: [2], action: 'preset', preset: 'future' });
    assert.ok(lo.eps.every(e => e.monitored === (Date.parse(e.airDateUtc) > Date.now())), 'only episodes that have not aired yet');
    await a.post('/api/bulk', { sid, ids: [2], action: 'preset', preset: 'all' });
    assert.ok(lo.eps.every(e => e.monitored));
    assert.equal((await a.post('/api/bulk', { sid: ids.radarr, ids: [1], action: 'preset', preset: 'all' })).status, 400, 'presets are for Sonarr only');

    // Radarr bulk
    await a.post('/api/bulk', { sid: ids.radarr, ids: [1, 2], action: 'unmonitor' }); assert.equal(st.movies[0].monitored, false);
    await a.post('/api/bulk', { sid: ids.radarr, ids: [1, 2], action: 'search' }); assert.equal(lastCalls(st, /MoviesSearch/).length, 1);

    // A normal profile needs the add permission, and can never remove
    await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
    const kid = (await a.get('/api/users')).data.find(u => u.name === 'kid'); await a.put(`/api/users/${kid.id}/access`, { access: Object.values(ids) });
    const k = client(w.s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.post('/api/bulk', { sid, ids: [1], action: 'monitor' })).status, 200);
    assert.equal((await k.post('/api/bulk', { sid, ids: [1], action: 'remove' })).status, 403);
    await a.put(`/api/users/${kid.id}`, { perms: { add: false } });
    assert.equal((await k.post('/api/bulk', { sid, ids: [1], action: 'monitor' })).status, 403);

    await a.post('/api/bulk', { sid, ids: [6], action: 'remove', deleteFiles: true });
    assert.equal(st.shows.length, 5); assert.ok(lastCalls(st, /sonarr DELETE \/api\/v3\/series\/editor.*deleteFiles":true/).length);
  } finally { await w.stop(); }
});

test('requests: choose seasons, per-person limits, trusted auto-approve, and reporting a problem', async () => {
  const w = await world();
  try {
    const { a, st, ids } = w;
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam'); await a.put(`/api/users/${sam.id}/access`, { access: Object.values(ids) });
    const k = client(w.s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });

    const tv = await k.get(`/api/seerr/tv?sid=${ids.seerr}&id=800`); assert.deepEqual(tv.data.seasons.map(x => x.n), [1, 2, 3], 'specials are left out');
    const r1 = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'tv', mediaId: 800, title: 'Hidden Valley', seasons: [2, 3, 3, 'x', -4] })).data;
    assert.deepEqual(r1.seasons, [2, 3]); assert.equal(r1.status, 'pending');

    // The admin approves: the chosen seasons, not "all", go to Seerr
    assert.equal((await a.post(`/api/requests/${r1.id}/approve`)).status, 200);
    assert.deepEqual(JSON.parse(lastCalls(st, /seerr request/)[0].replace('seerr request ', '')).seasons, [2, 3]);

    // Limit: 2 requests every 7 days
    await a.put(`/api/users/${sam.id}`, { reqLimit: { n: 2, days: 7 } });
    assert.equal((await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 801, title: 'Hidden Harbor' })).status, 200);
    const over = await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 802, title: 'Another' });
    assert.equal(over.status, 429); assert.match(over.data.error, /2 requests/);
    await a.put(`/api/users/${sam.id}`, { reqLimit: null });
    assert.equal((await a.get('/api/users')).data.find(u => u.id === sam.id).reqLimit, null);

    // Auto-approve for trusted people
    await a.put(`/api/users/${sam.id}`, { autoApprove: true });
    const auto = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 803, title: 'Auto One' })).data;
    assert.equal(auto.status, 'approved'); assert.ok(auto.seerrId);

    // Report a problem: the admin is told and a new search starts in Radarr
    const rep = await k.post(`/api/requests/${auto.id}/report`, { text: 'No sound in the second half' });
    assert.equal(rep.status, 200);
    assert.equal((await k.post(`/api/requests/${auto.id}/report`, { text: 'again' })).status, 400, 'no duplicate open reports');
    assert.equal((await k.post(`/api/requests/${auto.id}/report`, { text: '' })).status, 400);
    const list = (await a.get('/api/reports')).data; assert.equal(list.length, 1); assert.equal(list[0].user, 'sam'); assert.equal(list[0].status, 'open');
    assert.equal((await k.get('/api/reports')).data.length, 1, 'people see their own reports');
    assert.equal((await k.post(`/api/reports/${list[0].id}/resolve`)).status, 403);
    assert.equal((await a.post(`/api/reports/${list[0].id}/resolve`)).status, 200);
    assert.equal((await a.get('/api/reports')).data[0].status, 'done');
    const other = client(w.s.base); await a.post('/api/users', { name: 'eve', password: 'evevevevv', role: 'user' }); await other.post('/api/login', { name: 'eve', password: 'evevevevv' });
    assert.equal((await other.post(`/api/requests/${auto.id}/report`, { text: 'not mine' })).status, 404, 'cannot report someone else\'s request');
  } finally { await w.stop(); }
});

test('music and books: search, add, monitor, find, remove (Lidarr and Readarr)', async () => {
  const w = await world();
  try {
    const { a, st, ids } = w;
    for (const [t, ent, name] of [['lidarr', 'artist', 'The Night Owls'], ['readarr', 'author', 'Ada Linden']]) {
      const lib = (await a.get(`/api/media/${ids[t]}/library`)).data; assert.ok(lib.items.length >= 2); assert.equal(lib.missing, 7);
      assert.match(lib.items[0].poster, /^data:image\/svg/); assert.ok(lib.items[0].have <= lib.items[0].total);
      const f = (await a.get(`/api/media/${ids[t]}/search?term=echo`)).data; assert.equal(f.results[0].title, 'Echo Valley'); assert.ok(f.folders.length && f.profiles.length);
      const add = await a.post(`/api/media/${ids[t]}/add`, { item: f.results[0].raw, rootFolderPath: f.folders[0].path, qualityProfileId: f.profiles[0].id, metadataProfileId: 1 });
      assert.equal(add.status, 200);
      const sent = lastCalls(st, new RegExp(`${t} POST /api/v1/${ent} `)).pop(); assert.match(sent, /"monitored":true/); assert.match(sent, /searchForMissing/);
      assert.equal((await a.post(`/api/media/${ids[t]}/monitor`, { id: 1, monitored: false })).status, 200);
      assert.equal((t === 'lidarr' ? st.artists : st.authors)[0].monitored, false);
      await a.post(`/api/media/${ids[t]}/find`, { id: 1 }); assert.ok(lastCalls(st, t === 'lidarr' ? /ArtistSearch/ : /AuthorSearch/).length);
      assert.equal((await a.get(`/api/media/${ids[t]}/search?term=${encodeURIComponent(name)}`)).data.results[0].added, true);
      assert.equal((await a.del(`/api/media/${ids[t]}/2`)).status, 200);
      assert.equal((await a.get(`/api/media/${ids.sonarr}/library`)).status, 404, 'only music and book apps');
    }
  } finally { await w.stop(); }
});

test('subtitles, indexers and Usenet history/NZB upload', async () => {
  const w = await world();
  try {
    const { a, st, ids } = w;
    const wanted = (await a.get(`/api/bazarr/${ids.bazarr}/wanted`)).data;
    assert.equal(wanted.episodes.length, 2); assert.equal(wanted.movies.length, 1); assert.equal(wanted.total, 3);
    assert.equal(wanted.episodes[1].missing.length, 2);
    const s1 = await a.post(`/api/bazarr/${ids.bazarr}/search`, { kind: 'episode', id: wanted.episodes[1].id, seriesId: wanted.episodes[1].seriesId, langs: wanted.episodes[1].missing });
    assert.equal(s1.status, 200); assert.equal(s1.data.found, 2);
    assert.match(lastCalls(st, /bazarr episodes/)[0], /seriesid=2&episodeid=2302&language=en/);
    await a.post(`/api/bazarr/${ids.bazarr}/search`, { kind: 'movie', id: 2, langs: [{ code: 'en' }] });
    assert.equal((await a.get(`/api/bazarr/${ids.bazarr}/wanted`)).data.total, 1, 'finished items drop off the list');
    assert.equal((await a.post(`/api/bazarr/${ids.bazarr}/search`, { kind: 'movie', id: 2, langs: [{ code: '../x' }] })).status, 400);

    const ix = (await a.get(`/api/prowlarr/${ids.prowlarr}/indexers`)).data;
    assert.equal(ix.indexers.length, 6); assert.equal(ix.indexers.find(x => x.name === 'Broken Tracker').status, 'failing'); assert.equal(ix.indexers.find(x => x.name === 'Archive Box').status, 'disabled');
    assert.equal(ix.indexers.find(x => x.name === 'NZBgeek').status, 'ok'); assert.ok(ix.health.length);
    assert.deepEqual((await a.post(`/api/prowlarr/${ids.prowlarr}/indexers/1/test`)).data, { ok: true });
    const bad = (await a.post(`/api/prowlarr/${ids.prowlarr}/indexers/4/test`)).data; assert.equal(bad.ok, false); assert.match(bad.error, /timeout/);
    const all = (await a.post(`/api/prowlarr/${ids.prowlarr}/indexers/all/test`)).data; assert.equal(all.length, 5); assert.equal(all.filter(x => !x.ok).length, 1);

    const hist = (await a.get(`/api/sab/${ids.sabnzbd}/history`)).data; assert.equal(hist.length, 2); assert.equal(hist[1].status, 'Failed'); assert.match(hist[1].error, /Aborted/);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/history/act`, { id: 'SABnzbd_nzo_a2', op: 'retry' })).status, 200);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/history/act`, { id: 'a b', op: 'retry' })).status, 400);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/history/act`, { id: 'SABnzbd_nzo_a1', op: 'delete' })).status, 200);
    assert.equal((await a.get(`/api/sab/${ids.sabnzbd}/history`)).data.length, 0);
    const nzb = Buffer.from('<?xml version="1.0"?><nzb></nzb>').toString('base64');
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/add`, { name: 'x.nzb', nzb })).status, 200); assert.ok(lastCalls(st, /sab addfile \d+ bytes/).length);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/add`, { url: 'https://example.com/a.nzb' })).status, 200);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/add`, { url: 'file:///etc/passwd' })).status, 400);
    assert.equal((await a.post(`/api/sab/${ids.sabnzbd}/add`, {})).status, 400);

    const h = (await a.get('/api/libhealth')).data, sn = h.find(x => x.type === 'sonarr');
    assert.deepEqual(sn.disks.map(d => d.label), ['Downloads', '', '', 'Container (Docker image)'], 'folders are named, the important ones first');
    assert.ok(sn.issues.length && sn.disks.length && sn.queue.length && sn.missing > 0, 'health, disk space, stuck downloads and missing counts');
    assert.equal(sn.queue[0].title, 'Stuck.Release.1080p'); assert.match(sn.queue[0].message, /eligible for import/);
    const rd = (await a.get('/api/libhealth')).data.find(x => x.type === 'prowlarr'); assert.equal(rd.ok, true);
    const k = client(w.s.base); await a.post('/api/users', { name: 'pat', password: 'patpatpat', role: 'user' }); await k.post('/api/login', { name: 'pat', password: 'patpatpat' });
    assert.equal((await k.get('/api/libhealth')).status, 403); assert.equal((await k.get(`/api/prowlarr/${ids.prowlarr}/indexers`)).status, 403);
  } finally { await w.stop(); }
});

test('slow downloads while Plex is streaming, then restore afterwards', async () => {
  const w = await world();
  try {
    const { a, st } = w;
    assert.deepEqual((await a.get('/api/throttle')).data, { on: false, active: false });
    st.streams = 1; await sleep(1500); assert.equal(st.altSpeed, false, 'off by default');
    await a.put('/api/throttle', { on: true });
    for (let i = 0; i < 20 && !st.altSpeed; i++) await sleep(250);
    assert.equal(st.altSpeed, true, 'slowed once someone streams'); assert.equal((await a.get('/api/throttle')).data.active, true);
    await sleep(1500); assert.equal(lastCalls(st, /toggleSpeedLimitsMode/).length, 1, 'not toggled again and again');
    st.streams = 0;
    for (let i = 0; i < 30 && st.altSpeed; i++) await sleep(250);
    assert.equal(st.altSpeed, false, 'restored when the stream ends'); assert.equal((await a.get('/api/throttle')).data.active, false);

    // If the person had already chosen slow mode themselves, MediaHub leaves it alone
    st.altSpeed = true; st.streams = 2; await sleep(1500); st.streams = 0; await sleep(2000);
    assert.equal(st.altSpeed, true); assert.equal(lastCalls(st, /toggleSpeedLimitsMode/).length, 2);

    // Switching the feature off while it holds speeds down puts them back
    st.altSpeed = false; st.streams = 1; for (let i = 0; i < 20 && !st.altSpeed; i++) await sleep(250); assert.equal(st.altSpeed, true);
    await a.put('/api/throttle', { on: false }); for (let i = 0; i < 20 && st.altSpeed; i++) await sleep(250); assert.equal(st.altSpeed, false);
  } finally { await w.stop(); }
});

test('weekly newsletter: preview, send to every channel, and the schedule is saved', async () => {
  const got = [], hook = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  await new Promise(r => hook.once('listening', r));
  const w = await world();
  try {
    const { a, ids } = w;
    assert.equal((await a.post('/api/weekly/send')).status, 400, 'needs a channel first');
    await a.post('/api/alerts/channels', { type: 'webhook', target: `http://127.0.0.1:${hook.address().port}/` });
    const pr = (await a.get('/api/weekly/preview')).data, pv = pr.text; assert.match(pr.html, /Your week on GoatMediaStackarr/); assert.doesNotMatch(pr.html, /<script/i); assert.match(pv, /Downloads finished: \d+/); assert.match(pv, /Requests this week: 0 made/); assert.match(pv, /apps are responding|not responding/);
    assert.equal((await a.post('/api/weekly/send')).status, 200); assert.equal(got.length, 1); assert.match(got[0].title, /weekly newsletter/i); assert.match(got[0].message, /Downloads finished/);
    await a.put('/api/weekly', { on: true, day: 5, hour: 18 });
    const cfg = (await a.get('/api/weekly')).data; assert.equal(cfg.on, true); assert.equal(cfg.day, 5); assert.equal(cfg.hour, 18); assert.ok(cfg.last > 0, 'turning it on does not send one straight away');
    await sleep(1500); assert.equal(got.length, 1);
    const k = client(w.s.base); await a.post('/api/users', { name: 'u1', password: 'u1u1u1u1', role: 'user' }); await k.post('/api/login', { name: 'u1', password: 'u1u1u1u1' });
    assert.equal((await k.put('/api/weekly', { on: false })).status, 403); assert.equal((await k.put('/api/throttle', { on: true })).status, 403);
  } finally { await w.stop(); hook.close(); }
});

test('demo mode: ready-made sign-in, pretend apps, nothing saved, risky settings locked', async () => {
  const dir = tmp(), s = await boot({ DEMO: '1' }, dir);
  try {
    const c = client(s.base), me = (await c.get('/api/me')).data; assert.equal(me.demo, true); assert.equal(me.setup, false);
    assert.equal((await c.post('/api/login', { name: 'demo', password: 'wrong-password' })).status, 401);
    assert.equal((await c.post('/api/login', { name: 'demo', password: 'demo-mediahub' })).status, 200);
    const sv = (await c.get('/api/services')).data; assert.equal(sv.length, 14);
    const lib = (await c.get(`/api/library?sid=${sv.find(x => x.type === 'sonarr').id}`)).data; assert.equal(lib.length, 6); assert.match(lib[0].poster, /^data:image\/svg/);
    assert.equal((await c.get(`/api/status/${sv.find(x => x.type === 'qbittorrent').id}`)).data.ok, true);
    assert.equal((await c.get(`/api/qb/${sv.find(x => x.type === 'qbittorrent').id}/list`)).data.torrents.length, 4);
    for (const [m, u, b] of [['post', '/api/users', { name: 'x', password: 'xxxxxxxx', role: 'admin' }], ['post', '/api/password', { old: 'demo-mediahub', new: 'hacked-it-123' }], ['post', '/api/alerts/channels', { type: 'webhook', target: 'http://x.test' }],
      ['post', '/api/services', { type: 'sonarr', name: 'x', url: 'http://x.test' }], ['post', '/api/backups/run'], ['post', '/api/statuslinks', { name: 'x' }], ['put', '/api/throttle', { on: true }]])
      assert.equal((await c[m](u, b)).status, 403, u);
    assert.equal((await c.post('/api/bulk', { sid: sv.find(x => x.type === 'sonarr').id, ids: [1], action: 'unmonitor' })).status, 200, 'the fun parts still work');
    assert.equal(fs.existsSync(path.join(dir, 'db.json')), false, 'demo never writes accounts or settings to disk');
    const g = client(s.base); assert.equal((await g.post('/api/login', { name: 'guest', password: 'guest-mediahub' })).status, 200); assert.equal((await g.get('/api/users')).status, 403);
  } finally { await s.stop(); }
  const real = await boot();
  try { const t = await (await fetch(real.base + '/__demo/sonarr/api/v3/series')).text(); assert.equal(t.includes('Harbor Lights'), false, 'the pretend apps are not served outside demo mode'); } finally { await real.stop(); }
});
