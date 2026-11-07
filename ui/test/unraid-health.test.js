// Unraid health in alerts: a hot disk, a disabled disk, new read/write errors, a SMART warning and a parity check that ends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

test('disk and parity problems reach the admins once each', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await new Promise(r => srv.once('listening', r));
  const st = fake.state, s = await boot({ MONITOR_MS: '80' }), a = client(s.base); await setup(a);
  const disks = (over = {}) => [1, 2].map(n => ({ name: 'disk' + n, temp: 34, status: 'DISK_OK', numErrors: 0, ...(over['disk' + n] || {}) }));
  st.uDisks = disks(); st.parity = { status: 'RUNNING', progress: 40, errors: 0, running: true };
  try {
    await a.post('/api/services', { type: 'unraid', name: 'Tower', url: `http://127.0.0.1:${srv.address().port}/unraid`, apiKey: 'k' });
    assert.equal((await a.put('/api/alerts', { diskTemp: 50 })).status, 200);
    assert.equal((await a.get('/api/alerts')).data.diskTemp, 50);
    const titles = async () => ((await a.get('/api/notifications')).data.items || []).map(x => x.title);
    const wait = async t => { for (let i = 0; i < 120; i++) { if ((await titles()).includes(t)) return true; await sleep(80); } return false; };
    await sleep(2500);   // a first look, so errors already there are not news
    st.uDisks = disks({ disk1: { temp: 52 }, disk2: { status: 'DISK_DSBL', numErrors: 7 } });
    st.smart = [{ name: 'disk1', device: 'sdb', smartStatus: 'FAILED' }];
    st.parity = { status: 'OK', progress: 100, errors: 3, running: false };
    for (const t of ['disk1 is too hot', 'disk2 has a problem', 'disk2 has errors', 'SMART warning for disk1', 'Parity check found errors']) assert.ok(await wait(t), t);
    await sleep(800);
    const l = await titles();
    assert.equal(l.filter(t => t === 'disk1 is too hot').length, 1, 'told once'); assert.equal(l.filter(t => t === 'disk2 has a problem').length, 1);
  } finally { await s.stop(); srv.close(); }
});
