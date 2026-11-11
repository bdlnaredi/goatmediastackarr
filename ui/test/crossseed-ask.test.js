// cross-seed is asked to search a torrent the moment it finishes in the built-in qBittorrent, and on demand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('a finished torrent is sent to cross-seed, with single episodes; Find on other trackers asks again now', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  const asked = [];
  const cs = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c;
    asked.push({ url: req.url, key: req.headers['x-api-key'], body: JSON.parse(b || '{}') }); res.writeHead(req.headers['x-api-key'] === 'K'.repeat(48) ? 204 : 401); res.end(); }).listen(0);
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => cs.once('listening', r))]);
  const fb = `http://127.0.0.1:${srv.address().port}`, dir = tmp(), cfg = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [{ key: 'qbittorrent', type: 'qbittorrent', name: 'qBittorrent', url: `${fb}/qbittorrent`, user: 'goat', pass: 'p' }] }));
  fs.mkdirSync(path.join(cfg, 'cross-seed')); fs.writeFileSync(path.join(cfg, 'cross-seed', 'goat-api-key'), 'K'.repeat(48));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_CONFIG_DIR: cfg, CROSSSEED_URL: `http://127.0.0.1:${cs.address().port}`, MONITOR_MS: '150' }, dir), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.get('/api/me')).data.crossSeed, true, 'the page knows cross-seed is there');
    await sleep(700);
    assert.equal(asked.length, 0, 'torrents already finished before it was watching are left to cross-seed\'s own schedule');
    const h = 'ab'.repeat(20), now = Math.floor(Date.now() / 1000);
    fake.state.torrents.push({ hash: h, name: 'Some.Show.S01E02.1080p.WEB-DL', size: 2e9, progress: 1, category: 'tv', tags: '', state: 'uploading', ratio: 0, added_on: now - 600, completion_on: now, save_path: '/downloads', content_path: '/downloads/x' });
    for (let i = 0; i < 40 && !asked.length; i++) await sleep(100);
    assert.equal(asked.length, 1); assert.equal(asked[0].url, '/api/webhook'); assert.equal(asked[0].key, 'K'.repeat(48));
    assert.deepEqual(asked[0].body, { infoHash: h, includeSingleEpisodes: true }, 'a single episode is searched too');
    await sleep(500); assert.equal(asked.length, 1, 'once');

    const r = await a.post('/api/crossseed/search', { hash: h.toUpperCase(), name: 'Some.Show.S01E02' });
    assert.equal(r.status, 200); assert.match(r.data.done, /searching your other trackers/);
    assert.deepEqual(asked[1].body, { infoHash: h, includeSingleEpisodes: true, ignoreExcludeRecentSearch: true, ignoreExcludeOlder: true }, 'on demand: even if searched lately or older');
    assert.equal((await a.post('/api/crossseed/search', { hash: 'nope' })).status, 400);
    fs.writeFileSync(path.join(cfg, 'cross-seed', 'goat-api-key'), 'wrong-key');
    assert.match((await a.post('/api/crossseed/search', { hash: h })).data.error, /did not accept its key/);
    fs.rmSync(path.join(cfg, 'cross-seed'), { recursive: true });
    assert.match((await a.post('/api/crossseed/search', { hash: h })).data.error, /Add cross-seed to Apps to run/);
  } finally { await s.stop(); srv.close(); cs.close(); }
});
