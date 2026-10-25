// Settings → Backup: the backups of the whole stack, as the web page sees them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { tmp, boot, client, setup } = require('./helpers');

test('list, schedule, back up now, put back, download and delete, for admins only', async () => {
  const dir = tmp(), run = tmp(), bk = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ services: [] }));
  const name = 'stack-manual-2026-10-25-061500123.tar.gz';
  fs.writeFileSync(path.join(bk, name), 'archive bytes'); fs.writeFileSync(path.join(bk, name + '.json'), JSON.stringify({ parts: ['sonarr', 'goat'] }));
  fs.writeFileSync(path.join(bk, 'notes.txt'), 'not a backup');
  fs.writeFileSync(path.join(run, 'stackbackup.json'), JSON.stringify({ kind: 'backup', running: false, ok: true, finished: Date.now(), result: { name } }));
  const sock = path.join(run, 'control.sock'), got = [];
  const ctl = net.createServer(s => s.on('data', d => { const m = JSON.parse(String(d)); got.push(m); s.end(JSON.stringify({ ok: true, started: true }) + '\n'); }));
  await new Promise(r => ctl.listen(sock, r));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_CONTROL_SOCK: sock, GOAT_BACKUP_DIR: bk, GOAT_BIN: path.join(__dirname, '..', '..', 'goat') }, dir);
  try {
    const a = client(s.base); await setup(a);
    let r = await a.get('/api/stack/backups');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.files.map(f => [f.name, f.kind, f.parts]), [[name, 'manual', ['sonarr', 'goat']]], 'only backups are listed');
    assert.equal(r.data.parts.sonarr, 'Sonarr'); assert.equal(r.data.cfg.on, false); assert.equal(r.data.job.ok, true);
    assert.equal((await a.put('/api/stack/backups/config', { on: true, weekly: true, day: 3, hour: 2, keep: 99 })).status, 200);
    r = await a.get('/api/stack/backups');
    assert.deepEqual([r.data.cfg.on, r.data.cfg.weekly, r.data.cfg.day, r.data.cfg.hour, r.data.cfg.keep], [true, true, 3, 2, 60]);
    assert.equal((await a.post('/api/stack/backups/run', { only: ['sonarr'] })).status, 200);
    assert.equal((await a.post('/api/stack/backups/restore', { name, only: ['sonarr'] })).status, 200);
    assert.equal((await a.post('/api/stack/backups/restore', { name: '../../x' })).status, 400);
    assert.deepEqual(got.map(g => [g.cmd, g.name || '', g.only]), [['stack-backup', '', ['sonarr']], ['stack-restore', name, ['sonarr']]]);
    const dl = await fetch(s.base + '/api/stack/backups/' + name, { headers: { Cookie: a.cookie } });
    assert.equal(dl.status, 200); assert.equal(await dl.text(), 'archive bytes'); assert.match(dl.headers.get('content-disposition'), /attachment/);
    assert.equal((await a.get('/api/stack/backups/notes.txt')).status, 404);
    assert.equal((await a.del('/api/stack/backups/' + name)).status, 200); assert.equal(got[got.length - 1].cmd, 'stack-remove');
    // Not for regular users.
    await a.post('/api/users', { name: 'kid', password: 'kid-password-1', role: 'user' });
    const k = client(s.base); await k.post('/api/login', { name: 'kid', password: 'kid-password-1' });
    assert.equal((await k.get('/api/stack/backups')).status, 403);
    assert.equal((await fetch(s.base + '/api/stack/backups/' + name, { headers: { Cookie: k.cookie } })).status, 403);
  } finally { await s.stop(); ctl.close(); }
});
