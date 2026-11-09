// App updates: the newest release of each app in the image, from GitHub, and a word to admins when one is newer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, tmp } = require('./helpers');

test('app updates: newer versions are listed with their notes, and admins hear once', async () => {
  const dir = tmp(), vf = path.join(dir, 'versions.json');
  fs.writeFileSync(vf, JSON.stringify({ built: '2026-11-02T03:30:00Z', goat: '1.0.15', apps: { sonarr: '4.0.11.2680', radarr: '5.14.0.9383', qbittorrent: '5.0.2', 'cross-seed': '6.13.1' } }));
  const rel = { 'Sonarr/Sonarr': { tag_name: 'v4.0.12.2823', body: '- Fixed: import of season packs', html_url: 'https://github.com/Sonarr/Sonarr/releases/tag/v4.0.12.2823' },
    'Radarr/Radarr': { tag_name: 'v5.14.0.9383', body: 'same' }, 'userdocs/qbittorrent-nox-static': { tag_name: 'release-5.1.0_v2.0.11', body: 'qBittorrent 5.1.0' } };
  let calls = 0;
  const gh = http.createServer((req, res) => { calls++; const m = req.url.match(/^\/repos\/(.+)\/releases\/latest$/), d = m && rel[m[1]];
    res.writeHead(d ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d || { message: 'Not Found' })); }).listen(0);
  await new Promise(r => gh.once('listening', r));
  const s = await boot({ GOAT_VERSIONS: vf, GITHUB_API: `http://127.0.0.1:${gh.address().port}` }), a = client(s.base); await setup(a);
  try {
    let v = (await a.get('/api/appupdates')).data;
    assert.deepEqual(v.apps.map(x => x.key).sort(), ['cross-seed', 'qbittorrent', 'radarr', 'sonarr'], 'the apps in the image');
    assert.ok(v.apps.every(x => !x.latest), 'not checked yet');
    v = (await a.post('/api/appupdates/check')).data;
    const by = Object.fromEntries(v.apps.map(x => [x.key, x]));
    assert.equal(by.sonarr.latest, '4.0.12.2823'); assert.equal(by.sonarr.newer, true); assert.match(by.sonarr.notes, /season packs/);
    assert.equal(by.radarr.newer, false); assert.equal(by.radarr.notes, '', 'notes only for newer ones');
    assert.equal(by.qbittorrent.latest, '5.1.0'); assert.equal(by.qbittorrent.newer, true);
    assert.equal(by['cross-seed'].latest, '', 'GitHub had nothing: left empty');
    const told = (await a.get('/api/notifications')).data.items.filter(x => x.title === 'Newer app versions are out');
    assert.equal(told.length, 1); assert.match(told[0].body, /Sonarr 4\.0\.12\.2823 \(you have 4\.0\.11\.2680\).*qBittorrent 5\.1\.0/);
    await a.post('/api/appupdates/check');
    assert.equal((await a.get('/api/notifications')).data.items.filter(x => x.title === 'Newer app versions are out').length, 1, 'the same versions are not told again');
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await k.get('/api/appupdates')).status, 403);
  } finally { await s.stop(); gh.close(); }
});
