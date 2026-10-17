// Discover lists: trending, popular and anticipated from Trakt, TMDB and TheTVDB (pretend sites here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('discover lists from the three sites', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ TRAKT_URL: fb + '/trakt', TMDB_URL: fb + '/tmdb', TVDB_URL: fb + '/tvdb' }), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.get('/api/discover?src=trakt&list=trending&kind=movie')).status, 404, 'no key yet');
    assert.deepEqual((await a.get('/api/listsettings')).data.trakt, { on: false, hint: '' });
    // keys are checked for shape, and never sent back whole
    assert.equal((await a.put('/api/listsettings', { trakt: 'no no' })).status, 400);
    const sv = await a.put('/api/listsettings', { trakt: 'trakt-client-id-1234', tmdb: 'tmdb-api-key-5678', tvdb: 'tvdb-api-key-9012' });
    assert.deepEqual(sv.data, { trakt: true, tmdb: true, tvdb: true });
    const ls = (await a.get('/api/listsettings')).data; assert.equal(ls.trakt.hint, '••••1234'); assert.ok(!JSON.stringify(ls).includes('trakt-client'));
    assert.deepEqual((await a.get('/api/me')).data.user.lists, { trakt: true, tmdb: true, tvdb: true });

    // Trakt: the three list shapes (wrapped, plain), ids kept, pictures found through TMDB
    for (const l of ['trending', 'popular', 'anticipated']) {
      const r = await a.get(`/api/discover?src=trakt&list=${l}&kind=movie`); assert.equal(r.status, 200, l);
      assert.ok(r.data.length >= 10); const x = r.data[0];
      assert.equal(x.mediaType, 'movie'); assert.ok(x.title && x.tmdb > 0 && /^tt\d+$/.test(x.imdb) && x.trakt > 0); assert.match(x.poster, /^data:image\//, 'poster came from TMDB');
    }
    const shows = (await a.get('/api/discover?src=trakt&list=trending&kind=tv')).data; assert.equal(shows[0].mediaType, 'tv'); assert.ok(shows[0].tvdb > 0);
    assert.ok(fake.state.calls.includes('trakt /movies/trending key=trakt-client-id-1234'));

    // TMDB
    for (const l of ['trending', 'popular', 'anticipated']) { const r = await a.get(`/api/discover?src=tmdb&list=${l}&kind=tv`); assert.equal(r.status, 200); assert.ok(r.data[0].tmdb > 0 && r.data[0].title && r.data[0].poster); }
    assert.ok(fake.state.calls.some(c => c.startsWith('tmdb /discover/tv') && c.endsWith('key=tmdb-api-key-5678')));

    // TheTVDB: signs in with the key, then uses the token. No trending list, no coming-soon movies.
    const tv = await a.get('/api/discover?src=tvdb&list=popular&kind=tv'); assert.equal(tv.status, 200); assert.ok(tv.data[0].tvdb > 0 && tv.data[0].poster);
    assert.equal((await a.get('/api/discover?src=tvdb&list=anticipated&kind=tv')).status, 200);
    assert.equal((await a.get('/api/discover?src=tvdb&list=popular&kind=movie')).status, 200);
    assert.equal((await a.get('/api/discover?src=tvdb&list=trending&kind=tv')).status, 400);
    assert.equal((await a.get('/api/discover?src=tvdb&list=anticipated&kind=movie')).status, 400);
    assert.equal((await a.get('/api/discover?src=nope&list=popular&kind=tv')).status, 400);

    // a wrong key gives a plain message, not a crash; removing a key turns the list off
    await a.put('/api/listsettings', { tmdb: 'wrong-key-123' });
    const w = await a.get('/api/discover?src=tmdb&list=popular&kind=movie'); assert.equal(w.status, 401); assert.match(w.data.error, /did not accept the key/);
    await a.put('/api/listsettings', { tmdb: '' });
    assert.equal((await a.get('/api/discover?src=tmdb&list=popular&kind=movie')).status, 404);
    assert.equal((await a.get('/api/me')).data.user.lists.tmdb, false);

    // only admins change keys; signed-out visitors see nothing
    await a.post('/api/users', { name: 'kid', password: 'kid-password-1', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.put('/api/listsettings', { trakt: 'something-else-1' })).status, 403);
    assert.equal((await k.get('/api/listsettings')).status, 403);
    assert.equal((await k.get('/api/discover?src=trakt&list=popular&kind=tv')).status, 200);
    assert.equal((await client(s.base).get('/api/discover?src=trakt&list=popular&kind=tv')).status, 401);
  } finally { await s.stop(); srv.close(); }
});
