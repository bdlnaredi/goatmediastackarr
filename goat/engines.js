'use strict';
// One place that knows where every engine lives inside the container.
// Ports are internal: everything except the UI (2806), Jellyfin (8096) and Plex (32400) listens on 127.0.0.1 only.

const CONFIG = process.env.GOAT_CONFIG_DIR || '/config';
// Media library and downloads are separate container folders by default (/media and /downloads).
// Both can be pointed inside one mapped folder instead (MEDIA_DIR=/data/media, DOWNLOADS_DIR=/data/downloads),
// which lets finished downloads be hardlinked into the library instead of copied.
const trim = p => String(p).replace(/\/+$/, '') || '/';
const MEDIA = trim(process.env.MEDIA_DIR || '/media');
const DOWNLOADS = trim(process.env.DOWNLOADS_DIR || '/downloads');

const ENGINES = {
  sonarr:      { name: 'Sonarr',      port: 8989, base: '/engines/sonarr',   kind: 'arr', api: 'v3' },
  radarr:      { name: 'Radarr',      port: 7878, base: '/engines/radarr',   kind: 'arr', api: 'v3' },
  lidarr:      { name: 'Lidarr',      port: 8686, base: '/engines/lidarr',   kind: 'arr', api: 'v1' },
  prowlarr:    { name: 'Prowlarr',    port: 9696, base: '/engines/prowlarr', kind: 'arr', api: 'v1' },
  bazarr:      { name: 'Bazarr',      port: 6767, base: '/engines/bazarr' },
  qbittorrent: { name: 'qBittorrent', port: 8080, base: '' },
  sabnzbd:     { name: 'SABnzbd',     port: 8085, base: '/engines/sabnzbd' },
  jellyfin:    { name: 'Jellyfin',    port: 8096, base: '' },
  seerr:       { name: 'Seerr',       port: 5055, base: '' },
  tautulli:    { name: 'Tautulli',    port: 8181, base: '/engines/tautulli' },
  // Off unless added to GOAT_ENGINES. Plex is free to use but not open source, so it is downloaded from
  // plex.tv on first start (like the official Plex image) instead of being shipped in this image.
  plex:        { name: 'Plex',        port: 32400, base: '' },
  // Off unless added to GOAT_ENGINES: gets past Cloudflare checks on indexer sites. Downloaded on first start
  // (it bundles its own Chromium), so it costs nothing for people who do not use it. x86 servers only.
  flaresolverr: { name: 'FlareSolverr', port: 8191, base: '' },
};

// Tests run fake engines on spare ports: GOAT_PORT_SONARR=12345 and so on.
for (const [k, e] of Object.entries(ENGINES)) { const v = Number(process.env[`GOAT_PORT_${k.toUpperCase()}`]); if (v) e.port = v; }

// Folder layout.
const DIRS = {
  tv: `${MEDIA}/tv`,
  movies: `${MEDIA}/movies`,
  music: `${MEDIA}/music`,
  torrents: `${DOWNLOADS}/torrents`,
  usenet: `${DOWNLOADS}/usenet`,
};

const DEFAULT_ENGINES = 'sonarr,radarr,lidarr,prowlarr,bazarr,qbittorrent,sabnzbd,jellyfin,seerr';
const DEFAULT_VPN_APPS = 'qbittorrent,sabnzbd,prowlarr';

const list = (v, def) => String(v == null || v === '' ? def : v).split(',').map(s => s.trim().toLowerCase()).filter(s => ENGINES[s]);
const enabled = (env = process.env) => list(env.GOAT_ENGINES, DEFAULT_ENGINES);
const vpnApps = (env = process.env) => {
  if (String(env.VPN_ENABLED).toLowerCase() !== 'true') return [];
  const l = list(env.VPN_APPS, DEFAULT_VPN_APPS);
  // FlareSolverr is the one that actually visits indexer sites for Prowlarr, so it follows Prowlarr onto the VPN.
  if (l.includes('prowlarr') && !l.includes('flaresolverr') && enabled(env).includes('flaresolverr')) l.push('flaresolverr');
  return l;
};
// Seerr works with one media server. SEERR_MEDIA_SERVER picks it; otherwise Jellyfin if it runs, else Plex.
const seerrServer = (env = process.env, on = enabled(env)) => {
  const want = String(env.SEERR_MEDIA_SERVER || '').toLowerCase();
  if ((want === 'plex' || want === 'jellyfin') && on.includes(want)) return want;
  return on.includes('jellyfin') ? 'jellyfin' : on.includes('plex') ? 'plex' : '';
};
const PLEX_PREFS = () => `${CONFIG}/plex/Library/Application Support/Plex Media Server/Preferences.xml`;
const url = key => `http://127.0.0.1:${ENGINES[key].port}${ENGINES[key].base}`;

module.exports = { CONFIG, MEDIA, DOWNLOADS, ENGINES, DIRS, DEFAULT_ENGINES, DEFAULT_VPN_APPS, enabled, vpnApps, url, list, seerrServer, PLEX_PREFS };
