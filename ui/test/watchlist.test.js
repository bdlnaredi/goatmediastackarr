// Watchlists: each person's own list, what state each title is in, the message when it lands, and asking by itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('add, list with states, remove; own list only; requested by itself when the admin wants', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '200' }), a = client(s.base); await setup(a);
  try {
    const ids = {};
    for (const t of ['radarr', 'seerr']) ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
    const kid = (await a.get('/api/users')).data.find(u => u.name === 'kid');
    await a.put(`/api/users/${kid.id}/access`, { access: Object.values(ids) });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });

    // 5001 is downloaded in the pretend Radarr; 6100 is nowhere.
    let r = await k.post('/api/watchlist', { type: 'movie', id: 5001, title: 'Glass Meridian', year: '2024' });
    assert.equal(r.status, 200); assert.equal(r.data.requested, null, 'not asked for: the admin did not turn that on');
    await k.post('/api/watchlist', { type: 'movie', id: 6100, title: 'Far Lantern' });
    await k.post('/api/watchlist', { type: 'movie', id: 6100, title: 'Far Lantern' });
    r = await k.get('/api/watchlist');
    assert.deepEqual(r.data.items.map(x => [x.id, x.inLib]), [[6100, false], [5001, true]], 'newest first, once each');
    assert.equal((await a.get('/api/watchlist')).data.items.length, 0, 'everyone has their own');
    assert.equal((await k.get('/api/title?type=movie&id=6100')).data.watch, true);
    assert.equal((await a.get('/api/title?type=movie&id=6100')).data.watch, false);
    assert.equal((await k.post('/api/watchlist', { type: 'movie', id: 0 })).status, 400);
    assert.equal((await k.put('/api/watchlist/settings', { auto: true })).status, 403, 'only admins choose');

    // The admin turns on asking by itself: a new title is requested for the kid, waiting for approval.
    assert.equal((await a.put('/api/watchlist/settings', { auto: true })).data.auto, true);
    r = await k.post('/api/watchlist', { type: 'movie', id: 6200, title: 'Next Year' });
    assert.equal(r.data.requested, 'pending');
    const rq = (await a.get('/api/requests')).data.find(x => x.mediaId === 6200);
    assert.equal(rq.user, 'kid'); assert.equal(rq.via, 'watchlist');
    assert.equal((await k.get('/api/watchlist')).data.items.find(x => x.id === 6200).request, 'pending');
    // Something already in the library is not requested.
    await k.del('/api/watchlist/movie/5001');
    r = await k.post('/api/watchlist', { type: 'movie', id: 5001, title: 'Glass Meridian' });
    assert.equal(r.data.requested, null);
    assert.ok(!(await a.get('/api/requests')).data.some(x => x.mediaId === 5001));
    await k.del('/api/watchlist/movie/6100');
    assert.deepEqual((await k.get('/api/watchlist')).data.items.map(x => x.id).sort(), [5001, 6200]);
  } finally { await s.stop(); srv.close(); }
});
