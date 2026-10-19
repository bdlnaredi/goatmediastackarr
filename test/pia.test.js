// PIA: sign in, the region list, registering a WireGuard key and port forwarding, against a pretend PIA that has
// its own certificate authority, like the real one. Proves the checks and the WireGuard file, not PIA itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), https = require('node:https');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-pia-'));
const ssl = (...a) => execFileSync('openssl', a, { cwd: dir, stdio: 'pipe' });
// A pretend PIA authority, and a server certificate from it named "testserver401" (PIA names servers in the CN).
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Pretend PIA');
ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=testserver401');
ssl('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.crt', '-days', '2');
// And one from somebody else, which must be refused.
ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'evil.key', '-out', 'evil.crt', '-days', '2', '-subj', '/CN=testserver401');

const payload = Buffer.from(JSON.stringify({ token: 'x', port: 47123, expires_at: '2026-12-20T00:00:00Z' })).toString('base64');
const seen = [];
const piaApi = cert => https.createServer({ key: fs.readFileSync(path.join(dir, cert + '.key')), cert: fs.readFileSync(path.join(dir, cert + '.crt')) }, (req, res) => {
  const u = new URL(req.url, 'https://x'); seen.push(u.pathname + u.search);
  const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/addKey') return u.searchParams.get('pt') === 'TOKEN-1' && u.searchParams.get('pubkey').length === 44
    ? j({ status: 'OK', server_key: 'SERVERKEY=', server_port: 1337, server_ip: '127.0.0.1', server_vip: '127.0.0.1', peer_ip: '10.9.8.7', dns_servers: ['10.0.0.243'] })
    : j({ status: 'ERROR', message: 'Login failed!' });
  if (u.pathname === '/getSignature') return j(u.searchParams.get('token') === 'TOKEN-1' ? { status: 'OK', payload, signature: 'SIG' } : { status: 'ERROR' });
  if (u.pathname === '/bindPort') return j(u.searchParams.get('signature') === 'SIG' ? { status: 'OK', message: 'port scheduled for add' } : { status: 'ERROR' });
  res.writeHead(404); res.end();
});
const site = http.createServer((req, res) => {
  if (req.url === '/servers') { res.writeHead(200); return res.end(JSON.stringify({ regions: [
    { id: 'uk_london', name: 'UK London', country: 'GB', port_forward: false, servers: { meta: [{ ip: '127.0.0.1', cn: 'testserver401' }], wg: [{ ip: '127.0.0.1', cn: 'testserver401' }] } },
    { id: 'swiss', name: 'Switzerland', country: 'CH', port_forward: true, servers: { meta: [{ ip: '127.0.0.1', cn: 'testserver401' }], wg: [{ ip: '127.0.0.1', cn: 'testserver401' }] } },
    { id: 'gone', name: 'Gone', country: 'XX', offline: true, servers: { wg: [{ ip: '127.0.0.1', cn: 'x' }] } },
  ] }) + '\n\nSIGNATURE-LINES'); }
  if (req.url === '/token' && req.method === 'POST') { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(/name="username"\r\n\r\np1234567\r\n/.test(b) && /name="password"\r\n\r\nright\r\n/.test(b) ? { token: 'TOKEN-1' } : { message: 'Authentication failed' })); }); return; }
  res.writeHead(404); res.end();
});
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));

