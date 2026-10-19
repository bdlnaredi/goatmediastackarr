// "Sign in with Plex": people from your Plex server get a regular profile through Plex's own sign-in window.
// plex.tv and the Plex server are pretend (lib/demo.js), so these prove MediaHub's own checks, not that the real plex.tv answers identically.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

async function world() {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: fb + '/plextv', PLEX_AUTH_URL: 'https://app.plex.example/auth' }), a = client(s.base); await setup(a);
  const plex = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: fb + '/plex', apiKey: 'k' })).data.id;
  const seerr = (await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: fb + '/seerr', apiKey: 'k' })).data.id;
  fake.state.pinDelay = 300;
  return { s, a, fake, plex, seerr, stop: async () => { await s.stop(); srv.close(); } };
}
// Runs the whole popup dance the way the page does and returns the signed-in client (or the refusal).
async function plexSignIn(w) {
  const c = client(w.s.base), st = await c.post('/api/plexlogin/start');
  if (st.status !== 200) return { c, st };
  let r; for (let i = 0; i < 30; i++) { r = await c.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(200); }
  return { c, st, r };
}

test('sign in with Plex: off by default, then people with access get a regular profile; others are refused', async () => {
  const w = await world();
  try {
    const { a } = w;
    assert.equal((await client(w.s.base).get('/api/me')).data.plexLogin, false);
    assert.equal((await client(w.s.base).post('/api/plexlogin/start')).status, 403, 'off means off');
    assert.equal((await a.put('/api/plexsettings', { on: true, sid: w.plex, auto: true, access: [w.seerr], perms: { request: true } })).status, 200);
    assert.equal((await client(w.s.base).get('/api/me')).data.plexLogin, true);

    const one = await plexSignIn(w);
    assert.match(one.st.data.url, /^https:\/\/app\.plex\.example\/auth#\?clientID=[0-9a-f]{32}&code=DEMO\d+/, 'the sign-in window address carries our id and the pin');
    assert.equal(one.r.status, 200, JSON.stringify(one.r.data)); assert.equal(one.r.data.user.name, 'alex'); assert.equal(one.r.data.user.role, 'user');
    const me = (await one.c.get('/api/me')).data.user;
    assert.equal(me.plex.name, 'alex'); assert.deepEqual(me.access, [w.seerr]); assert.equal(me.perms.request, true); assert.equal(me.perms.add, false); assert.equal(me.perms.remove, false);
    assert.equal((await one.c.get('/api/plexsettings')).status, 403, 'a Plex profile is not an admin');
    assert.equal((await client(w.s.base).post('/api/login', { name: 'alex', password: 'anything-at-all' })).status, 401, 'no password sign-in for Plex profiles');

    const again = await plexSignIn(w); assert.equal(again.r.data.user.id, me.id, 'the same Plex person gets the same profile');
    assert.equal((await a.get('/api/users')).data.filter(u => u.plex).length, 1);

    w.fake.state.plexWho = 'mallory'; w.fake.state.plexNoAccess = true;
    const no = await plexSignIn(w); assert.equal(no.r.status, 403); assert.match(no.r.data.error, /does not have access/);
    assert.equal((await a.get('/api/users')).data.some(u => u.name === 'mallory'), false, 'no profile for people without access');

    assert.equal((await client(w.s.base).get('/api/plexlogin/poll?t=nope')).status, 410);
    assert.equal((await client(w.s.base).get('/api/plexlogin/poll')).status, 410);
    assert.ok(!JSON.stringify((await a.get('/api/audit')).data).includes('plex-token'), 'the Plex token never reaches the log');
  } finally { await w.stop(); }
});

test('sign in with Plex: only people you added, admins never, and name clashes', async () => {
  const w = await world();
  try {
    const { a } = w;
    await a.put('/api/plexsettings', { on: true, sid: w.plex, auto: false });
    w.fake.state.plexWho = 'bob';
    const closed = await plexSignIn(w); assert.equal(closed.r.status, 403); assert.match(closed.r.data.error, /not added you yet.*"bob"/);
    const u = (await a.post('/api/users', { name: 'Bobby', password: 'password-1234', role: 'user' })).data;
    const id = (await a.get('/api/users')).data.find(x => x.name === 'Bobby').id;
    assert.equal((await a.put('/api/users/' + id, { plexName: 'Bob' })).status, 200, 'matched without regard to capital letters');
    const ok = await plexSignIn(w); assert.equal(ok.r.status, 200, JSON.stringify(ok.r.data)); assert.equal(ok.r.data.user.id, id, 'linked to the profile you made');
    const admin = (await a.get('/api/users')).data.find(x => x.role === 'admin');
    assert.equal((await a.put('/api/users/' + admin.id, { plexName: 'admin-on-plex' })).status, 400, 'admins cannot be tied to a Plex name');
    await a.put('/api/plexsettings', { on: true, sid: w.plex, auto: true });
    await a.post('/api/users', { name: 'carol', password: 'password-1234', role: 'user' });
    w.fake.state.plexWho = 'carol'; const clash = await plexSignIn(w);
    assert.equal(clash.r.status, 200); assert.equal(clash.r.data.user.name, 'carol (Plex)', 'never takes over an existing profile by name');
    assert.equal((await client(w.s.base).post('/api/login', { name: 'carol', password: 'password-1234' })).status, 200, 'the original carol still works with her password');
    assert.equal((await a.put('/api/plexsettings', { on: true, sid: w.plex, auto: false })).status, 200);
    assert.equal((await client(w.s.base).put('/api/plexsettings', { on: false })).status, 401);
  } finally { await w.stop(); }
});

test('sign in with Plex for admins: only after they link their own Plex account, and they can unlink it', async () => {
  const w = await world();
  try {
    const { a } = w;
    await a.put('/api/plexsettings', { on: true, sid: w.plex, auto: false });
    const before = await plexSignIn(w); assert.notEqual(before.r.status, 200, 'not linked yet: refused');
    const st = await a.post('/api/plexlogin/start', { link: true }); assert.equal(st.status, 200);
    let r; for (let i = 0; i < 30; i++) { r = await a.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(200); }
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.linked, true); assert.equal(r.data.name, 'alex'); assert.equal(r.data.user.role, 'admin');
    assert.equal((await a.get('/api/me')).data.user.plex.name, 'alex');
    const now = await plexSignIn(w); assert.equal(now.r.status, 200, JSON.stringify(now.r.data)); assert.equal(now.r.data.user.role, 'admin', 'the admin signs in with Plex');
    assert.equal((await now.c.get('/api/plexsettings')).status, 200);
    assert.equal((await a.del('/api/me/plex')).status, 200);
    assert.equal((await a.get('/api/me')).data.user.plex, null);
    const after = await plexSignIn(w); assert.notEqual(after.r.status, 200, 'unlinked: refused again');
  } finally { await w.stop(); }
});
