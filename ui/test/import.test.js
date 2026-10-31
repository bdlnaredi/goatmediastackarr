// Finished downloads into the library: by themselves when Sonarr or Radarr clearly knows what they are, by hand otherwise.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('importing finished downloads: automatic when clear, by hand with choices, admins only', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '250' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 8000) => { const t = Date.now(); while (!(await f())) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
  const st = fake.state, imports = () => st.imports || [];
  try {
    const qbid = (await a.post('/api/services', { type: 'qbittorrent', name: 'qB', url: `${fb}/qbittorrent`, user: 'u', pass: 'p' })).data.id;
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    // Old finished downloads are left alone; one that finishes now, and is clearly an episode, is imported by itself.
    await wait(async () => (await a.get('/api/import/settings')).data.on);
    const now = Math.floor(Date.now() / 1000) + 30, mk = (hash, name, category) => ({ hash, name, size: 1e9, progress: 1, category, tags: '', state: 'stalledUP', dlspeed: 0, upspeed: 0, eta: 0, ratio: 0, num_seeds: 1, num_leechs: 0, added_on: now - 100, completion_on: now, save_path: '/downloads', amount_left: 0, uploaded: 0, downloaded: 1e9, priority: 0, tracker: '', seeding_time: 0 });
    st.torrents.push(mk('a'.repeat(40), 'Harbor.Lights.S01E02.1080p.WEB', 'tv'), mk('b'.repeat(40), 'Unknown.Thing.2025.1080p', 'movies'));
    const ok1 = await wait(async () => imports().length >= 1); assert.ok(ok1, 'imported by itself ' + JSON.stringify((await a.get('/api/import/settings')).data) + JSON.stringify(st.calls.filter(c => /manualimport|queue/.test(c)).slice(-4)));
    const cmd = imports()[0];
    assert.equal(cmd.importMode, 'copy', 'a torrent keeps seeding'); assert.equal(cmd.files[0].seriesId, st.shows.find(x => x.title === 'Harbor Lights').id); assert.ok(cmd.files[0].episodeIds.length === 1);
    assert.ok(!imports().some(c => JSON.stringify(c).includes('Glass.Meridian')), 'downloads that finished before are left alone');
    assert.ok(await wait(async () => (await a.get('/api/import/settings')).data.recent.some(x => x.state === 'needs' && /Unknown\.Thing/.test(x.name))), 'the unclear one waits for you');

    // By hand: what Sonarr and Radarr see, then import it as a chosen movie.
    let r = await a.get(`/api/import/look?qb=${qbid}&hash=${'b'.repeat(40)}`);
    assert.equal(r.status, 200); assert.equal(r.data.apps[0].type, 'radarr', 'the category says movies, so Radarr first');
    assert.equal(r.data.apps[0].files[0].match, null); assert.deepEqual(r.data.apps[0].files[0].why, ['Unknown Movie']);
    const f = r.data.apps[0].files[0];
    r = await a.post('/api/import', { sid: rad, hash: 'b'.repeat(40), name: 'Unknown.Thing', mode: 'move', files: [{ path: f.path, id: 3, quality: f.quality, languages: f.languages }] });
    assert.equal(r.status, 200); const last = imports().slice(-1)[0];
    assert.equal(last.importMode, 'move'); assert.equal(last.files[0].movieId, 3);
    // A show by season and episode number.
    r = await a.post('/api/import', { sid: son, files: [{ path: '/downloads/x/x.mkv', id: st.shows[0].id, season: 1, episode: 1, quality: f.quality }] });
    assert.equal(r.status, 200); assert.equal(imports().slice(-1)[0].files[0].episodeIds.length, 1);
    assert.equal((await a.post('/api/import', { sid: son, files: [{ path: '/downloads/x.mkv', id: st.shows[0].id, season: 99, episode: 1 }] })).status, 400);
    assert.equal((await a.post('/api/import', { sid: rad, files: [{ path: 'relative.mkv', id: 3 }] })).status, 400);
    await a.post('/api/users', { name: 'u', password: 'useruser1', role: 'user' });
    const u = client(s.base); await u.post('/api/login', { name: 'u', password: 'useruser1' });
    assert.equal((await u.get(`/api/import/look?qb=${qbid}&hash=${'b'.repeat(40)}`)).status, 403);
  } finally { await s.stop(); srv.close(); }
});
