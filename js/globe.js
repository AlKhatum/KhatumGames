// Глобус: простая ортографическая проекция (вид на шар из космоса) на WebGL.
// Рисуется из тех же данных, что и плоская карта: растр территорий + цвета стран + рельеф суши.
(function () {
  "use strict";
  const G = window.KGGeo;
  const D = Math.PI / 180;

  const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `
precision highp float;
varying vec2 v;
uniform vec2 uView;        // размер холста, px
uniform float uRad;        // радиус шара, px
uniform vec2 uRot;         // центр вида: широта, долгота (радианы)
uniform sampler2D uIds, uLand, uPal;
uniform vec2 uTex;         // размер текстур карты
uniform vec3 uMerc;        // R, X0, Y0
uniform float uSel;        // id выбранной страны
const float PI = 3.141592653589793;
void main(){
  vec2 px = v * uView * 0.5;
  vec2 q = px / uRad;
  float r2 = dot(q, q);
  if (r2 > 1.0) {
    // ореол атмосферы
    float d = sqrt(r2) - 1.0;
    float a = exp(-d * 18.0) * 0.55;
    gl_FragColor = vec4(0.10, 0.75, 0.95, 1.0) * a;
    return;
  }
  float z = sqrt(1.0 - r2);
  // обратная ортографическая проекция с поворотом
  float c0 = cos(uRot.x), s0 = sin(uRot.x);
  float lat = asin(clamp(q.y * c0 + z * s0, -1.0, 1.0));
  float lon = uRot.y + atan(q.x, z * c0 - q.y * s0);
  lon = mod(lon + PI, 2.0 * PI) - PI;
  // освещение
  float light = 0.55 + 0.45 * clamp(dot(normalize(vec3(q.x, q.y, z)), normalize(vec3(-0.45, 0.5, 0.75))), 0.0, 1.0);
  vec3 ocean = vec3(0.016, 0.118, 0.216);
  // сетка широт/долгот («синие квадраты» шаблона)
  float gl10 = min(abs(fract(lat / (10.0 * PI / 180.0) + 0.5) - 0.5), abs(fract(lon / (10.0 * PI / 180.0) + 0.5) - 0.5));
  float fw = fwidth(lat / (10.0 * PI / 180.0)) + 1e-4;
  float grid = 1.0 - smoothstep(0.0, fw * 1.2, gl10);
  vec3 col = ocean + vec3(0.13, 0.38, 0.6) * grid * 0.35;
  float merc = log(tan(PI / 4.0 + clamp(lat, -1.5, 1.5) / 2.0));
  vec2 xy = vec2(uMerc.y + uMerc.x * lon, uMerc.z - uMerc.x * merc);
  vec2 uv = xy / uTex;
  if (uv.y < 0.0) {
    // севернее края карты — океан
  } else if (uv.y > 1.0) {
    col = vec3(0.78, 0.84, 0.9); // южнее края карты — ледник
  } else {
    vec4 land = texture2D(uLand, uv);
    float id = floor(texture2D(uIds, uv).r * 255.0 + 0.5);
    vec3 relief = land.rgb;
    vec3 base;
    if (id > 0.5) base = texture2D(uPal, vec2((id + 0.5) / 256.0, 0.5)).rgb;
    else base = vec3(0.07, 0.10, 0.20);
    vec3 landCol = base * mix(vec3(1.0), relief, 0.55);
    if (abs(id - uSel) < 0.5) landCol = mix(landCol, vec3(1.0, 0.45, 0.85), 0.25);
    col = mix(col, landCol, smoothstep(0.35, 0.65, land.a));
    // границы между странами
    vec2 e = 1.0 / uTex * max(1.0, 1.4 * length(fwidth(xy)));
    float n1 = floor(texture2D(uIds, uv + vec2(e.x, 0.0)).r * 255.0 + 0.5);
    float n2 = floor(texture2D(uIds, uv + vec2(0.0, e.y)).r * 255.0 + 0.5);
    if ((n1 != id || n2 != id) && land.a > 0.5) col = mix(col, vec3(0.1, 0.07, 0.16), 0.75);
    // береговая линия
    float coast = 1.0 - smoothstep(0.0, 0.35, abs(land.a - 0.5));
    col = mix(col, vec3(0.27, 0.84, 0.94), coast * 0.8);
  }
  col *= light;
  // мягкий край диска
  float edge = smoothstep(1.0, 0.985, sqrt(r2));
  gl_FragColor = vec4(col * edge + vec3(0.10, 0.75, 0.95) * (1.0 - edge) * 0.5, 1.0);
}`;

  function Globe(canvas, labelsEl) {
    this.cv = canvas; this.labelsEl = labelsEl;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    this.gl = gl;
    if (!gl) return;
    gl.getExtension("OES_standard_derivatives");
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const fs = "#extension GL_OES_standard_derivatives : enable\n" + FS;
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    this.pr = pr;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    ["uView", "uRad", "uRot", "uIds", "uLand", "uPal", "uTex", "uMerc", "uSel"].forEach(n => (this.u[n] = gl.getUniformLocation(pr, n)));
    this.tex = { ids: gl.createTexture(), land: gl.createTexture(), pal: gl.createTexture() };
    this.lat = 30 * D; this.lon = 40 * D; this.zoom = 1; this.sel = 0;
    this.labels = [];
  }
  Globe.prototype.ok = function () { return !!this.gl; };
  Globe.prototype._tex = function (unit, t, filter) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  };
  Globe.prototype.setIds = function (ids, w, h) {
    const gl = this.gl; if (!gl) return;
    this._tex(0, this.tex.ids, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, ids);
    this.texW = w; this.texH = h;
  };
  Globe.prototype.setLand = function (img) {
    const gl = this.gl; if (!gl) return;
    this._tex(1, this.tex.land, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  };
  Globe.prototype.setPalette = function (colors) { // colors: id -> "#rrggbb"
    const gl = this.gl; if (!gl) return;
    const data = new Uint8Array(256 * 4);
    for (const id in colors) {
      const c = colors[id], i = +id;
      if (!(i >= 0 && i < 256) || !/^#[0-9a-f]{6}$/i.test(c)) continue;
      data[i * 4] = parseInt(c.slice(1, 3), 16); data[i * 4 + 1] = parseInt(c.slice(3, 5), 16); data[i * 4 + 2] = parseInt(c.slice(5, 7), 16); data[i * 4 + 3] = 255;
    }
    this._tex(2, this.tex.pal, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  };
  // подписи стран: [{id, name, lat, lon, size}]
  Globe.prototype.setLabels = function (list) {
    this.labels = list;
    this.labelsEl.innerHTML = "";
    for (const l of list) {
      const el = document.createElement("div"); el.className = "g-label"; el.textContent = l.name; el.dataset.id = l.id;
      this.labelsEl.append(el); l.el = el;
    }
  };
  Globe.prototype.radius = function () { return Math.min(this.cv.clientWidth, this.cv.clientHeight) * 0.46 * this.zoom; };
  // прямая проекция: (lat, lon) -> экранные px относительно центра, z > 0 — видимая сторона
  Globe.prototype.project = function (lat, lon) {
    const r = this.radius(), p = lat * D, l = lon * D - this.lon;
    const x = Math.cos(p) * Math.sin(l);
    const y = Math.sin(p) * Math.cos(this.lat) - Math.cos(p) * Math.sin(this.lat) * Math.cos(l);
    const z = Math.sin(p) * Math.sin(this.lat) + Math.cos(p) * Math.cos(this.lat) * Math.cos(l);
    return [x * r, -y * r, z];
  };
  // обратная: экранные px от центра -> (lat, lon) или null вне шара
  Globe.prototype.unproject = function (sx, sy) {
    const r = this.radius(), qx = sx / r, qy = -sy / r, r2 = qx * qx + qy * qy;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2), c0 = Math.cos(this.lat), s0 = Math.sin(this.lat);
    const lat = Math.asin(Math.max(-1, Math.min(1, qy * c0 + z * s0)));
    let lon = this.lon + Math.atan2(qx, z * c0 - qy * s0);
    lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return [lat / D, lon / D];
  };
  Globe.prototype.render = function () {
    const gl = this.gl; if (!gl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.cv.clientWidth * dpr), h = Math.round(this.cv.clientHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.pr);
    gl.uniform2f(this.u.uView, w, h);
    gl.uniform1f(this.u.uRad, this.radius() * dpr);
    gl.uniform2f(this.u.uRot, this.lat, this.lon);
    gl.uniform1i(this.u.uIds, 0); gl.uniform1i(this.u.uLand, 1); gl.uniform1i(this.u.uPal, 2);
    gl.uniform2f(this.u.uTex, this.texW || G.W, this.texH || G.H);
    gl.uniform3f(this.u.uMerc, G.R, G.X0, G.Y0);
    gl.uniform1f(this.u.uSel, this.sel || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // подписи
    const cx = this.cv.clientWidth / 2, cy = this.cv.clientHeight / 2, k = this.radius() / 300;
    for (const l of this.labels) {
      const [x, y, z] = this.project(l.lat, l.lon);
      const raw = l.size * k * 0.42;
      const fs = Math.max(7, Math.min(18, raw));
      const show = z > 0.25 && raw >= 6.5;
      l.el.style.display = show ? "" : "none";
      if (show) {
        l.el.style.transform = `translate(${(cx + x).toFixed(1)}px, ${(cy + y).toFixed(1)}px) translate(-50%, -50%)`;
        l.el.style.fontSize = fs.toFixed(1) + "px";
        l.el.style.opacity = Math.min(1, (z - 0.2) * 4).toFixed(2);
      }
    }
  };
  window.KGGlobe = Globe;
})();
