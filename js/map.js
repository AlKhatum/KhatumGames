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
    { id: "landDark", name: "Суша вне стран", kind: "img", src: "assets/map/land.webp", cls: "land-dark", vis: true, internal: true }, // подложка суши: всегда видна, в списке слоёв её нет
    { id: "countries", name: "Заливка стран", kind: "svg", vis: true },
    { id: "alliances", name: "Союзы", kind: "svg", vis: false }, // страны союза — цветом союза, остальные притемнены
    { id: "relief", name: "Рельеф", kind: "img", src: "assets/map/land.webp", cls: "relief", vis: true },
    { id: "hydro", name: "Гидрография", kind: "img", src: "assets/map/hydro.webp", cls: "hydro", vis: true },
    { group: "roads", name: "Дороги", children: [
      { id: "road_major", name: "Главные автострады", kind: "img", src: "assets/map/road_major.webp", vis: true, road: "#ff3fd0" },
      { id: "road_road", name: "Основные магистрали", kind: "img", src: "assets/map/road_road.webp", vis: false, road: "#ffe14d" },
      { id: "road_secondary", name: "Второстепенные дороги", kind: "img", src: "assets/map/road_secondary.webp", vis: true, road: "#19e6ff" },
      { id: "rail", name: "Железные дороги", kind: "img", src: "assets/map/rail.webp", vis: false, road: "#ff9b3d" }
    ] },
    { id: "citiesFill", name: "Городские зоны", kind: "img", src: "assets/map/cities_fill.webp", vis: true, opacity: 0.45 },
    { id: "provBorders", name: "Провинции", kind: "svg", vis: true, glow: "#7fe8ff" },
    { id: "borders", name: "Границы стран", kind: "svg", vis: true, glow: "#ff3fd0" },
    { id: "coast", name: "Береговая линия", kind: "svg", vis: true },
    { id: "paint", kind: "canvas", internal: true },
    { id: "labels", name: "Страны", kind: "svg", vis: true, glow: "#ff7fd8" },
    { id: "provLabels", name: "Названия провинций", kind: "svg", vis: true },
    { id: "cities", name: "Города", kind: "svg", vis: true },
    { id: "forces", name: "Армии и флоты", kind: "svg", vis: true, internal: true }, // слой личной карты (армии, флоты, зоны): в общей легенде его нет, значки видит только игрок своей страны и ГМ
    { id: "measure", kind: "svg", internal: true },
    { id: "over", kind: "svg", internal: true },
    { id: "cursor", kind: "svg", internal: true, nowrap: true } // курсор кисти: не повторяется по краям
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
      el = document.createElement("img"); el.alt = ""; el.draggable = false; el.decoding = "async";
      el.dataset.src = l.src; // выключенные слои грузятся при включении, включённые — после показа карты (loadLayers)
      el.dataset.lo = l.src.replace(/\.webp$/, "_lo.webp"); // половинный размер — для общего вида
    } else if (l.kind === "div") {
      el = document.createElement("div");
    } else if (l.kind === "canvas") {
      el = document.createElement("canvas"); el.width = 1; el.height = 1; // полный размер — при первом мазке ГМа (pctx)
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
  // холст предпросмотра кисти (W×H×4 байт) создаётся при первом мазке ГМа, у игроков его нет
  let paintCtx = null;
  function pctx() {
    if (!paintCtx) { L.paint.width = W; L.paint.height = H; paintCtx = L.paint.getContext("2d", { willReadFrequently: true }); }
    return paintCtx;
  }
  // Бесшовная карта: картинки повторяются по краям сразу (это дёшево), векторные слои —
  // после загрузки, по одному в свободное время, чтобы не тормозить первую отрисовку.
  const WR = window.KGWrap.create(world, W, H);
  flat.forEach(l => { if (!l.nowrap && l.kind !== "svg") WR.add(L[l.id]); });
  let wrapQueued = false;
  function wrapVectorLayers() {
    if (wrapQueued) return; wrapQueued = true;
    const todo = flat.filter(l => l.kind === "svg" && !l.nowrap);
    const idle = window.requestIdleCallback || (f => setTimeout(f, 30));
    const next = () => { const l = todo.shift(); if (!l) return; WR.add(L[l.id]); idle(next, { timeout: 400 }); };
    idle(next, { timeout: 400 });
  }

  const isVisible = l => (ui.vis[l.id] != null ? ui.vis[l.id] : l.vis);
  const provLayerOn = () => ["provBorders", "provLabels"].some(id => { const l = flat.find(x => x.id === id); return l && isVisible(l); });
  // Рисунок слоя: на общем виде — половинного размера (_lo.webp, в 3 раза легче), полный — когда карту приблизили
  // настолько, что половинного не хватает (hiNeeded), или его просит глобус. Полный сначала грузится и раскодируется
  // в стороне, потом подменяет половинный — без мигания и без долгого кадра.
  let hiOn = false;
  const hiNeeded = () => s * (window.devicePixelRatio || 1) > 0.6;
  function ensureSrc(img) {
    if (img && img.tagName === "IMG" && !img.getAttribute("src") && img.dataset.src) img.src = hiOn || !img.dataset.lo ? img.dataset.src : img.dataset.lo;
  }
  async function toFull(img) {
    if (!img || img.tagName !== "IMG" || !img.dataset.src) return;
    const full = img.dataset.src;
    if (img.getAttribute("src") !== full) {
      const pre = new Image(); pre.src = full;
      try { await pre.decode(); } catch (e) { /* не раскодировалось — подставим как есть */ }
      img.src = full;
      if (img === L.relief) L.landDark.src = full; // подложка суши — тот же рисунок
    }
    await whenLoaded(img);
  }
  const LAYER_ORDER = ["relief", "hydro", "road_major", "road_secondary", "citiesFill", "road_road", "rail"];
  const imgLayers = () => flat.filter(l => l.kind === "img" && l.id !== "landDark")
    .sort((a, b) => (LAYER_ORDER.indexOf(a.id) + 1 || 99) - (LAYER_ORDER.indexOf(b.id) + 1 || 99));
  async function upgradeLayers() {
    if (hiOn) return; hiOn = true;
    for (const l of imgLayers()) if (L[l.id].getAttribute("src")) await toFull(L[l.id]);
  }
  // Рисунки слоёв (рельеф, реки, дороги) весят мегабайты. На медленном канале они отнимали скорость у данных границ,
  // поэтому грузятся после показа карты и по одному: сначала рельеф, затем реки, дороги, городские зоны.
  let layersGo = false; // до показа карты включённые слои рисунков не грузим
  async function loadLayers() {
    layersGo = true;
    if (hiNeeded()) hiOn = true; // карту открыли сразу приближенной (страна из адреса) — полные рисунки
    for (const l of imgLayers()) {
      const el = L[l.id];
      if (!isVisible(l) || el.getAttribute("src")) continue;
      el.fetchPriority = "low"; ensureSrc(el);
      if (l.id === "relief") L.landDark.src = el.getAttribute("src"); // подложка суши — тот же рисунок
      await whenLoaded(el);
    }
    if (!L.landDark.getAttribute("src")) { ensureSrc(L.landDark); } // рельеф выключен — подложке нужен свой
  }
  function applyLayer(l) {
    const el = L[l.id]; if (!el || l.internal) return;
    try { if (globe) globeDirty(); } catch (e) { /* глобус ещё не создан */ }
    el.style.display = isVisible(l) ? "" : "none";
    if ((l.id === "provBorders" || l.id === "provLabels") && isVisible(l)) setTimeout(() => ensureProvinces(), 0); // слой «Провинции» строится сразу, на любом масштабе
    if (isVisible(l) && layersGo) ensureSrc(el);
    if (l.road) {
      const on = !!ui.hl[l.id];
      el.classList.toggle("hl", on);
      el.style.filter = on ? `brightness(0) invert(1) drop-shadow(0 0 1.5px ${l.road})` : ""; // одно свечение вместо трёх: тот же вид, втрое дешевле
    }
    if (l.glow) {
      el.classList.toggle("hl", !!ui.hl[l.id]);
      el.style.setProperty("--glow", l.glow);
    }
    if (l.id === "alliances") allyVisChanged();
  }
  function buildLayerList() {
    const list = $("layerList"); list.innerHTML = "";
    const row = (l, sub) => {
      const r = document.createElement("label"); r.className = "layer-row" + (sub ? " sub" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = isVisible(l);
      cb.addEventListener("change", () => { ui.vis[l.id] = cb.checked; applyLayer(l); saveUi(); syncGroups(); });
      r.append(cb);
      const hlc = l.road || l.glow;
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
    try { refreshCityKey(); } catch (e) { /* при первом построении города ещё не готовы */ }
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
  setTimeout(() => { applyCityTypeVis(); refreshCityKey(); }, 0);

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
    </g></symbol>
    <symbol id="capStar" viewBox="-12 -12 24 24"><path d="M0-11 3.2-3.6 11.2-3.4 4.9 1.6 7.1 9.3 0 4.8-7.1 9.3-4.9 1.6-11.2-3.4-3.2-3.6Z" fill="#ffd34d" stroke="#3a2600" stroke-width="1.8" stroke-linejoin="round"/></symbol></defs>`;
  // градиент для названий стран — светлый, чтобы не сливаться с тёмными границами
  L.labels.insertAdjacentHTML("afterbegin", `<defs><linearGradient id="lblGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff4fd"/><stop offset=".5" stop-color="#ffc3ef"/><stop offset="1" stop-color="#ff74d4"/></linearGradient></defs>`);
  const gCountryLabels = svgEl("g", {}, L.labels);
  const gCustom = svgEl("g", {}, L.labels);
  const provSelPath = svgEl("path", { class: "prov-sel-outline" }, L.over);
  const selPath = svgEl("path", { class: "sel-outline" }, L.over);
  const cursorEl = svgEl("circle", { class: "brush-cursor", r: 10, cx: -100, cy: -100 }, L.cursor);

  // ---------- состояние ----------
  let config = null, state = null, loadedStamp = "";
  let gm = false, dirty = false, terrDirty = false, provDirty = false, selProv = null, provReady = false;
  const provPaths = new Map(), provEls = {}, provLbl = {};
  function setProvPath(id, d) {
    id = String(id); provPaths.set(id, d || "");
    let e = provEls[id];
    if (!e) { e = svgEl("path", {}, L.provBorders); provEls[id] = e; const pr = state.provinces && state.provinces[id]; if (pr && pr.type === "Акватория") e.classList.add("sea"); } // акватории светлее: на тёмном океане иначе не видны
    e.setAttribute("d", d || "");
    if (selProv === id) provSelPath.setAttribute("d", d || "");
  }
  const els = { cfill: {}, cborder: {}, clabel: {}, cities: {}, labels: {}, satellites: {}, satTypes: {}, debris: {}, settings: {}, alliances: {}, currencies: {} };
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
    scheduleAlly();
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
    const fs = +(c.size * fk("country")).toFixed(2); // размер подписи × общий масштаб ГМа
    t.setAttribute("font-size", fs); t.setAttribute("letter-spacing", (fs * 0.22).toFixed(1));
    t.setAttribute("stroke-width", Math.max(0.8, fs * 0.14).toFixed(1));
    window.KG.lines.svg(t, c.name);
  }
  // ---------- города: типы по населению, столицы, всплывающая карточка ----------
  // Тип берётся из населения (или задаётся ГМом вручную). Размер значка и кольцо зависят от типа,
  // у столиц — золотая звезда. Названия на карте не пишутся: они в подсказке и в карточке города.
  const CITY_TYPES = [
    { id: "mega", name: "Мегаполис", range: "свыше 10 млн", min: 1e7, size: 16, ring: "#ff3fd0", z: 0 },
    { id: "agglo", name: "Агломерация", range: "5–10 млн", min: 5e6, size: 14, ring: "#ff9b3d", z: 0 },
    { id: "million", name: "Крупнейший город", range: "1–5 млн", min: 1e6, size: 12, ring: "#ffe14d", z: 0 },
    { id: "large", name: "Крупный город", range: "250 тыс. – 1 млн", min: 2.5e5, size: 10, ring: "", z: 1 },
    { id: "big", name: "Большой город", range: "100–250 тыс.", min: 1e5, size: 8.5, ring: "", z: 2 },
    { id: "medium", name: "Средний город", range: "50–100 тыс.", min: 5e4, size: 7.2, ring: "", z: 2 },
    { id: "small", name: "Малый город", range: "до 50 тыс.", min: 0, size: 6, ring: "", z: 3 }
  ];
  const CT = Object.fromEntries(CITY_TYPES.map(t => [t.id, t]));
  function cityType(c) {
    if (c.type && CT[c.type]) return CT[c.type];
    const p = +c.pop;
    if (!(p > 0)) return CT.medium; // население неизвестно
    return CITY_TYPES.find(t => p >= t.min) || CT.small;
  }
  const fmtPop = p => (p >= 1e6 ? (p / 1e6).toFixed(p >= 1e7 ? 1 : 2).replace(/\.?0+$/, "").replace(".", ",") + " млн"
    : p >= 1e4 ? Math.round(p / 1e3).toLocaleString("ru-RU") + " тыс." : Math.round(p).toLocaleString("ru-RU")) + " жителей";
  // Значки городов — по 6 элементов на город. На общем виде видны только столицы и города от миллиона, остальные ярусы
  // (CSS: #mapFrame[data-cz]) создаются при первом приближении до их масштаба.
  let cityZ = 0;
  function showCityTier(z) {
    if (z <= cityZ) return;
    cityZ = z;
    if (state && state.cities) for (const id in state.cities) if (!els.cities[id]) renderCity(id);
  }
  function renderCity(id) {
    const c = state.cities[id];
    let g = els.cities[id];
    if (!c) { if (g) { g.remove(); delete els.cities[id]; } if (popCity === id) closeCityPop(); return; }
    if (!g) {
      if (!c.capital && cityType(c).z > cityZ) return; // ярус скрыт на этом масштабе — создадим при приближении (showCityTier)
      g = svgEl("g", { "data-col": "cities", "data-id": id }, L.cities);
      const ci = svgEl("g", { class: "ci" }, g);
      svgEl("circle", { class: "c-ring", r: 0 }, ci);
      svgEl("use", { href: "#cityIcon", "data-col": "cities", "data-id": id, "data-part": "icon" }, ci);
      svgEl("use", { href: "#capStar", class: "c-cap", "data-col": "cities", "data-id": id, "data-part": "icon" }, ci);
      svgEl("title", {}, g);
      els.cities[id] = g;
    }
    const t = cityType(c), sz = t.size, ci = g.firstChild, [ring, icon, star] = ci.childNodes;
    g.setAttribute("class", "city t-" + t.id + (c.capital ? " cap" : "") + (sel && sel.col === "cities" && sel.id === id ? " is-sel" : ""));
    g.setAttribute("transform", `translate(${c.x} ${c.y})`);
    icon.setAttribute("x", -sz / 2); icon.setAttribute("y", -sz / 2); icon.setAttribute("width", sz); icon.setAttribute("height", sz);
    ring.setAttribute("r", (sz / 2 + 1.1).toFixed(2)); ring.style.stroke = t.ring || "none";
    const ss = Math.max(5, sz * 0.6);
    star.setAttribute("x", (sz * 0.18).toFixed(2)); star.setAttribute("y", (-sz * 0.5 - ss * 0.35).toFixed(2));
    star.setAttribute("width", ss.toFixed(2)); star.setAttribute("height", ss.toFixed(2));
    g.lastChild.textContent = window.KG.lines.oneLine(c.name) + " — " + t.name.toLowerCase() + (c.capital ? ", столица" : "");
    if (popCity === id) fillCityPop();
  }

  // всплывающая карточка города
  let popCity = null, popAt = null; // popAt — точка на экране для глобуса
  const pop = $("cityPop");
  function cityCountry(c) { const v = T.at(c.x, c.y); const k = v && state.countries[String(v)]; return k ? window.KG.lines.oneLine(k.name) : ""; }
  function fillCityPop() {
    const c = state.cities[popCity]; if (!c) { closeCityPop(); return; }
    const t = cityType(c), country = cityCountry(c);
    const rows = [];
    rows.push(`<div class="cp-row"><span>Тип</span><b>${esc(t.name)}</b><small>${esc(t.range)}${c.type ? "" : c.pop ? " · по населению" : ""}</small></div>`);
    rows.push(`<div class="cp-row"><span>Население</span><b>${c.pop ? esc(fmtPop(+c.pop)) : "нет данных"}</b>${c.popYear ? `<small>${esc(String(c.popYear))} г.</small>` : ""}</div>`);
    if (country) rows.push(`<div class="cp-row"><span>Страна</span><b>${esc(country)}</b></div>`);
    pop.innerHTML = `<button class="cp-close" title="Закрыть">✕</button>` +
      `<div class="cp-head"><span class="cp-ico t-${t.id}${c.capital ? " cap" : ""}"></span><div><div class="cp-name">${esc(window.KG.lines.oneLine(c.name))}</div>` +
      (c.capital ? `<div class="cp-cap">★ Столица${country ? " · " + esc(country) : ""}</div>` : "") + `</div></div>` +
      rows.join("") +
      (c.desc ? `<p class="cp-desc">${esc(c.desc)}</p>` : `<p class="cp-desc cp-empty">${gm ? "Описания пока нет — нажмите «Изменить»." : "Описания пока нет."}</p>`) +
      `<div class="cp-foot">` + (c.wiki ? `<a href="https://ru.wikipedia.org/wiki/${encodeURIComponent(c.wiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">Википедия</a><small>текст — CC BY-SA</small>` : "<span></span>") +
      (gm ? `<button class="small-btn" id="cpEdit">Изменить</button>` : "") + `</div>`;
    pop.querySelector(".cp-close").onclick = closeCityPop;
    const ed = $("cpEdit"); if (ed) ed.onclick = () => editCity(popCity);
    placeCityPop();
  }
  function placeCityPop() {
    if (!popCity) return;
    const c = state.cities[popCity]; if (!c) return;
    const fr = frame.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    let x, y;
    if (popAt) { x = popAt[0]; y = popAt[1]; }
    else { x = vr.left - fr.left + screenX(c.x); y = vr.top - fr.top + ty + c.y * s; }
    const w = pop.offsetWidth || 280, h = pop.offsetHeight || 160, pad = 8;
    let left = x + 14, top = y - h / 2;
    if (left + w > fr.width - pad) left = x - w - 14;
    left = Math.max(pad, Math.min(fr.width - w - pad, left));
    top = Math.max(pad, Math.min(fr.height - h - pad, top));
    pop.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    const off = !popAt && (x < 0 || y < 0 || x > fr.width || y > fr.height);
    pop.classList.toggle("off", off);
  }
  function showCityPop(id, at) {
    popCity = String(id); popAt = at || null;
    pop.classList.remove("hidden");
    fillCityPop();
  }
  function closeCityPop() {
    popCity = null; popAt = null; pop.classList.add("hidden");
    if (sel && sel.col === "cities") select(null);
  }
  async function editCity(id) {
    if (!gm) return;
    const before = state.cities[id]; if (!before) return;
    const v = await openForm("Город: " + window.KG.lines.oneLine(before.name), [
      { key: "name", label: "Название", hint: "« ↵ » — перенос строки" },
      { key: "type", label: "Тип", type: "select", options: [["", "Авто — по населению"]].concat(CITY_TYPES.map(t => [t.id, t.name + " (" + t.range + ")"])) },
      { key: "pop", label: "Население, чел.", type: "number", min: 0, step: 1 },
      { key: "capital", label: "Столица", type: "select", options: [["", "Нет"], ["1", "Да — столица страны"]] },
      { key: "desc", label: "Краткое описание", type: "textarea" },
      { key: "wiki", label: "Статья Википедии", hint: "Название статьи, например: Москва" }
    ], { name: window.KG.lines.toInput(before.name), type: before.type || "", pop: before.pop || "", capital: before.capital ? "1" : "", desc: before.desc || "", wiki: before.wiki || "",
      __opts: { validate: x => (!x.name ? "Укажите название" : x.pop !== "" && (+x.pop < 0 || !isFinite(+x.pop)) ? "Население — неотрицательное число" : "") } });
    if (!v) return;
    const a = clone(before);
    a.name = window.KG.lines.fromInput(v.name) || before.name;
    if (v.type) a.type = v.type; else delete a.type;
    if (v.pop !== "" && +v.pop > 0) a.pop = Math.round(+v.pop); else delete a.pop;
    if (v.capital) a.capital = true; else delete a.capital;
    if (v.desc) a.desc = v.desc; else delete a.desc;
    if (v.wiki) a.wiki = v.wiki; else delete a.wiki;
    if (a.pop !== before.pop) delete a.popYear;
    commit("cities", id, before, a);
    toast("Город обновлён (опубликуйте, чтобы увидели все)");
  }
  // подписи типов городов в «Слоях»: значок, название, сколько таких, переключатель
  function cityKey() {
    const box = document.createElement("div"); box.className = "city-key";
    const counts = {};
    for (const c of Object.values(state ? state.cities : {})) { const t = cityType(c).id; counts[t] = (counts[t] || 0) + 1; }
    for (const t of CITY_TYPES) {
      const r = document.createElement("label"); r.className = "layer-row sub";
      const on = ui.vis["ct_" + t.id] !== false;
      r.innerHTML = `<input type="checkbox" ${on ? "checked" : ""}><span class="cp-ico t-${t.id}"></span><span class="lname">${t.name}<small> ${t.range}</small></span><span class="ck-n">${counts[t.id] || 0}</span>`;
      r.querySelector("input").addEventListener("change", e => { ui.vis["ct_" + t.id] = e.target.checked; applyCityTypeVis(); saveUi(); });
      box.append(r);
    }
    const cap = document.createElement("div"); cap.className = "layer-row sub ck-cap";
    cap.innerHTML = `<span class="cp-ico t-large cap"></span><span class="lname">Столица — звезда у значка</span><span class="ck-n">${Object.values(state ? state.cities : {}).filter(c => c.capital).length}</span>`;
    box.append(cap);
    return box;
  }
  function applyCityTypeVis() { for (const t of CITY_TYPES) L.cities.classList.toggle("hide-" + t.id, ui.vis["ct_" + t.id] === false); }
  function refreshCityKey() {
    const l = flat.find(x => x.id === "cities"); if (!l || !l._cb) return;
    const row = l._cb.closest(".layer-row"); if (!row) return;
    const old = row.parentElement.querySelector(".city-key"); if (old) old.remove();
    row.after(cityKey());
  }
  function renderLabel(id) {
    const e = state.labels[id];
    let t = els.labels[id];
    if (!e) { if (t) { t.remove(); delete els.labels[id]; } return; }
    if (!t) { t = svgEl("text", { class: "lbl-custom", "data-col": "labels", "data-id": id }, gCustom); els.labels[id] = t; }
    const fs = +(e.size * fk("custom")).toFixed(2);
    t.setAttribute("x", e.x); t.setAttribute("y", e.y); t.setAttribute("font-size", fs);
    t.setAttribute("letter-spacing", (fs * 0.15).toFixed(1));
    window.KG.lines.svg(t, e.text);
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
    t.setAttribute("x", e.label[0]); t.setAttribute("y", e.label[1]); t.style.setProperty("--fs", +(e.size * fk("province")).toFixed(2) + "px");
    window.KG.lines.svg(t, e.name);
  }
  const renderSatsAny = () => { try { refreshSats(); } catch (e) { /* глобус ещё не готов */ } };
  const RENDER = { countries: renderCountry, cities: renderCity, labels: renderLabel, provinces: renderProvince, satellites: renderSatsAny, satTypes: renderSatsAny, debris: renderSatsAny, settings: () => applyFonts(), alliances: () => scheduleAlly(),
    currencies: () => { if (sel && sel.col === "countries") renderStateCard(); citiesChanged(); } };
  const COLS = ["countries", "cities", "labels", "provinces", "satellites", "satTypes", "debris", "settings", "alliances", "currencies"];

  // ---------- союзы (фракции): слой «Союзы» и вкладка легенды ----------
  // Союз — запись в state.alliances { id, name, color, leader, desc }; страна входит в союз полем country.alliance.
  // Слой рисует страны союза его цветом, остальные притемняет. Луна берёт союзы отсюда же (событие kg-alliances).
  const allyLayer = LAYERS.find(l => l.id === "alliances");
  const allyOn = () => isVisible(allyLayer);
  const allyOf = c => (c && c.alliance && state && state.alliances && state.alliances[c.alliance]) || null;
  let allyHl = null, allyOpen = null, allyQueued = false, allyStale = true;
  function scheduleAlly() {
    allyStale = true;
    if (allyQueued) return; allyQueued = true;
    setTimeout(() => { allyQueued = false; if (allyOn()) renderAlliances(); }, 0); // rAF в фоновой вкладке не идёт
  }
  function renderAlliances() {
    if (!state) return;
    const by = {}, none = [];
    for (const id in state.countries) {
      const d = paths.get(id); if (!d) continue;
      const a = allyOf(state.countries[id]);
      if (a) (by[a.id] = by[a.id] || []).push(d); else none.push(d);
    }
    let h = `<path class="al-none" d="${none.join("")}"/>`;
    for (const a of Object.values(state.alliances || {})) {
      if (by[a.id]) h += `<path class="al-fill${allyHl === a.id ? " hl" : ""}" data-al="${esc(a.id)}" fill="${esc(a.color)}" d="${by[a.id].join("")}"/>`;
    }
    L.alliances.innerHTML = h;
    allyStale = false;
  }
  function setAllyHl(id) {
    allyHl = id || null;
    L.alliances.querySelectorAll("path.al-fill").forEach(p => p.classList.toggle("hl", p.dataset.al === allyHl));
  }
  function allyVisChanged() {
    try {
      if (!state) return;
      if (allyOn() && allyStale) renderAlliances();
      const cb = $("allyShow"); if (cb) cb.checked = allyOn();
      if (globe && viewMode === "globe") syncGlobe(false);
    } catch (e) { /* при первом построении слоёв карта ещё не загружена */ }
  }
  function showAllyLayer(on) {
    ui.vis.alliances = on; if (allyLayer._cb) allyLayer._cb.checked = on;
    applyLayer(allyLayer); saveUi();
  }
  const allyChanged = () => { scheduleAlly(); buildAllyList(); window.dispatchEvent(new Event("kg-alliances")); };
  function buildAllyList() {
    const list = $("allyList"); if (!list || !state) return;
    $("allyShow").checked = allyOn();
    list.innerHTML = "";
    const all = Object.values(state.alliances || {}).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!all.length) { list.innerHTML = `<div class="small">Союзов пока нет.</div>`; return; }
    const one = window.KG.lines.oneLine;
    for (const a of all) {
      const mem = Object.values(state.countries).filter(c => c.alliance === a.id)
        .sort((x, y) => (x.id === a.leader ? -1 : y.id === a.leader ? 1 : one(x.name).localeCompare(one(y.name), "ru")));
      const r = document.createElement("div"); r.className = "c-row al-row" + (allyOpen === a.id ? " active" : ""); r.dataset.al = a.id;
      r.title = "Показать страны союза";
      r.innerHTML = `<span class="swatch" style="background:${esc(a.color)}"></span><span class="c-name">${esc(a.name)}</span><span class="al-n">${mem.length}</span>` +
        (gm ? `<button class="c-go" title="Изменить союз">✎</button><button class="c-del" title="Удалить союз">✕</button>` : "");
      r.addEventListener("click", e => {
        if (e.target.closest(".c-go")) { editAlly(a.id); return; }
        if (e.target.closest(".c-del")) { deleteAlly(a.id); return; }
        allyOpen = allyOpen === a.id ? null : a.id;
        if (allyOpen && !allyOn()) showAllyLayer(true);
        setAllyHl(allyOpen); buildAllyList();
      });
      r.addEventListener("mouseenter", () => setAllyHl(a.id));
      r.addEventListener("mouseleave", () => setAllyHl(allyOpen));
      list.append(r);
      if (allyOpen !== a.id) continue;
      const box = document.createElement("div"); box.className = "al-members";
      if (a.desc) { const d = document.createElement("div"); d.className = "al-desc"; d.textContent = a.desc; box.append(d); }
      if (!mem.length) box.insertAdjacentHTML("beforeend", `<div class="small">На карте Земли стран в союзе нет.</div>`);
      for (const c of mem) {
        const m = document.createElement("div"); m.className = "c-row";
        m.innerHTML = `<span class="swatch" style="background:${esc(c.color)}"></span><span class="c-name">${esc(one(c.name))}${c.id === a.leader ? ' <small class="al-lead">лидер</small>' : ""}</span>`;
        m.addEventListener("click", () => focusCountry(c.id));
        box.append(m);
      }
      list.append(box);
    }
  }
  async function editAlly(id) {
    if (!gm) return;
    const before = id ? state.alliances[id] : null, one = window.KG.lines.oneLine;
    const leaders = [["", "—"]].concat(Object.values(state.countries).map(c => [c.id, one(c.name)]).sort((x, y) => x[1].localeCompare(y[1], "ru")));
    const base = Object.assign(before ? clone(before) : { name: "", color: "#9fb4d8", leader: "", desc: "" }, { __opts: { validate: v => (v.name ? "" : "Введите название союза") } });
    const v = await openForm(before ? "Союз: " + before.name : "Новый союз", [
      { key: "name", label: "Название" },
      { key: "color", label: "Цвет на слое «Союзы»", type: "color" },
      { key: "leader", label: "Лидер", type: "select", options: leaders, hint: "Лидер сразу входит в союз. Остальные страны — в карточке страны, поле «Союз»; территории Луны — в карточке территории" },
      { key: "desc", label: "Описание", type: "textarea" }
    ], base);
    if (!v) return;
    const nid = before ? id : uid("al_");
    const rec = { id: nid, name: v.name, color: v.color, leader: v.leader && state.countries[v.leader] ? v.leader : "", desc: v.desc };
    const items = [{ kind: "entity", col: "alliances", id: nid, before: clone(before), after: rec }];
    const lc = rec.leader ? state.countries[rec.leader] : null;
    if (lc && lc.alliance !== nid) { const a = clone(lc); a.alliance = nid; items.push({ kind: "entity", col: "countries", id: lc.id, before: clone(lc), after: a }); }
    pushUndo({ kind: "multi", items }); items.forEach(it => applyEntry(it, false));
    allyOpen = nid; buildAllyList();
    toast(before ? "Союз изменён" : "Союз создан");
  }
  async function deleteAlly(id) {
    const a = state.alliances[id]; if (!a || !gm) return;
    const mem = Object.values(state.countries).filter(c => c.alliance === id);
    const ok = await ask("Удалить союз «" + a.name + "»?", "", { confirm: true, note: (mem.length ? "Из союза выйдут страны: " + mem.length + ". " : "") + "Ctrl+Z — вернуть." });
    if (!ok) return;
    const items = mem.map(c => { const x = clone(c); delete x.alliance; return { kind: "entity", col: "countries", id: c.id, before: clone(c), after: x }; });
    items.push({ kind: "entity", col: "alliances", id, before: clone(a), after: null });
    pushUndo({ kind: "multi", items }); items.forEach(it => applyEntry(it, false));
    if (allyOpen === id) allyOpen = null;
    buildAllyList();
  }
  function setCountryAlly(id, v) {
    const c = state.countries[id]; if (!c || !gm || (c.alliance || "") === v) return;
    const a = clone(c); if (v) a.alliance = v; else delete a.alliance;
    commit("countries", id, c, a);
  }

  // ---------- вид ----------
  let s = 0.3, tx = 0, ty = 0, fitS = 0.3;
  // holdWrap: пока ГМ рисует или тащит объект, вид не перескакивает между копиями карты
  let holdWrap = false;
  // карта повторяется по горизонтали, поэтому отдалять дальше половины ширины окна незачем
  const minScale = () => Math.max(fitS * 0.7, viewport.clientWidth / (2 * W));
  const afterView = [];
  function setView(ns, ntx, nty, keep) {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    s = Math.min(8, Math.max(minScale(), ns));
    const mw = W * s, mh = H * s;
    tx = keep || holdWrap ? ntx : WR.norm(ntx, mw, vw);
    ty = mh < vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, nty));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    WR.show(tx, mw, vw);
    // Всё, что ниже, меняем только при переходе порога: любая смена стиля на рамке заставляет
    // браузер пересчитать тысячи элементов карты, а это и есть «подлагивание» при масштабировании.
    const cityVis = s < 0.3 ? "hidden" : "", z = String(s >= 3.2 ? 3 : s >= 1.9 ? 2 : s >= 1.1 ? 1 : 0);
    const cz = String(s >= 1.8 ? 3 : s >= 1.1 ? 2 : s >= 0.6 ? 1 : 0);
    const ck = s > 1.8 ? (Math.round(1.8 / s * 20) / 20).toFixed(2) : "1"; // значки не раздуваются при приближении
    if (frame.dataset.cz !== cz) frame.dataset.cz = cz;
    showCityTier(+cz);
    // переменные — на world, а не на слоях: правка слоя заставила бы пересобрать его копии по краям
    if (world.style.getPropertyValue("--ck") !== ck) world.style.setProperty("--ck", ck);
    const lod = s < 0.5 ? "far" : "near"; // издалека границы провинций не читаются, а рисовать их дорого
    const pk = Math.min(1, 2.4 / s).toFixed(2); // названия провинций не раздуваются при приближении
    if (L.cities.style.visibility !== cityVis) L.cities.style.visibility = cityVis;
    if (frame.dataset.z !== z) frame.dataset.z = z;
    if (frame.dataset.lod !== lod) frame.dataset.lod = lod;
    if (world.style.getPropertyValue("--pk") !== pk) world.style.setProperty("--pk", pk);
    if (typeof renderMeasure === "function") renderMeasure();
    if (typeof popCity !== "undefined" && popCity && !popAt) placeCityPop();
    afterView.forEach(f => f());
    if (layersGo && !hiOn && hiNeeded()) upgradeLayers(); // приблизили — полные рисунки слоёв
    if ((lod === "near" || provLayerOn()) && !provP) ensureProvinces(); // приблизили — границы и подписи провинций
  }
  // экранная x точки карты — на той копии, что ближе к центру окна
  function screenX(x) {
    const mw = W * s, vw = viewport.clientWidth;
    const sx = tx + x * s;
    return sx + mw * Math.round((vw / 2 - sx) / mw);
  }
  function fit() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!vw || !vh) return;
    fitS = Math.min(vw / W, vh / H);
    setView(fitS, (vw - W * fitS) / 2, (vh - H * fitS) / 2);
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(8, Math.max(minScale(), s * f)), k = ns / s;
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
  // Во время масштабирования прячем мелкие детали (границы и названия провинций, города) —
  // браузеру не приходится перерисовывать тысячи элементов в каждом кадре. Через 0,25 с после
  // остановки они возвращаются. При перетаскивании карта рисуется слоем GPU (класс panning).
  let movingTimer = 0;
  function markMoving() {
    if (!frame.classList.contains("moving")) frame.classList.add("moving");
    clearTimeout(movingTimer);
    movingTimer = setTimeout(() => frame.classList.remove("moving"), 250);
  }
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    markMoving();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("zoomIn").onclick = () => (viewMode === "globe" ? globeZoom(1.4) : zoomAt(1.4, viewport.clientWidth / 2, viewport.clientHeight / 2));
  $("zoomOut").onclick = () => (viewMode === "globe" ? globeZoom(1 / 1.4) : zoomAt(1 / 1.4, viewport.clientWidth / 2, viewport.clientHeight / 2));
  $("zoomFit").onclick = () => (viewMode === "globe" ? globeZoom(0) : fit());
  window.addEventListener("resize", () => { const was = Math.abs(s - fitS) < 1e-6; const vw = viewport.clientWidth, vh = viewport.clientHeight; fitS = Math.min(vw / W, vh / H); if (was) fit(); else setView(s, tx, ty); });
  // страна из адреса #map/earth/flat/<номер>: после любой подгонки карты под окно снова приближаемся к ней
  let focusId = null;
  const refit = () => { fit(); if (focusId && state.countries[focusId] && viewMode !== "globe") focusCountry(focusId); };
  window.addEventListener("tabchange", e => { if (e.detail === "map") requestAnimationFrame(refit); });

  // ---------- выбор и легенда ----------
  let sel = null;
  function select(ent) {
    document.querySelectorAll(".is-sel").forEach(el => el.classList.remove("is-sel"));
    sel = ent && state[ent.col] && state[ent.col][ent.id] ? { col: ent.col, id: String(ent.id) } : null;
    // кнопки размера шрифта — у выбранной страны или подписи (клик по карте добавит и провинцию)
    if (typeof sizeTargets !== "undefined") sizeTargets = sel && (sel.col === "countries" || sel.col === "labels") ? [{ col: sel.col, id: sel.id }] : [];
    if (sel) {
      const map = { cities: els.cities, labels: els.labels, countries: els.clabel }[sel.col];
      if (map && map[sel.id]) map[sel.id].classList.add("is-sel");
    }
    selPath.setAttribute("d", sel && sel.col === "countries" ? paths.get(sel.id) || "" : "");
    provSelPath.setAttribute("d", selProv ? provPaths.get(selProv) || "" : "");
    try { if (globe) globeDirty(); } catch (e) { /* */ }
    if (sel && sel.col === "cities") { if (popCity !== sel.id || popAt) showCityPop(sel.id); }
    else if (popCity && !popAt) { popCity = null; pop.classList.add("hidden"); }
    updateCard();
    markListSelection();
  }
  const nameInp = $("countryName"), colorInp = $("countryColor");
  function flagSrc(c) { return flagCache[c.id] || c.flag || ""; }
  function updateCard() {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    $("countryTitle").textContent = c ? window.KG.lines.oneLine(c.name) : "Выберите страну на карте";
    nameInp.disabled = colorInp.disabled = !c;
    $("flagClear").disabled = !(c && (c.flag || flagCache[c.id]));
    if (document.activeElement !== nameInp) nameInp.value = c ? window.KG.lines.toInput(c.name) : "";
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
      $("provTitle").textContent = window.KG.lines.oneLine(pr.name);
      if (document.activeElement !== $("provName")) $("provName").value = window.KG.lines.toInput(pr.name);
      $("provMeta").textContent = [pr.type, gm && pr.real ? "в нашем мире: " + pr.real : ""].filter(Boolean).join(" · ");
    }
    $("flagBox").classList.toggle("can-edit", gm && !!c);
    renderStateCard();
    placeSizeBar();
  }

  // ---------- карточка государства (пока заглушка) ----------
  // Открывается по клику на страну, стоит у правого края карты — слева от легенды. Что можно
  // посчитать по карте — столица, площадь, провинции, города — считается; остальное ждёт данных.
  const stateCard = $("stateCard");
  let stateCardOn = false; // карточка открыта кнопкой «Карточка» (клик по стране её не открывает)
  let stateCardClosed = null; // id страны, у которой карточку закрыли крестиком
  function countryArea(id) {
    // площадь по маске: пиксель Меркатора на широте φ — (длина экватора / W · cos φ)²
    const b = T.bbox[+id]; if (!b || !T.ids) return 0;
    const k = 40075.017 / W, R = W / (2 * Math.PI), Y0 = 2063.21;
    let a = 0;
    for (let y = b[1]; y < b[3]; y++) {
      const row = y * T.W; let n = 0;
      for (let x = b[0]; x < b[2]; x++) if (T.ids[row + x] === +id) n++;
      if (n) { const c = 1 / Math.cosh((Y0 - y - 0.5) / R); a += n * k * k * c * c; }
    }
    return a;
  }
  const fmtArea = a => (a >= 1e6 ? (a / 1e6).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + " млн км²" : Math.round(a).toLocaleString("ru-RU") + " км²");
  // Поля карточки, которые ГМ пишет сам (хранятся в countries[id].info). Пустое поле — показываем
  // то, что посчитано по карте (столица — по отметкам столиц), или «—». Население считается всегда само:
  // города страны + пустоши (доля pw от городов); валюта — из справочника валют (state.currencies, info.cur).
  const INFO = [
    ["capital", "Столица"], ["gov", "Форма правления"], ["head", "Глава государства"], ["lang", "Язык"]
  ];
  const fmtMln = p => (p >= 1e6 ? (p / 1e6).toFixed(p >= 1e8 ? 0 : 1).replace(".", ",") + " млн" : Math.round(p / 1e3).toLocaleString("ru-RU") + " тыс.");
  const fmtRate = v => (+v).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  const curOf = c => { const k = c && c.info && c.info.cur; return (k && state.currencies && state.currencies[k]) || null; };
  const curText = cu => cu.name + " (" + cu.sign + ")" + (cu.id === "kr" ? "" : " · 1 " + cu.sign + " = " + fmtRate(cu.rate) + " кр.");
  function curField(c) {
    const cu = curOf(c);
    if (gm) {
      const list = Object.values(state.currencies || {}).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, "ru"));
      return `<dt>Валюта</dt><dd><select class="sc-cur" title="Валюта страны (курсы — Вики → Лор → Валюты)"><option value="">—</option>` +
        list.map(x => `<option value="${esc(x.id)}"${cu && cu.id === x.id ? " selected" : ""}>${esc(curText(x))}</option>`).join("") + `</select></dd>`;
    }
    return `<dt>Валюта</dt>` + (cu ? `<dd>${esc(curText(cu))}</dd>` : `<dd class="sc-tbd">—</dd>`);
  }
  function popRows(id) {
    const P = countryPop(id);
    const sub = P.meg ? `<small class="sc-sub">города ${esc(fmtMln(P.meg))}` + (P.waste ? ` · пустоши ${esc(fmtMln(P.waste))}` : "") + `</small>` : "";
    return `<dt>Население</dt>` + (P.meg ? `<dd>≈ ${esc(fmtMln(P.total))}${sub}</dd>` : `<dd class="sc-tbd">—</dd>`) +
      (gm ? `<dt>Пустоши к городам</dt><dd><span class="pct-in"><input class="sc-in sc-pw" type="number" min="0" step="0.1" value="${P.pw != null ? +(P.pw * 100).toFixed(2) : ""}" placeholder="0" title="Сколько людей живёт в пустошах на каждые 100 жителей городов"> %</span></dd>` : "");
  }
  function renderStateCard() {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    if (!c || !stateCardOn || stateCardClosed === sel.id) { stateCard.classList.add("hidden"); return; } // открывается только кнопкой «Карточка»
    const body = $("stateCardBody");
    // ГМ печатает в поле карточки — не перерисовываем её под ним
    if (body.dataset.id === sel.id && body.contains(document.activeElement) && document.activeElement.matches(".sc-in")) return;
    const id = sel.id, info = c.info || {}, inC = Object.values(state.cities).filter(ct => String(T.at(ct.x, ct.y)) === id);
    const caps = inC.filter(ct => ct.capital).map(ct => window.KG.lines.oneLine(ct.name));
    const big = inC.filter(ct => +ct.pop > 0).sort((a, b) => b.pop - a.pop)[0];
    const provs = Object.values(state.provinces || {}).filter(p => p.label && String(T.at(p.label[0], p.label[1])) === id).length; // по положению на карте
    const area = countryArea(id), src = flagSrc(c);
    const auto = { capital: caps.join(", ") };
    const row = (k, v) => `<dt>${k}</dt><dd>${esc(v)}</dd>`;
    const field = (k, label) => {
      const v = info[k] || "";
      if (gm) return `<dt>${label}</dt><dd><input class="sc-in" data-k="${k}" value="${esc(v)}" placeholder="${esc(auto[k] || "—")}" maxlength="200"></dd>`;
      const shown = v || auto[k] || "";
      return `<dt>${label}</dt><dd${shown ? "" : ' class="sc-tbd"'}>${esc(shown || "—")}</dd>`;
    };
    const desc = info.desc || "";
    body.dataset.id = id;
    body.innerHTML = `<div class="sc-head"><div class="sc-flag${gm ? " can-edit" : ""}"${gm ? ' title="Загрузить флаг"' : ""}${src ? ` style="background-image:url('${esc(src)}')"` : ""}>${src ? "" : "ФЛАГ"}</div>` +
      `<div><div class="sc-kind"><span class="sc-swatch" style="background:${esc(c.color)}"></span>Государство</div>` +
      `<div class="sc-name">${esc(window.KG.lines.oneLine(c.name))}</div></div></div>` +
      `<dl class="sc-rows">` +
      INFO.slice(0, 1).map(([k, l]) => field(k, l)).join("") +
      allyField(c) +
      row("Площадь", area ? "≈ " + fmtArea(area) : "—") +
      row("Провинций", provs ? String(provs) : "—") +
      row("Городов на карте", inC.length ? String(inC.length) : "—") +
      (big ? row("Крупнейший город", window.KG.lines.oneLine(big.name)) : "") +
      INFO.slice(1).map(([k, l]) => field(k, l)).join("") +
      curField(c) + popRows(id) +
      `</dl>` +
      loreLink(id) +
      (gm ? `<div class="legend-label">Описание</div><textarea class="sc-in sc-desc" data-k="desc" rows="3" maxlength="2000" placeholder="История, особенности, армия, экономика…">${esc(desc)}</textarea>`
        : desc ? `<div class="sc-desc-view">${esc(desc)}</div>` : "");
    stateCard.classList.remove("hidden");
  }
  // ссылка на статью летописи о стране (Вики → Лор → Государства)
  let loreIdx = null;
  window.KG.lore().then(L => { loreIdx = L.byMap; if (sel && sel.col === "countries") renderStateCard(); });
  function loreLink(id) {
    const a = loreIdx && loreIdx[id];
    return a ? `<a class="sc-lore" href="#wiki/lore/states/${esc(encodeURIComponent(a.id))}" title="Статья «${esc(a.title)}» в Вики">📖 Статья в лоре: ${esc(a.title)}</a>` : "";
  }
  // строка «Союз» в карточке: ГМ выбирает из списка, остальные видят название (лидер помечен)
  function allyField(c) {
    const al = allyOf(c);
    if (gm) {
      const opts = [["", "— не в союзе —"]].concat(Object.values(state.alliances || {}).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(a => [a.id, a.name]));
      return `<dt>Союз</dt><dd><select class="sc-ally" title="Союз (фракция) страны">${opts.map(([v, t]) => `<option value="${esc(v)}"${(al ? al.id : "") === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></dd>`;
    }
    return `<dt>Союз</dt>` + (al ? `<dd><span class="sc-swatch" style="background:${esc(al.color)}"></span>${esc(al.name)}${al.leader === c.id ? " (лидер)" : ""}</dd>` : `<dd class="sc-tbd">—</dd>`);
  }
  $("stateCardBody").addEventListener("change", e => { if (e.target.matches(".sc-ally") && sel) setCountryAlly(sel.id, e.target.value); });
  // валюта страны и доля пустошей (ГМ)
  $("stateCardBody").addEventListener("change", e => {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    if (!c || !gm) return;
    if (e.target.matches(".sc-cur")) {
      const v = e.target.value, after = clone(c); after.info = Object.assign({}, after.info);
      if (v) after.info.cur = v; else delete after.info.cur;
      if (!Object.keys(after.info).length) delete after.info;
      commit("countries", sel.id, c, after);
    }
    if (e.target.matches(".sc-pw")) {
      const raw = e.target.value.trim(), v = raw === "" ? null : +raw / 100;
      if (v != null && !(v >= 0 && isFinite(v))) { e.target.value = c.pw != null ? +(c.pw * 100).toFixed(2) : ""; return; }
      const after = clone(c); if (v == null) delete after.pw; else after.pw = +v.toFixed(4);
      if (after.pw !== c.pw) commit("countries", sel.id, c, after);
    }
  });
  // правка полей карточки: сохраняем при уходе из поля (Enter — тоже), одна правка — один шаг Ctrl+Z
  function saveInfo(inp) {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    if (!c || !gm) return;
    const k = inp.dataset.k, v = inp.value.trim(), old = (c.info || {})[k] || "";
    if (!k) return; // доля пустошей сохраняется своим обработчиком
    if (v === old) return;
    const after = clone(c); after.info = Object.assign({}, after.info); if (v) after.info[k] = v; else delete after.info[k];
    if (!Object.keys(after.info).length) delete after.info;
    commit("countries", sel.id, c, after);
  }
  $("stateCardBody").addEventListener("change", e => { if (e.target.matches(".sc-in")) saveInfo(e.target); });
  $("stateCardBody").addEventListener("keydown", e => {
    if (!e.target.matches(".sc-in")) return;
    e.stopPropagation(); // буквы в поле — не горячие клавиши инструментов
    if (e.key === "Enter" && e.target.tagName === "INPUT") e.target.blur();
    if (e.key === "Escape") { e.target.value = ((state.countries[sel.id] || {}).info || {})[e.target.dataset.k] || ""; e.target.blur(); }
  });
  $("stateCardBody").addEventListener("click", e => { if (gm && e.target.closest(".sc-flag")) $("flagInput").click(); });
  // кнопка «Карточка» в легенде: открывает и закрывает карточку выбранного государства
  $("cardToggle").addEventListener("click", () => {
    if (!stateCard.classList.contains("hidden")) { stateCardOn = false; stateCard.classList.add("hidden"); return; }
    if (!sel || sel.col !== "countries") { toast("Сначала выберите страну на карте или в списке"); return; }
    stateCardOn = true; stateCardClosed = null; renderStateCard();
  });
  $("stateCardClose").onclick = () => { stateCardOn = false; if (sel) stateCardClosed = sel.id; stateCard.classList.add("hidden"); };

  // ---------- размер шрифта выбранной подписи — прямо на карте (ГМ) ----------
  // Клик по стране, провинции или подписи показывает над её названием кнопки A− / A+.
  // Каждое нажатие — обычная правка (Ctrl+Z отменяет). Клавиши: «-» и «+».
  const sizeBar = $("sizeBar");
  const SB = { countries: ["Страна", "country", 3, 120], provinces: ["Провинция", "province", 1, 40], labels: ["Подпись", "custom", 3, 120] };
  let sizeTargets = [];
  const sbEnt = t => state && state[t.col] && state[t.col][t.id];
  function setSizeTargets(list) { sizeTargets = (list || []).filter(t => t && sbEnt(t)); placeSizeBar(); }
  function placeSizeBar() {
    const list = sizeTargets.filter(sbEnt);
    if (!gm || tool !== "pan" || viewMode === "globe" || !list.length) { sizeBar.classList.add("hidden"); return; }
    const key = list.map(t => t.col + t.id + ":" + sbEnt(t).size).join("|");
    if (sizeBar.dataset.key !== key) {
      sizeBar.dataset.key = key;
      sizeBar.innerHTML = list.map((t, i) => `<div class="sb-row" data-i="${i}"><span>${SB[t.col][0]}</span>` +
        `<button type="button" data-d="-1" title="Меньше (−)">A−</button><b title="Ввести размер">${+(+sbEnt(t).size).toFixed(1)}</b>` +
        `<button type="button" data-d="1" title="Больше (+)">A+</button></div>`).join("");
    }
    sizeBar.classList.remove("hidden");
    const t = list[0], e = sbEnt(t), a = t.col === "labels" ? [e.x, e.y] : e.label;
    const fr = frame.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    const pk = t.col === "provinces" ? Math.min(1, 2.4 / s) : 1;
    const half = e.size * fk(SB[t.col][1]) * s * pk * 0.7;
    const x = vr.left - fr.left + screenX(a[0]), y = vr.top - fr.top + ty + a[1] * s - half;
    const w = sizeBar.offsetWidth || 160, h = sizeBar.offsetHeight || 34;
    const left = Math.max(8, Math.min(fr.width - w - 8, x - w / 2)), top = Math.max(8, Math.min(fr.height - h - 8, y - h - 8));
    sizeBar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    sizeBar.classList.toggle("off", x < 0 || x > fr.width || y < -40 || y > fr.height + 40);
  }
  afterView.push(placeSizeBar);
  function bumpSize(t, dir, exact) {
    const e = sbEnt(t); if (!e || !gm) return;
    const [, , mn, mx] = SB[t.col];
    const v = exact != null ? exact : e.size * (dir > 0 ? 1.12 : 1 / 1.12);
    const size = Math.round(Math.min(mx, Math.max(mn, v)) * 10) / 10;
    if (size === e.size) return;
    const after = clone(e); after.size = size;
    commit(t.col, t.id, clone(e), after);
    placeSizeBar();
  }
  sizeBar.addEventListener("pointerdown", e => e.stopPropagation());
  sizeBar.addEventListener("click", async e => {
    const r = e.target.closest(".sb-row"); if (!r) return;
    const t = sizeTargets.filter(sbEnt)[+r.dataset.i]; if (!t) return;
    if (e.target.dataset.d) { bumpSize(t, +e.target.dataset.d); return; }
    if (e.target.tagName === "B") {
      const v = await ask("Размер шрифта (" + SB[t.col][0].toLowerCase() + ", " + SB[t.col][2] + "–" + SB[t.col][3] + ")", String(sbEnt(t).size));
      const n = parseFloat(String(v || "").replace(",", "."));
      if (n > 0) bumpSize(t, 0, n);
    }
  });
  let nameBefore = null;
  nameInp.addEventListener("focus", () => { if (sel) nameBefore = clone(state.countries[sel.id]); });
  nameInp.addEventListener("input", () => { if (!sel || !gm) return; state.countries[sel.id].name = window.KG.lines.fromInput(nameInp.value); renderCountry(sel.id); $("countryTitle").textContent = window.KG.lines.oneLine(state.countries[sel.id].name); });
  nameInp.addEventListener("change", () => {
    if (!sel || !nameBefore) return;
    const after = clone(state.countries[sel.id]); after.name = window.KG.lines.fromInput(nameInp.value) || nameBefore.name;
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
  const PANES = { countries: "paneCountries", layers: "paneLayers", alliances: "paneAlliances", forces: "paneForces" };
  document.querySelectorAll("#legend .legend-tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#legend .legend-tabs button").forEach(x => x.classList.toggle("active", x === b));
    for (const k in PANES) $(PANES[k]).classList.toggle("hidden", b.dataset.ltab !== k);
    if (b.dataset.ltab === "alliances") buildAllyList();
    if (b.dataset.ltab === "forces") { if (opsWho() && !zonesData) ensureZones(); renderOps(); }
  }));
  $("allyShow").addEventListener("change", e => showAllyLayer(e.target.checked));
  $("addAllyBtn").addEventListener("click", () => editAlly(null));
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
        const inp = document.createElement("input"); inp.type = "text"; inp.value = window.KG.lines.toInput(c.name); inp.className = "c-name-input"; inp.title = "Название (Enter — сохранить, « ↵ » — перенос строки)";
        let before = null;
        inp.addEventListener("focus", () => { before = clone(state.countries[c.id]); select({ col: "countries", id: c.id }); });
        inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); e.stopPropagation(); });
        inp.addEventListener("change", () => {
          const v = window.KG.lines.fromInput(inp.value);
          if (!before || !v || v === before.name) { inp.value = window.KG.lines.toInput(state.countries[c.id].name); return; }
          const a = clone(before); a.name = v; commit("countries", c.id, before, a);
        });
        r.append(inp);
        const go = document.createElement("button"); go.className = "c-go"; go.title = "Показать на карте"; go.textContent = "⌖";
        go.addEventListener("click", () => focusCountry(c.id));
        const del = document.createElement("button"); del.className = "c-del"; del.title = "Удалить страну"; del.textContent = "✕";
        del.addEventListener("click", () => deleteCountry(c.id));
        r.append(go, del);
      } else {
        const nm = document.createElement("span"); nm.className = "c-name"; nm.textContent = window.KG.lines.oneLine(c.name);
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
    if (col === "cities" && val) setCityCc(val);
    if (val == null) delete state[col][id]; else state[col][id] = val;
    RENDER[col](id);
    if (sel && sel.col === col && sel.id === id) { if (val == null) select(null); else { select(sel); } }
    if (col === "countries") { buildCountryList(); fillBrushSelect(); if (globe && viewMode === "globe") syncGlobe(false); }
    if (col === "countries" || col === "alliances") { allyChanged(); if (col === "alliances" && globe && viewMode === "globe") syncGlobe(false); }
    if (col === "cities") { refreshCityKey(); if (globe && viewMode === "globe") syncGlobe(false); citiesChanged(); }
    if (col === "countries") citiesChanged(); // доля пустошей, валюта, язык
  }
  // ---------- население стран — из городов ----------
  // Страна города — по растру территорий (поле cc пишется в map.json при каждой правке и публикации, чтобы механики
  // и лор считали население и без растра). Сумма населения городов страны — население её мегаполисов, пустоши —
  // доля pw от городов (поле страны карты). Правки городов и границ рассылают событие «kg:cities».
  function cityOwner(ct) { if (T.ids) { const v = T.at(ct.x, ct.y); return v ? String(v) : ""; } return ct && ct.cc ? String(ct.cc) : ""; }
  function setCityCc(ct) { if (!T.ids) return; const v = cityOwner(ct); if (v) ct.cc = v; else delete ct.cc; }
  function popByCountry() { return window.KGMechModel ? window.KGMechModel.cityPopOf(state.cities, cityOwner) : {}; }
  // население страны в жителях: города, пустоши (по доле pw), всего
  function countryPop(id) {
    const c = state.countries[id], meg = popByCountry()[id] || 0, pw = c && c.pw != null && isFinite(+c.pw) ? +c.pw : 0;
    return { meg, waste: meg * pw, total: meg * (1 + pw), pw: c && c.pw != null ? +c.pw : null };
  }
  let citiesTimer = 0;
  function citiesChanged() { clearTimeout(citiesTimer); citiesTimer = setTimeout(() => window.dispatchEvent(new CustomEvent("kg:cities")), 150); }
  // ход механик: население городов страны × множитель (вся правка — один шаг Ctrl+Z)
  function scaleCities(factors) {
    const items = [];
    for (const id in state.cities) {
      const ct = state.cities[id], f = factors[cityOwner(ct)];
      if (f == null || f === 1 || !(+ct.pop > 0)) continue;
      const after = clone(ct); after.pop = Math.max(0, Math.round(+ct.pop * f)); delete after.popYear;
      items.push({ kind: "entity", col: "cities", id, before: clone(ct), after });
    }
    if (!items.length) return 0;
    pushUndo({ kind: "multi", items });
    for (const it of items) setEntity("cities", it.id, clone(it.after));
    return items.length;
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
    if (entry && touchesPaint(entry)) { globeIdsDirty = true; citiesChanged(); } // границы сменились — у городов могла смениться страна, а глобусу нужны новые растры
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
    await ensureProvinces();
    const when = new Date(d.time).toLocaleString("ru-RU");
    const note = d.base === loadedStamp ? "Черновик от " + when + "." : "Черновик от " + when + " сделан для более старой версии карты.";
    const ok = await ask("Восстановить неопубликованный черновик?", "", { confirm: true, note });
    if (!ok) { DB.del("draft").catch(() => {}); return; }
    state = d.state;
    Object.assign(flagCache, d.flags || {});
    if (d.ids && d.ids.length === T.ids.length) { T.ids.set(d.ids); T.computeBBoxes(); terrDirty = true; }
    if (d.pids && d.pids.length === P.ids.length) { P.ids.set(d.pids); P.computeBBoxes(); provDirty = true; buildProvPaths(); }
    rebuildAll(true);
    globeIdsDirty = true;
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
    let ok = null;
    if (window.KGMech && window.KGMech.checkGmPassword) { try { ok = await window.KGMech.checkGmPassword(pw); } catch (e) { console.error(e); ok = null; } }
    if (ok === null && config.gm && config.gm.hash) { // запасной путь: хэш пароля в config.json (если ещё есть)
      const g = config.gm;
      ok = b64(await pbkdf2(pw, unb64(g.salt), g.iter)) === g.hash;
    }
    if (ok !== true) { fails++; toast(ok === null ? "Не удалось проверить пароль: данные механик не загрузились" : "Неверный пароль"); return; }
    fails = 0;
    if (window.KGMech) window.KGMech.gmPassword(pw); // механикам: расшифровать данные стран без повторного ввода
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
    buildCountryList(); buildAllyList();
    updateCard();
    try { loadForces(); } catch (e) { /* карта ещё не готова */ }
    try { refreshSats(); } catch (e) { /* */ }
    if (window.KGMoon) window.KGMoon.onGmChange();
    window.dispatchEvent(new CustomEvent("gmchange", { detail: gm }));
    if (gm) ensureProvinces(); // правка провинций, черновик
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

  // Готовые контуры стран, берега и провинций для data/paths.json и data/paths_prov.json (считаются в фоновом потоке, если в кэше браузера
  // их нет или растр уже изменён правками ГМа). Игроки читают эти файлы вместо расчёта.
  async function pathsFiles() {
    await prepareProvinces(); // растр провинций загружен
    const kc = PATHS_VER + "|" + idsHash(T.ids), kp = PATHS_VER + "|" + idsHash(P.ids);
    let c = pathsCache && pathsCache.kc === kc && pathsCache.c ? pathsCache.c : null;
    if (!c) { const r = await computePaths(T, false, true); c = { paths: r.paths, coast: r.coast }; }
    let p = pathsCache && pathsCache.kp === kp && pathsCache.p ? pathsCache.p : null;
    if (!p) { const r = await computePaths(P, true, false); p = { paths: r.paths }; }
    savePaths({ kc, c, kp, p });
    return [
      { path: "data/paths.json", content: JSON.stringify({ pv: PATHS_VER, kc, c }) },
      { path: "data/paths_prov.json", content: JSON.stringify({ pv: PATHS_VER, kp, p }) }
    ];
  }
  // файлы карты для публикации; их же берут механики, когда ход меняет население городов (один коммит на всё)
  async function publishFiles() {
    for (const ct of Object.values(state.cities)) setCityCc(ct); // страна у каждого города — по растру (для механик и лора)
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
    if (dirty) files.push({ path: "data/map.json", content: JSON.stringify(st) });
    if (terrDirty) files.push({ path: "data/territories.png", content: await T.toPngBlob() }, { path: "data/territories.ids", content: await T.toIdsBlob() });
    if (provDirty) files.push({ path: "data/provinces.png", content: await P.toPngBlob() }, { path: "data/provinces.ids", content: await P.toIdsBlob() });
    // готовые контуры для игроков: после правки границ или если в репозитории их ещё нет / они от другого растра
    if (terrDirty || provDirty || repoPaths === false) { try { files.push(...(await pathsFiles())); } catch (e) { console.warn("контуры для репозитория не собраны:", e.message); } }
    if (window.KGMoon && window.KGMoon.isDirty()) files.push(...(await window.KGMoon.files()));
    return { st, files };
  }
  function afterPublish(st) {
    // локально храним флаги как dataURL (на сайте файлы появятся после сборки Pages)
    for (const id in st.countries) {
      const c = state.countries[id];
      if (c && c.flag && c.flag.startsWith("data:")) { flagCache[id] = c.flag; c.flag = st.countries[id].flag; }
    }
    if (dirty) state.updated = loadedStamp = st.updated;
    if (window.KGMoon && window.KGMoon.isDirty()) window.KGMoon.published();
    dirty = terrDirty = provDirty = false;
    $("gmDirty").classList.add("hidden");
    DB.del("draft").catch(() => {});
  }
  $("publishBtn").onclick = async () => {
    if (!gm) return;
    const moonDirty = window.KGMoon && window.KGMoon.isDirty();
    if (!dirty && !moonDirty) { toast("Нет новых правок"); return; }
    if (!(await ensureToken())) return;
    const btn = $("publishBtn"); btn.disabled = true;
    try {
      const { st, files } = await publishFiles();
      await GH.commit(config.repo, files, "Карта: правки ГМа " + new Date().toLocaleString("ru-RU"), m => ($("hint").textContent = m));
      afterPublish(st);
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
    const p1 = await ask("Новый пароль ГМа", "", { password: true, note: "Не короче 12 символов: лучше 5–6 случайных слов." });
    if (!p1) return;
    if (p1.length < 12) { toast("Пароль слишком короткий"); return; }
    const p2 = await ask("Повторите новый пароль", "", { password: true });
    if (p1 !== p2) { toast("Пароли не совпадают"); return; }
    if (!(await ensureToken())) return;
    const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 600000;
    // мастер-ключ механик зашифрован паролем ГМа — перешифровываем тем же коммитом
    const mechFiles = window.KGMech ? await window.KGMech.rewrapGm(p1) : [];
    if (mechFiles === null) { toast("Пароль не изменён"); return; }
    // Хэш пароля в config.json нужен, только пока в mech.json нет зашифрованного мастер-ключа (mechFiles пуст)
    const next = clone(config);
    if (mechFiles.length) delete next.gm; else next.gm = { salt: b64(salt), hash: b64(await pbkdf2(p1, salt, iter)), iter };
    try {
      await GH.commit(config.repo, [{ path: "data/config.json", content: JSON.stringify(next, null, 2) + "\n" }].concat(mechFiles), "Карта: смена пароля ГМа");
      config = next;
      toast("Пароль изменён (вступит в силу после обновления сайта)");
    } catch (e) { toast("Не удалось сменить пароль: " + e.message); }
  };

  // ---------- инструменты ГМа ----------
  let tool = "pan", brushCountry = null, pencilSize = 2;
  const HINTS = {
    pan: "Правая кнопка мыши — двигать карту, колесо — масштаб. Клик по стране выбирает её, карточка — кнопкой «Карточка» в легенде. Двойной клик — переименовать (по городу — карточка города). Города и подписи тащите левой кнопкой; у выбранной подписи — кнопки размера шрифта.",
    brush: "Кисть: рисуйте территорию выбранной страны. [ и ] — размер, Alt+клик — взять страну с карты, правая кнопка — двигать карту.",
    pencil: "Карандаш: точная правка границы (1–4 px). Alt+клик — взять страну с карты, правая кнопка — двигать карту.",
    eraser: "Ластик: убирает территорию (суша становится ничьей). С галочкой «Не трогать соседей» стирает только страну, с которой начали мазок.",
    fill: "Заливка: клик заливает связную область выбранной страной (пустую — только по суше).",
    picker: "Пипетка: кликните по стране, чтобы рисовать ей.",
    city: "Кликните по карте, чтобы добавить город.",
    label: "Кликните по карте, чтобы добавить подпись.",
    erase: "Кликните по городу, подписи или стране, чтобы удалить (Ctrl+Z — вернуть).",
    ruler: "Линейка: кликайте по точкам маршрута — расстояние считается по поверхности Земли. Двойной клик или Enter — закончить, Esc — отменить.",
    compass: "Циркуль: нажмите в центре и тяните — окружность заданного радиуса на поверхности Земли. Esc — отменить."
  };
  const HINT_ERASE_PROV = "Ластик по провинциям: клик стирает провинцию под курсором целиком, протяжка — все провинции на пути (одним шагом Ctrl+Z). С галочкой «Не трогать соседей» стирается только страна, с которой начали, без неё — вся территория в провинции. В режиме «Провинции» земля снимается с провинции. Правая кнопка — двигать карту.";
  const PAINT = ["brush", "pencil", "eraser", "fill", "picker"];
  const MEASURE = ["ruler", "compass"];
  function setTool(t) {
    if (!gm && !MEASURE.includes(t)) t = "pan";
    if (viewMode === "globe" && t !== "pan") t = "pan";
    if (tool === "ruler" && t !== "ruler") finishRuler();
    tool = t;
    frame.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    viewport.className = "viewport tool-" + t;
    if (typeof placeSizeBar === "function") placeSizeBar();
    $("brushBar").classList.toggle("hidden", !gm || !PAINT.includes(t) || t === "picker");
    // панель инструментов опускается под панель кисти, если та переносится на несколько строк
    requestAnimationFrame(() => { const bb = $("brushBar"); frame.style.setProperty("--bbh", bb.classList.contains("hidden") ? "0px" : bb.offsetHeight + "px"); });
    $("hint").textContent = viewMode === "globe" ? HINT_GLOBE : MEASURE.includes(t) ? HINTS[t] : gm ? HINTS[t] || "" : "Правая кнопка мыши — двигать карту (карта бесшовная, листается по кругу), колесо — масштаб. Клик по стране выбирает её, карточка — кнопкой «Карточка» в легенде; по значку города — карточка города — карточка города.";
    const sz = $("bbSize");
    if (t === "pencil") { sz.max = 4; sz.value = pencilSize; } else { sz.max = 120; sz.value = brushSize; }
    $("bbSizeVal").textContent = sz.value;
    $("bbCountry").disabled = t === "eraser";
    syncEraseMode();
  }
  // ластик: кругом кисти или провинциями целиком (режим запоминается)
  const eraseProv = () => tool === "eraser" && $("bbErase").value === "prov";
  if (ui.eraseMode === "prov") $("bbErase").value = "prov";
  function syncEraseMode() {
    const er = tool === "eraser", ep = eraseProv();
    $("bbErase").classList.toggle("hidden", !er);
    $("bbSizeBox").classList.toggle("hidden", ep);
    viewport.classList.toggle("erase-prov", ep);
    cursorEl.style.display = gm && ["brush", "pencil", "eraser"].includes(tool) && !ep ? "" : "none";
    if (er && gm && viewMode !== "globe") $("hint").textContent = ep ? HINT_ERASE_PROV : HINTS.eraser;
    // стирать по провинциям вслепую неудобно — показываем их границы
    if (ep) { const l = flat.find(x => x.id === "provBorders"); if (l && !isVisible(l)) { ui.vis.provBorders = true; applyLayer(l); buildLayerList(); saveUi(); } }
    updateCursorSize();
  }
  $("bbErase").addEventListener("change", e => { ui.eraseMode = e.target.value; saveUi(); syncEraseMode(); });
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
      const o = document.createElement("option"); o.value = c.id; o.textContent = window.KG.lines.oneLine(c.name); selEl.append(o);
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
    const name = await ask("Название новой страны", "Новая страна", { multiline: true });
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
      const v = window.KG.lines.fromInput(inp.value);
      if (!v || v === before.name) { inp.value = window.KG.lines.toInput(before.name); return; }
      const a = clone(before); a.name = v; commit("provinces", selProv, before, a); before = clone(a);
    });
  })();
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
    // провинции удалённой страны теперь на ничьей земле — не оставляем ссылку на несуществующую страну
    for (const p of Object.values(state.provinces || {})) if (p.c === String(id)) items.push({ kind: "entity", col: "provinces", id: p.id, before: clone(p), after: Object.assign(clone(p), { c: "" }) });
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
    const img = pctx().getImageData(x0, y0, bw, bh), d = img.data;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * W + (x0 + x);
      if (E.mark[i] !== E.strokeNo) continue;
      const v = E.ids[i], o = (y * bw + x) * 4;
      const c = !v ? [16, 24, 46] : E === P ? [120, 235, 255] : rgbOf(v);
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = E === P ? 150 : 235;
    }
    pctx().putImageData(img, x0, y0);
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
      if (!provReady) { ensureProvinces(); toast("Провинции ещё загружаются, подождите пару секунд"); return null; }
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
    if (eraseProv()) {
      if (!provReady) { ensureProvinces(); toast("Провинции ещё загружаются, подождите пару секунд"); return false; }
      // «Не трогать соседей» (режим «Страны»): стираем только страну, с которой начали;
      // 0 — начали с ничьей земли, тогда страну берём первую, на которую попадёт курсор
      const only = E === T && paintOpts().keep ? T.at(p[0], p[1]) : null;
      stroke = { E, ch: E.beginStroke(), v: 0, prov: true, done: new Set(), only, hadBox: true };
      lastPt = p;
      eraseProvAt(p);
      return true;
    }
    const hadBox = v && !!E.bbox[v];
    const opts = paintOpts();
    // ластик с «Не трогать соседей»: стирает только метку, с которой начали мазок
    // (обычное правило keep защищает всё непустое и ластик не стёр бы ничего)
    if (v === 0 && opts.keep) { opts.keep = false; opts.only = E.at(p[0], p[1]); }
    stroke = { E, ch: E.beginStroke(), v, r: Math.max(0.5, curSize() / 2), opts, hadBox };
    lastPt = p;
    E.stamp(p[0], p[1], stroke.r, v, stroke.opts, stroke.ch);
    paintPreview(E, p[0] - stroke.r - 1, p[1] - stroke.r - 1, p[0] + stroke.r + 1, p[1] + stroke.r + 1);
    return true;
  }
  // ластик по провинциям: провинция под точкой p стирается целиком (раз за мазок)
  function eraseProvAt(p) {
    const st = stroke, E = st.E, pid = P.at(p[0], p[1]);
    if (!pid || st.done.has(pid)) return;
    if (st.only === 0) { st.only = T.at(p[0], p[1]); if (!st.only) return; }
    st.done.add(pid);
    const b = P.bbox[pid]; if (!b) return;
    const ids = E.ids, pids = P.ids, only = st.only;
    for (let y = b[1]; y < b[3]; y++) for (let x = b[0], i = y * W + b[0]; x < b[2]; x++, i++) {
      if (pids[i] !== pid || !ids[i]) continue;
      if (only != null && ids[i] !== only) continue;
      E._set(i, 0, st.ch);
    }
    paintPreview(E, b[0], b[1], b[2], b[3]);
  }
  function moveStroke(p) {
    const E = stroke.E;
    if (stroke.prov) {
      // идём по отрезку с шагом в пиксель карты, чтобы не перескочить узкую провинцию
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - lastPt[0], p[1] - lastPt[1])));
      for (let k = 1; k <= n; k++) eraseProvAt([lastPt[0] + (p[0] - lastPt[0]) * k / n, lastPt[1] + (p[1] - lastPt[1]) * k / n]);
      lastPt = p;
      return;
    }
    if (stroke.opts.only === 0) stroke.opts.only = E.at(p[0], p[1]); // начали с пустого места — берём первую задетую метку
    E.line(lastPt[0], lastPt[1], p[0], p[1], stroke.r, stroke.v, stroke.opts, stroke.ch);
    const r = stroke.r + 1;
    paintPreview(E, Math.min(lastPt[0], p[0]) - r, Math.min(lastPt[1], p[1]) - r, Math.max(lastPt[0], p[0]) + r, Math.max(lastPt[1], p[1]) + r);
    lastPt = p;
  }
  function endStroke() {
    const st = stroke; stroke = null;
    const E = st.E, res = E.endStroke(st.ch);
    pctx().clearRect(0, 0, W, H);
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
    setBrushCountry(v); toast("Кисть: " + window.KG.lines.oneLine(state.countries[String(v)].name));
    return true;
  }
  let brushProv = null;
  function setBrushProv(id) {
    brushProv = String(id);
    const pr = state.provinces[brushProv];
    $("bbProv").textContent = pr ? "Провинция: " + window.KG.lines.oneLine(pr.name) : "Провинция не выбрана";
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
    const name = await ask("Название новой провинции", "Новая провинция", { multiline: true });
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
    const v = await ask(title, e[field], { multiline: true });
    if (!v || v === e[field]) return;
    const a = clone(e); a[field] = v; commit(ent.col, ent.id, e, a);
  }
  const uid = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1e3);

  async function handleClick(ent, p) {
    if (tool === "ruler") { rulerAdd(p); return; }
    if (tool === "pan" && forcesTabOpen()) { clickZone(p); return; } // вкладка «Войска»: клик выбирает зону
    if (tool === "compass") return;
    if (!gm || tool === "pan") {
      const pid = P.ids ? P.at(p[0], p[1]) : 0;
      const provOn = isVisible(flat.find(x => x.id === "provBorders"));
      selProv = provOn && pid && state.provinces[String(pid)] ? String(pid) : null;
      if (ent && ent.col === "provinces" && state.provinces[ent.id]) selProv = String(ent.id);
      stateCardClosed = null; // новый клик снова открывает карточку государства
      if (ent && ent.col && ent.col !== "countries" && ent.col !== "provinces") { select(ent); setSizeTargets(ent.col === "labels" ? [ent] : []); return; }
      const cid = ent && ent.col === "countries" ? ent.id : T.at(p[0], p[1]); // клик по названию — именно эта страна
      select(cid && state.countries[String(cid)] ? { col: "countries", id: String(cid) } : null);
      setSizeTargets([sel && sel.col === "countries" ? { col: "countries", id: sel.id } : null, selProv ? { col: "provinces", id: selProv } : null]);
      return;
    }
    if (tool === "fill") { doFill(p); return; }
    if (tool === "picker") { if (pick(p)) setTool("brush"); return; }
    if (tool === "city") {
      const name = await ask("Название нового города", "", { multiline: true });
      if (!name) return;
      const id = uid("ct");
      commit("cities", id, null, { id, name, x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10 });
      select({ col: "cities", id }); editCity(id);
      return;
    }
    if (tool === "label") {
      const text = await ask("Новая подпись", "", { multiline: true });
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
  // ЛКМ не должна запускать перетаскивание браузера (выделенного текста или картинки): тогда браузер
  // шлёт pointercancel, мазок кисти/ластика обрывается, а за курсором тянется «призрак» картинки
  viewport.addEventListener("dragstart", e => e.preventDefault());
  viewport.addEventListener("selectstart", e => e.preventDefault());
  viewport.addEventListener("pointerdown", e => {
    if (e.button === 0) { const sl = window.getSelection(); if (sl && sl.rangeCount && !sl.isCollapsed) sl.removeAllRanges(); }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
      if (stroke) endStroke();
      drag = null; return;
    }
    let p = toMap(e), ent = entOf(e.target);
    // клик пришёлся на копию карты сбоку: сдвигаем вид на ширину карты (картинка не меняется),
    // чтобы под указателем оказалась основная копия, и берём объект под ним заново
    if (p[0] < 0 || p[0] >= W) {
      setView(s, tx + Math.floor(p[0] / W) * W * s, ty, true);
      p = toMap(e); ent = entOf(document.elementFromPoint(e.clientX, e.clientY));
    }
    // ЛКМ мышью карту не двигает: только правая/средняя кнопка, пробел + ЛКМ или палец на экране
    const panButton = e.button === 1 || e.button === 2 || spaceDown;
    const noPan = !panButton && e.pointerType === "mouse";
    if (!panButton && tool === "compass") { compassStart(p); drag = { kind: "compass" }; holdWrap = true; return; }
    if (gm && !panButton && ["brush", "pencil", "eraser"].includes(tool)) {
      if (e.altKey) { pick(p); return; }
      if (startStroke(p)) { drag = { kind: "paint" }; holdWrap = true; }
      return;
    }
    if (gm && !panButton && tool === "pan" && ent && ent.col !== "countries" || gm && !panButton && tool === "pan" && ent && ent.part === "label") {
      drag = { kind: "move", ent, sx: e.clientX, sy: e.clientY, p0: p, before: clone(state[ent.col][ent.id]), moved: false };
      holdWrap = true;
      return;
    }
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx, ty, moved: false, ent, p, panOnly: panButton, noPan };
  });
  viewport.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toMap(e);
    if (gm && cursorEl.style.display !== "none") { cursorEl.setAttribute("cx", p[0]); cursorEl.setAttribute("cy", p[1]); }
    if (tool === "ruler" && ruler && !drag) { ruler.cursor = p; renderMeasure(); }
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], r = viewport.getBoundingClientRect();
      markMoving();
      zoomAt((pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) / s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (!drag) return;
    if (drag.kind === "compass") { compassMove(p); return; }
    if (drag.kind === "paint") { if (stroke) moveStroke(p); return; }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; if (!drag.noPan) viewport.classList.add("panning"); }
      if (drag.moved && !drag.noPan) setView(s, drag.tx + dx, drag.ty + dy);
      return;
    }
    if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1], b = drag.before, en = state[drag.ent.col][drag.ent.id];
      const r1 = v => Math.round(v * 10) / 10;
      const wx = v => window.KGWrap.wrapX(v, W); // через край карты объект переходит на другую сторону
      if (drag.ent.col === "countries") en.label = [Math.round(wx(b.label[0] + dx)), Math.round(b.label[1] + dy)];
      else { en.x = r1(wx(b.x + dx)); en.y = r1(b.y + dy); }
      RENDER[drag.ent.col](drag.ent.id);
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null; holdWrap = false; viewport.classList.remove("panning");
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
    if (dbl && gm && ent && (tool === "pan")) { if (ent.col === "cities") editCity(ent.id); else rename(ent); return; }
    if (dbl) return;
    handleClick(ent, p);
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("pointerleave", () => { cursorEl.setAttribute("cx", -100); });

  window.addEventListener("keydown", e => {
    if (!$("page-map").classList.contains("active")) return;
    if (document.body.classList.contains("moon-mode")) return; // на Луне свои клавиши
    if (e.target.matches && (e.target.matches("input, textarea, select") || e.target.isContentEditable)) return;
    if (!$("modal").classList.contains("hidden")) return;
    if (e.key === "Escape" && popCity) closeCityPop();
    else if (e.key === "Escape" && !stateCard.classList.contains("hidden") && sel) { stateCardOn = false; stateCardClosed = sel.id; stateCard.classList.add("hidden"); if (!gm) return; }
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
    if ((e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") && sizeTargets.some(sbEnt) && tool === "pan") {
      bumpSize(sizeTargets.filter(sbEnt)[0], e.key === "-" || e.key === "_" ? -1 : 1); return;
    }
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
    if (h || svg.childNodes.length) svg.innerHTML = h; // пустой слой не трогаем при каждом кадре
    if (mOut.textContent !== out) mOut.textContent = out;
    mOut.classList.toggle("hidden", !out);
  }

  // ---------- глобус ----------
  const HINT_GLOBE = "Глобус: тяните — вращать, колесо — масштаб, клик по стране — легенда, по городу — его карточка, по спутнику — орбита. Редактирование и измерения — на плоской карте.";
  const Sat = window.KGSats;
  let viewMode = "flat", globe = null, globeRaf = 0, globeLoop = 0, globeReady = null;
  const satUi = { items: [], sel: "kovcheg", orbits: true, names: true, speed: 60, time: Date.now(), follow: false, last: 0, hidden: {}, showDebris: true, showMoon: true, debris: [] };
  // настройки панели орбит переживают перезагрузку (иначе браузер восстанавливает галочки, а карта рисует всё)
  {
    const s = ui.sat || {};
    for (const k of ["orbits", "names", "showDebris", "showMoon"]) if (typeof s[k] === "boolean") satUi[k] = s[k];
    if (s.hidden && typeof s.hidden === "object") satUi.hidden = Object.assign({}, s.hidden);
  }
  const saveSatUi = () => { ui.sat = { orbits: satUi.orbits, names: satUi.names, showDebris: satUi.showDebris, showMoon: satUi.showMoon, hidden: satUi.hidden }; saveUi(); };
  // элементы списка спутников из данных карты (state.satellites + state.satTypes)
  function rebuildSatItems() {
    const types = state.satTypes || {};
    satUi.items = Object.values(state.satellites || {}).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(raw => {
      const t = types[raw.type] || { name: "Без типа", color: "#ffffff", shape: "dot" };
      // значок — по типу (типы как в калькуляторе и Excel), цвет — страны-владельца; без владельца — международный, цвет типа
      const own = raw.owner && state.countries[raw.owner];
      const ownerName = own ? window.KG.lines.oneLine(own.name) : "";
      return { raw, s: { id: raw.id, name: raw.name, note: raw.note || "", color: own ? own.color : t.color, shape: t.shape, typeName: t.name, ownerName }, on: !satUi.hidden[raw.id], pos: null, ring: null, screen: null };
    });
    if (satUi.sel && !(state.satellites || {})[satUi.sel]) satUi.sel = null;
    // спутник, попавший в столкновение, после его момента исчезает (вместо него — облако обломков)
    for (const it of satUi.items) {
      const ev = debrisList().filter(d => d.a === it.raw.id || d.b === it.raw.id)[0];
      it.deadAt = ev ? Date.parse(ev.t) : Infinity; it.deadBy = ev ? ev.name : "";
    }
  }

  // ---------- облака обломков (столкновения спутников) ----------
  // Событие хранится в data/map.json → debris: { id, name, a, b (второй спутник или ""), t (UTC, ISO), n, dv (м/с), color, seed }.
  // Облако считается из орбит родителей и зерна случайных чисел — у всех зрителей одинаковое.
  const debrisList = () => Object.values(state.debris || {}).sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
  const debrisCache = new Map();
  function debrisCloud(ev) {
    // мусор Великой ошибки: родителей нет среди спутников, их орбиты лежат в самом событии (src)
    const src = Array.isArray(ev.src) && ev.src.length ? ev.src : null;
    const pa = src ? src[0] : (state.satellites || {})[ev.a], pb = src ? src[1] || null : ev.b ? (state.satellites || {})[ev.b] : null;
    if (!pa) return null;
    const key = JSON.stringify([ev.t, ev.n, ev.dv, ev.seed, pa, pb]);
    let c = debrisCache.get(ev.id);
    if (!c || c.key !== key) {
      const cloud = Sat.breakup(ev, pb ? [pa, pb] : [pa]);
      c = { key, cloud, pts: new Float32Array(cloud.count * 3), xy: new Float32Array(cloud.count * 3) };
      debrisCache.set(ev.id, c);
    }
    return c;
  }
  const FLASH = 240; // сек модельного времени, пока видна вспышка
  function updateDebris() {
    satUi.debris = [];
    if (!satUi.showDebris) return;
    const realNow = performance.now(), list = debrisList();
    // мусор Великой ошибки — десятки тысяч точек: считаем и рисуем каждую step-ю (≈10 тыс. на компьютере, 5 тыс. на телефоне;
    // если кадр всё равно тяжёлый, глобус увеличивает satUi.debrisStride)
    let legacyN = 0;
    for (const ev of list) if (ev.src) { const c = debrisCloud(ev); if (c) legacyN += c.cloud.count; }
    const legacyStep = Math.max(Math.ceil(legacyN / (innerWidth < 700 ? 5000 : 10000)) || 1, satUi.debrisStride || 1);
    for (const ev of list) {
      const c = debrisCloud(ev); if (!c) continue;
      // старое облако (мусор Великой ошибки, давние удары) пересчитываем не чаще 12 раз в секунду
      const age = (satUi.time - c.cloud.t) / 1000;
      const old = ev.src || age > 3600, step = ev.src ? legacyStep : 1;
      const jumped = c.simT == null || Math.abs(satUi.time - c.simT) > Math.max(5000, satUi.speed * 1000);
      if (!old || jumped || c.step !== step || realNow - (c.realT || 0) > 80) { c.n = Sat.debrisAt(c.cloud, satUi.time, c.pts, step); c.simT = satUi.time; c.realT = realNow; c.step = step; }
      const n = c.n;
      if (!n) continue;
      const flash = age < FLASH ? c.cloud.origins.map(o => Object.assign(Sat.toBody(o, Sat.gmst(satUi.time)), { age, life: FLASH })) : [];
      satUi.debris.push({ id: ev.id, pts: c.pts, xy: c.xy, count: n, step: c.step, color: ev.color || "#ffd27a", flash, legacy: !!ev.src });
    }
  }
  function globeShow() {
    const sh = {};
    flat.forEach(l => { if (!l.internal) { sh[l.id] = isVisible(l); if (ui.hl[l.id]) sh["hl_" + l.id] = true; } });
    sh.landDark = true; // подложка суши всегда видна
    return sh;
  }
  // globeNeed — «перерисуй шар»: цикл ниже рисует только по этому флагу, при движении времени (спутники) или дорисовке чёткости
  let globeNeed = true, globeLastDraw = 0;
  function globeDirty() {
    globeNeed = true;
    if (viewMode !== "globe" || !globe || globeRaf || globeLoop) return;
    globeRaf = requestAnimationFrame(() => { globeRaf = 0; drawGlobe(); });
  }
  function drawGlobe() {
    globe.show = globeShow();
    globe.sel = sel && sel.col === "countries" ? +sel.id : 0;
    globe.selProv = selProv ? +selProv : 0;
    globeNeed = false;
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
      // Раньше шар рисовался в каждом кадре, даже неподвижный. Теперь — по требованию; спутники при скорости ×1 сдвигаются
      // за секунду на доли пикселя, поэтому их перерисовка реже: ×1 — 5 раз в секунду, до ×60 — 20, быстрее — 30.
      const every = satUi.speed <= 1 ? 200 : satUi.speed <= 60 ? 50 : 33;
      const animated = satUi.speed > 0 && (satUi.items.length || satUi.showMoon || (satUi.debris && satUi.debris.length));
      if (globeNeed || globe.pending(now) || (animated && now - globeLastDraw >= every)) { globeNeed = false; globeLastDraw = now; drawGlobe(); }
      globeLoop = requestAnimationFrame(tick);
    };
    globeLoop = requestAnimationFrame(tick);
  }
  function updateSats() {
    globe.sats = satUi;
    // Кольца орбит (сотни точек на спутник) зависят от времени только через вращение Земли (≈0,004° в секунду модели),
    // поэтому пересчитываем их, когда модельное время ушло больше чем на 20 с (а для Луны — на 120 с), а не в каждом кадре.
    let moonRing = satUi.moon && satUi.moon.ring;
    if (satUi.showMoon && satUi.orbits && (!moonRing || Math.abs(satUi.time - (satUi.moonRingT || 0)) > 120000)) { moonRing = Sat.moonRing(satUi.time, 240); satUi.moonRingT = satUi.time; }
    satUi.moon = satUi.showMoon ? { pos: Sat.moonAt(satUi.time), ring: satUi.orbits ? moonRing : null } : null;
    updateDebris();
    for (const it of satUi.items) {
      it.dead = satUi.time >= it.deadAt;
      if (it.dead) it.screen = null;
      it.pos = Sat.at(it.raw, satUi.time);
      if (!(satUi.orbits && it.on)) it.ring = null;
      else if (!it.ring || Math.abs(satUi.time - (it.ringT || 0)) > 20000) { it.ring = Sat.ring(it.raw, satUi.time, it.raw.orbit === "ell" ? 240 : 160); it.ringT = satUi.time; }
    }
    if (satUi.follow && satUi.sel) {
      const it = satUi.items.find(x => x.s.id === satUi.sel);
      if (it && it.pos) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * Math.PI / 180)); globe.lon = it.pos.lon * Math.PI / 180; }
    }
  }
  function whenLoaded(img) { return img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }); }
  async function buildGlobeTextures() {
    const imgs = [L.relief, L.road_major, L.road_secondary, L.road_road, L.rail, L.hydro, L.citiesFill];
    await Promise.all(imgs.map(toFull)); // глобусу — полные рисунки (половинные он растянул бы)
    // Упаковка каналов идёт на видеокарте (globe.packAlpha): раньше это были getImageData по 58 МБ и циклы по 14,5 млн пикселей на странице.
    // Между картинками отдаём страницу браузеру, чтобы шар открывался без замирания.
    const pause = () => new Promise(r => setTimeout(r, 0));
    globe.setLand(L.relief);
    await pause();
    // каналы: дороги — R главные, G второстепенные, B основные, A железные; реки — R, городские зоны — A
    await globe.packAlpha("lines", [L.road_major, L.road_secondary, L.road_road, L.rail], [0, 1, 2, 3], W, H, pause);
    await globe.packAlpha("misc", [L.hydro, L.citiesFill], [0, 3], W, H, pause);
  }
  // растры стран и провинций уходят в видеопамять один раз; заново — только если ГМ их менял (globeIdsDirty)
  let globeIdsOk = false, globeIdsDirty = false;
  function syncGlobe(withIds) {
    if (withIds) { globe.setIds(T.ids, T.W, T.H); if (P.ids) globe.setProv(P.ids, P.W, P.H); globeIdsOk = !!P.ids; globeIdsDirty = false; }
    const pal = {}, labels = [], on = allyOn();
    const cx = document.createElement("canvas").getContext("2d");
    for (const id in state.countries) {
      const c = state.countries[id], a = on ? allyOf(c) : null;
      cx.fillStyle = on ? (a ? a.color : "#3a3346") : c.color; pal[id] = cx.fillStyle; // слой «Союзы»: цвет союза, вне союзов — тёмный
      const ll = Geo.toLL(c.label[0], c.label[1]);
      labels.push({ id, name: c.name, lat: ll[0], lon: ll[1], size: c.size * fk("country") });
    }
    globe.setPalette(pal);
    globe.setLabels(labels);
    globe.setCities(Object.values(state.cities).map(c => { const ll = Geo.toLL(c.x, c.y), t = cityType(c); return { id: c.id, lat: ll[0], lon: ll[1], k: t.size / 7.2, z: t.z, ring: t.ring, cap: !!c.capital, hide: ui.vis["ct_" + t.id] === false }; }));
    globe.setProvLabels(Object.values(state.provinces || {}).map(p => { const ll = Geo.toLL(p.label[0], p.label[1]); return { name: p.name, lat: ll[0], lon: ll[1], size: p.size * fk("province") }; }));
    globeDirty();
  }
  function globeZoom(f) { if (!globe) return; globe.zoom = f ? Math.min(8, Math.max(0.012, globe.zoom * f)) : 1; globeDirty(); }
  async function setView3(mode) {
    if (mode === "globe" && !globe) {
      try { globe = new window.KGGlobe($("globeCanvas"), $("globeOverlay"), $("globeLabels")); } catch (e) { console.error(e); globe = null; }
      if (!globe || !globe.ok()) { globe = null; toast("Не удалось запустить глобус (нужен WebGL)"); return; }
      $("globeLoading").classList.remove("hidden");
      globeReady = buildGlobeTextures().then(() => $("globeLoading").classList.add("hidden"));
    }
    if (mode === "globe") ensureProvinces(); // подсветка провинций на глобусе
    viewMode = mode;
    frame.classList.toggle("globe-mode", mode === "globe");
    $("globeWrap").classList.toggle("hidden", mode !== "globe");
    $("satPanel").classList.toggle("hidden", mode !== "globe");
    if (mode === "globe") {
      const c = Geo.toLL((viewport.clientWidth / 2 - tx) / s, (viewport.clientHeight / 2 - ty) / s);
      globe.lat = Math.max(-60, Math.min(70, c[0])) * Math.PI / 180; globe.lon = c[1] * Math.PI / 180;
      syncGlobe(!globeIdsOk || globeIdsDirty);
      globe.invalidate();
      rebuildSatItems(); buildSatList(); buildTypeList(); buildDebrisList();
      satUi.time = Date.now();
      startLoop();
      if (globeReady) globeReady.then(globeDirty);
    }
    setTool(mode === "globe" ? "pan" : tool);
  }
  // ---------- Солнечная система → объект (Земля, Луна) → привычная карта / проекция шара ----------
  // Адрес: #map (система), #map/earth/flat, #map/earth/globe, #map/moon/flat, #map/moon/globe
  const BODIES = { earth: "Земля", moon: "Луна" };
  let body = null, proj = "flat";
  function markViewButtons() {
    document.querySelectorAll("#viewSwitch [data-proj]").forEach(b => b.classList.toggle("active", b.dataset.proj === proj));
    $("vsBody").textContent = BODIES[body] || "";
  }
  async function openMoon(globeView) {
    await setView3("flat");
    const M = window.KGMoon;
    await M.open();
    const sb = document.querySelector('#moonSubSwitch [data-msub="' + (globeView ? "globe" : "flat") + '"]');
    if (sb && !sb.classList.contains("active")) sb.click();
  }
  function showSolar(on) {
    $("solar").classList.toggle("hidden", !on);
    document.body.classList.toggle("solar-mode", on);
    if (on) { $("solarPick").classList.add("hidden"); drawSolar(); }
  }
  async function showBody(b, p, noFit) {
    if (!BODIES[b]) {
      body = null;
      if (window.KGMoon && window.KGMoon.active) window.KGMoon.close();
      showSolar(true);
      return;
    }
    p = p === "globe" ? "globe" : "flat";
    showSolar(false);
    body = b; proj = p; markViewButtons();
    if (b === "moon") { await openMoon(p === "globe"); return; }
    if (window.KGMoon && window.KGMoon.active) window.KGMoon.close();
    await setView3(p);
    if (p === "flat" && !noFit) requestAnimationFrame(refit);
  }
  document.querySelectorAll("#viewSwitch [data-proj]").forEach(b => b.addEventListener("click", () => window.KG.go("map/" + (body || "earth") + "/" + b.dataset.proj, true)));
  document.querySelector('#viewSwitch [data-view="solar"]').addEventListener("click", () => window.KG.go("map"));
  // схема Солнечной системы (SVG): Земля и Луна доступны, остальные планеты — «недоступно»
  const PLANETS = [
    ["mercury", "Меркурий", 70, 5, "#b9b2a6", 200], ["venus", "Венера", 112, 9, "#e8c98a", 320], ["earth", "Земля", 160, 11, "#3fa2ff", 25],
    ["mars", "Марс", 210, 7, "#e0603a", 140], ["jupiter", "Юпитер", 290, 24, "#d9a877", 220], ["saturn", "Сатурн", 365, 20, "#e6cf8f", 300],
    ["uranus", "Уран", 430, 13, "#8fe3ea", 95], ["neptune", "Нептун", 490, 13, "#4f7dff", 175]];
  let solarDrawn = false;
  function drawSolar() {
    if (solarDrawn) return;
    solarDrawn = true;
    const svg = $("solarSvg"), NS = "http://www.w3.org/2000/svg", cx = 500, cy = 300, k = 0.36; // эллипсы: наклон плоскости
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); (parent || svg).appendChild(e); return e; };
    const defs = el("defs", {});
    const g = el("radialGradient", { id: "sunG" }, defs);
    el("stop", { offset: "0%", "stop-color": "#fff7c2" }, g); el("stop", { offset: "45%", "stop-color": "#ffc23d" }, g); el("stop", { offset: "100%", "stop-color": "rgba(255,120,30,0)" }, g);
    for (const [, , r] of PLANETS) el("ellipse", { cx, cy, rx: r, ry: r * k, class: "orbit" });
    el("circle", { cx, cy, r: 46, fill: "url(#sunG)", class: "sun" });
    el("text", { x: cx, y: cy + 60, class: "s-name sun-name" }).textContent = "Солнце";
    for (const [id, name, r, size, color, ang] of PLANETS) {
      const a = ang * Math.PI / 180, x = cx + r * Math.cos(a), y = cy + r * k * Math.sin(a);
      const ok = !!BODIES[id];
      const grp = el("g", { class: "planet" + (ok ? " ok" : " off"), "data-body": id, tabindex: ok ? "0" : "-1" });
      el("title", {}, grp).textContent = ok ? name + " — открыть" : name + " — недоступно";
      if (id === "saturn") el("ellipse", { cx: x, cy: y, rx: size * 1.9, ry: size * 0.55, class: "ring" }, grp);
      el("circle", { cx: x, cy: y, r: size + 10, class: "halo" }, grp);
      el("circle", { cx: x, cy: y, r: size, fill: color, class: "ball" }, grp);
      el("text", { x, y: y + size + 18, class: "s-name" }, grp).textContent = name;
      if (!ok) el("text", { x, y: y + size + 31, class: "s-off" }, grp).textContent = "недоступно";
      if (id === "earth") {
        // Луна рядом с Землёй
        const mg = el("g", { class: "planet ok moon-b", "data-body": "moon", tabindex: "0" });
        el("title", {}, mg).textContent = "Луна — открыть";
        el("circle", { cx: x + 30, cy: y - 16, r: 12, class: "halo" }, mg);
        el("circle", { cx: x + 30, cy: y - 16, r: 4.5, fill: "#cfd3dc", class: "ball" }, mg);
        el("text", { x: x + 30, y: y - 27, class: "s-name" }, mg).textContent = "Луна";
      }
    }
    const pick = id => {
      if (!BODIES[id]) return;
      $("solarPickName").textContent = BODIES[id];
      $("solarPickEarth").classList.toggle("hidden", id !== "earth");
      $("solarPickMoon").classList.toggle("hidden", id !== "moon");
      $("solarPick").dataset.body = id;
      $("solarPick").classList.remove("hidden");
    };
    svg.addEventListener("click", e => { const p = e.target.closest(".planet.ok"); if (p) pick(p.dataset.body); });
    svg.addEventListener("keydown", e => { const p = e.target.closest(".planet.ok"); if (p && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(p.dataset.body); } });
  }
  $("solarPickClose").addEventListener("click", () => $("solarPick").classList.add("hidden"));
  document.querySelectorAll("#solarPick [data-proj]").forEach(b => b.addEventListener("click", () => window.KG.go("map/" + $("solarPick").dataset.body + "/" + b.dataset.proj)));
  // маршрут карты: ждём загрузки данных, затем показываем нужный объект
  let mapReadyResolve, stateReadyResolve; const mapReady = new Promise(r => (mapReadyResolve = r)), stateReady = new Promise(r => (stateReadyResolve = r));
  window.addEventListener("routechange", async e => {
    if (e.detail.tab !== "map") return;
    const [, b, p, cid] = e.detail.parts;
    if (!BODIES[b]) { showBody(null); return; }
    await mapReady;
    // #map/earth/flat/<номер страны> — выбрать страну и приблизить (сразу, без отложенной подгонки карты под окно)
    const focus = b === "earth" && cid && state.countries[cid];
    focusId = focus ? cid : null;
    await showBody(b, p, focus);
    if (focus) { if (proj === "flat") fit(); stateCardOn = true; stateCardClosed = null; focusCountry(cid); } // ссылка на страну (из статьи, союзов) — явный запрос карточки
  });

  // панель спутников
  function buildSatList() {
    const list = $("satList"); list.innerHTML = "";
    for (const it of satUi.items) {
      const r = document.createElement("div"); r.className = "sat-row"; r.dataset.id = it.s.id;
      r.innerHTML = `<input type="checkbox" ${it.on ? "checked" : ""} title="Показывать"><span class="sat-dot" style="background:${it.s.color};box-shadow:0 0 6px ${it.s.color}"></span>` +
        `<span class="sat-name" title="${esc(it.s.ownerName || "Международный")}">${esc(it.s.name)}</span><span class="sat-type" title="${esc(it.s.typeName + " · " + (it.s.ownerName || "международный"))}">${esc(it.s.typeName)}${isFinite(it.deadAt) ? ` <span title="Столкновение «${esc(it.deadBy)}», ${esc(fmtUtc(it.deadAt))}">💥</span>` : ""}</span>` +
        (gm ? `<button class="c-go sat-edit" title="Изменить">✎</button><button class="c-del sat-del" title="Удалить">✕</button>` : "");
      r.querySelector("input").addEventListener("change", e => { it.on = e.target.checked; if (it.on) delete satUi.hidden[it.s.id]; else satUi.hidden[it.s.id] = true; saveSatUi(); globeDirty(); });
      r.addEventListener("click", e => {
        if (e.target.tagName === "INPUT") return;
        if (e.target.classList.contains("sat-edit")) { editSat(it.s.id); return; }
        if (e.target.classList.contains("sat-del")) { deleteSat(it.s.id); return; }
        selectSat(it.s.id, true);
      });
      list.append(r);
    }
    markSatRows();
  }
  function buildTypeList() {
    const box = $("satTypeList"); if (!box) return;
    box.innerHTML = "";
    for (const t of Object.values(state.satTypes || {})) {
      const used = Object.values(state.satellites || {}).filter(x => x.type === t.id).length;
      const r = document.createElement("div"); r.className = "sat-row";
      r.innerHTML = `<span class="sat-dot" style="background:${t.color}"></span><span class="sat-name">${esc(t.name)}</span>` +
        `<span class="sat-type">${esc(Sat.SHAPES[t.shape] || t.shape)} · ${used}</span>` +
        `<button class="c-go" title="Изменить тип">✎</button><button class="c-del" title="Удалить тип">✕</button>`;
      r.querySelector(".c-go").addEventListener("click", () => editType(t.id));
      r.querySelector(".c-del").addEventListener("click", () => deleteType(t.id));
      box.append(r);
    }
  }
  function fmtUtc(ms) { return new Date(ms).toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC"; }
  function buildDebrisList() {
    const box = $("debList"); if (!box) return;
    const list = debrisList();
    box.innerHTML = list.length ? `<div class="legend-label">Столкновения</div>` : "";
    for (const ev of list) {
      const c = debrisCloud(ev);
      const r = document.createElement("div"); r.className = "sat-row deb-row"; r.dataset.id = ev.id;
      r.innerHTML = `<span class="sat-dot deb-dot" style="background:${esc(ev.color || "#ffd27a")}"></span>` +
        `<span class="sat-name" title="${esc(ev.name)}">${esc(ev.name)}</span><span class="sat-type" title="${esc(fmtUtc(Date.parse(ev.t)))}">${esc(new Date(Date.parse(ev.t)).toLocaleDateString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit" }))} · ${c ? c.cloud.count : 0}</span>` +
        `<button class="c-go deb-go" title="Перемотать к моменту столкновения">⏵</button>` +
        (gm ? `<button class="c-go deb-edit" title="Изменить">✎</button><button class="c-del deb-del" title="Удалить">✕</button>` : "");
      r.addEventListener("click", e => {
        if (e.target.classList.contains("deb-edit")) { editDebris(ev.id); return; }
        if (e.target.classList.contains("deb-del")) { deleteDebris(ev.id); return; }
        jumpToDebris(ev);
      });
      box.append(r);
    }
  }
  // перемотка: за 20 секунд до удара, скорость ×60, глобус смотрит на точку столкновения
  function jumpToDebris(ev) {
    const c = debrisCloud(ev); if (!c) return;
    satUi.time = c.cloud.t - 20000; satUi.speed = 60; satUi.follow = false; $("satFollow").checked = false;
    document.querySelectorAll("#satSpeed button").forEach(x => x.classList.toggle("active", x.dataset.speed === "60"));
    if (globe) {
      const o = Sat.toBody(c.cloud.origins[0], Sat.gmst(c.cloud.t));
      globe.lat = Math.max(-1.3, Math.min(1.3, o.lat * Math.PI / 180)); globe.lon = o.lon * Math.PI / 180;
      globe.zoom = Math.min(globe.zoom, 0.8);
    }
    globeDirty();
  }
  function refreshSats() { if (!state) return; rebuildSatItems(); if (viewMode === "globe" || $("satList").childElementCount) { buildSatList(); buildTypeList(); buildDebrisList(); } globeDirty(); }

  // ---------- формы ГМа (спутник, тип) ----------
  function openForm(title, fields, values) {
    return new Promise(resolve => {
      const m = $("formModal"), body = $("formBody"), err = $("formError");
      $("formTitle").textContent = title; err.textContent = "";
      body.innerHTML = "";
      const inputs = {};
      for (const f of fields) {
        const row = document.createElement(f.type === "multi" ? "div" : "label"); row.className = "f-row"; row.dataset.key = f.key;
        const lb = document.createElement("span"); lb.textContent = f.label; row.append(lb);
        let inp;
        if (f.type === "textarea") {
          inp = document.createElement("textarea"); inp.rows = 4; inp.className = "f-area";
        } else if (f.type === "multi") { // список галочек: значение — id через запятую
          inp = document.createElement("input"); inp.type = "hidden";
          const sel0 = new Set(String(values[f.key] || "").split(",").filter(Boolean)), box = document.createElement("div"); box.className = "f-multi";
          for (const [v, t] of f.options) {
            const l = document.createElement("label"), c = document.createElement("input"); c.type = "checkbox"; c.checked = sel0.has(String(v));
            c.addEventListener("change", () => { c.checked ? sel0.add(String(v)) : sel0.delete(String(v)); inp.value = [...sel0].join(","); inp.dispatchEvent(new Event("change")); });
            l.append(c, " " + t); box.append(l);
          }
          row.append(box);
        } else if (f.type === "select") {
          inp = document.createElement("select");
          for (const [v, t] of f.options) { const o = document.createElement("option"); o.value = v; o.textContent = t; inp.append(o); }
        } else {
          inp = document.createElement("input"); inp.type = f.type || "text";
          if (f.step) inp.step = f.step; if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max;
        }
        inp.value = values[f.key] != null ? values[f.key] : "";
        inp.addEventListener("keydown", e => e.stopPropagation());
        row.append(inp);
        if (f.hint) { const h = document.createElement("small"); h.textContent = f.hint; row.append(h); }
        body.append(row); inputs[f.key] = inp;
      }
      const read = () => { const v = {}; for (const f of fields) v[f.key] = f.type === "number" ? (inputs[f.key].value === "" ? "" : +inputs[f.key].value) : inputs[f.key].value.trim(); return v; };
      const vis = () => { const v = read(); for (const f of fields) body.querySelector(`[data-key="${f.key}"]`).style.display = !f.show || f.show(v) ? "" : "none"; };
      Object.values(inputs).forEach(i => i.addEventListener("change", vis)); vis();
      KG.showModal(m);
      setTimeout(() => { const first = body.querySelector("input,select"); if (first) first.focus(); }, 0);
      const ok = $("formOk"), cancel = $("formCancel");
      function done(v) { KG.hideModal(m); ok.onclick = cancel.onclick = null; resolve(v); }
      ok.onclick = () => {
        const v = read();
        const e = opts.validate ? opts.validate(v) : "";
        if (e) { err.textContent = e; return; }
        done(v);
      };
      cancel.onclick = () => done(null);
      const opts = values.__opts || {};
    });
  }
  window.KGForm = (t, f, v, val) => openForm(t, f, Object.assign({}, v, { __opts: { validate: val } }));
  const typeOptions = () => Object.values(state.satTypes || {}).map(t => [t.id, t.name]);
  const ownerOptions = () => [["", "— международный —"]].concat(Object.values(state.countries || {}).map(c => [c.id, window.KG.lines.oneLine(c.name)]).sort((a, b) => a[1].localeCompare(b[1], "ru")));
  const SAT_FIELDS = () => [
    { key: "name", label: "Название" },
    { key: "type", label: "Тип", type: "select", options: typeOptions() },
    { key: "owner", label: "Страна-владелец", type: "select", options: ownerOptions(), hint: "Цвет спутника на глобусе — цвет страны. Число спутников по типам держите таким же, как в калькуляторе ГМа" },
    { key: "note", label: "Описание" },
    { key: "orbit", label: "Орбита", type: "select", options: Object.entries(Sat.ORBITS) },
    { key: "h", label: "Высота, км", type: "number", min: 160, show: v => v.orbit === "circ", hint: "МКС ≈ 420, навигация ≈ 20 000" },
    { key: "hp", label: "Перигей, км", type: "number", min: 160, show: v => v.orbit === "ell" },
    { key: "ha", label: "Апогей, км", type: "number", min: 160, show: v => v.orbit === "ell" },
    { key: "argp", label: "Аргумент перигея, °", type: "number", show: v => v.orbit === "ell", hint: "270° — апогей над северным полушарием" },
    { key: "i", label: "Наклонение, °", type: "number", min: 0, max: 180, show: v => v.orbit !== "geo", hint: "0 — над экватором, 90 — через полюса" },
    { key: "raan", label: "Долгота восходящего узла, °", type: "number", show: v => v.orbit !== "geo", hint: "Поворот плоскости орбиты вокруг оси Земли" },
    { key: "phase", label: "Начальное положение на орбите, °", type: "number", show: v => v.orbit !== "geo" },
    { key: "lon", label: "Долгота над экватором, °", type: "number", min: -180, max: 180, show: v => v.orbit === "geo" }
  ];
  async function editSat(id) {
    if (!gm) return;
    if (!Object.keys(state.satTypes || {}).length) { toast("Сначала создайте тип спутника"); return; }
    const before = id ? state.satellites[id] : null;
    const base = before ? clone(before) : { name: "", type: Object.keys(state.satTypes)[0], owner: "", note: "", orbit: "circ", h: 400, hp: 500, ha: 20000, argp: 270, i: 51.6, raan: 0, phase: 0, lon: 0 };
    if (base.owner == null) base.owner = "";
    base.__opts = { validate: Sat.validate };
    const v = await openForm(before ? "Спутник: " + before.name : "Новый спутник", SAT_FIELDS(), base);
    if (!v) return;
    const nid = before ? id : uid("sat");
    const rec = { id: nid, name: v.name, type: v.type, note: v.note, orbit: v.orbit };
    if (v.owner && state.countries[v.owner]) rec.owner = v.owner;
    if (v.orbit === "geo") rec.lon = v.lon;
    else {
      Object.assign(rec, { i: v.i, raan: v.raan || 0, phase: v.phase || 0 });
      if (v.orbit === "ell") Object.assign(rec, { hp: v.hp, ha: v.ha, argp: v.argp || 0 }); else rec.h = v.h;
    }
    commit("satellites", nid, before, rec);
    satUi.sel = nid; refreshSats();
    toast(before ? "Спутник изменён" : "Спутник добавлен — он уже на орбите");
  }
  async function deleteSat(id) {
    const c = state.satellites[id]; if (!c || !gm) return;
    const ok = await ask("Удалить спутник «" + c.name + "»?", "", { confirm: true, note: "Ctrl+Z — вернуть." });
    if (!ok) return;
    commit("satellites", id, c, null); refreshSats();
  }
  const TYPE_FIELDS = [
    { key: "name", label: "Название типа" },
    { key: "color", label: "Цвет", type: "color" },
    { key: "shape", label: "Значок", type: "select", options: Object.entries(Sat.SHAPES) }
  ];
  async function editType(id) {
    if (!gm) return;
    const before = id ? state.satTypes[id] : null;
    const base = before ? clone(before) : { name: "", color: "#7fe8ff", shape: "dot" };
    base.__opts = { validate: v => (v.name ? "" : "Укажите название типа") };
    const v = await openForm(before ? "Тип: " + before.name : "Новый тип спутника", TYPE_FIELDS, base);
    if (!v) return;
    const nid = before ? id : uid("type");
    commit("satTypes", nid, before, { id: nid, name: v.name, color: v.color, shape: v.shape });
    refreshSats();
  }
  async function deleteType(id) {
    const t = state.satTypes[id]; if (!t || !gm) return;
    const users = Object.values(state.satellites || {}).filter(x => x.type === id);
    if (users.length) { toast("Тип используют: " + users.map(u => u.name).join(", ")); return; }
    const ok = await ask("Удалить тип «" + t.name + "»?", "", { confirm: true });
    if (!ok) return;
    commit("satTypes", id, t, null); refreshSats();
  }
  // ---------- столкновение (ГМ) ----------
  const toInputUtc = ms => new Date(ms).toISOString().slice(0, 16); // для поля «дата и время» в UTC
  async function editDebris(id) {
    if (!gm) return;
    const old = id ? state.debris[id] : null;
    if (old && Array.isArray(old.src)) {
      // облако Великой ошибки: орбиты разрушенных аппаратов не меняем — только название, плотность, разлёт и цвет
      const base = Object.assign(clone(old), { __opts: { validate: v => (!v.name ? "Укажите название" : !(v.n >= 50 && v.n <= 3000) ? "Обломков — от 50 до 3000" : !(v.dv >= 10 && v.dv <= 1000) ? "Разлёт — от 10 до 1000 м/с" : "") } });
      const v = await openForm("Мусор Великой ошибки: " + old.name, [
        { key: "name", label: "Название" },
        { key: "n", label: "Обломков", type: "number", min: 50, max: 3000, step: 50, hint: "Облака мусора Великой ошибки задают индекс Кесслера на старте" },
        { key: "dv", label: "Разлёт, м/с", type: "number", min: 10, max: 1000, step: 10 },
        { key: "color", label: "Цвет обломков", type: "color" }
      ], base);
      if (!v) return;
      commit("debris", id, old, Object.assign(clone(old), { name: v.name, n: Math.round(v.n), dv: Math.round(v.dv), color: v.color }));
      refreshSats();
      return;
    }
    const sats = Object.values(state.satellites || {}).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!sats.length) { toast("Сначала добавьте спутник"); return; }
    const before = id ? state.debris[id] : null;
    const base = before ? Object.assign(clone(before), { when: toInputUtc(Date.parse(before.t)), snap: "exact" })
      : { name: "Столкновение", a: satUi.sel && state.satellites[satUi.sel] ? satUi.sel : sats[0].id, b: "", when: toInputUtc(satUi.time), snap: "near", n: 800, dv: 150, color: "#ffd27a" };
    const opts = [...sats.map(s => [s.id, s.name])];
    base.__opts = { validate: v => {
      if (!v.name) return "Укажите название";
      if (!state.satellites[v.a]) return "Выберите первый спутник";
      if (v.b && v.b === v.a) return "Второй спутник должен отличаться от первого";
      if (!v.when || isNaN(Date.parse(v.when + ":00Z"))) return "Укажите дату и время";
      if (!(v.n >= 50 && v.n <= 3000)) return "Обломков — от 50 до 3000";
      if (!(v.dv >= 10 && v.dv <= 1000)) return "Разлёт — от 10 до 1000 м/с";
      return "";
    } };
    const v = await openForm(before ? "Столкновение: " + before.name : "Новое столкновение", [
      { key: "name", label: "Название" },
      { key: "a", label: "Спутник", type: "select", options: opts },
      { key: "b", label: "Второй спутник", type: "select", options: [["", "— нет (взрыв или разрушение одного)"]].concat(opts) },
      { key: "when", label: "Время, UTC", type: "datetime-local", hint: "Как часы над списком спутников" },
      { key: "snap", label: "Момент удара", type: "select", options: [["near", "Ближайшее сближение после этого времени"], ["exact", "Ровно в это время"]], show: x => !!x.b },
      { key: "n", label: "Обломков", type: "number", min: 50, max: 3000, step: 50, hint: "Больше 1500 — тяжелее для слабых компьютеров" },
      { key: "dv", label: "Разлёт, м/с", type: "number", min: 10, max: 1000, step: 10, hint: "Сила удара: 50 — облако узкое, 300 — широкое" },
      { key: "color", label: "Цвет обломков", type: "color" }
    ], base);
    if (!v) return;
    let t = Date.parse(v.when + ":00Z");
    if (v.b && v.snap === "near") {
      const r = Sat.closest(state.satellites[v.a], state.satellites[v.b], t, 3 * 86400000);
      t = r.t;
      toast(r.km < 50 ? "Удар в момент сближения: " + fmtUtc(t) : `Ближе ${Math.round(r.km).toLocaleString("ru-RU")} км спутники за трое суток не сходятся — каждый разлетится из своей точки (${fmtUtc(t)})`);
    }
    const nid = before ? id : uid("deb");
    const rec = { id: nid, name: v.name, a: v.a, b: v.b || "", t: new Date(t).toISOString(), n: Math.round(v.n), dv: Math.round(v.dv), color: v.color, seed: before ? before.seed : nid };
    commit("debris", nid, before, rec);
    refreshSats();
    jumpToDebris(rec);
  }
  async function deleteDebris(id) {
    const d = state.debris[id]; if (!d || !gm) return;
    const ok = await ask("Удалить столкновение «" + d.name + "»?", "", { confirm: true, note: "Спутники вернутся на орбиты. Ctrl+Z — вернуть." });
    if (!ok) return;
    commit("debris", id, d, null); refreshSats();
  }
  $("addDebrisBtn").onclick = () => editDebris(null);
  $("satDebris").checked = satUi.showDebris;
  $("satDebris").addEventListener("change", e => { satUi.showDebris = e.target.checked; saveSatUi(); globeDirty(); });
  $("addSatBtn").onclick = () => editSat(null);
  $("addTypeBtn").onclick = () => editType(null);
  function markSatRows() { document.querySelectorAll("#satList .sat-row").forEach(r => r.classList.toggle("active", r.dataset.id === satUi.sel)); }
  function selectSat(id, center) {
    satUi.sel = id; markSatRows();
    const it = satUi.items.find(x => x.s.id === id);
    if (center && it && it.pos && globe) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * Math.PI / 180)); globe.lon = it.pos.lon * Math.PI / 180; }
    globeDirty();
  }
  function renderSatInfo() {
    // часы модели — всегда, даже если спутник не выбран
    const tsNow = new Date(satUi.time).toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
    if ($("satTime").textContent !== tsNow) $("satTime").textContent = tsNow;
    const it = satUi.items.find(x => x.s.id === satUi.sel);
    const box = $("satInfo");
    if (!it || !it.pos) { box.textContent = ""; box.dataset.h = ""; return; }
    if (it.dead) {
      const html = `<b style="color:${it.s.color}">${esc(it.s.name)}</b> · разрушен (${esc(it.deadBy)}, ${esc(fmtUtc(it.deadAt))}) — теперь это облако обломков`;
      if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
      return;
    }
    const p = it.pos, ns = p.lat >= 0 ? "с. ш." : "ю. ш.", ew = p.lon >= 0 ? "в. д." : "з. д.";
    const html = `<b style="color:${it.s.color}">${esc(it.s.name)}</b> · ${esc(it.s.typeName)} · ${esc(it.s.ownerName || "международный")}${it.s.note ? " — " + esc(it.s.note) : ""}<br>` +
      `Высота ${Math.round(p.alt).toLocaleString("ru-RU")} км · скорость ${Sat.speed(it.raw, p.alt).toFixed(2).replace(".", ",")} км/с · виток ${Sat.fmtPeriod(Sat.period(it.raw))}<br>` +
      `Над точкой ${Math.abs(p.lat).toFixed(1)}° ${ns}, ${Math.abs(p.lon).toFixed(1)}° ${ew}`;
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
    const t = new Date(satUi.time);
    const ts = t.toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
    if ($("satTime").textContent !== ts) $("satTime").textContent = ts;
  }
  // галочки берут состояние из satUi, а не из того, что восстановил браузер
  $("satOrbits").checked = satUi.orbits;
  $("satNames").checked = satUi.names;
  $("satFollow").checked = satUi.follow;
  $("satMoon").checked = satUi.showMoon;
  $("satOrbits").addEventListener("change", e => { satUi.orbits = e.target.checked; saveSatUi(); globeDirty(); });
  $("satNames").addEventListener("change", e => { satUi.names = e.target.checked; saveSatUi(); globeDirty(); });
  $("satFollow").addEventListener("change", e => { satUi.follow = e.target.checked; globeDirty(); });
  $("satMoon").addEventListener("change", e => { satUi.showMoon = e.target.checked; saveSatUi(); globeDirty(); });
  $("satMoonBtn").addEventListener("click", () => { if (!globe) return; satUi.showMoon = true; $("satMoon").checked = true; saveSatUi(); satUi.follow = false; $("satFollow").checked = false; globe.zoom = 0.0145; globeDirty(); });
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
      if (popAt && g.moved) closeCityPop(); // карточка привязана к точке экрана — при вращении закрываем
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
      // города на глобусе
      let city = null, cd = 10;
      for (const c of (globe.cities || [])) { if (!c.screen) continue; const dd = Math.hypot(c.screen[0] - mx, c.screen[1] - my); if (dd < Math.max(cd, c.screen[2])) { cd = dd; city = c; } }
      if (city) { const fr = frame.getBoundingClientRect(); sel = { col: "cities", id: city.id }; showCityPop(city.id, [rc.left - fr.left + city.screen[0], rc.top - fr.top + city.screen[1]]); return; }
      if (satUi.moon && satUi.moon.screen && Math.hypot(satUi.moon.screen[0] - mx, satUi.moon.screen[1] - my) < Math.max(14, satUi.moon.screen[2])) { window.KG.go("map/moon/globe"); return; }
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


  // ---------- шрифты надписей (настраивает ГМ, публикуются вместе с картой) ----------
  const FONTS = ["Unbounded", "Exo 2", "Oswald", "Russo One", "Jura", "Play", "Tektur", "Comfortaa", "Montserrat Alternates",
    "Roboto Condensed", "PT Sans Narrow", "Days One", "Rubik Mono One", "Philosopher", "Kelly Slab", "Press Start 2P",
    "Ruslan Display", "Underdog", "Neucha", "Yeseva One", "Lobster", "Marck Script", "PT Serif"];
  const FONT_SLOTS = [
    ["country", "Названия стран"], ["province", "Названия провинций"], ["city", "Названия городов"], ["custom", "Подписи"],
    ["moon", "Луна: территории и отметки"], ["moonNames", "Луна: моря, кратеры, места посадок"]
  ];
  const loadedFonts = new Set(["Unbounded", "Exo 2", "Oswald"]);
  function ensureFont(f) {
    if (!f || loadedFonts.has(f)) return;
    loadedFonts.add(f);
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f.replace(/ /g, "+") + ":wght@300;400&display=swap";
    l.onerror = () => { l.href = "https://fonts.googleapis.com/css2?family=" + f.replace(/ /g, "+") + "&display=swap"; };
    document.head.append(l);
  }
  // Размер шрифта: у каждой подписи свой (кнопки A−/A+ у выбранной подписи), плюс общий масштаб
  // для каждого вида надписей (окно «Шрифты»). Масштаб хранится в settings.fonts как size_<вид> в процентах.
  const SIZE_SLOTS = ["country", "province", "custom", "moon", "moonNames"];
  function fk(slot) {
    const v = state && state.settings && state.settings.fonts && +state.settings.fonts["size_" + slot];
    return v > 0 ? Math.min(4, Math.max(0.25, v / 100)) : 1;
  }
  const fontScales = () => { const o = {}; SIZE_SLOTS.forEach(k => (o[k] = fk(k))); return o; };
  let appliedScales = "";
  function currentFonts() {
    const f = {}; const saved = (state && state.settings && state.settings.fonts) || {};
    FONT_SLOTS.forEach(([k]) => (f[k] = saved[k] || "Unbounded"));
    return f;
  }
  function applyFonts() {
    const f = currentFonts(), root = document.documentElement;
    for (const k in f) { ensureFont(f[k]); root.style.setProperty("--f-" + k, `"${f[k]}", "Exo 2", sans-serif`); }
    const sc = fontScales(), key = JSON.stringify(sc);
    SIZE_SLOTS.forEach(k => root.style.setProperty("--fk-" + k, sc[k]));
    if (key !== appliedScales) {
      const first = !appliedScales; appliedScales = key;
      if (!first || Object.values(sc).some(v => v !== 1)) {
        Object.keys(state.countries).forEach(renderCountry); Object.keys(state.labels).forEach(renderLabel);
        Object.keys(state.provinces || {}).forEach(renderProvince);
        try { if (globe) syncGlobe(false); } catch (e) { /* */ }
      }
      window.dispatchEvent(new CustomEvent("kg-fonts", { detail: sc }));
    }
    if (globe) { globe.fonts = f; globeDirty(); }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (globe) globeDirty(); });
  }
  $("fontBtn").onclick = async () => {
    if (!gm) return;
    const before = (state.settings && state.settings.fonts) || null, cur = currentFonts();
    FONTS.forEach(ensureFont); // чтобы превью в списке было честным
    const fields = [];
    FONT_SLOTS.forEach(([k, label]) => {
      fields.push({ key: k, label, type: "select", options: FONTS.map(x => [x, x]) });
      if (SIZE_SLOTS.includes(k)) fields.push({ key: "size_" + k, label: "↳ размер, % (100 — как задано у подписей)", type: "number", min: 25, max: 400, step: 5 });
    });
    const vals = Object.assign({}, cur, { __opts: { validate: v => SIZE_SLOTS.some(k => v["size_" + k] !== "" && !(v["size_" + k] >= 25 && v["size_" + k] <= 400)) ? "Размер — от 25 до 400 %" : "" } });
    SIZE_SLOTS.forEach(k => (vals["size_" + k] = Math.round(fk(k) * 100)));
    const v = await openForm("Шрифты надписей на карте", fields, vals);
    if (!v) return;
    SIZE_SLOTS.forEach(k => { if (v["size_" + k] === "" || v["size_" + k] === 100) delete v["size_" + k]; });
    commit("settings", "fonts", before, Object.assign({ id: "fonts" }, v));
    toast("Шрифты обновлены (опубликуйте, чтобы их увидели все)");
  };

  // ---------- загрузка ----------
  function rebuildAll(keepPaths) {
    for (const col of COLS) {
      if (col === "provinces" && !provWanted) continue; // провинции строит ensureProvinces, когда они понадобятся
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
  // ---------- контуры: из кэша браузера или в фоновом потоке ----------
  // Контуры стран, провинций и берега считаются из растров один раз и кладутся в IndexedDB
  // (ключ — время публикации карты). Расчёт идёт в Web Worker, страница при этом не замирает.
  const PATHS_VER = 4; // поднять при изменении алгоритма контуров или маски суши
  // отпечаток растра id (FNV-1a по 32-битным словам) — ключ кэша контуров
  function idsHash(a) {
    const n4 = a.byteLength >> 2, u = new Uint32Array(a.buffer, a.byteOffset, n4), b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let h = 0x811c9dc5 ^ a.length;
    for (let i = 0; i < n4; i++) h = Math.imul(h ^ u[i], 16777619);
    for (let i = n4 << 2; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
    return (h >>> 0).toString(36) + "." + a.length;
  }
  function pathsInWorker(M, wide, withCoast) {
    return new Promise((res, rej) => {
      let w;
      try { w = new Worker("js/paths-worker.js?v=20261113a"); } catch (e) { rej(e); return; }
      const t = setTimeout(() => { w.terminate(); rej(new Error("слишком долго")); }, 90000);
      w.onmessage = e => { clearTimeout(t); w.terminate(); if (e.data.error) rej(new Error(e.data.error)); else res(e.data); };
      w.onerror = e => { clearTimeout(t); w.terminate(); rej(new Error(e.message || "ошибка потока")); };
      w.postMessage({ ids: M.ids, land: withCoast ? M.land : null, W: M.W, H: M.H, wide });
    });
  }
  async function computePaths(M, wide, withCoast) {
    try { return await pathsInWorker(M, wide, withCoast); } catch (e) {
      console.warn("фоновый поток недоступен, считаю на странице:", e.message);
      return { paths: Array.from(M.allPaths()), coast: withCoast ? M.coastTiles() : null };
    }
  }
  function setCoast(list) {
    L.coast.querySelectorAll(".coast-line").forEach(e => e.remove());
    for (const d of list || []) svgEl("path", { class: "coast-line", d }, L.coast);
  }
  // тысячи путей провинций добавляем порциями, чтобы не было долгого кадра
  async function applyProvPaths(list) {
    const all = new Map(list);
    for (const id of Object.keys(provEls)) if (!all.has(+id)) setProvPath(id, "");
    const items = Array.from(all).filter(([id]) => state.provinces[String(id)]);
    for (let i = 0; i < items.length; i += 400) {
      for (const [id, d] of items.slice(i, i + 400)) setProvPath(id, d);
      await new Promise(r => setTimeout(r, 0)); // отдаём кадр браузеру (rAF в фоновой вкладке не идёт)
    }
  }
  function buildProvPaths() {
    const t0 = performance.now();
    applyProvPaths(Array.from(P.allPaths()));
    console.info("провинции построены за", Math.round(performance.now() - t0), "мс");
  }
  // Растр id: компактный data/<name>.ids (сжатые id, в 4 раза меньше PNG и без разбора картинки),
  // если его нет или браузер не умеет распаковывать — PNG. ГМ публикует оба: PNG читают и скрипты лора.
  async function loadIds(M, name, ver, land) {
    try { await M.load("data/" + name + ".ids" + ver, land); }
    catch (e) { console.warn(name + ".ids:", e.message, "— читаю PNG"); await M.load("data/" + name + ".png" + ver, land); }
  }
  // Провинции: растр (provinces.ids), ~800 контуров и подписей — это ~0,7 с работы и тысячи элементов.
  // На общем виде их не видно, поэтому строим один раз, когда они понадобились.
  let rasterVer = "", pathsCache = null, provP = null, provWanted = false;
  function savePaths(patch) { pathsCache = Object.assign({}, pathsCache, patch); DB.set("paths", pathsCache).catch(() => {}); }
  // Готовые контуры лежат в репозитории: data/paths.json (страны и берег) и data/paths_prov.json (провинции). Их собирает ГМ
  // при публикации карты (pathsFiles), поэтому у игрока контуры не считаются совсем. Файл годится, только если отпечаток растра
  // (kc для стран, kp для провинций) совпал с загруженным — иначе считаем сами, как раньше. IndexedDB остаётся быстрым кэшем.
  const sharedP = {};
  let repoPaths = null; // true/false — совпал ли файл из репозитория с растром (null — не проверяли)
  function getShared(name, ver) {
    return sharedP[name] || (sharedP[name] = fetch("data/" + name + ".json" + ver).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  // данные провинций (растр, контуры из кэша или из фонового потока) — без элементов страницы; заранее, в свободное время
  let provDataP = null;
  function prepareProvinces() {
    if (provDataP || !rasterVer) return provDataP || Promise.reject(new Error("карта ещё не загружена"));
    provDataP = (async () => {
      await loadIds(P, "provinces", rasterVer, T.land);
      const kp = PATHS_VER + "|" + idsHash(P.ids);
      let pp = pathsCache && pathsCache.kp === kp && pathsCache.p ? pathsCache.p : null, hitP = !!pp;
      if (!pp) {
        const sh = await getShared("paths_prov", rasterVer);
        if (sh && sh.pv === PATHS_VER && sh.kp === kp && sh.p) { pp = sh.p; hitP = true; } // готовые контуры из репозитория
        else pp = await computePaths(P, true, false);
        savePaths({ kp, p: { paths: pp.paths } });
      }
      return { pp, hitP };
    })();
    provDataP.catch(() => { provDataP = null; });
    return provDataP;
  }
  // элементы провинций (подписи и контуры) — когда понадобились; порциями, чтобы не было долгого кадра
  function ensureProvinces() {
    if (provP || !rasterVer) return provP || Promise.resolve();
    provWanted = true;
    provP = (async () => {
      const t1 = performance.now(), ids = Object.keys(state.provinces);
      for (let i = 0; i < ids.length; i += 400) {
        for (const id of ids.slice(i, i + 400)) renderProvince(id);
        await new Promise(r => setTimeout(r, 0));
      }
      const { pp, hitP } = await prepareProvinces();
      await applyProvPaths(pp.paths);
      provReady = true;
      console.info("провинции " + (hitP ? "из кэша" : "построены") + " за", Math.round(performance.now() - t1), "мс");
      if (globe) syncGlobe(true); // глобус уже открыт — передаём ему растр провинций
    })();
    provP.catch(e => { console.error("провинции:", e); provP = null; });
    return provP;
  }
  async function load() {
    // «no-cache» — браузер каждый раз спрашивает сервер (по ETag), но если файл не менялся, берёт его из кэша (ответ 304 без тела)
    try {
      const [cfg, st] = await Promise.all([
        fetch("data/config.json", { cache: "no-cache" }).then(r => r.json()),
        fetch("data/map.json", { cache: "no-cache", priority: "high" }).then(r => r.json())
      ]);
      config = cfg; state = st; loadedStamp = st.updated || "";
      stateReadyResolve();
      for (const c of COLS) state[c] = state[c] || {};
      // растры привязаны к времени публикации: браузер берёт их из кэша, пока карту не обновят
      const ver = "?v=" + encodeURIComponent(loadedStamp || String(Date.now()));
      const t0 = performance.now();
      // маска суши — отдельный лёгкий файл (1 бит на пиксель), чтобы контуры не ждали тяжёлый рисунок рельефа
      const idsP = loadIds(T, "territories", ver, "assets/map/land_mask.png");
      const cache = await DB.get("paths").catch(() => null);
      if (!cache) getShared("paths", ver); // первый заход: готовые контуры качаем параллельно с растром
      await idsP;
      // ключ кэша — содержимое растра, а не время публикации: правка городов или текстов не заставляет пересчитывать контуры
      const kc = PATHS_VER + "|" + idsHash(T.ids);
      rasterVer = ver; pathsCache = cache;
      let cp = cache && cache.kc === kc && cache.c ? cache.c : null, src = cp ? "из кэша" : "";
      if (!cp) { // нет в браузере: берём готовые из репозитория, а считаем сами, только если их нет или они от другого растра
        const sh = await getShared("paths", ver);
        if (sh && sh.pv === PATHS_VER && sh.kc === kc && sh.c) { cp = sh.c; src = "из репозитория"; repoPaths = true; } else repoPaths = false;
      }
      if (!cp) cp = await computePaths(T, false, true);
      for (const [id, d] of cp.paths) if (state.countries[String(id)]) setCountryPath(id, d);
      setCoast(cp.coast);
      console.info("контуры " + (src || "построены") + " за", Math.round(performance.now() - t0), "мс");
      rebuildAll(false);
      applyFonts(); refreshCityKey();
      buildCountryList(); fillBrushSelect(); buildAllyList(); allyVisChanged();
      window.dispatchEvent(new Event("kg-alliances"));
      // Вход ГМа в этой вкладке считается действительным, только если сохранённый мастер-ключ реально
      // расшифровывает данные стран. Хэш пароля публичен (data/config.json), поэтому по нему сессию не проверяем.
      try { sessionStorage.removeItem(GM_KEY); } catch (e) { /* */ } // старый маркер сессии
      let hasMk = false; try { hasMk = !!sessionStorage.getItem("kg-mech-mk"); } catch (e) { /* */ }
      let restored = false;
      if (hasMk) {
        if (document.readyState !== "complete") await new Promise(r => window.addEventListener("load", r, { once: true }));
        try { restored = !!(window.KGMech && await window.KGMech.verifySession()); } catch (e) { restored = false; }
      }
      setGm(restored);
      updUndo();
      $("mapLoading").classList.add("hidden");
      requestAnimationFrame(refit);
      mapReadyResolve();
      loadLayers().then(() => (window.requestIdleCallback || setTimeout)(() => prepareProvinces().catch(() => {}))); // данные провинций — заранее
      initOps(); // личная карта (армии, флоты, зоны): только после входа за страну или в режиме ГМа
      wrapVectorLayers(); // копии векторных слоёв по краям (<use> покажет и то, что достроится позже)
      if (src !== "из кэша") savePaths({ kc, c: { paths: cp.paths, coast: cp.coast } });
      // провинции — когда понадобятся: приближение (их границы видны с масштаба 0,5), ГМ, глобус
      if (gm) { await ensureProvinces(); offerDraft(); }
      else if (frame.dataset.lod === "near" || provLayerOn()) ensureProvinces();
    } catch (err) {
      console.error(err);
      $("mapLoading").textContent = "Не удалось загрузить карту: " + err.message;
    }
  }
  // ---------- личная карта: армии, флоты, зоны ----------
  // Зоны (суша и море) — это и есть провинции карты: слой «Провинции» показывает их всем. Войска — только игроку своей страны
  // (и тем, кому их открыл ГМ) и ГМу; данные отдаёт mech.js (window.KGForces). Калькулятор боя — только ГМу.
  // Вкладка «Войска» в легенде: верхняя половина — списки войск, нижняя — выбранная зона (и расчёт боя у ГМа).
  let zonesVer = 0, zonesData = null, zoneIds = null, zonesLoading = null, zoneSel = null, forcesList = [], calc = { att: "", def: "", aman: "", dman: "", fort: 0, river: false, coast: false, roll: null };
  const ops = { tab: $("tabForces"), pane: $("paneForces"), list: $("opsList"), zone: $("opsZone") };
  const opsFmt = v => (Math.round(v * 10) / 10).toLocaleString("ru-RU");
  const opsWho = () => (window.KGForces && window.KGForces.who ? window.KGForces.who() : null);
  const cName = c => String((state.countries[String(c)] || {}).name || "Страна " + c).replace(/\n/g, " ");
  const cColor = c => (state.countries[String(c)] || {}).color || "#888";
  function ensureZones() {
    if (zonesLoading) return zonesLoading;
    return (zonesLoading = (async () => {
      const j = await fetch("data/zones.json", { cache: "no-cache" }).then(r => r.json());
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = "data/zones.png?v=" + j.v; });
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, W, H).data, ids = new Uint16Array(W * H);
      for (let i = 0, n = W * H; i < n; i++) ids[i] = (d[i * 4] << 8) | d[i * 4 + 1];
      zonesVer = j.v; zonesData = j.zones; zoneIds = ids;
      loadForces();
    })().catch(e => { console.error(e); zonesLoading = null; }));
  }
  function zoneAt(x, y) {
    if (!zoneIds) return 0;
    const xi = ((Math.floor(x) % W) + W) % W, yi = Math.floor(y);
    return yi < 0 || yi >= H ? 0 : zoneIds[yi * W + xi];
  }
  // значок держит на экране ≈ 20 px при любом масштабе; переменная меняется ступенями, чтобы не пересчитывать стили на каждом кадре
  function forceScale() {
    const v = Math.pow(1.2, Math.round(Math.log(1.1 / s) / Math.log(1.2))).toFixed(3);
    if (world.style.getPropertyValue("--fk") !== v) world.style.setProperty("--fk", v);
  }
  afterView.push(forceScale);
  const forceZone = x => (x.k === "f" && x.s ? x.s : x.z);
  function loadForces() {
    forcesList = window.KGForces ? window.KGForces.get() : [];
    if (opsWho() && !zonesData) ensureZones(); // зоны грузим, только когда они нужны: после входа
    renderForces(); renderOps();
  }
  function renderForces() {
    forceScale();
    const lay = L.forces;
    lay.querySelectorAll(".fx, .zh").forEach(g => g.remove());
    if (!opsWho() || !zonesData) return;
    if (zoneSel && zonesData[zoneSel]) drawZoneHighlight(zoneSel);
    if (!$("opsIcons").checked) return;
    const at = {}; // несколько соединений в одной зоне — рядом, а не друг на друге
    for (const x of forcesList) {
      const z = zonesData[String(forceZone(x))], co = state.countries[String(x.c)];
      if (!z || !z.label) continue;
      const pos = z.label, key = pos[0] + ":" + pos[1], i = at[key] = (at[key] || 0) + 1;
      const g = svgEl("g", { class: "fx " + (x.k === "f" ? "fx-fleet" : "fx-army") + (x.seen ? " fx-seen" : ""), transform: `translate(${pos[0]} ${pos[1]})` }, lay);
      const ic = svgEl("g", { transform: `translate(${(i - 1) * 22} 14)` }, svgEl("g", { class: "fx-i" }, g));
      svgEl("rect", { x: -9, y: -6, width: 18, height: 12, rx: x.k === "f" ? 5 : 1, fill: (co && co.color) || "#888" }, ic);
      if (x.k === "f") svgEl("path", { d: "M-6 1 q3 -3 6 0 t6 0", class: "fx-sym" }, ic);
      else svgEl("path", { d: "M-9 -6 L9 6 M-9 6 L9 -6", class: "fx-sym" }, ic);
      svgEl("title", {}, g).textContent = (x.n || (x.k === "f" ? "Флот" : "Армия")) + " — " + cName(x.c) + " · " + z.name;
    }
  }
  // подсветка выбранной зоны: маленький холст по рамке зоны
  function drawZoneHighlight(zid) {
    const id = +zid; let b = zonesData[zid].bb;
    if (!b) {
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) if (zoneIds[row + x] === id) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      b = zonesData[zid].bb = [x0, y0, x1, y1];
    }
    const [x0, y0, x1, y1] = b;
    if (x1 < x0) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, cv = document.createElement("canvas"); cv.width = bw; cv.height = bh;
    const g = cv.getContext("2d"), im = g.createImageData(bw, bh), d = im.data;
    for (let y = 0; y < bh; y++) { const row = (y + y0) * W + x0; for (let x = 0; x < bw; x++) if (zoneIds[row + x] === id) { const o = (y * bw + x) * 4; d[o] = 24; d[o + 1] = 217; d[o + 2] = 245; d[o + 3] = 95; } }
    g.putImageData(im, 0, 0);
    svgEl("image", { class: "zh", href: cv.toDataURL(), x: x0, y: y0, width: bw, height: bh, "pointer-events": "none" }, L.forces);
  }
  function flyTo(zid) {
    const z = zonesData && zonesData[String(zid)]; if (!z) return;
    const ns = Math.max(s, 0.55);
    setView(ns, viewport.clientWidth / 2 - z.label[0] * ns, viewport.clientHeight / 2 - z.label[1] * ns);
  }
  function pickZone(zid) {
    zoneSel = zid ? String(zid) : null;
    calc.att = ""; calc.def = ""; calc.aman = ""; calc.dman = ""; calc.coast = false; calc.river = false; calc.fort = 0; calc.roll = null;
    renderForces(); renderOps();
  }
  // клик по карте при открытой вкладке «Войска»: выбрать зону под курсором (повторный клик снимает выбор)
  const forcesTabOpen = () => !!opsWho() && !!ops.tab && ops.tab.classList.contains("active") && !!zonesData;
  function clickZone(p) {
    const z = zoneAt(p[0], p[1]);
    pickZone(z && zonesData[String(z)] && String(z) !== zoneSel ? z : null);
  }
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function forceRow(x, onClick) {
    const r = el("div", "ops-row"), dot = el("span", "sat-dot"); dot.style.background = cColor(x.c);
    const who = opsWho(), foreign = who && who.role === "player" && String(x.c) !== String(who.id);
    r.append(dot, el("span", "ops-n", (x.k === "f" ? "⚓ " : "✕ ") + (x.n || "—") + (foreign ? " · " + cName(x.c) : "")));
    // чужие открытые войска: только число дивизий или кораблей, без мощи
    r.append(el("span", "ops-p", x.pw != null && !x.seen ? opsFmt(x.k === "a" ? x.df || x.pw : x.pw) : (x.N || 0) + (x.k === "f" ? " кор." : " див.")));
    r.title = cName(x.c) + " · " + (x.N || 0) + (x.k === "f" ? " кораб." : " дивиз.") + (x.seen ? " (по разведке)" : " · мощь " + opsFmt(x.pw) + (x.k === "a" ? " · в обороне " + opsFmt(x.df || x.pw) : ""));
    if (onClick) { r.classList.add("click"); r.addEventListener("click", onClick); }
    return r;
  }
  function renderOps() {
    if (!ops.tab) return;
    const who = opsWho();
    ops.tab.classList.toggle("hidden", !who);
    if (!who) {
      zoneSel = null;
      if (ops.tab.classList.contains("active")) document.querySelector('#legend .legend-tabs [data-ltab="countries"]').click();
      return;
    }
    ops.tab.textContent = who.role === "gm" ? "Войска" : "Мои войска";
    ops.list.innerHTML = "";
    const mine = forcesList.slice().sort((a, b) => (a.k === b.k ? 0 : a.k === "a" ? -1 : 1) || String(a.c).localeCompare(String(b.c)) || String(a.n).localeCompare(String(b.n), "ru"));
    if (!mine.length) ops.list.append(el("p", "ops-empty", who.role === "gm" ? "Армий и флотов нет. Заведите их в карточке страны (Механики)." : "У вас нет армий и флотов. Их заводит ГМ."));
    for (const x of mine) {
      const zid = forceZone(x), ok = zonesData && zonesData[String(zid)];
      const row = forceRow(x, ok ? () => { pickZone(zid); flyTo(zid); } : null);
      if (who.role === "gm") row.querySelector(".ops-n").textContent += " · " + cName(x.c);
      if (!ok) row.append(el("span", "ops-p", "без зоны"));
      ops.list.append(row);
    }
    renderZoneBox();
  }
  function renderZoneBox() {
    const box = ops.zone; box.innerHTML = "";
    if (!zonesData) { box.append(el("p", "ops-empty", "Загружаю зоны…")); return; }
    if (!zoneSel || !zonesData[zoneSel]) { box.append(el("p", "ops-empty", "Нажмите на карте на зону (провинцию или акваторию): здесь появятся её сведения" + (opsWho() && opsWho().role === "gm" ? " и расчёт боя." : " и ваши войска в ней."))); return; }
    const z = zonesData[zoneSel], sea = z.k === "s", who = opsWho(), M = window.KGMechModel, gmMode = who && who.role === "gm";
    box.append(el("h4", "ops-zname", z.name));
    const T = M && M.ZONE_TERRAIN ? (M.ZONE_TERRAIN[z.ter] || [z.ter])[0] : z.ter;
    const info = [sea ? "Морская зона" : "Зона на суше" + (z.c != null ? " · " + cName(z.c) : " · ничья"), "Местность: " + T];
    if (!sea) { info.push("Дороги и снабжение: " + (z.inf || 0) + " из 5"); if (z.vp) info.push("Города зоны: " + z.vp + " очков"); if (z.split) info.push("Область разделена между странами карты"); }
    box.append(el("p", "ops-info", info.join(" · ")));
    const nb = el("div", "ops-nb"); nb.append(el("span", null, "Соседи: "));
    for (const n of z.nb || []) { const nz = zonesData[String(n)]; if (!nz) continue; const a = el("a", null, nz.name); a.href = "#"; a.addEventListener("click", e => { e.preventDefault(); pickZone(n); flyTo(n); }); nb.append(a, document.createTextNode(" · ")); }
    box.append(nb);
    const here = forcesList.filter(x => String(forceZone(x)) === zoneSel);
    box.append(el("h4", "ops-h", "Войска в зоне"));
    if (!here.length) box.append(el("p", "ops-empty", gmMode ? "Никого." : "Вам здесь никто не известен."));
    for (const x of here) box.append(forceRow(x));
    if (gmMode && M && M.battle) box.append(calcBox(z, M)); // расчёт боя — только ГМ
  }
  // ---------- калькулятор боя (только ГМ) ----------
  function calcBox(z, M) {
    const sea = z.k === "s", wrap = el("div", "ops-calc");
    wrap.append(el("h4", "ops-h", "Расчёт боя в зоне"));
    // сначала войска, стоящие в этой зоне, затем остальные того же вида (армии на суше, флоты в море)
    const kind = sea ? "f" : "a", all = forcesList.filter(x => x.k === kind);
    const pool = all.filter(x => String(forceZone(x)) === zoneSel).concat(all.filter(x => String(forceZone(x)) !== zoneSel));
    const inZone = all.filter(x => String(forceZone(x)) === zoneSel).length;
    const opt = (sel, v, t) => { const o = el("option", null, t); o.value = v; sel.append(o); return o; };
    const pw = (x, key) => (key === "def" && x.k === "a" ? x.df || x.pw : x.pw);
    const forceSel = (key, label) => {
      const row = el("label", "ops-f"), sl = el("select");
      row.append(el("span", null, label), sl);
      opt(sl, "", "— вручную —");
      pool.forEach((x, i) => opt(sl, String(i), (i < inZone ? "● " : "") + cName(x.c) + ": " + (x.n || "—") + " (" + opsFmt(pw(x, key)) + ")"));
      sl.value = calc[key]; sl.addEventListener("change", () => { calc[key] = sl.value; calc.roll = null; renderZoneBox(); });
      return row;
    };
    const power = (key, manKey) => (calc[key] !== "" && pool[+calc[key]] ? pw(pool[+calc[key]], key) : +calc[manKey] || 0);
    const manual = (key, manKey, ph) => {
      const i = el("input"); i.type = "number"; i.min = "0"; i.step = "any"; i.placeholder = ph; i.value = calc[manKey] || ""; i.disabled = calc[key] !== "";
      i.addEventListener("input", () => { calc[manKey] = i.value; calc.roll = null; refresh(); });
      return i;
    };
    wrap.append(forceSel("att", "Нападающий"), manual("att", "aman", "мощь нападающего"));
    wrap.append(forceSel("def", "Обороняющийся (● — стоят в зоне)"), manual("def", "dman", "мощь обороны"));
    const swap = el("button", "small-btn", "⇅ Поменять сторонами"); swap.type = "button";
    swap.addEventListener("click", () => { [calc.att, calc.def] = [calc.def, calc.att]; [calc.aman, calc.dman] = [calc.dman, calc.aman]; calc.roll = null; renderZoneBox(); });
    wrap.append(swap);
    const opts = el("div", "ops-opts2");
    const check = (key, text) => { const l = el("label"), c = el("input"); c.type = "checkbox"; c.checked = calc[key]; c.addEventListener("change", () => { calc[key] = c.checked; calc.roll = null; refresh(); }); l.append(c, " " + text); return l; };
    if (!sea) {
      const fs = el("select"); M.FORT_LEVELS.forEach((f, i) => opt(fs, String(i), "Укрепления: " + f[0] + (f[1] ? " (+" + Math.round(f[1] * 100) + "%)" : ""))); fs.value = String(calc.fort);
      fs.addEventListener("change", () => { calc.fort = +fs.value; calc.roll = null; refresh(); });
      opts.append(fs, check("river", "Форсирование реки"));
    } else opts.append(check("coast", "Оборона у своего берега или базы"));
    wrap.append(opts);
    const out = el("div", "ops-res"); wrap.append(out);
    function refresh() {
      out.innerHTML = "";
      const A = power("att", "aman"), D = power("def", "dman");
      if (!(A > 0) && !(D > 0)) { out.append(el("p", "ops-empty", "Выберите нападающего и обороняющегося или введите мощь сторон.")); return; }
      const r = M.battle(A, D, z, { fort: calc.fort, river: calc.river, coast: calc.coast });
      const tb = el("table", "ops-tb");
      const mulT = v => (v === 1 ? "·" : "×" + v.toFixed(2).replace(".", ","));
      const tr = (a, b, c) => { const t = el("tr"); t.append(el("th", null, a), el("td", "num", b), el("td", "num", c)); tb.append(t); };
      tr("", "Нападающий", "Оборона"); tr("Мощь", opsFmt(A), opsFmt(D));
      for (const p of r.parts) tr(p[0], mulT(p[1]), mulT(p[2]));
      tr("Итого", opsFmt(r.A), opsFmt(r.D));
      out.append(tb);
      out.append(el("p", "ops-verdict", r.verdict + " · перевес " + (isFinite(r.ratio) ? r.ratio.toFixed(2).replace(".", ",") + " : 1" : "∞")));
      out.append(el("p", "ops-info", "Шанс победы нападающего " + Math.round(r.pWin * 100) + "%. Ожидаемые потери: нападающий " + Math.round(r.lossA * 100) + "%, оборона " + Math.round(r.lossD * 100) + "% личного состава (ориентир для ГМа)."));
      const b = el("button", "small-btn", "Бросить кости"); b.type = "button";
      b.addEventListener("click", () => { calc.roll = Math.random() < r.pWin ? "победа нападающего" : "оборона удержала зону"; refresh(); });
      out.append(b);
      if (calc.roll) out.append(el("p", "ops-roll", "Бросок: " + calc.roll));
    }
    refresh();
    return wrap;
  }
  window.addEventListener("kg:forces", loadForces);
  if ($("opsIcons")) $("opsIcons").addEventListener("change", renderForces);
  function initOps() { if (opsWho()) ensureZones(); }
  setTool("pan");
  requestAnimationFrame(fit);
  load();
  // справочник валют (Вики → Лор → Валюты): правка ГМа — обычная правка карты (Ctrl+Z, публикация карты)
  function setCurrency(id, val) {
    if (!gm) return;
    const before = (state.currencies || {})[id] || null;
    if (JSON.stringify(before) === JSON.stringify(val)) return;
    state.currencies = state.currencies || {};
    commit("currencies", id, before, val);
  }
  window.KGMap = { get state() { return state; }, get dirty() { return dirty || terrDirty || provDirty; }, publishFiles, pathsFiles, afterPublish, scaleCities, popByCountry, countryPop, cityOwner, setCurrency, curText: cu => curText(cu), fmtMln: p => fmtMln(p), ready: () => mapReady, stateReady: () => stateReady, login, logout, select, focusCountry, setTool, fit, T, setView3, measures, get globe() { return globe; }, get view() { return { s, tx, ty }; }, get gm() { return gm; }, get fonts() { return currentFonts(); }, get fontScale() { return fontScales(); }, get sat() { return satUi; } };
})();
