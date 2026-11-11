// File Browser opens for admins only, except its share links: anyone with one gets the shared file, nothing else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup } = require('./helpers');

test('File Browser share links open without signing in; the rest of File Browser does not', async () => {
  const seen = [];
  const fbs = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('fb ' + req.url); }).listen(0);
  await new Promise(r => fbs.once('listening', r));
  const dir = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [], extras: [{ key: 'filebrowser' }] }));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_PORT_FILEBROWSER: String(fbs.address().port) }, dir), a = client(s.base); await setup(a);
  const anon = async (u, method = 'GET') => { const r = await fetch(s.base + u, { method, redirect: 'manual' }); return [r.status, r.status === 200 ? await r.text() : '']; };
  try {
    assert.equal((await a.get('/engines/filebrowser/api/resources/media')).status, 200, 'admins get everything');
    for (const u of ['/engines/filebrowser/share/AbC123xy', '/engines/filebrowser/share/AbC123xy/sub/file.mkv', '/engines/filebrowser/static/js/app.js',
      '/engines/filebrowser/api/public/share/AbC123xy', '/engines/filebrowser/api/public/dl/AbC123xy?inline=true', '/engines/filebrowser/api/public/dl/AbC123xy/Movie%20(2024).mkv'])
      assert.equal((await anon(u))[0], 200, u);
    for (const u of ['/engines/filebrowser/', '/engines/filebrowser/files/', '/engines/filebrowser/api/resources/media', '/engines/filebrowser/api/login',
      '/engines/filebrowser/api/share/media/a.mkv', '/engines/filebrowser/share/AbC123xy/../../api/resources', '/engines/filebrowser/api/public/dl/AbC123xy/%2e%2e/%2e%2e/api/users',
      '/engines/filebrowser/share/x', '/engines/filebrowser/static/../api/users'])
      assert.equal((await anon(u))[0], 302, u);
    assert.equal((await anon('/engines/filebrowser/api/public/dl/AbC123xy', 'DELETE'))[0], 302, 'only reading');
  } finally { await s.stop(); fbs.close(); }
});
