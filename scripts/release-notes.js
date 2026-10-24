#!/usr/bin/env node
// Release notes from CHANGELOG.md, used when a version is tagged (.github/workflows/release.yml).
//   node scripts/release-notes.js v0.7.1 notes.md          writes that version's notes
//   node scripts/release-notes.js v0.7.1 notes.md --roll   also names the "Unreleased" part after the version, dated
//                                                         today, and starts a new empty "Unreleased" above it
const fs = require('fs'), path = require('path');
const [tag, out, ...flags] = process.argv.slice(2);
if (!/^v?\d+\.\d+\.\d+/.test(tag || '') || !out) { console.error('usage: release-notes.js vX.Y.Z notes.md [--roll]'); process.exit(2); }
const v = tag.replace(/^v/i, ''), file = process.env.CHANGELOG || path.join(__dirname, '..', 'CHANGELOG.md');
let text = fs.readFileSync(file, 'utf8');

// The part under a "## ..." heading, up to the next one.
const part = re => { const m = text.match(re); if (!m) return null; const from = m.index + m[0].length, next = text.slice(from).search(/^## /m); return { at: m.index, head: m[0], body: text.slice(from, next < 0 ? undefined : from + next) }; };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mine = part(new RegExp(`^## v?${esc(v)}\\b.*$`, 'm')), un = part(/^## Unreleased\s*$/m);
const body = (mine || un || { body: '' }).body.trim();
fs.writeFileSync(out, (body || '- Small fixes and updates.') + '\n');
console.log(`notes for v${v}: ${body.split('\n').filter(l => l.startsWith('- ')).length} items (${mine ? 'its own part' : 'from Unreleased'})`);

if (flags.includes('--roll') && !mine && un) {
  const day = new Date().toISOString().slice(0, 10);
  text = text.slice(0, un.at) + `## Unreleased\n\n## v${v} — ${day}\n` + text.slice(un.at + un.head.length);
  fs.writeFileSync(file, text);
  console.log(`CHANGELOG.md: "Unreleased" is now v${v} (${day})`);
}
