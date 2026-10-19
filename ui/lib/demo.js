// Pretend versions of the apps MediaHub talks to. Used by DEMO mode and by the tests.
// Nothing here ever leaves the machine and nothing is saved.
'use strict';
const DAY = 864e5;
const iso = (d, off = 0) => new Date(d + off * DAY).toISOString();
const wrap = t => { const w = String(t).replace(/[<&>]/g, '').split(' '), out = ['']; for (const x of w) { if ((out[out.length - 1] + ' ' + x).trim().length > 13 && out[out.length - 1]) out.push(x); else out[out.length - 1] = (out[out.length - 1] + ' ' + x).trim(); } return out.slice(0, 3); };
const clean = t => String(t).replace(/[<&>]/g, '').slice(0, 24);
// Pretend artwork, drawn in code: posters and widescreen backdrops with simple scenes. Not from any real film or show.
const SCENES = [
  h => `<circle cx="1000" cy="250" r="110" fill="hsl(${(h + 40) % 360},90%,72%)" opacity=".9"/><path d="M0 560 L220 360 L380 500 L600 300 L860 520 L1080 380 L1280 540 V720 H0Z" fill="hsl(${h},45%,16%)"/><path d="M0 640 L300 500 L520 610 L800 470 L1280 650 V720 H0Z" fill="hsl(${h},50%,9%)"/>`,
  h => `<g fill="hsl(${h},40%,12%)">${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 82 - 20}" y="${300 + (i * 97 % 190)}" width="${60 + i * 7 % 30}" height="500"/>`).join('')}</g><g fill="hsl(${(h + 45) % 360},95%,70%)" opacity=".85">${Array.from({ length: 60 }, (_, i) => `<rect x="${(i * 53) % 1260 + 10}" y="${340 + (i * 71) % 330}" width="6" height="9"/>`).join('')}</g>`,
  h => `<g stroke="hsl(${(h + 30) % 360},80%,70%)" stroke-width="2" opacity=".5" fill="none">${Array.from({ length: 9 }, (_, i) => `<ellipse cx="640" cy="760" rx="${150 + i * 90}" ry="${60 + i * 34}"/>`).join('')}</g><circle cx="640" cy="330" r="150" fill="hsl(${(h + 20) % 360},85%,62%)" opacity=".85"/><circle cx="700" cy="300" r="140" fill="hsl(${h},50%,10%)"/>`,
  h => `<g fill="hsl(${(h + 60) % 360},85%,80%)">${Array.from({ length: 90 }, (_, i) => `<circle cx="${(i * 137) % 1280}" cy="${(i * 89) % 600}" r="${1 + i % 3}" opacity="${.3 + (i % 5) / 8}"/>`).join('')}</g><path d="M0 700 Q320 560 640 650 T1280 600 V720 H0Z" fill="hsl(${h},50%,8%)"/>`,
];
const fan = (title, hue, k = 0) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="hsl(${(hue + 30) % 360},65%,34%)"/><stop offset=".6" stop-color="hsl(${hue},60%,20%)"/><stop offset="1" stop-color="hsl(${(hue + 320) % 360},55%,8%)"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>${SCENES[k % SCENES.length](hue)}</svg>`);
const svg = (title, hue, k = 0) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},58%,42%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},62%,16%)"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><g transform="translate(0 40) scale(.234)">${SCENES[k % SCENES.length](hue)}</g><rect y="300" width="300" height="150" fill="hsl(${hue},55%,8%)" opacity=".55"/>${wrap(title).map((l, i) => `<text x="150" y="${352 + i * 34}" font-family="sans-serif" font-size="29" font-weight="800" fill="white" text-anchor="middle">${l}</text>`).join('')}</svg>`);

