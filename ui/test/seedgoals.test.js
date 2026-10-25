// Tracker seeding goals: a finished movie or show is removed once its tracker's ratio or seeding time is reached.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('per-tracker goals: preview, only chosen categories, never while importing, then removed and logged', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '150', SEED_GOALS_MS: '200' }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'qbittorrent', name: 'qBittorrent', url: `${fb}/qbittorrent`, user: 'u', pass: 'p' });
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    const movie = fake.state.torrents.find(t => t.category === 'movies'), iso = fake.state.torrents.find(t => t.category === 'software');
    // Off by default; the check lists finished torrents in the chosen categories with their tracker.
    let r = await a.get('/api/seedgoals'); assert.equal(r.data.cfg.on, false); assert.deepEqual(r.data.cfg.cats, ['tv', 'movies']);
    r = await a.get('/api/seedgoals/check');
    assert.deepEqual(r.data.hosts, ['private-hd.net']);
    assert.equal(r.data.rows.length, 1, 'only the finished movie, not the ISO or unfinished episodes'); assert.equal(r.data.rows[0].rule, null);
    // A rule for its tracker: ratio 1.0 or 30 days. The movie has ratio 1.2, so it is due.
    assert.equal((await a.put('/api/seedgoals', { on: true, cats: [], rules: [] })).status, 400, 'needs a category');
    fake.state.importing = [movie.hash];
    r = await a.put('/api/seedgoals', { on: true, cats: ['tv', 'movies'], files: true, rules: [{ tracker: 'https://private-hd.net/announce', ratio: 1, days: 30 }, { tracker: '', ratio: 1 }] });
    assert.deepEqual(r.data.cfg.rules, [{ tracker: 'private-hd.net', ratio: 1, days: 30, how: 'either' }]);
    r = await a.get('/api/seedgoals/check'); assert.equal(r.data.rows[0].met, true); assert.equal(r.data.rows[0].importing, true);
    await sleep(1200);
    assert.ok(fake.state.torrents.includes(movie), 'not removed while Radarr is still importing it');
    // Imported: it goes, with its files; the ISO in another category stays.
    fake.state.importing = [];
    for (let i = 0; i < 40 && fake.state.torrents.includes(movie); i++) await sleep(150);
    assert.ok(!fake.state.torrents.includes(movie)); assert.ok(fake.state.torrents.includes(iso));
    assert.ok(fake.state.calls.some(c => c === `qb delete ${movie.hash} files=true`));
    r = await a.get('/api/seedgoals'); assert.equal(r.data.log[0].name, movie.name); assert.match(r.data.log[0].why, /ratio 1\.20/);
    // "both" needs the ratio and the days.
    await a.put('/api/seedgoals', { on: false, cats: ['tv'], rules: [{ tracker: 'demo-tracker.org', ratio: 1, days: 5, how: 'both' }] });
    assert.equal((await a.get('/api/seedgoals')).data.cfg.rules[0].how, 'both');
    const k = client(s.base); await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' }); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.get('/api/seedgoals')).status, 403, 'admins only');
  } finally { await s.stop(); srv.close(); }
});
