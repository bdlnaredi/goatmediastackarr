// Reads docs/FAQ.md into questions and answers for the FAQ page (web page and app): the same file as on GitHub.
// "## Title" starts a section, a line that is all bold ("**Question?**") starts a question, and what follows is its
// answer: paragraphs, "- " lists and "1. " lists (indented ones belong to the item above). Inline markdown (bold,
// italic, `code`, links) is kept for the page and the app to draw; links into the repository become GitHub links.
const fs = require('fs'), path = require('path');
const REPO = 'https://github.com/bdlnaredi/goatmediastackarr/blob/main/';

const slug = t => String(t).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
// Links relative to docs/ (../README.md, ../unraid/…) point at GitHub; #anchors stay (the page opens that section).
const links = s => s.replace(/\]\((?!https?:|#|mailto:)([^)]+)\)/g, (_, u) => `](${REPO}${path.posix.normalize('docs/' + u)})`);

function parse(text) {
  const sections = [];
  let sec = null, item = null, para = null, list = null;
  const end = () => { para = null; list = null; };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const h = line.match(/^##\s+(.+)$/);
    if (h) { sec = { id: slug(h[1]), title: h[1].trim(), items: [] }; sections.push(sec); item = null; end(); continue; }
    if (!sec) continue;
    const q = line.match(/^\*\*(.+)\*\*$/);
    if (q && !/\*\*/.test(q[1])) { item = { q: q[1].trim(), blocks: [] }; sec.items.push(item); end(); continue; }
    if (!item) continue;
    if (!line.trim() || /^-{3,}$/.test(line.trim())) { end(); continue; }
    const li = line.match(/^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/);
    if (li) {
      const sub = li[1].length >= 2, kind = li[2] ? 'ol' : 'ul', t = links(li[3]);
      if (sub && list && list.items.length) { const last = list.items[list.items.length - 1]; (last.sub = last.sub || []).push(t); }
      else { if (!list || list.t !== kind) { list = { t: kind, items: [] }; item.blocks.push(list); } list.items.push({ text: t }); }
      para = null; continue;
    }
    // A line carrying on the list item above it, or a paragraph.
    if (list && /^\s{2,}\S/.test(raw)) { const last = list.items[list.items.length - 1]; if (last.sub && last.sub.length) last.sub[last.sub.length - 1] += ' ' + links(line.trim()); else last.text += ' ' + links(line.trim()); continue; }
    list = null;
    if (para) para.text += ' ' + links(line.trim()); else { para = { t: 'p', text: links(line.trim()) }; item.blocks.push(para); }
  }
  return sections.filter(s => s.items.length);
}

function file() {
  for (const f of [process.env.GOAT_FAQ, path.join(__dirname, '..', '..', 'docs', 'FAQ.md'), path.join(__dirname, '..', '..', 'FAQ.md')]) {
    try { if (f && fs.statSync(f).isFile()) return f; } catch {}
  }
  return '';
}
let cache = { f: '', t: 0, v: [] };
function read() {
  const f = file(); if (!f) return [];
  const t = fs.statSync(f).mtimeMs;
  if (cache.f !== f || cache.t !== t) cache = { f, t, v: parse(fs.readFileSync(f, 'utf8')) };
  return cache.v;
}

module.exports = { parse, read };
