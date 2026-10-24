// Cinema layer: artwork from your own library. Draws the featured hero, poster rails, the library wall and the ambient backdrop.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  const css = u => 'url("' + String(u).replace(/"/g, '%22').replace(/\n/g, '') + '")';
  document.documentElement.classList.add('cn-js');
  const C = { art: null, p: null, t: 0, subs: new Set() };

  // One shared fetch of the artwork feed, refreshed every ten minutes.
  C.load = api => {
    if (C.p && Date.now() - C.t < 6e5) return C.p;
    C.t = Date.now();
    C.p = api('/api/artwork').then(d => { C.art = d; C.subs.forEach(f => f(d)); return d; }).catch(() => { C.p = null; return null; });
    return C.p;
  };
  C.reset = () => { C.art = null; C.p = null; C.t = 0; };

  // Ambient backdrop: the current picture, blurred, glowing behind the whole app.
  let amb = null, ambTimer = null, ambOn = 0, ambList = [], ambI = 0;
  const ambSet = url => {
    if (!amb || !url) return;
    const layers = amb.querySelectorAll('i'), next = layers[ambOn ^ 1], cur = layers[ambOn];
    next.style.backgroundImage = css(url); next.classList.add('on'); cur.classList.remove('on'); ambOn ^= 1;
  };
  C.ambient = () => {
    if (!amb || !document.body.contains(amb)) { amb = document.createElement('div'); amb.id = 'amb'; amb.setAttribute('aria-hidden', 'true'); amb.innerHTML = '<i></i><i></i>'; document.body.prepend(amb); }
    const feed = d => { ambList = ((d && d.hero) || []).map(x => x.fanart).filter(Boolean); if (ambList.length && !amb.querySelector('i.on')) ambSet(ambList[0]); };
    C.subs.add(feed); if (C.art) feed(C.art);
    clearInterval(ambTimer);
    if (!reduce()) ambTimer = setInterval(() => { if (document.hidden || C.heroLive || ambList.length < 2) return; ambI = (ambI + 1) % ambList.length; ambSet(ambList[ambI]); }, 24000);
  };
  C.stopAmbient = () => { clearInterval(ambTimer); if (amb) { amb.remove(); amb = null; } };

  // Hero billboard with Ken Burns, crossfade, auto-advance and a poster strip.
  C.hero = (el, items, o = {}) => {
    items = (items || []).filter(x => x.fanart).slice(0, 6);
    if (!items.length) { el.innerHTML = ''; return; }
    const DUR = 9, still = reduce(); let i = -1, timer = null, hold = false;
    el.innerHTML = `<section class="cn-hero" aria-roledescription="carousel" aria-label="Featured from your library"><div class="cn-bg">${items.map(() => '<div class="cn-sl"></div>').join('')}</div><div class="cn-shade"></div><div class="cn-body" aria-live="polite"></div>${items.length > 1 ? '<button type="button" class="cn-hn l" data-h="-1" aria-label="Previous">‹</button><button type="button" class="cn-hn r" data-h="1" aria-label="Next">›</button>' : ''}
      <div class="cn-thumbs" role="group" aria-label="Choose a featured title">${items.map((x, k) => `<button type="button" data-k="${k}" aria-label="Show ${esc(x.title)}">${x.poster ? `<img src="${esc(x.poster)}" alt="">` : ''}<i class="cn-ring" style="--dur:${DUR}s"></i></button>`).join('')}</div></section>`;
    const root = el.firstElementChild, sl = root.querySelectorAll('.cn-sl'), body = root.querySelector('.cn-body'), th = root.querySelectorAll('.cn-thumbs button');
    sl.forEach((d, k) => { d.style.backgroundImage = css(items[k].fanart); });
    const go = n => {
      n = (n + items.length) % items.length; if (n === i) return; i = n; const x = items[n];
      sl.forEach((d, k) => d.classList.toggle('on', k === n));
      th.forEach((b, k) => { const on = k === n; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'true' : 'false'); if (on) { const r = b.querySelector('.cn-ring'); r.style.animation = 'none'; void r.offsetWidth; r.style.animation = ''; } });
      const meta = [x.tv ? 'Series' : 'Movie'], bits = [x.year || '', x.cert || '', x.runtime ? Math.floor(x.runtime / 60) + 'h ' + (x.runtime % 60) + 'm' : '', x.maker || ''].filter(Boolean);
      body.classList.remove('cn-in'); void body.offsetWidth; body.classList.add('cn-in');
      body.innerHTML = `<div class="cn-meta"><span class="cn-k">${meta}</span>${x.rating ? `<span class="cn-r">★ ${x.rating.toFixed(1)}</span>` : ''}<span>${esc(bits.join(' · '))}</span></div>
        <h2>${esc(x.title)}</h2><p>${esc(x.overview)}</p><div class="cn-act"><button type="button" class="p" data-a="d">Details</button><button type="button" data-a="o">Open in library</button></div>`;
      C.heroLive = true; if (typeof ambSet === 'function') ambSet(x.fanart);
    };
    const run = () => { clearInterval(timer); if (!still && items.length > 1) timer = setInterval(() => { if (!hold && !document.hidden && document.body.contains(root)) go(i + 1); else if (!document.body.contains(root)) { clearInterval(timer); C.heroLive = false; } }, DUR * 1000); };
    root.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { go(i + +b.dataset.h); run(); });
    root.querySelector('.cn-thumbs').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { go(+b.dataset.k); run(); } };
    body.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; (b.dataset.a === 'd' ? o.onDetails : o.onOpen) && (b.dataset.a === 'd' ? o.onDetails : o.onOpen)(items[i]); };
    root.addEventListener('mouseenter', () => { hold = true; root.classList.add('hold'); });
    root.addEventListener('mouseleave', () => { hold = false; root.classList.remove('hold'); });
    root.addEventListener('focusin', () => { hold = true; root.classList.add('hold'); });
    root.addEventListener('focusout', () => { hold = false; root.classList.remove('hold'); });
    if (!still) root.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; const r = root.getBoundingClientRect(); root.querySelector('.cn-bg').style.transform = `translate3d(${((e.clientX - r.left) / r.width - .5) * -16}px,${((e.clientY - r.top) / r.height - .5) * -10}px,0)`; });
    go(0); run();
  };

  const card = (x, k, o = {}) => `<button type="button" class="cn-card" data-k="${k}" style="--d:${Math.min(k, 12) * 55}ms" aria-label="${esc(x.title)}${x.year ? ', ' + x.year : ''}"><span class="cn-pw">${x.poster ? `<img src="${esc(x.poster)}" alt="" loading="lazy">` : ''}${x.rating ? `<span class="cn-badge">★ ${x.rating.toFixed(1)}</span>` : ''}<span class="cn-ov"><b>${esc(x.title)}</b><small>${esc([x.year || '', (x.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</small></span></span><span class="cn-t">${esc(x.title)}</span></button>`;

  // Horizontal poster rail with arrows and scroll snapping.
  C.rail = (el, title, items, onPick, sub) => {
    items = (items || []).filter(x => x.poster);
    if (!items.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<section class="rv"><div class="cn-rh"><h2 class="sec">${esc(title)}${sub ? `<small class="cn-sub">${esc(sub)}</small>` : ''}</h2><span class="cn-arrows"><button type="button" aria-label="Back" title="Back" data-s="-1">‹</button><button type="button" aria-label="Forward" title="Forward" data-s="1">›</button></span></div><div class="cn-rs" tabindex="-1">${items.map((x, k) => card(x, k)).join('')}</div></section>`;
    const rs = el.querySelector('.cn-rs');
    el.querySelector('.cn-arrows').onclick = e => { const b = e.target.closest('[data-s]'); if (b) rs.scrollBy({ left: +b.dataset.s * rs.clientWidth * .8, behavior: reduce() ? 'auto' : 'smooth' }); };
    rs.onclick = e => { const b = e.target.closest('[data-k]'); if (b && onPick) onPick(items[b.dataset.k]); };
    C.reveal(el);
  };

  // A slow row of big posters across the top, with counters and back and forward buttons.
  C.ticker = (el, art, onPick, label) => {
    const all = (art.wall || []).filter(x => x.poster);
    if (all.length < 3) { el.innerHTML = ''; return; }
    let f = all.slice(); while (f.length < 16) f = f.concat(all);
    const tile = (x, k) => `<button type="button" class="cn-tt" data-i="${x.sid}:${x.id}" tabindex="${k < f.length ? 0 : -1}" aria-label="${esc(x.title)}${x.year ? ', ' + x.year : ''}" title="${esc(x.title)}"><img src="${esc(x.poster)}" alt="" loading="lazy"><span class="cn-ttn">${esc(x.title)}</span></button>`;
    el.innerHTML = `<section class="cn-tk" aria-label="${esc(label || 'Your library')}"><div class="cn-tkh"><span class="cn-n" data-n="${art.shows}">0</span><span>series</span><span class="cn-n" data-n="${art.movies}">0</span><span>movies</span>${label ? `<small>${esc(label)}</small>` : ''}</div>
      <button type="button" class="cn-tka" data-s="-1" aria-label="Back">‹</button><div class="cn-tkw"><div class="cn-tkr">${f.concat(f).map(tile).join('')}</div></div><button type="button" class="cn-tka" data-s="1" aria-label="Forward">›</button></section>`;
    const by = Object.fromEntries(all.map(x => [x.sid + ':' + x.id, x])), w = el.querySelector('.cn-tkw'), root = el.firstElementChild;
    w.onclick = e => { const b = e.target.closest('[data-i]'); if (b && onPick) onPick(by[b.dataset.i]); };
    el.querySelectorAll('[data-n]').forEach(n => { const to = +n.dataset.n, t0 = performance.now(); if (reduce()) { n.textContent = to; return; } const g = t => { const p = Math.min(1, (t - t0) / 1100); n.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(g); }; requestAnimationFrame(g); });
    // It drifts by itself; hovering stops it, and the buttons move it a page at a time, then it carries on.
    let pos = 0, last = 0, hover = false, holdTill = 0;
    const half = () => w.scrollWidth / 2;
    const wrap = () => { const h = half(); if (h > 0) { while (pos >= h) pos -= h; while (pos < 0) pos += h; } };
    w.addEventListener('pointerenter', () => { hover = true; }); w.addEventListener('pointerleave', () => { hover = false; pos = w.scrollLeft; });
    w.addEventListener('focusin', () => { hover = true; }); w.addEventListener('focusout', () => { hover = false; pos = w.scrollLeft; });
    w.addEventListener('scroll', () => { if (hover || Date.now() < holdTill) pos = w.scrollLeft; }, { passive: true });
    root.querySelectorAll('.cn-tka').forEach(b => b.onclick = () => {
      const d = +b.dataset.s, step = w.clientWidth * .8;
      pos = w.scrollLeft; if (d < 0 && pos < step) { pos += half(); w.scrollLeft = pos; } else if (d > 0 && pos + step > half()) { pos -= half(); w.scrollLeft = pos; }
      holdTill = Date.now() + 5000; w.scrollBy({ left: d * step, behavior: reduce() ? 'auto' : 'smooth' });
    });
    const run = t => {
      if (!document.body.contains(root)) return;
      const dt = last ? Math.min(100, t - last) : 0; last = t;
      if (!hover && !reduce() && !document.hidden && Date.now() >= holdTill) { pos += dt * 0.045; wrap(); w.scrollLeft = pos; }
      requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  };

  // Fade things in as they scroll into view.
  C.reveal = root => {
    const els = (root || document).querySelectorAll('.rv:not(.in)');
    if (!('IntersectionObserver' in window) || reduce()) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .05 });
    els.forEach(e => io.observe(e));
  };

  // Posters lean toward the pointer, with a light glare.
  let tcur = null;
  const tclear = () => { if (tcur) { tcur.style.removeProperty('--rx'); tcur.style.removeProperty('--ry'); tcur = null; } };
  C.tilt = () => {
    if (C._t || reduce()) return; C._t = 1;
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const c = e.target.closest && e.target.closest('.cn-card,.card[data-v]');
      if (tcur && tcur !== c) tclear();
      if (!c) return;
      const t = c.querySelector('.cn-pw') || c, r = t.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      c.style.setProperty('--rx', ((.5 - py) * 9).toFixed(2) + 'deg'); c.style.setProperty('--ry', ((px - .5) * 11).toFixed(2) + 'deg');
      t.style.setProperty('--gx', (px * 100).toFixed(0) + '%'); t.style.setProperty('--gy', (py * 100).toFixed(0) + '%'); c.style.setProperty('--gx', (px * 100).toFixed(0) + '%'); c.style.setProperty('--gy', (py * 100).toFixed(0) + '%'); tcur = c;
    }, { passive: true });
    document.addEventListener('pointerleave', tclear, true);
  };
  window.Cinema = C;
})();
