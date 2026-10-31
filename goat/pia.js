#!/usr/bin/env node
// Private Internet Access (PIA): signs in with your PIA username and password, picks a region, and makes a WireGuard
// connection for it, the way PIA's own scripts do (github.com/pia-foss/manual-connections). Also keeps a forwarded
// port open for qBittorrent. vpn.sh calls this; the interface uses it for the list of regions.
//
//   node pia.js connect OUT.conf STATE.json   env VPN_USER, VPN_PASS, VPN_REGION ('' = fastest), VPN_PORT_FORWARD
//   node pia.js port                          env PIA_HOST, PIA_VIP, PIA_TOKEN [, PIA_PAYLOAD, PIA_SIG]; run through the tunnel
//   node pia.js regions                       prints the regions as JSON
'use strict';
const fs = require('fs'), path = require('path'), https = require('https'), net = require('net'), crypto = require('crypto');

const SERVERLIST = () => process.env.PIA_SERVERLIST_URL || 'https://serverlist.piaservers.net/vpninfo/servers/v6';
const TOKEN_URL = () => process.env.PIA_TOKEN_URL || 'https://www.privateinternetaccess.com/api/client/v2/token';
const CA = () => fs.readFileSync(process.env.PIA_CA || path.join(__dirname, 'pia-ca.crt'));
const WG_PORT = () => +process.env.PIA_WG_PORT || 1337, PF_PORT = () => +process.env.PIA_PF_PORT || 19999;

const fail = msg => Object.assign(new Error(msg), { plain: true });

