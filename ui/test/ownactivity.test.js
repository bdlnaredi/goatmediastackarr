// A profile made through "Sign in with Plex" only sees its own streams and its own watch history, never other people's or the server's recently added list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('Plex profiles see only their own viewing on Plex, Jellyfin and Tautulli', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: fb + '/plextv', PLEX_AUTH_URL: 'https://app.plex.example/auth' }), a = client(s.base); await setup(a);
  try {
    const mk = async (type, name) => (await a.post('/api/services', { type, name, url: `${fb}/${type}`, apiKey: 'k' })).data.id;
    const plex = await mk('plex', 'Plex'), tau = await mk('tautulli', 'Tautulli'), jf = await mk('jellyfin', 'Jellyfin');
    fake.state.pinDelay = 100; fake.state.streams = 3;
    await a.put('/api/plexsettings', { on: true, sid: plex, auto: true, access: [plex, tau, jf], perms: { request: true } });
    const c = client(s.base), st = await c.post('/api/plexlogin/start'); let r;
    for (let i = 0; i < 30; i++) { r = await c.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(150); }
    assert.equal(r.status, 200, JSON.stringify(r.data));

    const all = (await a.get(`/api/plex/${plex}/now`)).data, mine = (await c.get(`/api/plex/${plex}/now`)).data;
    assert.ok(all.sessions.length > mine.sessions.length && mine.sessions.length > 0, 'the owner sees every stream, the profile only its own');
    assert.ok(mine.sessions.every(x => x.user === 'alex'));
    assert.ok(all.recent.length > 0); assert.ok(mine.recent.every(x => x.title !== 'Library 3 item'), 'never from a library hidden from them');
    const j = (await c.get(`/api/jellyfin/${jf}/now`)).data;
    assert.deepEqual(j.sessions, [], 'someone else on Jellyfin is not shown'); assert.deepEqual(j.recent, []);
    assert.ok((await a.get(`/api/jellyfin/${jf}/now`)).data.sessions.length > 0);

    const sa = (await a.get(`/api/tautulli/${tau}/stats`)).data, sm = (await c.get(`/api/tautulli/${tau}/stats`)).data;
    assert.ok(sa.history.some(x => x.user !== 'Alex') && sa.users.length > 1, 'the owner sees everyone');
    assert.equal(sm.own, true); assert.ok(sm.history.length > 0 && sm.history.every(x => x.user === 'Alex'), 'only their own history');
    assert.deepEqual(sm.users.map(x => x.title), ['Alex']);
  } finally { await s.stop(); srv.close(); }
});

test('"recently added" on Plex: everything from the last 7 days, or at least 10 items', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({}), a = client(s.base); await setup(a);
  try {
    const plex = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: fb + '/plex', apiKey: 'k' })).data.id;
    assert.equal((await a.get(`/api/plex/${plex}/now`)).data.recent.length, 10, 'only 3 are this week, so the newest 10');
    fake.state.fresh = 15;
    assert.equal((await a.get(`/api/plex/${plex}/now`)).data.recent.length, 15, 'more than 10 this week: all of them');
    fake.state.fresh = 24;
    assert.equal((await a.get(`/api/plex/${plex}/now`)).data.recent.length, 24);
  } finally { await s.stop(); srv.close(); }
});
