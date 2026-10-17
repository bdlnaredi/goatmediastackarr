#!/usr/bin/env node
'use strict';
// Runs once at every container start, as root, before any engine starts.
// Creates folders, makes the secret keys on the first start, and writes each engine's settings
// so they listen only inside the container and already know each other's keys.
// Settings a person changes later inside an engine are kept: only the keys GoatMediaStackarr manages are rewritten.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./engines');

const key = () => crypto.randomBytes(16).toString('hex');
const password = () => crypto.randomBytes(18).toString('base64url');

// ---------- small file helpers ----------
const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const writeText = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// Sets key=value inside [section] of an INI-style file, adding the section or key if missing.
function iniSet(text, section, k, v, sep = '=') {
  const lines = (text || '').split('\n');
  const head = `[${section}]`;
  let start = lines.findIndex(l => l.trim() === head);
  if (start === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(head, `${k}${sep}${v}`);
    return lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n');
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[[^\]]+\]\s*$/.test(l));
  if (end === -1) end = lines.length;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*${esc}\\s*${sep.trim() || '='}`);
  for (let i = start + 1; i < end; i++) if (re.test(lines[i])) { lines[i] = `${k}${sep}${v}`; return lines.join('\n'); }
  let at = end; while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, `${k}${sep}${v}`);
  return lines.join('\n');
}

// Sets <Tag>value</Tag> inside the *arr config.xml.
function xmlSet(text, tag, v) {
  const s = text && text.includes('<Config>') ? text : '<Config>\n</Config>\n';
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`);
  const val = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return re.test(s) ? s.replace(re, `<${tag}>${val}</${tag}>`) : s.replace('</Config>', `  <${tag}>${val}</${tag}>\n</Config>`);
}
const xmlGet = (text, tag) => { const m = (text || '').match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1] : ''; };

// qBittorrent stores the web password as PBKDF2-SHA512 with 100000 rounds.
function qbitHash(pw, salt = crypto.randomBytes(16)) {
  const h = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512');
  return `@ByteArray(${salt.toString('base64')}:${h.toString('base64')})`;
}

// ---------- secrets ----------
function loadSecrets(file) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const want = {
    sonarr: key, radarr: key, lidarr: key, prowlarr: key, bazarr: key, tautulli: key,
    sabnzbd: key, sabnzbdNzb: key, qbitUser: () => 'goat', qbitPass: password,
    jellyfinUser: () => 'goat-admin', jellyfinPass: password,
  };
  let changed = false;
  for (const [k, make] of Object.entries(want)) if (!s[k]) { s[k] = make(); changed = true; }
  return { secrets: s, changed };
}

// ---------- per-engine settings ----------
function arrConfig(existing, eng, apiKey) {
  let x = existing;
  // Read an existing key so a migrated Sonarr/Radarr keeps working with apps outside the container.
  const keep = xmlGet(existing, 'ApiKey');
  x = xmlSet(x, 'BindAddress', '127.0.0.1');
  x = xmlSet(x, 'Port', eng.port);
  x = xmlSet(x, 'UrlBase', eng.base);
  x = xmlSet(x, 'ApiKey', keep || apiKey);
  x = xmlSet(x, 'AuthenticationMethod', 'External');
  x = xmlSet(x, 'AuthenticationRequired', 'DisabledForLocalAddresses');
  x = xmlSet(x, 'LaunchBrowser', 'False');
  x = xmlSet(x, 'UpdateMechanism', 'Docker');
  x = xmlSet(x, 'AnalyticsEnabled', 'False');
  x = xmlSet(x, 'EnableSsl', 'False');
  if (!xmlGet(x, 'InstanceName')) x = xmlSet(x, 'InstanceName', eng.name);
  if (!xmlGet(x, 'LogLevel')) x = xmlSet(x, 'LogLevel', 'info');
  return { text: x, apiKey: keep || apiKey };
}

