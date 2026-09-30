/* ColorLib — calcul couleur du wiki « Couleur ». Fonctions pures, sans DOM.
   Navigateur : window.ColorLib ; Node : module.exports.
   Testé contre OCIO 2.5 (configs réelles) par Moi/wiki-couleur/tools/test-colorlib.mjs.
   Sources des constantes : Moi/wiki-couleur/research/R1-ocio-aces.md §7 et R3-ecrans-hdr-web.md §1, §5. */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.ColorLib = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Chromaticités (x, y) ---------- */
  const PRIMARIES = {
    rec709: [[0.640, 0.330], [0.300, 0.600], [0.150, 0.060]],   // = sRGB (BT.709)
    p3: [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],       // DCI-P3, Display P3, P3-D65
    rec2020: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],  // BT.2020 = BT.2100
    ap0: [[0.7347, 0.2653], [0.0, 1.0], [0.0001, -0.0770]],     // ACES2065-1
    ap1: [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]],      // ACEScg, ACEScct
  };
  const WHITES = {
    D65: [0.3127, 0.3290],
    ACES: [0.32168, 0.33767], // ≈ 6000 K, pas un illuminant CIE « D60 »
    DCI: [0.314, 0.351],
  };
  // Espaces linéaires : primaires + blanc
  const SPACES = {
    lin_rec709: { primaries: 'rec709', white: 'D65', label: 'Linear Rec.709 (sRGB)' },
    lin_p3d65: { primaries: 'p3', white: 'D65', label: 'Linear P3-D65' },
    lin_rec2020: { primaries: 'rec2020', white: 'D65', label: 'Linear Rec.2020' },
    acescg: { primaries: 'ap1', white: 'ACES', label: 'ACEScg' },
    aces2065: { primaries: 'ap0', white: 'ACES', label: 'ACES2065-1' },
  };

  /* ---------- Matrices 3×3 ---------- */
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const apply = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
  function inv(m) {
    const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
  }
  const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];

  /** Matrice RGB → XYZ à partir des primaires et du blanc (Y du blanc = 1). */
  function rgbToXYZ(primaries, white) {
    const P = typeof primaries === 'string' ? PRIMARIES[primaries] : primaries;
    const W = xyToXYZ(typeof white === 'string' ? WHITES[white] : white);
    const cols = P.map(xyToXYZ); // colonnes
    const M = [0, 1, 2].map((r) => cols.map((c) => c[r]));
    const S = apply(inv(M), W);
    return M.map((r) => r.map((v, j) => v * S[j]));
  }

  /** Adaptation chromatique de Bradford (celle des configs ACES d'OCIO : « _BFD »). */
  const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
  function bradford(wSrc, wDst) {
    const s = apply(BRADFORD, xyToXYZ(typeof wSrc === 'string' ? WHITES[wSrc] : wSrc));
    const d = apply(BRADFORD, xyToXYZ(typeof wDst === 'string' ? WHITES[wDst] : wDst));
    const D = [[d[0] / s[0], 0, 0], [0, d[1] / s[1], 0], [0, 0, d[2] / s[2]]];
    return mul(inv(BRADFORD), mul(D, BRADFORD));
  }

  const _mcache = new Map();
  /** Matrice de conversion entre deux espaces linéaires de SPACES. */
  function matrix(from, to) {
    const k = from + '>' + to;
    if (!_mcache.has(k)) {
      const A = SPACES[from], B = SPACES[to];
      let M = rgbToXYZ(A.primaries, A.white);
      if (A.white !== B.white) M = mul(bradford(A.white, B.white), M);
      _mcache.set(k, mul(inv(rgbToXYZ(B.primaries, B.white)), M));
    }
    return _mcache.get(k);
  }
  const convert = (rgb, from, to) => (from === to ? rgb.slice() : apply(matrix(from, to), rgb));

  /** Coordonnées xy d'une couleur linéaire (pour le diagramme de chromaticité). */
  function toXY(rgb, space) {
    const S = SPACES[space];
    const [X, Y, Z] = apply(rgbToXYZ(S.primaries, S.white), rgb);
    const s = X + Y + Z;
    return s > 0 ? [X / s, Y / s] : null;
  }
  /** Valeurs RGB linéaires d'un point xy (luminance Y) dans un espace donné (colorimétrie absolue, sans adaptation). */
  function fromXY(xy, Y, space) {
    const S = SPACES[space];
    const XYZ = [xy[0] * Y / xy[1], Y, (1 - xy[0] - xy[1]) * Y / xy[1]];
    return apply(inv(rgbToXYZ(S.primaries, S.white)), XYZ);
  }

  /* ---------- Courbes de transfert ---------- */
  const srgb = {
    encode: (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055),
    decode: (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)),
  };
  const gamma = (g) => ({ encode: (l) => Math.pow(Math.max(l, 0), 1 / g), decode: (v) => Math.pow(Math.max(v, 0), g) });
  /** BT.1886 : L = a·max(V+b,0)^2.4, Lw et Lb en cd/m². Gamma 2,4 pur si Lb = 0. */
  function bt1886(Lw = 100, Lb = 0) {
    const g = 2.4, lw = Math.pow(Lw, 1 / g), lb = Math.pow(Lb, 1 / g);
    const a = Math.pow(lw - lb, g), b = lb / (lw - lb);
    return { decode: (V) => a * Math.pow(Math.max(V + b, 0), g), encode: (L) => Math.pow(Math.max(L, 0) / a, 1 / g) - b };
  }
  const acescct = {
    encode: (l) => (l <= 0.0078125 ? 10.5402377416545 * l + 0.0729055341958355 : (Math.log2(l) + 9.72) / 17.52),
    decode: (v) => (v <= 0.155251141552511 ? (v - 0.0729055341958355) / 10.5402377416545
      : v < (Math.log2(65504) + 9.72) / 17.52 ? Math.pow(2, v * 17.52 - 9.72) : 65504),
  };
  // PQ (SMPTE ST 2084 / BT.2100-3 Table 4) : luminance absolue en cd/m²
  const PQ_C = { m1: 2610 / 16384, m2: 2523 / 4096 * 128, c1: 3424 / 4096, c2: 2413 / 4096 * 32, c3: 2392 / 4096 * 32 };
  const pq = {
    encode(nits) {
      const { m1, m2, c1, c2, c3 } = PQ_C, y = Math.pow(Math.max(nits, 0) / 10000, m1);
      return Math.pow((c1 + c2 * y) / (1 + c3 * y), m2);
    },
    decode(E) {
      const { m1, m2, c1, c2, c3 } = PQ_C, p = Math.pow(Math.max(E, 0), 1 / m2);
      return 10000 * Math.pow(Math.max(p - c1, 0) / (c2 - c3 * p), 1 / m1);
    },
  };
  // HLG (BT.2100-3 Table 5) : OETF scène → signal, E dans [0,1]
  const HLG_C = { a: 0.17883277, b: 1 - 4 * 0.17883277, c: 0.5 - 0.17883277 * Math.log(4 * 0.17883277) };
  const hlg = {
    oetf: (E) => (E <= 1 / 12 ? Math.sqrt(3 * Math.max(E, 0)) : HLG_C.a * Math.log(12 * E - HLG_C.b) + HLG_C.c),
    oetfInverse: (V) => (V <= 0.5 ? V * V / 3 : (Math.exp((V - HLG_C.c) / HLG_C.a) + HLG_C.b) / 12),
  };
  const quantize = (v, bits = 8) => { const n = (1 << bits) - 1; return Math.round(Math.min(Math.max(v, 0), 1) * n) / n; };

  /* ---------- LUT atlas (format de cours-lighting : lut_bake.py) ----------
     meta = {N, cols, rows, evmin, evmax}. Nœud 0 = 0 ; nœud i = 0,18·2^(evmin + (evmax−evmin)·i/(N−1)).
     Atlas : tranche b (bleu) en case (b % cols, ⌊b / cols⌋), rouge en x, vert en y. Entrée = Linear Rec.709. */
  function lutShaper(v, m) {
    const x1 = 0.18 * Math.pow(2, m.evmin + (m.evmax - m.evmin) / (m.N - 1));
    v = Math.max(v, 0);
    const u = v < x1 ? (v / x1) / (m.N - 1) : (Math.log2(Math.max(v, 1e-30) / 0.18) - m.evmin) / (m.evmax - m.evmin);
    return Math.min(Math.max(u, 0), 1) * (m.N - 1);
  }
  /** Applique une LUT atlas sur le CPU. px = {data (RGBA 8 bits), width}. Renvoie des valeurs encodées [0,1]. */
  function lutApply(rgb, px, m) {
    const f = rgb.map((c) => lutShaper(c, m));
    const i0 = f.map((v) => Math.min(Math.floor(v), m.N - 2));
    const t = f.map((v, k) => v - i0[k]);
    const out = [0, 0, 0];
    for (let db = 0; db < 2; db++) for (let dg = 0; dg < 2; dg++) for (let dr = 0; dr < 2; dr++) {
      const w = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
      if (!w) continue;
      const b = i0[2] + db, x = (b % m.cols) * m.N + i0[0] + dr, y = Math.floor(b / m.cols) * m.N + i0[1] + dg;
      const o = (y * px.width + x) * 4;
      for (let k = 0; k < 3; k++) out[k] += w * px.data[o + k] / 255;
    }
    return out;
  }

  /* ---------- RGBE « split » (cours-lighting/blender/lib.py) ----------
     Image u8 de largeur 2W : moitié gauche = mantisses RGB, moitié droite = exposant E. v = (m + 0,5)·2^(E − 136). */
  const rgbe = (m, e) => (e < 1 ? [0, 0, 0] : m.map((c) => (c + 0.5) * Math.pow(2, e - 136)));

  /* ---------- Utilitaires ---------- */
  const LUMA709 = [0.2126, 0.7152, 0.0722];
  const luminance = (rgb) => rgb[0] * LUMA709[0] + rgb[1] * LUMA709[1] + rgb[2] * LUMA709[2];
  const stops = (Y) => (Y > 0 ? Math.log2(Y / 0.18) : -Infinity); // EV relatifs au gris 18 %

  return { PRIMARIES, WHITES, SPACES, rgbToXYZ, bradford, matrix, convert, apply, inv, mul, toXY, fromXY,
    srgb, gamma, bt1886, acescct, pq, hlg, quantize, lutShaper, lutApply, rgbe, luminance, stops };
});
