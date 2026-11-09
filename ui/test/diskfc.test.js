// Disk space forecast: how soon a disk fills, from two weeks of free space; samples once an hour from Sonarr and Radarr.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const F = require('../lib/diskfc');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');
const D = F.DAY, now = Date.UTC(2026, 10, 9, 12);

test('the forecast follows the trend', () => {
  // 100 GB used a day, 500 GB free now: about 5 days.
  const pts = Array.from({ length: 10 * 24 }, (_, i) => [now - (10 * 24 - 1 - i) * 3600e3, 500e9 + (10 * 24 - 1 - i) * 100e9 / 24]);
  const f = F.forecast(pts, now);
  assert.equal(f.enough, true); assert.ok(Math.abs(f.perDay - 100e9) < 1e8, String(f.perDay)); assert.ok(Math.abs(f.days - 5) < 0.1, String(f.days));
  // Freeing up: no day.
  assert.equal(F.forecast(pts.map(([t, v]) => [t, 2000e9 - v]), now).days, null);
  // Too little: one day of samples.
  assert.equal(F.forecast(pts.slice(-24), now).enough, false);
  // One sample a day for the chart.
  assert.ok([10, 11].includes(F.daily(pts, now).length), 'one a calendar day');
});

test('samples are taken and shown under each disk on Health', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const fb = `http://127.0.0.1:${srv.address().port}`, s = await boot({ MONITOR_MS: '150', DISK_SAMPLE_EVERY: '2', DISK_SAMPLE_GAP_MS: '1' }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: `${fb}/radarr`, apiKey: 'k' });
    let d; for (let i = 0; i < 60; i++) { await sleep(150); d = ((await a.get('/api/libhealth')).data.find(x => x.type === 'radarr') || {}).disks || []; if (d.some(x => x.fc)) break; }
    const mv = d.find(x => x.path === '/movies');
    assert.ok(mv && mv.fc, JSON.stringify(d)); assert.equal(mv.fc.enough, false, 'too early to say'); assert.equal(mv.fc.free, 60e9);
  } finally { await s.stop(); srv.close(); }
});
