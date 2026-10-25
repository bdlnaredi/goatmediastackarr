// Trending, popular and anticipated lists from Trakt, TMDB and TheTVDB, turned into one plain shape.
// MediaHub, Copyright (C) 2026 bdlnaredi, GPL-3.0-or-later. No dependencies.
'use strict';

const DAY = 864e5, HALF_HOUR = 30 * 60 * 1000;
// What each site can give us. TheTVDB has no trending list, and no list of coming-soon movies that we can rely on.
const LISTS = { trakt: ['trending', 'popular', 'anticipated'], tmdb: ['trending', 'popular', 'anticipated'], tvdb: ['popular', 'anticipated'] };
const NAMES = { trakt: 'Trakt', tmdb: 'TMDB', tvdb: 'TheTVDB' };

const yr = s => /^\d{4}/.test(String(s || '')) ? String(s).slice(0, 4) : '';
const posInt = n => Number.isInteger(+n) && +n > 0 ? +n : 0;
const img = p => !p ? '' : /^(https?:|data:image\/)/.test(p) ? String(p) : 'https://image.tmdb.org/t/p/w342' + p;

// o.keys() -> { trakt, tmdb, tvdb } (strings, may be empty); o.urls -> { trakt, tmdb, tvdb } base addresses
// o.seerrPoster(kind, tmdbId) -> optional fallback that finds a poster through Seerr.
function create(o) {
  const cache = new Map(), posters = new Map();
  let tvdbTok = { t: '', at: 0, k: '' };

  const bad = (msg, status) => Object.assign(new Error(msg), { status });

  async function get(url, opt, who) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(15000), ...opt }); } catch { throw bad(`${who} could not be reached right now.`, 502); }
    if (r.status === 401 || r.status === 403) throw bad(`${who} did not accept the key. Check it in Settings, under Discover lists.`, 401);
    if (!r.ok) throw bad(`${who} answered with an error (${r.status}).`, 502);
    try { return await r.json(); } catch { throw bad(`${who} gave a reply GoatMediaStackarr could not read.`, 502); }
  }

  const item = (kind, v) => ({
    mediaType: kind, title: String(v.title || '').slice(0, 200), year: yr(v.year), overview: String(v.overview || '').slice(0, 600), poster: img(v.poster),
    rating: v.rating > 0 ? Math.round(v.rating * 10) / 10 : 0, tmdb: posInt(v.tmdb), imdb: /^tt\d{1,10}$/.test(v.imdb || '') ? v.imdb : '', tvdb: posInt(v.tvdb), trakt: posInt(v.trakt) });

  // ---- Trakt: needs only a Client ID. It has no pictures, so those come from TMDB (or Seerr) by TMDB number.
  async function trakt(list, kind) {
    const d = await get(`${o.urls.trakt}/${kind === 'tv' ? 'shows' : 'movies'}/${list}?extended=full&limit=40`,
      { headers: { 'trakt-api-key': o.keys().trakt, 'trakt-api-version': '2', 'Content-Type': 'application/json' } }, 'Trakt');
    return (Array.isArray(d) ? d : []).map(x => x.movie || x.show || x).filter(v => v && v.title)
      .map(v => item(kind, { title: v.title, year: v.year, overview: v.overview, rating: v.rating, tmdb: (v.ids || {}).tmdb, imdb: (v.ids || {}).imdb, tvdb: (v.ids || {}).tvdb, trakt: (v.ids || {}).trakt }));
  }

  // ---- TMDB: accepts the short API key or the long Read Access Token.
  const tmdbAuth = (path, params = {}) => {
    const k = o.keys().tmdb, bearer = k.length > 40 || k.startsWith('eyJ'), q = new URLSearchParams(params);
    if (!bearer) q.set('api_key', k);
    return [`${o.urls.tmdb}${path}${q.toString() ? '?' + q : ''}`, bearer ? { headers: { Authorization: 'Bearer ' + k, Accept: 'application/json' } } : { headers: { Accept: 'application/json' } }];
  };
  async function tmdb(list, kind) {
    const m = kind === 'tv' ? 'tv' : 'movie', today = new Date().toISOString().slice(0, 10);
    const [url, opt] = list === 'trending' ? tmdbAuth(`/trending/${m}/week`)
      : list === 'popular' ? tmdbAuth(`/${m}/popular`)
        : tmdbAuth(`/discover/${m}`, { sort_by: 'popularity.desc', include_adult: 'false', [m === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte']: today });
    const d = await get(url, opt, 'TMDB');
    return ((d && d.results) || []).filter(v => v && (v.title || v.name)).slice(0, 40)
      .map(v => item(kind, { title: v.title || v.name, year: v.release_date || v.first_air_date, overview: v.overview, poster: v.poster_path, rating: v.vote_average, tmdb: v.id }));
  }
  async function tmdbPoster(kind, id) {
    const [url, opt] = tmdbAuth(`/${kind === 'tv' ? 'tv' : 'movie'}/${id}`);
    return img(((await get(url, opt, 'TMDB')) || {}).poster_path);
  }

  // ---- TheTVDB v4: sign in with the API key to get a token that lasts about a month.
  async function tvdbToken(force) {
    const k = o.keys().tvdb;
    if (!force && tvdbTok.t && tvdbTok.k === k && Date.now() - tvdbTok.at < 20 * DAY) return tvdbTok.t;
    const d = await get(`${o.urls.tvdb}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apikey: k }) }, 'TheTVDB');
    const t = d && d.data && d.data.token;
    if (!t) throw bad('TheTVDB did not accept the key. Check it in Settings, under Discover lists.', 401);
    tvdbTok = { t, at: Date.now(), k }; return t;
  }
  async function tvdb(list, kind) {
    if (kind !== 'tv' && list !== 'popular') throw bad('TheTVDB only has a popular list for movies.', 400);
    const path = kind === 'tv'
      ? `/series/filter?country=usa&lang=eng&sort=score&sortType=desc${list === 'anticipated' ? '&status=3' : ''}`
      : '/movies/filter?country=usa&lang=eng&sort=score&sortType=desc';
    const call = async force => get(o.urls.tvdb + path, { headers: { Authorization: 'Bearer ' + await tvdbToken(force), Accept: 'application/json' } }, 'TheTVDB');
    let d; try { d = await call(false); } catch (e) { if (e.status !== 401) throw e; d = await call(true); }
    return ((d && d.data) || []).filter(v => v && v.name).slice(0, 40).map(v => item(kind, {
      title: v.name, year: v.year || v.firstAired, overview: v.overview, tvdb: v.id, poster: /^(https?:|data:image\/)/.test(v.image || '') ? v.image : v.image ? 'https://artworks.thetvdb.com' + v.image : '' }));
  }

  async function poster(kind, id) {
    const key = kind + id, hit = posters.get(key);
    if (hit && Date.now() - hit.at < (hit.v ? 7 * DAY : 3600e3)) return hit.v;
    let v = '';
    if (o.keys().tmdb) { try { v = await tmdbPoster(kind, id); } catch {} }
    if (!v && o.seerrPoster) { try { v = img(await o.seerrPoster(kind, id)); } catch {} }
    posters.set(key, { v, at: Date.now() }); return v;
  }

  const enabled = () => { const k = o.keys(); return { trakt: !!k.trakt, tmdb: !!k.tmdb, tvdb: !!k.tvdb }; };

  async function list(src, name, kind) {
    if (!LISTS[src] || !LISTS[src].includes(name) || !['movie', 'tv'].includes(kind)) throw bad('That list does not exist.', 400);
    if (!o.keys()[src]) throw bad(`${NAMES[src]} is not set up yet. An admin can add its key in Settings, under Discover lists.`, 404);
    const ck = [src, name, kind, o.keys()[src]].join('|'), hit = cache.get(ck);
    if (hit && Date.now() - hit.at < HALF_HOUR) return hit.v;
    const items = await ({ trakt, tmdb, tvdb })[src](name, kind);
    await Promise.all(items.filter(x => !x.poster && x.tmdb).map(async x => { x.poster = await poster(kind, x.tmdb); }));
    cache.set(ck, { v: items, at: Date.now() }); return items;
  }

  // The full record of one title (with its cast and trailers), for the title page when there is no Seerr.
  async function details(kind, id) {
    const [url, opt] = tmdbAuth(`/${kind === 'tv' ? 'tv' : 'movie'}/${posInt(id)}`, { append_to_response: 'credits,videos,recommendations' });
    return get(url, opt, 'TMDB');
  }
  // One person, with everything they were in or made.
  async function person(id) {
    const [url, opt] = tmdbAuth(`/person/${posInt(id)}`, { append_to_response: 'combined_credits' });
    return get(url, opt, 'TMDB');
  }

  // A collection (a franchise, like every Bond film) and the titles in it.
  async function collection(id) {
    const [url, opt] = tmdbAuth(`/collection/${posInt(id)}`);
    return get(url, opt, 'TMDB');
  }
  // Titles like this one, for "Because you watched".
  async function recommendations(kind, id) {
    const [url, opt] = tmdbAuth(`/${kind === 'tv' ? 'tv' : 'movie'}/${posInt(id)}/recommendations`);
    return get(url, opt, 'TMDB');
  }

  return { list, enabled, details, person, collection, recommendations, LISTS, NAMES };
}

module.exports = { create, LISTS, NAMES };
