'use strict';
// The recycle bin: files the dashboard deletes are moved aside for a few days instead of being gone at once.
// A move inside one disk is a rename, so even a 60 GB film goes in and comes back out in an instant. Each disk
// keeps its own bin (a hidden .goat-recycle folder at the top of that disk), because moving between disks
// would mean copying everything. When a file cannot be moved that way, the caller deletes it as before.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DIR = '.goat-recycle';

// The top folder of the disk the file is on: walk up while the folders are still on the same device (and can be
// written to). Under Docker each mounted folder (/media, /downloads…) is its own mount, so that is where it stops.
function diskTop(p) {
  const abs = path.resolve(p), dev = fs.lstatSync(abs).dev;
  let dir = path.dirname(abs);
  for (;;) {
    const up = path.dirname(dir);
    if (up === dir) break;
    let st; try { st = fs.statSync(up); } catch { break; }
    if (st.dev !== dev) break;
    try { fs.accessSync(up, fs.constants.W_OK); } catch { break; }
    dir = up;
  }
  return dir;
}

function sizeOf(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let n = 0; for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e));
  return n;
}

// Leaves no empty folders behind once the files have been moved out (stops at the folder the files belonged to).
function pruneUp(dir, stop) {
  while (dir && dir !== stop && dir.startsWith(stop + path.sep)) {
    try { fs.rmdirSync(dir); } catch { return; }
    dir = path.dirname(dir);
  }
}

/** Moves [paths] (files or folders) into the bin. Everything or nothing: if one cannot be moved, the ones already
 *  moved go back and { ok: false } is returned, so the caller can delete them the old way.
 *  [keepUnder]: empty folders left behind are removed up to (not including) this folder. */
function stash(paths, keepUnder) {
  const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex'), moved = [];
  const undo = () => { for (const m of moved.reverse()) try { fs.renameSync(m.to, m.from); } catch {} };
  try {
    for (const raw of [...new Set(paths.map(p => path.resolve(p)))]) {
      if (!fs.existsSync(raw)) continue;
      const top = diskTop(raw);
      // A folder holding a bin, or the disk itself, is never put in the bin.
      if (raw === top || raw.split(path.sep).includes(DIR)) throw new Error('not a file the bin takes');
      const size = sizeOf(raw), to = path.join(top, DIR, id, path.relative(top, raw));
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o755 });
      fs.renameSync(raw, to);
      moved.push({ from: raw, to, size });
    }
  } catch (e) { undo(); return { ok: false, why: e.code || e.message }; }
  if (keepUnder) for (const m of moved) pruneUp(path.dirname(m.from), path.resolve(keepUnder));
  return { ok: true, id, items: moved, size: moved.reduce((a, m) => a + m.size, 0) };
}

/** Puts the files of a bin entry back where they were. Refuses (and moves nothing) when something new is in the way. */
function restore(entry) {
  for (const m of entry.items) {
    if (!fs.existsSync(m.to)) throw Object.assign(new Error(`${path.basename(m.from)} is no longer in the recycle bin`), { plain: true });
    if (fs.existsSync(m.from)) throw Object.assign(new Error(`Something new is already at ${m.from}`), { plain: true });
  }
  const back = [];
  try {
    for (const m of entry.items) { fs.mkdirSync(path.dirname(m.from), { recursive: true }); fs.renameSync(m.to, m.from); back.push(m); }
  } catch (e) { for (const m of back.reverse()) try { fs.renameSync(m.from, m.to); } catch {} throw e; }
  drop(entry);
}

/** Deletes a bin entry's files for good. */
function drop(entry) {
  const tops = new Set();
  for (const m of entry.items) {
    try { fs.rmSync(m.to, { recursive: true, force: true }); } catch {}
    const i = m.to.indexOf(path.sep + DIR + path.sep);
    if (i >= 0) tops.add(m.to.slice(0, i + DIR.length + 1) + path.sep + entry.id);
  }
  for (const t of tops) try { fs.rmSync(t, { recursive: true, force: true }); } catch {}
}

/** Whether every file of the entry is still in the bin (someone may have emptied the folder by hand). */
const intact = entry => entry.items.every(m => fs.existsSync(m.to));

module.exports = { stash, restore, drop, intact, diskTop, sizeOf, DIR };
