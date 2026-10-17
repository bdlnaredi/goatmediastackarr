// Interactive search results show the language and a link to the release page, and never pass on a link that carries a key.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('interactive search: language, a page link, and no secret links', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({}), a = client(s.base); await setup(a);
  try {
    const sid = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `http://127.0.0.1:${srv.address().port}/radarr`, apiKey: 'k' })).data.id;
    const r = (await a.get(`/api/releases?sid=${sid}&id=1`)).data;
    assert.equal(r.length, 3);
    const by = t => r.find(x => x.title.includes(t));
    assert.deepEqual(by('WEB-DL').langs, ['English']); assert.equal(by('WEB-DL').link, 'https://tracker.example/details/12345'); assert.equal(by('WEB-DL').protocol, 'torrent');
    assert.deepEqual(by('MULTi').langs, ['English', 'French', 'German']); assert.equal(by('MULTi').link, 'https://tracker2.example/torrent/987', 'falls back to the guid when it is a web address');
    assert.deepEqual(by('HDTV').langs, []); assert.equal(by('HDTV').link, '', 'a link with a passkey is never passed on');
    assert.ok(!JSON.stringify(r).includes('SECRET123'));
  } finally { await s.stop(); srv.close(); }
});
