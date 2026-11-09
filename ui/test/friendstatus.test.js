// The friends' status page: off until turned on, no sign-in, only the apps the admin picked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('status page: on and off, chosen apps, a message, nothing else', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ MONITOR_MS: '200' }), a = client(s.base); await setup(a);
  try {
    const ids = {}; for (const t of ['plex', 'seerr', 'sonarr', 'radarr', 'tautulli']) ids[t] = (await a.post('/api/services', { type: t, name: t[0].toUpperCase() + t.slice(1), url: `${fb}/${t}`, apiKey: 'k' })).data.id;
    const anon = async u => { const r = await fetch(s.base + u); return { status: r.status, text: await r.text() }; };
    assert.equal((await anon('/status')).status, 404, 'off until turned on');
    let c = (await a.get('/api/statuspage')).data;
    assert.deepEqual(c.apps.sort(), [ids.plex, ids.seerr].sort(), 'Plex and Seerr unless chosen otherwise');
    await a.put('/api/statuspage', { on: true, title: 'Family Movies', note: 'Plex restarts at 11 tonight <b>!</b>' });
    for (let i = 0; i < 40; i++) { await sleep(150); const d = JSON.parse((await anon('/status.json')).text); if (d.apps.every(x => x.ok != null)) break; }
    const d = JSON.parse((await anon('/status.json')).text);
    assert.equal(d.title, 'Family Movies'); assert.equal(d.state, 'up');
    assert.deepEqual(d.apps.map(x => x.name), ['Watching (Plex)', 'Requests', 'New downloads']);
    assert.ok(!JSON.stringify(d).includes(fb) && !JSON.stringify(d).includes('Tautulli'), 'no addresses, nothing not picked');
    const h = await anon('/status');
    assert.equal(h.status, 200); assert.match(h.text, /Everything is working/); assert.match(h.text, /Plex restarts at 11 tonight &lt;b&gt;!&lt;\/b&gt;/, 'the message is shown as text');
    // Only some apps, no downloads line; Sonarr down shows as down.
    await a.put('/api/statuspage', { apps: [ids.sonarr], downloads: false });
    fake.state.down = 'sonarr';
    let st; for (let i = 0; i < 40; i++) { await sleep(150); st = JSON.parse((await anon('/status.json')).text); if (st.state === 'down') break; }
    assert.deepEqual(st.apps.map(x => [x.name, x.ok]), [['Sonarr', false]]); assert.equal(st.state, 'down');
    // Admins only can change it.
    await a.post('/api/users', { name: 'sam', password: 'samsamsam', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'sam', password: 'samsamsam' });
    assert.equal((await k.put('/api/statuspage', { on: false })).status, 403);
    await a.put('/api/statuspage', { on: false }); assert.equal((await anon('/status.json')).status, 404);
  } finally { await s.stop(); srv.close(); }
});
