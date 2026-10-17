// Live stream, Plex session details, Stats data and the public status page extras.
// Run against the pretend apps in lib/demo.js, so these prove MediaHub's own behaviour, not that a real Plex or Tautulli sends the same fields.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

async function world(env = {}) {
  const fake = fakes.create({ streams: 2 }), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '400', LIVE_MS: '300', ...env }), a = client(s.base); await setup(a);
  const ids = {};
  for (const t of ['qbittorrent', 'plex', 'sabnzbd', 'unraid', 'tautulli'])
    ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k', user: 'u', pass: 'p' })).data.id;
  return { s, a, fake, ids, stop: async () => { await s.stop(); srv.close(); } };
}
async function sse(base, cookie, n, ms = 6000) {
  const ac = new AbortController(), r = await fetch(base + '/api/live', { headers: cookie ? { Cookie: cookie } : {}, signal: ac.signal }), out = [];
  if (r.status !== 200) { ac.abort(); return { status: r.status, out, type: r.headers.get('content-type') }; }
  const rd = r.body.getReader(), t = setTimeout(() => ac.abort(), ms); let buf = '';
  try {
    while (out.length < n) {
      const { value, done } = await rd.read(); if (done) break; buf += Buffer.from(value).toString(); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); const m = c.match(/^data: (.*)$/m); if (m) out.push(JSON.parse(m[1])); }
    }
  } catch {} finally { clearTimeout(t); ac.abort(); }
  return { status: r.status, out, type: r.headers.get('content-type') };
}

test('live stream: needs sign-in, pushes speeds, server, streams and Usenet, and only shows apps a profile may use', async () => {
  const w = await world();
  try {
    const { a, s, ids } = w;
    assert.equal((await sse(s.base, '', 1)).status, 401, 'signed-out people get nothing');
    const r = await sse(s.base, a.cookie, 3);
    assert.equal(r.status, 200); assert.match(r.type, /text\/event-stream/);
    assert.ok(r.out.length >= 2, 'new data keeps arriving without asking again');
    const d = r.out[0], q = d.qb[ids.qbittorrent];
    assert.ok(q.dl > 0 && q.active >= 1 && Array.isArray(q.top), 'download speed and the active list');
    assert.ok(d.unraid[ids.unraid].cpu >= 0 && d.unraid[ids.unraid].total > 0, 'server load and array size');
    assert.equal(d.sab[ids.sabnzbd].slots, 1);
    assert.ok(d.hist && d.hist[ids.qbittorrent].dl.length >= 1, 'the first message carries the recent speed history'); assert.ok(!r.out[1].hist, 'later messages stay small');
    const pl = d.plex[ids.plex]; assert.equal(pl.length, 2);
    assert.deepEqual(pl.map(x => x.decision), ['direct', 'transcode']); assert.equal(pl[0].res, '4K'); assert.equal(pl[1].where, 'wan'); assert.ok(pl[0].kbps > 0);

    // A profile with access to nothing sees none of it
    const kid = (await a.post('/api/users', { name: 'kid', password: 'kid-password-1' })).data; assert.ok(kid.id);
    const k = client(s.base); assert.equal((await k.post('/api/login', { name: 'kid', password: 'kid-password-1' })).status, 200);
    const kr = await sse(s.base, k.cookie, 1); assert.equal(kr.status, 200);
    assert.deepEqual([kr.out[0].qb, kr.out[0].unraid, kr.out[0].plex, kr.out[0].sab], [{}, {}, {}, {}]);
    await a.put(`/api/users/${kid.id}/access`, { access: [ids.plex] });
    const kr2 = await sse(s.base, k.cookie, 1); assert.ok(kr2.out[0].plex[ids.plex] && !Object.keys(kr2.out[0].qb).length, 'only the allowed app appears');
  } finally { await w.stop(); }
});

test('live stream: a signed-out session is dropped', async () => {
  const w = await world();
  try {
    const { a, s } = w, ac = new AbortController();
    const r = await fetch(s.base + '/api/live', { headers: { Cookie: a.cookie }, signal: ac.signal }), rd = r.body.getReader();
    await rd.read(); await a.post('/api/logout');
    let ended = false; const t0 = Date.now();
    while (Date.now() - t0 < 4000) { const x = await Promise.race([rd.read(), sleep(1500).then(() => ({ timeout: true }))]); if (x.done) { ended = true; break; } if (x.timeout) continue; }
    ac.abort(); assert.ok(ended, 'the stream closes once the session is gone');
  } finally { await w.stop(); }
});