function qbitConfig(existing, s, vpnIface) {
  let x = existing || '';
  const first = !existing;
  x = iniSet(x, 'LegalNotice', 'Accepted', 'true');
  x = iniSet(x, 'Preferences', 'WebUI\\Address', '127.0.0.1');
  x = iniSet(x, 'Preferences', 'WebUI\\Port', E.ENGINES.qbittorrent.port);
  x = iniSet(x, 'Preferences', 'WebUI\\LocalHostAuth', 'false');
  x = iniSet(x, 'Preferences', 'WebUI\\HostHeaderValidation', 'false');
  // Only reachable from inside the container or through the signed-in /engines/qbittorrent/ page.
  x = iniSet(x, 'Preferences', 'WebUI\\CSRFProtection', 'false');
  x = iniSet(x, 'Preferences', 'WebUI\\Username', s.qbitUser);
  if (first || !/WebUI\\Password_PBKDF2/.test(x)) x = iniSet(x, 'Preferences', 'WebUI\\Password_PBKDF2', `"${qbitHash(s.qbitPass)}"`);
  // Binding to the VPN interface is a second lock on top of the firewall kill switch.
  x = iniSet(x, 'BitTorrent', 'Session\\Interface', vpnIface || '');
  x = iniSet(x, 'BitTorrent', 'Session\\InterfaceName', vpnIface || '');
  if (first) {
    x = iniSet(x, 'BitTorrent', 'Session\\DefaultSavePath', `${E.DIRS.torrents}/complete`);
    x = iniSet(x, 'BitTorrent', 'Session\\TempPath', `${E.DIRS.torrents}/incomplete`);
    x = iniSet(x, 'BitTorrent', 'Session\\TempPathEnabled', 'true');
    x = iniSet(x, 'BitTorrent', 'Session\\Port', '6881');
    x = iniSet(x, 'BitTorrent', 'Session\\QueueingSystemEnabled', 'true');
  }
  return x;
}

function sabConfig(existing, s) {
  let x = existing || '';
  const first = !existing;
  const set = (sec, k, v) => { x = iniSet(x, sec, k, v, ' = '); };
  set('misc', 'host', '127.0.0.1');
  set('misc', 'port', E.ENGINES.sabnzbd.port);
  set('misc', 'url_base', E.ENGINES.sabnzbd.base);
  set('misc', 'api_key', s.sabnzbd);
  set('misc', 'nzb_key', s.sabnzbdNzb);
  set('misc', 'host_whitelist', 'localhost, 127.0.0.1');
  set('misc', 'inet_exposure', '0');
  if (first) {
    set('misc', 'download_dir', `${E.DIRS.usenet}/incomplete`);
    set('misc', 'complete_dir', `${E.DIRS.usenet}/complete`);
    set('misc', 'permissions', '775');
    x += '\n[categories]\n[[*]]\nname = *\norder = 0\npp = 3\nscript = None\ndir = ""\npriority = 0\n' +
      ['tv', 'movies', 'music'].map((c, i) => `[[${c}]]\nname = ${c}\norder = ${i + 1}\npp = ""\nscript = Default\ndir = ${c}\npriority = -100\n`).join('');
  }
  return x;
}

function bazarrConfig(s) {
  const y = (o, ind = '') => Object.entries(o).map(([k, v]) => v && typeof v === 'object'
    ? `${ind}${k}:\n${y(v, ind + '  ')}` : `${ind}${k}: ${typeof v === 'string' ? `'${v}'` : v}`).join('\n');
  const arr = (k) => ({ ip: '127.0.0.1', port: E.ENGINES[k].port, base_url: E.ENGINES[k].base, apikey: s[k], ssl: false });
  return y({
    general: { ip: '127.0.0.1', port: E.ENGINES.bazarr.port, base_url: E.ENGINES.bazarr.base, use_sonarr: true, use_radarr: true },
    auth: { apikey: s.bazarr },
    sonarr: arr('sonarr'),
    radarr: arr('radarr'),
  }) + '\n';
}

function tautulliConfig(existing, s) {
  let x = existing || '';
  const set = (k, v) => { x = iniSet(x, 'General', k, v, ' = '); };
  set('http_host', '127.0.0.1');
  set('http_port', E.ENGINES.tautulli.port);
  set('http_root', E.ENGINES.tautulli.base);
  set('api_enabled', '1');
  set('api_key', s.tautulli);
  set('launch_browser', '0');
  set('check_github', '0');
  return x;
}

