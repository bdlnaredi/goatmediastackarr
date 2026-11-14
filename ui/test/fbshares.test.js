// The shared links list: File Browser's shares, with how often each was downloaded through its link; and removing one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup } = require('./helpers');

test('shared links are listed with their downloads, and can be removed', async () => {
  let shares = [{ hash: 'AbC123xy', path: '/media/movies/a.mkv', userID: 1, expire: 0, hasPassword: false },
    { hash: 'ZzZ987qq', path: '/downloads/b.zip', userID: 1, expire: Math.floor(Date.now() / 1000) - 60, hasPassword: true }];
  const fbs = http.createServer((req, res) => {
    const u = req.url.replace('/engines/filebrowser', '');
    if (u === '/api/login') { res.writeHead(200); return res.end('tok'); }
    if (u.startsWith('/api/public/dl/')) { res.writeHead(200); return res.end('file'); }
    if (req.headers['x-auth'] !== 'tok') { res.writeHead(401); return res.end(); }
    if (u === '/api/shares') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(shares)); }
    const m = /^\/api\/share\/(\w+)$/.exec(u); if (m && req.method === 'DELETE') { shares = shares.filter(x => x.hash !== m[1]); res.writeHead(200); return res.end(); }
    res.writeHead(404); res.end();
  }).listen(0);
  await new Promise(r => fbs.once('listening', r));
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [], extras: [{ key: 'filebrowser' }] }));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_PORT_FILEBROWSER: String(fbs.address().port) }, dir), a = client(s.base); await setup(a);
  try {
    // Downloaded twice; a later piece of a video playing does not count again.
    await fetch(s.base + '/engines/filebrowser/api/public/dl/AbC123xy');
    await fetch(s.base + '/engines/filebrowser/api/public/dl/AbC123xy', { headers: { Range: 'bytes=0-' } });
    await fetch(s.base + '/engines/filebrowser/api/public/dl/AbC123xy', { headers: { Range: 'bytes=5000-' } });
    const l = (await a.get('/api/fbshares')).data.shares;
    assert.equal(l.length, 2);
    const x = l.find(y => y.hash === 'AbC123xy'), z = l.find(y => y.hash === 'ZzZ987qq');
    assert.equal(x.downloads, 2); assert.ok(x.last > 0); assert.equal(x.password, false); assert.equal(x.expire, 0);
    assert.equal(z.password, true); assert.equal(z.expired, true); assert.equal(z.downloads, 0);
    assert.equal((await a.del('/api/fbshares/AbC123xy')).status, 200);
    assert.deepEqual((await a.get('/api/fbshares')).data.shares.map(y => y.hash), ['ZzZ987qq']);
    const k = client(s.base); await a.post('/api/users', { name: 'kid', password: 'kidkidkid', role: 'user' }); await k.post('/api/login', { name: 'kid', password: 'kidkidkid' });
    assert.equal((await k.get('/api/fbshares')).status, 403);
  } finally { await s.stop(); fbs.close(); }
});