test('stats: posters, charts and totals from Tautulli, with safe image fetching', async () => {
  const w = await world();
  try {
    const { a, s, ids } = w, id = ids.tautulli;
    const d = (await a.get(`/api/tautulli/${id}/stats?days=30`)).data;
    assert.ok(d.movies.length >= 5 && /^\/library\//.test(d.movies[0].thumb) && d.tv[0].thumb, 'poster paths for top movies and shows');
    assert.equal(d.byDate.categories.length, 30); assert.deepEqual(d.byDate.series.map(x => x.name), ['TV', 'Movies']);
    assert.equal(d.byHour.categories.length, 24); assert.ok(d.byPlatform.categories.length >= 3);
    assert.ok(d.totals.plays > 0 && d.totals.seconds > d.totals.plays, 'plays and time watched are added up');
    assert.ok(d.history[0].thumb && d.users[0].seconds > 0);
    const img = await fetch(s.base + `/api/tautulli/${id}/img?p=` + encodeURIComponent(d.movies[0].thumb), { headers: { Cookie: a.cookie } });
    assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /^image\//);
    for (const bad of ['http://evil.test/x.png', '/etc/passwd', '/library/../../secret', '']) {
      assert.equal((await a.get(`/api/tautulli/${id}/img?p=` + encodeURIComponent(bad))).status, 400, 'refuses ' + bad);
    }
    const kid = (await a.post('/api/users', { name: 'kid', password: 'kid-password-1' })).data, k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get(`/api/tautulli/${id}/stats`)).status, 404, 'needs access to the app'); assert.ok(kid.id);
    assert.ok(!JSON.stringify(d).includes('apikey'), 'no keys in the answer');
  } finally { await w.stop(); }
});

test('status page: who is watching (no names), uptime history, and the uptime list for the dashboard', async () => {
  const w = await world();
  try {
    const { a, s } = w; await sleep(1500);
    const up = (await a.get('/api/uptime')).data, first = Object.values(up)[0];
    assert.equal(first.bars.length, 48); assert.ok(first.pct > 90 && first.bars[47] > 0, 'recent checks show as online');
    const link = (await a.post('/api/statuslinks', { name: 'Tablet', apps: true, watching: true })).data, anon = client(s.base);
    const d = (await anon.get('/api/public/' + link.token)).data;
    assert.equal(d.watching.count, 2); assert.ok(d.watching.kbps > 0); assert.equal(d.watching.items.length, 2);
    const raw = JSON.stringify(d); assert.ok(!/alex|sam|Living Room|Phone/.test(raw), 'no names or devices are shared');
    assert.equal(d.apps[0].bars.length, 48); assert.ok(d.apps[0].pct > 90);
    const l2 = (await a.post('/api/statuslinks', { name: 'Plain', apps: true })).data;
    assert.ok(!('watching' in (await anon.get('/api/public/' + l2.token)).data), 'not shared unless chosen');
    assert.equal((await anon.get('/api/uptime')).status, 401);
    const page = await (await fetch(s.base + '/s/' + link.token)).text(); assert.match(page, /statuskit\.js/);
    assert.match(await (await fetch(s.base + '/statuskit.js')).text(), /Watching now/);
  } finally { await w.stop(); }
});

test('status pages: edit, note and look, new address kills the old one, preview, admin only, and wallpapers', async () => {
  const w = await world();
  try {
    const { a, s } = w, anon = client(s.base);
    const c = (await a.post('/api/statuslinks', { name: 'Hall', apps: true, note: 'Back at 6', look: 'light' })).data;
    let pub = (await anon.get('/api/public/' + c.token)).data;
    assert.equal(pub.note, 'Back at 6'); assert.equal(pub.look, 'light');
    assert.ok(!('traffic' in pub));
    await a.put('/api/statuslinks/' + c.id, { name: 'Hall 2', look: 'bogus', scopes: { apps: true, traffic: true } });
    pub = (await anon.get('/api/public/' + c.token)).data;
    assert.equal(pub.name, 'Hall 2'); assert.equal(pub.look, 'light', 'unknown looks are ignored'); assert.ok('traffic' in pub);
    const pv = await a.get('/api/statuslinks/preview?apps=1&note=hi&look=dark'); assert.equal(pv.status, 200); assert.equal(pv.data.note, 'hi');
    assert.equal((await anon.get('/api/statuslinks/preview?apps=1')).status, 401);
    const rg = (await a.post('/api/statuslinks/' + c.id + '/regenerate', {})).data;
    assert.equal((await anon.get('/api/public/' + c.token)).status, 404, 'old address stops working');
    assert.equal((await anon.get('/api/public/' + rg.token)).status, 200);
    assert.equal((await a.post('/api/statuslinks/nope/regenerate', {})).status, 404);
    assert.ok(Array.isArray((await anon.get('/api/wallpapers')).data));
    for (const bad of ['/wallpapers/..%2Fdb.json', '/wallpapers/x.txt'])
      { const r = await fetch(s.base + bad); assert.ok(r.status !== 200 || !/statusLinks|hash/.test(await r.text()), bad); assert.notEqual(r.headers.get('content-type'), 'application/json', bad); }
  } finally { await w.stop(); }
});
