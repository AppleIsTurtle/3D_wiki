/* Section « Couleur » — helper WebGL2 pour les démos d'image HDR.
   GL.create(canvas, fragmentBody) compile un shader plein écran qui dispose de :
     uniform sampler2D hdr (float RGB, texelFetch), uniform ivec2 size, in vec2 uv,
     et des fonctions GLSL de GL.LIB : oetf_srgb, eotf_srgb, lut3d(sampler2D, vec3), pq_*.
   Les pages écrivent main() ; le calcul de la sonde se fait sur le CPU avec ColorLib (même math).
   Repli : GL.available() === false → la page utilise un rendu canvas 2D sur le CPU. */
(function () {
  'use strict';
  const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

  const LIB = `
uniform float lutN; uniform float lutCols; uniform float lutRows; uniform float lutEvmin; uniform float lutEvmax;
vec3 oetf_srgb(vec3 c){ c = max(c, 0.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 eotf_srgb(vec3 v){ v = max(v, 0.0); return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v)); }
float lut_shaper(float v){
  float x1 = 0.18 * exp2(lutEvmin + (lutEvmax - lutEvmin) / (lutN - 1.0));
  v = max(v, 0.0);
  float u = v < x1 ? (v / x1) / (lutN - 1.0) : (log2(max(v, 1e-30) / 0.18) - lutEvmin) / (lutEvmax - lutEvmin);
  return clamp(u, 0.0, 1.0) * (lutN - 1.0);
}
vec3 lut_slice(sampler2D lut, vec2 rg, float b){
  vec2 cell = vec2(mod(b, lutCols), floor(b / lutCols)) * lutN;
  return texture(lut, (cell + rg + 0.5) / vec2(lutCols * lutN, lutRows * lutN)).rgb;
}
// Entrée Linear Rec.709, sortie encodée pour un display sRGB (comme les LUT bakées).
vec3 lut3d(sampler2D lut, vec3 c){
  vec3 f = vec3(lut_shaper(c.r), lut_shaper(c.g), lut_shaper(c.b));
  float b0 = min(floor(f.b), lutN - 2.0);
  return mix(lut_slice(lut, f.rg, b0), lut_slice(lut, f.rg, b0 + 1.0), f.b - b0);
}
const float PQ_M1 = 0.1593017578125, PQ_M2 = 78.84375, PQ_C1 = 0.8359375, PQ_C2 = 18.8515625, PQ_C3 = 18.6875;
float pq_encode(float nits){ float y = pow(max(nits, 0.0) / 10000.0, PQ_M1); return pow((PQ_C1 + PQ_C2 * y) / (1.0 + PQ_C3 * y), PQ_M2); }
float pq_decode(float e){ float p = pow(max(e, 0.0), 1.0 / PQ_M2); return 10000.0 * pow(max(p - PQ_C1, 0.0) / (PQ_C2 - PQ_C3 * p), 1.0 / PQ_M1); }
`;

  let _avail = null;
  function available() {
    if (_avail === null) {
      try { _avail = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { _avail = false; }
      if (new URLSearchParams(location.search).get('gl') === '0') _avail = false; // test du repli
    }
    return _avail;
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }

  /** Crée un rendu. fragmentBody = déclarations d'uniforms propres + void main(){…} écrivant `o`. */
  function create(canvas, fragmentBody, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserve });
    if (!gl) return null;
    if (opts.colorSpace && 'drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = opts.colorSpace;
    const fs = `#version 300 es
precision highp float; precision highp int;
in vec2 uv; out vec4 o;
uniform sampler2D hdr; uniform ivec2 size;
${LIB}
vec3 hdrAt(vec2 t){ ivec2 px = clamp(ivec2(t * vec2(size)), ivec2(0), size - 1); return texelFetch(hdr, ivec2(px.x, size.y - 1 - px.y), 0).rgb; }
${fragmentBody}`;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    const units = {}, texs = {}, srcs = {}; let nextUnit = 0;
    const loc = (n) => gl.getUniformLocation(prog, n);
    // Une texture par uniform : réutilisée, et rechargée seulement si la source change.
    function slot(name, src) {
      const u = units[name] ?? (units[name] = nextUnit++);
      gl.activeTexture(gl.TEXTURE0 + u);
      if (!texs[name]) texs[name] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texs[name]);
      const fresh = srcs[name] !== src; srcs[name] = src;
      return { u, fresh };
    }
    const r = {
      gl, prog,
      /** Image HDR {width, height, data Float32Array RGB} → uniform `name` (défaut hdr). */
      setHDR(img, name = 'hdr') {
        const { u, fresh } = slot(name, img);
        if (!fresh) return r;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, img.width, img.height, 0, gl.RGB, gl.FLOAT, img.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.uniform1i(loc(name), u);
        if (name === 'hdr') gl.uniform2i(loc('size'), img.width, img.height);
        return r;
      },
      /** LUT chargée par Couleur.loadLUT → uniform sampler2D `name`, et méta commune. */
      setLUT(lut, name) {
        const { u, fresh } = slot(name, lut);
        if (!fresh) return r;
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, lut.px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(loc(name), u);
        const m = lut.meta;
        gl.uniform1f(loc('lutN'), m.N); gl.uniform1f(loc('lutCols'), m.cols); gl.uniform1f(loc('lutRows'), m.rows);
        gl.uniform1f(loc('lutEvmin'), m.evmin); gl.uniform1f(loc('lutEvmax'), m.evmax);
        return r;
      },
      /** Uniform float, vec2 ou vec3 selon le nombre de valeurs. */
      set(name, ...v) {
        const l = loc(name); if (!l) return r;
        if (v.length === 1) gl.uniform1f(l, v[0]); else if (v.length === 2) gl.uniform2f(l, ...v); else gl.uniform3f(l, ...v);
        return r;
      },
      seti(name, v) { const l = loc(name); if (l) gl.uniform1i(l, v); return r; },
      draw() {
        const W = canvas.width, H = canvas.height;
        gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return r;
      },
    };
    return r;
  }

  /** Repli CPU : fn(rgbLinéaire, x, y) → [r, g, b] encodés [0,1]. Réduit l'image si besoin (maxW). */
  function render2D(canvas, img, fn, maxW = 480) {
    const s = Math.min(1, maxW / img.width), W = Math.round(img.width * s), H = Math.round(img.height * s);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d'), out = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / s)), sy = Math.min(img.height - 1, Math.floor(y / s)), i = (sy * img.width + sx) * 3;
      const c = fn([img.data[i], img.data[i + 1], img.data[i + 2]], sx, sy), o = (y * W + x) * 4;
      out.data[o] = Math.round(Math.min(Math.max(c[0], 0), 1) * 255); out.data[o + 1] = Math.round(Math.min(Math.max(c[1], 0), 1) * 255);
      out.data[o + 2] = Math.round(Math.min(Math.max(c[2], 0), 1) * 255); out.data[o + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  }

  /** Pixel de l'image source sous un événement pointeur sur le canvas. */
  function pickPixel(canvas, img, ev) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / r.width * img.width), y = Math.floor((ev.clientY - r.top) / r.height * img.height);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    const i = (y * img.width + x) * 3;
    return { x, y, rgb: [img.data[i], img.data[i + 1], img.data[i + 2]] };
  }

  window.GL = { available, create, render2D, pickPixel, LIB };
})();
