// Built-in wallpapers for the sign-in screen. Each one is drawn in code (no image files, nothing downloaded),
// so it stays sharp on any screen and works offline. Put your own pictures in the data folder (wallpapers) to use those instead.
(function () {
  const rnd = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const svg = (id, inner, defs) => `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${defs || ''}</defs>${inner}</svg>`;
  const stars = (n, seed, y1, op) => { const r = rnd(seed); let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${(r() * 1600).toFixed(0)}" cy="${(r() * y1).toFixed(0)}" r="${(0.5 + r() * 1.4).toFixed(1)}" fill="#fff" opacity="${(op * (0.3 + r() * 0.7)).toFixed(2)}"/>`; return s; };

  const dusk = () => svg('d', `<rect width="1600" height="900" fill="url(#dk)"/><circle cx="1010" cy="590" r="260" fill="url(#dg)"/><circle cx="1010" cy="590" r="84" fill="#ffe7b0"/>
    <path d="M0 640 L180 520 L300 590 L470 430 L640 600 L760 540 L900 640 L1060 560 L1240 650 L1400 500 L1600 620 V900 H0Z" fill="#4a2370" opacity=".85"/>
    <path d="M0 720 L140 640 L330 710 L520 600 L700 720 L900 660 L1100 740 L1300 650 L1480 730 L1600 690 V900 H0Z" fill="#2b1556"/>
    <path d="M0 800 L200 760 L420 810 L640 750 L860 820 L1100 770 L1340 830 L1600 780 V900 H0Z" fill="#150b33"/>`,
    `<linearGradient id="dk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1147"/><stop offset=".45" stop-color="#6a2a8c"/><stop offset=".72" stop-color="#e2557a"/><stop offset="1" stop-color="#ffb45a"/></linearGradient>
     <radialGradient id="dg"><stop offset="0" stop-color="#ffd28a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd28a" stop-opacity="0"/></radialGradient>`);

  const aurora = () => svg('a', `<rect width="1600" height="900" fill="url(#ab)"/>${stars(150, 11, 480, 0.9)}
    <g filter="url(#blur)"><path d="M-100 330 C 200 120 420 460 760 250 S 1300 80 1700 300 L1700 420 C1300 240 1000 500 700 380 S 200 260 -100 460Z" fill="url(#ag1)"/>
    <path d="M-100 420 C 300 260 520 520 900 330 S 1400 200 1700 400 L1700 480 C1400 330 1100 560 800 460 S 300 380 -100 520Z" fill="url(#ag2)" opacity=".8"/></g>
    <rect y="610" width="1600" height="290" fill="url(#al)"/><g transform="translate(0 1220) scale(1 -1)" opacity=".28" filter="url(#blur2)"><path d="M-100 330 C 200 120 420 460 760 250 S 1300 80 1700 300 L1700 420 C1300 240 1000 500 700 380 S 200 260 -100 460Z" fill="url(#ag1)"/></g>
    <path d="M0 640 L40 560 L60 600 L110 500 L150 590 L190 540 L230 640Z M1370 640 L1420 540 L1450 590 L1500 470 L1550 580 L1580 540 L1600 600 V640Z" fill="#03101a"/><rect y="640" width="1600" height="260" fill="#03101a" opacity=".55"/>`,
    `<linearGradient id="ab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030816"/><stop offset=".7" stop-color="#0a2c3c"/></linearGradient>
     <linearGradient id="ag1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#37f0b0"/><stop offset=".55" stop-color="#2fb7e8"/><stop offset="1" stop-color="#8b5cff"/></linearGradient>
     <linearGradient id="ag2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b5cff"/><stop offset="1" stop-color="#37f0b0"/></linearGradient>
     <linearGradient id="al" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b3a4a"/><stop offset="1" stop-color="#04131c"/></linearGradient>
     <filter id="blur" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="34"/></filter><filter id="blur2"><feGaussianBlur stdDeviation="14"/></filter>`);

  const neon = () => {
    const r = rnd(7); let city = '', grid = '';
    for (let x = 0, i = 0; x < 1600; i++) { const w = 50 + r() * 80, h = 90 + r() * 280; city += `<rect x="${x.toFixed(0)}" y="${(600 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#1a0a3d" opacity="${(0.75 + r() * 0.25).toFixed(2)}"/>`;
      for (let k = 0; k < 5; k++) city += `<rect x="${(x + 8 + r() * (w - 20)).toFixed(0)}" y="${(600 - h + 14 + r() * (h - 30)).toFixed(0)}" width="5" height="7" fill="${r() > 0.5 ? '#ff6ac1' : '#6ae8ff'}" opacity=".8"/>`; x += w + 6; }
    for (let i = -16; i <= 16; i++) grid += `<line x1="800" y1="600" x2="${800 + i * 190}" y2="900" stroke="#ff4fa0" stroke-opacity=".55"/>`;
    for (let k = 1; k <= 8; k++) grid += `<line x1="0" x2="1600" y1="${(600 + 300 * Math.pow(k / 8, 2)).toFixed(0)}" y2="${(600 + 300 * Math.pow(k / 8, 2)).toFixed(0)}" stroke="#ff4fa0" stroke-opacity=".5"/>`;
    return svg('n', `<rect width="1600" height="900" fill="url(#nk)"/><circle cx="800" cy="430" r="190" fill="url(#ns)"/>
      <g fill="#12062b" opacity=".9"><rect x="560" y="440" width="480" height="8"/><rect x="560" y="470" width="480" height="12"/><rect x="560" y="505" width="480" height="16"/><rect x="560" y="545" width="480" height="20"/></g>${city}
      <rect y="600" width="1600" height="300" fill="#12062b"/>${grid}`,
      `<linearGradient id="nk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0524"/><stop offset=".6" stop-color="#4b1688"/><stop offset="1" stop-color="#ff4fa0"/></linearGradient>
       <linearGradient id="ns" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe45e"/><stop offset="1" stop-color="#ff4fa0"/></linearGradient>`);
  };

  const ocean = () => {
    const r = rnd(23); let b = '';
    for (let i = 0; i < 46; i++) b += `<circle cx="${(r() * 1600).toFixed(0)}" cy="${(120 + r() * 740).toFixed(0)}" r="${(2 + r() * 9).toFixed(1)}" fill="none" stroke="#bff3ff" stroke-opacity="${(0.2 + r() * 0.4).toFixed(2)}"/>`;
    return svg('o', `<rect width="1600" height="900" fill="url(#ok)"/><g filter="url(#ob)" fill="#d8fbff"><path d="M380 0 L620 0 L330 900 L40 900Z" opacity=".13"/><path d="M820 0 L1010 0 L860 900 L560 900Z" opacity=".1"/><path d="M1180 0 L1330 0 L1500 900 L1180 900Z" opacity=".09"/></g>${b}
      <path d="M0 800 C 220 740 420 830 700 780 S 1200 740 1600 810 V900 H0Z" fill="#042238"/><path d="M0 850 C 300 810 600 880 900 840 S 1400 820 1600 860 V900 H0Z" fill="#021524"/>`,
      `<linearGradient id="ok" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27c4d6"/><stop offset=".4" stop-color="#0a6aa1"/><stop offset="1" stop-color="#031c33"/></linearGradient><filter id="ob"><feGaussianBlur stdDeviation="22"/></filter>`);
  };

  const dunes = () => svg('u', `<rect width="1600" height="900" fill="url(#uk)"/><circle cx="520" cy="470" r="230" fill="url(#ug)"/><circle cx="520" cy="470" r="96" fill="#fff3d0"/>
    <path d="M0 610 C 260 540 520 610 800 570 S 1380 520 1600 590 V900 H0Z" fill="#e0707f"/>
    <path d="M0 700 C 300 620 600 720 920 660 S 1400 620 1600 690 V900 H0Z" fill="#a8425f"/>
    <path d="M0 790 C 260 730 560 830 880 770 S 1360 740 1600 800 V900 H0Z" fill="#5d1f45"/>`,
    `<linearGradient id="uk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f78"/><stop offset=".5" stop-color="#e5744f"/><stop offset="1" stop-color="#ffd18a"/></linearGradient>
     <radialGradient id="ug"><stop offset="0" stop-color="#fff0b8" stop-opacity=".85"/><stop offset="1" stop-color="#fff0b8" stop-opacity="0"/></radialGradient>`);

  const cosmos = () => svg('c', `<rect width="1600" height="900" fill="#05040f"/><g filter="url(#cb)"><ellipse cx="420" cy="260" rx="520" ry="240" fill="#6a3bff" opacity=".42"/><ellipse cx="1200" cy="560" rx="560" ry="260" fill="#12c9b4" opacity=".28"/><ellipse cx="860" cy="760" rx="520" ry="200" fill="#ff4fa0" opacity=".3"/></g>${stars(260, 5, 900, 0.95)}
    <circle cx="1230" cy="610" r="150" fill="url(#cp)"/><ellipse cx="1230" cy="610" rx="270" ry="54" fill="none" stroke="#e9d9ff" stroke-opacity=".55" stroke-width="7" transform="rotate(-16 1230 610)"/>
    <path d="M1080 600 A150 150 0 0 0 1380 620 A150 150 0 0 1 1080 600Z" fill="#05040f" opacity=".45"/>`,
    `<radialGradient id="cp" cx=".35" cy=".3"><stop offset="0" stop-color="#ffd0a6"/><stop offset=".6" stop-color="#b8559a"/><stop offset="1" stop-color="#2b1457"/></radialGradient><filter id="cb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="70"/></filter>`);

  window.MH_SCENES = () => [['Dusk ridge', dusk()], ['Aurora lake', aurora()], ['Neon drive', neon()], ['Deep blue', ocean()], ['Golden dunes', dunes()], ['Cosmos', cosmos()]];
})();
