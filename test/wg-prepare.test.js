// The WireGuard file from a VPN provider is rewritten so only the VPN apps use the tunnel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

test('provider WireGuard file is rewritten for split routing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-wg-'));
  const src = path.join(dir, 'proton-IN-1.conf');
  fs.writeFileSync(src, [
    '[Interface]', '# Key for goat', 'PrivateKey = aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd28=',
    'Address = 10.2.0.2/32, 2a07:b944::2:2/128', 'DNS = 10.2.0.1, 2a07:b944::2:1', 'PostUp = iptables -A FORWARD -j ACCEPT',
    'Table = auto', 'FwMark = 51820', '', '[Peer]', 'PublicKey = cGVlcnB1YmxpY2tleXBlZXJwdWJsaWNrZXlwZWVyMDA=',
    'AllowedIPs = 0.0.0.0/0, ::/0', 'Endpoint = 146.70.1.1:51820', 'PersistentKeepalive = 25', ''].join('\r\n'));
  const out = execFileSync('sh', [path.join(__dirname, '../goat/wg-prepare.sh'), src], { encoding: 'utf8' });
  assert.match(out, /^\[Interface\]\nTable = 5157\nFwMark = 0x5158\n/, 'its own mark, so its encrypted packets do not loop back into the tunnel');
  assert.equal((out.match(/FwMark/g) || []).length, 1, 'the provider\'s own FwMark is replaced');
  assert.match(out, /^Address = 10\.2\.0\.2\/32$/m);
  assert.match(out, /^AllowedIPs = 0\.0\.0\.0\/0$/m);
  assert.doesNotMatch(out, /DNS|PostUp|Table = auto|::|\r/);
  assert.match(out, /^Endpoint = 146\.70\.1\.1:51820$/m);
  assert.match(out, /^PersistentKeepalive = 25$/m);
  // wg-quick itself must accept the result (checked when it is installed, e.g. in CI).
  try { execFileSync('which', ['wg-quick']); } catch { return; }
  const cfg = path.join(dir, 'goatvpn.conf'); fs.writeFileSync(cfg, out, { mode: 0o600 });
  const stripped = execFileSync('wg-quick', ['strip', cfg], { encoding: 'utf8' });
  assert.match(stripped, /AllowedIPs = 0\.0\.0\.0\/0/); assert.match(stripped, /FwMark = 0x5158/);
  assert.doesNotMatch(stripped, /Table|Address/);
});
