// Глобус: ортографическая проекция (вид на шар из космоса) на WebGL.
// Показывает те же слои, что и плоская карта (с учётом переключателей в легенде),
// а поверх — города, названия, спутники и их орбиты (2D-холст).
(function () {
  "use strict";
  const G = window.KGGeo;
  const D = Math.PI / 180;

  const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `
precision highp float;
varying vec2 v;
uniform vec2 uView;
uniform float uRad;
uniform vec2 uRot;
uniform sampler2D uIds, uLand, uPal, uProv, uLines, uMisc;
uniform vec2 uTex;
uniform vec3 uMerc;
uniform float uSel, uSelProv;
uniform vec4 uShow1; // океан(сетка), суша вне стран, заливка стран, рельеф
uniform vec4 uShow2; // гидрография, городские зоны, провинции, границы стран
uniform vec4 uShow3; // береговая линия, автострады, магистрали, второстепенные
uniform vec4 uShow4; // ЖД, подсветка: автострады, магистрали, второстепенные
uniform vec4 uHl;    // подсветка: ЖД, границы стран, провинции, —
const float PI = 3.141592653589793;
float pid(vec2 uv){ vec4 t = texture2D(uProv, uv); return floor(t.r * 255.0 + 0.5) + floor(t.a * 255.0 + 0.5) * 256.0; }
float cid(vec2 uv){ return floor(texture2D(uIds, uv).r * 255.0 + 0.5); }
vec3 roadMix(vec3 col, float a, float show, float hl, vec3 c){
  if (show < 0.5) return col;
  if (hl > 0.5) return mix(col, mix(c, vec3(1.0), 0.35), clamp(a * 1.6, 0.0, 1.0));
  return mix(col, vec3(1.0), a * 0.5);
}
void main(){
  vec2 px = v * uView * 0.5;
  vec2 q = px / uRad;
  float r2 = dot(q, q);
  if (r2 > 1.0) {
    float d = sqrt(r2) - 1.0;
    gl_FragColor = vec4(0.10, 0.75, 0.95, 1.0) * exp(-d * 18.0) * 0.55;
    return;
  }
  float z = sqrt(1.0 - r2);
  float c0 = cos(uRot.x), s0 = sin(uRot.x);
  float lat = asin(clamp(q.y * c0 + z * s0, -1.0, 1.0));
  float lon = uRot.y + atan(q.x, z * c0 - q.y * s0);
  lon = mod(lon + PI, 2.0 * PI) - PI;
  float light = 0.55 + 0.45 * clamp(dot(normalize(vec3(q.x, q.y, z)), normalize(vec3(-0.45, 0.5, 0.75))), 0.0, 1.0);
  vec3 ocean = vec3(0.016, 0.118, 0.216);
  vec3 col = ocean;
  if (uShow1.x > 0.5) {
    float g = min(abs(fract(lat / (10.0 * PI / 180.0) + 0.5) - 0.5), abs(fract(lon / (10.0 * PI / 180.0) + 0.5) - 0.5));
    float fw = fwidth(lat / (10.0 * PI / 180.0)) + 1e-4;
    col += vec3(0.13, 0.38, 0.6) * (1.0 - smoothstep(0.0, fw * 1.2, g)) * 0.35;
  }
  float merc = log(tan(PI / 4.0 + clamp(lat, -1.5, 1.5) / 2.0));
  vec2 xy = vec2(uMerc.y + uMerc.x * lon, uMerc.z - uMerc.x * merc);
  vec2 uv = xy / uTex;
  if (uv.y > 1.0) col = vec3(0.78, 0.84, 0.9);
  else if (uv.y >= 0.0) {
    vec4 land = texture2D(uLand, uv);
    float id = cid(uv);
    float isLand = smoothstep(0.35, 0.65, land.a);
    vec3 base = uShow1.y > 0.5 ? vec3(0.07, 0.10, 0.20) : ocean;
    if (id > 0.5 && uShow1.z > 0.5) base = texture2D(uPal, vec2((id + 0.5) / 256.0, 0.5)).rgb;
    vec3 landCol = base;
    if (uShow1.w > 0.5) landCol *= mix(vec3(1.0), land.rgb, 0.55);
    if (abs(id - uSel) < 0.5) landCol = mix(landCol, vec3(1.0, 0.45, 0.85), 0.25);
    col = mix(col, landCol, isLand);
    if (uShow2.x + uShow2.y > 0.5) { // чтение текстуры — только если включён хотя бы один из её слоёв
      vec4 misc = texture2D(uMisc, uv);
      if (uShow2.x > 0.5) col = mix(col, vec3(0.24, 0.30, 0.50), misc.r * 0.85);   // реки и озёра
      if (uShow2.y > 0.5) col = mix(col, vec3(0.95, 0.85, 0.65), misc.a * 0.35);   // городские зоны
    }
    if (uShow3.y + uShow3.z + uShow3.w + uShow4.x > 0.5) {
      vec4 ln = texture2D(uLines, uv);
      col = roadMix(col, ln.r, uShow3.y, uShow4.y, vec3(1.0, 0.25, 0.82));
      col = roadMix(col, ln.b, uShow3.z, uShow4.z, vec3(1.0, 0.88, 0.30));
      col = roadMix(col, ln.g, uShow3.w, uShow4.w, vec3(0.10, 0.90, 1.0));
      col = roadMix(col, ln.a, uShow4.x, uHl.x, vec3(1.0, 0.60, 0.24));
    }
    vec2 e = 1.0 / uTex * max(1.0, 1.4 * length(fwidth(xy)));
    // провинции
    if (uShow2.z > 0.5 && land.a > 0.5) {
      float p0 = pid(uv);
      if (abs(p0 - uSelProv) < 0.5) col = mix(col, vec3(0.5, 0.91, 1.0), 0.22);
      if (pid(uv + vec2(e.x, 0.0)) != p0 || pid(uv + vec2(0.0, e.y)) != p0)
        col = uHl.z > 0.5 ? mix(col, vec3(0.62, 0.94, 1.0), 0.85) : mix(col, vec3(0.07, 0.09, 0.19), 0.35);
    }
    // границы стран
    if (uShow2.w > 0.5 && land.a > 0.5) {
      float n1 = cid(uv + vec2(e.x, 0.0)), n2 = cid(uv + vec2(0.0, e.y));
      if (n1 != id || n2 != id) col = uHl.y > 0.5 ? mix(col, vec3(1.0, 0.6, 0.91), 0.95) : mix(col, vec3(0.1, 0.07, 0.16), 0.75);
    }
    if (uShow3.x > 0.5) col = mix(col, vec3(0.27, 0.84, 0.94), (1.0 - smoothstep(0.0, 0.35, abs(land.a - 0.5))) * 0.8);
  }
  col *= light;
  float edge = smoothstep(1.0, 0.985, sqrt(r2));
  gl_FragColor = vec4(col * edge + vec3(0.10, 0.75, 0.95) * (1.0 - edge) * 0.5, 1.0);
}`;

  function Globe(canvas, overlay, labelsEl) {
    this.cv = canvas; this.ov = overlay; this.labelsEl = labelsEl;
    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    this.gl = gl;
    if (!gl) return;
    gl.getExtension("OES_standard_derivatives");
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, "#extension GL_OES_standard_derivatives : enable\n" + FS));
    gl.bindAttribLocation(pr, 0, "p"); // один и тот же вход у основной и у упаковывающей программы
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
    ["uView", "uRad", "uRot", "uIds", "uLand", "uPal", "uProv", "uLines", "uMisc", "uTex", "uMerc", "uSel", "uSelProv",
      "uShow1", "uShow2", "uShow3", "uShow4", "uHl"].forEach(n => (this.u[n] = gl.getUniformLocation(pr, n)));
    this.tex = {};
    ["ids", "land", "pal", "prov", "lines", "misc"].forEach(k => (this.tex[k] = gl.createTexture()));
    this.unit = { ids: 0, land: 1, pal: 2, prov: 3, lines: 4, misc: 5 };
    // программу упаковки собираем сразу, пока в очереди видеокарты нет больших текстур: позже проверка её сборки
    // ждала, пока видеокарта примет десятки мегабайт растров, — это было замирание ~0,2 с при открытии шара
    this._packProgram();
    gl.useProgram(pr);
    // пустые текстуры, пока данные не загружены
    for (const k of ["prov", "lines", "misc"]) this._upload(k, gl.LUMINANCE_ALPHA, 1, 1, new Uint8Array(2), gl.NEAREST);
    this.lat = 30 * D; this.lon = 40 * D; this.zoom = 1; this.sel = 0; this.selProv = 0;
    this.show = {}; this.labels = []; this.cities = []; this.provLabels = []; this.sats = null;
    // Рисуем шар на видеокарте только когда что-то изменилось (вид, слои, текстуры): ключ последнего кадра.
    this.texVer = 0; this._glKey = ""; this._cam = null; this.moveT = 0; this.q = 1;
    // холст сбрасывается браузером (скрытая вкладка, нехватка памяти) — тогда перерисуем при возвращении
    document.addEventListener("visibilitychange", () => { this._glKey = ""; });
    canvas.addEventListener("webglcontextlost", e => e.preventDefault());
  }
  // следующий render() обязательно перерисует шар
  Globe.prototype.invalidate = function () { this._glKey = ""; };
  // нужен ли дорисовать полное разрешение: вращение закончилось, а последний кадр был упрощённым
  Globe.prototype.pending = function (now) { return this.q !== 1 && now - this.moveT >= 180; };
  Globe.prototype.ok = function () { return !!this.gl; };
  Globe.prototype._bind = function (k, filter) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + this.unit[k]); gl.bindTexture(gl.TEXTURE_2D, this.tex[k]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  };
  Globe.prototype._upload = function (k, fmt, w, h, data, filter) {
    const gl = this.gl;
    this._bind(k, filter);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data);
    this.texVer++;
  };
  // Упаковка альфа-каналов нескольких картинок в один RGBA на видеокарте: без чтения пикселей на странице
  // (раньше это были getImageData по 58 МБ и циклы по 14,5 млн пикселей — страница замирала на секунды).
  // k — имя текстуры, imgs — картинки, chans — в какой канал (0..3) класть альфу каждой.
  Globe.prototype._packProgram = function () {
    if (this._pk) return this._pk;
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }"));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, "precision mediump float; varying vec2 v; uniform sampler2D t; void main(){ gl_FragColor = vec4(texture2D(t, v).a); }"));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return (this._pk = { p, t: gl.getUniformLocation(p, "t") });
  };
  Globe.prototype.packAlpha = async function (k, imgs, chans, w, h, pause) {
    const gl = this.gl, pk = this._packProgram();
    const dst = this.tex[k];
    this._bind(k, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!ok) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); throw new Error("не удалось собрать текстуру шара"); }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pk.p);
    gl.uniform1i(pk.t, 7);
    const tmp = gl.createTexture();
    for (let i = 0; i < imgs.length; i++) {
      if (pause) await pause(); // отдаём страницу браузеру между картинками
      // картинка или функция, которая её отдаёт (ImageBitmap раскодируется в фоне, пока рисуется предыдущая)
      const img = typeof imgs[i] === "function" ? await imgs[i]() : imgs[i];
      // пока ждали, шар мог перерисоваться: состояние упаковки ставим заново перед каждым рисунком
      gl.useProgram(pk.p); gl.uniform1i(pk.t, 7); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, tmp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      if (img && img.close) img.close(); // ImageBitmap больше не нужен: память освобождаем сразу
      const c = chans[i];
      gl.colorMask(c === 0, c === 1, c === 2, c === 3);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // и возвращаем состояние для отрисовки шара, прежде чем отдать страницу (иначе кадр шара рисовался бы в один канал)
      gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(this.pr);
    }
    gl.colorMask(true, true, true, true);
    gl.deleteTexture(tmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.useProgram(this.pr);
    this.texVer++;
  };
  Globe.prototype.setIds = function (ids, w, h) { this._upload("ids", this.gl.LUMINANCE, w, h, ids, this.gl.NEAREST); this.texW = w; this.texH = h; };
  // провинции: 16-битные id -> LUMINANCE_ALPHA (младший, старший байт)
  const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  Globe.prototype.setProv = function (ids, w, h) {
    let d;
    if (LITTLE && ids instanceof Uint16Array) d = new Uint8Array(ids.buffer, ids.byteOffset, ids.byteLength); // те же байты (младший, старший) — без цикла по 14 млн пикселей
    else { d = new Uint8Array(w * h * 2); for (let i = 0; i < ids.length; i++) { const v = ids[i]; d[i * 2] = v & 255; d[i * 2 + 1] = v >> 8; } }
    // 29 МБ одним куском держали страницу ~80 мс прямо в кадре открытия шара: кладём полосами по 448 строк, по одной за задачу
    const gl = this.gl, job = this._provJob = {}, ROWS = 448;
    this._bind("prov", gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, w, h, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, null);
    let y = 0;
    const step = () => {
      if (this._provJob !== job) return; // пока клали, пришёл новый растр — его кладёт свой вызов
      const n = Math.min(ROWS, h - y);
      this._bind("prov", gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, w, n, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, d.subarray(y * w * 2, (y + n) * w * 2));
      y += n;
      if (y < h) setTimeout(step, 0); else { this._provJob = null; this.texVer++; }
    };
    step();
  };
  Globe.prototype.setLines = function (rgba, w, h) { this._upload("lines", this.gl.RGBA, w, h, rgba, this.gl.LINEAR); };
  Globe.prototype.setMisc = function (la, w, h) { this._upload("misc", this.gl.LUMINANCE_ALPHA, w, h, la, this.gl.LINEAR); };
  Globe.prototype.setLand = function (img) {
    const gl = this.gl;
    this._bind("land", gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    this.texVer++;
  };
  Globe.prototype.setPalette = function (colors) {
    const data = new Uint8Array(256 * 4);
    for (const id in colors) {
      const c = colors[id], i = +id;
      if (!(i >= 0 && i < 256) || !/^#[0-9a-f]{6}$/i.test(c)) continue;
      data[i * 4] = parseInt(c.slice(1, 3), 16); data[i * 4 + 1] = parseInt(c.slice(3, 5), 16); data[i * 4 + 2] = parseInt(c.slice(5, 7), 16); data[i * 4 + 3] = 255;
    }
    this._upload("pal", this.gl.RGBA, 256, 1, data, this.gl.NEAREST);
  };
  // подписи стран (DOM): [{id, name, lat, lon, size}]
  Globe.prototype.setLabels = function (list) {
    this.labels = list;
    this._glKey = ""; // новые элементы подписей ещё без положения
    this.labelsEl.innerHTML = "";
    for (const l of list) {
      const el = document.createElement("div"); el.className = "g-label"; el.textContent = l.name;
      this.labelsEl.append(el); l.el = el;
    }
  };
  // звезда столицы на холсте
  function drawStar(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = "#ffd34d"; ctx.strokeStyle = "#3a2600"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.fill();
  }
  // шрифт надписей, выбранный ГМом (globe.fonts задаёт карта)
  Globe.prototype.fontOf = function (slot) { const f = this.fonts && this.fonts[slot]; return (f ? `"${f}", ` : "") + `Unbounded, "Exo 2", sans-serif`; };
  Globe.prototype.setCities = function (list) { this.cities = list; };        // [{name, lat, lon}]
  Globe.prototype.setProvLabels = function (list) { this.provLabels = list; }; // [{name, lat, lon, size}]

  Globe.prototype.radius = function () { return Math.min(this.cv.clientWidth, this.cv.clientHeight) * 0.46 * this.zoom; };
  // (lat, lon, rho в радиусах Земли) -> экранные px от центра + z (z > 0 — сторона к зрителю)
  Globe.prototype.project = function (lat, lon, rho) {
    rho = rho || 1;
    const r = this.radius() * rho, p = lat * D, l = lon * D - this.lon;
    const x = Math.cos(p) * Math.sin(l);
    const y = Math.sin(p) * Math.cos(this.lat) - Math.cos(p) * Math.sin(this.lat) * Math.cos(l);
    const z = Math.sin(p) * Math.sin(this.lat) + Math.cos(p) * Math.cos(this.lat) * Math.cos(l);
    return [x * r, -y * r, z * rho];
  };
  // точка не видна, если она за шаром
  Globe.prototype.hidden = function (pr) {
    const r = this.radius();
    return pr[2] < 0 && (pr[0] * pr[0] + pr[1] * pr[1]) < r * r;
  };
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
    const dpr = Math.min(1.5, window.devicePixelRatio || 1), now = performance.now(), R = this.radius();
    // Пока шар вращают или приближают (быстрее ~1,5 px за кадр), рисуем с пониженным разрешением на больших экранах;
    // через 0,18 с после остановки карта сама дорисовывается начисто (pending).
    const cam = this._cam;
    if (cam && R * Math.hypot(this.lat - cam[0], (this.lon - cam[1]) * Math.cos(this.lat)) + Math.abs(R - cam[2]) > 1.5) this.moveT = now;
    this._cam = [this.lat, this.lon, R];
    const area = this.cv.clientWidth * this.cv.clientHeight * dpr * dpr;
    this.q = now - this.moveT < 180 && area > 500000 ? 0.55 : 1; // при вращении — ниже разрешение, после остановки дорисовывается начисто
    const rs = dpr * this.q;
    const w = Math.round(this.cv.clientWidth * rs), h = Math.round(this.cv.clientHeight * rs);
    // Шейдер тяжёлый (полноэкранный, ~10 чтений текстур на пиксель): рисуем его, только если изменилось то, от чего он зависит.
    // Спутники и орбиты (холст поверх) от этого не зависят и перерисовываются отдельно.
    const sh = this.show;
    let sk = "";
    for (const k of SHOW_KEYS) sk += sh[k] ? "1" : "0";
    const key = w + "x" + h + "|" + this.lat + "|" + this.lon + "|" + R + "|" + this.sel + "|" + this.selProv + "|" + this.texVer + "|" + sk;
    if (key !== this._glKey) { this._drawGL(gl, w, h, rs); this._glKey = key; this._labels(); }
    this._overlay(dpr);
  };
  const SHOW_KEYS = ["ocean", "landDark", "countries", "relief", "hydro", "citiesFill", "provBorders", "borders", "coast", "road_major", "road_road", "road_secondary", "rail",
    "hl_road_major", "hl_road_road", "hl_road_secondary", "hl_rail", "hl_borders", "hl_provBorders", "labels", "hl_labels"];
  Globe.prototype._drawGL = function (gl, w, h, dpr) {
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.pr);
    const S = k => (this.show[k] ? 1 : 0);
    gl.uniform2f(this.u.uView, w, h);
    gl.uniform1f(this.u.uRad, this.radius() * dpr);
    gl.uniform2f(this.u.uRot, this.lat, this.lon);
    for (const k in this.unit) gl.uniform1i(this.u["u" + k[0].toUpperCase() + k.slice(1)], this.unit[k]);
    gl.uniform2f(this.u.uTex, this.texW || G.W, this.texH || G.H);
    gl.uniform3f(this.u.uMerc, G.R, G.X0, G.Y0);
    gl.uniform1f(this.u.uSel, this.sel || 0);
    gl.uniform1f(this.u.uSelProv, this.selProv || 0);
    gl.uniform4f(this.u.uShow1, S("ocean"), S("landDark"), S("countries"), S("relief"));
    gl.uniform4f(this.u.uShow2, S("hydro"), S("citiesFill"), S("provBorders"), S("borders"));
    gl.uniform4f(this.u.uShow3, S("coast"), S("road_major"), S("road_road"), S("road_secondary"));
    gl.uniform4f(this.u.uShow4, S("rail"), S("hl_road_major"), S("hl_road_road"), S("hl_road_secondary"));
    gl.uniform4f(this.u.uHl, S("hl_rail"), S("hl_borders"), S("hl_provBorders"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // подписи стран
  Globe.prototype._labels = function () {
    const cx = this.cv.clientWidth / 2, cy = this.cv.clientHeight / 2, k = this.radius() / 300;
    const on = !!this.show.labels;
    this.labelsEl.classList.toggle("hl", !!this.show.hl_labels);
    for (const l of this.labels) {
      const [x, y, z] = this.project(l.lat, l.lon);
      const raw = l.size * k * 0.42, fs = Math.max(7, Math.min(18, raw));
      const show = on && z > 0.25 && raw >= 6.5;
      l.el.style.display = show ? "" : "none";
      if (show) {
        l.el.style.transform = `translate(${(cx + x).toFixed(1)}px, ${(cy + y).toFixed(1)}px) translate(-50%, -50%)`;
        l.el.style.fontSize = fs.toFixed(1) + "px";
        l.el.style.opacity = Math.min(1, (z - 0.25) * 4).toFixed(2);
      }
    }
  };

  // холст поверх шара: названия провинций, города, спутники и орбиты
  let cityIcon = null;
  function getCityIcon() {
    if (cityIcon) return cityIcon;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="48" height="48"><circle r="11.2" fill="#2b2b2e" stroke="#fff" stroke-width="1.2"/><g fill="#fff"><rect x="-8" y="-0.6" width="4" height="6"/><rect x="-3.4" y="-6" width="4.6" height="11.5"/><rect x="0.1" y="-9.6" width="0.7" height="2.4"/><rect x="1.8" y="-3.2" width="4.6" height="8.7"/><rect x="6.3" y="0.8" width="1.8" height="4.7"/><rect x="-8.7" y="5.1" width="17.4" height="1.3"/></g></svg>`;
    cityIcon = new Image();
    cityIcon.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return cityIcon;
  }
  Globe.prototype._overlay = function (dpr) {
    const ov = this.ov; if (!ov) return;
    const w = Math.round(ov.clientWidth * dpr), h = Math.round(ov.clientHeight * dpr);
    if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; }
    const ctx = ov.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ov.clientWidth, ov.clientHeight);
    const cx = ov.clientWidth / 2, cy = ov.clientHeight / 2, R = this.radius();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    // названия провинций (при сильном приближении)
    if (this.show.provLabels && this.zoom >= 2.6) {
      const min = this.zoom >= 5 ? 0 : this.zoom >= 3.6 ? 3.6 : 6;
      ctx.font = `300 10px ${this.fontOf("province")}`;
      ctx.fillStyle = "rgba(240,250,255,.85)"; ctx.strokeStyle = "rgba(14,18,40,.8)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      for (const p of this.provLabels) {
        if (p.size < min) continue;
        const pr = this.project(p.lat, p.lon);
        if (pr[2] < 0.3) continue;
        const x = cx + pr[0], y = cy + pr[1];
        if (x < -50 || y < -20 || x > ov.clientWidth + 50 || y > ov.clientHeight + 20) continue;
        window.KG.lines.canvas(ctx, p.name, x, y, 10, true);
      }
    }
    // города: размер значка по типу, звезда у столиц, без подписей (название — в карточке по клику)
    for (const c of this.cities) c.screen = null;
    if (this.show.cities && this.zoom >= 1.5) {
      const icon = getCityIcon(), base = Math.min(16, 5 + this.zoom * 1.3);
      const zmax = this.zoom >= 4.5 ? 3 : this.zoom >= 3 ? 2 : this.zoom >= 2.2 ? 1 : 0;
      for (const c of this.cities) {
        if (c.hide || (c.z > zmax && !c.cap)) continue;
        const pr = this.project(c.lat, c.lon);
        if (pr[2] < 0.2) continue;
        const x = cx + pr[0], y = cy + pr[1], sz = base * (c.k || 1);
        if (x < -40 || y < -20 || x > ov.clientWidth + 40 || y > ov.clientHeight + 20) continue;
        if (c.ring) { ctx.beginPath(); ctx.arc(x, y, sz / 2 + 1.5, 0, Math.PI * 2); ctx.strokeStyle = c.ring; ctx.lineWidth = 1.6; ctx.stroke(); }
        if (icon.complete) ctx.drawImage(icon, x - sz / 2, y - sz / 2, sz, sz);
        if (c.cap) drawStar(ctx, x + sz * 0.42, y - sz * 0.42, Math.max(3.5, sz * 0.3));
        c.screen = [x, y, sz / 2 + 2];
      }
    }
    // Луна (реальный масштаб: 60 радиусов Земли — видна при сильном отдалении)
    const SM = this.sats && this.sats.moon;
    if (SM) {
      if (SM.ring) {
        ctx.strokeStyle = "rgba(220,226,240,.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 5]);
        ctx.beginPath(); let first = true;
        for (const pt of SM.ring) { const q = this.project(pt.lat, pt.lon, pt.rho); if (first) ctx.moveTo(cx + q[0], cy + q[1]); else ctx.lineTo(cx + q[0], cy + q[1]); first = false; }
        ctx.stroke(); ctx.setLineDash([]);
      }
      const q = this.project(SM.pos.lat, SM.pos.lon, SM.pos.rho);
      const rr = Math.max(5, R * 1737.4 / 6371.0088), x = cx + q[0], y = cy + q[1];
      SM.screen = this.hidden(q) ? null : [x, y, rr];
      if (SM.screen) {
        if (!this.moonImg) { this.moonImg = new Image(); this.moonImg.src = "assets/moon/moon_disc.png"; }
        ctx.shadowColor = "rgba(230,235,255,.8)"; ctx.shadowBlur = 12;
        if (this.moonImg.complete && this.moonImg.naturalWidth) ctx.drawImage(this.moonImg, x - rr, y - rr, rr * 2, rr * 2);
        else { ctx.fillStyle = "#c9ccd4"; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
        ctx.shadowBlur = 0;
        ctx.font = "400 12px Unbounded, sans-serif"; ctx.fillStyle = "#e8ecf6"; ctx.strokeStyle = "rgba(3,8,20,.9)"; ctx.lineWidth = 3;
        ctx.strokeText("Луна", x, y - rr - 10); ctx.fillText("Луна", x, y - rr - 10);
      }
    }
    // спутники и орбиты
    drawSats(this, ctx, this.sats, cx, cy);
  };
  // спутники и их орбиты (общая отрисовка для Земли и Луны): g — шар с project(lat, lon, rho), hidden(pr), zoom
  function drawSats(g, ctx, S, cx, cy) {
    // облака обломков: точки перед шаром яркие, за шаром не рисуются; в первые минуты — вспышка
    // мусор Великой ошибки рисуем с тем же шагом, с каким его посчитали (d.step); если кадр тяжёлый — просим шаг крупнее
    const t0 = performance.now();
    let stride = 1;
    if (S && S.debris) for (const d of S.debris) {
      const sz = Math.max(2, Math.min(3.4, 1.7 + g.zoom * 0.45)), xy = d.xy || (d.xy = new Float32Array(d.count * 3));
      const step = d.legacy ? Math.max(1, d.step || 1) : 1;
      if (d.legacy) stride = Math.max(stride, step);
      let m = 0;
      if (g instanceof Globe) {
        // то же, что project() и hidden(), но без массива на каждую точку (десятки тысяч точек в кадре) и с общими sin/cos вида
        const R = g.radius(), R2 = R * R, c0 = Math.cos(g.lat), s0 = Math.sin(g.lat), lon0 = g.lon, pts = d.pts;
        for (let i = 0; i < d.count; i += step) {
          const rho = pts[i * 3 + 2], p = pts[i * 3] * D, l = pts[i * 3 + 1] * D - lon0;
          const cp = Math.cos(p), sp = Math.sin(p), cl = Math.cos(l);
          const r = R * rho, sx = cp * Math.sin(l) * r, sy = -(sp * c0 - cp * s0 * cl) * r, z = (sp * s0 + cp * c0 * cl) * rho;
          if (z < 0 && sx * sx + sy * sy < R2) continue;
          xy[m * 3] = cx + sx; xy[m * 3 + 1] = cy + sy; xy[m * 3 + 2] = z > 0 ? 1 : 0; m++;
        }
      } else {
        for (let i = 0; i < d.count; i += step) {
          const pr = g.project(d.pts[i * 3], d.pts[i * 3 + 1], d.pts[i * 3 + 2]);
          if (g.hidden(pr)) continue;
          xy[m * 3] = cx + pr[0]; xy[m * 3 + 1] = cy + pr[1]; xy[m * 3 + 2] = pr[2] > 0 ? 1 : 0; m++;
        }
      }
      if (d.legacy) {
        // мусор Великой ошибки — полупрозрачная пыль без подложки (одна операция на точку)
        // точки собираются в два контура (перед шаром и за ним) и закрашиваются за два вызова — иначе холст захлёбывается
        const s2 = sz * 1.1, front = new Path2D(), back = new Path2D();
        for (let i = 0; i < m; i++) (xy[i * 3 + 2] ? front : back).rect(xy[i * 3] - s2 / 2, xy[i * 3 + 1] - s2 / 2, s2, s2);
        ctx.fillStyle = d.color;
        ctx.globalAlpha = 0.3; ctx.fill(back);
        ctx.globalAlpha = 0.95; ctx.fill(front);
        ctx.globalAlpha = 1;
        continue;
      }
      // тёмная подложка, чтобы точки читались и на светлых странах, затем сами точки
      ctx.fillStyle = "rgba(4, 6, 14, .7)";
      for (let i = 0; i < m; i++) ctx.fillRect(xy[i * 3] - sz / 2 - 1, xy[i * 3 + 1] - sz / 2 - 1, sz + 2, sz + 2);
      ctx.fillStyle = d.color;
      for (let i = 0; i < m; i++) { ctx.globalAlpha = xy[i * 3 + 2] ? 1 : 0.45; ctx.fillRect(xy[i * 3] - sz / 2, xy[i * 3 + 1] - sz / 2, sz, sz); }
      ctx.globalAlpha = 1;
      for (const f of d.flash || []) {
        const pr = g.project(f.lat, f.lon, f.rho); if (g.hidden(pr)) continue;
        const k = f.age / f.life, rr = 4 + k * 26;
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = "#fff4c2"; ctx.lineWidth = 2; ctx.shadowColor = "#ffd27a"; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(cx + pr[0], cy + pr[1], rr, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#fffbe8"; ctx.beginPath(); ctx.arc(cx + pr[0], cy + pr[1], 3 * (1 - k) + 1, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
    }
    if (S && S.debris && S.debris.length) {
      const ms = performance.now() - t0; // подстройка прореживания: держим обломки в ~10 мс кадра
      if (ms > 14 && stride < 8) S.debrisStride = stride + 1;
      else if (ms < 5 && stride > 1) S.debrisStride = stride - 1;
    }
    if (S && S.items.length) {
      ctx.lineCap = "round";
      for (const it of S.items) {
        if (!it.on || it.dead) continue; // разрушенный спутник — уже облако обломков
        const sel = S.sel === it.s.id;
        if (it.ring) {
          // кольцо орбиты: передняя часть сплошная, задняя (за шаром) — пунктир.
          // Собираем две ломаные (видимую и скрытую) и рисуем их двумя вызовами вместо сотни отдельных отрезков на спутник.
          let prev = null, lastHid = null;
          const front = new Path2D(), back = new Path2D();
          for (const pt of it.ring) {
            const pr = g.project(pt.lat, pt.lon, pt.rho);
            if (prev) {
              const hid = g.hidden(pr) || g.hidden(prev), path = hid ? back : front;
              if (hid !== lastHid) path.moveTo(cx + prev[0], cy + prev[1]);
              path.lineTo(cx + pr[0], cy + pr[1]);
              lastHid = hid;
            }
            prev = pr;
          }
          ctx.strokeStyle = it.s.color; ctx.lineWidth = sel ? 2.2 : 1.3;
          ctx.globalAlpha = 0.25; ctx.setLineDash([2, 5]); ctx.stroke(back);
          ctx.globalAlpha = sel ? 0.95 : 0.55; ctx.setLineDash([]); ctx.stroke(front);
          ctx.globalAlpha = 1;
        }
        const pr = g.project(it.pos.lat, it.pos.lon, it.pos.rho);
        const hid = g.hidden(pr);
        const x = cx + pr[0], y = cy + pr[1];
        it.screen = hid ? null : [x, y];
        if (hid) continue;
        // линия «вниз» к подспутниковой точке
        const ground = g.project(it.pos.lat, it.pos.lon, 1);
        if (ground[2] > 0) {
          ctx.globalAlpha = 0.35; ctx.strokeStyle = it.s.color; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + ground[0], cy + ground[1]); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        ctx.shadowColor = it.s.color; ctx.shadowBlur = sel ? 14 : 8;
        ctx.fillStyle = it.s.color;
        const k = sel ? 1.35 : 1;
        ctx.beginPath();
        switch (it.s.shape) {
          case "station": // корпус и солнечные панели
            ctx.fillRect(x - 3 * k, y - 2 * k, 6 * k, 4 * k);
            ctx.fillRect(x - 10 * k, y - k, 6 * k, 2 * k); ctx.fillRect(x + 4 * k, y - k, 6 * k, 2 * k);
            ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(x - 1, y - 1, 2, 2);
            break;
          case "diamond":
            ctx.moveTo(x, y - 5 * k); ctx.lineTo(x + 4 * k, y); ctx.lineTo(x, y + 5 * k); ctx.lineTo(x - 4 * k, y); ctx.closePath(); ctx.fill(); break;
          case "triangle":
            ctx.moveTo(x, y - 5 * k); ctx.lineTo(x + 4.5 * k, y + 3.5 * k); ctx.lineTo(x - 4.5 * k, y + 3.5 * k); ctx.closePath(); ctx.fill(); break;
          case "square":
            ctx.fillRect(x - 3.5 * k, y - 3.5 * k, 7 * k, 7 * k); break;
          case "star": // пятиконечная звезда
            for (let j = 0; j < 10; j++) {
              const rr = (j % 2 ? 2.4 : 6) * k, an = -Math.PI / 2 + j * Math.PI / 5;
              if (j) ctx.lineTo(x + rr * Math.cos(an), y + rr * Math.sin(an)); else ctx.moveTo(x + rr * Math.cos(an), y + rr * Math.sin(an));
            }
            ctx.closePath(); ctx.fill(); break;
          case "cross":
            ctx.fillRect(x - 5 * k, y - 1.4 * k, 10 * k, 2.8 * k); ctx.fillRect(x - 1.4 * k, y - 5 * k, 2.8 * k, 10 * k); break;
          default:
            ctx.arc(x, y, 3.4 * k, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;
        if ((S.names && g.zoom > 0.12) || sel) {
          ctx.font = `${sel ? 400 : 300} ${sel ? 12 : 10}px Unbounded, "Exo 2", sans-serif`;
          ctx.fillStyle = it.s.color; ctx.strokeStyle = "rgba(3,8,20,.9)"; ctx.lineWidth = 3;
          ctx.strokeText(it.s.name, x, y - 11); ctx.fillText(it.s.name, x, y - 11);
        }
      }
    }
  }
  Globe.drawSats = drawSats;
  window.KGGlobe = Globe;
})();
