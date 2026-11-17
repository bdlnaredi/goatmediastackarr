// A shared IMDb link: which title page it is, asked of Radarr and Sonarr when there is no TMDB key.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');

test('IMDb numbers are looked up in Radarr, then Sonarr', async () => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/radarr/api/v3/movie/lookup/imdb') return u.searchParams.get('imdbId') === 'tt0111161' ? j({ title: 'A Film', tmdbId: 278 }) : (res.writeHead(404), res.end('{}'));
    if (u.pathname === '/sonarr/api/v3/series/lookup') return j(u.searchParams.get('term') === 'imdb:tt0903747' ? [{ title: 'A Show', tvdbId: 81189, tmdbId: 1396 }] : []);
    j({ version: '5.0.0' });
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: url + '/radarr', apiKey: 'k' });
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: url + '/sonarr', apiKey: 'k' });
    assert.deepEqual((await a.get('/api/resolve?imdb=tt0111161')).data, { type: 'movie', id: 278 });
    assert.deepEqual((await a.get('/api/resolve?imdb=tt0903747')).data, { type: 'tv', id: 1396 });
    assert.equal((await a.get('/api/resolve?imdb=tt0000001')).status, 404);
    assert.equal((await a.get('/api/resolve?imdb=nope')).status, 400);
  } finally { await s.stop(); srv.close(); }
});
