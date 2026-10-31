#!/usr/bin/env node
// Name lookups for the apps in this container. Seerr asking TMDB for a movie failed with
// "getaddrinfo EAI_AGAIN api.themoviedb.org": the network's DNS server did not answer in time (or at all) for TMDB,
// which some home routers and internet providers do (several Indian providers block or drop TMDB lookups).
//
// At every start this checks that api.themoviedb.org can be looked up. When the container's DNS server fails it but a
// public one answers, public servers are added after the container's own (so local names still work) with a short
// time-out, and lookups move on to them instead of failing. GOAT_DNS (like "1.1.1.1,8.8.8.8") sets the servers
// outright; GOAT_DNS=off leaves everything alone.
//
//   node dns.js            run the check (as root, before the apps start)
'use strict';
const fs = require('fs'), dns = require('dns');

const RESOLV = () => process.env.GOAT_RESOLV || '/etc/resolv.conf';
const TEST = () => process.env.GOAT_DNS_TEST || 'api.themoviedb.org';
const PUBLIC = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const ipv4 = s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(n => +n < 256);

const servers = text => String(text || '').split('\n').map(l => l.trim().match(/^nameserver\s+(\S+)/)).filter(Boolean).map(m => m[1]);

/** resolv.conf with these servers (first the container's own that are kept, then the extra ones), at most three. */
function rewrite(text, list) {
  const keep = String(text || '').split('\n').filter(l => !/^\s*(nameserver|options)\b/.test(l) && !/GoatMediaStackarr/.test(l));
  const opts = (String(text || '').split('\n').find(l => /^\s*options\b/.test(l)) || 'options').trim().split(/\s+/).slice(1)
    .filter(o => !/^(timeout|attempts):/.test(o));
  return [...keep.filter(l => l.trim()), '# Servers set by GoatMediaStackarr (dns.js): the network DNS could not look up ' + TEST(),
    ...list.slice(0, 3).map(s => 'nameserver ' + s), 'options ' + ['timeout:2', 'attempts:2', ...opts].join(' ')].join('\n') + '\n';
}

const lookup = (name, server, ms = 4000) => new Promise(ok => {
  const r = new dns.Resolver({ timeout: ms, tries: 1 }); if (server) r.setServers([server]);
  r.resolve4(name, (e, a) => ok(!e && a && a.length ? a : null));
});
const systemLookup = (name) => new Promise(ok => dns.lookup(name, { family: 4 }, e => ok(!e)));

async function check(env = process.env) {
  const want = String(env.GOAT_DNS || '').trim(), file = RESOLV();
  if (/^(off|false|no)$/i.test(want)) return { state: 'off' };
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return { state: 'no resolv.conf' }; }
  const cur = servers(text);
  if (want) {
    const list = want.split(/[\s,]+/).filter(ipv4);
    if (!list.length) return { state: 'GOAT_DNS has no IPv4 addresses', servers: cur };
    if (list.join() !== cur.join()) fs.writeFileSync(file, rewrite(text, list));
    return { state: 'set from GOAT_DNS', servers: list };
  }
  if (await systemLookup(TEST())) return { state: 'ok', servers: cur };
  const good = [];
  for (const s of PUBLIC) if (await lookup(TEST(), s)) good.push(s);
  if (!good.length) return { state: 'nothing answers (no internet yet?)', servers: cur };
  // Keep the container's own server first (local names, Docker's own resolver); add public ones after it.
  const own = cur.filter(s => !PUBLIC.includes(s)).slice(0, 1), list = [...own, ...good].slice(0, 3);
  fs.writeFileSync(file, rewrite(text, list));
  const fixed = await systemLookup(TEST());
  return { state: fixed ? 'fixed' : 'still failing', servers: list, was: cur };
}

module.exports = { check, rewrite, servers };

if (require.main === module) {
  check().then(r => {
    const s = (r.servers || []).join(', ');
    if (r.state === 'fixed') console.log(`[goat-dns] Your network's DNS (${(r.was || []).join(', ')}) could not look up ${TEST()}; added public DNS servers: ${s}.`);
    else if (r.state === 'still failing') console.log(`[goat-dns] ${TEST()} still cannot be looked up through ${s}. Your provider may block it; set GOAT_DNS=1.1.1.1,8.8.8.8 or use the VPN for Seerr.`);
    else if (r.state !== 'ok') console.log(`[goat-dns] ${r.state}${s ? ' (' + s + ')' : ''}.`);
  }, e => console.log('[goat-dns] check skipped: ' + e.message));
}
