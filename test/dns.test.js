// Name lookups: public DNS servers are added after the container's own when the network's DNS fails TMDB,
// GOAT_DNS sets them outright, and Seerr gets its DNS cache and IPv4 first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const D = require('../goat/dns');

test('resolv.conf is rewritten with the given servers and a short time-out', () => {
  const t = 'search lan\nnameserver 127.0.0.11\noptions ndots:0 timeout:5\n';
  const r = D.rewrite(t, ['127.0.0.11', '1.1.1.1', '8.8.8.8', '9.9.9.9']);
  assert.deepEqual(D.servers(r), ['127.0.0.11', '1.1.1.1', '8.8.8.8'], 'at most three, the own one first');
  assert.match(r, /^search lan$/m); assert.match(r, /^options timeout:2 attempts:2 ndots:0$/m);
  assert.equal(D.rewrite(r, ['1.1.1.1']).match(/GoatMediaStackarr/g).length, 1, 'rewriting again does not pile up');
});

test('GOAT_DNS sets the servers; off leaves the file alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-dns-')), f = path.join(dir, 'resolv.conf');
  fs.writeFileSync(f, 'nameserver 192.168.1.1\n');
  process.env.GOAT_RESOLV = f;
  try {
    assert.equal((await D.check({ GOAT_DNS: 'off' })).state, 'off');
    assert.equal(fs.readFileSync(f, 'utf8'), 'nameserver 192.168.1.1\n');
    const r = await D.check({ GOAT_DNS: '1.1.1.1, 8.8.8.8, not-an-ip' });
    assert.deepEqual(r.servers, ['1.1.1.1', '8.8.8.8']); assert.deepEqual(D.servers(fs.readFileSync(f, 'utf8')), ['1.1.1.1', '8.8.8.8']);
  } finally { delete process.env.GOAT_RESOLV; }
});

test('Seerr gets its DNS cache and IPv4 first, once', () => {
  const { seerrNetwork } = require('../goat/init');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-seerr-')), f = path.join(dir, 'settings.json'), done = path.join(dir, 'done');
  assert.equal(seerrNetwork(f, done), 'no settings yet');
  fs.writeFileSync(f, JSON.stringify({ main: { apiKey: 'k' }, network: { csrfProtection: false, dnsCache: { enabled: false, forceMinTtl: 60 } } }));
  assert.equal(seerrNetwork(f, done), 'set');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.network.forceIpv4First, true); assert.deepEqual(j.network.dnsCache, { forceMinTtl: 60, forceMaxTtl: -1, enabled: true }); assert.equal(j.main.apiKey, 'k');
  j.network.dnsCache.enabled = false; fs.writeFileSync(f, JSON.stringify(j));
  assert.equal(seerrNetwork(f, done), 'kept', 'a later change in Seerr is left alone');
});