function create(opts = {}) {
  const now = Date.now();
  const st = {
    streams: opts.streams || 0, altSpeed: false, calls: [],
    profiles: [{ id: 1, name: 'Any' }, { id: 2, name: 'HD-1080p' }, { id: 3, name: 'Ultra-HD' }],
    shows: [
      ['Harbor Lights', 2019, 4, 8, 'continuing', 'Northwind', ['Drama', 'Mystery'], 8.1],
      ['The Long Orbit', 2021, 3, 10, 'continuing', 'Starfall', ['Sci-Fi'], 8.6],
      ['Kitchen Wars', 2017, 6, 12, 'ended', 'Citrus TV', ['Reality'], 7.2],
      ['Paper Kingdoms', 2022, 2, 6, 'continuing', 'Northwind', ['Fantasy', 'Adventure'], 8.9],
      ['Night Shift', 2015, 5, 13, 'ended', 'Citrus TV', ['Comedy'], 7.7],
      ['Deep Field', 2023, 1, 8, 'continuing', 'Starfall', ['Documentary'], 8.3],
    ].map((x, i) => {
      const [title, year, seasons, per, status, network, genres, rating] = x, id = i + 1, eps = [];
      for (let s = 1; s <= seasons; s++) for (let e = 1; e <= per; e++) {
        // The newest season of a running show is still airing: a few episodes are in the future.
        const live = status === 'continuing' && s === seasons, weeksAgo = live ? per - e - 3 : (seasons - s) * 40 + per - e + 12;
        const t = now - weeksAgo * 7 * DAY, has = t < now && !(live && e > per - 4) && !(id === 1 && s === 2 && e > 5);
        eps.push({ id: id * 1000 + s * 100 + e, seriesId: id, seasonNumber: s, episodeNumber: e, title: `Episode ${e}`, overview: `In episode ${e} of season ${s}, something invented happens.`, runtime: 44, airDateUtc: iso(t), monitored: true,
          hasFile: has, episodeFileId: has ? id * 1000 + s * 100 + e : 0, size: has ? 900e6 + e * 11e6 : 0 });
      }
      return { id, title, year, status, network, genres, ratings: { value: rating }, overview: `${title} is a demo show. Nothing here is real.`, monitored: true, qualityProfileId: 2,
        seasonsN: seasons, eps, seasons: Array.from({ length: seasons }, (_, k) => ({ seasonNumber: k + 1, monitored: true })), hue: (i * 57) % 360, added: iso(now, -400 + i * 30) };
    }),
    movies: [
      ['Glass Meridian', 2024, 'Thriller', 7.4, true], ['Salt & Ember', 2023, 'Drama', 8.0, true], ['The Last Lighthouse', 2022, 'Horror', 6.9, true],
      ['Parallel Sundays', 2025, 'Romance', 7.1, false], ['Orbit Breakers', 2021, 'Action', 7.8, true], ['Quiet Machines', 2026, 'Sci-Fi', 8.4, false],
    ].map((x, i) => ({ id: i + 1, title: x[0], year: x[1], genres: [x[2]], ratings: { imdb: { value: x[3] } }, overview: `${x[0]} is a demo movie.`, monitored: true, hasFile: x[4], sizeOnDisk: x[4] ? 4.2e9 + i * 3e8 : 0,
      qualityProfileId: i % 2 ? 3 : 2, runtime: 95 + i * 7, studio: 'Demo Pictures', status: x[4] ? 'released' : 'announced', certification: 'PG-13', hue: (i * 83 + 20) % 360, added: iso(now, -200 + i * 20),
      inCinemas: iso(now, x[4] ? -300 : 25), digitalRelease: x[4] ? iso(now, -250) : iso(now, 40) })),
    torrents: [
      ['Harbor.Lights.S04E06.1080p.WEB.x265', 1.4e9, 0.62, 'tv'], ['The.Long.Orbit.S03E08.2160p.WEB', 4.8e9, 0.18, 'tv'],
      ['Glass.Meridian.2024.1080p.BluRay', 8.1e9, 1, 'movies'], ['Ubuntu.24.04.iso', 5.9e9, 1, 'software'],
    ].map((x, i) => ({ hash: ('abcdef0123'.repeat(5)).slice(i, i + 40).padEnd(40, String(i)), name: x[0], size: x[1], progress: x[2], category: x[3], tags: '', state: x[2] >= 1 ? 'stalledUP' : 'downloading',
      dlspeed: x[2] >= 1 ? 0 : 2.4e6, upspeed: x[2] >= 1 ? 3e5 : 4e4, eta: x[2] >= 1 ? 8640000 : 3600, ratio: 1.2, num_seeds: 12, num_leechs: 3, added_on: Math.floor(now / 1000) - 86400 * (i + 1),
      completion_on: x[2] >= 1 ? Math.floor(now / 1000) - 3600 * (i + 2) : -1, save_path: '/downloads', amount_left: Math.round(x[1] * (1 - x[2])), uploaded: Math.round(x[1] * 1.2), downloaded: Math.round(x[1] * x[2]), priority: i + 1 })),
    indexers: [['NZBgeek', 'usenet'], ['1337x', 'torrent'], ['Demo Tracker', 'torrent'], ['Broken Tracker', 'torrent'], ['Archive Box', 'torrent'], ['Old Usenet', 'usenet']]
      .map((x, i) => ({ id: i + 1, name: x[0], protocol: x[1], enable: i !== 4, priority: 25, implementationName: 'Demo' })),
    artists: [['The Night Owls', 'Indie'], ['Velvet Static', 'Electronic'], ['Mara Quinn', 'Folk']].map((x, i) => ({ id: i + 1, artistName: x[0], overview: `${x[0]} (${x[1]}) is a demo artist.`, monitored: true, genres: [x[1]], hue: (i * 120 + 200) % 360,
      statistics: { albumCount: 3 + i, trackFileCount: 20 + i * 4, trackCount: 30 + i * 4, sizeOnDisk: 4e8 + i * 1e8 }, added: iso(now, -100), qualityProfileId: 1, metadataProfileId: 1 })),
    authors: [['Ada Linden', 'Fantasy'], ['Tom Reyes', 'Mystery']].map((x, i) => ({ id: i + 1, authorName: x[0], overview: `${x[0]} writes ${x[1]} books (demo).`, monitored: true, genres: [x[1]], hue: (i * 90 + 30) % 360,
      statistics: { bookCount: 5 + i, bookFileCount: 3 + i, totalBookCount: 6 + i, sizeOnDisk: 2e8 }, added: iso(now, -100), qualityProfileId: 1, metadataProfileId: 1 })),
    seerrReq: {}, nextReq: 100,
    subsEp: [{ seriesTitle: 'Harbor Lights', episode_number: '2x06', episodeTitle: 'Episode 6', sonarrSeriesId: 1, sonarrEpisodeId: 1206, missing_subtitles: [{ name: 'English', code2: 'en', code3: 'eng', forced: false, hi: false }] },
      { seriesTitle: 'The Long Orbit', episode_number: '3x02', episodeTitle: 'Episode 2', sonarrSeriesId: 2, sonarrEpisodeId: 2302, missing_subtitles: [{ name: 'English', code2: 'en', code3: 'eng', forced: false, hi: false }, { name: 'Spanish', code2: 'es', code3: 'spa', forced: false, hi: false }] }],
    subsMov: [{ title: 'Salt & Ember', radarrId: 2, missing_subtitles: [{ name: 'English', code2: 'en', code3: 'eng', forced: false, hi: false }] }],
    sabHist: [{ nzo_id: 'SABnzbd_nzo_a1', name: 'Harbor.Lights.S04E05.1080p', size: '1.3 GB', status: 'Completed', fail_message: '', category: 'tv', completed: Math.floor(now / 1000) - 7200 },
      { nzo_id: 'SABnzbd_nzo_a2', name: 'Orbit.Breakers.2021.2160p', size: '14.2 GB', status: 'Failed', fail_message: 'Aborted, cannot be completed', category: 'movies', completed: Math.floor(now / 1000) - 90000 }],
  };
  const json = (res, d, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  const body = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({ _raw: b }); } }); });
  const stats = sr => { const have = sr.eps.filter(e => e.hasFile).length; return { seasonCount: sr.seasonsN, episodeCount: sr.eps.filter(e => Date.parse(e.airDateUtc) < now).length, episodeFileCount: have, sizeOnDisk: have * 1e9 }; };
  const sonarrOut = sr => ({ id: sr.id, title: sr.title, year: sr.year, status: sr.status, network: sr.network, genres: sr.genres, ratings: sr.ratings, overview: sr.overview, monitored: sr.monitored,
    qualityProfileId: sr.qualityProfileId, seasons: sr.seasons, statistics: stats(sr), images: [{ coverType: 'poster', remoteUrl: svg(sr.title, sr.hue, sr.id) }, { coverType: 'fanart', remoteUrl: fan(sr.title, sr.hue, sr.id), url: `/MediaCover/${sr.id}/fanart.jpg` }], added: sr.added, tvdbId: 9000 + sr.id, tmdbId: 7000 + sr.id, imdbId: 'tt' + (2000000 + sr.id) });
  const radarrOut = mv => ({ ...mv, imdbId: 'tt' + (1000000 + mv.id), images: [{ coverType: 'poster', remoteUrl: svg(mv.title, mv.hue, mv.id + 1) }, { coverType: 'fanart', remoteUrl: fan(mv.title, mv.hue, mv.id + 1), url: `/MediaCover/${mv.id}/fanart.jpg` }], tmdbId: 5000 + mv.id });
  const media = (kind, x) => ({ ...x, images: [{ coverType: 'poster', remoteUrl: svg(x.artistName || x.authorName, x.hue) }] });
  const monitorEps = (ids, on) => st.shows.forEach(s => s.eps.forEach(e => { if (ids.includes(e.id)) e.monitored = on; }));

  async function arrApp(type, req, res, p, q) {
    const tv = type === 'sonarr', m = req.method, data = ['POST', 'PUT', 'DELETE'].includes(m) ? await body(req) : {}, a = tv ? st.shows : st.movies;
    st.calls.push(`${type} ${m} ${p}${q.toString() ? '?' + q : ''} ${m === 'GET' ? '' : JSON.stringify(data).slice(0, 300)}`);
    if (p === '/api/v3/system/status') return json(res, { version: '4.0.0.demo', appName: type });
    if (p === '/api/v3/health') return json(res, tv ? [{ type: 'warning', source: 'IndexerStatusCheck', message: 'Indexers unavailable due to failures: Broken Tracker' }] : []);
    if (p === '/api/v3/diskspace') return json(res, [{ path: '/tv', label: 'Media', freeSpace: 420e9, totalSpace: 4e12 }, { path: '/movies', label: 'Movies', freeSpace: 60e9, totalSpace: 2e12 }, { path: '/', freeSpace: 42e9, totalSpace: 53e9 }, { path: '/downloads', freeSpace: 900e9, totalSpace: 2e12 }]);
    if (p === '/api/v3/qualityprofile') return json(res, st.profiles);
    if (p === '/api/v3/rootfolder') return json(res, [{ path: tv ? '/tv' : '/movies' }]);
    if (p === '/api/v3/command' && m === 'POST') return json(res, { id: 1, name: data.name });
    if (p === '/api/v3/queue/details') return json(res, (st.queueDetails || []).filter(r => (q.get('movieId') && +r.movieId === +q.get('movieId')) || (q.get('seriesId') && +r.seriesId === +q.get('seriesId'))));
    if (p === '/api/v3/queue') return json(res, { records: [{ id: 1, title: 'Harbor.Lights.S04E06', size: 1.4e9, sizeleft: 5e8, timeleft: '00:12:00', status: 'downloading', trackedDownloadStatus: 'ok', series: { title: 'Harbor Lights' }, movie: { title: 'Glass Meridian' } },
      { id: 2, title: 'Stuck.Release.1080p', size: 2e9, sizeleft: 2e9, status: 'warning', trackedDownloadStatus: 'warning', statusMessages: [{ messages: ['No files found are eligible for import'] }], series: { title: 'Night Shift' } }].slice(0, tv ? 2 : 1), totalRecords: 2 });
    if (p === '/api/v3/release') return json(res, [
      { guid: 'g1', indexerId: 1, title: 'Demo.Release.2024.1080p.WEB-DL.DDP5.1.H264-GRP', size: 4.2e9, seeders: 182, leechers: 9, indexer: 'DemoTracker', quality: { quality: { name: 'WEBDL-1080p' } }, age: 3, languages: [{ id: 1, name: 'English' }], infoUrl: 'https://tracker.example/details/12345', protocol: 'torrent', releaseGroup: 'GRP' },
      { guid: 'https://tracker2.example/torrent/987', indexerId: 2, title: 'Demo.Release.2024.MULTi.1080p.BluRay.x264-TEAM', size: 8.8e9, seeders: 64, indexer: 'OtherTracker', quality: { quality: { name: 'Bluray-1080p' } }, age: 40, languages: [{ id: 1, name: 'English' }, { id: 2, name: 'French' }, { id: 3, name: 'German' }], protocol: 'torrent', releaseGroup: 'TEAM' },
      { guid: 'g3', indexerId: 1, title: 'Demo.Release.2024.720p.HDTV.x264-OLD', size: 1.4e9, seeders: 7, indexer: 'DemoTracker', quality: { quality: { name: 'HDTV-720p' } }, age: 400, languages: [], infoUrl: 'https://tracker.example/dl?passkey=SECRET123', protocol: 'torrent', rejected: true, rejections: ['Not an upgrade for existing file'] }]);
    if (p.startsWith('/api/v3/calendar')) {
      const f = tv ? st.shows.flatMap(s => s.eps.filter(e => { const t = Date.parse(e.airDateUtc); return t > now - DAY && t < now + 30 * DAY; }).map(e => ({ ...e, series: sonarrOut(s), seriesId: s.id })))
        : st.movies.filter(x => Date.parse(x.digitalRelease) > now - DAY * 3).map(radarrOut);
      return json(res, f);
    }
    if (p.startsWith('/api/v3/wanted/')) {
      const rec = tv ? st.shows.flatMap(s => s.eps.filter(e => !e.hasFile && Date.parse(e.airDateUtc) < now && e.monitored).map(e => ({ ...e, series: sonarrOut(s) }))) : st.movies.filter(x => x.monitored && !x.hasFile).map(radarrOut);
      return json(res, { page: 1, pageSize: 30, totalRecords: rec.length, records: rec });
    }
    if (tv) {
      if (p === '/api/v3/series/lookup') return json(res, ['Harbor Lights', 'Paper Kingdoms', 'Hidden Valley', 'Hidden Figures Reloaded'].filter(t => t.toLowerCase().includes(String(q.get('term') || '').toLowerCase())).map((t, i) => ({ title: t, year: 2020 + i, overview: 'Demo result.', remotePoster: svg(t, i * 70), tvdbId: 1e5 + i, id: st.shows.find(s => s.title === t) ? st.shows.find(s => s.title === t).id : undefined })));
      if (p === '/api/v3/series' && m === 'GET') return json(res, a.map(sonarrOut));
      if (p === '/api/v3/series' && m === 'POST') return json(res, { id: 99 });
      if (p === '/api/v3/series/editor') {
        const ids = data.seriesIds || [];
        a.filter(s => ids.includes(s.id)).forEach(s => { if (m === 'PUT') { if ('monitored' in data) s.monitored = !!data.monitored; if (data.qualityProfileId) s.qualityProfileId = +data.qualityProfileId; } });
        if (m === 'DELETE') st.shows = st.shows.filter(s => !ids.includes(s.id));
        return json(res, {});
      }
      let r = p.match(/^\/api\/v3\/series\/(\d+)$/);
      if (r) { const s = a.find(x => x.id === +r[1]); if (!s) return json(res, { message: 'NotFound' }, 404);
        if (m === 'PUT') { s.monitored = !!data.monitored; (data.seasons || []).forEach(d => { const t = s.seasons.find(y => y.seasonNumber === d.seasonNumber); if (t) t.monitored = !!d.monitored; }); return json(res, data); }
        if (m === 'DELETE') { st.shows = st.shows.filter(x => x !== s); return json(res, {}); }
        return json(res, sonarrOut(s)); }
      { const em = p.match(/^\/api\/v3\/episode\/(\d+)$/); if (em && m === 'GET') { for (const sr of a) { const e = sr.eps.find(y => y.id === +em[1]); if (e) return json(res, { ...e, seriesId: sr.id, ...(e.hasFile ? { episodeFile: { relativePath: sr.title.replace(/ /g, '.') + '.S0' + e.seasonNumber + 'E0' + e.episodeNumber + '.1080p.WEB-DL.mkv', size: e.size, quality: { quality: { name: 'WEBDL-1080p' } }, languages: [{ name: 'English' }], dateAdded: '2026-09-02T10:00:00Z' } } : {}) }); } return json(res, {}, 404); } }
      if (p === '/api/v3/episode' && m === 'GET') { const s = a.find(x => x.id === +q.get('seriesId')); return json(res, s ? s.eps.map(({ size, ...e }) => e) : []); }
      if (p === '/api/v3/episodefile') { const s = a.find(x => x.id === +q.get('seriesId')); return json(res, s ? s.eps.filter(e => e.hasFile).map(e => ({ id: e.episodeFileId, size: e.size, quality: { quality: { name: 'WEBDL-1080p' } } })) : []); }
      if (p === '/api/v3/episode/monitor') { monitorEps(data.episodeIds || [], !!data.monitored); return json(res, {}); }
    } else {
      if (p === '/api/v3/movie/lookup') return json(res, ['Glass Meridian', 'Hidden Harbor', 'Blue Hour'].filter(t => t.toLowerCase().includes(String(q.get('term') || '').toLowerCase())).map((t, i) => ({ title: t, year: 2020 + i, overview: 'Demo result.', remotePoster: svg(t, i * 90), tmdbId: 6e3 + i, id: st.movies.find(s => s.title === t) ? 1 : undefined })));
      { const mm = p.match(/^\/api\/v3\/movie\/(\d+)$/); if (mm && m === 'GET') { const x = a.find(y => y.id === +mm[1]); return x ? json(res, { ...radarrOut(x), isAvailable: true, ...(x.hasFile ? { movieFile: { relativePath: x.title.replace(/ /g, '.') + '.2024.1080p.WEB-DL.x265.mkv', size: x.sizeOnDisk, quality: { quality: { name: 'WEBDL-1080p' } }, languages: [{ name: 'English' }], mediaInfo: { videoCodec: 'x265' }, dateAdded: '2026-09-02T10:00:00Z' } } : {}) }) : json(res, {}, 404); } }
      if (p === '/api/v3/movie' && m === 'GET') { const t = q.get('tmdbId'); return json(res, a.filter(x => !t || 5000 + x.id === +t).map(radarrOut)); }
      if (p === '/api/v3/movie' && m === 'POST') return json(res, { id: 99 });
      if (p === '/api/v3/movie/editor') {
        const ids = data.movieIds || [];
        a.filter(s => ids.includes(s.id)).forEach(s => { if (m === 'PUT') { if ('monitored' in data) s.monitored = !!data.monitored; if (data.qualityProfileId) s.qualityProfileId = +data.qualityProfileId; } });
        if (m === 'DELETE') st.movies = st.movies.filter(s => !ids.includes(s.id));
        return json(res, {});
      }
      const r = p.match(/^\/api\/v3\/movie\/(\d+)$/);
      if (r) { const s = a.find(x => x.id === +r[1]); if (!s) return json(res, { message: 'NotFound' }, 404);
        if (m === 'PUT') { s.monitored = !!data.monitored; return json(res, data); }
        if (m === 'DELETE') { st.movies = st.movies.filter(x => x !== s); return json(res, {}); }
        return json(res, radarrOut(s)); }
    }
    json(res, [], 200);
  }

  async function musicBooks(type, req, res, p, q) {
    const music = type === 'lidarr', ent = music ? 'artist' : 'author', list = music ? st.artists : st.authors, m = req.method, data = ['POST', 'PUT', 'DELETE'].includes(m) ? await body(req) : {};
    st.calls.push(`${type} ${m} ${p}${q.toString() ? '?' + q : ''} ${m === 'GET' ? '' : JSON.stringify({ ...data, images: undefined, overview: undefined }).slice(0, 300)}`);
    const nm = x => x.artistName || x.authorName;
    if (p === '/api/v1/system/status') return json(res, { version: '2.0.0.demo' });
    if (p === '/api/v1/health') return json(res, []);
    if (p === '/api/v1/rootfolder') return json(res, [{ path: music ? '/music' : '/books' }]);
    if (p === '/api/v1/qualityprofile') return json(res, [{ id: 1, name: music ? 'Lossless' : 'eBook' }, { id: 2, name: 'Standard' }]);
    if (p === '/api/v1/metadataprofile') return json(res, [{ id: 1, name: 'Standard' }]);
    if (p === '/api/v1/command') return json(res, { id: 1, name: data.name });
    if (p === '/api/v1/wanted/missing') return json(res, { totalRecords: 7, records: [] });
    if (p === `/api/v1/${ent}/lookup`) return json(res, ['Echo Valley', 'The Night Owls', 'Ada Linden', 'Old Maps'].filter(t => t.toLowerCase().includes(String(q.get('term') || '').toLowerCase())).map((t, i) => ({
      [music ? 'artistName' : 'authorName']: t, overview: 'Demo result.', foreignArtistId: 'f' + i, foreignAuthorId: 'f' + i, images: [{ coverType: 'poster', remoteUrl: svg(t, i * 80) }], id: list.find(x => nm(x) === t) ? 1 : undefined })));
    if (p === `/api/v1/${ent}` && m === 'GET') return json(res, list.map(x => media(0, x)));
    if (p === `/api/v1/${ent}` && m === 'POST') return json(res, { id: 50 });
    const r = p.match(new RegExp(`^/api/v1/${ent}/(\\d+)$`));
    if (r) { const x = list.find(y => y.id === +r[1]); if (!x) return json(res, { message: 'NotFound' }, 404);
      if (m === 'PUT') { x.monitored = !!data.monitored; return json(res, data); }
      if (m === 'DELETE') { list.splice(list.indexOf(x), 1); return json(res, {}); }
      return json(res, media(0, x)); }
    json(res, [], 200);
  }

  // Pretend Trakt, TMDB and TheTVDB: invented titles, so the Discover lists can be tried without any key.
  const NM = ['Glass Orchard', 'Midnight Ferry', 'The Last Lantern', 'Salt and Thunder', 'Northern Static', 'Hollow Crown Road', 'Velvet Orbit', 'Ash and Ember', 'The Quiet Harbor', 'Copper Sky', 'Longest Winter', 'Paper Lanterns', 'Tidewater', 'Red Meridian', 'Little Thunder', 'The Borrowed Hour'];
  const pick = (kind, list) => { const off = ({ trending: 0, popular: 5, anticipated: 9 })[list] || 0, base = kind === 'tv' ? 100 : 0;
    return Array.from({ length: 12 }, (_, i) => { const n = (i + off) % NM.length, id = base + n; return { n, id, title: NM[n] + (kind === 'tv' ? ' Season' : ''), year: list === 'anticipated' ? 2027 : 2020 + (n % 6), hue: (n * 47) % 360, rating: 6 + (n % 30) / 10 }; }); };
  function listSites(site, req, res, sub, q) {
    const keyed = site === 'trakt' ? req.headers['trakt-api-key'] : site === 'tmdb' ? (q.get('api_key') || (req.headers.authorization || '').replace(/^Bearer /, '')) : (req.headers.authorization || '').replace(/^Bearer /, '');
    st.calls.push(`${site} ${sub} key=${keyed || ''}`);
    if (site === 'tvdb' && sub === '/login') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(req.method === 'POST' ? { status: 'success', data: { token: 'tvdb-token' } } : {})); }
    if (!keyed || String(keyed).startsWith('wrong') || (site === 'tvdb' && keyed !== 'tvdb-token')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"Invalid API key"}'); }
    const parts = sub.split('/').filter(Boolean);
    if (site === 'trakt') {   // /movies/trending, /shows/popular ...
      const kind = parts[0] === 'shows' ? 'tv' : 'movie', list = parts[1];
      const out = pick(kind, list).map(x => ({ title: x.title, year: x.year, overview: 'An invented story for the demo.', rating: x.rating, ids: { trakt: 50000 + x.id, imdb: 'tt' + (3000000 + x.id), tmdb: 9000 + x.id, ...(kind === 'tv' ? { tvdb: 80000 + x.id } : {}) } }));
      return json(res, list === 'popular' ? out : out.map((o, i) => ({ [list === 'trending' ? 'watchers' : 'list_count']: 900 - i * 40, [kind === 'tv' ? 'show' : 'movie']: o })));
    }
    if (site === 'tmdb') {
      const kind = (parts[1] === 'tv' || parts[0] === 'tv') ? 'tv' : 'movie';
      const posterOf = id => { const x = pick(kind, 'trending').concat(pick(kind, 'popular'), pick(kind, 'anticipated')).find(y => 9000 + y.id === id); return x ? svg(x.title, x.hue, x.id) : null; };
      if (parts[0] === 'movie' || parts[0] === 'tv') { if (/^\d+$/.test(parts[1] || '')) return json(res, { id: +parts[1], poster_path: posterOf(+parts[1]) }); }
      const list = parts[0] === 'trending' ? 'trending' : parts[0] === 'discover' ? 'anticipated' : 'popular';
      return json(res, { results: pick(kind, list).map(x => ({ id: 9000 + x.id, [kind === 'tv' ? 'name' : 'title']: x.title, [kind === 'tv' ? 'first_air_date' : 'release_date']: x.year + '-06-01', overview: 'An invented story for the demo.', poster_path: svg(x.title, x.hue, x.id), vote_average: x.rating })) });
    }
    const kind = parts[0] === 'series' ? 'tv' : 'movie', list = q.get('status') === '3' ? 'anticipated' : 'popular';
    return json(res, { status: 'success', data: pick(kind, list).map(x => ({ id: 80000 + x.id, name: x.title, year: String(x.year), overview: 'An invented story for the demo.', image: svg(x.title, x.hue, x.id), score: 90000 - x.n * 100 })) });
  }
  // Pretend indexer lists for Prowlarr and Jackett, so adding one can be tried without a real tracker.
  const PROWLARR_CATALOG = [
    { def: 'open-tracker', name: 'Open Tracker', privacy: 'public', fields: [{ name: 'baseUrl', label: 'Site address', type: 'select', value: 'https://open.example', selectOptions: [{ value: 'https://open.example', name: 'open.example' }, { value: 'https://mirror.example', name: 'mirror.example' }] }, { name: 'definitionFile', type: 'textbox', value: 'open-tracker', hidden: 'hidden' }] },
    { def: 'club-tracker', name: 'Club Tracker', privacy: 'private', fields: [{ name: 'username', label: 'Username', type: 'textbox', value: '' }, { name: 'password', label: 'Password', type: 'password', value: '' }, { name: 'freeleech', label: 'Only freeleech', type: 'checkbox', value: false, helpText: 'Skip anything that counts against your ratio' }, { name: 'sort', label: 'Sort by', type: 'textbox', value: 'created', advanced: true }] },
    { def: 'night-index', name: 'Night Index', privacy: 'semiPrivate', fields: [{ name: 'apikey', label: 'API key', type: 'textbox', value: '' }] }
  ];
  const jk = { list: [{ id: 'open-tracker', name: 'Open Tracker', description: 'Pretend', type: 'public', configured: true, site_link: 'https://open.example/', language: 'en-US', last_error: '' }, { id: 'broken-tracker', name: 'Broken Tracker', description: 'Pretend', type: 'public', configured: true, site_link: 'https://broken.example/', language: 'en-US', last_error: 'Unable to connect to the tracker' }, { id: 'club-tracker', name: 'Club Tracker', description: 'Pretend private tracker', type: 'private', configured: false, site_link: 'https://club.example/', language: 'en-US', last_error: '' }, { id: 'night-index', name: 'Night Index', description: 'Pretend semi-private tracker', type: 'semi-private', configured: false, site_link: 'https://night.example/', language: 'en-US', last_error: '' }] };
  const JK_FIELDS = { 'club-tracker': () => [{ id: 'username', type: 'inputstring', name: 'Username', value: '' }, { id: 'password', type: 'inputstring', name: 'Password', value: '' }, { id: 'freeleech', type: 'inputbool', name: 'Only freeleech', value: false }, { id: 'sort', type: 'inputselect', name: 'Sort requested from site', value: 'created', options: { created: 'created', seeders: 'seeders' } }, { id: 'info', type: 'displayinfo', name: 'About', value: 'Needs an <a href="x">account</a> on the site.' }, { id: 'sitelink', type: 'hiddendata', name: 'Site link', value: 'https://club.example/' }], 'night-index': () => [{ id: 'apikey', type: 'inputstring', name: 'API key', value: '' }] };
  const jackettApp = async (req, res, sub, q, m) => {
    const signedIn = /(^|; )Jackett=session-ok/.test(req.headers.cookie || '');
    if (!signedIn && (!q.get('apikey') || q.get('apikey') === 'wrong')) return json(res, { error: 'Invalid API key' }, 401);
    if (st.jackettSettingsBroken) { res.writeHead(400); return res.end(''); }
    if (st.jackettAdminPass && !signedIn) { res.writeHead(400); return res.end(''); }
    const r = sub.match(/^\/api\/v2\.0\/indexers(?:\/([\w.-]+)(?:\/(\w+))?)?$/);
    if (!r) return null;
    const [, id, act] = r, one = jk.list.find(x => x.id === id);
    if (!id && m === 'GET') return json(res, q.get('configured') === 'true' ? jk.list.filter(x => x.configured) : jk.list);
    if (!one) return json(res, { error: 'Indexer not found' }, 404);
    if (act === 'config' && m === 'GET') return json(res, (JK_FIELDS[id] || (() => []))());
    if (act === 'config' && m === 'POST') {
      const f = await body(req), pw = (Array.isArray(f) ? f : []).find(x => x.id === 'password');
      if (pw && !String(pw.value || '').trim()) return json(res, { result: 'error', error: 'An error occurred while configuring this indexer: password is required' }, 500);
      one.configured = true; st.calls.push('jackett add ' + id + ' ' + JSON.stringify((Array.isArray(f) ? f : []).map(x => [x.id, x.value]))); res.writeHead(204); return res.end();
    }
    if (act === 'test' && m === 'POST') { if (id === 'broken-tracker') return json(res, { result: 'error', error: 'Unable to connect to the tracker: timeout' }, 500); res.writeHead(204); return res.end(); }
    if (!act && m === 'DELETE') { one.configured = false; st.calls.push('jackett remove ' + id); res.writeHead(204); return res.end(); }
    return json(res, {}, 404);
  };
  async function handle(req, res, rest) {
    const u = new URL(rest, 'http://x'), p = u.pathname, q = u.searchParams, m = req.method, parts = p.split('/').filter(Boolean), type = parts[0], sub = '/' + parts.slice(1).join('/');
    if ((type === 'sonarr' || type === 'radarr') && /^\/MediaCover\/\d+\/fanart\.jpg$/.test(sub)) {   // a stand-in picture so the cached sign-in wallpapers can be tested
      const b = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6000, 7)]); res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(b);
    }
    if (type === 'sonarr' || type === 'radarr') return arrApp(type, req, res, sub, q);
    if (type === 'lidarr' || type === 'readarr') return musicBooks(type, req, res, sub, q);
    if (type === 'qbittorrent') {
      const raw = m === 'POST' ? await body(req) : {}, data = raw._raw != null ? Object.fromEntries(new URLSearchParams(raw._raw)) : raw;
      if (sub === '/api/v2/auth/login') { res.writeHead(200, { 'Set-Cookie': 'SID=demo; path=/', 'Content-Type': 'text/plain' }); return res.end('Ok.'); }
      if (sub === '/api/v2/app/version') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('v5.0.0-demo'); }
      if (sub === '/api/v2/transfer/speedLimitsMode') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(st.altSpeed ? '1' : '0'); }
      if (sub === '/api/v2/transfer/toggleSpeedLimitsMode') { st.altSpeed = !st.altSpeed; st.calls.push('qb toggleSpeedLimitsMode -> ' + st.altSpeed); res.writeHead(200); return res.end(''); }
      const cats = () => st.qbCats || { tv: { name: 'tv', savePath: '/downloads/tv' }, movies: { name: 'movies', savePath: '/downloads/movies' }, software: { name: 'software', savePath: '/downloads/sw' } };
      const wob = 0.85 + 0.3 * Math.sin(Date.now() / 4000);
      const live = () => st.torrents.map(x => x.progress < 1 ? { ...x, dlspeed: Math.round(x.dlspeed * wob * (st.altSpeed ? 0.2 : 1)), progress: Math.min(0.99, x.progress + ((Date.now() / 60000) % 0.2)) } : x);
      if (sub === '/api/v2/torrents/info') return json(res, live());
      if (sub.startsWith('/api/v2/sync/maindata')) return json(res, { server_state: { dl_info_speed: Math.round(2.4e6 * wob * (st.altSpeed ? 0.2 : 1)), up_info_speed: 3.5e5, dl_info_data: 4e10, up_info_data: 6e10, connection_status: 'connected', last_external_address_v4: '203.0.113.7',
        free_space_on_disk: 600e9, use_alt_speed_limits: st.altSpeed, dl_rate_limit: 0, up_rate_limit: 0 }, torrents: {}, categories: cats(), tags: st.qbTags || [] });
      if (sub === '/api/v2/transfer/info') return json(res, { dl_info_speed: Math.round(2.4e6 * wob * (st.altSpeed ? 0.2 : 1)), up_info_speed: Math.round(3.5e5 * (2 - wob)), dl_info_data: 4e10, up_info_data: 6e10, connection_status: 'connected' });
      if (sub === '/api/v2/torrents/categories') return json(res, cats());
      if (sub === '/api/v2/torrents/createCategory') { const n = String(data.category || ''); if (!n || /^\//.test(n)) { res.writeHead(409); return res.end('Category name is invalid'); } st.qbCats = { ...cats(), [n]: { name: n, savePath: String(data.savePath || '') } }; res.writeHead(200); return res.end(''); }
      if (sub === '/api/v2/torrents/removeCategories') { const c = cats(); for (const n of String(data.categories || '').split('\n')) delete c[n]; st.qbCats = c; res.writeHead(200); return res.end(''); }
      if (sub === '/api/v2/torrents/createTags') { st.qbTags = [...new Set([...(st.qbTags || []), ...String(data.tags || '').split(',').map(x => x.trim()).filter(Boolean)])]; res.writeHead(200); return res.end(''); }
      if (sub === '/api/v2/torrents/tags') return json(res, []);
      if (sub === '/api/v2/app/preferences') return json(res, { scheduler_enabled: false, alt_dl_limit: 1024000, alt_up_limit: 512000, dl_limit: 0, up_limit: 0 });
      if (sub.startsWith('/api/v2/rss/')) return json(res, {});
      st.calls.push('qb ' + sub + ' ' + JSON.stringify(data).slice(0, 120)); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('');
    }
    if (type === 'trakt' || type === 'tmdb' || type === 'tvdb') return listSites(type, req, res, sub, q);
    if (type === 'plextv') {   // pretend plex.tv: sign-in window, pin, who-is-this and which-servers-can-they-reach
      if (sub.startsWith('/auth')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta charset=utf-8><title>Pretend Plex</title><body style="font:16px system-ui;background:#1f1f1f;color:#eee;display:grid;place-items:center;height:100vh"><p>Pretend Plex sign-in. Approved as ' + (st.plexWho || 'alex') + '. This window closes by itself.</p><script>setTimeout(function(){window.close()},1200)</script>'); }
      st.pinAt = st.pinAt || {};
      if (sub.startsWith('/api/v2/pins') && m === 'POST') { st.pins = (st.pins || 0) + 1; const id = 1000 + st.pins; st.pinAt[id] = Date.now(); return json(res, { id, code: 'DEMO' + id, authToken: null }); }
      const pm = sub.match(/^\/api\/v2\/pins\/(\d+)/); if (pm) return json(res, { id: +pm[1], code: 'DEMO', authToken: Date.now() - (st.pinAt[pm[1]] || 0) > (st.pinDelay == null ? 1500 : st.pinDelay) ? 'plex-token-' + (st.plexWho || 'alex') : null });
      if (sub === '/api/users') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<MediaContainer><User id="4242" title="alex" username="alex" filterMovies="' + (st.plexFilter || '') + '" filterTelevision=""/></MediaContainer>'); }
      if (sub.startsWith('/api/v2/user')) { const w = st.plexWho || 'alex'; return json(res, { id: 4242, uuid: 'uuid-' + w, username: w, title: w, email: w + '@example.com' }); }
      if (sub.startsWith('/api/v2/resources')) return json(res, st.plexNoAccess ? [{ name: 'Someone else', provides: 'server', clientIdentifier: 'other-machine', owned: false }] : [{ name: 'Demo Plex', provides: 'server,player', clientIdentifier: 'demo-machine-id', owned: false, accessToken: 'demo-user-tok-' + (st.plexWho || 'alex') }]);
      return json(res, {});
    }
    if (type === 'plex') {
      if (sub === '/identity') return json(res, { MediaContainer: { machineIdentifier: 'demo-machine-id' } });
      if (sub === '/library/sections') { const all = [{ key: '1', title: 'Movies' }, { key: '2', title: 'TV Shows' }, { key: '3', title: 'Private' }], tk = req.headers['x-plex-token'] || ''; return json(res, { MediaContainer: { Directory: tk.startsWith('demo-user-tok') && !st.plexAll ? all.slice(0, 2) : all } }); }
      { const sm = sub.match(/^\/library\/sections\/(\d+)\/recentlyAdded/); if (sm) return json(res, { MediaContainer: { Metadata: [{ type: 'movie', ratingKey: '8' + sm[1], title: 'Library ' + sm[1] + ' item', year: 2024, addedAt: 1000 + +sm[1], thumb: '/library/metadata/9' + sm[1] + '/thumb' }, { type: 'movie', ratingKey: '7' + sm[1], title: 'Library ' + sm[1] + ' scary item', year: 2023, addedAt: 900 + +sm[1], thumb: '/library/metadata/6' + sm[1] + '/thumb' }] } }); }
      { const dm = sub.match(/^\/library\/metadata\/(\d+)$/); if (dm) { const k = dm[1], scary = k[0] === '7'; return json(res, { MediaContainer: { Metadata: [{ ratingKey: k, contentRating: scary ? 'R' : 'PG', Genre: [{ tag: scary ? 'Horror' : 'Comedy' }], ...(scary ? { Label: [{ tag: 'Adult' }] } : {}) }] } }); } }
      if (sub === '/hubs/search') { const t = String(q.get('query') || '').toLowerCase(); return json(res, { MediaContainer: { Hub: [{ type: 'movie', Metadata: (st.plexLib || []).filter(m => m.title.toLowerCase().includes(t)) }] } }); }
      if (sub === '/library/sections/all/refresh') { st.calls.push('plex refresh'); res.writeHead(200); return res.end(''); }
      if (sub === '/status/sessions/terminate') { st.calls.push('plex terminate ' + q.get('sessionId') + ' ' + q.get('reason')); res.writeHead(200); return res.end(''); }
      if (sub === '/status/sessions') return json(res, { MediaContainer: { Metadata: Array.from({ length: st.streams }, (_, i) => {
        const movie = i % 2 === 1, off = 9e5 + (Date.now() % 6e5) + i * 7e5, mv = st.movies[i % st.movies.length], tc = movie;
        return { type: movie ? 'movie' : 'episode', ...(movie ? { title: mv.title, year: mv.year, thumb: '/library/metadata/' + mv.id + '/thumb' } : { grandparentTitle: st.shows[i % st.shows.length].title, parentIndex: 1, index: i + 2, title: 'Demo episode', grandparentThumb: '/library/metadata/' + (i + 1) + '/thumb' }),
          duration: movie ? 6.4e6 : 2.7e6, viewOffset: off, Session: { id: 's' + i, bandwidth: movie ? 4200 : 8200, location: movie ? 'wan' : 'lan' }, User: { title: ['alex', 'sam', 'jo'][i % 3] },
          Player: { title: movie ? 'Phone' : 'Living Room TV', product: movie ? 'Plex for Android' : 'Plex for LG', state: 'playing' }, Media: [{ videoResolution: movie ? '1080' : '4k' }],
          ...(tc ? { TranscodeSession: { videoDecision: 'transcode', audioDecision: 'copy' } } : {}) };
      }) } });
      if (sub.startsWith('/library/recentlyAdded')) return json(res, { MediaContainer: { Metadata: Array.from({ length: 24 }, (_, i) => ({ type: 'movie', ratingKey: String(300 + i), title: 'New item ' + i, year: 2025, addedAt: Math.round(Date.now() / 1000) - (i < (st.fresh == null ? 3 : st.fresh) ? i * 3600 : (20 + i) * 86400), thumb: '/library/metadata/' + (300 + i) + '/thumb' })) } });
      if (sub.startsWith('/library/metadata/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); const hue = [...sub].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7), t = decodeURIComponent(svg('Demo', hue).split(',')[1]); return res.end(t); }
      return json(res, { MediaContainer: {} });
    }
    if (type === 'jellyfin') {
      if (sub === '/System/Info' || sub === '/System/Info/Public') return json(res, { ServerName: 'Demo Jellyfin', Version: '10.10.0' });
      { const sm = sub.match(/^\/Sessions\/(\w+)\/(Message|Playing\/Stop)$/); if (sm && req.method === 'POST') { st.calls.push('jellyfin ' + sm[2] + ' ' + sm[1]); res.writeHead(204); return res.end(); } }
      if (sub === '/Sessions') { const mv = st.movies[2 % st.movies.length];
        return json(res, [{ Id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', UserName: 'riley', DeviceName: 'Fire TV', Client: 'Jellyfin for Android TV', RemoteEndPoint: '192.168.1.40',
          PlayState: { PositionTicks: (6e5 + Date.now() % 6e5) * 1e4, IsPaused: false, PlayMethod: 'DirectPlay' },
          NowPlayingItem: { Id: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', Name: mv.title, Type: 'Movie', ProductionYear: mv.year, RunTimeTicks: 6.2e7 * 1e3, Bitrate: 9e6, MediaStreams: [{ Type: 'Video', Height: 1080 }] } },
          { Id: 'ffffffffffffffffffffffffffffffff', UserName: 'idle', DeviceName: 'Web', Client: 'Jellyfin Web' }]); }
      if (sub.startsWith('/Items/') && sub.includes('/Images/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); const hue = [...sub].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11), t = decodeURIComponent(svg('Demo', hue).split(',')[1]); return res.end(t); }
      if (sub.startsWith('/Items')) return json(res, { Items: st.movies.filter(x => x.hasFile).slice(0, 5).map((x, i) => ({ Id: ('0a1b2c3d4e5f60718293a4b5c6d7e8f' + i).slice(-32), Name: x.title, ProductionYear: x.year, Type: 'Movie' })) });
      return json(res, {});
    }
    if (type === 'seerr') {
      const data = m === 'POST' ? await body(req) : {};
      if (sub === '/api/v1/status') return json(res, { version: '2.0.0.demo' });
      if (sub === '/api/v1/search') return json(res, { results: ['Hidden Valley', 'Hidden Harbor', 'Paper Kingdoms'].filter(t => t.toLowerCase().includes(String(q.get('query') || '').toLowerCase())).map((t, i) => (i === 1 ? { mediaType: 'movie', id: 800 + i, title: t, releaseDate: '2024-03-01', overview: 'Demo result.', posterPath: '' } : { mediaType: 'tv', id: 800 + i, name: t, firstAirDate: '2022-05-01', overview: 'Demo result.', posterPath: '' })) });
      let r = sub.match(/^\/api\/v1\/tv\/(\d+)$/);
      const cast = [['Ana Reyes', 'Captain'], ['Tom Okafor', 'Doctor'], ['Lin Park', 'Pilot']].map(([name, character]) => ({ name, character, profilePath: '' }));
      const mv = sub.match(/^\/api\/v1\/movie\/(\d+)$/);
      if (mv) return json(res, { id: +mv[1], title: 'Demo movie ' + mv[1], releaseDate: '2025-04-11', overview: 'An invented movie for the demo.', tagline: 'Nothing here is real.', posterPath: '', backdropPath: '', voteAverage: 7.6, runtime: 118,
        genres: [{ name: 'Drama' }, { name: 'Sci-Fi' }], status: 'Released', productionCompanies: [{ name: 'Demo Pictures' }], credits: { cast }, relatedVideos: [{ type: 'Trailer', site: 'YouTube', key: 'dQw4w9WgXcQ' }], mediaInfo: { status: 0 } });
      if (r) return json(res, { id: +r[1], name: 'Demo show', overview: 'An invented show for the demo.', firstAirDate: '2022-05-01', voteAverage: 8.1, episodeRunTime: [44], genres: [{ name: 'Drama' }], networks: [{ name: 'Demo TV' }], credits: { cast }, numberOfSeasons: 3, seasons: [{ seasonNumber: 0, episodeCount: 2 }, { seasonNumber: 1, episodeCount: 8 }, { seasonNumber: 2, episodeCount: 10 }, { seasonNumber: 3, episodeCount: 6 }] });
      if (sub === '/api/v1/request' && m === 'POST') { const id = st.nextReq++; st.seerrReq[id] = data; st.calls.push('seerr request ' + JSON.stringify(data)); return json(res, { id }); }
      r = sub.match(/^\/api\/v1\/request\/(\d+)$/);
      if (r) return json(res, { id: +r[1], status: 2, media: { status: 3 } });
      return json(res, {});
    }
    if (type === 'prowlarr') {
      const data = m === 'POST' ? await body(req) : {};
      if (sub === '/api/v1/system/status') return json(res, { version: '1.0.0.demo' });
      if (sub === '/api/v1/search') { const t = String(q.get('query') || 'Demo'); return json(res, [['IPTorrents', 2160, 412, 9.8e9], ['TorrentLeech', 1080, 230, 4.1e9], ['TorrentDay', 720, 61, 1.9e9]].map(([ix, r, se, sz], i) => ({ guid: 'g' + i, title: `${t}.2024.${r}p.WEB-DL.DDP5.1.x265-DEMO`, indexer: ix, indexerId: i + 1, size: sz, seeders: se, leechers: Math.round(se / 7), publishDate: new Date(Date.now() - i * 86400e3).toISOString(), infoUrl: `https://${ix.toLowerCase()}.example/details.php?id=${100 + i}`, magnetUrl: `magnet:?xt=urn:btih:${String(i).repeat(40)}&dn=${encodeURIComponent(t)}` }))); }
      if (sub === '/api/v1/health') return json(res, [{ type: 'warning', source: 'IndexerStatusCheck', message: 'Indexers unavailable due to failures: Broken Tracker' }]);
      if (sub === '/api/v1/appprofile') return json(res, [{ id: 1, name: 'Standard' }]);
      if (sub === '/api/v1/indexer/schema') return json(res, PROWLARR_CATALOG.map(c => ({ id: 0, name: c.name, definitionName: c.def, implementation: 'Cardigann', protocol: 'torrent', privacy: c.privacy, language: 'en-US', description: 'A pretend tracker for the demo.', enable: false, fields: c.fields })));
      if (sub === '/api/v1/indexer' && m === 'POST') {
        const bad = !q.get('forceSave') && (data.fields || []).find(f => f.name === 'password' && !String(f.value || '').trim());
        if (bad) return json(res, [{ propertyName: 'password', errorMessage: 'Password is required' }], 400);
        const id = Math.max(0, ...st.indexers.map(x => x.id)) + 1; st.calls.push('prowlarr add ' + data.name + (q.get('forceSave') ? ' forced' : ''));
        st.indexers.push({ id, name: data.name, protocol: data.protocol, enable: true, priority: data.priority }); return json(res, { id });
      }
      if (sub === '/api/v1/indexer') return json(res, st.indexers);
      if (sub === '/api/v1/indexerstatus') return json(res, [{ indexerId: 4, disabledTill: iso(now, 0.25), mostRecentFailure: iso(now, -0.02) }]);
      if (sub === '/api/v1/indexer/testall') return json(res, st.indexers.filter(x => x.enable).map(x => (x.id === 4 ? { id: x.id, isValid: false, validationFailures: [{ errorMessage: 'Unable to connect to indexer' }] } : { id: x.id, isValid: true, validationFailures: [] })));
      if (sub === '/api/v1/indexer/test') { const bad = data.id === 4; return bad ? json(res, [{ errorMessage: 'Unable to connect to indexer: timeout' }], 400) : json(res, {}); }
      const r = sub.match(/^\/api\/v1\/indexer\/(\d+)$/); if (r && m === 'DELETE') { st.indexers = st.indexers.filter(y => y.id !== +r[1]); st.calls.push('prowlarr remove ' + r[1]); return json(res, {}); }
      if (r) { const x = st.indexers.find(y => y.id === +r[1]); return x ? json(res, x) : json(res, { message: 'NotFound' }, 404); }
      return json(res, []);
    }
    if (type === 'bazarr') {
      const form = m === 'PATCH' || m === 'POST' ? await new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); }) : '';
      if (sub === '/api/system/status') return json(res, { data: { bazarr_version: '1.4.0.demo' } });
      if (sub === '/api/episodes/wanted') return json(res, { data: st.subsEp, total: st.subsEp.length });
      if (sub === '/api/movies/wanted') return json(res, { data: st.subsMov, total: st.subsMov.length });
      if (sub === '/api/episodes/subtitles' && m === 'PATCH') { st.calls.push('bazarr episodes ' + form); const p2 = new URLSearchParams(form); st.subsEp.forEach(e => { if (String(e.sonarrEpisodeId) === p2.get('episodeid')) e.missing_subtitles = e.missing_subtitles.filter(x => x.code2 !== p2.get('language')); }); st.subsEp = st.subsEp.filter(e => e.missing_subtitles.length); res.writeHead(204); return res.end(); }
      if (sub === '/api/movies/subtitles' && m === 'PATCH') { st.calls.push('bazarr movies ' + form); const p2 = new URLSearchParams(form); st.subsMov.forEach(e => { if (String(e.radarrId) === p2.get('radarrid')) e.missing_subtitles = e.missing_subtitles.filter(x => x.code2 !== p2.get('language')); }); st.subsMov = st.subsMov.filter(e => e.missing_subtitles.length); res.writeHead(204); return res.end(); }
      return json(res, { data: [] });
    }
    if (type === 'sabnzbd' || sub === '/api') {
      const mode = q.get('mode');
      if (mode === 'version') return json(res, { version: '4.3.0-demo' });
      if (mode === 'get_config' && q.get('section') === 'servers') return json(res, { config: { servers: [{ name: 'news.example.net', displayname: 'Example Usenet', host: 'news.example.net', port: 563, ssl: 1, username: 'demo', password: '*****', connections: 30, enable: 1, priority: 0 }] } });
      if (mode === 'config' && q.get('name') === 'test_server') return json(res, { value: { result: true, message: 'Connection Successful!' } });
      if (mode === 'queue') return json(res, { queue: { paused: false, status: 'Downloading', kbpersec: '5120', noofslots_total: 1, sizeleft: '2.1 GB', timeleft: '0:07:12', slots: [{ filename: 'Night.Shift.S06E01.1080p', percentage: '48', size: '3.1 GB', timeleft: '0:07:12' }] } });
      if (mode === 'history') {
        if (q.get('name') === 'delete') { st.sabHist = st.sabHist.filter(h => h.nzo_id !== q.get('value')); return json(res, { status: true }); }
        return json(res, { history: { slots: st.sabHist, noofslots: st.sabHist.length } });
      }
      if (mode === 'retry') { st.calls.push('sab retry ' + q.get('value')); st.sabHist = st.sabHist.filter(h => h.nzo_id !== q.get('value')); return json(res, { status: true }); }
      if (mode === 'addurl') { st.calls.push('sab addurl ' + q.get('name')); return json(res, { status: true, nzo_ids: ['SABnzbd_nzo_new'] }); }
      if (mode === 'addfile') { const chunks = []; await new Promise(ok => { req.on('data', c => chunks.push(c)); req.on('end', ok); }); st.calls.push('sab addfile ' + Buffer.concat(chunks).length + ' bytes'); return json(res, { status: true, nzo_ids: ['SABnzbd_nzo_file'] }); }
      return json(res, { status: true });
    }
    if (type === 'tautulli') {
      const cmd = q.get('cmd'), ok = d => json(res, { response: { result: 'success', data: d } }), days = +q.get('time_range') || 30;
      const dates = Array.from({ length: days }, (_, i) => new Date(now - (days - 1 - i) * 864e5).toISOString().slice(0, 10)), wave = (i, a, b) => Math.max(0, Math.round(a + b * Math.sin(i * 0.9) + ((i * 7) % 5)));
      if (cmd === 'pms_image_proxy') { const hue = [...String(q.get('img'))].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 11); res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(decodeURIComponent(svg('Demo', hue).split(',')[1])); }
      if (cmd === 'get_home_stats') {
        const mv = st.movies.slice(0, 10).map((x, i) => ({ title: x.title, year: x.year, total_plays: 14 - i, thumb: '/library/metadata/' + x.id + '/thumb/1' })), tv = st.shows.map((x, i) => ({ title: x.title, total_plays: 31 - i * 4, grandparent_thumb: '/library/metadata/' + (200 + i) + '/thumb/1', thumb: '/library/metadata/' + (300 + i) + '/thumb/1' }));
        return ok([{ stat_id: 'top_movies', rows: mv }, { stat_id: 'top_tv', rows: tv }, { stat_id: 'top_users', rows: [{ user: 'alex', friendly_name: 'Alex', total_plays: 42, total_duration: 150000 }, { user: 'sam', friendly_name: 'Sam', total_plays: 27, total_duration: 91000 }, { user: 'jo', friendly_name: 'Jo', total_plays: 11, total_duration: 36000 }] }]);
      }
      if (cmd === 'get_user_watch_time_stats') return ok(String(q.get('query_days') || '1,7,30,0').split(',').map(d => ({ query_days: +d, total_plays: (+d || 90) * 2, total_time: (+d || 90) * 5400 })));
      if (cmd === 'get_users') return ok([{ user_id: 1, username: 'alex', friendly_name: 'Alex' }, { user_id: 2, username: 'sam', friendly_name: 'Sam' }, { user_id: 3, username: 'jo', friendly_name: 'Jo' }]);
      if (cmd === 'get_history') return ok({ data: st.shows.slice(0, 6).map((x, i) => ({ friendly_name: ['Alex', 'Sam', 'Jo'][i % 3], full_title: x.title + ' - S01E0' + (i + 1), media_type: 'episode', date: Math.round((now - i * 5400e3) / 1000), player: ['Living Room TV', 'Phone', 'Laptop'][i % 3], percent_complete: [100, 62, 100, 18, 95, 100][i], grandparent_title: x.title, duration: 2700, user_id: (i % 3) + 1, grandparent_thumb: '/library/metadata/' + (200 + i) + '/thumb/1' })).filter(x => !q.get('user_id') || String(x.user_id) === q.get('user_id')) });
      if (cmd === 'get_plays_by_date') { const dur = q.get('y_axis') === 'duration', k = dur ? 2700 : 1; return ok({ categories: dates, series: [{ name: 'TV', data: dates.map((_, i) => wave(i, 3, 2) * k) }, { name: 'Movies', data: dates.map((_, i) => wave(i + 3, 1, 1) * k) }] }); }
      if (cmd === 'get_plays_by_hourofday') return ok({ categories: Array.from({ length: 24 }, (_, h) => String(h)), series: [{ name: 'TV', data: Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 23 ? 14 + (h % 3) * 4 : h >= 12 && h < 18 ? 4 + (h % 2) * 2 : h < 2 ? 5 : 1)) }, { name: 'Movies', data: Array.from({ length: 24 }, (_, h) => (h >= 19 ? 6 + (h % 2) * 5 : h < 2 ? 3 : 0)) }] });
      if (cmd === 'get_plays_by_top_10_platforms') return ok({ categories: ['Plex for LG', 'Plex for Android', 'Chrome', 'Plex for iOS', 'Roku'], series: [{ name: 'TV', data: [46, 21, 12, 9, 6] }, { name: 'Movies', data: [18, 12, 5, 4, 1] }] });
      return ok({});
    }
    if (type === 'unraid') {
      const data = m === 'POST' ? await body(req) : {}, t0 = Date.now() / 1000, mem = 41 + Math.round(4 * Math.sin(t0 / 9));
      return json(res, { data: { online: true, info: { os: { hostname: 'tower', uptime: new Date(Date.now() - 41 * 864e5 - 5 * 36e5).toISOString() }, cpu: { manufacturer: 'Intel®', brand: 'Core™ i5-12400', cores: 6, threads: 12, speed: 2.5 } }, metrics: { cpu: { percentTotal: Math.max(3, Math.round(22 + 14 * Math.sin(t0 / 5) + 6 * Math.sin(t0 / 1.7))), cpus: Array.from({ length: 12 }, (_, i) => ({ percentIdle: 100 - Math.max(1, Math.round(22 + 18 * Math.sin(t0 / 3 + i) + 5 * Math.sin(t0 * 1.3 + i * 2)))})) }, memory: { percentTotal: mem, total: 34359738368, used: Math.round(34359738368 * mem / 100), free: 3e9, available: Math.round(34359738368 * (100 - mem) / 100), swapTotal: 0, swapUsed: 0 } },
        array: { state: 'STARTED', capacity: { kilobytes: { used: '41200000000', total: '64000000000' } }, parityCheckStatus: { status: 'NEVER_RUN', progress: 0, errors: 0, running: false },
          parities: [{ name: 'parity', temp: 31, status: 'DISK_OK' }], disks: [1, 2, 3].map(n => ({ name: 'disk' + n, temp: 30 + n * 2, status: 'DISK_OK' })), caches: [{ name: 'cache', temp: 36, status: 'DISK_OK' }] },
        docker: { logs: { lines: ['Starting up', 'Loading configuration', 'Listening on port 32400', 'Library scan finished: 0 changes'].map((message, i) => ({ timestamp: new Date(Date.now() - (4 - i) * 60000).toISOString(), message })) }, containers: [['plex', 'RUNNING'], ['sonarr', 'RUNNING'], ['radarr', 'RUNNING'], ['qbittorrent', 'RUNNING'], ['tautulli', 'EXITED']].map(([n, s], i) => ({ id: 'c' + i, names: ['/' + n], state: s, isUpdateAvailable: n === 'radarr', image: 'demo/' + n + ':latest', status: s === 'RUNNING' ? 'Up ' + (i + 2) + ' days' : 'Exited (0) 3 hours ago', labels: { 'net.unraid.docker.icon': n === 'plex' ? 'https://example.com/plex.png' : n === 'sonarr' ? 'http://insecure.example/sonarr.png' : n === 'radarr' ? 'https://example.com/r.png?apikey=SECRET9' : '' } })) },
        shares: [{ name: 'media', free: 9e9, used: 36e9, size: 0 }, { name: 'appdata', free: 4e8, used: 1e8, size: 0 }, { name: 'isos', free: 0, used: 2e8, size: 0 }] } });
    }
    if (type === 'jackett' && sub === '/UI/Dashboard' && m === 'POST') {   // the sign-in page: the right password gives a cookie
      const form = await new Promise(ok => { let t = ''; req.on('data', c => { t += c; }); req.on('end', () => ok(t)); });
      if (new URLSearchParams(form).get('password') === st.jackettAdminPass) { res.writeHead(302, { 'Set-Cookie': 'Jackett=session-ok; path=/', Location: '/UI/Dashboard' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>Wrong password</html>');
    }
    if (type === 'jackett' && /\/results\/torznab\/api$/.test(sub)) {   // the torznab door: list of indexers, and searches
      if (!q.get('apikey') || q.get('apikey') === 'wrong') { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized'); }
      const who = sub.match(/\/indexers\/([\w.-]+)\/results/)[1];
      if (q.get('t') === 'indexers') { const want = q.get('configured') === 'true'; res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end('<?xml version="1.0"?><indexers>' + jk.list.filter(x => x.configured === want).map(x => `<indexer id="${x.id}" configured="${x.configured}"><title>${x.name}</title><description>${x.description} &amp; more</description><link>${x.site_link}</link><language>${x.language}</language><type>${x.type}</type><caps/></indexer>`).join('') + '</indexers>'); }
      if (q.get('t') === 'search') { res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(who === 'broken-tracker' ? '<error code="900" description="Unable to connect to the tracker: timeout"/>' : '<rss version="2.0"><channel><title>' + who + '</title></channel></rss>'); }
    }
    if (type === 'jackett') { if (sub.startsWith('/api/v2.0/indexers') && !sub.includes('/results/')) { const done = await jackettApp(req, res, sub, q, m); if (done !== null) return done; } res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<caps><server title="demo"/></caps>'); }
    json(res, {});
  }
  const fanarts = () => [...st.shows.map(x => fan(x.title, x.hue, x.id)), ...st.movies.map(x => fan(x.title, x.hue, x.id + 1))];
  return { handle, state: st, fanarts };
}
module.exports = { create };
