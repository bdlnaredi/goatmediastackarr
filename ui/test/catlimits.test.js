// Speed limits per category: a total for the category, shared out as limits on its torrents, and taken off again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('a category limit is shared among its moving torrents, follows changes, and is taken off again', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ MONITOR_MS: '150' }), a = client(s.base); await setup(a);
  try {
    const sv = (await a.post('/api/services', { type: 'qbittorrent', name: 'qBittorrent', url: `${fb}/qbittorrent`, user: 'u', pass: 'p' })).data;
    const id = sv.id || (await a.get('/api/services')).data.find(x => x.type === 'qbittorrent').id;
    const [t1, t2, mv, sw] = fake.state.torrents;
    assert.deepEqual((await a.get(`/api/qb/${id}/catlimits`)).data.limits, {});
    // tv: 1000 KB/s down and 100 up for both of its torrents together.
    let r = await a.put(`/api/qb/${id}/catlimits`, { limits: { tv: { dl: 1000, up: 100 }, movies: { dl: 0, up: 0 }, '': { dl: 5 } } });
    assert.deepEqual(r.data.limits, { tv: { dl: 1000, up: 100 } }, 'empty limits and names left out');
    assert.equal(t1.dl_limit, 512000); assert.equal(t2.dl_limit, 512000); assert.equal(t1.up_limit, 51200);
    assert.ok(!mv.dl_limit && !sw.dl_limit, 'other categories untouched');
    // One stops moving: the other gets the whole limit.
    Object.assign(t2, { state: 'stalledDL', dlspeed: 0, upspeed: 0 });
    for (let i = 0; i < 40 && t1.dl_limit !== 1024000; i++) await sleep(100);
    assert.equal(t1.dl_limit, 1024000); assert.equal(t2.dl_limit, 1024000); assert.equal(t1.up_limit, 102400);
    // One moved to another category: its limit is taken off.
    t2.category = 'software';
    for (let i = 0; i < 40 && t2.dl_limit; i++) await sleep(100);
    assert.equal(t2.dl_limit, 0); assert.equal(t2.up_limit, 0);
    // The limit removed: the rest are freed too.
    await a.put(`/api/qb/${id}/catlimits`, { limits: {} });
    assert.equal(t1.dl_limit, 0); assert.equal(t1.up_limit, 0);
    const k = client(s.base); await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' }); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.get(`/api/qb/${id}/catlimits`)).status, 403, 'admins only');
  } finally { await s.stop(); srv.close(); }
});
