// The Unraid page shows the CPU by its full name (maker and model), cores, threads and speed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('unraid: the CPU is named in full, with trademark signs removed', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({}), a = client(s.base); await setup(a);
  try {
    const id = (await a.post('/api/services', { type: 'unraid', name: 'Tower', url: `http://127.0.0.1:${srv.address().port}/unraid`, apiKey: 'k' })).data.id;
    const d = (await a.get(`/api/unraid/${id}`)).data;
    assert.deepEqual(d.cpuInfo, { brand: 'Intel Core i5-12400', cores: 6, threads: 12, ghz: 2.5 });
    assert.ok(d.uptime, 'uptime comes along');
    const f = (await a.get(`/api/unraid/${id}?fast=1`)).data;
    assert.equal(f.cores.length, 12, 'each thread is reported'); assert.ok(f.cores.every(v => v >= 0 && v <= 100));
    assert.equal(f.memTotal, 34359738368); assert.ok(f.memUsed > 0 && f.memUsed < f.memTotal && f.memAvail > 0, 'memory in real amounts');
    const lg = (await a.get(`/api/unraid/${id}/logs?id=c0`)).data; assert.match(lg.text, /Listening on port/); assert.match(lg.text, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d  /, 'lines carry their time');
    assert.deepEqual(d.icons, { c0: 'https://example.com/plex.png' }, 'only a plain https icon from the container labels is passed on');
    assert.ok(!JSON.stringify(d).includes('SECRET9'));
    assert.deepEqual(d.shares.map(x => x.size), [0, 0, 0], 'the pretend Unraid reports no share size, like many real ones');
  } finally { await s.stop(); srv.close(); }
});
