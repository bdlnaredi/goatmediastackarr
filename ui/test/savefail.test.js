// When the settings cannot be written (a full disk), the dashboard keeps running and says so on the Health page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { boot, client, setup, tmp } = require('./helpers');

test('a save that cannot be written does not stop the dashboard', async () => {
  const dir = tmp();
  let s = await boot({}, dir), a = client(s.base); await setup(a); await s.stop();
  // The next save is made impossible: where it writes first is taken by a folder.
  const file = fs.readdirSync(dir).find(f => /\.json$/.test(f) && fs.readFileSync(path.join(dir, f), 'utf8').includes('"users"'));
  fs.mkdirSync(path.join(dir, file + '.tmp'));
  s = await boot({}, dir); a = client(s.base);
  try {
    assert.equal(s.child.exitCode, null, 'still running: ' + s.log());
    assert.equal((await a.post('/api/login', { name: 'admin', password: 'correct-horse' })).status, 200);
    const w = (await a.get('/api/warnings')).data;
    const list = Array.isArray(w) ? w : w.items || w.warnings || [];
    assert.ok(list.some(x => /could not be saved|is full/.test(x.text)), JSON.stringify(w).slice(0, 400));
    assert.match(s.log(), /Could not save the settings/);
  } finally { await s.stop(); }
});
