// Asking for one episode of a show that is already in Sonarr: waits for approval, then is monitored and searched for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('single-episode requests', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' });
    const seerr = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: `${fb}/seerr`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam');
    await a.put(`/api/users/${sam.id}/access`, { access: [seerr] });
    const u = client(s.base); await u.post('/api/login', { name: 'sam', password: 'samsamsam' });

    // The show (TMDB 7001) is in Sonarr; season 2 from episode 6 is missing. Sam has no Sonarr access, and needs none.
    let eps = (await u.get('/api/title/episodes?id=7001')).data;
    const e6 = eps.find(x => x.season === 2 && x.num === 6);
    assert.equal(e6.has, false); assert.equal(e6.asked, false);
    assert.equal((await u.get('/api/title/episodes?id=6100')).status, 404);
    assert.equal((await u.post('/api/requests/episode', { tmdb: 7001, season: 1, episode: 1 })).status, 400, 'already here');
    assert.equal((await u.post('/api/requests/episode', { tmdb: 7001, season: 9, episode: 1 })).status, 404);
    assert.equal((await u.post('/api/requests/episode', { tmdb: 6100, season: 1, episode: 1 })).status, 404, 'show not in Sonarr');

    let r = await u.post('/api/requests/episode', { tmdb: 7001, season: 2, episode: 6 });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'pending'); assert.match(r.data.title, /S02E06$/);
    assert.equal((await u.post('/api/requests/episode', { tmdb: 7001, season: 2, episode: 6 })).status, 400, 'once');
    assert.equal((await u.get('/api/title/episodes?id=7001')).data.find(x => x.season === 2 && x.num === 6).asked, true);

    // The admin approves: the episode is monitored in Sonarr.
    await a.post('/api/monitor', { sid: (await a.get('/api/services')).data.find(x => x.type === 'sonarr').id, kind: 'episodes', ids: [1206], monitored: false });
    r = await a.post(`/api/requests/${r.data.id}/approve`);
    assert.equal(r.status, 200); assert.equal(r.data.status, 'approved');
    assert.equal((await u.get('/api/title/episodes?id=7001')).data.find(x => x.season === 2 && x.num === 6).monitored, true);

    // Request limits count episodes too.
    await a.put(`/api/users/${sam.id}`, { reqLimit: { n: 1, days: 7 } });
    assert.equal((await u.post('/api/requests/episode', { tmdb: 7001, season: 2, episode: 7 })).status, 429);
  } finally { await s.stop(); srv.close(); }
});
