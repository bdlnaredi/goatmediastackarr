// The FAQ page (Settings → FAQ, and the app) reads docs/FAQ.md: every question with its answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, read } = require('../lib/faq');

test('questions, answers, lists and links are read from the FAQ', () => {
  const s = parse(`# FAQ\nIntro.\n\n## First part\n\n**A question?**\nIts answer,\ngoing on.\n- one\n- two\n   - under two\n\n**Steps:**\n1. **Do** this with \`code\`.\n2. See [the README](../README.md#install) and [VPN](#the-vpn).\n\n---\n\n## Empty part\n`);
  assert.equal(s.length, 1, 'a section without questions is left out');
  assert.equal(s[0].id, 'first-part');
  const [a, b] = s[0].items;
  assert.equal(a.q, 'A question?');
  assert.deepEqual(a.blocks, [{ t: 'p', text: 'Its answer, going on.' }, { t: 'ul', items: [{ text: 'one' }, { text: 'two', sub: ['under two'] }] }]);
  assert.equal(b.blocks[0].t, 'ol');
  assert.match(b.blocks[0].items[1].text, /\(https:\/\/github\.com\/bdlnaredi\/goatmediastackarr\/blob\/main\/README\.md#install\)/, 'repository links go to GitHub');
  assert.match(b.blocks[0].items[1].text, /\(#the-vpn\)/, 'links to a section stay');
});

test('the real FAQ has its sections, and Plex from outside is in it', () => {
  const s = read();
  assert.ok(s.length >= 10 && s.reduce((n, x) => n + x.items.length, 0) >= 60);
  const plex = s.find(x => x.id === 'plex-and-tautulli-from-outside-your-home');
  assert.ok(plex && plex.items.some(i => /steps/i.test(i.q)));
  for (const x of s) for (const i of x.items) assert.ok(i.blocks.length, `"${i.q}" has an answer`);
});
