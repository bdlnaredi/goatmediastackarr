// Kids profiles (only what is here and rated for their age, no finding or asking for new things) and invite links.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

const fakeApps = async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  return { srv, fb: `http://127.0.0.1:${srv.address().port}` };
};

test('a kids profile sees only titles rated for its age', async () => {
  const { srv, fb } = await fakeApps();
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const ids = {};
    for (const t of ['radarr', 'sonarr', 'seerr']) ids[t] = (await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' });
    const kid = (await a.get('/api/users')).data.find(u => u.name === 'kid');
    await a.put(`/api/users/${kid.id}/access`, { access: Object.values(ids) });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.get(`/api/library?sid=${ids.radarr}`)).data.length, 6, 'not a kids profile yet: everything');

    let r = await a.put(`/api/users/${kid.id}`, { kids: { age: 7 } });
    assert.deepEqual(r.data.kids, { age: 7 });
    assert.equal((await a.put(`/api/users/${(await a.get('/api/users')).data.find(u => u.name === 'admin').id}`, { kids: { age: 7 } })).status, 400, 'admins cannot be kids');

    // G and PG movies only (PG counts as 7); TV-Y7, TV-PG and TV-G shows only.
    assert.deepEqual((await k.get(`/api/library?sid=${ids.radarr}`)).data.map(x => x.cert).sort(), ['G', 'PG']);
    assert.deepEqual((await k.get(`/api/library?sid=${ids.sonarr}`)).data.map(x => x.cert).sort(), ['TV-G', 'TV-PG', 'TV-Y7']);
    const art = (await k.get('/api/artwork')).data;
    assert.ok([...art.wall, ...art.recent].every(x => ['G', 'PG', 'TV-G', 'TV-PG', 'TV-Y7'].includes(x.cert)), 'the dashboard pictures too');
    assert.equal((await a.get(`/api/library?sid=${ids.radarr}`)).data.length, 6, 'the admin still sees everything');

    // The title page: 5001 is rated G and here, 5002 is PG-13, 6100 is not here at all.
    assert.equal((await k.get('/api/title?type=movie&id=5001')).status, 200);
    assert.equal((await k.get('/api/title?type=movie&id=5002')).status, 404);
    assert.equal((await k.get('/api/title?type=movie&id=6100')).status, 404);
    // A collection lists only the parts they may see.
    r = await k.get('/api/collection?id=10');
    assert.deepEqual(r.data.parts.map(x => x.id), [5001]);

    // No searching, discovering or asking.
    assert.equal((await k.get(`/api/seerr/search?sid=${ids.seerr}&q=glass`)).status, 403);
    assert.equal((await k.get('/api/discover?src=tmdb&list=trending&kind=movie')).status, 403);
    assert.equal((await k.post('/api/requests', { sid: ids.seerr, mediaType: 'movie', mediaId: 6100, title: 'Far' })).status, 403);

    // Older: PG-13 shows up.
    await a.put(`/api/users/${kid.id}`, { kids: { age: 13 } });
    assert.equal((await k.get('/api/title?type=movie&id=5002')).status, 200);
    // Off again: everything.
    await a.put(`/api/users/${kid.id}`, { kids: null });
    assert.equal((await k.get(`/api/library?sid=${ids.radarr}`)).data.length, 6);
    assert.equal((await a.get('/api/users')).data.find(u => u.name === 'kid').kids, null);
  } finally { await s.stop(); srv.close(); }
});

test('invite links make a profile with the chosen settings, then run out', async () => {
  const { srv, fb } = await fakeApps();
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    const anon = client(s.base);
    assert.equal((await anon.post('/api/invites', { label: 'x' })).status, 401, 'only signed in admins make invites');
    const x = (await a.post('/api/invites', { label: 'Family', days: 7, max: 1, access: [sid, 'nope'], perms: { add: false, control: false, remove: false, request: true }, kids: { age: 10 } })).data;
    assert.ok(x.code && x.code.length >= 20); assert.deepEqual(x.access, [sid]); assert.equal(x.live, true);
    assert.ok(!(await a.get('/api/invites')).data[0].code, 'the code is shown only once');

    let r = await anon.get('/api/invite/' + x.code);
    assert.equal(r.status, 200); assert.equal(r.data.label, 'Family'); assert.equal(r.data.by, 'admin');
    assert.equal((await anon.get('/api/invite/' + 'a'.repeat(24))).status, 404);
    assert.equal((await anon.post('/api/invite/' + x.code, { name: 'admin', password: 'longenough' })).status, 400, 'names are unique');
    assert.equal((await anon.post('/api/invite/' + x.code, { name: 'Nana', password: 'short' })).status, 400);

    const n = client(s.base);
    r = await n.post('/api/invite/' + x.code, { name: 'Nana', password: 'longenough', email: 'nana@example.com' });
    assert.equal(r.status, 200); assert.equal(r.data.user.name, 'Nana'); assert.deepEqual(r.data.user.kids, { age: 10 });
    const me = (await n.get('/api/me')).data.user;
    assert.equal(me.role, 'user'); assert.deepEqual(me.access, [sid]); assert.equal(me.perms.add, false);
    // Used up: one person only.
    assert.equal((await client(s.base).post('/api/invite/' + x.code, { name: 'Other', password: 'longenough' })).status, 404);
    const l = (await a.get('/api/invites')).data[0];
    assert.equal(l.used, 1); assert.deepEqual(l.people, ['Nana']); assert.equal(l.live, false);
    // Removed: the link stops; the profile stays.
    assert.equal((await a.del('/api/invites/' + l.id)).status, 200);
    assert.equal((await a.get('/api/invites')).data.length, 0);
    assert.ok((await a.get('/api/users')).data.some(u => u.name === 'Nana'));
  } finally { await s.stop(); srv.close(); }
});
