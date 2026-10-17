// A Plex profile that cannot open every Plex library never gets the apps that list whole libraries, only sees "recently added" from the libraries it may open, and can only load pictures of things it was shown.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

async function run(all, fn) {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: fb + '/plextv', PLEX_AUTH_URL: 'https://app.plex.example/auth' }), a = client(s.base); await setup(a);
  try {
    const mk = async (type, name) => (await a.post('/api/services', { type, name, url: `${fb}/${type}`, apiKey: 'k' })).data.id;
    const ids = { plex: await mk('plex', 'Plex'), sonarr: await mk('sonarr', 'Sonarr'), qb: await mk('qbittorrent', 'qBit'), seerr: await mk('seerr', 'Seerr'), tau: await mk('tautulli', 'Tautulli') };
    fake.state.pinDelay = 100; fake.state.streams = 2; fake.state.plexAll = all;
    await a.put('/api/plexsettings', { on: true, sid: ids.plex, auto: true, access: Object.values(ids), perms: { request: true } });
    const c = client(s.base), st = await c.post('/api/plexlogin/start'); let r;
    for (let i = 0; i < 30; i++) { r = await c.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(150); }
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await fn({ a, c, ids });
  } finally { await s.stop(); srv.close(); }
}

test('a library hidden in Plex is hidden here: no library apps, recent only from allowed libraries, pictures only for what was shown', () => run(false, async ({ a, c, ids }) => {
  const names = (await c.get('/api/services')).data.map(x => x.type).sort();
  assert.deepEqual(names, ['plex', 'seerr', 'tautulli'], 'Sonarr and qBittorrent are not for someone who cannot open every library');
  assert.equal((await c.get(`/api/library?sid=${ids.sonarr}`)).status, 404);
  const owner = (await a.get('/api/services')).data.map(x => x.type); assert.ok(owner.includes('sonarr') && owner.includes('qbittorrent'));
  const now = (await c.get(`/api/plex/${ids.plex}/now`)).data;
  assert.deepEqual(now.recent.map(x => x.title).sort(), ['Library 1 item', 'Library 1 scary item', 'Library 2 item', 'Library 2 scary item'], 'nothing from the hidden library');
  const shown = now.recent[0].thumb;
  assert.equal((await c.get(`/api/plex/${ids.plex}/img?p=${encodeURIComponent(shown)}`)).status, 200);
  assert.equal((await c.get(`/api/plex/${ids.plex}/img?p=${encodeURIComponent('/library/metadata/93/thumb')}`)).status, 403, 'a picture it was not shown');
  assert.equal((await a.get(`/api/plex/${ids.plex}/img?p=${encodeURIComponent('/library/metadata/93/thumb')}`)).status, 200, 'the owner is not limited');
  const u = (await a.get('/api/users')).data.find(x => x.plex); assert.deepEqual(u.libs, { n: 2, of: 3, limited: true });
}));

test('a Plex profile that can open every library keeps its apps and the normal recent list', () => run(true, async ({ c, ids }) => {
  const names = (await c.get('/api/services')).data.map(x => x.type); assert.ok(names.includes('sonarr') && names.includes('qbittorrent'));
  const now = (await c.get(`/api/plex/${ids.plex}/now`)).data; assert.ok(now.recent.length > 0);
}));

test('items hidden by genre, tag or rating are left out of a Plex profile\'s recently added, from MediaHub\'s rules or from Plex\'s own restrictions', async () => {
  const titles = async (a, hide, filter, per) => {
    const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
    await new Promise(r => srv.once('listening', r));
    const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ PLEX_TV_URL: fb + '/plextv', PLEX_AUTH_URL: 'https://app.plex.example/auth' }), ad = client(s.base); await setup(ad);
    try {
      const plex = (await ad.post('/api/services', { type: 'plex', name: 'Plex', url: fb + '/plex', apiKey: 'k' })).data.id;
      fake.state.pinDelay = 100; fake.state.plexAll = false; fake.state.plexFilter = filter || '';
      await ad.put('/api/plexsettings', { on: true, sid: plex, auto: true, access: [plex], perms: { request: true }, hide });
      const c = client(s.base), st = await c.post('/api/plexlogin/start'); let r;
      for (let i = 0; i < 30; i++) { r = await c.get('/api/plexlogin/poll?t=' + st.data.ticket); if (!r.data.pending) break; await sleep(150); }
      if (per) { const u = (await ad.get('/api/users')).data.find(x => x.plex); assert.equal((await ad.put('/api/users/' + u.id, { hide: per })).status, 200); }
      const now = (await c.get(`/api/plex/${plex}/now`)).data.recent.map(x => x.title).sort();
      const adm = (await ad.get(`/api/plex/${plex}/now`)).data.recent.length;
      return { now, adm, gs: (await ad.get('/api/plexsettings')).data.hide, u: (await ad.get('/api/users')).data.find(x => x.plex) };
    } finally { await s.stop(); srv.close(); }
  };
  const base = await titles(null, {});
  assert.equal(base.now.length, 4, 'nothing hidden: both items of the two libraries they can open');
  assert.deepEqual((await titles(null, { genre: 'Horror' })).now.filter(x => /scary/.test(x)), [], 'a genre');
  assert.deepEqual((await titles(null, { label: ['adult'] })).now.filter(x => /scary/.test(x)), [], 'a tag');
  assert.deepEqual((await titles(null, { rating: 'R, NC-17' })).now.filter(x => /scary/.test(x)), [], 'a rating');
  assert.equal((await titles(null, { genre: 'Comedy' })).now.length, 2, 'only the scary ones stay');
  assert.equal((await titles(null, {}, '', { genre: ['horror'] })).now.length, 2, 'a rule on one profile alone');
  const pl = await titles(null, {}, 'label!%3DAdult%7CcontentRating%3DPG%2CG');
  assert.equal(pl.now.filter(x => /scary/.test(x)).length, 0, 'Plex\'s own restrictions are followed too'); assert.deepEqual(pl.u.restr, { contentRating: ['PG', 'G'], 'label!': ['Adult'] });
  assert.ok(pl.adm >= 2, 'the owner still sees everything');
});
