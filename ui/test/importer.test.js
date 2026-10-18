// Importing an existing stack: everything copied once, folders translated, old apps only read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), path = require('node:path');
const importer = require('../lib/importer');
const { tmp, boot, client, setup, sleep } = require('./helpers');

function fakeArr(ver, key, data) {
  const st = { posts: [], writesToOld: 0, ...JSON.parse(JSON.stringify(data)) };
  const srv = http.createServer(async (req, res) => {
    if (req.headers['x-api-key'] !== key) { res.writeHead(401); return res.end(); }
    const p = new URL(req.url, 'http://x').pathname.replace(`/api/${ver}/`, '');
    const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET') return st[p] ? json(200, st[p]) : json(404, { message: 'nope' });
    let b = ''; for await (const c of req) b += c; b = JSON.parse(b);
    st.writesToOld++; st.posts.push({ p, b, method: req.method });
    // Like the real apps: a profile must list every custom format there is.
    if (/^qualityprofile/.test(p) && st.customformat) {
      const ids = (b.formatItems || []).map(i => i.format).sort().join(), want = st.customformat.map(f => f.id).sort().join();
      if (ids !== want) return json(400, [{ errorMessage: 'All Custom Formats and no extra ones need to be included' }]);
    }
    if (req.method === 'PUT') {
      const [k, id] = p.split('/'), list = st[k] || [], i = list.findIndex(x => String(x.id) === id);
      if (i < 0) return json(404, {});
      list[i] = { ...b, id: Number(id) }; return json(202, list[i]);
    }
    if (b.title === 'Broken Show') return json(400, [{ errorMessage: 'Path does not exist' }]);
    (st[p] = st[p] || []).push({ id: st[p].length + 100, ...b });
    json(201, b);
  });
  return { srv, st, listen: () => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`))) };
}

test('folders are translated by the longest matching prefix', () => {
  const m = [['/tv', '/media/tv'], ['/tv/anime', '/media/anime'], ['/movies/', '/media/movies']];
  assert.equal(importer.mapPath('/tv/Show A', m), '/media/tv/Show A');
  assert.equal(importer.mapPath('/tv/anime/One', m), '/media/anime/One');
  assert.equal(importer.mapPath('/movies/Film (2001)', m), '/media/movies/Film (2001)');
  assert.equal(importer.mapPath('/tvshows/X', m), null, 'a similar name is not a match');
  assert.equal(importer.mapPath('/elsewhere/X', m), null);
});

test('Sonarr: new shows added once with mapped folders, profiles matched by name, failures reported', async () => {
  const old = fakeArr('v3', 'oldkey', {
    series: [
      { id: 1, title: 'Show A', tvdbId: 11, path: '/tv/Show A', rootFolderPath: '/tv/', monitored: true, qualityProfileId: 7, seasonFolder: true, seriesType: 'standard', seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }] },
      { id: 2, title: 'Show B', tvdbId: 22, path: '/tv/Show B', rootFolderPath: '/tv/', monitored: false, qualityProfileId: 8, seasons: [] },
      { id: 3, title: 'Broken Show', tvdbId: 33, path: '/tv/Broken', rootFolderPath: '/tv/', monitored: true, qualityProfileId: 7, seasons: [] },
      { id: 4, title: 'Already Here', tvdbId: 44, path: '/tv/Already', rootFolderPath: '/tv/', monitored: true, qualityProfileId: 7, seasons: [] }],
    rootfolder: [{ path: '/tv/' }], qualityprofile: [{ id: 7, name: 'HD-1080p' }, { id: 8, name: 'Old Only' }] });
  const neu = fakeArr('v3', 'newkey', {
    series: [{ id: 9, title: 'Already Here', tvdbId: 44 }], rootfolder: [{ path: '/media/tv' }], qualityprofile: [{ id: 1, name: 'Any' }, { id: 4, name: 'HD-1080p' }] });
  const [ou, nu] = [await old.listen(), await neu.listen()];
  try {
    const from = { url: ou, apiKey: 'oldkey' }, to = { url: nu, apiKey: 'newkey' };
    const pl = await importer.plan('sonarr', from, to);
    assert.equal(pl.total, 4); assert.equal(pl.already, 1); assert.equal(pl.todo, 3);
    assert.deepEqual(pl.roots, ['/tv/']); assert.deepEqual(pl.profiles, { 'HD-1080p': 'HD-1080p', 'Old Only': 'Any' });
    const steps = [];
    const r = await importer.run('sonarr', from, to, [['/tv/', '/media/tv']], x => steps.push(x.done));
    assert.equal(r.added, 2); assert.equal(r.skipped, 1); assert.equal(r.failed.length, 1);
    assert.match(r.failed[0].error, /Path does not exist/);
    assert.deepEqual(steps, [1, 2, 3, 4]);
    const a = neu.st.posts.find(x => x.b.tvdbId === 11).b;
    assert.equal(a.path, '/media/tv/Show A'); assert.equal(a.rootFolderPath, '/media/tv'); assert.equal(a.qualityProfileId, 4);
    assert.deepEqual(a.seasons, [{ seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }]);
    assert.equal(a.addOptions.searchForMissingEpisodes, false, 'nothing is searched for');
    assert.equal(neu.st.posts.find(x => x.b.tvdbId === 22).b.qualityProfileId, 1, 'unknown profile falls back to the first one');
    assert.equal(neu.st.posts.find(x => x.b.tvdbId === 22).b.monitored, false);
    assert.equal(old.st.writesToOld, 0, 'the old app is only read');
    // Running again adds nothing new.
    const r2 = await importer.run('sonarr', from, to, [['/tv/', '/media/tv']]);
    assert.equal(r2.added, 0); assert.equal(r2.skipped, 3);
  } finally { old.srv.close(); neu.srv.close(); }
});

test('Radarr, Lidarr and Prowlarr', async () => {
  const pairs = {
    radarr: [fakeArr('v3', 'o', { movie: [{ id: 1, title: 'Film', tmdbId: 5, year: 2001, path: '/movies/Film (2001)', monitored: true, qualityProfileId: 2, minimumAvailability: 'announced' }], rootfolder: [{ path: '/movies' }], qualityprofile: [{ id: 2, name: 'Any' }] }),
             fakeArr('v3', 'n', { movie: [], rootfolder: [{ path: '/media/movies' }], qualityprofile: [{ id: 3, name: 'Any' }] })],
    lidarr: [fakeArr('v1', 'o', { artist: [{ id: 1, artistName: 'Band', foreignArtistId: 'mb-1', path: '/music/Band', monitored: true, qualityProfileId: 1 }], rootfolder: [{ path: '/music' }], qualityprofile: [{ id: 1, name: 'Lossless' }] }),
             fakeArr('v1', 'n', { artist: [], rootfolder: [{ path: '/media/music' }], qualityprofile: [{ id: 2, name: 'Lossless' }], metadataprofile: [{ id: 6, name: 'Standard' }] })],
    prowlarr: [fakeArr('v1', 'o', { indexer: [{ id: 1, name: 'SiteA', implementation: 'Cardigann', appProfileId: 9, fields: [{ name: 'apiKey', value: 'k' }], tags: [3] }, { id: 2, name: 'SiteB', implementation: 'Torznab', appProfileId: 9, fields: [] }] }),
               fakeArr('v1', 'n', { indexer: [{ id: 5, name: 'SiteB' }], appprofile: [{ id: 1, name: 'Standard' }] })],
  };
  const urls = {};
  for (const [k, [o, n]] of Object.entries(pairs)) urls[k] = [await o.listen(), await n.listen()];
  try {
    const go = (k, map) => importer.run(k, { url: urls[k][0], apiKey: 'o' }, { url: urls[k][1], apiKey: 'n' }, map);
    let r = await go('radarr', [['/movies', '/media/movies']]);
    assert.equal(r.added, 1);
    const m = pairs.radarr[1].st.posts[0].b;
    assert.equal(m.path, '/media/movies/Film (2001)'); assert.equal(m.qualityProfileId, 3); assert.equal(m.minimumAvailability, 'announced'); assert.equal(m.addOptions.searchForMovie, false);
    r = await go('lidarr', [['/music', '/media/music']]);
    assert.equal(r.added, 1);
    const l = pairs.lidarr[1].st.posts[0].b;
    assert.equal(l.path, '/media/music/Band'); assert.equal(l.metadataProfileId, 6); assert.equal(l.qualityProfileId, 2); assert.equal(l.addOptions.searchForMissingAlbums, false);
    r = await go('prowlarr', []);
    assert.equal(r.added, 1); assert.equal(r.skipped, 1);
    const ix = pairs.prowlarr[1].st.posts[0].b;
    assert.equal(ix.name, 'SiteA'); assert.equal(ix.appProfileId, 1); assert.deepEqual(ix.tags, []); assert.equal(ix.id, undefined);
    assert.equal(ix.fields[0].value, 'k');
  } finally { for (const [o, n] of Object.values(pairs)) { o.srv.close(); n.srv.close(); } }
});

test('import from the Stack page: check, start, follow progress', async () => {
  const old = fakeArr('v3', 'oldkey-123456', { series: [{ id: 1, title: 'Show A', tvdbId: 11, path: '/tv/Show A', rootFolderPath: '/tv', monitored: true, qualityProfileId: 1, seasons: [] }], rootfolder: [{ path: '/tv' }], qualityprofile: [{ id: 1, name: 'Any' }] });
  const neu = fakeArr('v3', 'newkey', { series: [], rootfolder: [{ path: '/media/tv' }], qualityprofile: [{ id: 1, name: 'Any' }] });
  const [ou, nu] = [await old.listen(), await neu.listen()];
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [{ key: 'sonarr', type: 'sonarr', name: 'Sonarr', url: nu, apiKey: 'newkey' }] }));
  const s = await boot({ GOAT_MANAGED: mf }, dir);
  try {
    const c = client(s.base); await setup(c);
    assert.equal((await c.post('/api/goat/import/check', { kind: 'sonarr', url: 'not a url', apiKey: 'oldkey-123456' })).status, 400);
    assert.equal((await c.post('/api/goat/import/check', { kind: 'radarr', url: ou, apiKey: 'oldkey-123456' })).status, 400, 'no built-in Radarr here');
    let r = await c.post('/api/goat/import/check', { kind: 'sonarr', url: ou, apiKey: 'oldkey-123456' });
    assert.equal(r.status, 200); assert.equal(r.data.todo, 1); assert.deepEqual(r.data.suggest, [['/tv', '/media/tv']]);
    assert.equal((await c.post('/api/goat/import/check', { kind: 'sonarr', url: ou, apiKey: 'wrongkey-12345' })).status, 502);
    r = await c.post('/api/goat/import/start', { kind: 'sonarr', url: ou, apiKey: 'oldkey-123456', map: r.data.suggest });
    assert.equal(r.status, 200);
    let j; for (let i = 0; i < 50; i++) { j = (await c.get('/api/goat/import')).data; if (j.state !== 'running') break; await sleep(100); }
    assert.equal(j.state, 'done'); assert.equal(j.added, 1);
    assert.equal(neu.st.posts[0].b.path, '/media/tv/Show A');
  } finally { await s.stop(); old.srv.close(); neu.srv.close(); }
});

test('quality profiles and custom formats come first, with scores following each format by name', async () => {
  const old = fakeArr('v3', 'oldkey-123456', {
    series: [{ id: 1, title: 'Show A', tvdbId: 11, path: '/tv/Show A', rootFolderPath: '/tv', monitored: true, qualityProfileId: 5, seasons: [] }],
    rootfolder: [{ path: '/tv' }],
    customformat: [{ id: 3, name: 'x265', includeCustomFormatWhenRenaming: false, specifications: [{ name: 'x265', implementation: 'ReleaseTitleSpecification', fields: [{ name: 'value', value: 'x265' }] }] },
                   { id: 4, name: 'Bad Groups', includeCustomFormatWhenRenaming: false, specifications: [{ name: 'g', implementation: 'ReleaseGroupSpecification', fields: [{ name: 'value', value: 'BAD' }] }] }],
    qualityprofile: [{ id: 5, name: 'My 4K', upgradeAllowed: true, cutoff: 19, minFormatScore: 10, items: [{ quality: { id: 19, name: 'Bluray-2160p' }, allowed: true }], formatItems: [{ format: 3, name: 'x265', score: 50 }, { format: 4, name: 'Bad Groups', score: -1000 }] },
                     { id: 6, name: 'Any', upgradeAllowed: false, cutoff: 1, items: [], formatItems: [{ format: 3, name: 'x265', score: 5 }] }] });
  const neu = fakeArr('v3', 'newkey-123456', {
    series: [], rootfolder: [{ path: '/media/tv' }],
    customformat: [{ id: 1, name: 'Bad Groups', includeCustomFormatWhenRenaming: false, specifications: [] }],
    qualityprofile: [{ id: 1, name: 'Any', upgradeAllowed: true, cutoff: 4, items: [], formatItems: [{ format: 1, name: 'Bad Groups', score: 0 }] }] });
  const [ou, nu] = [await old.listen(), await neu.listen()];
  try {
    const from = { url: ou, apiKey: 'oldkey-123456' }, to = { url: nu, apiKey: 'newkey-123456' };
    const pl = await importer.plan('sonarr', from, to);
    assert.deepEqual(pl.settings, { profiles: ['My 4K', 'Any'], formats: 2 });
    const phases = [];
    const r = await importer.run('sonarr', from, to, [['/tv', '/media/tv']], x => x.phase && phases.push(x.phase), { settings: true });
    assert.deepEqual(r.failed, []);
    assert.deepEqual(phases.slice(0, 2), ['profiles', 'items'], 'profiles before the shows');
    assert.deepEqual(r.settings, { formats: { added: 1, updated: 1 }, profiles: { added: 1, updated: 1 } });
    const cf = Object.fromEntries(neu.st.customformat.map(f => [f.name, f]));
    assert.equal(cf['Bad Groups'].id, 1, 'the existing one is replaced in place');
    assert.equal(cf['Bad Groups'].specifications[0].fields[0].value, 'BAD');
    const q = Object.fromEntries(neu.st.qualityprofile.map(x => [x.name, x]));
    const sc = p => Object.fromEntries(p.formatItems.map(i => [i.name, [i.format, i.score]]));
    assert.deepEqual(sc(q['My 4K']), { 'Bad Groups': [1, -1000], x265: [cf.x265.id, 50] }, 'scores follow the format by name, with the new ids');
    assert.equal(q['My 4K'].minFormatScore, 10); assert.equal(q['My 4K'].cutoff, 19);
    assert.equal(q.Any.id, 1); assert.equal(q.Any.upgradeAllowed, false, 'a profile with the same name is replaced by yours');
    assert.deepEqual(sc(q.Any), { 'Bad Groups': [1, 0], x265: [cf.x265.id, 5] });
    assert.equal(neu.st.posts.find(x => x.p === 'series').b.qualityProfileId, q['My 4K'].id, 'the show keeps its own profile');
    assert.equal(old.st.writesToOld, 0, 'the old app is only read');
    // Again: nothing to change in the custom formats, profiles written again, no duplicates.
    const r2 = await importer.run('sonarr', from, to, [['/tv', '/media/tv']], () => {}, { settings: true });
    assert.deepEqual(r2.settings.formats, { added: 0, updated: 0 });
    assert.equal(neu.st.qualityprofile.length, 2); assert.equal(neu.st.customformat.length, 2);
  } finally { old.srv.close(); neu.srv.close(); }
});

test('an app version without custom formats still gets its profiles', async () => {
  const old = fakeArr('v1', 'oldkey-123456', { artist: [], rootfolder: [{ path: '/music' }], qualityprofile: [{ id: 2, name: 'Lossless', cutoff: 7, items: [] }] });
  const neu = fakeArr('v1', 'newkey-123456', { artist: [], rootfolder: [{ path: '/media/music' }], qualityprofile: [{ id: 1, name: 'Any', items: [] }], metadataprofile: [{ id: 1, name: 'Standard' }] });
  const [ou, nu] = [await old.listen(), await neu.listen()];
  try {
    const r = await importer.run('lidarr', { url: ou, apiKey: 'oldkey-123456' }, { url: nu, apiKey: 'newkey-123456' }, [['/music', '/media/music']], () => {}, { settings: true });
    assert.deepEqual(r.settings.profiles, { added: 1, updated: 0 });
    assert.deepEqual(neu.st.qualityprofile.map(x => x.name), ['Any', 'Lossless']);
  } finally { old.srv.close(); neu.srv.close(); }
});
