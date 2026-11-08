// What the phone's notification buttons need: new-request items say which request, and one call pauses every client.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('request notifications carry the request id, and Pause all pauses every client', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const ids = {};
    for (const t of ['radarr', 'sonarr', 'seerr', 'qbittorrent']) ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k', username: 'u', password: 'p' })).data.id;
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam'); await a.put(`/api/users/${sam.id}/access`, { access: [ids.seerr] });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    const r = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5100, title: 'Demo movie 5100' })).data;
    assert.equal(r.status, 'pending');
    const item = (await a.get('/api/notifications')).data.items.find(x => x.kind === 'request');
    assert.equal(item.ref, r.id, 'the request it is about');
    assert.equal((await a.post(`/api/requests/${item.ref}/approve`, {})).status, 200);

    assert.deepEqual((await k.post('/api/downloads/all', { op: 'pause' })).data.done, [], 'only the clients they can reach');
    const p = (await a.post('/api/downloads/all', { op: 'pause' })).data;
    assert.deepEqual(p.done, ['qbittorrent']); assert.deepEqual(p.failed, []);
    assert.ok(fake.state.calls.some(c => /torrents\/(stop|pause).*all/.test(c)), fake.state.calls.join('\n'));
  } finally { await s.stop(); srv.close(); }
});
