// Watch together: a party for a title on Plex, the invited hear about it, and the page shows who is watching it now.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('a watch party invites people and shows who is watching', async () => {
  const fake = fakes.create({ streams: 3 }), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `http://127.0.0.1:${srv.address().port}/plex`, apiKey: 'k' })).data.id;
    for (const n of ['alex', 'jo']) { const u = (await a.post('/api/users', { name: n, password: 'password-' + n, role: 'user' })).data; await a.put(`/api/users/${u.id}/access`, { access: [sid] }); }
    const alex = client(s.base), jo = client(s.base);
    await alex.post('/api/login', { name: 'alex', password: 'password-alex' }); await jo.post('/api/login', { name: 'jo', password: 'password-jo' });

    const people = (await alex.get(`/api/party/people?sid=${sid}`)).data.people.map(x => x.name);
    assert.ok(people.includes('jo') && !people.includes('alex'), people.join());
    const joId = (await alex.get(`/api/party/people?sid=${sid}`)).data.people.find(x => x.name === 'jo').id;
    assert.equal((await alex.post('/api/party', { sid, key: '1', title: 'x' })).status, 400, 'someone has to be invited');

    // alex watches the first show's episode (the pretend Plex says so) and invites jo to it.
    const show = fake.state.shows[0].title;
    const id = (await alex.post('/api/party', { sid, key: '77', kind: 'episode', title: show, sub: 'S01E02 Demo episode', at: Date.now(), invite: [joId] })).data.id;
    assert.match(id, /^[a-f0-9]{12}$/);
    const n = (await jo.get('/api/notifications')).data.items[0];
    assert.equal(n.kind, 'party'); assert.equal(n.link, 'party:' + id); assert.match(n.title, /^alex invited you to watch/);
    assert.deepEqual((await jo.get('/api/party')).data.parties.map(x => x.id), [id]);

    const v = (await jo.get('/api/party/' + id)).data;
    assert.equal(v.app, 'plex'); assert.equal(v.hostName, 'alex'); assert.equal(v.key, '77'); assert.ok(v.machine, 'the Plex server is named, for the Open in Plex link');
    const host = v.people.find(x => x.name === 'alex'), j = v.people.find(x => x.name === 'jo');
    assert.ok(host.host && host.watching && host.offset > 0, JSON.stringify(host));
    assert.ok(!j.watching && j.behind === null);

    // Not for anyone else; only the host (or an admin) calls it off.
    { const u = (await a.post('/api/users', { name: 'kim', password: 'password-kim', role: 'user' })).data; await a.put(`/api/users/${u.id}/access`, { access: [sid] }); }
    const kim = client(s.base); await kim.post('/api/login', { name: 'kim', password: 'password-kim' });
    assert.equal((await kim.get('/api/party/' + id)).status, 404);
    await jo.del('/api/party/' + id); assert.equal((await jo.get('/api/party/' + id)).status, 200, 'a guest cannot call it off');
    assert.equal((await alex.del('/api/party/' + id)).status, 200);
    assert.equal((await jo.get('/api/party/' + id)).status, 404);
  } finally { await s.stop(); srv.close(); }
});
