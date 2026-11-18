// Lists you follow: what is new on an IMDb or Letterboxd list is requested, at most so many a week.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');
const fakes = require('../lib/demo');

test('a followed list asks for what is new on it, a few a week', async () => {
  const fake = fakes.create();
  let imdb = ['tt0000001', 'tt0000002'];
  const lb = { 'first-film': 501, 'second-film': 502, 'third-film': 503 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/www.imdb.com/list/ls123/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<title>Best of 2026 - IMDb</title>${imdb.map(t => `<a href="/title/${t}/">x</a>`).join('')}`); }
    if (u.pathname === '/letterboxd.com/ann/list/picks/') { res.writeHead(200); return res.end(`<meta property="og:title" content="Ann's picks">${Object.keys(lb).map(k => `<div data-film-slug="${k}"></div>`).join('')}`); }
    if (u.pathname.startsWith('/letterboxd.com/ann/list/picks/page/')) { res.writeHead(200); return res.end(''); }
    const fm = u.pathname.match(/^\/letterboxd\.com\/film\/([\w-]+)\/$/);
    if (fm) { res.writeHead(200); return res.end(`<body data-tmdb-type="movie" data-tmdb-id="${lb[fm[1]]}">`); }
    // Radarr finds the IMDb numbers: tt…1 is TMDB 101, tt…2 is 102, tt…3 is 103.
    if (u.pathname === '/radarr/api/v3/movie/lookup/imdb') { const n = +u.searchParams.get('imdbId').slice(2); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ tmdbId: 100 + n })); }
    fake.handle(req, res, req.url);
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = await boot({ FOLLOW_TEST_BASE: base }), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'radarr', name: 'Radarr', url: base + '/radarr', apiKey: 'k' });
    await a.post('/api/services', { type: 'seerr', name: 'Seerr', url: base + '/seerr', apiKey: 'k' });
    assert.equal((await a.post('/api/follows', { url: 'https://example.com/list' })).status, 400);

    // IMDb, from now on: what is on it today is left alone; what is added later is asked for.
    let r = await a.post('/api/follows', { url: 'https://www.imdb.com/list/ls123/', perWeek: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.name, 'Best of 2026'); assert.equal(r.data.count, 2);
    const id = r.data.id;
    assert.equal((await a.get('/api/requests')).data.filter(x => x.via === 'list').length, 0, 'nothing from before');
    imdb = ['tt0000003', ...imdb];
    await a.post(`/api/follows/${id}/sync`);
    let rq = (await a.get('/api/requests')).data.filter(x => x.via === 'list');
    assert.deepEqual(rq.map(x => x.mediaId), [103]); assert.equal(rq[0].status, 'approved', 'an admin\'s requests are approved');
    assert.ok(fake.state.calls.some(c => c.startsWith('seerr request') && c.includes('"mediaId":103')));

    // Letterboxd, everything on it, two a week: two now, the third waits for next week.
    r = await a.post('/api/follows', { url: 'https://letterboxd.com/ann/list/picks/', perWeek: 2, fromNow: false });
    assert.equal(r.data.name, "Ann's picks");
    rq = (await a.get('/api/requests')).data.filter(x => x.via === 'list').map(x => x.mediaId).sort();
    assert.deepEqual(rq, [103, 501, 502]);
    const l = (await a.get('/api/follows')).data.follows.find(f => f.kind === 'letterboxd');
    assert.equal(l.week, 2); assert.equal(l.count, 3);
    assert.equal((await a.del('/api/follows/' + l.id)).status, 200);
    assert.equal((await a.get('/api/follows')).data.follows.length, 1);
  } finally { await s.stop(); srv.close(); }
});
