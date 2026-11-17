// Upgrades: what is below the quality its profile wants, and a search for better copies (all, or the ones picked).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('upgrades list what could be better and search for it', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    const rad = (await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: base + '/radarr', apiKey: 'k' })).data.id;
    const son = (await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: base + '/sonarr', apiKey: 'k' })).data.id;
    const d = (await a.get('/api/upgrades')).data.apps;
    const r = d.find(x => x.sid === rad), t = d.find(x => x.sid === son);
    assert.equal(r.total, 2); assert.equal(r.items[0].quality, 'HDTV-720p'); assert.ok(r.items[0].wants, 'the profile it wants is named');
    assert.equal(t.total, 3); assert.equal(t.items[0].title, 'Demo Show S01E01'); assert.equal(t.items[0].sub, 'Chapter 1');

    assert.equal((await a.post('/api/upgrades/search', { sid: rad })).status, 200);
    assert.equal((await a.post('/api/upgrades/search', { sid: son, ids: [901, 902] })).status, 200);
    const cmds = (fake.state.cmds || []).map(x => x.app + ':' + x.name);
    assert.ok(cmds.includes('radarr:CutOffUnmetMoviesSearch'), cmds.join());
    assert.ok(fake.state.cmds.some(x => x.app === 'sonarr' && x.name === 'EpisodeSearch' && x.episodeIds.join() === '901,902'));
    assert.equal((await a.post('/api/upgrades/search', { sid: 'nope' })).status, 404);

    await a.post('/api/users', { name: 'u', password: 'useruser1', role: 'user' });
    const u = client(s.base); await u.post('/api/login', { name: 'u', password: 'useruser1' });
    assert.equal((await u.get('/api/upgrades')).status, 403, 'admins only');
  } finally { await s.stop(); srv.close(); }
});
