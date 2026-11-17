// The recycle bin: deleted torrents, files and titles wait there first, and can be put back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, tmp } = require('./helpers');
const BIN = require('../lib/recyclebin');

test('the bin moves files aside and puts them back, all or nothing', () => {
  const d = tmp(), a = path.join(d, 'media', 'Film', 'film.mkv'), b = path.join(d, 'media', 'Film', 'extra.srt');
  fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a, 'x'.repeat(100)); fs.writeFileSync(b, 'y');
  const r = BIN.stash([a, b], path.join(d, 'media'));
  assert.ok(r.ok); assert.equal(r.size, 101); assert.equal(r.items.length, 2);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(path.dirname(a)), 'gone from the library, and its empty folder too');
  assert.ok(r.items.every(m => fs.existsSync(m.to) && m.to.includes(BIN.DIR)));
  assert.ok(BIN.intact(r));
  BIN.restore(r);
  assert.equal(fs.readFileSync(a, 'utf8').length, 100); assert.ok(fs.existsSync(b));
  // Something new in the way: nothing is moved back over it.
  const r2 = BIN.stash([a], null); fs.writeFileSync(a, 'new');
  assert.throws(() => BIN.restore(r2), /already/); assert.equal(fs.readFileSync(a, 'utf8'), 'new');
  BIN.drop(r2); assert.ok(!BIN.intact(r2));
  // The disk itself, or a bin, is never put in the bin; nothing is moved when one path is refused.
  const top = BIN.diskTop(a);
  assert.equal(BIN.stash([a, top], null).ok, false); assert.ok(fs.existsSync(a));
});

// A small qBittorrent and Radarr, with real files in a folder of their own.
function fakes(root) {
  const st = { qbDeleted: [], qbAdded: [], radarr: { deleted: [], added: null, cmds: [], fileGone: false } };
  const tv = path.join(root, 'downloads', 'Show.S01');
  const movieDir = path.join(root, 'media', 'Film (2020)'), movieFile = path.join(movieDir, 'Film.mkv');
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), j = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = Buffer.alloc(0); for await (const c of req) body = Buffer.concat([body, c]);
    const p = u.pathname;
    if (p === '/api/v2/auth/login') { res.writeHead(200, { 'Set-Cookie': 'SID=abc; path=/' }); return res.end('Ok.'); }
    if (p === '/api/v2/app/version') return res.end('v5.0.0');
    if (p === '/api/v2/torrents/info') return j(200, (u.searchParams.get('hashes') || '').split('|').filter(h => h === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').map(() => ({ hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Show.S01', save_path: path.join(root, 'downloads'), download_path: '', category: 'tv', tags: 'x', magnet_uri: 'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ratio: 2, seeding_time: 1e7 })));
    if (p === '/api/v2/torrents/files') return j(200, [{ name: 'Show.S01/e1.mkv' }, { name: 'Show.S01/e2.mkv' }]);
    if (p === '/api/v2/torrents/export') { res.writeHead(200); return res.end('d4:infod4:name4:testee'); }
    if (p === '/api/v2/torrents/delete') { st.qbDeleted.push(Object.fromEntries(new URLSearchParams(body.toString()))); return res.end('Ok.'); }
    if (p === '/api/v2/torrents/add') { st.qbAdded.push(body.toString('latin1')); return res.end('Ok.'); }
    if (p.startsWith('/api/v2/')) return j(200, []);
    if (p === '/api/v3/system/status') return j(200, { version: '5.0.0', appName: 'Radarr' });
    if (p === '/api/v3/movie/1' && req.method === 'GET') return j(200, { id: 1, title: 'Film', year: 2020, tmdbId: 55, qualityProfileId: 1, path: movieDir, hasFile: !st.radarr.fileGone, movieFile: st.radarr.fileGone ? null : { id: 9, path: movieFile } });
    if (p === '/api/v3/moviefile/9' && req.method === 'GET') return j(200, { id: 9, path: movieFile });
    if (p === '/api/v3/moviefile/9' && req.method === 'DELETE') { st.radarr.fileGone = true; st.radarr.deleted.push('file:' + fs.existsSync(movieFile)); return j(200, {}); }
    if (p === '/api/v3/movie/1' && req.method === 'DELETE') { st.radarr.deleted.push('movie:' + u.searchParams.get('deleteFiles')); return j(200, {}); }
    if (p === '/api/v3/movie' && req.method === 'POST') { st.radarr.added = JSON.parse(body); return j(201, { id: 2 }); }
    if (p === '/api/v3/command' && req.method === 'POST') { st.radarr.cmds.push(JSON.parse(body)); return j(201, {}); }
    return j(200, []);
  }).listen(0);
  const make = () => {
    fs.mkdirSync(tv, { recursive: true }); fs.writeFileSync(path.join(tv, 'e1.mkv'), 'a'.repeat(10)); fs.writeFileSync(path.join(tv, 'e2.mkv'), 'b'.repeat(20));
    fs.mkdirSync(movieDir, { recursive: true }); fs.writeFileSync(movieFile, 'm'.repeat(30));
  };
  return { srv, st, tv, movieDir, movieFile, make };
}

