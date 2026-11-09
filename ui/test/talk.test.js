// Conversations on requests and problem reports, and reporting a problem with anything in the library.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('requests and reports: both sides write, each hears about the other', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    const ids = {}; for (const t of ['radarr', 'sonarr', 'seerr']) ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const sam = (await a.get('/api/users')).data.find(u => u.name === 'sam'); await a.put(`/api/users/${sam.id}/access`, { access: [ids.seerr, ids.radarr] });
    await a.post('/api/users', { name: 'jo', password: 'jojojojo1', role: 'user' });
    const k = client(s.base), j = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' }); await j.post('/api/login', { name: 'jo', password: 'jojojojo1' });
    const rq = (await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 5100, title: 'Demo movie 5100' })).data;

    assert.equal((await k.post(`/api/requests/${rq.id}/messages`, { text: '  ' })).status, 400);
    assert.equal((await k.post(`/api/requests/${rq.id}/messages`, { text: 'Could you get the 4K one?' })).data.msgs.length, 1);
    assert.ok((await a.get('/api/notifications')).data.items.some(x => x.title === 'sam wrote about Demo movie 5100'), 'the admins hear');
    const back = (await a.post(`/api/requests/${rq.id}/messages`, { text: 'Sure, it is on its way.' })).data.msgs;
    assert.deepEqual(back.map(x => [x.user, x.admin]), [['sam', false], ['admin', true]]);
    assert.ok((await k.get('/api/notifications')).data.items.some(x => x.title === 'admin wrote about Demo movie 5100' && /on its way/.test(x.body)), 'and they hear back');
    assert.equal((await k.get('/api/requests')).data.find(x => x.id === rq.id).msgs.length, 2, 'the conversation comes with the request');
    assert.equal((await j.post(`/api/requests/${rq.id}/messages`, { text: 'me too' })).status, 404, 'not for someone else');

    // A problem with something in the library, not a request; done, then opened again when they write.
    const rp = (await k.post('/api/reports', { title: 'Old Film (1999)', text: 'No sound after 20 minutes', sid: ids.radarr, key: '12', kind: 'movie' })).data;
    assert.equal(rp.status, 'open');
    assert.equal((await k.post('/api/reports', { title: 'Old Film (1999)', text: 'again' })).status, 400, 'once while open');
    assert.ok((await a.get('/api/notifications')).data.items.some(x => x.title === 'Problem report' && /No sound/.test(x.body)));
    await a.post(`/api/reports/${rp.id}/resolve`);
    await a.post(`/api/reports/${rp.id}/messages`, { text: 'Replaced the file, try now.' });
    const re = (await k.post(`/api/reports/${rp.id}/messages`, { text: 'Still no sound.' })).data;
    assert.equal(re.status, 'open', 'writing again opens it again');
    assert.equal((await j.get('/api/reports')).data.length, 0, 'others do not see it');
  } finally { await s.stop(); srv.close(); }
});
