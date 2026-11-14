// A title already in the library opens its library page: /api/inlib finds it (one added here counts at once), and
// /api/library/item gives that one show or movie.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('titles in the library are found by their TMDB number, including one just added', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data;
    const sid = rad.id || (await a.get('/api/services')).data.find(x => x.type === 'radarr').id;
    const m1 = fake.state.movies[0];
    assert.deepEqual((await a.get(`/api/inlib?type=movie&id=${5000 + m1.id}`)).data, { sid, id: m1.id, kind: 'movie' });
    assert.deepEqual((await a.get('/api/inlib?type=movie&id=123456')).data, {}, 'not in the library');
    assert.deepEqual((await a.get('/api/inlib?type=tv&id=0')).data, {});
    const it = (await a.get(`/api/library/item?sid=${sid}&id=${m1.id}`)).data;
    assert.equal(it.id, m1.id); assert.equal(it.title, m1.title); assert.equal(it.tmdb, 5000 + m1.id);
    assert.equal((await a.get(`/api/library/item?sid=${sid}&id=4242`)).status, 404);
    // Added from Search: its id comes back, and it counts as in the library straight away.
    const made = (await a.post('/api/add', { sid, item: { title: 'Blue Hour', tmdbId: 6002, year: 2022 }, rootFolderPath: '/movies', qualityProfileId: 1 })).data;
    assert.deepEqual(made, { sid, id: 99 });
    assert.deepEqual((await a.get('/api/inlib?type=movie&id=6002')).data, { sid, id: 99, kind: 'movie' });
  } finally { await s.stop(); srv.close(); }
});
