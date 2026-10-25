// Discover's lists: kept on disk, shown straight away when older, refreshed in the background, and a failed call is tried again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const listsLib = require('../lib/lists');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('lists survive a restart, old copies come back at once, and a flaky site is asked twice', async () => {
  let calls = 0, fail = 0, title = 'First';
  const srv = http.createServer((req, res) => {
    calls++;
    if (fail > 0) { fail--; res.writeHead(503); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [{ id: 7, title, release_date: '2026-01-01', poster_path: '/p.jpg', vote_average: 7.5 }] }));
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`, file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lists-')), 'lists-cache.json');
  const mk = () => listsLib.create({ keys: () => ({ tmdb: 'secret-key' }), urls: { tmdb: url }, file });
  try {
    // A 503 is tried once more.
    fail = 1;
    let l = mk(); assert.equal((await l.list('tmdb', 'popular', 'movie'))[0].title, 'First'); assert.equal(calls, 2);
    await sleep(2500);
    assert.ok(fs.existsSync(file), 'kept on disk'); assert.ok(!fs.readFileSync(file, 'utf8').includes('secret-key'), 'the key is never written');
    // After a "restart" it comes from disk without asking the site.
    l = mk(); calls = 0;
    assert.equal((await l.list('tmdb', 'popular', 'movie'))[0].title, 'First'); assert.equal(calls, 0);
    // An older copy is returned at once and refreshed in the background.
    const d = JSON.parse(fs.readFileSync(file, 'utf8')); for (const v of Object.values(d.lists)) v.at -= 3600e3; fs.writeFileSync(file, JSON.stringify(d));
    l = mk(); title = 'Second';
    assert.equal((await l.list('tmdb', 'popular', 'movie'))[0].title, 'First', 'old copy first');
    await sleep(300);
    assert.equal((await l.list('tmdb', 'popular', 'movie'))[0].title, 'Second', 'then the new one');
    // warm() fetches every list that is set up.
    calls = 0; await mk().warm(); assert.ok(calls >= 5, 'trending, popular and anticipated for movies and shows');
  } finally { srv.close(); }
});
