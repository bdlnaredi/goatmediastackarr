#!/usr/bin/env node
'use strict';
// cross-seed's settings, made from the stack: every torrent tracker in Prowlarr (as a Torznab address), qBittorrent to
// read your torrents from and add the matches to, and Sonarr/Radarr to match by their ids. Written each start, so new
// trackers in Prowlarr are picked up on a restart. Exit 3 means "nothing to search yet" (no trackers in Prowlarr).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const E = require('./engines.js');
const dir = process.env.CONFIG_DIR || '/config/cross-seed', dl = process.env.DOWNLOADS_DIR || '/downloads';
const key = a => { try { return (/<ApiKey>([^<]+)<\/ApiKey>/.exec(fs.readFileSync(`/config/${a}/config.xml`, 'utf8')) || [])[1] || ''; } catch { return ''; } };
const on = String(process.env.GOAT_ENGINES || '').toLowerCase().split(',').map(s => s.trim());
const local = k => `http://127.0.0.1:${E.ENGINES[k].port}${E.ENGINES[k].base || ''}`;
const js = v => JSON.stringify(v);

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  // Its own API key, kept between starts (GoatMediaStackarr uses it to ask for a search when a download finishes).
  const kf = path.join(dir, 'goat-api-key');
  let api = ''; try { api = fs.readFileSync(kf, 'utf8').trim(); } catch {}
  if (!/^[a-f0-9]{32,}$/.test(api)) { api = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(kf, api, { mode: 0o600 }); }

  const pk = key('prowlarr');
  if (!on.includes('prowlarr') || !pk) { console.log('[goat] cross-seed waits for Prowlarr (it finds the trackers there).'); process.exit(3); }
  let idx = [];
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${local('prowlarr')}/api/v1/indexer`, { headers: { 'X-Api-Key': pk }, signal: AbortSignal.timeout(8000) }); if (r.ok) { idx = await r.json(); break; } } catch {}
    await new Promise(r => setTimeout(r, 6000));
  }
  const torznab = (Array.isArray(idx) ? idx : []).filter(x => x.enable !== false && String(x.protocol || '').toLowerCase() === 'torrent')
    .map(x => `${local('prowlarr')}/${x.id}/api?apikey=${pk}`);
  if (!torznab.length) { console.log('[goat] cross-seed waits for torrent trackers in Prowlarr. Add one there, then restart cross-seed on the Stack page.'); process.exit(3); }

  let m = {}; try { m = JSON.parse(fs.readFileSync(process.env.GOAT_MANAGED || '/config/goat/managed.json', 'utf8')); } catch {}
  const qb = (m.services || []).find(x => x.key === 'qbittorrent');
  if (!qb) { console.log('[goat] cross-seed needs qBittorrent (in GOAT_ENGINES).'); process.exit(3); }
  const qurl = `qbittorrent:http://${encodeURIComponent(qb.user || 'admin')}:${encodeURIComponent(qb.pass || '')}@127.0.0.1:${E.ENGINES.qbittorrent.port}`;
  const arr = a => on.includes(a) && key(a) ? [`${local(a)}?apikey=${key(a)}`] : [];
  const env = (k, d) => process.env[k] || d;

  const conf = `// Made by GoatMediaStackarr each time cross-seed starts; changes here are replaced. Set CROSSSEED_* in the container instead.
module.exports = {
  apiKey: ${js(api)},
  host: "127.0.0.1",
  port: ${E.ENGINES['cross-seed'].port},
  torznab: ${js(torznab)},
  sonarr: ${js(arr('sonarr'))},
  radarr: ${js(arr('radarr'))},
  torrentClients: ${js([qurl])},
  useClientTorrents: true,
  torrentDir: null,
  outputDir: null,
  dataDirs: [],
  // Matches are linked (hard links: no extra space) into a folder of their own inside the downloads folder.
  linkDirs: ${js([path.join(dl, 'cross-seed')])},
  linkType: ${js(env('CROSSSEED_LINK_TYPE', 'hardlink'))},
  flatLinking: false,
  matchMode: ${js(env('CROSSSEED_MATCH_MODE', 'flexible'))},
  action: "inject",
  duplicateCategories: false,
  includeSingleEpisodes: false,
  includeNonVideos: false,
  seasonFromEpisodes: 1,
  autoResumeMaxDownload: 52428800,
  delay: ${Math.max(30, +env('CROSSSEED_DELAY', 30) || 30)},
  rssCadence: ${js(env('CROSSSEED_RSS_CADENCE', '30 minutes'))},
  searchCadence: ${js(env('CROSSSEED_SEARCH_CADENCE', '1 day'))},
  excludeOlder: ${js(env('CROSSSEED_EXCLUDE_OLDER', '2 weeks'))},
  excludeRecentSearch: ${js(env('CROSSSEED_EXCLUDE_RECENT', '3 days'))},
  snatchTimeout: "30 seconds",
  searchTimeout: "2 minutes",
  searchLimit: ${Math.max(10, +env('CROSSSEED_SEARCH_LIMIT', 400) || 400)},
  verbose: false,
};
`;
  fs.writeFileSync(path.join(dir, 'config.js'), conf, { mode: 0o600 });
  fs.mkdirSync(path.join(dl, 'cross-seed'), { recursive: true });
  console.log(`[goat] cross-seed searches ${torznab.length} tracker(s) for your qBittorrent torrents.`);
})().catch(e => { console.error('[goat] cross-seed setup failed: ' + e.message); process.exit(1); });
