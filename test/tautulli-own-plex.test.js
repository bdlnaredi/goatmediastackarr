// Tautulli with a Plex server outside the container: filled in before Tautulli starts, a hand-made setup kept.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

test('Tautulli is pointed at your own Plex, but a Tautulli you set up yourself is left alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-taut-'));
  Object.assign(process.env, { GOAT_CONFIG_DIR: path.join(root, 'config'), MEDIA_DIR: path.join(root, 'media'), DOWNLOADS_DIR: path.join(root, 'downloads') });
  const plex = http.createServer((req, res) => {
    if (req.url === '/identity' && req.headers['x-plex-token'] === 'owntok') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ MediaContainer: { machineIdentifier: 'own-mid' } })); }
    res.statusCode = 401; res.end();
  });
  await new Promise(r => plex.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${plex.address().port}`;
  const env = { ...process.env, GOAT_ENGINES: 'sonarr,tautulli', PLEX_URL: url + '/', PLEX_TOKEN: 'owntok', PUID: String(process.getuid()), PGID: String(process.getgid()) };
  const init = require('../goat/init');
  const tf = path.join(root, 'config/tautulli/config.ini'), ini = () => fs.readFileSync(tf, 'utf8');
  try {
    init.run(env);
    const p = await init.tautulliStart(env);
    assert.equal(p.id, 'own-mid');
    assert.equal(init.iniGet(ini(), 'PMS', 'pms_url'), url); assert.equal(init.iniGet(ini(), 'PMS', 'pms_token'), 'owntok');
    assert.equal(init.iniGet(ini(), 'PMS', 'pms_identifier'), 'own-mid'); assert.equal(init.iniGet(ini(), 'General', 'first_run_complete'), '1');

    // Set up by hand for another server: not touched.
    fs.writeFileSync(tf, ini().replace(`pms_url = ${url}`, 'pms_url = http://10.0.0.9:32400').replace('pms_token = owntok', 'pms_token = theirs'));
    assert.equal(await init.tautulliStart(env), null);
    assert.equal(init.iniGet(ini(), 'PMS', 'pms_token'), 'theirs');

    // Plex not answering: Tautulli still starts, without it.
    fs.writeFileSync(tf, ''); plex.close();
    assert.equal(await init.tautulliStart(env), null);
    assert.equal(init.iniGet(ini(), 'PMS', 'pms_token'), '');
  } finally { plex.closeAllConnections(); plex.close(); }
});
