// Data per day: downloads and uploads counted from qBittorrent's counters (a restart starts them again), Usenet from SABnzbd.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('daily downloaded and uploaded data', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ MONITOR_MS: '200' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 6000) => { const t = Date.now(); while (!(await f())) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
  const today = async () => (await a.get('/api/traffic')).data.days.slice(-1)[0];
  try {
    assert.equal((await a.get('/api/traffic')).status, 404, 'nothing to count yet');
    const st = fake.state; st.dlData = 10e9; st.ulData = 2e9;
    await a.post('/api/services', { type: 'qbittorrent', name: 'qB', url: `${fb}/qbittorrent`, user: 'u', pass: 'p' });
    await new Promise(r => setTimeout(r, 700));   // the first look only notes the counters
    assert.equal((await today()).dl, 0);
    st.dlData = 13e9; st.ulData = 2.5e9;
    assert.ok(await wait(async () => (await today()).dl === 3e9), 'what came in since the last look');
    assert.equal((await today()).ul, 0.5e9);
    // qBittorrent restarted: its counters start again from zero, and what it counted since is added.
    st.dlData = 1e9; st.ulData = 0;
    assert.ok(await wait(async () => (await today()).dl === 4e9));
    let r = await a.get('/api/traffic');
    assert.equal(r.data.days.length, 7); assert.equal(r.data.total.dl, 4e9); assert.equal(r.data.total.ul, 0.5e9);
    assert.equal((await a.get('/api/traffic?days=30')).data.days.length, 30);
    // Usenet: SABnzbd's own numbers per day.
    await a.post('/api/services', { type: 'sabnzbd', name: 'SAB', url: `${fb}/sabnzbd`, apiKey: 'k' });
    r = await a.get('/api/traffic');
    assert.equal(r.data.usenetOn, true); assert.equal(r.data.days.slice(-1)[0].usenet, 1.5e9); assert.equal(r.data.days.slice(-2)[0].usenet, 3e9);
    assert.equal(r.data.total.dl, 4e9 + [1, 2, 3, 4, 5, 6, 7].reduce((x, i) => x + i * 1.5e9, 0));
  } finally { await s.stop(); srv.close(); }
});
