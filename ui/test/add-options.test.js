// Adding from Search: what to monitor, minimum availability, series type, season folders and searching now reach Sonarr and Radarr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('add options reach Sonarr and Radarr', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  const bodies = () => fake.state.calls.filter(c => /POST \/api\/v3\/(series|movie)\b/.test(c));
  try {
    const so = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    const ra = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    const f = (await a.get(`/api/search?sid=${so}&term=new`)).data; assert.equal(f.kind, 'sonarr'); assert.ok(f.folders[0].path);
    const st = (await a.post('/api/add', { sid: so, item: { title: 'New Show', tvdbId: 99 }, rootFolderPath: '/tv2', qualityProfileId: 3, monitor: 'future', seriesType: 'anime', seasonFolder: false, search: false })).status;
    assert.equal(st, 200);
    const sb = bodies().pop(); assert.ok(sb, fake.state.calls.slice(-5).join('\n'));
    for (const t of ['"monitor":"future"', '"seriesType":"anime"', '"seasonFolder":false', '"searchForMissingEpisodes":false', '"rootFolderPath":"/tv2"', '"qualityProfileId":3']) assert.ok(sb.includes(t), t + ' in ' + sb);
    assert.equal((await a.post('/api/add', { sid: ra, item: { title: 'New Movie', tmdbId: 99 }, rootFolderPath: '/movies', qualityProfileId: 2, monitor: false, minAvail: 'inCinemas' })).status, 200);
    const mb = bodies().pop();
    for (const t of ['"monitored":false', '"minimumAvailability":"inCinemas"', '"searchForMovie":false', '"monitor":"none"']) assert.ok(mb.includes(t), t + ' in ' + mb);
  } finally { await s.stop(); srv.close(); }
});

test('RSS: how often the feeds are checked, and searching one tracker', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    const q = (await a.post('/api/services', { type: 'qbittorrent', name: 'qB', url: `${fb}/qbittorrent`, user: 'u', password: 'p' })).data.id;
    assert.equal((await a.get(`/api/rss/${q}/settings`)).data.interval, 30);
    assert.equal((await a.put(`/api/rss/${q}/settings`, { interval: 10, max: 200, on: true, rules: false })).status, 200);
    const c = (await a.get(`/api/rss/${q}/settings`)).data; assert.deepEqual([c.interval, c.max, c.on, c.rules], [10, 200, true, false]);
    assert.equal((await a.put(`/api/rss/${q}/settings`, { interval: 0 })).status, 200); assert.equal((await a.get(`/api/rss/${q}/settings`)).data.interval, 30, 'nonsense falls back');
    await a.post('/api/services', { type: 'prowlarr', name: 'Prowlarr', url: `${fb}/prowlarr`, apiKey: 'k' });
    const ix = (await a.get('/api/trackers/indexers')).data; assert.ok(Array.isArray(ix));
  } finally { await s.stop(); srv.close(); }
});
