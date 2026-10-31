// Library extras: where files are saved, deleting files, Radarr/Sonarr links and "More from" a studio or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('file paths, deleting files and more from a studio', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' });
    const lib = (await a.get(`/api/library?sid=${rad}`)).data, mv = lib.find(x => x.have);
    assert.ok(mv.folder.startsWith('/movies/')); assert.ok(mv.slug);
    let r = await a.get(`/api/filestatus?sid=${rad}&id=${mv.id}`);
    assert.match(r.data.file.path, /^\/movies\/.+\.mkv$/); assert.ok(r.data.file.id > 0);
    // Users cannot delete files; admins can, and the movie stays in the library.
    await a.post('/api/users', { name: 'u', password: 'useruser1', role: 'user' });
    const u = client(s.base); await u.post('/api/login', { name: 'u', password: 'useruser1' });
    assert.equal((await u.del(`/api/files?sid=${rad}&kind=movie&id=${mv.id}`)).status, 403);
    r = await a.del(`/api/files?sid=${rad}&kind=movie&id=${mv.id}`);
    assert.equal(r.status, 200); assert.equal(r.data.deleted, 1);
    assert.equal((await a.del(`/api/files?sid=${rad}&kind=movie&id=${mv.id}`)).status, 404, 'nothing left to delete');
    assert.equal((await a.del(`/api/files?sid=${rad}&kind=episode&id=1`)).status, 400, 'episodes are in Sonarr');

    // A show: its folder, each episode's file, and deleting a whole season.
    const sh = (await a.get(`/api/library?sid=${son}`)).data.find(x => x.have > 0);
    const d = (await a.get(`/api/series/${son}/${sh.id}`)).data;
    assert.ok(d.folder.startsWith('/tv/')); const ep = d.episodes.find(e => e.has);
    assert.match(ep.path, /\.mkv$/); assert.ok(ep.fileId > 0);
    const n = d.episodes.filter(e => e.has && e.season === ep.season).length;
    r = await a.del(`/api/files?sid=${son}&kind=season&id=${sh.id}&season=${ep.season}`);
    assert.equal(r.data.deleted, n);
    assert.ok(!(await a.get(`/api/series/${son}/${sh.id}`)).data.episodes.some(e => e.has && e.season === ep.season));

    // More from the studio of a movie.
    const t = (await a.get('/api/title?type=movie&id=5001')).data;
    assert.deepEqual(t.maker, { id: 420, name: 'Demo Pictures', kind: 'studio' });
    r = await a.get('/api/maker?type=movie&id=420&not=5001');
    assert.equal(r.status, 200); assert.ok(r.data.length >= 3); assert.ok(!r.data.some(x => x.id === 5001));
    r = await a.get('/api/maker?type=tv&id=49');
    assert.ok(r.data.every(x => x.type === 'tv'));
  } finally { await s.stop(); srv.close(); }
});

test('requests follow the folder that holds the library', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ SEERR_DIR_MS: '300' }), a = client(s.base); await setup(a);
  try {
    for (const t of ['radarr', 'sonarr', 'seerr']) await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' });
    for (let i = 0; i < 40 && !(fake.state.seerrSettings && fake.state.seerrSettings.radarr.activeDirectory === '/movies' && fake.state.seerrSettings.sonarr.activeDirectory !== '/media/tv'); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(fake.state.seerrSettings.radarr.activeDirectory, '/movies', 'most movies live in /movies, not the empty /media/movies');
    assert.equal(fake.state.seerrSettings.sonarr.activeDirectory, '/tv');
    assert.ok((await a.get('/api/audit')).data.some(e => e.action === 'Request folder changed'));
  } finally { await s.stop(); srv.close(); }
});
