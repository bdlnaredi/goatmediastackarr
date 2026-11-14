// Duplicate copies: a second video in a movie's folder (offered for removal), the one Radarr knows (never), and the
// same movie in two Radarrs (removed through the Radarr chosen).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('extra copies are found and only those can be removed', async () => {
  const f1 = fakes.create(), f2 = fakes.create();
  const s1 = http.createServer((q, r) => f1.handle(q, r, q.url)).listen(0), s2 = http.createServer((q, r) => f2.handle(q, r, q.url)).listen(0);
  await Promise.all([s1, s2].map(x => new Promise(r => x.once('listening', r))));
  const dir = tmp(), mv = path.join(dir, 'movies', 'Glass Meridian (2024)'); fs.mkdirSync(path.join(mv, 'Featurettes'), { recursive: true });
  const big = (f, mb) => { fs.writeFileSync(f, ''); fs.truncateSync(f, mb * 1024 * 1024); };
  big(path.join(mv, 'Glass.Meridian.2024.2160p.mkv'), 400);          // the one Radarr knows
  big(path.join(mv, 'Glass.Meridian.2024.720p.mkv'), 300);           // an old copy
  big(path.join(mv, 'Glass.Meridian.sample.mkv'), 200);              // a sample: not a copy
  big(path.join(mv, 'Featurettes', 'Making.of.mkv'), 300);           // extras: not a copy
  fs.writeFileSync(path.join(mv, 'small.mkv'), 'x');                  // too small to be a copy
  const m = f1.state.movies[0]; Object.assign(m, { hasFile: true, path: mv, movieFile: { id: 701, relativePath: 'Glass.Meridian.2024.2160p.mkv', path: path.join(mv, 'Glass.Meridian.2024.2160p.mkv'), size: 400 * 1048576, quality: { quality: { name: 'Bluray-2160p' } } } });
  const m2 = f2.state.movies[0]; Object.assign(m2, { hasFile: true, path: '/nowhere/x', movieFile: { id: 801, relativePath: 'x.mkv', path: '/nowhere/x/x.mkv', size: 9e9, quality: { quality: { name: 'WEBDL-1080p' } } } });
  f1.state.movies.slice(1).forEach(x => { x.hasFile = false; }); f2.state.movies.slice(1).forEach(x => { x.hasFile = false; });
  const s = await boot({}, dir), a = client(s.base); await setup(a);
  try {
    const r1 = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `http://127.0.0.1:${s1.address().port}/radarr`, apiKey: 'k' })).data;
    const r2 = (await a.post('/api/services', { type: 'radarr', name: 'Radarr 4K', url: `http://127.0.0.1:${s2.address().port}/radarr`, apiKey: 'k' })).data;
    await a.post('/api/dupes/scan', {});
    let d; for (let i = 0; i < 50; i++) { d = (await a.get('/api/dupes')).data; if (!d.running && d.at) break; await sleep(100); }
    const g = d.groups.find(x => x.kind === 'movie'), tw = d.groups.find(x => x.kind === 'twice');
    assert.ok(g, JSON.stringify(d)); assert.equal(g.files.length, 2, 'samples, extras and small files are not copies');
    assert.equal(g.files.find(f => f.tracked).path, path.join(mv, 'Glass.Meridian.2024.2160p.mkv'));
    assert.equal(g.extra, 300 * 1048576);
    assert.ok(tw, 'the same movie in two Radarrs'); assert.deepEqual(tw.files.map(f => f.app).sort(), ['Radarr', 'Radarr 4K']);
    // The file Radarr knows cannot be removed this way; the old copy can.
    assert.equal((await a.post('/api/dupes/remove', { path: path.join(mv, 'Glass.Meridian.2024.2160p.mkv') })).status, 400);
    assert.equal((await a.post('/api/dupes/remove', { path: '/etc/passwd' })).status, 400);
    assert.equal((await a.post('/api/dupes/remove', { path: path.join(mv, 'Glass.Meridian.2024.720p.mkv') })).status, 200);
    assert.ok(!fs.existsSync(path.join(mv, 'Glass.Meridian.2024.720p.mkv'))); assert.ok(fs.existsSync(path.join(mv, 'Glass.Meridian.2024.2160p.mkv')));
    // In two Radarrs: removed through the one chosen.
    const pick = tw.files.find(f => f.app === 'Radarr 4K');
    assert.equal((await a.post('/api/dupes/remove', { sid: pick.sid, fileId: pick.fileId })).status, 200);
    assert.ok(!f2.state.movies.some(x => x.id === m2.id), 'taken out of that Radarr');
    void r1; void r2;
  } finally { await s.stop(); s1.close(); s2.close(); }
});
