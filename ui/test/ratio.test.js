// Ratio and seeding: per tracker totals, torrents that have not met their tracker's rule, asking before removing one,
// and Needs attention for one that is not seeding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('torrents below their tracker rule are listed, asked about before removing, and flagged when not seeding', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot(), a = client(s.base); await setup(a);
  try {
    const sv = (await a.post('/api/services', { type: 'qbittorrent', name: 'qBittorrent', url: `${fb}/qbittorrent`, user: 'u', pass: 'p' })).data;
    const id = sv.id || (await a.get('/api/services')).data.find(x => x.type === 'qbittorrent').id;
    const gm = fake.state.torrents[2];   // private-hd.net, finished, ratio 1.2, 4 hours seeding
    Object.assign(gm, { ratio: 0.4, uploaded: 4e9, downloaded: 10e9 });
    let r = (await a.get('/api/ratio')).data;
    assert.equal(r.rules, false); assert.equal(r.risk.length, 0, 'no rules: nothing at risk');
    // The tracker asks for 7 days or a ratio of 1 (seed goals can stay off).
    await a.put('/api/seedgoals', { on: false, cats: ['tv', 'movies'], rules: [{ tracker: 'private-hd.net', ratio: 1, days: 7 }] });
    r = (await a.get('/api/ratio')).data;
    const t = r.trackers.find(x => x.host === 'private-hd.net');
    assert.equal(t.n, 1); assert.equal(t.up, 4e9); assert.equal(t.ratio, 0.4); assert.equal(t.risk, 1); assert.deepEqual(t.rule, { tracker: 'private-hd.net', ratio: 1, days: 7, how: 'either' });
    assert.equal(r.risk.length, 1); assert.equal(r.risk[0].hash, gm.hash); assert.match(r.risk[0].need, /ratio 1 \(now 0\.40\) or 7 days seeding \(now 0\)/); assert.equal(r.risk[0].stopped, false);
    // Removing it asks first; with force it goes.
    let d = await a.post(`/api/qb/${id}/act`, { action: 'delete', hashes: [gm.hash] });
    assert.equal(d.status, 409); assert.equal(d.data.risk[0].name, gm.name);
    assert.ok(fake.state.torrents.includes(gm), 'still there');
    // Not seeding: Needs attention says so.
    gm.state = 'pausedUP';
    const w = (await a.get('/api/warnings')).data.filter(x => /not seeding/.test(x.text));
    assert.equal(w.length, 1); assert.match(w[0].text, /hit and run/);
    // One that met its rule goes without asking.
    gm.ratio = 1.5; d = await a.post(`/api/qb/${id}/act`, { action: 'delete', hashes: [gm.hash] }); assert.equal(d.status, 200);
  } finally { await s.stop(); srv.close(); }
});
