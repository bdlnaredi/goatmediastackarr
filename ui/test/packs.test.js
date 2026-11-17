// Season packs: a season that has finished airing and misses several episodes is searched as a whole season.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { boot, client, setup } = require('./helpers');

const season = (n, aired, have, total, extra = {}) => ({ seasonNumber: n, monitored: true, statistics: { episodeCount: aired, episodeFileCount: have, totalEpisodeCount: total, ...extra } });

test('season packs are searched for finished seasons that miss episodes', async () => {
  const cmds = [], srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      const j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/api/v3/series')) return j([
        { id: 1, title: 'Whole Missing', monitored: true, seasons: [season(0, 2, 0, 2), season(1, 10, 0, 10), season(2, 8, 7, 8)] },
        { id: 2, title: 'Still Airing', monitored: true, seasons: [season(1, 4, 0, 10, { nextAiring: '2026-12-01T00:00:00Z' })] },
        { id: 3, title: 'Not Watched', monitored: false, seasons: [season(1, 10, 0, 10)] },
      ]);
      if (req.url === '/api/v3/command' && req.method === 'POST') { cmds.push(JSON.parse(b)); return j({ id: 1 }); }
      j({ version: '4.0.0' });
    });
  }).listen(0);
  await new Promise(r => srv.once('listening', r));
  const s = await boot(), a = client(s.base); await setup(a);
  try {
    await a.post('/api/services', { type: 'sonarr', name: 'Sonarr', url: `http://127.0.0.1:${srv.address().port}`, apiKey: 'k' });
    let d = (await a.get('/api/packs')).data;
    assert.equal(d.on, false); assert.equal(d.min, 3);
    // Only season 1 of the first show: specials, a nearly-complete season, an airing one and an unwatched show are left alone.
    assert.deepEqual(d.now.map(x => `${x.title} ${x.season} ${x.missing}/${x.of}`), ['Whole Missing 1 10/10']);
    await a.put('/api/packs', { on: true, min: 3 });
    const t = Date.now(); while (!cmds.length && Date.now() - t < 5000) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(cmds, [{ name: 'SeasonSearch', seriesId: 1, seasonNumber: 1 }]);
    d = (await a.get('/api/packs')).data;
    assert.equal(d.log[0].title, 'Whole Missing season 1');
    // Turned on again: not searched again within a week.
    await a.put('/api/packs', { on: true }); await new Promise(r => setTimeout(r, 500));
    assert.equal(cmds.length, 1);
  } finally { await s.stop(); srv.close(); }
});
