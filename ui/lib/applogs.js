// Log lines from every app, in one shape: { t (ms), src, level (error|warn|info|debug), msg }.
// The apps in the stack each write their own log (engine.sh pipes them through s6-log into /config/logs/<app>/:
// "current" plus a few rotated "@….s" files, each line starting with an ISO 8601 time). Apps added under Settings → Apps
// are read through their own APIs instead (the server does that part; it brings their rows here to be turned into lines).
'use strict';
const fs = require('fs'), path = require('path');

const DIR = () => process.env.GOAT_LOGS || '/config/logs';
const LEVELS = ['error', 'warn', 'info', 'debug'];

/** A level from words in the line itself, for apps that do not say. */
function guess(msg) {
  const m = String(msg);
  if (/^\((C|E)\) /.test(m)) return 'error';      // qBittorrent: (N)ormal, (I)nfo, (W)arning, (C)ritical
  if (/^\(W\) /.test(m)) return 'warn';
  if (/\b(fatal|panic|critical|error|err|exception|traceback|unhandled|crash(ed)?)\b|\[(E|ERR|ERROR|FATAL)\]|\|Error\||\|Fatal\|/i.test(m)) return 'error';
  if (/\b(warn(ing)?|deprecated|retry(ing)?|timed? ?out|refused)\b|\[(W|WRN|WARN)\]|\|Warn\|/i.test(m)) return 'warn';
  if (/\b(debug|trace|verbose)\b|\[(D|DBG|DEBUG|T|TRC)\]|\|Debug\||\|Trace\|/i.test(m)) return 'debug';
  return 'info';
}
/** Names the apps' own words for a level ("Warn", "WARNING", 30, …) as one of LEVELS. */
function norm(l, msg) {
  const v = String(l == null ? '' : l).toLowerCase();
  if (/^(fatal|critical|error|err|e|crit|50|60)$/.test(v)) return 'error';
  if (/^(warn|warning|w|wrn|40)$/.test(v)) return 'warn';
  if (/^(debug|trace|d|t|dbg|trc|verbose|10|20)$/.test(v)) return 'debug';
  if (/^(info|information|i|inf|notice|30|normal)$/.test(v)) return guess(msg) === 'error' ? 'error' : 'info';
  return guess(msg);
}

// Escape codes some apps colour their output with.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// s6-log writes "2026-11-09 16:53:33.993392347" in the container's own time zone (TZ); a Z at the end means UTC.
const TS = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(\.\d+)?(Z?)\s+/;
const stamp = m => Date.parse(`${m[1]}T${m[2]}${m[3] ? m[3].slice(0, 4) : ''}${m[4] || ''}`);

/** The apps of the stack that have a log, by folder name. */
function stackApps() {
  try { return fs.readdirSync(DIR(), { withFileTypes: true }).filter(d => d.isDirectory() && /^[\w-]+$/.test(d.name) && hasLog(d.name)).map(d => d.name).sort(); } catch { return []; }
}
function files(name) {
  const d = path.join(DIR(), name);
  let l = []; try { l = fs.readdirSync(d).filter(f => f === 'current' || /^@[0-9a-f]+\.[su]$/.test(f)); } catch { return []; }
  // Rotated files are named by their TAI64N time, so sorting the names sorts them oldest first; current is newest.
  return l.sort((a, b) => a === 'current' ? 1 : b === 'current' ? -1 : a < b ? -1 : 1).map(f => path.join(d, f));
}
const hasLog = name => files(name).length > 0;

/** The end of a file, as lines (the first, possibly cut, line dropped when it starts mid-file). */
function tail(file, bytes) {
  let fd; try {
    fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, n = Math.min(size, bytes), b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, size - n);
    const l = b.toString('utf8').split('\n'); if (n < size) l.shift();
    return l.filter(x => x.trim());
  } catch { return []; } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
}

/** The last lines (up to max, oldest first) of one app of the stack. */
function readStack(name, max = 500) {
  if (!/^[\w-]+$/.test(name)) return [];
  const out = []; const fl = files(name);
  for (let i = fl.length - 1; i >= 0 && out.length < max; i--) {
    const l = tail(fl[i], 1024 * 1024);
    out.unshift(...l.slice(-(max - out.length)));
  }
  let last = 0;
  return out.map(raw => {
    const m = raw.match(TS), t = m ? stamp(m) : NaN, msg = (m ? raw.slice(m[0].length) : raw).replace(ANSI, '').replace(/\r/g, '').slice(0, 4000);
    if (!isNaN(t)) last = t;
    return { t: isNaN(t) ? last : t, src: 'stack:' + name, level: guess(msg), msg };
  });
}

/** Lines from an app's own API rows: f(row) gives { t, level, msg }. */
function fromRows(src, rows, f) {
  return (Array.isArray(rows) ? rows : []).map(r => { try { const x = f(r); if (!x || !x.msg) return null; const msg = String(x.msg).replace(ANSI, '').slice(0, 4000);
    return { t: +x.t || 0, src, level: x.level && LEVELS.includes(x.level) ? x.level : norm(x.level, msg), msg }; } catch { return null; } }).filter(Boolean);
}

/** Lines of several sources together, newest last, kept to those that match the filters. */
function combine(lists, { q = '', levels = null, max = 500 } = {}) {
  let l = lists.flat();
  if (levels && levels.length) l = l.filter(x => levels.includes(x.level));
  if (q) { const w = String(q).toLowerCase(); l = l.filter(x => x.msg.toLowerCase().includes(w)); }
  // Stable by time: lines of one app with the same time keep their order.
  return l.map((x, i) => [x, i]).sort((a, b) => (a[0].t - b[0].t) || (a[1] - b[1])).map(a => a[0]).slice(-max);
}

module.exports = { DIR, LEVELS, guess, norm, stackApps, readStack, fromRows, combine, tail };
