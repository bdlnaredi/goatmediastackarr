// Health → Needs attention names the trackers cross-seed has paused, why, and until when.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { tmp, boot, client, setup } = require('./helpers');

test('trackers paused in cross-seed show under Needs attention', async () => {
  const dir = tmp(), cfg = path.join(dir, 'cfg'), dbf = path.join(cfg, 'cross-seed', 'cross-seed.db');
  fs.mkdirSync(path.dirname(dbf), { recursive: true }); fs.writeFileSync(path.join(cfg, 'cross-seed', 'goat-api-key'), 'k');
  const { DatabaseSync } = require('node:sqlite'), d = new DatabaseSync(dbf), soon = Date.now() + 3600e3;
  d.exec('CREATE TABLE indexer (id INTEGER PRIMARY KEY, name TEXT, url TEXT, apikey TEXT, active BOOLEAN, status TEXT, retry_after INTEGER, search_cap BOOLEAN)');
  const ins = d.prepare('INSERT INTO indexer (name, url, active, status, retry_after) VALUES (?, ?, ?, ?, ?)');
  ins.run('TorrentLeech', 'http://127.0.0.1:9696/3/api', 1, 'RATE_LIMITED', soon);
  ins.run(null, 'http://127.0.0.1:9696/7/api', 1, 'UNKNOWN_ERROR', soon);
  ins.run('Old pause', 'http://127.0.0.1:9696/8/api', 1, 'RATE_LIMITED', Date.now() - 1000);
  ins.run('Fine', 'http://127.0.0.1:9696/9/api', 1, 'OK', soon);
  ins.run('Off', 'http://127.0.0.1:9696/10/api', 0, 'RATE_LIMITED', soon);
  d.close();
  const mf = path.join(dir, 'managed.json'); fs.writeFileSync(mf, JSON.stringify({ version: 1, services: [], extras: [] }));
  const s = await boot({ GOAT_MANAGED: mf, GOAT_CONFIG_DIR: cfg, CROSSSEED_DB: dbf }, dir), a = client(s.base); await setup(a);
  try {
    const w = (await a.get('/api/warnings')).data.filter(x => x.app === 'cross-seed');
    assert.equal(w.length, 2, JSON.stringify(w));
    assert.match(w[0].text, /TorrentLeech is paused until .*too many requests/);
    assert.match(w[1].text, /A tracker is paused .*answered a search with an error/);
    assert.equal(w[0].fix, 'restart'); assert.equal(w[0].sid, 'cross-seed');
  } finally { await s.stop(); }
});
