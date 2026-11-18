// The app's player: a short-lived link to the original file, or a smaller stream (HLS) passed on from Plex or Jellyfin
// with no key or server address in what the phone sees.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');

test('a title plays in the app through a short-lived link', async () => {
  let port, scrobbled = false;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/library/metadata/77') return j({ MediaContainer: { Metadata: [{ ratingKey: '77', librarySectionID: 1, Media: [{ Part: [{ key: '/library/parts/5/1/file.mkv', container: 'mkv' }] }] }] } });
    if (u.pathname === '/library/parts/5/1/file.mkv') { res.writeHead(206, { 'Content-Type': 'video/x-matroska', 'Content-Range': 'bytes 0-3/8', 'Content-Length': 4 }); return res.end('ORIG'); }
    if (u.pathname === '/video/:/transcode/universal/start.m3u8') {
      assert.equal(u.searchParams.get('X-Plex-Token'), 'tok'); assert.equal(u.searchParams.get('protocol'), 'hls'); assert.equal(u.searchParams.get('videoResolution'), '1280x720');
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhttp://127.0.0.1:${port}/video/:/transcode/universal/session/abc/base/index.m3u8?X-Plex-Token=tok\n`);
    }
    if (u.pathname === '/video/:/transcode/universal/session/abc/base/index.m3u8') { assert.equal(u.searchParams.get('X-Plex-Token'), 'tok'); res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); return res.end('#EXTM3U\n#EXTINF:10,\n00000.ts\n#EXT-X-ENDLIST\n'); }
    if (u.pathname === '/video/:/transcode/universal/session/abc/base/00000.ts') { assert.equal(u.searchParams.get('X-Plex-Token'), 'tok'); res.writeHead(200, { 'Content-Type': 'video/mp2t' }); return res.end('SEGMENT'); }
    if (u.pathname === '/:/scrobble') { scrobbled = u.searchParams.get('key') === '77'; return j({}); }
    j({ MediaContainer: { machineIdentifier: 'm1' } });
  }).listen(0);
  await new Promise(r => srv.once('listening', r)); port = srv.address().port;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `http://127.0.0.1:${port}`, apiKey: 'tok' })).data.id;
    let r = await a.post('/api/play', { sid, key: '77', title: 'Quiet Orbit' });
    assert.equal(r.status, 200); assert.equal(r.data.hls, false);
    let f = await fetch(s.base + r.data.url, { headers: { Range: 'bytes=0-3' } });
    assert.equal(f.status, 206); assert.equal(await f.text(), 'ORIG');
    r = await a.post('/api/play', { sid, key: '77', q: '720' });
    assert.equal(r.data.hls, true); assert.match(r.data.url, /^\/api\/play\/[a-f0-9]{48}\/master\.m3u8$/);
    const pre = r.data.url.replace('master.m3u8', '');
    const master = await (await fetch(s.base + r.data.url)).text();
    assert.doesNotMatch(master, /tok|127\.0\.0\.1/, 'no key or server address reaches the phone');
    const variant = master.split('\n').find(l => l && !l.startsWith('#'));
    assert.equal(variant, pre + 'session/abc/base/index.m3u8');
    const media = await (await fetch(s.base + variant)).text(); assert.match(media, /00000\.ts/);
    assert.equal(await (await fetch(s.base + pre + 'session/abc/base/00000.ts')).text(), 'SEGMENT');
    assert.equal((await fetch(s.base + '/api/play/' + 'ab'.repeat(24) + '/master.m3u8')).status, 404, 'a made-up link does nothing');
    assert.equal((await a.post('/api/play', { sid, key: '77', q: '4k' })).status, 400);
    await a.post('/api/play/done', { sid, key: '77' }); assert.ok(scrobbled, 'watched to the end: marked as watched');
    const k = client(s.base); await a.post('/api/users', { name: 'kim', password: 'password-kim', role: 'user' }); await k.post('/api/login', { name: 'kim', password: 'password-kim' });
    assert.equal((await k.post('/api/play', { sid, key: '77' })).status, 400, 'without access to Plex, no');
  } finally { await s.stop(); srv.close(); }
});
