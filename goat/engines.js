'use strict';
// One place that knows where every engine lives inside the container.
// Ports are internal: everything except the UI (2806) and Jellyfin (8096) listens on 127.0.0.1 only.

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
const vpnApps = (env = process.env) => String(env.VPN_ENABLED).toLowerCase() === 'true' ? list(env.VPN_APPS, DEFAULT_VPN_APPS) : [];
const url = key => `http://127.0.0.1:${ENGINES[key].port}${ENGINES[key].base}`;

module.exports = { CONFIG, MEDIA, DOWNLOADS, ENGINES, DIRS, DEFAULT_ENGINES, DEFAULT_VPN_APPS, enabled, vpnApps, url, list };
