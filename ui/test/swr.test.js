// Library and Search answers are kept: asking again does not ask Sonarr again, and a change makes them fresh.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('library and search are kept, and fetched fresh after a change', async () => {
  const fake = fakes.create(), seen = [];
  const srv = http.createServer((req, res) => { seen.push(req.url.split('?')[0]); fake.handle(req, res, req.url); }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    const n = p => seen.filter(x => x === p).length;
    const first = (await a.get(`/api/library?sid=${sid}`)).data;
    const before = n('/sonarr/api/v3/series');
    assert.deepEqual((await a.get(`/api/library?sid=${sid}`)).data, first);
    assert.equal(n('/sonarr/api/v3/series'), before, 'the second visit is answered from what was kept');
    await a.get(`/api/search?sid=${sid}&term=harbor`); await a.get(`/api/search?sid=${sid}&term=Harbor `);
    assert.equal(n('/sonarr/api/v3/series/lookup'), 1, 'the same words are looked up once');
    // A change (here: monitoring) makes the next visit ask Sonarr again.
    await a.post('/api/monitor', { sid, kind: 'series', id: 1, monitored: false });
    await a.get(`/api/library?sid=${sid}`);
    assert.equal(n('/sonarr/api/v3/series'), before + 1);
  } finally { await s.stop(); srv.close(); }
});
