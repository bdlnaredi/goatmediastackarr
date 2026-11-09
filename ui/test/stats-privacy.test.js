// Only admins see everyone's viewing. Others see their own, plus the server's most watched titles and viewers counted
// in the libraries they can open, never a title hidden from them. Upcoming leaves out what is already downloaded well.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('stats and year in review: own numbers, server tops only from their libraries, hidden labels left out', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: fb + '/plextv', PLEX_AUTH_URL: 'https://app.plex.example/auth' }), a = client(s.base); await setup(a);
  try {
    const mk = async (type, name) => (await a.post('/api/services', { type, name, url: `${fb}/${type}`, apiKey: 'k' })).data.id;
    const plex = await mk('plex', 'Plex'), tau = await mk('tautulli', 'Tautulli');
    fake.state.pinDelay = 100;
    await a.put('/api/plexsettings', { on: true, sid: plex, auto: true, access: [plex, tau], perms: { request: true } });
    // Alex signs in with Plex: libraries 1 and 2 are theirs, 3 ("Private") is not.
    const c = client(s.base), st = await c.post('/api/plexlogin/start'); let r;
    for (let i = 0; i < 30; i++) { r = await c.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(150); }
    assert.equal(r.status, 200, JSON.stringify(r.data));

    const all = (await a.get(`/api/tautulli/${tau}/stats`)).data;
    assert.ok(all.movies.some(x => x.title === 'Library 3 item') && all.users.length === 3, 'the admin sees the whole server');
    assert.equal(all.server, undefined);

    let me = (await c.get(`/api/tautulli/${tau}/stats`)).data;
    assert.equal(me.own, true); assert.deepEqual(me.users.map(x => x.title), ['Alex']);
    assert.ok(me.history.every(x => x.user === 'Alex'));
    assert.ok(me.server.movies.length > 0 && !me.server.movies.some(x => x.title === 'Library 3 item'), 'server tops only from libraries they can open');
    assert.deepEqual(me.server.users.map(x => x.title).sort(), ['Alex', 'Sam'], 'viewers counted in their libraries only');
    assert.ok(me.server.movies.some(x => x.title === 'Midnight Cellar') && me.history.some(x => x.title === 'Midnight Cellar'), 'not hidden yet');

    // The admin hides the Adult label from them: gone from the server tops and their own lists, still counted in their totals.
    const alex = (await a.get('/api/users')).data.find(u => u.plex);
    await a.put(`/api/users/${alex.id}`, { hide: { label: 'Adult' } });
    me = (await c.get(`/api/tautulli/${tau}/stats`)).data;
    assert.ok(!JSON.stringify(me).includes('Midnight Cellar'), 'a hidden label is never shown');
    assert.ok(me.users[0].plays >= 3, 'their own plays still count');

    // A local account (not Plex) with Tautulli: their own numbers, never everyone's.
    await a.post('/api/users', { name: 'jo', password: 'jojojojo1', role: 'user' });
    const jo = (await a.get('/api/users')).data.find(u => u.name === 'jo');
    await a.put(`/api/users/${jo.id}/access`, { access: [tau] });
    const j = client(s.base); await j.post('/api/login', { name: 'jo', password: 'jojojojo1' });
    const js = (await j.get(`/api/tautulli/${tau}/stats`)).data;
    assert.equal(js.own, true); assert.ok(js.history.length > 0 && js.history.every(x => x.user === 'Jo'), 'only their own history');
    assert.deepEqual(js.server.movies, [], 'no Plex access: no titles from its libraries');

    // Year in review: their own year, with hidden titles left out of the lists.
    const y = new Date().getMonth() >= 10 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    assert.equal((await c.get(`/api/wrapped?year=${y}&uid=all`)).status, 403, 'not everyone\'s');
    fake.state.movies[0].title = 'Midnight Cellar';
    const w = (await c.get(`/api/wrapped?year=${y}`)).data;
    assert.ok(w.watch, JSON.stringify(w)); assert.equal(w.watch.people, undefined);
    assert.ok(w.watch.topMovies.length > 0 && !w.watch.topMovies.some(x => /Midnight Cellar/.test(x.title)), 'a hidden title is left out of their year');
    assert.ok(w.watch.movies > w.watch.topMovies.reduce((n, x) => n + x.plays, 0) - 1, 'but still counted in their totals');
    const aw = (await a.get(`/api/wrapped?year=${y}&uid=${alex.id}`)).data;
    assert.ok(!aw.watch.topMovies.some(x => /Midnight Cellar/.test(x.title)), 'the same when the admin looks at their year');
  } finally { await s.stop(); srv.close(); }
});

test('upcoming leaves out what is already downloaded in the quality it should be', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    for (const t of ['sonarr', 'radarr']) await a.post('/api/services', { type: t, name: t, url: `${fb}/${t}`, apiKey: 'k' });
    const before = (await a.get('/api/upcoming')).data.calendar;
    const eps = fake.state.shows.flatMap(x => x.eps).filter(e => { const t = Date.parse(e.airDateUtc); return t > Date.now() - 864e5 && t < Date.now() + 14 * 864e5; });
    assert.ok(eps.length >= 2, 'the demo has episodes coming up');
    Object.assign(eps[0], { hasFile: true, episodeFile: { qualityCutoffNotMet: false } });   // got it, good enough
    Object.assign(eps[1], { hasFile: true, episodeFile: { qualityCutoffNotMet: true } });    // got it, still upgrading
    const after = (await a.get('/api/upcoming')).data.calendar, has = e => after.some(x => x.id === e.id && x.date === e.airDateUtc);
    assert.ok(!has(eps[0]), 'downloaded in the wanted quality: gone'); assert.ok(has(eps[1]), 'still waiting for a better copy: kept');
    assert.equal(after.length, before.length - 1);
  } finally { await s.stop(); srv.close(); }
});
