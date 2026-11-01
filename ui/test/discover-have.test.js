// Discover marks what is already here: available on Plex (Seerr), downloaded or added in Sonarr/Radarr, or requested.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('discover lists say what is available or requested', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ TRAKT_URL: fb + '/trakt', TMDB_URL: fb + '/tmdb', TVDB_URL: fb + '/tvdb', SEERR_MEDIA_MS: '1' }), a = client(s.base); await setup(a);
  try {
    await a.put('/api/listsettings', { trakt: 'trakt-client-id-1234', tmdb: 'tmdb-api-key-5678' });
    const seerr = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' })).data.id;
    let l = (await a.get('/api/discover?src=trakt&list=trending&kind=movie')).data;
    assert.ok(l.length >= 4); assert.ok(l.every(x => !x.available), 'nothing here yet');
    // On Plex (through Seerr), partly there, asked for in Seerr, and asked for here.
    fake.state.seerrMedia = [{ tmdbId: l[0].tmdb, mediaType: 'movie', status: 5 }, { tmdbId: l[1].tmdb, mediaType: 'movie', status: 3 }];
    await a.post('/api/requests', { sid: seerr, mediaType: 'movie', mediaId: l[2].tmdb, title: l[2].title });
    // A movie Radarr has (with its file), by the same TMDB number.
    fake.state.movies[0].id = l[3].tmdb - 5000;   // the pretend Radarr's TMDB number is 5000 + its id
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    await a.get('/api/discover?src=trakt&list=trending&kind=movie'); await new Promise(r => setTimeout(r, 300));   // the library list is fetched again in the background
    l = (await a.get('/api/discover?src=trakt&list=trending&kind=movie')).data;
    assert.equal(l[0].available, 5, 'on Plex'); assert.equal(l[1].available, 2, 'being processed in Seerr'); assert.equal(l[2].available, 2, 'asked for here');
    assert.equal(l[3].available, fake.state.movies[0].sizeOnDisk > 0 ? 5 : 2, 'in Radarr'); assert.deepEqual(l[3].lib, { sid: l[3].lib.sid, id: fake.state.movies[0].id });
  } finally { await s.stop(); srv.close(); }
});
