// Indexers tab: see, check, add and remove indexers in Jackett and Prowlarr (pretend apps here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('jackett and prowlarr indexers: list, check, add, remove', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({}), a = client(s.base); await setup(a);
  try {
    const jid = (await a.post('/api/services', { type: 'jackett', name: 'Jackett', url: fb + '/jackett', apiKey: 'k' })).data.id;
    const pid = (await a.post('/api/services', { type: 'prowlarr', name: 'Prowlarr', url: fb + '/prowlarr', apiKey: 'k' })).data.id;

    // Jackett: what is added, with the last error Jackett remembers
    const l = (await a.get(`/api/jackett/${jid}/indexers`)).data;
    assert.deepEqual(l.map(x => x.id), ['open-tracker', 'broken-tracker']); assert.equal(l[1].error, 'Unable to connect to the tracker'); assert.equal(l[0].type, 'public');
    assert.deepEqual((await a.post(`/api/jackett/${jid}/indexers/open-tracker/test`)).data, { id: 'open-tracker', ok: true, error: '' });
    const bt = (await a.post(`/api/jackett/${jid}/indexers/broken-tracker/test`)).data; assert.equal(bt.ok, false); assert.match(bt.error, /timeout/);
    const all = (await a.post(`/api/jackett/${jid}/indexers/all/test`)).data; assert.equal(all.length, 2); assert.equal(all.filter(x => x.ok).length, 1);

    // Jackett: add a private one. The form comes from Jackett, notes and hidden data are handled, a missing password is refused
    const cat = (await a.get(`/api/jackett/${jid}/catalog`)).data; assert.deepEqual(cat.map(x => x.id), ['club-tracker', 'night-index']);
    const f = (await a.get(`/api/jackett/${jid}/indexers/club-tracker/config`)).data;
    assert.deepEqual(f.map(x => x.id), ['username', 'password', 'freeleech', 'sort', 'info'], 'hidden data is not shown'); assert.equal(f.find(x => x.id === 'info').text, 'Needs an account on the site.'); assert.deepEqual(f.find(x => x.id === 'sort').options, [['created', 'created'], ['seeders', 'seeders']]);
    const no = await a.post(`/api/jackett/${jid}/indexers/club-tracker/config`, { values: { username: 'me', password: '' } }); assert.equal(no.status, 502); assert.match(no.data.error, /password is required/); assert.ok(!/Server error/.test(no.data.error));
    assert.equal((await a.post(`/api/jackett/${jid}/indexers/club-tracker/config`, { values: { username: 'me', password: 'pw', freeleech: true, nope: 'x' } })).status, 200);
    const sent = fake.state.calls.find(c => c.startsWith('jackett add club-tracker')); assert.ok(sent.includes('["username","me"]') && sent.includes('["password","pw"]') && sent.includes('["freeleech",true]') && sent.includes('["sitelink","https://club.example/"]'), sent);
    assert.equal((await a.get(`/api/jackett/${jid}/indexers`)).data.length, 3);
    assert.equal((await a.del(`/api/jackett/${jid}/indexers/club-tracker`)).status, 200); assert.equal((await a.get(`/api/jackett/${jid}/indexers`)).data.length, 2);

    // Prowlarr: catalog, form (advanced and hidden fields left out), add, refused add, forced add, remove
    const pc = (await a.get(`/api/prowlarr/${pid}/catalog`)).data; assert.deepEqual(pc.map(x => x.id), ['club-tracker', 'night-index', 'open-tracker']); assert.equal(pc[0].type, 'private');
    const pf = (await a.get(`/api/prowlarr/${pid}/catalog/club-tracker/fields`)).data; assert.deepEqual(pf.fields.map(x => x.id), ['baseUrl', 'username', 'password', 'freeleech']);
    assert.deepEqual(pf.fields[0].options, [['https://club.example/', 'https://club.example/'], ['https://club-mirror.example/', 'https://club-mirror.example/']], 'Base URL lists the site addresses');
    assert.equal(pf.fields[0].value, 'https://club.example/'); assert.equal(pf.fields[2].type, 'password'); assert.match(pf.fields[3].help, /ratio/);
    assert.deepEqual((await a.get(`/api/prowlarr/${pid}/catalog/open-tracker/fields`)).data.fields[0].options.length, 2);
    assert.equal((await a.get(`/api/prowlarr/${pid}/catalog/nope/fields`)).status, 404);
    const before = (await a.get(`/api/prowlarr/${pid}/indexers`)).data.indexers.length;
    const bad = await a.post(`/api/prowlarr/${pid}/indexers`, { def: 'club-tracker', name: 'My club', values: { username: 'me', password: '' } }); assert.equal(bad.status, 502); assert.match(bad.data.error, /Password is required/);
    const ok = await a.post(`/api/prowlarr/${pid}/indexers`, { def: 'club-tracker', name: 'My club', values: { username: 'me', password: '' }, force: true }); assert.equal(ok.status, 200); assert.ok(ok.data.id > 0);
    assert.ok(fake.state.calls.includes('prowlarr add My club forced'));
    const after = (await a.get(`/api/prowlarr/${pid}/indexers`)).data.indexers; assert.equal(after.length, before + 1); assert.ok(after.some(x => x.name === 'My club'));
    assert.equal((await a.del(`/api/prowlarr/${pid}/indexers/${ok.data.id}`)).status, 200); assert.equal((await a.get(`/api/prowlarr/${pid}/indexers`)).data.indexers.length, before);

    // a non-admin with access to Jackett may look and check, but not add or remove; Prowlarr stays admin only
    await a.post('/api/users', { name: 'kid', password: 'kid-password-1', role: 'user' });
    const kid = (await a.get('/api/users')).data.find(u => u.name === 'kid'); await a.put(`/api/users/${kid.id}/access`, { access: [jid, pid] });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get(`/api/jackett/${jid}/indexers`)).status, 200);
    assert.equal((await k.post(`/api/jackett/${jid}/indexers/open-tracker/test`)).status, 200);
    for (const [fn, u, b] of [['get', `/api/jackett/${jid}/catalog`], ['get', `/api/jackett/${jid}/indexers/club-tracker/config`], ['post', `/api/jackett/${jid}/indexers/club-tracker/config`, { values: {} }], ['del', `/api/jackett/${jid}/indexers/open-tracker`],
      ['get', `/api/prowlarr/${pid}/catalog`], ['post', `/api/prowlarr/${pid}/indexers`, { def: 'open-tracker' }], ['del', `/api/prowlarr/${pid}/indexers/1`]]) assert.equal((await k[fn](u, b)).status, 403, u);
    assert.equal((await client(s.base).get(`/api/jackett/${jid}/indexers`)).status, 401);
  } finally { await s.stop(); srv.close(); }
});

