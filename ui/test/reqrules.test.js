// Request rules and the size estimate: what goes through without an admin, and how big a request will be.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('request rules approve by rating and size, and the estimate shows first', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const ids = {};
    for (const t of ['radarr', 'sonarr', 'seerr']) ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam'); await a.put(`/api/users/${sam.id}/access`, { access: Object.values(ids) });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });

    // The estimate: 118 minutes at HD-1080p (about 25 MB a minute), no rule yet so an admin decides.
    let e = (await k.get('/api/request/estimate?type=movie&id=5100')).data;
    assert.ok(e.bytes > 2.5e9 && e.bytes < 3.5e9, 'about 3 GB: ' + e.bytes); assert.equal(e.minutes, 118); assert.equal(e.approve, 'admin');
    const tv = (await k.get('/api/request/estimate?type=tv&id=900&seasons=1')).data;
    assert.equal(tv.episodes, 8); assert.equal(tv.minutes, 8 * 44);
    assert.equal((await k.get('/api/request/estimate?type=tv&id=900')).data.episodes, 24, 'every season when none are picked');

    assert.equal((await k.put('/api/reqrules', { rules: [] })).status, 403, 'admins only');
    const put = await a.put('/api/reqrules', { rules: [{ name: 'Good small films', kind: 'movie', minRating: 7, maxGb: 5, users: [] }, { name: 'Junk', kind: 'nope', minRating: 99, maxGb: -3, users: ['nobody'] }] });
    assert.equal(put.status, 200); assert.equal(put.data.rules.length, 2);
    assert.deepEqual([put.data.rules[1].kind, put.data.rules[1].minRating, put.data.rules[1].maxGb, put.data.rules[1].users], ['any', 10, 0, []], 'cleaned up');
    await a.put('/api/reqrules', { rules: [put.data.rules[0]] });

    e = (await k.get('/api/request/estimate?type=movie&id=5100')).data;
    assert.equal(e.approve, 'rule'); assert.equal(e.rule, 'Good small films');
    const r1 = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5100, title: 'Demo movie 5100' })).data;
    assert.equal(r1.status, 'approved'); assert.equal(r1.rule, 'Good small films'); assert.ok(r1.est > 2.5e9);
    // A show does not fit a movies-only rule, and a rule for someone else does not count.
    const r2 = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'tv', mediaId: 900, title: 'Demo show', seasons: [1] })).data;
    assert.equal(r2.status, 'pending'); assert.ok(r2.est > 8e9);
    await a.put('/api/reqrules', { rules: [{ name: 'Only Ann', kind: 'any', users: [(await a.get('/api/users')).data.find(u => u.name !== 'sam').id] }] });
    assert.equal((await k.get('/api/request/estimate?type=movie&id=5101')).data.approve, 'admin');
    // Limits show in the estimate too.
    await a.put(`/api/users/${sam.id}`, { reqLimit: { n: 5, days: 7 } });
    e = (await k.get('/api/request/estimate?type=movie&id=5101')).data; assert.equal(e.left, 3); assert.equal(e.days, 7);
    assert.equal((await a.get('/api/request/estimate?type=movie&id=5101')).data.approve, 'you');
  } finally { await s.stop(); srv.close(); }
});
