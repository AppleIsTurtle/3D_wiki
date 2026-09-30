/* Section « Couleur » du Wiki 3D — navigation, glossaire au survol, badge écran, chargements.
   Chaque page : <body data-page="slug">, <header class="crumbs"></header>, <nav class="secnav"></nav>.
   À charger après glossaire-data.js et colorlib.js. Expose window.Couleur. */
(function () {
  'use strict';

  // Ordre du plan. published = la page est en ligne (sinon « à venir », sans lien).
  const PAGES = [
    { slug: '', titre: 'La chaîne', published: true },
    { slug: 'espaces', titre: 'Espaces', published: true },
    { slug: 'vues', titre: 'Vues', published: true },
    { slug: 'ocio', titre: 'OCIO', published: true },
    { slug: 'aces', titre: 'ACES', published: true },
    { slug: 'ecran', titre: 'Écran', published: true },
    { slug: 'hdr', titre: 'HDR', published: true },
    { slug: 'logiciels', titre: 'Logiciels', published: true },
    { slug: 'glossaire', titre: 'Glossaire', published: true },
  ];
  const script = document.currentScript;
  const BASE = new URL('../', script ? script.src : location.href); // …/couleur/
  const pageURL = (slug) => new URL(slug ? slug + '/' : './', BASE).href;
  const bySlug = Object.fromEntries(PAGES.map((p) => [p.slug, p]));
  // En local (serveur de dev), ?preview=1 affiche aussi les liens des pages non publiées.
  const preview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('preview');
  const isOn = (slug) => !!bySlug[slug] && (bySlug[slug].published || preview);
  const current = document.body.dataset.page || '';
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); Object.assign(e, attrs); if (text != null) e.textContent = text; return e; };

  /* ---------- Fil d'Ariane et navigation ---------- */
  function buildNav() {
    const crumbs = document.querySelector('header.crumbs');
    if (crumbs && !crumbs.childElementCount) {
      const parts = [['Wiki 3D', '/'], ['Couleur', current ? pageURL('') : null]];
      if (current) parts.push([bySlug[current] ? bySlug[current].titre : current, null]);
      parts.forEach(([t, href], i) => {
        if (i) crumbs.append(el('span', { className: 'sep', ariaHidden: 'true' }, '/'));
        crumbs.append(href ? el('a', { href }, t) : el('span', {}, t));
      });
    }
    const nav = document.querySelector('nav.secnav');
    if (nav && !nav.childElementCount) {
      nav.setAttribute('aria-label', 'Pages de la section Couleur');
      const ol = el('ol');
      PAGES.forEach((p, i) => {
        const li = el('li');
        const label = `${i + 1}. ${p.titre}`;
        if (p.slug === current) li.append(el('span', { ariaCurrent: 'page' }, label));
        else if (isOn(p.slug)) li.append(el('a', { href: pageURL(p.slug) }, label));
        else li.append(el('span', { className: 'soon' }, label));
        ol.append(li);
      });
      nav.append(ol);
    }
    // Liens internes vers une page : <a data-page="slug" data-anchor="…">
    document.querySelectorAll('a[data-page]').forEach((a) => {
      const slug = a.dataset.page;
      if (isOn(slug)) a.href = pageURL(slug) + (a.dataset.anchor ? '#' + a.dataset.anchor : '');
      else { a.removeAttribute('href'); a.classList.add('soon-link'); a.setAttribute('aria-disabled', 'true'); }
    });
  }

  /* ---------- Glossaire au survol ---------- */
  const GLOSS = Object.fromEntries((window.GLOSSAIRE || []).map((g) => [g.id, g]));
  let pop, popFor = null, hideTimer = 0;
  function showPop(target) {
    const g = GLOSS[target.dataset.g];
    if (!g) return;
    clearTimeout(hideTimer);
    if (!pop) {
      pop = el('div', { className: 'g-pop', id: 'g-pop', role: 'tooltip', hidden: true });
      pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
      pop.addEventListener('mouseleave', () => hidePop());
      document.body.append(pop);
    }
    pop.replaceChildren(el('b', {}, g.terme), el('span', {}, g.def));
    if (isOn('glossaire')) pop.append(el('br'), el('a', { href: pageURL('glossaire') + '#' + g.id }, 'Dans le glossaire →'));
    pop.hidden = false; popFor = target;
    target.setAttribute('aria-describedby', 'g-pop');
    const r = target.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 16));
    pop.style.left = left + 'px';
    pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
  }
  function hidePop(delay = 120) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (pop) pop.hidden = true;
      if (popFor) popFor.removeAttribute('aria-describedby');
      popFor = null;
    }, delay);
  }
  function initGlossary() {
    document.querySelectorAll('dfn[data-g]').forEach((d) => {
      if (!GLOSS[d.dataset.g]) { console.warn('[glossaire] id inconnu :', d.dataset.g); return; }
      d.tabIndex = 0;
      d.addEventListener('mouseenter', () => showPop(d));
      d.addEventListener('mouseleave', () => hidePop());
      d.addEventListener('focus', () => showPop(d));
      d.addEventListener('blur', () => hidePop(200));
      d.addEventListener('click', (e) => { e.stopPropagation(); popFor === d && pop && !pop.hidden ? hidePop(0) : showPop(d); });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(0); });
    document.addEventListener('click', (e) => { if (pop && !pop.hidden && !pop.contains(e.target)) hidePop(0); });
  }

  /* ---------- Écran du lecteur ---------- */
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  function screenInfo() {
    const gamut = mq('(color-gamut: rec2020)') ? 'rec2020' : mq('(color-gamut: p3)') ? 'p3' : 'srgb';
    return { gamut, hdr: mq('(dynamic-range: high)'), dpr: window.devicePixelRatio || 1 };
  }
  const GAMUT_LABEL = { srgb: 'sRGB', p3: 'P3', rec2020: 'Rec.2020' };
  /** Phrase sous une démo. opts.needs : 'p3' | 'hdr' | null ; opts.note : précision propre à la démo. */
  function screenNote(opts = {}) {
    const s = screenInfo();
    let t = `Ton écran : ${GAMUT_LABEL[s.gamut]}, ${s.hdr ? 'HDR' : 'SDR'} (d'après ton navigateur, pas une mesure).`;
    if (opts.needs === 'p3' && s.gamut === 'srgb') t += ' Cette démo montre des couleurs hors sRGB : ici, elles sont ramenées au bord du sRGB.';
    if (opts.needs === 'hdr' && !s.hdr) t += ' Cette démo vise un écran HDR : ce que tu vois est une simulation à l\'échelle.';
    if (opts.note) t += ' ' + opts.note;
    return t;
  }
  function fillBadges() {
    const s = screenInfo();
    document.querySelectorAll('.screen-badge').forEach((b) => {
      b.replaceChildren(el('span', {}, 'Gamut ' + GAMUT_LABEL[s.gamut]), el('span', {}, s.hdr ? 'HDR' : 'SDR'), el('span', {}, 'DPR ' + +s.dpr.toFixed(2)));
    });
    document.querySelectorAll('[data-screen-note]').forEach((n) => { n.textContent = screenNote({ needs: n.dataset.screenNote || null, note: n.dataset.note }); });
  }

  /* ---------- Chargements ---------- */
  const imgCache = new Map();
  function loadImage(src) {
    if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + src)); im.src = src;
    }));
    return imgCache.get(src);
  }
  function pixels(im) {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  }
  const VERSION = '20260930'; // à changer à chaque publication (cache des navigateurs)
  const asset = (path) => new URL('assets/' + path + (path.includes('?') ? '&' : '?') + 'v=' + VERSION, BASE).href;
  /** Image HDR « RGBE split » → {width, height, data: Float32Array RGB linéaire}. */
  async function loadRGBE(path) {
    const px = pixels(await loadImage(asset(path)));
    const W = px.width / 2, H = px.height, out = new Float32Array(W * H * 3), d = px.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = (y * px.width + x) * 4, e = d[(y * px.width + x + W) * 4], o = (y * W + x) * 3;
      if (e < 1) continue;
      const f = Math.pow(2, e - 136);
      out[o] = (d[m] + 0.5) * f; out[o + 1] = (d[m + 1] + 0.5) * f; out[o + 2] = (d[m + 2] + 0.5) * f;
    }
    return { width: W, height: H, data: out };
  }
  let lutMeta = null;
  /** LUT atlas → {key, meta, view, img, px (ImageData)}. */
  async function loadLUT(key) {
    if (!lutMeta) lutMeta = fetch(asset('lut/luts.json')).then((r) => r.json());
    const meta = await lutMeta, v = meta.views[key];
    if (!v) throw new Error('LUT inconnue ' + key);
    const img = await loadImage(asset('lut/' + v.file));
    return { key, meta, view: v, img, px: pixels(img) };
  }

  /* ---------- Formats ---------- */
  const fmt = {
    num: (v, d = 3) => (Number.isFinite(v) ? v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—'),
    rgb: (a, d = 3) => '(' + a.map((v) => fmt.num(v, d)).join(' ; ') + ')',
    stops: (s) => (Number.isFinite(s) ? (s >= 0 ? '+' : '−') + Math.abs(s).toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' EV' : '−∞'),
    code8: (a) => '(' + a.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255)).join(', ') + ')',
  };

  window.Couleur = { PAGES, BASE: BASE.href, pageURL, isOn, screenInfo, screenNote, loadImage, loadRGBE, loadLUT, asset, fmt };
  buildNav(); initGlossary(); fillBadges();
})();