// The region list that ships in the image (fetched when it was built), so the VPN page never waits on PIA's site.
const BUNDLED = () => process.env.PIA_REGIONS_FILE || path.join(__dirname, 'pia-regions.json');
const parse = text => {
  let list; try { list = JSON.parse(String(text).split('\n')[0]).regions; } catch { throw fail('PIA sent a list of regions this does not understand.'); }
  return (list || []).filter(r => !r.offline && r.servers && (r.servers.wg || []).length)
    .map(r => ({ id: r.id, name: r.name, country: r.country, pf: !!r.port_forward, geo: !!r.geo, wg: r.servers.wg, meta: r.servers.meta || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
const bundled = () => { try { const l = parse(fs.readFileSync(BUNDLED(), 'utf8')); return l.length ? l : null; } catch { return null; } };

/** Every PIA region: id, name, country, whether it allows port forwarding, and its servers.
 *  { local: true } (for the list on the VPN page) uses the built-in list and only asks PIA when there is none;
 *  otherwise (connecting) PIA is asked for the current servers, with the built-in list if PIA cannot be reached. */
async function regions(o = {}) {
  if (o.local) { const b = bundled(); if (b) return b; }
  let text;
  try { text = await (await fetch(SERVERLIST(), { signal: AbortSignal.timeout(15000) })).text(); }
  catch (e) { const b = bundled(); if (b) return b; throw fail('Could not get the list of PIA regions (' + ((e.cause && e.cause.code) || e.message) + ').'); }
  try { return parse(text); } catch (e) { const b = bundled(); if (b) return b; throw e; }
}

/** A sign-in token (valid for a day) from your PIA username and password. */
async function token(user, pass) {
  if (!user || !pass) throw fail('Enter your PIA username (like p1234567) and password.');
  const fd = new FormData(); fd.append('username', user); fd.append('password', pass);
  let r; try { r = await fetch(TOKEN_URL(), { method: 'POST', body: fd, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw fail('Could not reach PIA to sign in (' + ((e.cause && e.cause.code) || e.message) + ').'); }
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw fail('PIA did not accept that username and password. Use the one starting with p (like p1234567), not your email.');
  return j.token;
}

/** How long a TCP connection to the region takes, in ms (or Infinity). */
const latency = (ip, ms = 1200) => new Promise(ok => {
  const t = Date.now(), s = net.connect({ host: ip, port: 443, timeout: ms });
  const done = v => { s.destroy(); ok(v); };
  s.on('connect', () => done(Date.now() - t)); s.on('timeout', () => done(Infinity)); s.on('error', () => done(Infinity));
});

/** The region to use: the one asked for, or else the fastest from here (only ones with port forwarding when it is on). */
async function pick(list, want, needPf) {
  if (want) { const r = list.find(x => x.id === want); if (!r) throw fail(`There is no PIA region "${want}". Pick one from the list on the Stack page.`); return r; }
  const pool = list.filter(r => !needPf || r.pf);
  const times = await Promise.all(pool.map(async r => [r, await latency((r.meta[0] || r.wg[0]).ip)]));
  const best = times.filter(([, t]) => t < Infinity).sort((a, b) => a[1] - b[1])[0];
  if (!best) throw fail('None of the PIA regions answered. Check this server\'s internet connection.');
  return best[0];
}

/** HTTPS to a PIA server by its address, checking its certificate against PIA's own authority (like curl --connect-to). */
function piaGet(ip, host, port, pathAndQuery) {
  return new Promise((ok, no) => {
    const req = https.request({ host: ip, port, path: pathAndQuery, method: 'GET', servername: host, ca: CA(), timeout: 10000,
      // PIA's servers are named in the certificate's common name (like "london401"); the certificate must also come from
      // PIA's own authority (ca above), so nobody else can answer in its place.
      checkServerIdentity: (h, cert) => {
        const names = [cert.subject && cert.subject.CN, ...String(cert.subjectaltname || '').split(',').map(x => x.trim().replace(/^DNS:/, ''))];
        return names.includes(host) ? undefined : new Error(`The server is not ${host}`);
      } }, res => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { ok(JSON.parse(b)); } catch { no(fail('PIA answered something unexpected.')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timed out'))); req.on('error', e => no(fail('Could not reach the PIA server (' + (e.code || e.message) + ').')));
    req.end();
  });
}

/** A new WireGuard key pair, in the base64 form WireGuard uses. */
function keys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const b = s => Buffer.from(s, 'base64url').toString('base64');
  return { pub: b(publicKey.export({ format: 'jwk' }).x), priv: b(privateKey.export({ format: 'jwk' }).d) };
}

/** Signs in, picks the region, registers a new key there and writes the WireGuard file. */
async function connect(out, state, env = process.env) {
  const needPf = String(env.VPN_PORT_FORWARD || '').toLowerCase() === 'pia';
  const [list, tk] = await Promise.all([regions(), token(env.VPN_USER, env.VPN_PASS)]);
  const r = await pick(list, String(env.VPN_REGION || '').trim(), needPf);
  if (needPf && !r.pf) throw fail(`PIA does not allow port forwarding in ${r.name}. Pick a region marked with port forwarding, or turn it off.`);
  const s = r.wg[Math.floor(Math.random() * r.wg.length)], k = keys();
  const j = await piaGet(s.ip, s.cn, WG_PORT(), `/addKey?pt=${encodeURIComponent(tk)}&pubkey=${encodeURIComponent(k.pub)}`);
  if (j.status !== 'OK') throw fail('The PIA server did not accept the connection (' + String(j.message || j.status || 'no reason given').slice(0, 120) + ').');
  const conf = `[Interface]\nAddress = ${j.peer_ip}\nPrivateKey = ${k.priv}\nDNS = ${(j.dns_servers || [])[0] || '10.0.0.243'}\n\n[Peer]\nPersistentKeepalive = 25\nPublicKey = ${j.server_key}\nAllowedIPs = 0.0.0.0/0\nEndpoint = ${s.ip}:${j.server_port}\n`;
  fs.writeFileSync(out, conf, { mode: 0o600 });
  fs.writeFileSync(state, JSON.stringify({ region: r.id, name: r.name, pf: r.pf, host: s.cn, vip: j.server_vip, token: tk }), { mode: 0o600 });
  return { region: r.id, name: r.name };
}

/** Gets (once per connection) and renews (every 15 minutes) the forwarded port. Must run through the tunnel. */
async function port(env = process.env) {
  const host = env.PIA_HOST, vip = env.PIA_VIP; let payload = env.PIA_PAYLOAD, signature = env.PIA_SIG;
  if (!payload || !signature) {
    const j = await piaGet(vip, host, PF_PORT(), `/getSignature?token=${encodeURIComponent(env.PIA_TOKEN || '')}`);
    if (j.status !== 'OK') throw fail('PIA did not give a forwarded port (' + String(j.message || j.status || '').slice(0, 120) + ').');
    payload = j.payload; signature = j.signature;
  }
  const b = await piaGet(vip, host, PF_PORT(), `/bindPort?payload=${encodeURIComponent(payload)}&signature=${encodeURIComponent(signature)}`);
  if (b.status !== 'OK') throw fail('PIA did not keep the forwarded port open (' + String(b.message || b.status || '').slice(0, 120) + ').');
  const info = JSON.parse(Buffer.from(payload, 'base64').toString());
  return { port: info.port, expires: info.expires_at, payload, signature };
}

module.exports = { regions, token, pick, connect, port, keys };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  const run = cmd === 'connect' ? connect(a, b) : cmd === 'port' ? port() : cmd === 'regions' ? regions({ local: a === '--local' }).then(l => l.map(({ wg, meta, ...x }) => x)) : Promise.reject(fail('Use: pia.js connect|port|regions'));
  run.then(x => { process.stdout.write(JSON.stringify(x) + '\n'); }, e => { process.stderr.write((e.plain ? e.message : 'PIA: ' + e.message) + '\n'); process.exit(1); });
}
