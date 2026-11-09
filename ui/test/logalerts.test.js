// Alerts from the logs: an app that writes errors again and again is reported once, then not for 6 hours.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, tmp, sleep } = require('./helpers');

test('an app writing errors again and again is reported once', async () => {
  const dir = tmp(), iso = m => new Date(Date.now() - m * 60000).toISOString();
  fs.mkdirSync(path.join(dir, 'sonarr')); fs.mkdirSync(path.join(dir, 'radarr'));
  fs.writeFileSync(path.join(dir, 'sonarr', 'current'), [1, 2, 3, 4, 5, 6].map(m => `${iso(m)} [Error] Database is locked (${m})`).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'radarr', 'current'), `${iso(1)} [Error] Just once\n${iso(40)} [Error] Old\n${iso(41)} [Error] Old\n${iso(42)} [Error] Old\n${iso(43)} [Error] Old\n`);
  const s = await boot({ GOAT_LOGS: dir, MONITOR_MS: '200', LOGALERT_EVERY: '2' }), a = client(s.base); await setup(a);
  try {
    let items = [];
    for (let i = 0; i < 60 && !items.length; i++) { await sleep(150); items = (await a.get('/api/notifications')).data.items.filter(x => /keeps writing errors/.test(x.title)); }
    assert.equal(items.length, 1, 'Sonarr, and not Radarr (its old errors are outside the 15 minutes)');
    assert.equal(items[0].title, 'Sonarr keeps writing errors'); assert.match(items[0].body, /6 in 15 minutes.*Database is locked \(1\)/);
    await sleep(1200);
    assert.equal((await a.get('/api/notifications')).data.items.filter(x => /keeps writing errors/.test(x.title)).length, 1, 'not again for a while');
    // The limits can be changed, and 0 turns it off.
    await a.put('/api/alerts', { logCount: 0, logMins: 30, fillDays: 7 });
    const al = (await a.get('/api/alerts')).data; assert.equal(al.logCount, 0); assert.equal(al.logMins, 30); assert.equal(al.fillDays, 7);
  } finally { await s.stop(); }
});