test('jackett whose settings door answers 400: list and checks still work, adding explains itself', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  fake.state.jackettSettingsBroken = true;
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({}), a = client(s.base); await setup(a);
  try {
    const jid = (await a.post('/api/services', { type: 'jackett', name: 'Jackett', url: fb + '/jackett', apiKey: 'k' })).data.id;
    const l = (await a.get(`/api/jackett/${jid}/indexers`)).data;
    assert.deepEqual(l.map(x => [x.id, x.name, x.type, x.language, x.site]), [['open-tracker', 'Open Tracker', 'public', 'en-US', 'https://open.example/'], ['broken-tracker', 'Broken Tracker', 'public', 'en-US', 'https://broken.example/']]);
    assert.deepEqual((await a.post(`/api/jackett/${jid}/indexers/open-tracker/test`)).data, { id: 'open-tracker', ok: true, error: '' });
    const bt = (await a.post(`/api/jackett/${jid}/indexers/broken-tracker/test`)).data; assert.equal(bt.ok, false); assert.match(bt.error, /timeout/);
    assert.equal((await a.post(`/api/jackett/${jid}/indexers/all/test`)).data.filter(x => x.ok).length, 1);
    assert.deepEqual((await a.get(`/api/jackett/${jid}/catalog`)).data.map(x => x.id), ['club-tracker', 'night-index']);
    const c = await a.get(`/api/jackett/${jid}/indexers/club-tracker/config`); assert.equal(c.status, 502); assert.match(c.data.error, /Jackett's own page/); assert.ok(!/Server error/.test(c.data.error));
    // a wrong key says so, plainly
    const bad = (await a.post('/api/services', { type: 'jackett', name: 'J2', url: fb + '/jackett', apiKey: 'wrong' })).data.id;
    const w = await a.get(`/api/jackett/${bad}/indexers`); assert.equal(w.status, 502); assert.match(w.data.error, /API key|list of indexers/);
  } finally { await s.stop(); srv.close(); }
});

test('jackett with an admin password: adding works once the password is saved in the app', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  fake.state.jackettAdminPass = 'hunter22';
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({}), a = client(s.base); await setup(a);
  try {
    const no = (await a.post('/api/services', { type: 'jackett', name: 'NoPw', url: fb + '/jackett', apiKey: 'k' })).data.id;
    const wrong = (await a.post('/api/services', { type: 'jackett', name: 'Wrong', url: fb + '/jackett', apiKey: 'k', pass: 'nope' })).data.id;
    const yes = (await a.post('/api/services', { type: 'jackett', name: 'Yes', url: fb + '/jackett', apiKey: 'k', pass: 'hunter22' })).data.id;
    // list and checks do not need the password
    assert.equal((await a.get(`/api/jackett/${no}/indexers`)).data.length, 2);
    // adding says what to do
    const n = await a.get(`/api/jackett/${no}/indexers/club-tracker/config`); assert.equal(n.status, 502); assert.match(n.data.error, /admin password/);
    const w = await a.get(`/api/jackett/${wrong}/indexers/club-tracker/config`); assert.equal(w.status, 502); assert.match(w.data.error, /did not accept the admin password/);
    const f = await a.get(`/api/jackett/${yes}/indexers/club-tracker/config`); assert.equal(f.status, 200); assert.ok(f.data.some(x => x.id === 'password'));
    assert.equal((await a.post(`/api/jackett/${yes}/indexers/club-tracker/config`, { values: { username: 'me', password: 'pw' } })).status, 200);
    assert.equal((await a.get(`/api/jackett/${yes}/catalog`)).data.map(x => x.id).join(), 'night-index');
    assert.equal((await a.del(`/api/jackett/${yes}/indexers/club-tracker`)).status, 200);
  } finally { await s.stop(); srv.close(); }
});