test('PIA: regions, sign-in, a WireGuard file for the chosen region, and the forwarded port', async () => {
  const good = piaApi('srv'), evil = piaApi('evil');
  const [wp, ep, sp] = await Promise.all([listen(good), listen(evil), listen(site)]);
  Object.assign(process.env, { PIA_SERVERLIST_URL: `http://127.0.0.1:${sp}/servers`, PIA_TOKEN_URL: `http://127.0.0.1:${sp}/token`, PIA_CA: path.join(dir, 'ca.crt'), PIA_WG_PORT: String(wp), PIA_PF_PORT: String(wp) });
  const pia = require('../goat/pia');
  try {
    const list = await pia.regions();
    assert.deepEqual(list.map(r => r.id), ['swiss', 'uk_london'], 'offline regions are left out, the rest sorted by name');
    assert.equal(list.find(r => r.id === 'swiss').pf, true);

    await assert.rejects(pia.token('p1234567', 'wrong'), /did not accept that username and password/);
    await assert.rejects(pia.token('', ''), /Enter your PIA username/);
    assert.equal(await pia.token('p1234567', 'right'), 'TOKEN-1');

    const out = path.join(dir, 'pia.conf'), state = path.join(dir, 'pia.json');
    const env = { VPN_USER: 'p1234567', VPN_PASS: 'right', VPN_REGION: 'swiss', VPN_PORT_FORWARD: 'pia' };
    assert.deepEqual(await pia.connect(out, state, env), { region: 'swiss', name: 'Switzerland' });
    const conf = fs.readFileSync(out, 'utf8');
    assert.match(conf, /^\[Interface\]\nAddress = 10\.9\.8\.7\nPrivateKey = [A-Za-z0-9+/]{43}=\nDNS = 10\.0\.0\.243\n/);
    assert.match(conf, /\[Peer\]\nPersistentKeepalive = 25\nPublicKey = SERVERKEY=\nAllowedIPs = 0\.0\.0\.0\/0\nEndpoint = 127\.0\.0\.1:1337\n$/);
    assert.equal((fs.statSync(out).mode & 0o777).toString(8), '600', 'the private key is only readable by root');
    const st = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert.equal(st.host, 'testserver401'); assert.equal(st.token, 'TOKEN-1');
    assert.equal((fs.statSync(state).mode & 0o777).toString(8), '600');

    await assert.rejects(pia.connect(out, state, { ...env, VPN_REGION: 'uk_london' }), /does not allow port forwarding in UK London/);
    await assert.rejects(pia.connect(out, state, { ...env, VPN_REGION: 'atlantis' }), /no PIA region "atlantis"/);
    await assert.rejects(pia.connect(out, state, { ...env, VPN_PASS: 'wrong' }), /did not accept/);

    const p = await pia.port({ PIA_HOST: st.host, PIA_VIP: st.vip, PIA_TOKEN: st.token });
    assert.equal(p.port, 47123); assert.equal(p.signature, 'SIG');
    const before = seen.length, again = await pia.port({ PIA_HOST: st.host, PIA_VIP: st.vip, PIA_TOKEN: st.token, PIA_PAYLOAD: p.payload, PIA_SIG: p.signature });
    assert.equal(again.port, 47123); assert.deepEqual(seen.slice(before).map(x => x.split('?')[0]), ['/bindPort'], 'renewing only binds the same port again');

    // A server whose certificate is not from PIA's authority, or has another name, is refused.
    process.env.PIA_PF_PORT = String(ep);
    await assert.rejects(pia.port({ PIA_HOST: st.host, PIA_VIP: st.vip, PIA_TOKEN: st.token }), /Could not reach the PIA server/);
    process.env.PIA_PF_PORT = String(wp);
    await assert.rejects(pia.port({ PIA_HOST: 'otherserver9', PIA_VIP: st.vip, PIA_TOKEN: st.token }), /Could not reach the PIA server/);

    // The real authority file ships with the helper.
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'goat', 'pia-ca.crt'), 'utf8'), /^-----BEGIN CERTIFICATE-----/);
  } finally { for (const s of [site, good, evil]) { s.closeAllConnections && s.closeAllConnections(); s.close(); } }
});

test('PIA settings are accepted and checked', () => {
  process.env.GOAT_CONFIG_DIR = path.join(dir, 'config');
  const settings = require('../goat/settings');
  settings.update({ vpn: { provider: 'pia', region: 'swiss', portForward: 'pia', user: 'p1234567', pass: 'pw' } });
  const e = settings.effectiveEnv({});
  assert.equal(e.VPN_PROVIDER, 'pia'); assert.equal(e.VPN_REGION, 'swiss'); assert.equal(e.VPN_PORT_FORWARD, 'pia');
  assert.throws(() => settings.update({ vpn: { provider: 'nordvpn' } }), /Invalid/);
  assert.throws(() => settings.update({ vpn: { region: 'swiss; reboot' } }), /Invalid/);
});
