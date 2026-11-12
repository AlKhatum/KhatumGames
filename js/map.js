// Карта мира после Великого Потопа.
// Просмотр — для всех (слои и легенда). Редактирование — только ГМ после входа по паролю:
// кисть / карандаш / ластик / заливка по растру территорий, города, подписи, отметки, названия в легенде,
// публикация правок прямо в репозиторий GitHub.
(function () {
  "use strict";
  const W = 4087, H = 3554, NS = "http://www.w3.org/2000/svg";
  const UI_KEY = "kg-map-ui-v2", GM_KEY = "kg-gm-session";
  const $ = id => document.getElementById(id);
  const { toast, ask } = window.KG;
  const T = window.KGTerritory, P = window.KGProvinces, GH = window.KGGitHub;
  const viewport = $("viewport"), world = $("world"), frame = $("mapFrame");
  const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- слои ----------
  // road — цвет подсветки растровых линий; glow — цвет подсветки векторного слоя
  const LAYERS = [
    { id: "ocean", name: "Океан", kind: "div", cls: "ocean", vis: true },
    { id: "landDark", name: "Суша вне стран", kind: "img", src: "assets/map/land.png", cls: "land-dark", vis: true },
    { id: "countries", name: "Заливка стран", kind: "svg", vis: true },
    { id: "relief", name: "Рельеф", kind: "img", src: "assets/map/land.png", cls: "relief", vis: true },
    { id: "hydro", name: "Гидрография", kind: "img", src: "assets/map/hydro.png", cls: "hydro", vis: true },
    { group: "roads", name: "Дороги", children: [
      { id: "road_major", name: "Главные автострады", kind: "img", src: "assets/map/road_major.png", vis: true, road: "#ff3fd0" },
      { id: "road_road", name: "Основные магистрали", kind: "img", src: "assets/map/road_road.png", vis: false, road: "#ffe14d" },
      { id: "road_secondary", name: "Второстепенные дороги", kind: "img", src: "assets/map/road_secondary.png", vis: true, road: "#19e6ff" },
      { id: "rail", name: "Железные дороги", kind: "img", src: "assets/map/rail.png", vis: false, road: "#ff9b3d" }
    ] },
    { id: "citiesFill", name: "Городские зоны", kind: "img", src: "assets/map/cities_fill.png", vis: true, opacity: 0.45 },
    { id: "provBorders", name: "Провинции", kind: "svg", vis: true, glow: "#7fe8ff" },
    { id: "borders", name: "Границы стран", kind: "svg", vis: true, glow: "#ff3fd0" },
    { id: "coast", name: "Береговая линия", kind: "svg", vis: true },
    { id: "paint", kind: "canvas", internal: true },
    { id: "labels", name: "Страны", kind: "svg", vis: true, glow: "#ff7fd8" },
    { id: "provLabels", name: "Названия провинций", kind: "svg", vis: true },
    { id: "cities", name: "Города", kind: "svg", vis: true },
    { id: "measure", kind: "svg", internal: true },
    { id: "over", kind: "svg", internal: true }
  ];
  const L = {};
  const flat = [];
  LAYERS.forEach(l => (l.group ? l.children.forEach(c => flat.push(Object.assign(c, { parent: l.group }))) : flat.push(l)));
  let ui = { vis: {}, hl: {} };
  try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch (e) { /* */ }
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* */ } };

  flat.forEach(l => {
    let el;
    if (l.kind === "img") {
      el = document.createElement("img"); el.src = l.src; el.alt = ""; el.draggable = false; el.decoding = "async";
    } else if (l.kind === "div") {
      el = document.createElement("div");
    } else if (l.kind === "canvas") {
      el = document.createElement("canvas"); el.width = W; el.height = H;
    } else {
      el = document.createElementNS(NS, "svg");
      el.setAttribute("viewBox", `0 0 ${W} ${H}`); el.setAttribute("width", W); el.setAttribute("height", H);
    }
    el.id = l.id + "Layer";
    el.classList.add("layer");
    if (l.cls) el.classList.add(l.cls);
    if (l.road) el.classList.add("road");
    if (l.opacity != null) el.style.opacity = l.opacity;
    world.appendChild(el);
    L[l.id] = el;
  });
  const paintCtx = L.paint.getContext("2d", { willReadFrequently: true });

  const isVisible = l => (ui.vis[l.id] != null ? ui.vis[l.id] : l.vis);
  function applyLayer(l) {
    const el = L[l.id]; if (!el || l.internal) return;
    try { if (globe) globeDirty(); } catch (e) { /* глобус ещё не создан */ }
    el.style.display = isVisible(l) ? "" : "none";
    if (l.road) {
      const on = !!ui.hl[l.id];
      el.classList.toggle("hl", on);
      el.style.filter = on ? `brightness(0) invert(1) drop-shadow(0 0 .6px ${l.road}) drop-shadow(0 0 1.4px ${l.road}) drop-shadow(0 0 3px ${l.road})` : "";
    }
    if (l.glow) {
      el.classList.toggle("hl", !!ui.hl[l.id]);
      el.style.setProperty("--glow", l.glow);
    }
  }
  function buildLayerList() {
    const list = $("layerList"); list.innerHTML = "";
    const row = (l, sub) => {
      const r = document.createElement("label"); r.className = "layer-row" + (sub ? " sub" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = isVisible(l);
      cb.addEventListener("change", () => { ui.vis[l.id] = cb.checked; applyLayer(l); saveUi(); syncGroups(); });
      r.append(cb);
      const hlc = l.road || l.glow;
      if (hlc) { const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = hlc; r.append(sw); }
      const nm = document.createElement("span"); nm.className = "lname"; nm.textContent = l.name; r.append(nm);
      if (hlc) {
        const b = document.createElement("button"); b.type = "button"; b.className = "hl-btn" + (ui.hl[l.id] ? " on" : ""); b.textContent = "Подсветка";
        b.style.setProperty("--hl", hlc); b.title = "Сделать слой видимым и подсветить";
        b.addEventListener("click", e => {
          e.preventDefault();
          ui.hl[l.id] = !ui.hl[l.id];
          if (ui.hl[l.id]) { ui.vis[l.id] = true; cb.checked = true; }
          b.classList.toggle("on", !!ui.hl[l.id]); applyLayer(l); saveUi(); syncGroups();
        });
        l._hl = b; r.append(b);
      }
      l._cb = cb;
      return r;
    };
    [...LAYERS].reverse().forEach(l => {
      if (l.internal) return;
      if (!l.group) { list.append(row(l)); return; }
      const g = document.createElement("div"); g.className = "layer-row group";
      const cb = document.createElement("input"); cb.type = "checkbox";
      const nm = document.createElement("span"); nm.className = "lname"; nm.textContent = l.name;
      const hb = document.createElement("button"); hb.type = "button"; hb.className = "hl-btn"; hb.textContent = "Подсветить все";
      cb.addEventListener("change", () => { l.children.forEach(c => { ui.vis[c.id] = cb.checked; c._cb.checked = cb.checked; applyLayer(c); }); saveUi(); syncGroups(); });
      nm.addEventListener("click", () => cb.click());
      hb.addEventListener("click", () => {
        const all = l.children.every(c => ui.hl[c.id]);
        l.children.forEach(c => { ui.hl[c.id] = !all; if (!all) { ui.vis[c.id] = true; c._cb.checked = true; } c._hl.classList.toggle("on", !all); applyLayer(c); });
        saveUi(); syncGroups();
      });
      l._cb = cb; l._hb = hb;
      g.append(cb, nm, hb); list.append(g);
      l.children.slice().reverse().forEach(c => list.append(row(c, true)));
    });
    syncGroups();
  }
  function syncGroups() {
    LAYERS.filter(l => l.group).forEach(l => {
      const v = l.children.map(isVisible);
      l._cb.checked = v.every(Boolean); l._cb.indeterminate = !l._cb.checked && v.some(Boolean);
      const all = l.children.every(c => ui.hl[c.id]);
      l._hb.classList.toggle("on", all); l._hb.textContent = all ? "Снять подсветку" : "Подсветить все";
    });
  }
  flat.forEach(applyLayer);
  buildLayerList();

  // ---------- SVG-хелперы и группы ----------
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  // значок города (по образцу «ЗНАЧОК ГОРОДА»: тёмный круг и белый силуэт кварталов)
  L.cities.innerHTML = `<defs><symbol id="cityIcon" viewBox="-12 -12 24 24">
    <circle r="11.2" fill="#2b2b2e" stroke="rgba(255,255,255,.9)" stroke-width="1.2"/>
    <g fill="#fff">
      <rect x="-8" y="-0.6" width="4" height="6"/><path d="M-7.7-.6-6-2.4-4.3-.6Z"/>
      <rect x="-3.4" y="-6" width="4.6" height="11.5"/><rect x="-2.6" y="-7.4" width="2.8" height="1.5"/><rect x="0.1" y="-9.6" width="0.7" height="2.4"/>
      <rect x="1.8" y="-3.2" width="4.6" height="8.7"/><rect x="2.6" y="-4.3" width="2.8" height="1.2"/>
      <rect x="6.3" y="0.8" width="1.8" height="4.7"/>
      <rect x="-8.7" y="5.1" width="17.4" height="1.3"/>
    </g>
    <g fill="#2b2b2e">
      <rect x="-2.5" y="-4.6" width="0.9" height="2.7"/><rect x="-0.9" y="-1" width="1.6" height="0.6"/><rect x="-0.9" y="0.5" width="1.6" height="0.6"/><rect x="-0.9" y="2" width="1.6" height="0.6"/>
      <rect x="4.9" y="-1.8" width="0.7" height="0.7"/><rect x="4.9" y="-0.4" width="0.7" height="0.7"/><rect x="4.9" y="1" width="0.7" height="0.7"/><rect x="4.9" y="2.4" width="0.7" height="0.7"/>
      <rect x="-7" y="1" width="0.8" height="1.5"/><rect x="-5.6" y="2.7" width="1" height="0.6"/>
    </g></symbol></defs>`;
  // градиент для названий стран — светлый, чтобы не сливаться с тёмными границами
  L.labels.insertAdjacentHTML("afterbegin", `<defs><linearGradient id="lblGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff4fd"/><stop offset=".5" stop-color="#ffc3ef"/><stop offset="1" stop-color="#ff74d4"/></linearGradient></defs>`);
  const gCountryLabels = svgEl("g", {}, L.labels);
  const gCustom = svgEl("g", {}, L.labels);
  const coastPath = svgEl("path", { class: "coast-line" }, L.coast);
  const provSelPath = svgEl("path", { class: "prov-sel-outline" }, L.over);
  const selPath = svgEl("path", { class: "sel-outline" }, L.over);
  const cursorEl = svgEl("circle", { class: "brush-cursor", r: 10, cx: -100, cy: -100 }, L.over);

  // ---------- состояние ----------
  let config = null, state = null, loadedStamp = "";
  let gm = false, dirty = false, terrDirty = false, provDirty = false, selProv = null;
  const provPaths = new Map(), provEls = {}, provLbl = {};
  function setProvPath(id, d) {
    id = String(id); provPaths.set(id, d || "");
    let e = provEls[id];
    if (!e) { e = svgEl("path", {}, L.provBorders); provEls[id] = e; }
    e.setAttribute("d", d || "");
    if (selProv === id) provSelPath.setAttribute("d", d || "");
  }
  const els = { cfill: {}, cborder: {}, clabel: {}, cities: {}, labels: {} };
  const paths = new Map(); // id страны -> d
  const flagCache = {};   // id -> dataURL (флаги, загруженные в этой сессии)

  function setCountryPath(id, d) {
    id = String(id);
    paths.set(id, d || "");
    let f = els.cfill[id], b = els.cborder[id];
    if (!f) { f = svgEl("path", { "data-col": "countries", "data-id": id }, L.countries); els.cfill[id] = f; }
    if (!b) { b = svgEl("path", {}, L.borders); els.cborder[id] = b; }
    f.setAttribute("d", d || ""); b.setAttribute("d", d || "");
    if (sel && sel.col === "countries" && sel.id === id) selPath.setAttribute("d", d || "");
  }
  function renderCountry(id) {
    const c = state.countries[id];
    let t = els.clabel[id];
    if (!c) {
      [els.cfill, els.cborder, els.clabel].forEach(m => { if (m[id]) { m[id].remove(); delete m[id]; } });
      paths.delete(id); return;
    }
    if (!els.cfill[id]) setCountryPath(id, paths.get(id) || "");
    els.cfill[id].setAttribute("fill", c.color);
    if (!t) { t = svgEl("text", { class: "lbl-country", "data-col": "countries", "data-id": id, "data-part": "label" }, gCountryLabels); els.clabel[id] = t; }
    t.setAttribute("x", c.label[0]); t.setAttribute("y", c.label[1]);
    t.setAttribute("font-size", c.size); t.setAttribute("letter-spacing", (c.size * 0.22).toFixed(1));
    t.setAttribute("stroke-width", Math.max(0.8, c.size * 0.14).toFixed(1));
    t.textContent = c.name;
  }
  function cityText(c) {
    // подпись не должна налезать на крупный значок: отодвигаем от центра
    let dx = c.dx, dy = c.dy;
    if (c.a === "start") dx = Math.max(dx, 5.2);
    else if (c.a === "end") dx = Math.min(dx, -5.2);
    else dy = dy < 0 ? Math.min(dy, -6.5) : Math.max(dy, 7.5);
    return { dx, dy };
  }
  function renderCity(id) {
    const c = state.cities[id];
    let g = els.cities[id];
    if (!c) { if (g) { g.remove(); delete els.cities[id]; } return; }
    if (!g) {
      g = svgEl("g", { class: "city", "data-col": "cities", "data-id": id }, L.cities);
      svgEl("use", { href: "#cityIcon", x: -3.6, y: -3.6, width: 7.2, height: 7.2, "data-col": "cities", "data-id": id, "data-part": "icon" }, g);
      svgEl("text", { "data-col": "cities", "data-id": id, "data-part": "text" }, g);
      els.cities[id] = g;
    }
    g.setAttribute("transform", `translate(${c.x} ${c.y})`);
    const tx = g.lastChild, o = cityText(c);
    tx.setAttribute("x", o.dx); tx.setAttribute("y", o.dy);
    tx.setAttribute("text-anchor", c.a === "end" ? "end" : c.a === "middle" ? "middle" : "start");
    tx.textContent = c.name;
  }
  function renderLabel(id) {
    const e = state.labels[id];
    let t = els.labels[id];
    if (!e) { if (t) { t.remove(); delete els.labels[id]; } return; }
    if (!t) { t = svgEl("text", { class: "lbl-custom", "data-col": "labels", "data-id": id }, gCustom); els.labels[id] = t; }
    t.setAttribute("x", e.x); t.setAttribute("y", e.y); t.setAttribute("font-size", e.size);
    t.setAttribute("letter-spacing", (e.size * 0.15).toFixed(1));
    t.textContent = e.text;
  }
  function renderProvince(id) {
    const e = state.provinces[id];
    let t = provLbl[id];
    if (!e) {
      if (t) { t.remove(); delete provLbl[id]; }
      if (provEls[id]) { provEls[id].remove(); delete provEls[id]; provPaths.delete(id); }
      return;
    }
    if (!t) { t = svgEl("text", { "data-col": "provinces", "data-id": id }, L.provLabels); provLbl[id] = t; }
    t.setAttribute("class", "lbl-prov " + (e.size >= 6 ? "b1" : e.size >= 3.6 ? "b2" : "b3"));
    t.setAttribute("x", e.label[0]); t.setAttribute("y", e.label[1]); t.style.setProperty("--fs", e.size + "px");
    t.textContent = e.name;
  }
  const RENDER = { countries: renderCountry, cities: renderCity, labels: renderLabel, provinces: renderProvince };
  const COLS = ["countries", "cities", "labels", "provinces"];

  // ---------- вид ----------
  let s = 0.3, tx = 0, ty = 0, fitS = 0.3;
  function setView(ns, ntx, nty) {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    s = Math.min(8, Math.max(fitS * 0.7, ns));
    const mw = W * s, mh = H * s;
    tx = mw < vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, ntx));
    ty = mh < vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, nty));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    L.cities.style.visibility = s < 0.85 ? "hidden" : "";
    frame.dataset.z = s >= 3.2 ? 3 : s >= 1.9 ? 2 : s >= 1.1 ? 1 : 0;
    frame.style.setProperty("--pk", Math.min(1, 2.4 / s).toFixed(3)); // названия провинций не раздуваются при приближении
    if (typeof renderMeasure === "function") renderMeasure();
    frame.style.setProperty("--s", s);
  }
  function fit() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!vw || !vh) return;
    fitS = Math.min(vw / W, vh / H);
    setView(fitS, (vw - W * fitS) / 2, (vh - H * fitS) / 2);
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(8, Math.max(fitS * 0.7, s * f)), k = ns / s;
    setView(ns, cx - (cx - tx) * k, cy - (cy - ty) * k);
  }
  function centerOn(x, y, minS) {
    const ns = Math.max(s, minS || 0);
    setView(ns, viewport.clientWidth / 2 - x * ns, viewport.clientHeight / 2 - y * ns);
  }
  function toMap(e) {
    const r = viewport.getBoundingClientRect();
    return [(e.clientX - r.left - tx) / s, (e.clientY - r.top - ty) / s];
  }
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("zoomIn").onclick = () => (viewMode === "globe" ? globeZoom(1.4) : zoomAt(1.4, viewport.clientWidth / 2, viewport.clientHeight / 2));
  $("zoomOut").onclick = () => (viewMode === "globe" ? globeZoom(1 / 1.4) : zoomAt(1 / 1.4, viewport.clientWidth / 2, viewport.clientHeight / 2));
  $("zoomFit").onclick = () => (viewMode === "globe" ? globeZoom(0) : fit());
  window.addEventListener("resize", () => { const was = Math.abs(s - fitS) < 1e-6; const vw = viewport.clientWidth, vh = viewport.clientHeight; fitS = Math.min(vw / W, vh / H); if (was) fit(); else setView(s, tx, ty); });
  window.addEventListener("tabchange", e => { if (e.detail === "map") requestAnimationFrame(fit); });

  // ---------- выбор и легенда ----------
  let sel = null;
  function select(ent) {
    document.querySelectorAll(".is-sel").forEach(el => el.classList.remove("is-sel"));
    sel = ent && state[ent.col] && state[ent.col][ent.id] ? { col: ent.col, id: String(ent.id) } : null;
    if (sel) {
      const map = { cities: els.cities, labels: els.labels, countries: els.clabel }[sel.col];
      if (map && map[sel.id]) map[sel.id].classList.add("is-sel");
    }
    selPath.setAttribute("d", sel && sel.col === "countries" ? paths.get(sel.id) || "" : "");
    provSelPath.setAttribute("d", selProv ? provPaths.get(selProv) || "" : "");
    try { if (globe) globeDirty(); } catch (e) { /* */ }
    updateCard();
    markListSelection();
  }
  const nameInp = $("countryName"), colorInp = $("countryColor");
  function flagSrc(c) { return flagCache[c.id] || c.flag || ""; }
  function updateCard() {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    $("countryTitle").textContent = c ? c.name : "Выберите страну на карте";
    nameInp.disabled = colorInp.disabled = !c;
    $("flagClear").disabled = !(c && (c.flag || flagCache[c.id]));
    if (document.activeElement !== nameInp) nameInp.value = c ? c.name : "";
    colorInp.value = c ? c.color : "#888888";
    const fi = $("flagImg"), src = c ? flagSrc(c) : "";
    if (src) { fi.src = src; fi.hidden = false; $("flagPh").hidden = true; }
    else { fi.hidden = true; fi.removeAttribute("src"); $("flagPh").hidden = false; }
    let meta = "";
    if (c) {
      const n = Object.values(state.cities).filter(ct => String(T.at(ct.x, ct.y)) === c.id).length;
      meta = (n ? "Городов: " + n : "Без городов") + (gm && c.layer ? " · слой PSD: " + c.layer : "");
    }
    $("countryMeta").textContent = meta;
    const pr = selProv ? state.provinces[selProv] : null;
    $("provBlock").classList.toggle("hidden", !pr);
    if (pr) {
      $("provTitle").textContent = pr.name;
      if (document.activeElement !== $("provName")) $("provName").value = pr.name;
      $("provMeta").textContent = [pr.type, gm && pr.real ? "в нашем мире: " + pr.real : ""].filter(Boolean).join(" · ");
    }
    $("flagBox").classList.toggle("can-edit", gm && !!c);
  }
  let nameBefore = null;
  nameInp.addEventListener("focus", () => { if (sel) nameBefore = clone(state.countries[sel.id]); });
  nameInp.addEventListener("input", () => { if (!sel || !gm) return; state.countries[sel.id].name = nameInp.value; renderCountry(sel.id); $("countryTitle").textContent = nameInp.value; });
  nameInp.addEventListener("change", () => {
    if (!sel || !nameBefore) return;
    const after = clone(state.countries[sel.id]); after.name = nameInp.value.trim() || nameBefore.name;
    if (after.name !== nameBefore.name) commit("countries", sel.id, nameBefore, after); else renderCountry(sel.id);
    nameBefore = clone(state.countries[sel.id]);
  });
  nameInp.addEventListener("keydown", e => { if (e.key === "Enter") nameInp.blur(); e.stopPropagation(); });
  colorInp.addEventListener("change", () => { if (!sel || !gm) return; const b = state.countries[sel.id], a = clone(b); a.color = colorInp.value; commit("countries", sel.id, b, a); });
  $("flagBox").addEventListener("click", e => { if (!gm || !sel || sel.col !== "countries") e.preventDefault(); });
  $("flagInput").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !gm || !sel || sel.col !== "countries") return;
    const id = sel.id, rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 300 / img.width, 200 / img.height);
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        const b = state.countries[id], a = clone(b); a.flag = cv.toDataURL("image/png");
        commit("countries", id, b, a); toast("Флаг установлен (опубликуйте, чтобы его увидели все)");
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  });
  $("flagClear").addEventListener("click", () => { if (!sel || !gm) return; delete flagCache[sel.id]; const b = state.countries[sel.id], a = clone(b); a.flag = null; commit("countries", sel.id, b, a); });

  // вкладки легенды
  document.querySelectorAll(".legend-tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".legend-tabs button").forEach(x => x.classList.toggle("active", x === b));
    $("paneCountries").classList.toggle("hidden", b.dataset.ltab !== "countries");
    $("paneLayers").classList.toggle("hidden", b.dataset.ltab !== "layers");
  }));
  // список стран
  function buildCountryList() {
    const list = $("countryList"), q = $("countrySearch").value.trim().toLowerCase();
    list.innerHTML = "";
    const items = Object.values(state.countries).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    for (const c of items) {
      if (q && !c.name.toLowerCase().includes(q)) continue;
      const r = document.createElement("div"); r.className = "c-row"; r.dataset.id = c.id;
      const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = c.color;
      r.append(sw);
      if (gm) {
        const inp = document.createElement("input"); inp.type = "text"; inp.value = c.name; inp.className = "c-name-input"; inp.title = "Название (Enter — сохранить)";
        let before = null;
        inp.addEventListener("focus", () => { before = clone(state.countries[c.id]); select({ col: "countries", id: c.id }); });
        inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); e.stopPropagation(); });
        inp.addEventListener("change", () => {
          const v = inp.value.trim();
          if (!before || !v || v === before.name) { inp.value = state.countries[c.id].name; return; }
          const a = clone(before); a.name = v; commit("countries", c.id, before, a);
        });
        r.append(inp);
        const go = document.createElement("button"); go.className = "c-go"; go.title = "Показать на карте"; go.textContent = "⌖";
        go.addEventListener("click", () => focusCountry(c.id));
        const del = document.createElement("button"); del.className = "c-del"; del.title = "Удалить страну"; del.textContent = "✕";
        del.addEventListener("click", () => deleteCountry(c.id));
        r.append(go, del);
      } else {
        const nm = document.createElement("span"); nm.className = "c-name"; nm.textContent = c.name;
        r.append(nm);
        r.addEventListener("click", () => focusCountry(c.id));
      }
      list.append(r);
    }
    markListSelection();
  }
  function markListSelection() {
    document.querySelectorAll("#countryList .c-row").forEach(r => r.classList.toggle("active", !!sel && sel.col === "countries" && r.dataset.id === sel.id));
  }
  function focusCountry(id) {
    const c = state.countries[id]; if (!c) return;
    select({ col: "countries", id });
    centerOn(c.label[0], c.label[1], Math.max(fitS * 1.6, 0.5));
  }
  $("countrySearch").addEventListener("input", buildCountryList);
  $("countrySearch").addEventListener("keydown", e => e.stopPropagation());

  // ---------- история и изменения ----------
  const undoStack = [], redoStack = [];
  function setEntity(col, id, val) {
    if (val == null) delete state[col][id]; else state[col][id] = val;
    RENDER[col](id);
    if (sel && sel.col === col && sel.id === id) { if (val == null) select(null); else { select(sel); } }
    if (col === "countries") { buildCountryList(); fillBrushSelect(); if (globe && viewMode === "globe") syncGlobe(false); }
  }
  function commit(col, id, before, after) {
    pushUndo({ kind: "entity", col, id: String(id), before: clone(before), after: clone(after) });
    setEntity(col, String(id), clone(after));
  }
  function pushUndo(entry) { undoStack.push(entry); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; updUndo(); markDirty(entry); }
  function applyEntry(entry, back) {
    if (entry.kind === "entity") setEntity(entry.col, entry.id, clone(back ? entry.before : entry.after));
    else if (entry.kind === "paint") { (entry.stroke.wide ? P : T).apply(entry.stroke, back); recomputeAny(entry.stroke); }
    else if (entry.kind === "multi") (back ? entry.items.slice().reverse() : entry.items).forEach(it => applyEntry(it, back));
  }
  function undo() { const e = undoStack.pop(); if (!e) return; redoStack.push(e); applyEntry(e, true); updUndo(); markDirty(e); }
  function redo() { const e = redoStack.pop(); if (!e) return; undoStack.push(e); applyEntry(e, false); updUndo(); markDirty(e); }
  function updUndo() { $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length; }
  const touchesPaint = e => e.kind === "paint" || (e.kind === "multi" && e.items.some(touchesPaint));
  function markDirty(entry) {
    dirty = true;
    const mark = e => { if (e.kind === "paint") { if (e.stroke.wide) provDirty = true; else terrDirty = true; } else if (e.kind === "multi") e.items.forEach(mark); };
    if (entry) mark(entry);
    $("gmDirty").classList.remove("hidden");
    scheduleDraft();
  }
  function recomputeAny(stroke) {
    if (!stroke.wide) { recompute(stroke.labels); return; }
    const res = P.pathsFor(stroke.labels);
    for (const [Lb, d] of res) if (state.provinces[String(Lb)]) setProvPath(Lb, d);
  }
  function recompute(labels) {
    const res = T.pathsFor(labels);
    for (const [Lb, d] of res) if (state.countries[String(Lb)]) setCountryPath(Lb, d);
  }

  // ---------- черновик ГМа (IndexedDB) ----------
  const DB = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("kg-map", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async op(mode, fn) {
      const db = await DB.open();
      return new Promise((res, rej) => {
        const tx = db.transaction("kv", mode), st = tx.objectStore("kv"), rq = fn(st);
        tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error);
      });
    },
    get: k => DB.op("readonly", st => st.get(k)),
    set: (k, v) => DB.op("readwrite", st => st.put(v, k)),
    del: k => DB.op("readwrite", st => st.delete(k))
  };
  let draftTimer = null;
  function scheduleDraft() {
    if (!gm) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      DB.set("draft", { base: loadedStamp, time: Date.now(), state, flags: flagCache, ids: terrDirty ? T.ids.slice() : null, pids: provDirty ? P.ids.slice() : null })
        .catch(() => toast("Не удалось сохранить черновик в браузере"));
    }, 2000);
  }
  async function offerDraft() {
    let d = null;
    try { d = await DB.get("draft"); } catch (e) { return; }
    if (!d) return;
    const when = new Date(d.time).toLocaleString("ru-RU");
    const note = d.base === loadedStamp ? "Черновик от " + when + "." : "Черновик от " + when + " сделан для более старой версии карты.";
    const ok = await ask("Восстановить неопубликованный черновик?", "", { confirm: true, note });
    if (!ok) { DB.del("draft").catch(() => {}); return; }
    state = d.state;
    Object.assign(flagCache, d.flags || {});
    if (d.ids && d.ids.length === T.ids.length) { T.ids.set(d.ids); T.computeBBoxes(); terrDirty = true; }
    if (d.pids && d.pids.length === P.ids.length) { P.ids.set(d.pids); P.computeBBoxes(); provDirty = true; buildProvPaths(); }
    rebuildAll(true);
    dirty = true; $("gmDirty").classList.remove("hidden");
    toast("Черновик восстановлен");
  }

  // ---------- режим ГМа ----------
  const b64 = bytes => btoa(String.fromCharCode.apply(null, bytes));
  const unb64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
  async function pbkdf2(pw, salt, iter) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
  }
  let fails = 0;
  async function login() {
    if (!window.crypto || !crypto.subtle) { toast("Вход ГМа работает только по https"); return; }
    const pw = await ask("Вход ГМа", "", { password: true, note: "Режим редактирования карты." });
    if (!pw) return;
    await new Promise(r => setTimeout(r, Math.min(4000, fails * 800)));
    const g = config.gm;
    const h = await pbkdf2(pw, unb64(g.salt), g.iter);
    if (b64(h) !== g.hash) { fails++; toast("Неверный пароль"); return; }
    fails = 0;
    try { sessionStorage.setItem(GM_KEY, g.hash); } catch (e) { /* */ }
    setGm(true);
    toast("Режим ГМа включён");
    offerDraft();
  }
  async function logout() {
    if (dirty) {
      const ok = await ask("Есть неопубликованные правки. Выйти?", "", { confirm: true, note: "Черновик останется в этом браузере и будет предложен при следующем входе." });
      if (!ok) return;
    }
    try { sessionStorage.removeItem(GM_KEY); } catch (e) { /* */ }
    setGm(false);
  }
  function setGm(on) {
    gm = on;
    document.body.classList.toggle("is-gm", gm);
    $("gmLoginBtn").classList.toggle("hidden", gm);
    $("gmActions").classList.toggle("hidden", !gm);
    setTool("pan");
    buildCountryList();
    updateCard();
  }
  $("gmLoginBtn").onclick = login;
  $("logoutBtn").onclick = logout;
  window.addEventListener("beforeunload", e => { if (gm && dirty) { e.preventDefault(); e.returnValue = ""; } });

  async function setupToken() {
    const t = await ask("Токен GitHub для публикации", "", {
      password: true,
      note: "Fine-grained token с правом Contents: Read and write только для репозитория AlKhatum/KhatumGames. Хранится только в этом браузере."
    });
    if (!t) return false;
    GH.setToken(t);
    try { await GH.check(config.repo); toast("GitHub подключён"); return true; }
    catch (e) { GH.setToken(""); toast(e.message); return false; }
  }
  $("ghBtn").onclick = async () => {
    if (GH.token()) {
      const ok = await ask("GitHub уже подключён. Заменить токен?", "", { confirm: true, note: "Отмена — оставить текущий; можно также отключить, введя пустой токен." });
      if (!ok) return;
    }
    await setupToken();
  };
  async function ensureToken() { return GH.token() ? true : setupToken(); }

  $("publishBtn").onclick = async () => {
    if (!gm) return;
    if (!dirty) { toast("Нет новых правок"); return; }
    if (!(await ensureToken())) return;
    const btn = $("publishBtn"); btn.disabled = true;
    try {
      const st = clone(state), files = [], stamp = Date.now();
      for (const id in st.countries) {
        const c = st.countries[id];
        if (c.flag && c.flag.startsWith("data:")) { // новый флаг из этой сессии
          const path = `data/flags/${id}.png`;
          files.push({ path, content: unb64(c.flag.split(",")[1]) });
          c.flag = `${path}?v=${stamp}`;
        }
      }
      st.updated = new Date().toISOString();
      files.push({ path: "data/map.json", content: JSON.stringify(st) });
      if (terrDirty) files.push({ path: "data/territories.png", content: await T.toPngBlob() });
      if (provDirty) files.push({ path: "data/provinces.png", content: await P.toPngBlob() });
      await GH.commit(config.repo, files, "Карта: правки ГМа " + new Date().toLocaleString("ru-RU"), m => ($("hint").textContent = m));
      // локально храним флаги как dataURL (на сайте файлы появятся после сборки Pages)
      for (const id in st.countries) {
        const c = state.countries[id];
        if (c && c.flag && c.flag.startsWith("data:")) { flagCache[id] = c.flag; c.flag = st.countries[id].flag; }
      }
      state.updated = loadedStamp = st.updated;
      dirty = terrDirty = provDirty = false;
      $("gmDirty").classList.add("hidden");
      DB.del("draft").catch(() => {});
      toast("Опубликовано. Сайт обновится примерно через минуту.");
    } catch (e) {
      toast("Не удалось опубликовать: " + e.message);
    } finally {
      btn.disabled = false;
      setTool(tool);
    }
  };

  $("pwBtn").onclick = async () => {
    if (!gm) return;
    const p1 = await ask("Новый пароль ГМа", "", { password: true, note: "Не короче 8 символов." });
    if (!p1) return;
    if (p1.length < 8) { toast("Пароль слишком короткий"); return; }
    const p2 = await ask("Повторите новый пароль", "", { password: true });
    if (p1 !== p2) { toast("Пароли не совпадают"); return; }
    if (!(await ensureToken())) return;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 150000;
    const h = await pbkdf2(p1, salt, iter);
    const next = clone(config); next.gm = { salt: b64(salt), hash: b64(h), iter };
    try {
      await GH.commit(config.repo, [{ path: "data/config.json", content: JSON.stringify(next, null, 2) + "\n" }], "Карта: смена пароля ГМа");
      config = next;
      try { sessionStorage.setItem(GM_KEY, next.gm.hash); } catch (e) { /* */ }
      toast("Пароль изменён (вступит в силу после обновления сайта)");
    } catch (e) { toast("Не удалось сменить пароль: " + e.message); }
  };

  // ---------- инструменты ГМа ----------
  let tool = "pan", brushCountry = null, pencilSize = 2;
  const HINTS = {
    pan: "Перетаскивайте карту, колесо — масштаб. Клик по стране — легенда. Двойной клик — переименовать. Города и подписи можно перетаскивать (подпись города — отдельно от значка).",
    brush: "Кисть: рисуйте территорию выбранной страны. [ и ] — размер, Alt+клик — взять страну с карты, правая кнопка — двигать карту.",
    pencil: "Карандаш: точная правка границы (1–4 px). Alt+клик — взять страну с карты, правая кнопка — двигать карту.",
    eraser: "Ластик: убирает территорию (суша становится ничьей).",
    fill: "Заливка: клик заливает связную область выбранной страной (пустую — только по суше).",
    picker: "Пипетка: кликните по стране, чтобы рисовать ей.",
    city: "Кликните по карте, чтобы добавить город.",
    label: "Кликните по карте, чтобы добавить подпись.",
    erase: "Кликните по городу, подписи или стране, чтобы удалить (Ctrl+Z — вернуть).",
    ruler: "Линейка: кликайте по точкам маршрута — расстояние считается по поверхности Земли. Двойной клик или Enter — закончить, Esc — отменить.",
    compass: "Циркуль: нажмите в центре и тяните — окружность заданного радиуса на поверхности Земли. Esc — отменить."
  };
  const PAINT = ["brush", "pencil", "eraser", "fill", "picker"];
  const MEASURE = ["ruler", "compass"];
  function setTool(t) {
    if (!gm && !MEASURE.includes(t)) t = "pan";
    if (viewMode === "globe" && t !== "pan") t = "pan";
    if (tool === "ruler" && t !== "ruler") finishRuler();
    tool = t;
    frame.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    viewport.className = "viewport tool-" + t;
    $("brushBar").classList.toggle("hidden", !gm || !PAINT.includes(t) || t === "picker");
    $("hint").textContent = viewMode === "globe" ? HINT_GLOBE : MEASURE.includes(t) ? HINTS[t] : gm ? HINTS[t] || "" : "Перетаскивайте карту, колесо — масштаб. Клик по стране — её флаг и название в легенде. Слои — во вкладке «Слои».";
    const sz = $("bbSize");
    if (t === "pencil") { sz.max = 4; sz.value = pencilSize; } else { sz.max = 120; sz.value = brushSize; }
    $("bbSizeVal").textContent = sz.value;
    $("bbCountry").disabled = t === "eraser";
    cursorEl.style.display = gm && ["brush", "pencil", "eraser"].includes(t) ? "" : "none";
    updateCursorSize();
  }
  frame.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(tool === b.dataset.tool && MEASURE.includes(tool) ? "pan" : b.dataset.tool)));
  $("undoBtn").onclick = undo; $("redoBtn").onclick = redo;
  let brushSize = 24;
  $("bbSize").addEventListener("input", e => {
    const v = +e.target.value;
    if (tool === "pencil") pencilSize = v; else brushSize = v;
    $("bbSizeVal").textContent = v; updateCursorSize();
  });
  function curSize() { return tool === "pencil" ? pencilSize : brushSize; }
  function updateCursorSize() { cursorEl.setAttribute("r", Math.max(0.5, curSize() / 2)); }
  function fillBrushSelect() {
    const selEl = $("bbCountry"), cur = brushCountry;
    selEl.innerHTML = "";
    Object.values(state.countries).sort((a, b) => a.name.localeCompare(b.name, "ru")).forEach(c => {
      const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; selEl.append(o);
    });
    if (cur && state.countries[cur]) selEl.value = cur; else brushCountry = selEl.value || null;
    updateSwatch();
  }
  function setBrushCountry(id) { brushCountry = String(id); $("bbCountry").value = brushCountry; updateSwatch(); }
  function updateSwatch() { const c = state.countries[brushCountry]; $("bbSwatch").style.background = c ? c.color : "transparent"; }
  $("bbCountry").addEventListener("change", e => { brushCountry = e.target.value; updateSwatch(); });
  function newCountryId() { for (let i = 1; i < 256; i++) if (!state.countries[i] && !T.bbox[i]) return String(i); return null; }
  $("addCountryBtn").onclick = async () => {
    if (!gm) return;
    const id = newCountryId();
    if (!id) { toast("Достигнут предел в 255 стран"); return; }
    const name = await ask("Название новой страны", "Новая страна");
    if (!name) return;
    const hue = Math.floor(Math.random() * 360);
    const color = `hsl(${hue} 65% 66%)`;
    const cv = document.createElement("canvas").getContext("2d"); cv.fillStyle = color;
    const cx = (viewport.clientWidth / 2 - tx) / s, cy = (viewport.clientHeight / 2 - ty) / s;
    commit("countries", id, null, { id, layer: "", name, color: cv.fillStyle, label: [Math.round(cx), Math.round(cy)], size: 14, flag: null });
    setBrushCountry(id); select({ col: "countries", id }); setTool("brush");
    toast("Нарисуйте территорию кистью");
  };
  async function deleteProvince(id) {
    const c = state.provinces[id]; if (!c) return;
    const ok = await ask("Удалить провинцию «" + c.name + "»?", "", { confirm: true, note: "Её земля останется без провинции. Ctrl+Z — вернуть." });
    if (!ok) return;
    const ch = P.beginStroke(), b = P.bbox[+id];
    if (b) for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) { const i = y * W + x; if (P.ids[i] === +id) P._set(i, 0, ch); }
    const stroke = P.endStroke(ch);
    const items = [];
    if (stroke.idx.length) items.push({ kind: "paint", stroke });
    items.push({ kind: "entity", col: "provinces", id: String(id), before: clone(c), after: null });
    if (selProv === String(id)) selProv = null;
    applyEntry({ kind: "multi", items: items.filter(i => i.kind === "entity") }, false);
    pushUndo({ kind: "multi", items });
  }
  (function provNameInput() {
    const inp = $("provName");
    let before = null;
    inp.addEventListener("focus", () => { if (selProv) before = clone(state.provinces[selProv]); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); e.stopPropagation(); });
    inp.addEventListener("change", () => {
      if (!gm || !selProv || !before) return;
      const v = inp.value.trim();
      if (!v || v === before.name) { inp.value = before.name; return; }
      const a = clone(before); a.name = v; commit("provinces", selProv, before, a); before = clone(a);
    });
  })();
  function buildProvPaths() {
    const t0 = performance.now();
    const all = P.allPaths();
    for (const id of Object.keys(provEls)) if (!all.has(+id)) setProvPath(id, "");
    for (const [id, d] of all) if (state.provinces[String(id)]) setProvPath(id, d);
    console.info("провинции построены за", Math.round(performance.now() - t0), "мс");
  }
  async function deleteCountry(id) {
    const c = state.countries[id]; if (!c) return;
    const ok = await ask("Удалить страну «" + c.name + "»?", "", { confirm: true, note: "Её территория станет ничьей. Ctrl+Z — вернуть." });
    if (!ok) return;
    const ch = T.beginStroke(), b = T.bbox[+id];
    if (b) for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) { const i = y * W + x; if (T.ids[i] === +id) T._set(i, 0, ch); }
    const stroke = T.endStroke(ch);
    const items = [];
    if (stroke.idx.length) items.push({ kind: "paint", stroke });
    items.push({ kind: "entity", col: "countries", id: String(id), before: clone(c), after: null });
    const entry = { kind: "multi", items };
    applyEntry({ kind: "multi", items: items.filter(i => i.kind === "entity") }, false);
    recompute(stroke.labels);
    pushUndo(entry);
  }

  // ---------- рисование (страны или провинции) ----------
  let stroke = null, lastPt = null;
  const provMode = () => $("bbMode").value === "p";
  const eng = () => (provMode() ? P : T);
  function paintPreview(E, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const img = paintCtx.getImageData(x0, y0, bw, bh), d = img.data;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * W + (x0 + x);
      if (E.mark[i] !== E.strokeNo) continue;
      const v = E.ids[i], o = (y * bw + x) * 4;
      const c = !v ? [16, 24, 46] : E === P ? [120, 235, 255] : rgbOf(v);
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = E === P ? 150 : 235;
    }
    paintCtx.putImageData(img, x0, y0);
  }
  const rgbCache = {};
  function rgbOf(v) {
    const c = state.countries[String(v)], key = v + ":" + (c ? c.color : "");
    if (rgbCache[key]) return rgbCache[key];
    const cx = document.createElement("canvas").getContext("2d"); cx.fillStyle = c ? c.color : "#888";
    const h = cx.fillStyle; // нормализуется в #rrggbb
    return (rgbCache[key] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  }
  function paintValue() {
    if (tool === "eraser") return 0;
    if (provMode()) {
      if (!brushProv || !state.provinces[brushProv]) { toast("Возьмите провинцию пипеткой (Alt+клик) или создайте новую"); return null; }
      return +brushProv;
    }
    if (!brushCountry || !state.countries[brushCountry]) { toast("Выберите страну для кисти"); return null; }
    return +brushCountry;
  }
  function paintOpts() { return { land: $("bbLand").checked, keep: $("bbKeep").checked }; }
  function startStroke(p) {
    const v = paintValue(); if (v == null) return false;
    const E = eng();
    const hadBox = v && !!E.bbox[v];
    stroke = { E, ch: E.beginStroke(), v, r: Math.max(0.5, curSize() / 2), opts: paintOpts(), hadBox };
    lastPt = p;
    E.stamp(p[0], p[1], stroke.r, v, stroke.opts, stroke.ch);
    paintPreview(E, p[0] - stroke.r - 1, p[1] - stroke.r - 1, p[0] + stroke.r + 1, p[1] + stroke.r + 1);
    return true;
  }
  function moveStroke(p) {
    const E = stroke.E;
    E.line(lastPt[0], lastPt[1], p[0], p[1], stroke.r, stroke.v, stroke.opts, stroke.ch);
    const r = stroke.r + 1;
    paintPreview(E, Math.min(lastPt[0], p[0]) - r, Math.min(lastPt[1], p[1]) - r, Math.max(lastPt[0], p[0]) + r, Math.max(lastPt[1], p[1]) + r);
    lastPt = p;
  }
  function endStroke() {
    const st = stroke; stroke = null;
    const E = st.E, res = E.endStroke(st.ch);
    paintCtx.clearRect(0, 0, W, H);
    if (!res.idx.length) return;
    recomputeAny(res);
    pushUndo({ kind: "paint", stroke: res });
    // у новой страны/провинции ставим подпись туда, где её начали рисовать
    if (st.v && !st.hadBox) {
      const col = E === P ? "provinces" : "countries";
      const c = state[col][String(st.v)], lp = E.labelPoint(st.v);
      if (c && lp) { const a = clone(c); a.label = lp; setEntity(col, String(st.v), a); }
    }
  }
  function doFill(p) {
    const v = paintValue(); if (v == null) return;
    const E = eng(), ch = E.beginStroke();
    const n = E.fill(p[0], p[1], v, paintOpts(), ch);
    const res = E.endStroke(ch);
    if (!n || !res.idx.length) { toast("Здесь нечего заливать"); return; }
    recomputeAny(res);
    pushUndo({ kind: "paint", stroke: res });
  }
  function pick(p) {
    if (provMode()) {
      const v = P.at(p[0], p[1]);
      if (!v || !state.provinces[String(v)]) { toast("Здесь нет провинции"); return false; }
      setBrushProv(v); return true;
    }
    const v = T.at(p[0], p[1]);
    if (!v || !state.countries[String(v)]) { toast("Здесь нет страны"); return false; }
    setBrushCountry(v); toast("Кисть: " + state.countries[String(v)].name);
    return true;
  }
  let brushProv = null;
  function setBrushProv(id) {
    brushProv = String(id);
    const pr = state.provinces[brushProv];
    $("bbProv").textContent = pr ? "Провинция: " + pr.name : "Провинция не выбрана";
  }
  function syncBrushMode() {
    const pm = provMode();
    $("bbCountry").classList.toggle("hidden", pm); $("bbSwatch").classList.toggle("hidden", pm);
    $("bbProv").classList.toggle("hidden", !pm); $("addProvBtn").classList.toggle("hidden", !pm);
    if (pm && !ui.vis.provBorders && ui.vis.provBorders !== undefined) { /* слой мог быть скрыт */ }
    if (pm) { const l = flat.find(x => x.id === "provBorders"); if (l && !isVisible(l)) { ui.vis.provBorders = true; applyLayer(l); buildLayerList(); } }
    setBrushProv(brushProv || "");
  }
  $("bbMode").addEventListener("change", syncBrushMode);
  $("addProvBtn").onclick = async () => {
    const name = await ask("Название новой провинции", "Новая провинция");
    if (!name) return;
    let id = 1; while (state.provinces[id] || P.bbox[id]) id++;
    if (id > 65535) { toast("Слишком много провинций"); return; }
    const cx = (viewport.clientWidth / 2 - tx) / s, cy = (viewport.clientHeight / 2 - ty) / s;
    commit("provinces", String(id), null, { id: String(id), name, real: "", type: "", label: [Math.round(cx), Math.round(cy)], size: 5, c: brushCountry || "" });
    setBrushProv(id); setTool("brush");
    toast("Нарисуйте территорию провинции кистью");
  };

  // ---------- переименование ----------
  async function rename(ent) {
    const e = state[ent.col] && state[ent.col][ent.id]; if (!e) return;
    const field = { countries: "name", cities: "name", labels: "text", provinces: "name" }[ent.col];
    const title = { countries: "Переименовать страну", cities: "Переименовать город", labels: "Изменить подпись", provinces: "Переименовать провинцию" }[ent.col];
    const v = await ask(title, e[field]);
    if (!v || v === e[field]) return;
    const a = clone(e); a[field] = v; commit(ent.col, ent.id, e, a);
  }
  const uid = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

  async function handleClick(ent, p) {
    if (tool === "ruler") { rulerAdd(p); return; }
    if (tool === "compass") return;
    if (!gm || tool === "pan") {
      const pid = P.ids ? P.at(p[0], p[1]) : 0;
      const provOn = isVisible(flat.find(x => x.id === "provBorders"));
      selProv = provOn && pid && state.provinces[String(pid)] ? String(pid) : null;
      if (ent && ent.col && ent.col !== "countries" && ent.col !== "provinces") { select(ent); return; }
      const cid = T.at(p[0], p[1]);
      select(cid && state.countries[String(cid)] ? { col: "countries", id: String(cid) } : null);
      return;
    }
    if (tool === "fill") { doFill(p); return; }
    if (tool === "picker") { if (pick(p)) setTool("brush"); return; }
    if (tool === "city") {
      const name = await ask("Название нового города", "");
      if (!name) return;
      const id = uid("ct");
      commit("cities", id, null, { id, name, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, dx: 5.2, dy: 2.2, a: "start" });
      return;
    }
    if (tool === "label") {
      const text = await ask("Новая подпись", "");
      if (!text) return;
      const id = uid("l");
      commit("labels", id, null, { id, text, x: Math.round(p[0]), y: Math.round(p[1]), size: 14 });
      return;
    }
    if (tool === "erase") {
      if (!ent || !ent.col) return;
      if (ent.col === "countries") { deleteCountry(ent.id); return; }
      if (ent.col === "provinces") { deleteProvince(ent.id); return; }
      commit(ent.col, ent.id, state[ent.col][ent.id], null);
      toast("Удалено (Ctrl+Z — вернуть)");
    }
  }

  // ---------- указатель ----------
  const pointers = new Map();
  let drag = null, pinch = null, lastClick = { t: 0, key: "", x: 0, y: 0 }, spaceDown = false;
  const entOf = t => {
    const el = t && t.closest ? t.closest("[data-col]") : null;
    return el ? { col: el.dataset.col, id: el.dataset.id, part: el.dataset.part || null } : null;
  };
  viewport.addEventListener("contextmenu", e => e.preventDefault());
  viewport.addEventListener("pointerdown", e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
      if (stroke) endStroke();
      drag = null; return;
    }
    const p = toMap(e), ent = entOf(e.target);
    const panButton = e.button === 1 || e.button === 2 || spaceDown;
    if (!panButton && tool === "compass") { compassStart(p); drag = { kind: "compass" }; return; }
    if (gm && !panButton && ["brush", "pencil", "eraser"].includes(tool)) {
      if (e.altKey) { pick(p); return; }
      if (startStroke(p)) drag = { kind: "paint" };
      return;
    }
    if (gm && !panButton && tool === "pan" && ent && ent.col !== "countries" || gm && !panButton && tool === "pan" && ent && ent.part === "label") {
      drag = { kind: "move", ent, sx: e.clientX, sy: e.clientY, p0: p, before: clone(state[ent.col][ent.id]), moved: false };
      return;
    }
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx, ty, moved: false, ent, p, panOnly: panButton };
  });
  viewport.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toMap(e);
    if (gm && cursorEl.style.display !== "none") { cursorEl.setAttribute("cx", p[0]); cursorEl.setAttribute("cy", p[1]); }
    if (tool === "ruler" && ruler && !drag) { ruler.cursor = p; renderMeasure(); }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], r = viewport.getBoundingClientRect();
      zoomAt((pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (!drag) return;
    if (drag.kind === "compass") { compassMove(p); return; }
    if (drag.kind === "paint") { if (stroke) moveStroke(p); return; }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; viewport.classList.add("panning"); }
      if (drag.moved) setView(s, drag.tx + dx, drag.ty + dy);
      return;
    }
    if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1], b = drag.before, en = state[drag.ent.col][drag.ent.id];
      const r1 = v => Math.round(v * 10) / 10;
      if (drag.ent.col === "countries") en.label = [Math.round(b.label[0] + dx), Math.round(b.label[1] + dy)];
      else if (drag.ent.col === "cities" && drag.ent.part === "text") {
        const o = cityText(b); en.dx = r1(o.dx + dx); en.dy = r1(o.dy + dy);
      } else { en.x = r1(b.x + dx); en.y = r1(b.y + dy); }
      RENDER[drag.ent.col](drag.ent.id);
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null; viewport.classList.remove("panning");
    if (!d) return;
    if (d.kind === "paint") { if (stroke) endStroke(); return; }
    if (d.kind === "compass") { compassEnd(); return; }
    if (d.kind === "move" && d.moved) { commit(d.ent.col, d.ent.id, d.before, state[d.ent.col][d.ent.id]); return; }
    if (e.type === "pointercancel" || (d.kind === "pan" && (d.moved || d.panOnly))) return;
    const ent = d.ent, p = d.p || toMap(e);
    const key = ent ? ent.col + ":" + ent.id : "none", now = performance.now();
    const dbl = now - lastClick.t < 380 && lastClick.key === key && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
    lastClick = { t: dbl ? 0 : now, key, x: e.clientX, y: e.clientY };
    if (dbl && tool === "ruler") { finishRuler(); return; }
    if (dbl && gm && ent && (tool === "pan")) { rename(ent); return; }
    if (dbl) return;
    handleClick(ent, p);
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("pointerleave", () => { cursorEl.setAttribute("cx", -100); });

  window.addEventListener("keydown", e => {
    if (!$("page-map").classList.contains("active")) return;
    if (e.target.matches && e.target.matches("input, textarea, select")) return;
    if (!$("modal").classList.contains("hidden")) return;
    if (e.code === "Space") { spaceDown = true; if (gm) e.preventDefault(); }
    if (MEASURE.includes(tool)) {
      if (e.key === "Enter") { finishRuler(); return; }
      if (e.key === "Escape") { ruler = null; circleDraft = null; renderMeasure(); return; }
    }
    if (!gm) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "я")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "н")) { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "[" || k === "х" || k === "]" || k === "ъ") {
      const sz = $("bbSize"), up = k === "]" || k === "ъ";
      sz.value = Math.max(+sz.min, Math.min(+sz.max, +sz.value + (up ? 1 : -1) * Math.max(1, Math.round(+sz.value * 0.15))));
      sz.dispatchEvent(new Event("input")); return;
    }
    if (e.key === "Escape") { selProv = null; select(null); return; }
    if (e.key === "Delete" && sel) { if (sel.col === "countries") deleteCountry(sel.id); else commit(sel.col, sel.id, state[sel.col][sel.id], null); return; }
    const map = { v: "pan", м: "pan", b: "brush", и: "brush", p: "pencil", з: "pencil", e: "eraser", у: "eraser", g: "fill", п: "fill", i: "picker", ш: "picker", c: "city", с: "city", n: "label", т: "label", d: "erase", в: "erase" };
    if (map[k]) setTool(map[k]);
  });
  window.addEventListener("keyup", e => { if (e.code === "Space") spaceDown = false; });


  // ---------- линейка и циркуль (расстояния по поверхности Земли) ----------
  const Geo = window.KGGeo;
  const measures = { lines: [], circles: [] };
  let ruler = null, circleDraft = null, lastKind = "line";
  const mOut = $("measureOut");
  function rulerAdd(p) {
    const ll = Geo.toLL(p[0], p[1]);
    if (!ruler) ruler = { pts: [] };
    ruler.pts.push(ll);
    renderMeasure();
  }
  function finishRuler() {
    if (ruler && ruler.pts.length >= 2) { measures.lines.push({ pts: ruler.pts }); lastKind = "line"; }
    ruler = null; renderMeasure();
  }
  function compassStart(p) { circleDraft = { c: Geo.toLL(p[0], p[1]), r: 0 }; renderMeasure(); }
  function compassMove(p) { if (!circleDraft) return; circleDraft.r = Geo.dist(circleDraft.c, Geo.toLL(p[0], p[1])); renderMeasure(); }
  function compassEnd() { if (circleDraft && circleDraft.r > 0.5) { measures.circles.push(circleDraft); lastKind = "circle"; } circleDraft = null; renderMeasure(); }
  $("measureClear").onclick = () => { measures.lines = []; measures.circles = []; ruler = null; circleDraft = null; renderMeasure(); };
  function lineLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Geo.dist(pts[i - 1], pts[i]); return d; }
  function geoPolyline(pts) {
    const all = [];
    for (let i = 1; i < pts.length; i++) {
      const n = Math.max(2, Math.min(96, Math.ceil(Geo.dist(pts[i - 1], pts[i]) / 60)));
      const seg = Geo.arc(pts[i - 1], pts[i], n);
      if (i > 1) seg.shift();
      all.push(...seg);
    }
    return all;
  }
  function circlePts(c, r) { const pts = []; for (let a = 0; a <= 360; a += 2) pts.push(Geo.dest(c, a, r)); return pts; }
  function renderMeasure() {
    const svg = L.measure; if (!svg) return;
    const fs = (12 / s).toFixed(2), dot = (3.5 / s).toFixed(2), sw = (3 / s).toFixed(2);
    let h = "";
    const label = (ll, text) => {
      const [x, y] = Geo.toXY(ll[0], ll[1]);
      return '<text x="' + x.toFixed(1) + '" y="' + (y - 7 / s).toFixed(1) + '" font-size="' + fs + '" stroke-width="' + sw + '" class="m-lbl">' + esc(text) + "</text>";
    };
    const drawLine = (pts, live) => {
      if (pts.length >= 2) h += '<path class="m-line' + (live ? " live" : "") + '" d="' + Geo.pathLL(geoPolyline(pts), false) + '"/>';
      let acc = 0;
      pts.forEach((p, i) => {
        if (i) acc += Geo.dist(pts[i - 1], p);
        const [x, y] = Geo.toXY(p[0], p[1]);
        h += '<circle class="m-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + dot + '"/>';
        if (i) h += label(p, Geo.fmt(acc));
      });
    };
    const drawCircle = (c, live) => {
      if (!c.r) return;
      h += '<path class="m-circle' + (live ? " live" : "") + '" d="' + Geo.pathLL(circlePts(c.c, c.r), false) + '"/>';
      const e = Geo.dest(c.c, 90, c.r);
      h += '<path class="m-line" d="' + Geo.pathLL(Geo.arc(c.c, e, 24), false) + '"/>';
      const [x, y] = Geo.toXY(c.c[0], c.c[1]);
      h += '<circle class="m-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + dot + '"/>';
      h += label(Geo.dest(c.c, 90, c.r / 2), "R " + Geo.fmt(c.r));
    };
    measures.lines.forEach(l => drawLine(l.pts, false));
    measures.circles.forEach(c => drawCircle(c, false));
    let out = "";
    if (ruler) {
      const pts = ruler.cursor ? ruler.pts.concat([Geo.toLL(ruler.cursor[0], ruler.cursor[1])]) : ruler.pts;
      drawLine(pts, true);
      out = "Линейка: " + Geo.fmt(lineLen(pts));
    } else if (circleDraft) { drawCircle(circleDraft, true); out = "Циркуль: радиус " + Geo.fmt(circleDraft.r); }
    else if (measures.lines.length && (lastKind === "line" || !measures.circles.length)) out = "Линейка: " + Geo.fmt(lineLen(measures.lines[measures.lines.length - 1].pts));
    else if (measures.circles.length) out = "Циркуль: радиус " + Geo.fmt(measures.circles[measures.circles.length - 1].r);
    svg.innerHTML = h;
    mOut.textContent = out;
    mOut.classList.toggle("hidden", !out);
  }

  // ---------- глобус ----------
  const HINT_GLOBE = "Глобус: тяните — вращать, колесо — масштаб, клик по стране — легенда, клик по спутнику — его орбита. Редактирование и измерения — на плоской карте.";
  const Sat = window.KGSats;
  let viewMode = "flat", globe = null, globeRaf = 0, globeLoop = 0, globeReady = null;
  const satUi = { items: Sat.list.map(s => ({ s, on: true, pos: null, ring: null, screen: null })), sel: "kovcheg", orbits: true, names: true, speed: 60, time: Date.now(), follow: false, last: 0 };
  function globeShow() {
    const sh = {};
    flat.forEach(l => { if (!l.internal) { sh[l.id] = isVisible(l); if (ui.hl[l.id]) sh["hl_" + l.id] = true; } });
    return sh;
  }
  function globeDirty() {
    if (viewMode !== "globe" || !globe || globeRaf || globeLoop) return;
    globeRaf = requestAnimationFrame(() => { globeRaf = 0; drawGlobe(); });
  }
  function drawGlobe() {
    globe.show = globeShow();
    globe.sel = sel && sel.col === "countries" ? +sel.id : 0;
    globe.selProv = selProv ? +selProv : 0;
    updateSats();
    globe.render();
    renderSatInfo();
  }
  // анимация спутников, пока открыт глобус
  function startLoop() {
    if (globeLoop) return;
    satUi.last = performance.now();
    const tick = now => {
      if (viewMode !== "globe") { globeLoop = 0; return; }
      const dt = now - satUi.last; satUi.last = now;
      satUi.time += dt * satUi.speed;
      drawGlobe();
      globeLoop = requestAnimationFrame(tick);
    };
    globeLoop = requestAnimationFrame(tick);
  }
  function updateSats() {
    globe.sats = satUi;
    for (const it of satUi.items) {
      it.pos = Sat.at(it.s, satUi.time);
      it.ring = satUi.orbits && it.on ? Sat.ring(it.s, satUi.time, it.s.e > 0 ? 240 : 160) : null;
    }
    if (satUi.follow && satUi.sel) {
      const it = satUi.items.find(x => x.s.id === satUi.sel);
      if (it && it.pos) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * Math.PI / 180)); globe.lon = it.pos.lon * Math.PI / 180; }
    }
  }
  // сборка упакованных текстур слоёв (дороги в RGBA, реки+городские зоны в LA)
  function alphaOf(img) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    return cx.getImageData(0, 0, W, H).data;
  }
  function whenLoaded(img) { return img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }); }
  async function buildGlobeTextures() {
    const imgs = [L.relief, L.road_major, L.road_secondary, L.road_road, L.rail, L.hydro, L.citiesFill];
    await Promise.all(imgs.map(whenLoaded));
    globe.setLand(L.relief);
    const N = W * H, lines = new Uint8Array(N * 4);
    [L.road_major, L.road_secondary, L.road_road, L.rail].forEach((img, ch) => {
      const d = alphaOf(img);
      for (let i = 0; i < N; i++) lines[i * 4 + ch] = d[i * 4 + 3];
    });
    globe.setLines(lines, W, H);
    const misc = new Uint8Array(N * 2), hy = alphaOf(L.hydro), cf = alphaOf(L.citiesFill);
    for (let i = 0; i < N; i++) { misc[i * 2] = hy[i * 4 + 3]; misc[i * 2 + 1] = cf[i * 4 + 3]; }
    globe.setMisc(misc, W, H);
  }
  function syncGlobe(withIds) {
    if (withIds) { globe.setIds(T.ids, T.W, T.H); if (P.ids) globe.setProv(P.ids, P.W, P.H); }
    const pal = {}, labels = [];
    const cx = document.createElement("canvas").getContext("2d");
    for (const id in state.countries) {
      const c = state.countries[id];
      cx.fillStyle = c.color; pal[id] = cx.fillStyle;
      const ll = Geo.toLL(c.label[0], c.label[1]);
      labels.push({ id, name: c.name, lat: ll[0], lon: ll[1], size: c.size });
    }
    globe.setPalette(pal);
    globe.setLabels(labels);
    globe.setCities(Object.values(state.cities).map(c => { const ll = Geo.toLL(c.x, c.y); return { name: c.name, lat: ll[0], lon: ll[1] }; }));
    globe.setProvLabels(Object.values(state.provinces || {}).map(p => { const ll = Geo.toLL(p.label[0], p.label[1]); return { name: p.name, lat: ll[0], lon: ll[1], size: p.size }; }));
    globeDirty();
  }
  function globeZoom(f) { if (!globe) return; globe.zoom = f ? Math.min(8, Math.max(0.18, globe.zoom * f)) : 1; globeDirty(); }
  async function setView3(mode) {
    if (mode === "globe" && !globe) {
      try { globe = new window.KGGlobe($("globeCanvas"), $("globeOverlay"), $("globeLabels")); } catch (e) { console.error(e); globe = null; }
      if (!globe || !globe.ok()) { globe = null; toast("Не удалось запустить глобус (нужен WebGL)"); return; }
      $("globeLoading").classList.remove("hidden");
      globeReady = buildGlobeTextures().then(() => $("globeLoading").classList.add("hidden"));
    }
    viewMode = mode;
    frame.classList.toggle("globe-mode", mode === "globe");
    $("globeWrap").classList.toggle("hidden", mode !== "globe");
    $("satPanel").classList.toggle("hidden", mode !== "globe");
    document.querySelectorAll("#viewSwitch button").forEach(b => b.classList.toggle("active", b.dataset.view === mode));
    if (mode === "globe") {
      const c = Geo.toLL((viewport.clientWidth / 2 - tx) / s, (viewport.clientHeight / 2 - ty) / s);
      globe.lat = Math.max(-60, Math.min(70, c[0])) * Math.PI / 180; globe.lon = c[1] * Math.PI / 180;
      syncGlobe(true);
      if (!satUi.listBuilt) buildSatList();
      satUi.time = Date.now();
      startLoop();
      if (globeReady) globeReady.then(globeDirty);
    }
    setTool(mode === "globe" ? "pan" : tool);
  }
  document.querySelectorAll("#viewSwitch button").forEach(b => b.addEventListener("click", () => setView3(b.dataset.view)));

  // панель спутников
  function buildSatList() {
    satUi.listBuilt = true;
    const list = $("satList"); list.innerHTML = "";
    for (const it of satUi.items) {
      const r = document.createElement("div"); r.className = "sat-row"; r.dataset.id = it.s.id;
      r.innerHTML = `<input type="checkbox" checked title="Показывать"><span class="sat-dot" style="background:${it.s.color};box-shadow:0 0 6px ${it.s.color}"></span>` +
        `<span class="sat-name">${esc(it.s.name)}</span><span class="sat-type">${esc(it.s.typeRu)}</span>`;
      r.querySelector("input").addEventListener("change", e => { it.on = e.target.checked; globeDirty(); });
      r.addEventListener("click", e => { if (e.target.tagName !== "INPUT") selectSat(it.s.id, true); });
      list.append(r);
    }
    markSatRows();
  }
  function markSatRows() { document.querySelectorAll("#satList .sat-row").forEach(r => r.classList.toggle("active", r.dataset.id === satUi.sel)); }
  function selectSat(id, center) {
    satUi.sel = id; markSatRows();
    const it = satUi.items.find(x => x.s.id === id);
    if (center && it && it.pos && globe) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * Math.PI / 180)); globe.lon = it.pos.lon * Math.PI / 180; }
    globeDirty();
  }
  function renderSatInfo() {
    const it = satUi.items.find(x => x.s.id === satUi.sel);
    const box = $("satInfo");
    if (!it || !it.pos) { box.textContent = ""; return; }
    const p = it.pos, ns = p.lat >= 0 ? "с. ш." : "ю. ш.", ew = p.lon >= 0 ? "в. д." : "з. д.";
    const html = `<b style="color:${it.s.color}">${esc(it.s.name)}</b> — ${esc(it.s.note)}<br>` +
      `Высота ${Math.round(p.alt).toLocaleString("ru-RU")} км · скорость ${Sat.speed(it.s, p.alt).toFixed(2).replace(".", ",")} км/с · виток ${Sat.fmtPeriod(it.s.period)}<br>` +
      `Над точкой ${Math.abs(p.lat).toFixed(1)}° ${ns}, ${Math.abs(p.lon).toFixed(1)}° ${ew}`;
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
    const t = new Date(satUi.time);
    const ts = t.toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
    if ($("satTime").textContent !== ts) $("satTime").textContent = ts;
  }
  $("satOrbits").addEventListener("change", e => { satUi.orbits = e.target.checked; globeDirty(); });
  $("satNames").addEventListener("change", e => { satUi.names = e.target.checked; globeDirty(); });
  $("satFollow").addEventListener("change", e => { satUi.follow = e.target.checked; globeDirty(); });
  document.querySelectorAll("#satSpeed button").forEach(b => b.addEventListener("click", () => {
    satUi.speed = +b.dataset.speed;
    if (b.dataset.speed === "now") { satUi.time = Date.now(); satUi.speed = 1; }
    document.querySelectorAll("#satSpeed button").forEach(x => x.classList.toggle("active", x === b));
  }));
  $("satToggle").addEventListener("click", () => $("satPanel").classList.toggle("collapsed"));

  (function globeInput() {
    const cv = $("globeCanvas");
    let g = null;
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); g = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }; });
    cv.addEventListener("pointermove", e => {
      if (!g || !globe) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y, r = globe.radius();
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) { g.moved = true; if (satUi.follow) { satUi.follow = false; $("satFollow").checked = false; } }
      globe.lon -= dx / r; globe.lat = Math.max(-1.5, Math.min(1.5, globe.lat + dy / r));
      g.x = e.clientX; g.y = e.clientY; globeDirty();
    });
    cv.addEventListener("pointerup", e => {
      const was = g; g = null;
      if (!was || was.moved || !globe) return;
      const rc = cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
      // сначала спутники
      let best = null, bd = 12;
      for (const it of satUi.items) {
        if (!it.on || !it.screen) continue;
        const d = Math.hypot(it.screen[0] - mx, it.screen[1] - my);
        if (d < bd) { bd = d; best = it; }
      }
      if (best) { selectSat(best.s.id, false); return; }
      const ll = globe.unproject(mx - rc.width / 2, my - rc.height / 2);
      if (!ll) { selProv = null; select(null); return; }
      const [x, y] = Geo.toXY(ll[0], ll[1]);
      const id = T.at(x, y), pid = P.ids ? P.at(x, y) : 0;
      selProv = isVisible(flat.find(f => f.id === "provBorders")) && pid && state.provinces[String(pid)] ? String(pid) : null;
      select(id && state.countries[String(id)] ? { col: "countries", id: String(id) } : null);
    });
    cv.addEventListener("wheel", e => { e.preventDefault(); globeZoom(Math.pow(1.0015, -e.deltaY)); }, { passive: false });
    window.addEventListener("resize", globeDirty);
  })();

  // ---------- загрузка ----------
  function rebuildAll(keepPaths) {
    for (const col of COLS) {
      const map = col === "countries" ? els.clabel : col === "provinces" ? provLbl : els[col];
      for (const id of Object.keys(map)) if (!state[col][id]) RENDER[col](id);
      for (const id in state[col]) RENDER[col](id);
    }
    if (!keepPaths) return;
    const all = T.allPaths();
    for (const id of Object.keys(els.cfill)) if (!all.has(+id)) setCountryPath(id, "");
    for (const [id, d] of all) if (state.countries[String(id)]) setCountryPath(id, d);
    buildCountryList(); fillBrushSelect(); select(null);
  }
  async function load() {
    const bust = "?t=" + Date.now();
    try {
      const [cfg, st] = await Promise.all([
        fetch("data/config.json" + bust, { cache: "no-store" }).then(r => r.json()),
        fetch("data/map.json" + bust, { cache: "no-store" }).then(r => r.json())
      ]);
      config = cfg; state = st; loadedStamp = st.updated || "";
      for (const c of COLS) state[c] = state[c] || {};
      await T.load("data/territories.png" + bust, "assets/map/land.png");
      await P.load("data/provinces.png" + bust, T.land);
      const t0 = performance.now();
      const all = T.allPaths();
      for (const [id, d] of all) if (state.countries[String(id)]) setCountryPath(id, d);
      coastPath.setAttribute("d", T.coastPath());
      console.info("контуры построены за", Math.round(performance.now() - t0), "мс");
      rebuildAll(false);
      buildCountryList(); fillBrushSelect();
      let saved = null; try { saved = sessionStorage.getItem(GM_KEY); } catch (e) { /* */ }
      setGm(!!saved && saved === config.gm.hash);
      updUndo();
      $("mapLoading").classList.add("hidden");
      requestAnimationFrame(fit);
      setTimeout(buildProvPaths, 60); // границы провинций строим после показа карты
      if (gm) offerDraft();
    } catch (err) {
      console.error(err);
      $("mapLoading").textContent = "Не удалось загрузить карту: " + err.message;
    }
  }
  setTool("pan");
  requestAnimationFrame(fit);
  load();
  window.KGMap = { get state() { return state; }, select, setTool, fit, T, setView3, measures, get globe() { return globe; }, get view() { return { s, tx, ty }; }, get gm() { return gm; } };
})();
