// Every app's warnings in one list, with what can be done about them from here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('warnings from every app, errors first, and fixing them', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '60000' }), a = client(s.base); await setup(a);
  try {
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `${fb}/sonarr`, apiKey: 'k' })).data.id;
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    let r = await a.get('/api/warnings');
    assert.equal(r.status, 200);
    const w = r.data.find(x => x.app === 'Sonarr');
    assert.match(w.text, /Indexers unavailable/); assert.equal(w.fix, 'indexers'); assert.equal(w.level, 'warn');
    assert.ok(!r.data.some(x => x.app === 'Radarr'), 'Radarr has nothing to say');
    r = await a.post('/api/warnings/fix', { sid: son, fix: 'indexers' });
    assert.equal(r.status, 200);
    assert.ok(fake.state.calls.some(c => /^sonarr POST \/api\/v3\/indexer\/testall/.test(c))); assert.ok(fake.state.calls.some(c => /^sonarr POST \/api\/v3\/command .*CheckHealth/.test(c)));
    assert.equal((await a.post('/api/warnings/fix', { sid: son, fix: 'rm -rf' })).status, 400);
    await a.post('/api/users', { name: 'u', password: 'useruser1', role: 'user' });
    const u = client(s.base); await u.post('/api/login', { name: 'u', password: 'useruser1' });
    assert.equal((await u.get('/api/warnings')).status, 403, 'admins only');
  } finally { await s.stop(); srv.close(); }
});
