// The Unraid template keeps up with the app: every setting the README lists, and every app that can run, is in it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..', '..');

test('the Unraid template has every setting and every app', () => {
  const tpl = fs.readFileSync(path.join(root, 'unraid', 'goatmediastackarr.xml'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const inTpl = new Set([...tpl.matchAll(/Target="([A-Z_0-9]+)"/g)].map(m => m[1]));
  const documented = [...readme.matchAll(/^\| `([A-Z][A-Z_0-9]+)` \|/gm)].map(m => m[1]);
  assert.ok(documented.length > 10);
  assert.deepEqual(documented.filter(v => !inTpl.has(v)), [], 'settings in the README but not in the template');
  const { ENGINES } = require(path.join(root, 'goat', 'engines.js'));
  const apps = (tpl.match(/<Config Name="Apps to run"[^>]*Description="([^"]*)"/) || [])[1] || '', over = (tpl.match(/<Overview>([\s\S]*?)<\/Overview>/) || [])[1] || '';
  const missing = Object.entries(ENGINES).filter(([k, e]) => !new RegExp(e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(over)).map(([k]) => k);
  assert.deepEqual(missing, [], 'apps the overview does not name');
  const def = (tpl.match(/<Config Name="Apps to run"[^>]*Default="([^"]*)"/) || [])[1].split(',');
  const extra = Object.keys(ENGINES).filter(k => !def.includes(k) && k !== 'filebrowser' && !new RegExp('\\b' + k + '\\b', 'i').test(apps));
  assert.deepEqual(extra, [], 'optional apps that "Apps to run" does not mention');
});
