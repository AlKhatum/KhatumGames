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
    vec4 misc = texture2D(uMisc, uv);
    if (uShow2.x > 0.5) col = mix(col, vec3(0.24, 0.30, 0.50), misc.r * 0.85);   // реки и озёра
    if (uShow2.y > 0.5) col = mix(col, vec3(0.95, 0.85, 0.65), misc.a * 0.35);   // городские зоны
    vec4 ln = texture2D(uLines, uv);
    col = roadMix(col, ln.r, uShow3.y, uShow4.y, vec3(1.0, 0.25, 0.82));
    col = roadMix(col, ln.b, uShow3.z, uShow4.z, vec3(1.0, 0.88, 0.30));
    col = roadMix(col, ln.g, uShow3.w, uShow4.w, vec3(0.10, 0.90, 1.0));
    col = roadMix(col, ln.a, uShow4.x, uHl.x, vec3(1.0, 0.60, 0.24));
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
    // пустые текстуры, пока данные не загружены
    for (const k of ["prov", "lines", "misc"]) this._upload(k, gl.LUMINANCE_ALPHA, 1, 1, new Uint8Array(2), gl.NEAREST);
    this.lat = 30 * D; this.lon = 40 * D; this.zoom = 1; this.sel = 0; this.selProv = 0;
    this.show = {}; this.labels = []; this.cities = []; this.provLabels = []; this.sats = null;
  }
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
  };
  Globe.prototype.setIds = function (ids, w, h) { this._upload("ids", this.gl.LUMINANCE, w, h, ids, this.gl.NEAREST); this.texW = w; this.texH = h; };
  // провинции: 16-битные id -> LUMINANCE_ALPHA (младший, старший байт)
  Globe.prototype.setProv = function (ids, w, h) {
    const d = new Uint8Array(w * h * 2);
    for (let i = 0; i < ids.length; i++) { const v = ids[i]; d[i * 2] = v & 255; d[i * 2 + 1] = v >> 8; }
    this._upload("prov", this.gl.LUMINANCE_ALPHA, w, h, d, this.gl.NEAREST);
  };
  Globe.prototype.setLines = function (rgba, w, h) { this._upload("lines", this.gl.RGBA, w, h, rgba, this.gl.LINEAR); };
  Globe.prototype.setMisc = function (la, w, h) { this._upload("misc", this.gl.LUMINANCE_ALPHA, w, h, la, this.gl.LINEAR); };
  Globe.prototype.setLand = function (img) {
    const gl = this.gl;
    this._bind("land", gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
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
    this.labelsEl.innerHTML = "";
    for (const l of list) {
      const el = document.createElement("div"); el.className = "g-label"; el.textContent = l.name;
      this.labelsEl.append(el); l.el = el;
    }
  };
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.cv.clientWidth * dpr), h = Math.round(this.cv.clientHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
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
    this._labels();
    this._overlay(dpr);
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
      ctx.font = `300 10px Unbounded, "Exo 2", sans-serif`;
      ctx.fillStyle = "rgba(240,250,255,.85)"; ctx.strokeStyle = "rgba(14,18,40,.8)"; ctx.lineWidth = 3; ctx.lineJoin = "round";
      for (const p of this.provLabels) {
        if (p.size < min) continue;
        const pr = this.project(p.lat, p.lon);
        if (pr[2] < 0.3) continue;
        const x = cx + pr[0], y = cy + pr[1];
        if (x < -50 || y < -20 || x > ov.clientWidth + 50 || y > ov.clientHeight + 20) continue;
        ctx.strokeText(p.name, x, y); ctx.fillText(p.name, x, y);
      }
    }
    // города
    if (this.show.cities && this.zoom >= 2.2) {
      const icon = getCityIcon(), sz = Math.min(18, 6 + this.zoom * 1.4);
      ctx.font = `300 ${Math.min(12, 6 + this.zoom).toFixed(0)}px Unbounded, "Exo 2", sans-serif`;
      ctx.textAlign = "left";
      ctx.fillStyle = "#f5f2ff"; ctx.strokeStyle = "rgba(14,10,30,.85)"; ctx.lineWidth = 3;
      for (const c of this.cities) {
        const pr = this.project(c.lat, c.lon);
        if (pr[2] < 0.2) continue;
        const x = cx + pr[0], y = cy + pr[1];
        if (x < -40 || y < -20 || x > ov.clientWidth + 40 || y > ov.clientHeight + 20) continue;
        if (icon.complete) ctx.drawImage(icon, x - sz / 2, y - sz / 2, sz, sz);
        if (c.name && this.zoom >= 3) { ctx.strokeText(c.name, x + sz / 2 + 2, y); ctx.fillText(c.name, x + sz / 2 + 2, y); }
      }
      ctx.textAlign = "center";
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
    const S = this.sats;
    if (S && S.items.length) {
      ctx.lineCap = "round";
      for (const it of S.items) {
        if (!it.on) continue;
        const sel = S.sel === it.s.id;
        if (S.orbits && it.ring) {
          // кольцо орбиты: передняя часть сплошная, задняя (за шаром) — пунктир
          let prev = null;
          for (const pt of it.ring) {
            const pr = this.project(pt.lat, pt.lon, pt.rho);
            if (prev) {
              const hid = this.hidden(pr) || this.hidden(prev);
              ctx.beginPath();
              ctx.setLineDash(hid ? [2, 5] : []);
              ctx.strokeStyle = it.s.color;
              ctx.globalAlpha = hid ? 0.25 : sel ? 0.95 : 0.55;
              ctx.lineWidth = sel ? 2.2 : 1.3;
              ctx.moveTo(cx + prev[0], cy + prev[1]); ctx.lineTo(cx + pr[0], cy + pr[1]);
              ctx.stroke();
            }
            prev = pr;
          }
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        const pr = this.project(it.pos.lat, it.pos.lon, it.pos.rho);
        const hid = this.hidden(pr);
        const x = cx + pr[0], y = cy + pr[1];
        it.screen = hid ? null : [x, y];
        if (hid) continue;
        // линия «вниз» к подспутниковой точке
        const ground = this.project(it.pos.lat, it.pos.lon, 1);
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
          default:
            ctx.arc(x, y, 3.4 * k, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;
        if ((S.names && this.zoom > 0.12) || sel) {
          ctx.font = `${sel ? 400 : 300} ${sel ? 12 : 10}px Unbounded, "Exo 2", sans-serif`;
          ctx.fillStyle = it.s.color; ctx.strokeStyle = "rgba(3,8,20,.9)"; ctx.lineWidth = 3;
          ctx.strokeText(it.s.name, x, y - 11); ctx.fillText(it.s.name, x, y - 11);
        }
      }
    }
  };
  window.KGGlobe = Globe;
})();