test('deleting with files goes to the bin, and Put back brings it all back', async () => {
  const root = tmp(), f = fakes(root); f.make();
  await new Promise(r => f.srv.once('listening', r));
  const url = `http://127.0.0.1:${f.srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const qb = (await a.post('/api/services', { type: 'qbittorrent', name: 'qBittorrent', url, user: 'u', pass: 'p' })).data.id;
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url, apiKey: 'k' })).data.id;

    // A torrent with its files: qBittorrent is told to keep them, and they are moved into the bin.
    let r = await a.post(`/api/qb/${qb}/act`, { action: 'delete', hashes: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', files: true, force: true });
    assert.equal(r.status, 200); assert.equal(r.data.binned, 1);
    assert.deepEqual(f.st.qbDeleted.map(x => x.deleteFiles), ['false']);
    assert.ok(!fs.existsSync(f.tv), 'the torrent folder left the downloads');
    let bin = (await a.get('/api/bin')).data;
    assert.equal(bin.days, 7); assert.equal(bin.items.length, 1);
    assert.equal(bin.items[0].kind, 'torrent'); assert.equal(bin.items[0].size, 30); assert.equal(bin.items[0].by, 'admin');

    // Put back: the files return, and the .torrent is added again into the same folder and category.
    r = await a.post(`/api/bin/${bin.items[0].id}/restore`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(fs.readFileSync(path.join(f.tv, 'e2.mkv'), 'utf8').length, 20);
    assert.equal(f.st.qbAdded.length, 1);
    assert.match(f.st.qbAdded[0], /name="savepath"[\s\S]*downloads/); assert.match(f.st.qbAdded[0], /name="category"\r\n\r\ntv/); assert.match(f.st.qbAdded[0], /d4:infod4:name4:testee/);
    assert.equal((await a.get('/api/bin')).data.items.length, 0);

    // A movie's file: moved aside before Radarr forgets it, then a rescan when it is put back.
    r = await a.del(`/api/files?sid=${rad}&kind=movie&id=1`);
    assert.equal(r.data.binned, 1); assert.deepEqual(f.st.radarr.deleted, ['file:false'], 'the file was already in the bin when Radarr was asked');
    bin = (await a.get('/api/bin')).data; assert.equal(bin.items[0].kind, 'files');
    await a.post(`/api/bin/${bin.items[0].id}/restore`);
    assert.ok(fs.existsSync(f.movieFile)); assert.equal(f.st.radarr.cmds[0].name, 'RescanMovie'); assert.equal(f.st.radarr.cmds[0].movieId, 1);
    f.st.radarr.fileGone = false;

    // A whole title with its files: Radarr keeps nothing, and Put back adds it again with the same folder, without a search.
    r = await a.del(`/api/library/${rad}/1?files=1`);
    assert.equal(r.data.binned, 1); assert.ok(f.st.radarr.deleted.includes('movie:false'));
    assert.ok(!fs.existsSync(f.movieDir));
    bin = (await a.get('/api/bin')).data; assert.equal(bin.items[0].name, 'Film (2020)');
    await a.post(`/api/bin/${bin.items[0].id}/restore`);
    assert.ok(fs.existsSync(f.movieFile));
    assert.equal(f.st.radarr.added.tmdbId, 55); assert.equal(f.st.radarr.added.path, f.movieDir); assert.equal(f.st.radarr.added.id, undefined);
    assert.deepEqual(f.st.radarr.added.addOptions, { searchForMovie: false });

    // Delete for good, and Empty.
    await a.del(`/api/library/${rad}/1?files=1`);
    bin = (await a.get('/api/bin')).data;
    r = await a.del(`/api/bin/${bin.items[0].id}`); assert.equal(r.data.freed, 30);
    assert.equal((await a.get('/api/bin')).data.items.length, 0);

    // Off (0 days): deleted straight away, as before.
    f.make(); assert.equal((await a.put('/api/bin', { days: 0 })).status, 200);
    r = await a.post(`/api/qb/${qb}/act`, { action: 'delete', hashes: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', files: true, force: true });
    assert.equal(r.data.binned, 0); assert.equal(f.st.qbDeleted.at(-1).deleteFiles, 'true');
    assert.equal((await a.put('/api/bin', { days: 99 })).status, 400);

    // Admins only.
    await a.post('/api/users', { name: 'u', password: 'useruser1', role: 'user' });
    const u = client(s.base); await u.post('/api/login', { name: 'u', password: 'useruser1' });
    assert.equal((await u.get('/api/bin')).status, 403);
  } finally { await s.stop(); f.srv.close(); }
});
