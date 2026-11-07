// VPN extras: the fastest PIA regions from here, a speed test through the VPN and without, and an alert when the
// forwarded port stops working.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), net = require('node:net');
const fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup, sleep } = require('./helpers');
const fakes = require('../lib/demo');

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('fastest PIA regions and the speed test', async () => {
  const ping = net.createServer(c => c.end()), pp = await listen(ping);
  const dir = tmp(), rf = path.join(dir, 'regions.json');
  const reg = (id, name, pf, ip) => ({ id, name, country: 'NL', port_forward: pf, offline: false, servers: { wg: [{ ip, cn: id + '1' }], meta: [{ ip, cn: id + 'm' }] } });
  fs.writeFileSync(rf, JSON.stringify({ regions: [reg('nl', 'Netherlands', true, '127.0.0.1'), reg('de', 'Germany', false, '127.0.0.1'), reg('xx', 'Nowhere', true, '10.255.255.1')] }) + '\n');
  // The speed test site, and the site helper the VPN apps use (it fetches the address it is given).
  const speed = http.createServer((req, res) => { const n = +new URL(req.url, 'http://x').searchParams.get('bytes') || 0; if (req.url.startsWith('/__up')) { req.resume(); req.on('end', () => res.end('ok')); return; } res.end(Buffer.alloc(n)); });
  const sp = await listen(speed);
  let viaHelper = 0;
  const helper = http.createServer(async (req, res) => { viaHelper++; const ch = []; for await (const c of req) ch.push(c); const m = req.headers['x-goat-method'];
    const r = await fetch(req.headers['x-goat-url'], { method: m, body: ['GET', 'HEAD'].includes(m) ? undefined : Buffer.concat(ch) }); res.writeHead(200, { 'X-Goat-Status': String(r.status), 'X-Goat-Headers': Buffer.from('{}').toString('base64') }); res.end(Buffer.from(await r.arrayBuffer())); });
  const hp = await listen(helper);
  const s = await boot({ PIA_REGIONS_FILE: rf, PIA_PING_PORT: String(pp), SPEEDTEST_URL: `http://127.0.0.1:${sp}`, SITEFETCH_URL: `http://127.0.0.1:${hp}` });
  try {
    const a = client(s.base); await setup(a);
    let l = (await a.get('/api/goat/pia/fastest')).data;
    assert.deepEqual(l.map(x => x.id).sort(), ['de', 'nl'], 'the one that does not answer is left out'); assert.ok(l.every(x => x.ms >= 0));
    l = (await a.get('/api/goat/pia/fastest?pf=1')).data; assert.deepEqual(l.map(x => x.id), ['nl'], 'port forwarding only');
    assert.equal((await a.get('/api/goat/vpn/speed')).data, null);
    const r = await a.post('/api/goat/vpn/speed', {});
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(r.data.vpn.down > 0 && r.data.vpn.up > 0 && r.data.direct.down > 0, JSON.stringify(r.data));
    assert.equal(viaHelper, 3, 'three trips through the VPN');
    assert.equal((await a.get('/api/goat/vpn/speed')).data.at, r.data.at, 'the last result is kept');
  } finally { await s.stop(); ping.close(); speed.close(); helper.close(); }
});

test('an alert when the forwarded port stops working, and when it works again', async () => {
  const fake = fakes.create(), srv = http.createServer((req, res) => fake.handle(req, res, req.url)), port = await listen(srv);
  const dir = tmp(), run = tmp(), cfg = tmp(), mf = path.join(dir, 'managed.json');
  fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [{ key: 'qbittorrent', type: 'qbittorrent', name: 'qBittorrent', url: `http://127.0.0.1:${port}/qbittorrent`, user: 'goat', pass: 'p' }] }));
  fs.writeFileSync(path.join(run, 'vpn.json'), JSON.stringify({ enabled: true, state: 'up', ip: '1.2.3.4', port: '51234' }));
  fs.mkdirSync(path.join(cfg, 'goat'), { recursive: true }); fs.writeFileSync(path.join(cfg, 'goat', 'settings.json'), JSON.stringify({ vpn: { portForward: 'pia' } }));
  fake.state.conn = 'firewalled';
  const s = await boot({ GOAT_MANAGED: mf, GOAT_RUN: run, GOAT_CONFIG_DIR: cfg, MONITOR_MS: '100' }, dir);
  try {
    const a = client(s.base); await setup(a);
    const seen = async t => { for (let i = 0; i < 150; i++) { const f = (await a.get('/api/notifications')).data; if ((f.items || []).some(x => x.title === t)) return true; await sleep(100); } return false; };
    assert.ok(await seen('Forwarded port not working'));
    fake.state.conn = 'connected';
    assert.ok(await seen('Forwarded port working again'));
  } finally { await s.stop(); srv.close(); }
});
