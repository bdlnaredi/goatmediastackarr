// Draws a read-only status page from the data MediaHub serves. Shared by the public page (status.html) and the live preview in Settings.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const spd = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : b >= 1e3 ? Math.round(b / 1e3) + ' KB/s' : '0 KB/s';
  const N = 40;
  const spark = (v, c) => { if (v.length < 2) return ''; const W = 300, H = 52, mx = Math.max(1, ...v) * 1.15, x = i => (W - (v.length - 1 - i) * W / (N - 1)).toFixed(1), y = n => (H - 3 - n / mx * (H - 8)).toFixed(1), l = v.map((n, i) => `${i ? 'L' : 'M'}${x(i)},${y(n)}`).join('');
    return `<svg class="stx-spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${l}L${W},${H}L${x(0)},${H}Z" style="fill:${c};fill-opacity:.2"/><path d="${l}" fill="none" style="stroke:${c}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`; };
  const bars = (b, p) => { if (!b) return ''; const now = Math.floor(Date.now() / 3600000) * 3600000;
    return `<svg class="stx-bars" viewBox="0 0 ${b.length * 5} 18" width="${b.length * 5}" role="img" aria-label="Last 48 hours: ${p == null ? 'no history yet' : p + '% online'}">${b.map((v, i) => {
      const t = new Date(now - (b.length - 1 - i) * 3600000), lab = t.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }) + ': ' + (v == null ? 'no data' : Math.round(v * 100) + '% online');
      return `<rect x="${i * 5}" y="0" width="4" height="18" rx="1.5" data-tip="${esc(lab)}" style="fill:${v == null ? 'var(--k-line)' : v >= .99 ? 'var(--k-ok)' : v >= .5 ? 'var(--k-warn)' : 'var(--k-bad)'}"/>`; }).join('')}</svg>`; };
  const ICON = { full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>', pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>', play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>' };

  // d = data from the server, st = state kept between draws ({hist})
  function html(d, st) {
    st = st || {}; st.hist = st.hist || { dl: [], ul: [] };
    if (d.traffic && !st.fresh) { st.hist.dl.push(d.traffic.dl); st.hist.ul.push(d.traffic.ul); if (st.hist.dl.length > N) { st.hist.dl.shift(); st.hist.ul.shift(); } }
    const apps = d.apps || [], bad = apps.filter(a => a.ok === false).length, known = apps.some(a => a.ok != null);
    const state = !apps.length ? 'none' : !known ? 'none' : bad ? 'bad' : 'ok';
    const head = state === 'none' ? (apps.length ? 'Checking services' : d.name) : bad ? (bad === 1 ? 'One service is down' : bad + ' services are down') : 'Everything is running';
    const ok = apps.filter(a => a.ok === true).length;
    const sub = apps.length && known ? `${ok} of ${apps.length} services online` : '';
    let h = `<div class="stx-hero ${state}" role="status"><svg class="stx-ring" viewBox="0 0 96 96" aria-hidden="true"><circle class="t" cx="48" cy="48" r="42" fill="none" stroke-width="7"/><circle class="v" cx="48" cy="48" r="42" fill="none" stroke-width="7" style="stroke-dashoffset:${apps.length && known ? Math.round(264 * (1 - ok / apps.length)) : 200}"/>${state === 'bad' ? '<path d="M48 30v22M48 62v2"/>' : state === 'ok' ? '<path d="M34 49l10 10 20-22"/>' : '<path d="M38 48h20"/>'}</svg><div><b>${esc(head)}</b><div class="stx-mute">${esc(sub)}${sub ? ' · ' : ''}<span data-ago="${d.at}">just now</span></div></div></div>`;
    if (d.note) h += `<p class="stx-note">${esc(d.note)}</p>`;
    h += '<div class="stx-grid">';
    if (d.apps) h += `<section class="stx-card"><h2>Services</h2>${apps.map(a => `<div class="stx-row"><span class="stx-dot ${a.ok === true ? 'ok' : a.ok === false ? 'bad' : ''}"></span><div class="stx-grow">${esc(a.name)}<div>${bars(a.bars, a.pct)}</div></div><span class="stx-mute">${a.ok === true ? 'Online' : a.ok === false ? 'Offline' : 'Checking'}${a.pct != null ? ' · ' + a.pct + '%' : ''}</span></div>`).join('') || '<div class="stx-empty">No services yet</div>'}<div class="stx-mute" style="margin-top:8px">Each bar is one hour, newest on the right.</div></section>`;
    if (d.traffic) h += `<section class="stx-card"><h2>Downloads</h2><div class="stx-mute">Downloading</div><div class="stx-big" style="color:var(--k-acc)">${spd(d.traffic.dl)}</div>${spark(st.hist.dl, 'var(--k-acc)')}<div class="stx-mute" style="margin-top:12px">Uploading</div><div style="font-size:24px;font-weight:700;color:var(--k-okt)">${spd(d.traffic.ul)}</div></section>`;
    if (d.watching) h += `<section class="stx-card"><h2>Watching now</h2><div class="stx-big">${d.watching.count}</div><div class="stx-mute">${d.watching.count ? (d.watching.kbps ? (d.watching.kbps / 1000).toFixed(1) + ' Mbps in use' : 'Streaming') : 'Nobody is watching right now'}</div>${d.watching.items.map(x => `<div style="padding:9px 0"><div>${esc(x.title)} <span class="stx-mute">${esc(x.sub)}${x.state === 'paused' ? ' · paused' : ''}</span></div><div class="stx-pr"><i style="width:${Math.round(x.progress * 100)}%"></i></div></div>`).join('')}</section>`;
    if (d.downloads) h += `<section class="stx-card"><h2>In progress</h2>${d.downloads.map(x => `<div style="padding:8px 0"><div style="word-break:break-word">${esc(x.name)}</div><div class="stx-pr"><i style="width:${Math.round(x.progress * 100)}%"></i></div></div>`).join('') || '<div class="stx-empty">Nothing right now</div>'}</section>`;
    if (d.upcoming) h += `<section class="stx-card"><h2>Coming up</h2>${d.upcoming.map(x => `<div class="stx-row"><span class="stx-grow">${esc(x.title)} <span class="stx-mute">${esc(x.sub)}</span></span><span class="stx-when">${esc(new Date(x.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></div>`).join('') || '<div class="stx-empty">Nothing in the next week</div>'}</section>`;
    return h + '</div>';
  }
  // tooltips for the uptime bars and "updated x ago" text
  function attach(root) {
    if (root._sk) return; root._sk = 1;
    let tip = null; const hide = () => { if (tip) { tip.remove(); tip = null; } };
    root.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) return hide(); if (!tip) { tip = document.createElement('div'); tip.className = 'stx-tip'; document.body.append(tip); } tip.textContent = t.dataset.tip; tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; });
    root.addEventListener('mouseleave', hide);
    const ago = () => root.querySelectorAll('[data-ago]').forEach(el => { const s = Math.max(0, Math.round((Date.now() - +el.dataset.ago) / 1000)); el.textContent = s < 5 ? 'updated just now' : s < 90 ? 'updated ' + s + ' s ago' : 'updated ' + Math.round(s / 60) + ' min ago'; });
    root._agoTimer = setInterval(() => { if (!document.contains(root)) return clearInterval(root._agoTimer); ago(); }, 1000);
  }
  window.StatusKit = { html, attach, ICON, esc };
})();
