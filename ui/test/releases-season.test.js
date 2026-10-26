// Interactive search for a whole season asks Sonarr for season packs; one episode or a movie as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('releases for a season, an episode and a movie', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    let r = await a.get(`/api/releases?sid=${son}&id=1&season=2`); assert.equal(r.status, 200); assert.ok(r.data.length > 0);
    assert.equal(fake.state.lastRelease, 'seriesId=1&seasonNumber=2');
    await a.get(`/api/releases?sid=${son}&id=1206`); assert.equal(fake.state.lastRelease, 'episodeId=1206');
    await a.get(`/api/releases?sid=${son}&id=1&season=0`); assert.equal(fake.state.lastRelease, 'seriesId=1&seasonNumber=0', 'specials too');
    await a.get(`/api/releases?sid=${rad}&id=3&season=2`); assert.equal(fake.state.lastRelease, 'movieId=3', 'a season means nothing for a movie');
  } finally { await s.stop(); srv.close(); }
});
