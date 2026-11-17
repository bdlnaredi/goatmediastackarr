// Offline: the phone gets a short-lived link to a movie or episode, the original or a smaller copy made by Plex.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');

test('a title saved to the phone comes through a short-lived link', async () => {
  const seen = [], srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); seen.push(u.pathname);
    const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/library/metadata/77') return j({ MediaContainer: { Metadata: [{ ratingKey: '77', librarySectionID: 1, Media: [{ Part: [{ key: '/library/parts/5/1/file.mkv', container: 'mkv' }] }] }] } });
    if (u.pathname === '/library/parts/5/1/file.mkv') { assert.equal(u.searchParams.get('X-Plex-Token'), 'tok'); res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': 8 }); return res.end('ORIGINAL'); }
    if (u.pathname === '/video/:/transcode/universal/start.mp4') { assert.equal(u.searchParams.get('videoResolution'), '1280x720'); res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end('SMALLER'); }
    j({ MediaContainer: { machineIdentifier: 'm1' } });
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `http://127.0.0.1:${srv.address().port}`, apiKey: 'tok' })).data.id;
    let r = await a.post('/api/offline', { sid, key: '77', title: 'Quiet Orbit', sub: '2026', q: '720' });
    assert.equal(r.status, 200); assert.match(r.data.url, /^\/api\/offline\/file\/[a-f0-9]{48}$/);
    // The link works without signing in (the phone's downloader fetches it), and carries no Plex token.
    let f = await fetch(s.base + r.data.url);
    assert.equal(f.status, 200); assert.equal(await f.text(), 'SMALLER');
    assert.match(f.headers.get('content-disposition'), /filename="Quiet Orbit - 2026\.mp4"/);
    r = await a.post('/api/offline', { sid, key: '77', title: 'Quiet Orbit', q: 'orig' });
    f = await fetch(s.base + r.data.url);
    assert.equal(await f.text(), 'ORIGINAL'); assert.match(f.headers.get('content-disposition'), /\.mkv"/);
    assert.equal((await fetch(s.base + '/api/offline/file/' + 'ab'.repeat(24))).status, 404, 'a made-up link does nothing');
    assert.equal((await a.post('/api/offline', { sid, key: '77', q: '4k' })).status, 400);

    // Someone without access to Plex cannot.
    const u = (await a.post('/api/users', { name: 'kim', password: 'password-kim', role: 'user' })).data;
    const k = client(s.base); await k.post('/api/login', { name: 'kim', password: 'password-kim' });
    assert.equal((await k.post('/api/offline', { sid, key: '77', q: '720' })).status, 400);
    await a.put(`/api/users/${u.id}/access`, { access: [sid] });
    assert.equal((await k.post('/api/offline', { sid, key: '77', q: '720' })).status, 200, 'with access to Plex (all its libraries), they can');
  } finally { await s.stop(); srv.close(); }
});
