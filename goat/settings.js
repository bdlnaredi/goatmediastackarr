'use strict';
// Settings changed in the GoatMediaStackarr interface live in /config/goat/settings.json and take priority
// over the container's environment (the Unraid template). Everything that reads settings goes through here.
//
//   node settings.js env     prints `export NAME='value'` lines for shell scripts (vpn-init.sh, vpn.sh, engine.sh)

const fs = require('fs');
const path = require('path');

const CONFIG = process.env.GOAT_CONFIG_DIR || '/config';
const FILE = () => path.join(CONFIG, 'goat', 'settings.json');

// Which settings the interface may change, and the environment variable each one stands for.
const MAP = {
  'vpn.enabled': 'VPN_ENABLED', 'vpn.type': 'VPN_TYPE', 'vpn.apps': 'VPN_APPS', 'vpn.user': 'VPN_USER', 'vpn.pass': 'VPN_PASS',
  'vpn.dns': 'VPN_DNS', 'vpn.portForward': 'VPN_PORT_FORWARD', 'vpn.pfGateway': 'VPN_PF_GATEWAY',
  'plex.claim': 'PLEX_CLAIM', 'plex.update': 'PLEX_UPDATE', 'plex.url': 'PLEX_URL', 'plex.token': 'PLEX_TOKEN', 'seerr.mediaServer': 'SEERR_MEDIA_SERVER',
};
const ALLOWED = {
  'vpn.enabled': v => typeof v === 'boolean',
  'vpn.type': v => ['wireguard', 'openvpn'].includes(v),
  'vpn.apps': v => Array.isArray(v) && v.every(a => typeof a === 'string' && /^[a-z]+$/.test(a)),
  'vpn.user': v => typeof v === 'string' && v.length <= 200 && !/[\r\n]/.test(v),
  'vpn.pass': v => typeof v === 'string' && v.length <= 200 && !/[\r\n]/.test(v),
  'vpn.dns': v => v === '' || /^\d{1,3}(\.\d{1,3}){3}$/.test(v),
  'vpn.portForward': v => ['off', 'natpmp'].includes(v),
  'vpn.pfGateway': v => v === '' || /^\d{1,3}(\.\d{1,3}){3}$/.test(v),
  'plex.claim': v => v === '' || /^claim-[A-Za-z0-9_-]{4,64}$/.test(v),
  'plex.update': v => typeof v === 'boolean',
  // A Plex server outside this container (its own container, another computer), for Seerr when no media server runs here.
  'plex.url': v => v === '' || /^https?:\/\/[^\s'"<>]{1,250}$/.test(v),
  'plex.token': v => v === '' || /^[A-Za-z0-9_-]{4,200}$/.test(v),
  'seerr.mediaServer': v => ['', 'jellyfin', 'plex'].includes(v),
  'setup.done': v => typeof v === 'boolean',
};

const read = () => { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; } };
const get = (o, k) => k.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), o);

// Merges a change into settings.json after checking every value. Returns the saved settings or throws.
function update(change) {
  const cur = read();
  for (const [k, v] of Object.entries(flatten(change))) {
    if (!ALLOWED[k]) throw new Error(`Unknown setting ${k}`);
    if (v !== null && !ALLOWED[k](v)) throw new Error(`Invalid value for ${k}`);
    const [a, b] = k.split('.');
    cur[a] = cur[a] || {};
    if (v === null) delete cur[a][b]; else cur[a][b] = v;
  }
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  return cur;
}
const flatten = (o, pre = '') => Object.entries(o || {}).reduce((acc, [k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(acc, flatten(v, pre + k + '.')) : Object.assign(acc, { [pre + k]: v })), {});

// The environment with the interface's settings applied on top.
function effectiveEnv(env = process.env) {
  const s = read(), out = { ...env };
  for (const [k, name] of Object.entries(MAP)) {
    const v = get(s, k);
    if (v === undefined || v === null) continue;
    out[name] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

// What the interface may show: everything except the VPN password and the Plex token.
const view = () => { const s = read(); if (s.vpn && s.vpn.pass) s.vpn.pass = '••••'; if (s.plex && s.plex.token) s.plex.token = '••••'; return s; };

const shq = v => `'${String(v).replace(/'/g, `'\\''`)}'`;
const shellExports = (env = process.env) => {
  const e = effectiveEnv(env);
  return Object.values(MAP).filter(n => e[n] !== undefined).map(n => `export ${n}=${shq(e[n])}`).join('\n');
};

if (require.main === module && process.argv[2] === 'env') process.stdout.write(shellExports() + '\n');

module.exports = { read, update, effectiveEnv, view, shellExports, MAP, FILE };
