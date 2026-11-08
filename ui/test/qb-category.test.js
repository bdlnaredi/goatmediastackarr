// Changing a torrent's category (what the app's Downloads page does).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('a torrent moves to another category, and back to none', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const id = (await a.post('/api/services', { type: 'qbittorrent', name: 'qB', url: `http://127.0.0.1:${srv.address().port}/qbittorrent`, user: 'u', password: 'p' })).data.id;
    const t = (await a.get(`/api/qb/${id}/list`)).data.torrents[0];
    const cat = (await a.get(`/api/qb/${id}/meta`)).data.categories.find(c => c.name !== t.category).name;
    assert.equal((await a.post(`/api/qb/${id}/act`, { action: 'category', hash: t.hash, value: cat })).status, 200);
    assert.equal((await a.get(`/api/qb/${id}/list`)).data.torrents.find(x => x.hash === t.hash).category, cat);
    assert.equal((await a.post(`/api/qb/${id}/act`, { action: 'category', hash: t.hash, value: '' })).status, 200);
    assert.equal((await a.get(`/api/qb/${id}/list`)).data.torrents.find(x => x.hash === t.hash).category, '');
  } finally { await s.stop(); srv.close(); }
});
