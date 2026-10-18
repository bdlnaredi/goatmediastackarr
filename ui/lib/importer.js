'use strict';
// Brings an existing media stack into GoatMediaStackarr: shows from Sonarr, movies from Radarr, artists from
// Lidarr and indexers from Prowlarr are copied into the built-in apps through their normal APIs.
// The old apps are only read from. Media files are not copied or moved: the built-in app is pointed at the same
// files (with the folder translated to where this container sees them) and finds them with a rescan.

const KINDS = {
  sonarr: { api: 'v3', list: 'series', key: 'tvdbId', label: 'shows' },
  radarr: { api: 'v3', list: 'movie', key: 'tmdbId', label: 'movies' },
  lidarr: { api: 'v1', list: 'artist', key: 'foreignArtistId', label: 'artists' },
  prowlarr: { api: 'v1', list: 'indexer', key: 'name', label: 'indexers' },
};

function client(url, apiKey, ver, timeout = 30000) {
  const base = String(url || '').replace(/\/+$/, '');
  const call = async (method, p, body) => {
    const r = await fetch(`${base}/api/${ver}/${p}`, { method, signal: AbortSignal.timeout(timeout),
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let d = t; try { d = t ? JSON.parse(t) : null; } catch {}
    if (!r.ok) {
      const msg = Array.isArray(d) ? d.map(x => x.errorMessage || x.message).filter(Boolean).join('; ') : (d && (d.message || d.error)) || String(t).slice(0, 200);
      const e = new Error(msg || `${r.status} from ${base}`); e.status = r.status; throw e;
    }
    return d;
  };
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b) };
}

// Turns an old folder into the matching folder inside this container, using the longest matching prefix.
function mapPath(p, map) {
  const norm = x => String(x || '').replace(/\/+$/, '');
  const src = norm(p);
  let best = null;
  for (const [from, to] of map) { const f = norm(from); if (f && (src === f || src.startsWith(f + '/')) && (!best || f.length > norm(best[0]).length)) best = [f, norm(to)]; }
  return best ? best[1] + src.slice(best[0].length) : null;
}

// Reads what the old app has and how its folders translate, without changing anything.
async function plan(kind, from, to) {
  const K = KINDS[kind]; if (!K) throw new Error('Unknown app');
  const old = client(from.url, from.apiKey, K.api), neu = client(to.url, to.apiKey, K.api);
  let items;
  try { items = await old.get(K.list); } catch (e) { throw new Error(`Could not read the old ${kind}: ${e.message}`); }
  const have = await neu.get(K.list);
  const known = new Set(have.map(x => String(x[K.key])));
  const out = { kind, total: items.length, already: 0, todo: 0, roots: [], newRoots: [], profiles: {} };
  if (kind === 'prowlarr') {
    for (const x of items) known.has(String(x.name)) ? out.already++ : out.todo++;
    return { ...out, items, have };
  }
  const oldRoots = await old.get('rootfolder'), newRoots = await neu.get('rootfolder');
  out.roots = oldRoots.map(r => r.path); out.newRoots = newRoots.map(r => r.path);
  for (const x of items) known.has(String(x[K.key])) ? out.already++ : out.todo++;
  const [oldQ, newQ] = [await old.get('qualityprofile'), await neu.get('qualityprofile')];
  for (const q of oldQ) { const n = newQ.find(z => z.name === q.name) || newQ[0]; out.profiles[q.name] = n ? n.name : ''; }
  return { ...out, items, have, oldQ, newQ };
}

// Copies everything the built-in app does not have yet. `map` is [[oldFolder, newFolder], ...];
// `progress` is called after each item. Returns counts and the items that could not be added.
async function run(kind, from, to, map, progress = () => {}) {
  const K = KINDS[kind];
  const p = await plan(kind, from, to);
  const neu = client(to.url, to.apiKey, K.api);
  const known = new Set(p.have.map(x => String(x[K.key])));
  const res = { kind, added: 0, skipped: 0, failed: [] , total: p.items.length };
  const qMap = q => { const o = (p.oldQ || []).find(z => z.id === q); const n = o && (p.newQ || []).find(z => z.name === o.name); return (n || (p.newQ || [])[0] || {}).id; };
  let meta = null;
  if (kind === 'lidarr') meta = (await neu.get('metadataprofile'))[0];
  let appProfile = null;
  if (kind === 'prowlarr') { try { appProfile = (await neu.get('appprofile'))[0]; } catch {} }
  let done = 0;
  for (const x of p.items) {
    done++;
    const id = String(x[K.key]);
    if (known.has(id)) { res.skipped++; progress({ done, total: p.items.length, ...res }); continue; }
    try {
      let body;
      if (kind === 'prowlarr') {
        body = { ...x }; delete body.id;
        if (appProfile) body.appProfileId = appProfile.id;
        body.tags = [];
      } else {
        const path = mapPath(x.path, map);
        if (!path) throw new Error(`no folder mapping for ${x.path}`);
        const root = mapPath(x.rootFolderPath || x.path.replace(/\/[^/]+\/?$/, ''), map) || path.replace(/\/[^/]+$/, '');
        const common = { qualityProfileId: qMap(x.qualityProfileId), path, rootFolderPath: root, monitored: !!x.monitored, tags: [] };
        if (kind === 'sonarr') body = { ...common, title: x.title, tvdbId: x.tvdbId, titleSlug: x.titleSlug, images: x.images || [], seasons: (x.seasons || []).map(s => ({ seasonNumber: s.seasonNumber, monitored: !!s.monitored })),
          seasonFolder: x.seasonFolder !== false, seriesType: x.seriesType || 'standard', monitorNewItems: x.monitorNewItems || 'all', addOptions: { searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false } };
        if (kind === 'radarr') body = { ...common, title: x.title, tmdbId: x.tmdbId, year: x.year, titleSlug: x.titleSlug, images: x.images || [],
          minimumAvailability: x.minimumAvailability || 'released', addOptions: { searchForMovie: false } };
        if (kind === 'lidarr') body = { ...common, artistName: x.artistName, foreignArtistId: x.foreignArtistId, metadataProfileId: meta && meta.id,
          addOptions: { monitor: 'existing', searchForMissingAlbums: false } };
      }
      await neu.post(K.list, body);
      res.added++;
    } catch (e) { res.failed.push({ name: x.title || x.artistName || x.name, error: e.message }); }
    progress({ done, total: p.items.length, ...res });
  }
  return res;
}

module.exports = { plan, run, mapPath, KINDS };
