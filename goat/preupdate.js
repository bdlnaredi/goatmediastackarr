'use strict';
// Before an update: at every start (as root, before the apps run), each app whose version changed since the last
// start gets a backup of its own settings first ("Before an update" under Stack → Backups), so a new version that
// spoils something can be undone with Put back. The newest 3 such backups are kept.
const fs = require('fs');
const path = require('path');
const SB = require('./stackbackup');
const E = require('./engines');

const VERSIONS = process.env.GOAT_VERSIONS || '/opt/goat/versions.json';
const LAST = () => path.join(E.CONFIG, 'goat', 'app-versions-last.json');
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** The apps that changed: [{ app, from, to }], only those with settings to back up. */
function changed(now, last) {
  if (!last) return [];
  return Object.entries(now).filter(([k, v]) => SB.PARTS[k] && last[k] && last[k] !== v && fs.existsSync(path.join(E.CONFIG, SB.PARTS[k].dir)))
    .map(([k, v]) => ({ app: k, from: last[k], to: v }));
}

async function main() {
  const now = (read(VERSIONS) || {}).apps || {};
  if (!Object.keys(now).length) return;
  const ch = changed(now, read(LAST()));
  if (ch.length) {
    const note = ch.map(x => `${SB.PARTS[x.app].name} ${x.from} → ${x.to}`).join(', ');
    try {
      const r = await SB.backup({ kind: 'before-update', keep: 3, only: ch.map(x => x.app), note });
      console.log(`[goat] Before the update: settings of ${note} backed up (${r.name}).`);
    } catch (e) { console.log(`[goat] Before the update: no backup (${e.message}). The apps start anyway.`); }
  }
  fs.mkdirSync(path.dirname(LAST()), { recursive: true });
  fs.writeFileSync(LAST(), JSON.stringify(now));
}

if (require.main === module) main().catch(e => console.log('[goat] Before the update:', e.message)).finally(() => process.exit(0));
module.exports = { changed, main };
