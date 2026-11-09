// How soon a disk fills up: a straight line through its free space over the last two weeks (least squares), so a
// single big download or clean-up moves it a little, not all the way. Points are [time in ms, free bytes].
'use strict';
const DAY = 864e5;

function forecast(pts, now = Date.now(), span = 14 * DAY) {
  const p = (pts || []).filter(x => now - x[0] < span && x[0] <= now);
  const free = p.length ? p[p.length - 1][1] : null;
  // At least two days and six samples, or there is too little to tell.
  if (p.length < 6 || p[p.length - 1][0] - p[0][0] < 2 * DAY) return { free, perDay: null, days: null, enough: false };
  const n = p.length, mx = p.reduce((a, x) => a + x[0], 0) / n, my = p.reduce((a, x) => a + x[1], 0) / n;
  let sxy = 0, sxx = 0; for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0, perDay = -slope * DAY;          // bytes used up per day (negative: it is freeing)
  const days = perDay > 0 && free > 0 ? free / perDay : null;
  return { free, perDay: Math.round(perDay), days: days == null ? null : Math.round(days * 10) / 10, enough: true, full: days == null ? null : Math.round(now + days * DAY) };
}

/** One sample a day (the last of each day) for a small chart. */
function daily(pts, now = Date.now(), days = 14) {
  const out = new Map();
  for (const [t, v] of pts || []) if (now - t < days * DAY) out.set(new Date(t).toDateString(), [t, v]);
  return [...out.values()];
}

module.exports = { forecast, daily, DAY };
