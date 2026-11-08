// Trakt (watchlist both ways, device sign-in) and Letterboxd (public watchlist in), with pretend sites.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup, sleep } = require('./helpers');

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const jbody = req => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

test('Trakt watchlist both ways, and Letterboxd watchlist in', async () => {
  const tr = { polls: 0, wl: { movies: [{ movie: { title: 'From Trakt', year: 2020, ids: { tmdb: 111 } } }], shows: [{ show: { title: 'Trakt Show', year: 2019, ids: { tmdb: 222 } } }] }, added: [], removed: [] };
  const trakt = http.createServer(async (req, res) => {
    const u = req.url, j = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const b = req.method === 'POST' ? await jbody(req) : {};
    if (u === '/oauth/device/code') return j({ device_code: 'dev1', user_code: 'ABCD1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 });
    if (u === '/oauth/device/token') { if (++tr.polls < 2) { res.writeHead(400); return res.end(); } return j({ access_token: 'at', refresh_token: 'rt', expires_in: 7776000 }); }
    if (req.headers.authorization !== 'Bearer at' || req.headers['trakt-api-key'] !== 'cid12345') { res.writeHead(401); return res.end(); }
    if (u === '/users/settings') return j({ user: { username: 'traktie' } });
    if (u === '/sync/watchlist/movies') return j(tr.wl.movies);
    if (u === '/sync/watchlist/shows') return j(tr.wl.shows);
    if (u === '/sync/watchlist') { tr.added.push(b); return j({}); }
    if (u === '/sync/watchlist/remove') { tr.removed.push(b); return j({}); }
    if (u === '/sync/history') return j({});
    res.writeHead(404); res.end();
  });
  const lbx = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/cinephile/watchlist/page/1/') return res.end('<li><div data-film-slug="the-film"></div></li><li><div data-target-link="/film/other-one/"></div></li>');
    if (req.url === '/film/the-film/') return res.end('<meta property="og:title" content="The Film (2021)"><body data-tmdb-id="333" data-tmdb-type="movie">');
    if (req.url === '/film/other-one/') return res.end('<meta property="og:title" content="Other One (1999)"><body data-tmdb-id="444" data-tmdb-type="movie">');
    res.writeHead(404); res.end();
  });
  const tp = await listen(trakt), lp = await listen(lbx);
  const s = await boot({ TRAKT_URL: `http://127.0.0.1:${tp}`, LETTERBOXD_URL: `http://127.0.0.1:${lp}`, SYNC_EVERY: '100000' }), a = client(s.base); await setup(a);
  try {
    assert.equal((await a.get('/api/me/sync')).data.trakt.can, false);
    assert.equal((await a.put('/api/listsettings', { trakt: 'cid12345' })).status, 200);
    assert.equal((await a.put('/api/listsettings', { traktSecret: 'secret123' })).status, 200);
    assert.equal((await a.get('/api/listsettings')).data.traktSecret, true);
    assert.equal((await a.get('/api/me/sync')).data.trakt.can, true);
    await a.post('/api/watchlist', { type: 'movie', id: 555, title: 'Mine', year: '2022' });
    const st = (await a.post('/api/me/sync/trakt/start', {})).data; assert.equal(st.code, 'ABCD1234');
    assert.equal((await a.post('/api/me/sync/trakt/poll', {})).data.state, 'waiting');
    const ok = (await a.post('/api/me/sync/trakt/poll', {})).data; assert.equal(ok.state, 'ok'); assert.equal(ok.name, 'traktie');
    let wl = []; for (let i = 0; i < 50 && wl.length < 3; i++) { await sleep(100); wl = (await a.get('/api/watchlist')).data.items; }
    assert.deepEqual(wl.map(x => x.id).sort(), [111, 222, 555], 'joined: both lists, nothing removed');
    assert.deepEqual(tr.added[0].movies.map(x => x.ids.tmdb), [555], 'mine went to Trakt');
    // Removed on Trakt -> removed here; removed here -> removed on Trakt.
    tr.wl.shows = []; tr.wl.movies.push({ movie: { title: 'Mine', ids: { tmdb: 555 } } });
    await a.del('/api/watchlist/movie/111');
    assert.equal((await a.post('/api/me/sync/now', {})).status, 200);
    wl = (await a.get('/api/watchlist')).data.items;
    assert.deepEqual(wl.map(x => x.id).sort(), [555]);
    assert.deepEqual(tr.removed.pop().movies.map(x => x.ids.tmdb), [111]);
    const sy = (await a.get('/api/me/sync')).data; assert.equal(sy.trakt.connected, true); assert.equal(sy.trakt.error, '');
    // Letterboxd
    assert.equal((await a.put('/api/me/sync', { letterboxd: 'https://letterboxd.com/cinephile/' })).status, 200);
    for (let i = 0; i < 50; i++) { await sleep(100); wl = (await a.get('/api/watchlist')).data.items; if (wl.some(x => x.id === 444)) break; }
    assert.ok(wl.some(x => x.id === 333 && x.title === 'The Film' && x.year === '2021') && wl.some(x => x.id === 444), JSON.stringify(wl.map(x => [x.id, x.title])));
    assert.equal((await a.get('/api/me/sync')).data.letterboxd.user, 'cinephile');
    assert.equal((await a.del('/api/me/sync/trakt')).status, 200); assert.equal((await a.get('/api/me/sync')).data.trakt.connected, false);
  } finally { await s.stop(); trakt.close(); lbx.close(); }
});
