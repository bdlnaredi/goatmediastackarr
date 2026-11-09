// Logs: the stack's apps from their own log files, the added apps through their APIs, alone or all together.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, tmp } = require('./helpers');
const fakes = require('../lib/demo');
const AL = require('../lib/applogs');

test('levels are read from the line when the app does not say', () => {
  assert.equal(AL.guess('[Error] Something broke'), 'error');
  assert.equal(AL.guess('2026-01-01 WARN retrying in 5s'), 'warn');
  assert.equal(AL.guess('Started fine'), 'info');
  assert.equal(AL.norm('Warn', 'x'), 'warn'); assert.equal(AL.norm('ERROR', 'x'), 'error'); assert.equal(AL.norm('Trace', 'x'), 'debug');
});

test('logs of the stack and of added apps, one at a time or together', async () => {
  const dir = tmp(), iso = m => new Date(Date.now() - m * 60000).toISOString();
  fs.mkdirSync(path.join(dir, 'sonarr')); fs.mkdirSync(path.join(dir, 'ui')); fs.mkdirSync(path.join(dir, 'empty'));
  // A rotated file (older) and current (newer), with a colour code and a line without a time.
  fs.writeFileSync(path.join(dir, 'sonarr', '@400000006500000000000000.s'), `${iso(50)} [Info] Bootstrap: Starting Sonarr\n`);
  fs.writeFileSync(path.join(dir, 'sonarr', 'current'), `${iso(20)} \x1b[31m[Error] Database is locked\x1b[0m\n  at Sonarr.Core.Db\n${iso(1)} [Info] Housekeeping done\n`);
  fs.writeFileSync(path.join(dir, 'ui', 'current'), `${iso(4)} GoatMediaStackarr listening on 8282\n`);
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ GOAT_LOGS: dir }), a = client(s.base); await setup(a);
  try {
    const add = async (type, name, extra = {}) => (await a.post('/api/services', { type, name, url: `${fb}/${type}`, apiKey: 'k', username: 'u', password: 'p', ...extra })).data.id;
    const radarr = await add('radarr', 'Radarr'), qbit = await add('qbittorrent', 'qB'); await add('tautulli', 'Tautulli'); await add('bazarr', 'Bazarr'); await add('sabnzbd', 'SAB');
    await add('plex', 'Plex');   // no log through its API: not offered

    const src = (await a.get('/api/logs/sources')).data.sources;
    assert.deepEqual(src.filter(x => x.kind === 'stack').map(x => x.name), ['Sonarr', 'GoatMediaStackarr'], 'only the stack apps that have a log');
    assert.deepEqual(src.filter(x => x.kind === 'app').map(x => x.type).sort(), ['bazarr', 'qbittorrent', 'radarr', 'sabnzbd', 'tautulli']);

    // One app of the stack: oldest first, colour codes gone, the line without a time kept in place.
    const one = (await a.get('/api/logs?src=stack:sonarr')).data.lines;
    assert.deepEqual(one.map(x => x.msg), ['[Info] Bootstrap: Starting Sonarr', '[Error] Database is locked', '  at Sonarr.Core.Db', '[Info] Housekeeping done']);
    assert.deepEqual(one.map(x => x.level), ['info', 'error', 'info', 'info']);
    assert.ok(one[2].t === one[1].t);

    // Everything together, in time order, from every source.
    const all = (await a.get('/api/logs?src=all')).data;
    assert.deepEqual(all.failed, []);
    for (let i = 1; i < all.lines.length; i++) assert.ok(all.lines[i].t >= all.lines[i - 1].t, 'in time order');
    const by = new Set(all.lines.map(x => x.src));
    for (const id of ['stack:sonarr', 'stack:ui', 'app:' + radarr, 'app:' + qbit]) assert.ok(by.has(id), id);
    assert.ok(all.lines.some(x => /DirectoryNotFoundException/.test(x.msg) && x.level === 'error'), 'Radarr\'s exception comes with its line');
    assert.ok(all.lines.some(x => /Torrent stalled/.test(x.msg) && x.level === 'warn'));
    assert.ok(all.lines.some(x => /OpenSubtitles/.test(x.msg) && x.level === 'error'));
    assert.ok(all.lines.some(x => /will be ignored/.test(x.msg) && x.level === 'warn'));
    assert.ok(all.lines.some(x => /Notification sent/.test(x.msg)));

    // Filters: only problems, a word, a few sources.
    const bad = (await a.get('/api/logs?src=all&level=error,warn')).data.lines;
    assert.ok(bad.length >= 5 && bad.every(x => x.level === 'error' || x.level === 'warn'));
    const q = (await a.get('/api/logs?src=all&q=locked')).data.lines;
    assert.deepEqual(q.map(x => x.msg), ['[Error] Database is locked']);
    const two = (await a.get(`/api/logs?src=stack:ui,app:${qbit}`)).data.lines;
    assert.deepEqual([...new Set(two.map(x => x.src))].sort(), ['app:' + qbit, 'stack:ui'].sort());

    // An app that does not answer is named, the rest still show.
    fake.state.logDown = 'radarr';
    const part = (await a.get('/api/logs?src=all')).data;
    assert.equal(part.failed.length, 1); assert.equal(part.failed[0].name, 'Radarr'); assert.ok(part.lines.length > 5);
    assert.equal((await a.get('/api/logs?src=stack:../../etc')).data.lines.length, 0, 'no way out of the logs folder');

    // Admins only.
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await k.get('/api/logs?src=all')).status, 403); assert.equal((await k.get('/api/logs/sources')).status, 403);
  } finally { await s.stop(); srv.close(); }
});

test('s6-log times are read in the local time zone, to the millisecond', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'lg-')), old = process.env.GOAT_LOGS;
  require('node:fs').mkdirSync(dir + '/x'); require('node:fs').writeFileSync(dir + '/x/current', '2026-11-09 16:53:33.993392347  [Info] Bootstrap\n');
  process.env.GOAT_LOGS = dir;
  try { const [l] = AL.readStack('x'); assert.equal(l.t, new Date(2026, 10, 9, 16, 53, 33, 993).getTime()); assert.equal(l.msg, '[Info] Bootstrap'); }
  finally { process.env.GOAT_LOGS = old; if (old === undefined) delete process.env.GOAT_LOGS; }
});

test('qBittorrent marks its own levels', () => {
  assert.equal(AL.guess('(W) 2026-11-09T10:25:00 - Tracker is not working'), 'warn');
  assert.equal(AL.guess('(C) Could not bind to port'), 'error');
  assert.equal(AL.guess('(N) qBittorrent started'), 'info');
});
