// Jellyfin support: sessions are read in Jellyfin's own shape and shown like any other media server.
// Runs against the pretend Jellyfin in lib/demo.js, so it proves MediaHub's handling, not that a real server answers identically.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

async function world() {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({ MONITOR_MS: '500', LIVE_MS: '300' }), a = client(s.base); await setup(a);
  const id = (await a.post('/api/services', { type: 'jellyfin', name: 'Jelly', url: `http://127.0.0.1:${srv.address().port}/jellyfin`, apiKey: 'k' })).data.id;
  return { s, a, id, stop: async () => { await s.stop(); srv.close(); } };
}

test('jellyfin: can be added, shows who is watching, recently added, artwork, and can end a stream', async () => {
  const w = await world();
  try {
    const { a, id } = w;
    const now = (await a.get(`/api/jellyfin/${id}/now`)).data;
    assert.equal(now.sessions.length, 1, 'idle sessions are left out');
    const x = now.sessions[0];
    assert.equal(x.user, 'riley'); assert.equal(x.state, 'playing'); assert.equal(x.decision, 'direct'); assert.equal(x.res, '1080p'); assert.equal(x.where, 'lan'); assert.equal(x.kind, 'movie');
    assert.ok(x.progress > 0 && x.progress < 1, 'position is turned into progress'); assert.ok(x.duration > 6e6, 'ticks become milliseconds');
    assert.ok(now.recent.length >= 1 && now.recent[0].thumb);
    const img = await fetch(w.s.base + `/api/jellyfin/${id}/img?p=${now.recent[0].thumb}`, { headers: { Cookie: a.cookie } });
    assert.equal(img.status, 200); assert.match(img.headers.get('content-type'), /image/);
    assert.equal((await a.get(`/api/jellyfin/${id}/img?p=../../etc/passwd`)).status, 400, 'only item ids are accepted');
    assert.equal((await a.post(`/api/jellyfin/${id}/terminate`, { session: 'not valid!' })).status, 400);
    assert.equal((await a.post(`/api/jellyfin/${id}/terminate`, { session: x.id })).status, 200);
    const live = await liveOnce(w.s.base, a.cookie);
    assert.ok((live.plex[id] || []).length === 1, 'the live stream carries Jellyfin sessions in the same place as Plex');
    let ok; for (let i = 0; i < 12 && ok !== true; i++) { await sleep(500); ok = (await liveOnce(w.s.base, a.cookie)).health[id]; }
    assert.equal(ok, true, 'the monitor sees it as online');
  } finally { await w.stop(); }
});

async function liveOnce(base, cookie) {
  const ac = new AbortController(), r = await fetch(base + '/api/live', { headers: { Cookie: cookie }, signal: ac.signal });
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', end = Date.now() + 6000;
  while (Date.now() < end) {
    const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value);
    const m = buf.match(/data: (.+)\n\n/g); if (m) { const d = JSON.parse(m[m.length - 1].slice(6)); if (Object.keys(d.plex || {}).length) { ac.abort(); return d; } }
  }
  ac.abort(); throw new Error('no live data');
}
