// Quiet hours: alerts that can wait are held at night and sent as one message after; each person's phone and
// browsers only hear about problems then.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

test('quiet hours hold what can wait, then send it as one message', async () => {
  const got = [], hook = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  const fake = fakes.create({ streams: 1 }), srv = http.createServer((req, res) => fake.handle(req, res, req.url)).listen(0);
  await Promise.all([new Promise(r => srv.once('listening', r)), new Promise(r => hook.once('listening', r))]);
  const s = await boot({ MONITOR_MS: '300' }), a = client(s.base); await setup(a);
  const wait = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise(r => setTimeout(r, 100)); } return true; };
  try {
    await a.post('/api/alerts/channels', { type: 'webhook', name: 'Hook', target: `http://127.0.0.1:${hook.address().port}/`, events: ['playStart'] });
    const now = new Date(), quiet = { on: true, from: hhmm(new Date(now - 3600e3)), to: hhmm(new Date(+now + 3600e3)) };
    let al = (await a.get('/api/alerts')).data;
    assert.equal(al.quiet.on, false); assert.ok(al.quiet.urgent.includes('vpn'), 'the VPN going down is urgent by default');
    await a.put('/api/alerts', { ...al, quiet });
    al = (await a.get('/api/alerts')).data;
    assert.deepEqual({ on: al.quiet.on, from: al.quiet.from, to: al.quiet.to }, quiet);

    // Someone starts watching: held, not sent.
    await a.post('/api/services', { type: 'plex', name: 'Plex', url: `http://127.0.0.1:${srv.address().port}/plex`, apiKey: 'k' });
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(got.length, 0, 'nothing was sent in the quiet hours: ' + JSON.stringify(got));
    assert.ok((await a.get('/api/alerts')).data.held >= 1);

    // Quiet hours end (turned off here): one message with what was held.
    await a.put('/api/alerts', { ...al, quiet: { ...quiet, on: false } });
    assert.ok(await wait(() => got.length > 0));
    assert.match(got[0].title, /^While it was quiet: \d+ alerts?$/);
    assert.match(got[0].message, /started/);
    assert.equal((await a.get('/api/alerts')).data.held, 0);

    // Each person's own quiet hours: the phone app is told it is quiet now (it then shows things silently).
    let r = await a.put('/api/me/quiet', quiet);
    assert.equal(r.data.now, true);
    assert.equal((await a.get('/api/notifications')).data.quiet, true);
    assert.deepEqual((await a.get('/api/me')).data.user.quiet, quiet);
    r = await a.put('/api/me/quiet', { on: true, from: 'nope', to: '25:00' });
    assert.deepEqual(r.data.quiet, { on: true, from: '23:00', to: '08:00' }, 'times that are not times fall back to 23:00–08:00');
  } finally { await s.stop(); srv.close(); hook.close(); }
});
