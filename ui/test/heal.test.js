// Self-healing: failed and stuck downloads are removed, blocked and searched again; the rest is left alone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('failed and stuck downloads are fixed, moving ones are not, and every fix is written down', async () => {
  let left = 500;
  const recs = () => [
    { id: 1, downloadId: 'A', title: 'Failed.Show.S01E01', status: 'failed', trackedDownloadState: 'failed', errorMessage: 'Unpacking failed', sizeleft: 100 },
    { id: 2, downloadId: 'B', title: 'Stuck.Show.S01E02', status: 'downloading', trackedDownloadState: 'downloading', sizeleft: 900 },
    { id: 3, downloadId: 'C', title: 'Moving.Show.S01E03', status: 'downloading', trackedDownloadState: 'downloading', sizeleft: (left -= 10) },
    { id: 4, downloadId: 'D', title: 'Paused.Show.S01E04', status: 'paused', trackedDownloadState: 'downloading', sizeleft: 700 },
    { id: 5, downloadId: 'E', title: 'Import.Show.S01E05', status: 'completed', trackedDownloadState: 'importPending', sizeleft: 0 },
  ].filter(x => !gone.has(x.id));
  const gone = new Set(), deletes = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'DELETE' && /^\/api\/v3\/queue\/\d+$/.test(u.pathname)) { const id = +u.pathname.split('/').pop(); gone.add(id); deletes.push([id, u.search]); res.end('{}'); return; }
    if (u.pathname === '/api/v3/queue') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ records: recs() })); return; }
    if (u.pathname === '/api/v3/system/status') { res.setHeader('Content-Type', 'application/json'); res.end('{"version":"4"}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end('[]');
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot({ MONITOR_MS: '250', HEAL_MS: '250', HEAL_HOUR_MS: '300' });
  try {
    const a = client(s.base); await setup(a);
    let r = await a.get('/api/heal');
    assert.deepEqual(r.data.cfg, { on: true, stuck: true, failed: true, apps: true, hours: 24 }, 'on by default, 24 hours');
    assert.equal((await a.put('/api/heal', { on: true, stuck: true, failed: true, apps: true, hours: 2 })).data.cfg.hours, 2);
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `http://127.0.0.1:${srv.address().port}`, apiKey: 'k' });
    for (let i = 0; i < 60 && deletes.length < 2; i++) await sleep(100);
    await sleep(600);
    assert.deepEqual(deletes.map(d => d[0]).sort(), [1, 2], 'only the failed and the stuck one');
    assert.equal(deletes[0][1], '?removeFromClient=true&blocklist=true&skipRedownload=false', 'removed, blocked, searched again');
    r = await a.get('/api/heal');
    assert.deepEqual(r.data.log.map(x => x.title).sort(), ['Failed.Show.S01E01', 'Stuck.Show.S01E02']);
    assert.match(r.data.log.find(x => x.title.startsWith('Failed')).what, /failed \(Unpacking failed\)/);
    assert.match(r.data.log.find(x => x.title.startsWith('Stuck')).what, /no progress for 2 hours/);
    const n = (await a.get('/api/notifications')).data;
    assert.ok((n.items || n).some(x => /fixed by itself/.test(x.title)), 'admins are told');
    // Turned off: nothing more is touched.
    await a.put('/api/heal', { on: false, stuck: true, failed: true, apps: true, hours: 2 });
    gone.clear(); const before = deletes.length; await sleep(1200);
    assert.equal(deletes.length, before);
  } finally { await s.stop(); srv.close(); }
});
