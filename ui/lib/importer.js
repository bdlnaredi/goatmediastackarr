'use strict';
// Brings an existing media stack into GoatMediaStackarr: shows from Sonarr, movies from Radarr, artists from
// Lidarr and indexers from Prowlarr are copied into the built-in apps through their normal APIs, and before them
// (if asked) the custom formats and quality profiles, so every item lands on the same profile it had.
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
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

// Turns an old folder into the matching folder inside this container, using the longest matching prefix.
function mapPath(p, map) {
  const norm = x => String(x || '').replace(/\/+$/, '');
  const src = norm(p);
  let best = null;
  for (const [from, to] of map) { const f = norm(from); if (f && (src === f || src.startsWith(f + '/')) && (!best || f.length > norm(best[0]).length)) best = [f, norm(to)]; }
  return best ? best[1] + src.slice(best[0].length) : null;
}

// Custom formats, or [] for an app version that has none.
async function formats(c) { try { return await c.get('customformat'); } catch (e) { if (e.status === 404) return []; throw e; } }

// Copies custom formats and quality profiles. One with the same name here is replaced by the old one;
// the rest are added. Profile scores follow each custom format by name, because ids differ between apps.
async function copySettings(kind, from, to) {
  const K = KINDS[kind];
  const old = client(from.url, from.apiKey, K.api), neu = client(to.url, to.apiKey, K.api);
  const out = { formats: { added: 0, updated: 0 }, profiles: { added: 0, updated: 0 }, failed: [] };
  const oldCF = await formats(old);
  let newCF = await formats(neu);
  for (const f of oldCF) {
    const body = { name: f.name, includeCustomFormatWhenRenaming: !!f.includeCustomFormatWhenRenaming, specifications: f.specifications || [] };
    const have = newCF.find(x => x.name === f.name);
    try {
      if (!have) { await neu.post('customformat', body); out.formats.added++; }
      else if (JSON.stringify(have.specifications || []) !== JSON.stringify(body.specifications) || !!have.includeCustomFormatWhenRenaming !== body.includeCustomFormatWhenRenaming) {
        await neu.put(`customformat/${have.id}`, { ...body, id: have.id }); out.formats.updated++;
      }
    } catch (e) { out.failed.push({ name: `Custom format "${f.name}"`, error: e.message }); }
  }
  if (oldCF.length) newCF = await formats(neu);
  const cfName = Object.fromEntries(oldCF.map(f => [f.id, f.name]));
  const [oldQ, newQ] = [await old.get('qualityprofile'), await neu.get('qualityprofile')];
  for (const q of oldQ) {
    const score = {};
    for (const i of q.formatItems || []) score[cfName[i.format] || i.name] = i.score || 0;
    // The apps want every custom format listed in every profile, so the ones the old profile did not score get 0.
    const body = { ...q, formatItems: newCF.map(f => ({ format: f.id, name: f.name, score: score[f.name] || 0 })) };
    delete body.id;
    const have = newQ.find(x => x.name === q.name);
    try {
      if (have) { await neu.put(`qualityprofile/${have.id}`, { ...body, id: have.id }); out.profiles.updated++; }
      else { await neu.post('qualityprofile', body); out.profiles.added++; }
    } catch (e) { out.failed.push({ name: `Quality profile "${q.name}"`, error: e.message }); }
  }
  return out;
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
  out.settings = { profiles: oldQ.map(q => q.name), formats: (await formats(old)).length };
  return { ...out, items, have, oldQ, newQ };
}

// Copies everything the built-in app does not have yet. `map` is [[oldFolder, newFolder], ...];
// `progress` is called after each item. Returns counts and the items that could not be added.
// With { settings: true }, the custom formats and quality profiles are copied first.
async function run(kind, from, to, map, progress = () => {}, { settings = false } = {}) {
  const K = KINDS[kind];
  let copied = null;
  if (settings && kind !== 'prowlarr') { progress({ phase: 'profiles' }); copied = await copySettings(kind, from, to); }
  const p = await plan(kind, from, to);
  const neu = client(to.url, to.apiKey, K.api);
  const known = new Set(p.have.map(x => String(x[K.key])));
  const res = { kind, added: 0, skipped: 0, failed: copied ? [...copied.failed] : [], total: p.items.length, settings: copied && { formats: copied.formats, profiles: copied.profiles }, phase: 'items' };
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

module.exports = { plan, run, copySettings, mapPath, KINDS };