// ---------- main ----------
function run(env = process.env) {
  const C = E.CONFIG;
  const puid = Number(env.PUID || 99), pgid = Number(env.PGID || 100);
  const on = E.enabled(env);
  const vpn = E.vpnApps(env);
  const goatDir = `${C}/goat`;
  fs.mkdirSync(goatDir, { recursive: true });
  const secFile = `${goatDir}/secrets.json`;
  const { secrets: s, changed } = loadSecrets(secFile);
  if (changed) fs.writeFileSync(secFile, JSON.stringify(s, null, 1), { mode: 0o600 });

  const made = [];
  const dirs = [
    ...Object.values(E.DIRS),
    `${E.DIRS.torrents}/incomplete`, `${E.DIRS.torrents}/complete`,
    `${E.DIRS.usenet}/incomplete`, `${E.DIRS.usenet}/complete`,
    `${C}/ui`, `${C}/vpn`, ...Object.keys(E.ENGINES).map(k => `${C}/${k}`),
  ];
  for (const d of dirs) if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); made.push(d); }

  const keys = {};
  for (const k of ['sonarr', 'radarr', 'lidarr', 'prowlarr']) {
    const f = `${C}/${k}/config.xml`;
    const r = arrConfig(readText(f), E.ENGINES[k], s[k]);
    writeText(f, r.text); keys[k] = r.apiKey;
  }

  const qf = `${C}/qbittorrent/qBittorrent/config/qBittorrent.conf`;
  writeText(qf, qbitConfig(readText(qf), s, vpn.includes('qbittorrent') ? 'goatvpn' : ''));

  const sf = `${C}/sabnzbd/sabnzbd.ini`;
  writeText(sf, sabConfig(readText(sf), s));

  const bf = `${C}/bazarr/config/config.yaml`;
  if (!fs.existsSync(bf)) writeText(bf, bazarrConfig({ ...s, ...keys }));

  const tf = `${C}/tautulli/config.ini`;
  writeText(tf, tautulliConfig(readText(tf), s));

  // Tells the UI which apps exist and how to reach them. wire.js adds Jellyfin and Seerr keys once they exist.
  const mf = `${goatDir}/managed.json`;
  let managed = {};
  try { managed = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
  const svc = (k, extra) => ({ key: k, type: k, name: E.ENGINES[k].name, url: E.url(k), ...extra });
  const want = {
    sonarr: svc('sonarr', { apiKey: keys.sonarr }),
    radarr: svc('radarr', { apiKey: keys.radarr }),
    lidarr: svc('lidarr', { apiKey: keys.lidarr }),
    prowlarr: svc('prowlarr', { apiKey: keys.prowlarr }),
    bazarr: svc('bazarr', { apiKey: s.bazarr }),
    qbittorrent: svc('qbittorrent', { user: s.qbitUser, pass: s.qbitPass }),
    sabnzbd: svc('sabnzbd', { apiKey: s.sabnzbd }),
    tautulli: svc('tautulli', { apiKey: s.tautulli }),
    jellyfin: svc('jellyfin', { apiKey: (managed.services || []).find(x => x.key === 'jellyfin')?.apiKey || '' }),
    seerr: svc('seerr', { apiKey: (managed.services || []).find(x => x.key === 'seerr')?.apiKey || '' }),
  };
  managed = { version: 1, services: on.map(k => want[k]).filter(Boolean), vpn: { enabled: vpn.length > 0, apps: vpn } };
  fs.writeFileSync(mf, JSON.stringify(managed, null, 1), { mode: 0o600 });

  // Hand everything to the user the engines run as. Only folders made just now are changed under the media
  // and downloads folders,
  // so an existing media library is never re-owned.
  const chownTree = d => {
    try { fs.chownSync(d, puid, pgid); } catch { return; }
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch {}
    for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) chownTree(p); else try { fs.chownSync(p, puid, pgid); } catch {} }
  };
  if (process.getuid && process.getuid() === 0) {
    // Only walk a folder when its owner is wrong (first start, or PUID/PGID changed): Jellyfin's can hold many files.
    for (const k of [...Object.keys(E.ENGINES), 'ui', 'vpn', 'goat']) {
      const d = `${C}/${k}`; let st; try { st = fs.statSync(d); } catch { continue; }
      if (st.uid !== puid || st.gid !== pgid) chownTree(d);
      else for (const f of fs.readdirSync(d)) { const q = path.join(d, f); try { const s2 = fs.statSync(q); if (s2.isFile() && (s2.uid !== puid || s2.gid !== pgid)) fs.chownSync(q, puid, pgid); } catch {} }
    }
    for (const d of made.filter(d => !d.startsWith(C + '/'))) try { fs.chownSync(d, puid, pgid); } catch {}
  }
  return { secrets: s, keys, managed, made };
}

if (require.main === module) {
  try {
    const r = run();
    console.log(`[goat-init] ready. Engines: ${r.managed.services.map(x => x.name).join(', ')}. VPN apps: ${r.managed.vpn.apps.join(', ') || 'none'}.`);
  } catch (e) {
    console.error('[goat-init] failed:', e && e.stack || e);
    process.exit(1);
  }
}

module.exports = { run, iniSet, xmlSet, xmlGet, qbitHash, arrConfig, qbitConfig, sabConfig, bazarrConfig, tautulliConfig, loadSecrets };
