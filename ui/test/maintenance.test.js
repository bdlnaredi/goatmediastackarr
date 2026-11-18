// Maintenance window: the heavy jobs run in it, and only while nobody is watching.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

for (const streams of [0, 1]) test(streams ? 'nothing runs while someone is watching' : 'the library scan runs in the window', async () => {
  const urls = [], fake = fakes.create({ streams });
  const srv = http.createServer((req, res) => { urls.push(req.url); fake.handle(req, res, req.url); }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({ MONITOR_MS: '200' }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'plex', name: 'Plex', url: `http://127.0.0.1:${srv.address().port}/plex`, apiKey: 'k' });
    let d = (await a.get('/api/maintenance')).data;
    assert.equal(d.on, false); assert.equal(d.open, false);
    assert.equal((await a.put('/api/maintenance', { on: true, from: '3am' })).status, 400);
    const now = new Date();
    await a.put('/api/maintenance', { on: true, day: 7, from: hhmm(new Date(now - 3600e3)), to: hhmm(new Date(+now + 3600e3)), dupes: false });
    const t = Date.now(); while (Date.now() - t < 6000) { await new Promise(r => setTimeout(r, 200)); if (urls.some(u => u.includes('/library/sections/all/refresh'))) break; }
    d = (await a.get('/api/maintenance')).data;
    assert.equal(d.open, true);
    if (streams) {
      assert.ok(!urls.some(u => u.includes('/library/sections/all/refresh')), 'no scan while someone watches');
      assert.equal(d.watching, true); assert.equal(d.waiting, true);
    } else {
      assert.ok(urls.some(u => u.includes('/library/sections/all/refresh')), 'Plex was asked to scan');
      assert.deepEqual(d.last.ran, ['Plex: library scan']);
    }
  } finally { await s.stop(); srv.close(); }
});
