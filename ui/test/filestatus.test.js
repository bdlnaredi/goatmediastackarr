// The popup for a movie or episode says whether the file is there (quality, size, name) or not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('file status for a movie and an episode', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({}), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: fb + '/radarr', apiKey: 'k' })).data.id;
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: fb + '/sonarr', apiKey: 'k' })).data.id;
    const movies = (await a.get('/api/library?sid=' + rad)).data, have = movies.find(x => x.have), none = movies.find(x => !x.have);
    const f = (await a.get(`/api/filestatus?sid=${rad}&id=${have.id}`)).data;
    assert.equal(f.kind, 'movie'); assert.equal(f.have, true); assert.equal(f.file.quality, 'WEBDL-1080p'); assert.ok(f.file.size > 0); assert.match(f.file.name, /\.mkv$/); assert.deepEqual(f.file.langs, ['English']);
    assert.deepEqual(f.ids, { type: 'movie', imdb: 'tt' + (1000000 + have.id), tmdb: 5000 + have.id, tvdb: 0 });
    const g = (await a.get(`/api/filestatus?sid=${rad}&id=${none.id}`)).data; assert.equal(g.have, false); assert.equal(g.file, null);
    const sr = (await a.get('/api/library?sid=' + son)).data[0], eps = (await a.get(`/api/series/${son}/${sr.id}`)).data.episodes;
    const ye = (await a.get(`/api/filestatus?sid=${son}&id=${eps.find(e => e.has).id}`)).data, ne = (await a.get(`/api/filestatus?sid=${son}&id=${eps.find(e => !e.has).id}`)).data;
    assert.equal(ye.kind, 'episode'); assert.equal(ye.have, true); assert.ok(ye.file.name); assert.equal(ne.have, false);
    assert.equal(ye.ids.type, 'tv'); assert.match(ye.ids.imdb, /^tt\d+$/); assert.ok(ye.ids.tvdb > 0 && ye.ids.tmdb > 0);
    assert.equal((await a.get(`/api/series/${son}/${sr.id}`)).data.ids.type, 'tv');
    assert.equal((await a.get(`/api/filestatus?sid=${rad}&id=abc`)).status, 404);
    assert.equal((await client(s.base).get(`/api/filestatus?sid=${rad}&id=1`)).status, 401);
  } finally { await s.stop(); srv.close(); }
});
