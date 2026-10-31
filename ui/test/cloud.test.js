// Backups copied off the server: S3-compatible storage (signed requests) and WebDAV, keeping the newest few.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const C = require('../lib/cloud');

test('S3 signatures match the AWS examples', () => {
  const c = { endpoint: 'https://examplebucket.s3.amazonaws.com', region: 'us-east-1', bucket: 'test.txt', access: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  assert.match(C.s3sign(c, 'GET', '', {}, null, { range: 'bytes=0-9' }, new Date('2013-05-24T00:00:00Z')).headers.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.match(C.s3sign({ ...c, bucket: '' }, 'GET', '', { 'max-keys': '2', prefix: 'J' }, null, {}, new Date('2013-05-24T00:00:00Z')).headers.authorization, /34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/);
});

const store = () => { const files = new Map(), seen = [];
  const srv = http.createServer((req, res) => { const ch = []; req.on('data', d => ch.push(d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); seen.push({ m: req.method, p: u.pathname, auth: req.headers.authorization || '' });
    if (req.method === 'PUT') { files.set(decodeURIComponent(u.pathname), Buffer.concat(ch)); res.writeHead(201); return res.end(); }
    if (req.method === 'DELETE') { files.delete(decodeURIComponent(u.pathname)); res.writeHead(204); return res.end(); }
    if (req.method === 'MKCOL') { res.writeHead(201); return res.end(); }
    if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); return res.end(`<d:multistatus xmlns:d="DAV:">${[...files.keys()].filter(k => k.startsWith(u.pathname)).map(k => `<d:response><d:href>${encodeURI(k)}</d:href></d:response>`).join('')}</d:multistatus>`); }
    if (req.method === 'GET' && u.searchParams.get('list-type') === '2') { const pre = u.pathname.replace(/\/$/, '') + '/' + (u.searchParams.get('prefix') || '');
      res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<ListBucketResult>${[...files.keys()].filter(k => k.startsWith(pre)).map(k => `<Contents><Key>${k.split('/').slice(2).join('/')}</Key></Contents>`).join('')}</ListBucketResult>`); }
    res.writeHead(404); res.end(); }); }).listen(0);
  return { srv, files, seen }; };

test('cloud backup: S3 and WebDAV, a test, each new backup copied, and only the newest kept', async () => {
  const s3 = store(), dav = store();
  await Promise.all([new Promise(r => s3.srv.once('listening', r)), new Promise(r => dav.srv.once('listening', r))]);
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.put('/api/cloud', { on: true, type: 's3', endpoint: 'nope' })).status, 400);
    let r = await a.post('/api/cloud/test', { type: 's3', endpoint: `http://127.0.0.1:${s3.srv.address().port}`, bucket: 'bk', access: 'AK', secret: 'SECRET', region: 'eu-1' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(s3.files.size, 0, 'the test file is removed again');
    assert.ok(s3.seen.every(x => /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-1\/s3\/aws4_request/.test(x.auth)));
    r = await a.put('/api/cloud', { on: true, type: 's3', endpoint: `http://127.0.0.1:${s3.srv.address().port}`, bucket: 'bk', access: 'AK', secret: 'SECRET', region: 'eu-1', keep: 2 });
    assert.equal(r.data.secret, ''); assert.equal(r.data.hasSecret, true);
    for (let i = 0; i < 3; i++) { r = await a.post('/api/cloud/now'); assert.equal(r.status, 200, JSON.stringify(r.data)); await new Promise(x => setTimeout(x, 1100 * (i < 2 ? 0 : 0))); }
    const keys = [...s3.files.keys()]; assert.ok(keys.length >= 1 && keys.length <= 2, keys.join()); assert.ok(keys.every(k => /^\/bk\/goatmediastackarr\/auto-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(k)));
    assert.match(s3.files.get(keys[0]).toString(), /"users"/);
    assert.equal((await a.get('/api/cloud')).data.last.ok, true);

    // WebDAV, in a folder of its own.
    r = await a.put('/api/cloud', { on: true, type: 'webdav', url: `http://127.0.0.1:${dav.srv.address().port}/dav/files/ann`, user: 'ann', pass: 'pw', prefix: 'backups/goat' });
    assert.equal(r.status, 200);
    r = await a.post('/api/cloud/now'); assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok([...dav.files.keys()].some(k => /^\/dav\/files\/ann\/backups\/goat\/auto-.*\.json$/.test(k)));
    assert.ok(dav.seen.some(x => x.m === 'MKCOL' && x.p === '/dav/files/ann/backups/')); assert.ok(dav.seen.every(x => x.auth === 'Basic ' + Buffer.from('ann:pw').toString('base64')));
    // Off: nothing more is copied.
    await a.put('/api/cloud', { on: false }); assert.equal((await a.post('/api/cloud/now')).status, 400);
  } finally { await s.stop(); s3.srv.close(); dav.srv.close(); }
});
