// "What's new": the changelog read into versions, and served to the web page and the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { parse } = require('../lib/changelog');
const { boot, client, setup } = require('./helpers');

const TEXT = `# Changelog

Intro text.

## Unreleased

- New thing, *nice*.
- Another one
  that goes on.

## v0.7.0 — 2026-10-24

- Passwords can be changed.

## v0.6.6 — 2026-10-23 (a note)

- A fix.
`;

test('versions, dates, items and which one is running', () => {
  // A release built before its part got a number: Unreleased is the running version.
  let v = parse(TEXT, '0.7.1');
  assert.deepEqual(v.map(x => [x.version, x.date, !!x.current, !!x.next]), [['0.7.1', '', true, false], ['0.7.0', '2026-10-24', false, false], ['0.6.6', '2026-10-23', false, false]]);
  assert.deepEqual(v[0].items, ['New thing, *nice*.', 'Another one that goes on.']);
  // The running version has its own part: Unreleased is what comes next.
  v = parse(TEXT, '0.7.0');
  assert.equal(v[0].next, true); assert.equal(v[1].current, true);
  // A weekly build (0.7.0-weekly.20261025) is not a version number of its own.
  assert.equal(parse(TEXT, '0.7.0-weekly.20261025')[0].next, true);
  // Nothing new yet: no empty part.
  assert.deepEqual(parse(TEXT.replace(/- New thing[\s\S]*?that goes on\.\n/, ''), '0.7.0').map(x => x.version), ['0.7.0', '0.6.6']);
});

test('the changelog is served to anyone, signed in or not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goat-cl-')), f = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(f, TEXT);
  const s = await boot({ GOAT_CHANGELOG: f, GOAT_VERSION: '0.7.1' });
  try {
    const r = await client(s.base).get('/api/changelog');
    assert.equal(r.status, 200); assert.equal(r.data.current, '0.7.1');
    assert.deepEqual(r.data.versions.map(x => x.version), ['0.7.1', '0.7.0', '0.6.6']);
    // The repository's own changelog reads cleanly too: every part has a version and items.
    const own = parse(fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8'), '');
    assert.ok(own.length >= 20); for (const x of own) { assert.ok(x.version || x.next); assert.ok(x.items.length); }
  } finally { await s.stop(); }
});
