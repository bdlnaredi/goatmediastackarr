// Continue watching: Plex's On Deck for the owner, where each one stopped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('continue watching from Plex', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const px = (await a.post('/api/services', { type: 'plex', name: 'Plex', url: `${fb}/plex`, apiKey: 'k' })).data.id;
    const d = (await a.get(`/api/plex/${px}/now`)).data;
    assert.equal(d.cont.length, 2);
    assert.equal(d.cont[0].title, 'Glass Meridian'); assert.ok(Math.abs(d.cont[0].progress - 3.1 / 7.2) < 0.01); assert.equal(d.cont[0].key, '901');
    assert.equal(d.cont[1].title, 'Harbor Lights'); assert.equal(d.cont[1].sub, 'S02E05 The Long Night'); assert.equal(d.cont[1].next, true, 'the next episode, not started yet');
    assert.equal((await a.get(`/api/plex/${px}/img?p=${encodeURIComponent('/library/metadata/90/thumb')}`)).status !== 403, true);
  } finally { await s.stop(); srv.close(); }
});
