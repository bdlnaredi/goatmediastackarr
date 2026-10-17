// Keeps the translation files honest: same texts in every language, nothing empty, nothing left over from old versions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const dir = path.join(__dirname, '..', 'public', 'lang');
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const files = fs.readdirSync(dir).filter(f => /^[a-z]{2}\.json$/.test(f));
const langs = Object.fromEntries(files.map(f => [f.slice(0, 2), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));

test('every language has the same texts, none empty', () => {
  assert.ok(files.length >= 4, 'at least four languages');
  const base = Object.keys(langs[Object.keys(langs)[0]]).sort();
  for (const [code, d] of Object.entries(langs)) {
    assert.deepEqual(Object.keys(d).sort(), base, `${code} has a different set of texts`);
    for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'string' && v.trim(), `${code}: "${k}" is empty`);
  }
});

test('every translated text still exists in the page, and every language is offered in the menu', () => {
  const keys = Object.keys(langs.es);
  const gone = keys.filter(k => !page.includes(k));
  assert.deepEqual(gone, [], 'these texts are no longer in the page, remove them from the language files');
  for (const code of Object.keys(langs)) assert.match(page, new RegExp(`\\b${code}:'[^']+'`), `${code} is not in the language menu`);
});
