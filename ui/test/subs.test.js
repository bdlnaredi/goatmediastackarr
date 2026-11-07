// Subtitles for one title: its Bazarr language profile, what it has and misses, and a search for the rest.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('subtitles per title through Bazarr', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const rd = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' })).data.id;
    const sn = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    assert.equal((await a.get(`/api/subs?sid=${rd}&id=2&kind=movie`)).status, 404, 'no Bazarr yet');
    await a.post('/api/services', { type: 'bazarr', name: 'Bazarr', url: `${fb}/bazarr`, apiKey: 'k' });
    let d = (await a.get(`/api/subs?sid=${rd}&id=2&kind=movie`)).data;
    assert.equal(d.known, true); assert.equal(d.profile, 1); assert.equal(d.profiles.length, 2);
    assert.deepEqual(d.have.map(x => x.code), ['hi']); assert.deepEqual(d.missing.map(x => x.code), ['en']);
    assert.equal((await a.put('/api/subs', { sid: rd, id: 2, kind: 'movie', profile: 2 })).status, 200);
    assert.equal((await a.get(`/api/subs?sid=${rd}&id=2&kind=movie`)).data.profile, 2);
    assert.equal((await a.post('/api/subs/find', { sid: rd, id: 2, kind: 'movie' })).status, 200);
    assert.ok(fake.state.calls.some(c => c.includes('bazarr search-missing movies 2')));
    d = (await a.get(`/api/subs?sid=${sn}&id=1&kind=series`)).data;
    assert.equal(d.profile, 1); assert.equal(d.missingEps, 1);
    assert.equal((await a.put('/api/subs', { sid: sn, id: 1206, kind: 'episode', profile: null })).status, 200, 'an episode sets its show');
    assert.ok(fake.state.calls.some(c => c === 'bazarr profile series 1 none'));
    assert.equal((await a.post('/api/subs/find', { sid: sn, id: 1206, kind: 'episode' })).status, 200);
    assert.ok(fake.state.calls.some(c => c.startsWith('bazarr episodes ') && c.includes('episodeid=1206')));
    assert.equal((await a.get(`/api/subs?sid=${sn}&id=1&kind=movie`)).status, 400);
  } finally { await s.stop(); srv.close(); }
});
