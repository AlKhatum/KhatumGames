// Луна: отдельный вид со своей плоской картой (равнопромежуточная проекция NASA LRO) и шаром.
// Для всех — просмотр, слои, линейка и циркуль (по радиусу Луны). Для ГМа — территории (кисть/карандаш/
// ластик/заливка/пипетка), отметки и дороги с настраиваемыми типами, переименование, отмена/повтор.
// Данные: data/moon.json + data/moon_territories.png; публикуются общей кнопкой «Опубликовать».
(function () {
  "use strict";
  const MW = 2048, MH = 1024, NS = "http://www.w3.org/2000/svg", D = Math.PI / 180, RM = 1737.4;
  const UI_KEY = "kg-moon-ui-v1";
  const $ = id => document.getElementById(id);
  const { toast, ask } = window.KG;
  const TM = window.KGTerritoryMake(false);
  const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const uid = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1e3);
  const isGm = () => !!(window.KGMap && window.KGMap.gm);

  // координаты: x,y — пиксели карты 2048×1024; lat, lon — градусы
  const toXY = (lat, lon) => [(lon + 180) / 360 * MW, (90 - lat) / 180 * MH];
  const toLL = (x, y) => [90 - y / MH * 180, x / MW * 360 - 180];
  function dist(a, b) {
    const p1 = a[0] * D, p2 = b[0] * D, dp = p2 - p1, dl = (b[1] - a[1]) * D;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * RM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function dest(p, brg, km) {
    const d = km / RM, b = brg * D, p1 = p[0] * D, l1 = p[1] * D;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / D, ((l2 / D + 540) % 360) - 180];
  }
  function arc(a, b, n) {
    const v = p => [Math.cos(p[0] * D) * Math.cos(p[1] * D), Math.cos(p[0] * D) * Math.sin(p[1] * D), Math.sin(p[0] * D)];
    const va = v(a), vb = v(b), om = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s1 = om < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / Math.sin(om), s2 = om < 1e-9 ? t : Math.sin(t * om) / Math.sin(om);
      const w = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
      out.push([Math.atan2(w[2], Math.hypot(w[0], w[1])) / D, Math.atan2(w[1], w[0]) / D]);
    }
    return out;
  }
  function pathLL(pts) {
    let d = "", prev = null;
    for (const p of pts) {
      const [x, y] = toXY(p[0], p[1]);
      d += (!prev || Math.abs(x - prev[0]) > MW / 2 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
      prev = [x, y];
    }
    return d;
  }
  const fmt = km => (km < 100 ? km.toFixed(1).replace(".", ",") : Math.round(km).toLocaleString("ru-RU")) + " км";

  // реальные названия (moon-names.js): моря, заливы, кратеры, рельеф, места посадок
  const FEATURES = window.KGMoonNames || [];
  const CATS = window.KGMoonNameCats || [];
  const bucket = sz => (sz >= 8 ? 0 : sz >= 5.5 ? 1 : sz >= 4 ? 2 : 3);

  // ---------- состояние ----------
  let st = null, loaded = false, loading = null, active = false, sub = "flat";
  let dirty = false, terrDirty = false, tool = "pan", sel = null, brushT = null, markType = null, roadType = null;
  const undoS = [], redoS = [];
  let mui = { vis: {}, hl: {} };
  try { mui = Object.assign(mui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch (e) { /* */ }
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(mui)); } catch (e) { /* */ } };
  const visOf = (id, def) => (mui.vis[id] != null ? mui.vis[id] : def !== false);

  // ---------- DOM ----------
  const wrap = $("moonWrap"), vp = $("moonViewport"), world = $("moonWorld");
  const svg = id => { const e = document.createElementNS(NS, "svg"); e.setAttribute("viewBox", `0 0 ${MW} ${MH}`); e.setAttribute("width", MW); e.setAttribute("height", MH); e.classList.add("layer"); e.id = id; world.append(e); return e; };
  const tex = document.createElement("img"); tex.className = "layer"; tex.alt = ""; tex.draggable = false; world.append(tex); // текстура грузится при первом открытии Луны
  const Lfill = svg("mFill"), Lborder = svg("mBorder"), Lroads = svg("mRoads");
  const paintCv = document.createElement("canvas"); paintCv.width = MW; paintCv.height = MH; paintCv.className = "layer"; world.append(paintCv);
  const paintCtx = paintCv.getContext("2d", { willReadFrequently: true });
  const Lfeat = svg("mFeat"), Lnames = svg("mNames"), Lmarks = svg("mMarks"), Lmeas = svg("mMeasure"), Lover = svg("mOver");
  Lnames.innerHTML = `<defs><linearGradient id="mLblGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4fd"/><stop offset=".5" stop-color="#ffc3ef"/><stop offset="1" stop-color="#ff74d4"/></linearGradient></defs>`;
  const selPath = document.createElementNS(NS, "path"); selPath.setAttribute("class", "sel-outline"); Lover.append(selPath);
  const cursor = document.createElementNS(NS, "circle"); cursor.setAttribute("class", "brush-cursor"); cursor.setAttribute("r", 8); Lover.append(cursor);
  const draftPath = document.createElementNS(NS, "path"); draftPath.setAttribute("class", "m-draft"); Lover.append(draftPath);
  const vtxG = document.createElementNS(NS, "g"); Lover.append(vtxG);
  const tPaths = new Map(), tEls = {};

  // ---------- вид ----------
  let s = 0.5, tx = 0, ty = 0, fitS = 0.5;
  function setView(ns, ntx, nty) {
    const vw = vp.clientWidth, vh = vp.clientHeight;
    s = Math.min(10, Math.max(fitS * 0.8, ns));
    const mw = MW * s, mh = MH * s;
    tx = mw < vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, ntx));
    ty = mh < vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, nty));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    wrap.style.setProperty("--ms", s);
    wrap.dataset.mz = s >= 2.4 ? 3 : s >= 1.2 ? 2 : s >= 0.6 ? 1 : 0;
    wrap.style.setProperty("--mk", Math.min(1, 1.8 / s).toFixed(3)); // подписи не раздуваются при приближении
    renderMarks(); renderMeasure(); renderVertices();
  }
  function fit() { const vw = vp.clientWidth, vh = vp.clientHeight; if (!vw) return; fitS = Math.min(vw / MW, vh / MH); setView(fitS, 0, 0); }
  function zoomAt(f, cx, cy) { const ns = Math.min(10, Math.max(fitS * 0.8, s * f)), k = ns / s; setView(ns, cx - (cx - tx) * k, cy - (cy - ty) * k); }
  const toMap = e => { const r = vp.getBoundingClientRect(); return [(e.clientX - r.left - tx) / s, (e.clientY - r.top - ty) / s]; };
  vp.addEventListener("wheel", e => { e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top); }, { passive: false });

  // ---------- рендер ----------
  function setTerrPath(id, d) {
    id = String(id); tPaths.set(id, d || "");
    let e = tEls[id];
    if (!e) {
      e = { f: document.createElementNS(NS, "path"), b: document.createElementNS(NS, "path"), t: document.createElementNS(NS, "text") };
      e.f.dataset.mcol = "territories"; e.f.dataset.id = id; e.t.dataset.mcol = "territories"; e.t.dataset.id = id; e.t.dataset.part = "label";
      e.t.setAttribute("class", "lbl-country m-lbl"); Lfill.append(e.f); Lborder.append(e.b); Lnames.append(e.t); tEls[id] = e;
    }
    e.f.setAttribute("d", d || ""); e.b.setAttribute("d", d || "");
    if (sel && sel.col === "territories" && sel.id === id) selPath.setAttribute("d", d || "");
  }
  function renderTerr(id) {
    const t = st.territories[id], e = tEls[id];
    if (!t) { if (e) { e.f.remove(); e.b.remove(); e.t.remove(); delete tEls[id]; tPaths.delete(id); } return; }
    if (!e) setTerrPath(id, tPaths.get(id) || "");
    const el = tEls[id];
    el.f.setAttribute("fill", t.color);
    el.t.setAttribute("x", t.label[0]); el.t.setAttribute("y", t.label[1]); el.t.setAttribute("font-size", t.size);
    el.t.setAttribute("letter-spacing", (t.size * 0.2).toFixed(1)); el.t.setAttribute("stroke-width", Math.max(0.6, t.size * 0.14).toFixed(1));
    L.svg(el.t, t.name);
  }
  function renderFeatures() {
    let h = "";
    for (const [n, la, lo, sz, cat] of FEATURES) {
      if (!visOf("cat:" + cat)) continue;
      const [x, y] = toXY(la, lo), fs = (sz * 1.5).toFixed(1), z = bucket(sz);
      if (cat === "site") {
        // место посадки: значок виден всегда, подпись — при приближении
        h += `<g class="m-site" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g class="m-site-sc"><path class="m-site-ico" d="M0-5 4.4 3H-4.4Z"/></g>` +
          `<text class="m-feat site z${Math.max(2, z)}" x="4" y="0" style="--fs:${fs}px">${esc(n)}</text></g>`;
      } else h += `<text class="m-feat ${cat} z${z}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" style="--fs:${fs}px">${esc(n)}</text>`;
    }
    Lfeat.innerHTML = h;
  }
  // дорога: сглаженная кривая (Катмулл — Ром) через точки
  function smoothD(pts) {
    const P = pts.map(p => toXY(p[0], p[1]));
    if (P.length < 2) return "";
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }
  const DASH = { solid: "", dash: "6 4", dot: "1.5 3" };
  function renderRoads() {
    let h = "";
    for (const r of Object.values(st.roads)) {
      const t = st.roadTypes[r.type] || { color: "#fff", width: 1.5, dash: "solid" };
      if (!visOf("road:" + r.type)) continue;
      const hl = mui.hl["road:" + r.type], d = smoothD(r.pts);
      const isSel = sel && sel.col === "roads" && sel.id === r.id;
      h += `<g data-mcol="roads" data-id="${r.id}"><path class="m-road-hit" d="${d}"/>` +
        `<path class="m-road${hl ? " hl" : ""}${isSel ? " sel" : ""}" d="${d}" style="stroke:${t.color};stroke-width:${t.width}px;stroke-dasharray:${DASH[t.dash] || ""};--glow:${t.color}"/></g>`;
    }
    Lroads.innerHTML = h;
  }
  function shapeSvg(shape, color) {
    switch (shape) {
      case "square": return `<rect x="-5" y="-5" width="10" height="10" fill="${color}"/>`;
      case "diamond": return `<path d="M0-7 5.5 0 0 7-5.5 0Z" fill="${color}"/>`;
      case "triangle": return `<path d="M0-6.5 6 5H-6Z" fill="${color}"/>`;
      case "station": return `<rect x="-3" y="-2" width="6" height="4" fill="${color}"/><rect x="-10" y="-1" width="6" height="2" fill="${color}"/><rect x="4" y="-1" width="6" height="2" fill="${color}"/>`;
      default: return `<circle r="5" fill="${color}"/>`;
    }
  }
  function renderMarks() {
    if (!st) return;
    const k = Math.min(2.5, Math.max(0.4, 1 / s));
    let h = "";
    for (const m of Object.values(st.marks)) {
      if (!visOf("mark:" + m.type)) continue;
      const t = st.markTypes[m.type] || { color: "#fff", shape: "dot" };
      const [x, y] = toXY(m.lat, m.lon), isSel = sel && sel.col === "marks" && sel.id === m.id;
      h += `<g class="m-mark${isSel ? " sel" : ""}${mui.hl["mark:" + m.type] ? " hl" : ""}" data-mcol="marks" data-id="${m.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})" style="--glow:${t.color}">` +
        `<circle r="9" class="m-mark-ring" stroke="${t.color}"/>${shapeSvg(t.shape, t.color)}<text y="20">${tspans(m.name)}</text></g>`;
    }
    Lmarks.innerHTML = h;
  }
  function applyLayers() {
    tex.style.display = visOf("tex") ? "" : "none";
    Lfill.style.display = visOf("fills") ? "" : "none";
    Lborder.style.display = visOf("borders") ? "" : "none";
    Lnames.style.display = visOf("tnames") ? "" : "none";
    renderFeatures();
    Lborder.classList.toggle("hl", !!mui.hl.borders);
    Lnames.classList.toggle("hl", !!mui.hl.tnames);
    renderRoads(); renderMarks();
    if (sub === "globe") globeDirty();
  }
  function renderAll() {
    for (const id of Object.keys(tEls)) if (!st.territories[id]) renderTerr(id);
    for (const id in st.territories) renderTerr(id);
    applyLayers(); buildLists(); updateCard();
  }

  // ---------- выбор, карточка, списки ----------
  function select(ent) {
    sel = ent && st[ent.col] && st[ent.col][ent.id] ? { col: ent.col, id: String(ent.id) } : null;
    selPath.setAttribute("d", sel && sel.col === "territories" ? tPaths.get(sel.id) || "" : "");
    renderRoads(); renderMarks(); renderVertices(); updateCard(); markRows();
    if (sub === "globe") globeDirty();
  }
  function areaKm2(id) {
    const b = TM.bbox[+id]; if (!b) return 0;
    const px = (2 * Math.PI * RM / MW) ** 2; let a = 0;
    for (let y = b[1]; y < b[3]; y++) { const c = Math.cos((90 - (y + 0.5) / MH * 180) * D); for (let x = b[0]; x < b[2]; x++) if (TM.ids[y * MW + x] === +id) a += c; }
    return a * px;
  }
  function updateCard() {
    const box = $("moonCard"); if (!box || !st) return;
    const gm = isGm();
    let h = '<div class="legend-label">Выберите объект на Луне</div>';
    if (sel) {
      const e = st[sel.col][sel.id];
      if (sel.col === "territories") {
        const fsrc = flagSrc(sel.id, e);
        h = `<div class="m-terr-card"><label class="flag${gm ? " can-edit" : ""}" title="${gm ? "Нажмите, чтобы выбрать флаг" : "Флаг территории"}">` +
          (fsrc ? `<img src="${esc(fsrc)}" alt="">` : `<span class="flag-ph">ФЛАГ<br><small>${gm ? "нажмите, чтобы выбрать" : "место под изображение"}</small></span>`) +
          (gm ? `<input type="file" id="mFlagInput" accept="image/*" hidden>` : "") + `</label><div class="legend-info">` +
          `<div class="legend-label">Территория</div>` + (gm ? `<input type="text" id="mName" value="${esc(L.toInput(e.name))}" title="« ↵ » — перенос строки">` : `<div class="country-title">${esc(L.oneLine(e.name))}</div>`) +
          (gm ? `<div class="legend-row"><span>Цвет</span><input type="color" id="mColor" value="${e.color}"><button class="small-btn" id="mDel">Удалить</button></div>` +
            (fsrc ? `<div class="legend-row"><button class="small-btn" id="mFlagClear">Убрать флаг</button></div>` : "") : "") +
          `<div class="legend-meta">Площадь ≈ ${Math.round(areaKm2(sel.id)).toLocaleString("ru-RU")} км²</div></div></div>`;
      } else if (sel.col === "marks") {
        const t = st.markTypes[e.type] || {};
        h = `<div class="legend-label">Отметка · ${esc(t.name || "")}</div>` + (gm ? `<input type="text" id="mName" value="${esc(L.toInput(e.name))}" title="« ↵ » — перенос строки">` : `<div class="country-title">${esc(L.oneLine(e.name))}</div>`) +
          (gm ? `<div class="legend-row"><span>Тип</span><select id="mType">${Object.values(st.markTypes).map(x => `<option value="${x.id}" ${x.id === e.type ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><button class="small-btn" id="mDel">Удалить</button></div>` : "") +
          `<div class="legend-meta">${Math.abs(e.lat).toFixed(2)}° ${e.lat >= 0 ? "с. ш." : "ю. ш."}, ${Math.abs(e.lon).toFixed(2)}° ${e.lon >= 0 ? "в. д." : "з. д."}</div>`;
      } else if (sel.col === "roads") {
        const t = st.roadTypes[e.type] || {};
        let len = 0; for (let i = 1; i < e.pts.length; i++) len += dist(e.pts[i - 1], e.pts[i]);
        h = `<div class="legend-label">Дорога · ${esc(t.name || "")}</div>` + (gm ? `<input type="text" id="mName" value="${esc(L.toInput(e.name))}" title="« ↵ » — перенос строки">` : `<div class="country-title">${esc(L.oneLine(e.name))}</div>`) +
          (gm ? `<div class="legend-row"><span>Тип</span><select id="mType">${Object.values(st.roadTypes).map(x => `<option value="${x.id}" ${x.id === e.type ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select><button class="small-btn" id="mDel">Удалить</button></div>` : "") +
          `<div class="legend-meta">Длина ≈ ${fmt(len)}${gm ? " · тяните точки, чтобы изменить путь" : ""}</div>`;
      }
    }
    box.innerHTML = h;
    if (!sel || !gm) return;
    const e = st[sel.col][sel.id];
    const nm = $("mName"); if (nm) { nm.addEventListener("keydown", ev => { if (ev.key === "Enter") nm.blur(); ev.stopPropagation(); }); nm.addEventListener("change", () => { const v = L.fromInput(nm.value); if (v && v !== e.name) { const a = clone(e); a.name = v; commit(sel.col, sel.id, e, a); } }); }
    const cl = $("mColor"); if (cl) cl.addEventListener("change", () => { const a = clone(e); a.color = cl.value; commit(sel.col, sel.id, e, a); });
    const ty2 = $("mType"); if (ty2) ty2.addEventListener("change", () => { const a = clone(e); a.type = ty2.value; commit(sel.col, sel.id, e, a); });
    const dl = $("mDel"); if (dl) dl.addEventListener("click", () => removeEntity(sel.col, sel.id));
    if (sel.col === "territories") bindFlag(sel.id);
  }
  function buildLists() {
    if (!st) return;
    const gm = isGm();
    // территории
    const tl = $("moonTerrList"); tl.innerHTML = "";
    const terr = Object.values(st.territories).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!terr.length) tl.innerHTML = `<div class="small">${gm ? "Территорий пока нет — нажмите «+ Территория» и рисуйте кистью." : "Территорий пока нет."}</div>`;
    for (const t of terr) {
      const r = document.createElement("div"); r.className = "c-row"; r.dataset.id = t.id;
      r.innerHTML = `<span class="swatch" style="background:${t.color}"></span><span class="c-name">${esc(L.oneLine(t.name))}</span>`;
      r.addEventListener("click", () => { select({ col: "territories", id: t.id }); centerOn(t.label[0], t.label[1]); });
      tl.append(r);
    }
    // слои
    const ll = $("moonLayerList"); ll.innerHTML = "";
    const row = (id, name, opt) => {
      const r = document.createElement("label"); r.className = "layer-row" + (opt && opt.sub ? " sub" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = visOf(id);
      cb.addEventListener("change", () => { mui.vis[id] = cb.checked; saveUi(); applyLayers(); });
      r.append(cb);
      if (opt && opt.color) { const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = opt.color; r.append(sw); }
      const n = document.createElement("span"); n.className = "lname"; n.textContent = name; r.append(n);
      if (opt && opt.hl) {
        const b = document.createElement("button"); b.type = "button"; b.className = "hl-btn" + (mui.hl[id] ? " on" : ""); b.textContent = "Подсветка";
        b.style.setProperty("--hl", opt.hl);
        b.addEventListener("click", ev => { ev.preventDefault(); mui.hl[id] = !mui.hl[id]; if (mui.hl[id]) { mui.vis[id] = true; cb.checked = true; } b.classList.toggle("on", !!mui.hl[id]); saveUi(); applyLayers(); });
        r.append(b);
      }
      ll.append(r);
    };
    const head = t => { const h = document.createElement("div"); h.className = "layer-row group"; h.innerHTML = `<span class="lname">${t}</span>`; ll.append(h); };
    head("Отметки");
    Object.values(st.markTypes).forEach(t => row("mark:" + t.id, t.name, { sub: true, color: t.color, hl: t.color }));
    head("Дороги");
    Object.values(st.roadTypes).forEach(t => row("road:" + t.id, t.name, { sub: true, color: t.color, hl: t.color }));
    head("Названия (реальные)");
    CATS.forEach(c => row("cat:" + c.id, c.name + " · " + FEATURES.filter(f => f[4] === c.id).length, { sub: true, color: c.color }));
    row("tnames", "Названия территорий", { hl: "#ff7fd8" });
    row("borders", "Границы территорий", { hl: "#ff3fd0" });
    row("fills", "Заливка территорий");
    row("tex", "Поверхность (NASA LRO)");
    // типы (ГМ)
    const tyl = $("moonTypeList"); tyl.innerHTML = "";
    const typeRow = (col, t, meta) => {
      const used = Object.values(st[col === "markTypes" ? "marks" : "roads"]).filter(x => x.type === t.id).length;
      const r = document.createElement("div"); r.className = "sat-row";
      r.innerHTML = `<span class="sat-dot" style="background:${t.color}"></span><span class="sat-name">${esc(t.name)}</span><span class="sat-type">${meta} · ${used}</span>` +
        `<button class="c-go">✎</button><button class="c-del">✕</button>`;
      r.querySelector(".c-go").addEventListener("click", () => editType(col, t.id));
      r.querySelector(".c-del").addEventListener("click", () => deleteType(col, t.id));
      tyl.append(r);
    };
    const h1 = document.createElement("div"); h1.className = "legend-label"; h1.textContent = "Типы отметок"; tyl.append(h1);
    Object.values(st.markTypes).forEach(t => typeRow("markTypes", t, (window.KGSats.SHAPES[t.shape] || t.shape)));
    const h2 = document.createElement("div"); h2.className = "legend-label"; h2.textContent = "Типы дорог"; tyl.append(h2);
    Object.values(st.roadTypes).forEach(t => typeRow("roadTypes", t, { solid: "сплошная", dash: "штрих", dot: "пунктир" }[t.dash] || ""));
    // выпадающие списки панели инструментов
    const fill = (selEl, items, cur) => { selEl.innerHTML = items.map(x => `<option value="${x.id}">${esc(L.oneLine(x.name))}</option>`).join(""); if (cur && items.some(x => x.id === cur)) selEl.value = cur; return selEl.value || null; };
    brushT = fill($("mbTerr"), terr, brushT);
    markType = fill($("mbMark"), Object.values(st.markTypes), markType);
    roadType = fill($("mbRoad"), Object.values(st.roadTypes), roadType);
    markRows();
  }
  function markRows() { document.querySelectorAll("#moonTerrList .c-row").forEach(r => r.classList.toggle("active", !!sel && sel.col === "territories" && r.dataset.id === sel.id)); }
  function centerOn(x, y) { const ns = Math.max(s, fitS * 2); setView(ns, vp.clientWidth / 2 - x * ns, vp.clientHeight / 2 - y * ns); }

  // ---------- правки и история ----------
  function setEntity(col, id, val) {
    if (val == null) delete st[col][id]; else st[col][id] = val;
    if (col === "territories") renderTerr(id);
    if (sel && sel.col === col && sel.id === id && val == null) sel = null;
    renderRoads(); renderMarks(); renderVertices(); buildLists(); updateCard();
    if (col === "satellites" || col === "satTypes") refreshSats();
    if (sub === "globe") syncGlobe(false);
  }
  function markDirty(paint) {
    dirty = true; if (paint) terrDirty = true;
    const dot = $("gmDirty"); if (dot) dot.classList.remove("hidden");
  }
  function push(e) { undoS.push(e); if (undoS.length > 200) undoS.shift(); redoS.length = 0; markDirty(e.kind === "paint" || (e.kind === "multi" && e.items.some(i => i.kind === "paint"))); updUndo(); }
  function commit(col, id, before, after) { push({ kind: "entity", col, id: String(id), before: clone(before), after: clone(after) }); setEntity(col, String(id), clone(after)); }
  function applyE(e, back) {
    if (e.kind === "entity") setEntity(e.col, e.id, clone(back ? e.before : e.after));
    else if (e.kind === "paint") { TM.apply(e.stroke, back); recompute(e.stroke.labels); }
    else (back ? e.items.slice().reverse() : e.items).forEach(i => applyE(i, back));
  }
  function undo() { const e = undoS.pop(); if (!e) return; redoS.push(e); applyE(e, true); markDirty(true); updUndo(); }
  function redo() { const e = redoS.pop(); if (!e) return; undoS.push(e); applyE(e, false); markDirty(true); updUndo(); }
  function updUndo() { $("mUndo").disabled = !undoS.length; $("mRedo").disabled = !redoS.length; }
  function recompute(labels) {
    const r = TM.pathsFor(labels);
    for (const [L, d] of r) if (st.territories[String(L)]) setTerrPath(L, d);
    if (sub === "globe" && globe) { globe.setIds(TM.ids); globeDirty(); }
  }
  async function removeEntity(col, id) {
    const e = st[col][id]; if (!e) return;
    const ok = await ask("Удалить «" + e.name + "»?", "", { confirm: true, note: "Ctrl+Z — вернуть." });
    if (!ok) return;
    if (col === "territories") {
      const ch = TM.beginStroke(), b = TM.bbox[+id];
      if (b) for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) { const i = y * MW + x; if (TM.ids[i] === +id) TM._set(i, 0, ch); }
      const stroke = TM.endStroke(ch);
      const items = []; if (stroke.idx.length) items.push({ kind: "paint", stroke });
      items.push({ kind: "entity", col, id, before: clone(e), after: null });
      setEntity(col, id, null); recompute(stroke.labels); push({ kind: "multi", items });
    } else commit(col, id, e, null);
  }

  // ---------- типы отметок и дорог ----------
  function form(title, fields, values, validate) {
    // используем общий конструктор форм карты, если он есть; иначе — простой ask
    return window.KGForm ? window.KGForm(title, fields, values, validate) : Promise.resolve(null);
  }
  async function editType(col, id) {
    if (!isGm()) return;
    const before = id ? st[col][id] : null;
    const isMark = col === "markTypes";
    const fields = [{ key: "name", label: "Название типа" }, { key: "color", label: "Цвет", type: "color" }].concat(isMark
      ? [{ key: "shape", label: "Значок", type: "select", options: Object.entries(window.KGSats.SHAPES) }]
      : [{ key: "width", label: "Толщина линии, px", type: "number", min: 0.5, max: 8, step: 0.1 }, { key: "dash", label: "Линия", type: "select", options: [["solid", "Сплошная"], ["dash", "Штрих"], ["dot", "Пунктир"]] }]);
    const base = before ? clone(before) : isMark ? { name: "", color: "#7fe8ff", shape: "dot" } : { name: "", color: "#ffe14d", width: 2, dash: "solid" };
    const v = await form(before ? "Тип: " + before.name : isMark ? "Новый тип отметок" : "Новый тип дорог", fields, base, x => (x.name ? "" : "Укажите название"));
    if (!v) return;
    const nid = before ? id : uid(isMark ? "mt" : "rt");
    commit(col, nid, before, Object.assign({ id: nid }, v, isMark ? {} : { width: +v.width || 2 }));
  }
  async function deleteType(col, id) {
    const t = st[col][id]; if (!t || !isGm()) return;
    const users = Object.values(st[col === "markTypes" ? "marks" : "roads"]).filter(x => x.type === id);
    if (users.length) { toast("Тип используют: " + users.slice(0, 5).map(u => u.name).join(", ") + (users.length > 5 ? "…" : "")); return; }
    if (await ask("Удалить тип «" + t.name + "»?", "", { confirm: true })) commit(col, id, t, null);
  }

  // ---------- инструменты ----------
  const PAINT = ["brush", "pencil", "eraser", "fill", "picker"], ALL = ["pan", "ruler", "compass"];
  const HINTS = {
    pan: "Тяните — двигать, колесо — масштаб. Клик — выбрать территорию, отметку или дорогу.",
    brush: "Кисть: рисуйте территорию. [ и ] — размер, Alt+клик — взять территорию, правая кнопка — двигать карту.",
    pencil: "Карандаш: точная правка границы.", eraser: "Ластик: убирает территорию.", fill: "Заливка связной области.", picker: "Пипетка: выберите территорию для кисти.",
    mark: "Кликните, чтобы поставить отметку выбранного типа.",
    road: "Дорога: кликайте по точкам пути. Двойной клик или Enter — закончить, Backspace — убрать точку, Esc — отмена.",
    erase: "Кликните по отметке, дороге или территории, чтобы удалить.",
    ruler: "Линейка: кликайте по точкам — расстояние по поверхности Луны. Двойной клик или Enter — закончить.",
    compass: "Циркуль: нажмите в центре и тяните — окружность на поверхности Луны."
  };
  let pencil = 2, brush = 20;
  function setTool(t) {
    if (!isGm() && !ALL.includes(t)) t = "pan";
    if (sub === "globe") t = "pan";
    if (tool === "road" && t !== "road") finishRoad(false);
    if (tool === "ruler" && t !== "ruler") finishRuler();
    tool = t;
    wrap.querySelectorAll("[data-mtool]").forEach(b => b.classList.toggle("active", b.dataset.mtool === t));
    vp.dataset.tool = ["brush", "pencil", "eraser"].includes(t) ? "brush" : t;
    $("mBrushBar").classList.toggle("hidden", !isGm() || !["brush", "pencil", "eraser", "fill", "mark", "road"].includes(t));
    $("mbTerrBox").classList.toggle("hidden", !["brush", "pencil", "fill"].includes(t));
    $("mbSizeBox").classList.toggle("hidden", !["brush", "pencil", "eraser"].includes(t));
    $("mbMarkBox").classList.toggle("hidden", t !== "mark");
    $("mbRoadBox").classList.toggle("hidden", t !== "road");
    requestAnimationFrame(() => { const bb = $("mBrushBar"); wrap.style.setProperty("--bbh", bb.classList.contains("hidden") ? "0px" : bb.offsetHeight + "px"); });
    const sz = $("mbSize"); if (t === "pencil") { sz.max = 4; sz.value = pencil; } else { sz.max = 80; sz.value = brush; }
    $("mbSizeVal").textContent = sz.value;
    cursor.style.display = isGm() && ["brush", "pencil", "eraser"].includes(t) ? "" : "none";
    cursor.setAttribute("r", Math.max(0.5, sz.value / 2));
    $("moonHint").textContent = HINTS[t] || "";
  }
  $("mbSize").addEventListener("input", e => { if (tool === "pencil") pencil = +e.target.value; else brush = +e.target.value; $("mbSizeVal").textContent = e.target.value; cursor.setAttribute("r", Math.max(0.5, e.target.value / 2)); });
  $("mbTerr").addEventListener("change", e => (brushT = e.target.value));
  $("mbMark").addEventListener("change", e => (markType = e.target.value));
  $("mbRoad").addEventListener("change", e => (roadType = e.target.value));
  wrap.querySelectorAll("[data-mtool]").forEach(b => b.addEventListener("click", () => setTool(tool === b.dataset.mtool && ALL.includes(tool) && tool !== "pan" ? "pan" : b.dataset.mtool)));
  $("mUndo").onclick = undo; $("mRedo").onclick = redo;
  $("mAddTerr").onclick = async () => {
    if (!isGm()) return;
    let id = 1; while (st.territories[id] || TM.bbox[id]) id++;
    if (id > 255) { toast("Предел — 255 территорий"); return; }
    const name = await ask("Название лунной территории", "Новая территория", { multiline: true });
    if (!name) return;
    const cx = (vp.clientWidth / 2 - tx) / s, cy = (vp.clientHeight / 2 - ty) / s;
    const cv = document.createElement("canvas").getContext("2d"); cv.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 65% 62%)`;
    commit("territories", String(id), null, { id: String(id), name, color: cv.fillStyle, label: [Math.round(cx), Math.round(cy)], size: 12 });
    brushT = String(id); buildLists(); setTool("brush");
    toast("Нарисуйте территорию кистью");
  };
  $("mAddMarkType").onclick = () => editType("markTypes", null);
  $("mAddRoadType").onclick = () => editType("roadTypes", null);

  // рисование территорий
  let stroke = null, last = null;
  function preview(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(MW, Math.ceil(x1)); y1 = Math.min(MH, Math.ceil(y1));
    const bw = x1 - x0, bh = y1 - y0; if (bw <= 0 || bh <= 0) return;
    const img = paintCtx.getImageData(x0, y0, bw, bh), d = img.data;
    const t = stroke.v ? st.territories[String(stroke.v)] : null, c = document.createElement("canvas").getContext("2d");
    c.fillStyle = t ? t.color : "#202020"; const hx = c.fillStyle, rgb = [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * MW + x0 + x; if (TM.mark[i] !== TM.strokeNo) continue;
      const o = (y * bw + x) * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = stroke.v ? 210 : 160;
    }
    paintCtx.putImageData(img, x0, y0);
  }
  function paintValue() {
    if (tool === "eraser") return 0;
    if (!brushT || !st.territories[brushT]) { toast("Создайте или выберите территорию («+ Территория»)"); return null; }
    return +brushT;
  }
  function endPaint(ch, v, hadBox) {
    const res = TM.endStroke(ch);
    paintCtx.clearRect(0, 0, MW, MH);
    if (!res.idx.length) return;
    recompute(res.labels); push({ kind: "paint", stroke: res });
    if (v && !hadBox) { const t = st.territories[String(v)], lp = TM.labelPoint(v); if (t && lp) { const a = clone(t); a.label = lp; setEntity("territories", String(v), a); } }
  }
  function pick(p) { const v = TM.at(p[0], p[1]); if (!v || !st.territories[String(v)]) { toast("Здесь нет территории"); return; } brushT = String(v); $("mbTerr").value = brushT; toast("Кисть: " + L.oneLine(st.territories[brushT].name)); }

  // дороги
  let roadDraft = null, editVtx = null;
  function finishRoad(save) {
    const r = roadDraft; roadDraft = null; draftPath.setAttribute("d", "");
    if (save && r && r.pts.length >= 2) {
      ask("Название дороги", st.roadTypes[roadType] ? st.roadTypes[roadType].name : "Дорога", { multiline: true }).then(name => {
        if (!name) return;
        const id = uid("road"); commit("roads", id, null, { id, type: roadType, name, pts: r.pts.map(p => [+p[0].toFixed(3), +p[1].toFixed(3)]) });
      });
    }
  }
  function renderDraft(cursorLL) {
    if (!roadDraft) { draftPath.setAttribute("d", ""); return; }
    const pts = cursorLL ? roadDraft.pts.concat([cursorLL]) : roadDraft.pts;
    draftPath.setAttribute("d", smoothD(pts));
  }
  function renderVertices() {
    vtxG.innerHTML = "";
    if (!st || !sel || sel.col !== "roads" || !isGm()) return;
    const r = st.roads[sel.id]; if (!r) return;
    const rad = (5 / s).toFixed(2);
    vtxG.innerHTML = r.pts.map((p, i) => { const [x, y] = toXY(p[0], p[1]); return `<circle class="vertex" data-vi="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad}"/>`; }).join("");
  }

  // измерения (по радиусу Луны)
  const meas = { lines: [], circles: [] }; let ruler = null, circ = null;
  function finishRuler() { if (ruler && ruler.pts.length >= 2) meas.lines.push(ruler.pts); ruler = null; renderMeasure(); }
  function renderMeasure() {
    const fs = (12 / s).toFixed(2), dot = (3.5 / s).toFixed(2), sw = (3 / s).toFixed(2);
    let h = "", out = "";
    const lbl = (ll, t) => { const [x, y] = toXY(ll[0], ll[1]); return `<text x="${x.toFixed(1)}" y="${(y - 7 / s).toFixed(1)}" font-size="${fs}" stroke-width="${sw}" class="m-lbl">${esc(t)}</text>`; };
    const line = (pts, live) => {
      let all = [], acc = 0;
      for (let i = 1; i < pts.length; i++) { const seg = arc(pts[i - 1], pts[i], 48); if (i > 1) seg.shift(); all = all.concat(seg); }
      if (pts.length > 1) h += `<path class="m-line${live ? " live" : ""}" d="${pathLL(all)}"/>`;
      pts.forEach((p, i) => { if (i) acc += dist(pts[i - 1], p); const [x, y] = toXY(p[0], p[1]); h += `<circle class="m-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dot}"/>`; if (i) h += lbl(p, fmt(acc)); });
      return acc;
    };
    const circle = (c, live) => {
      const pts = []; for (let a = 0; a <= 360; a += 3) pts.push(dest(c.c, a, c.r));
      h += `<path class="m-circle${live ? " live" : ""}" d="${pathLL(pts)}"/>`;
      const [x, y] = toXY(c.c[0], c.c[1]); h += `<circle class="m-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dot}"/>` + lbl(dest(c.c, 90, c.r / 2), "R " + fmt(c.r));
    };
    meas.lines.forEach(l => line(l));
    meas.circles.forEach(c => circle(c));
    if (ruler) out = "Линейка: " + fmt(line(ruler.cursor ? ruler.pts.concat([ruler.cursor]) : ruler.pts, true));
    else if (circ) { circle(circ, true); out = "Циркуль: радиус " + fmt(circ.r); }
    Lmeas.innerHTML = h;
    const o = $("mMeasOut"); o.textContent = out; o.classList.toggle("hidden", !out);
  }
  $("mMeasClear").onclick = () => { meas.lines = []; meas.circles = []; ruler = null; circ = null; renderMeasure(); };

  // ---------- указатель (плоская карта) ----------
  let drag = null, lastClick = { t: 0, key: "" };
  const entOf = t => { const el = t && t.closest ? t.closest("[data-mcol]") : null; return el ? { col: el.dataset.mcol, id: el.dataset.id, part: el.dataset.part || null } : null; };
  vp.addEventListener("contextmenu", e => e.preventDefault());
  vp.addEventListener("pointerdown", e => {
    vp.setPointerCapture(e.pointerId);
    const p = toMap(e), ent = entOf(e.target), panBtn = e.button === 1 || e.button === 2, gm = isGm();
    const v = e.target.closest && e.target.closest(".vertex");
    if (gm && v && sel && sel.col === "roads") { drag = { kind: "vtx", i: +v.dataset.vi, before: clone(st.roads[sel.id]) }; return; }
    if (!panBtn && tool === "compass") { circ = { c: toLL(p[0], p[1]), r: 0 }; drag = { kind: "compass" }; return; }
    if (gm && !panBtn && ["brush", "pencil", "eraser"].includes(tool)) {
      if (e.altKey) { pick(p); return; }
      const val = paintValue(); if (val == null) return;
      const r = Math.max(0.5, (tool === "pencil" ? pencil : brush) / 2), ch = TM.beginStroke();
      stroke = { ch, v: val, r, opts: { land: false, keep: false }, hadBox: val && !!TM.bbox[val] };
      TM.stamp(p[0], p[1], r, val, stroke.opts, ch); preview(p[0] - r - 1, p[1] - r - 1, p[0] + r + 1, p[1] + r + 1);
      last = p; drag = { kind: "paint" }; return;
    }
    if (gm && !panBtn && tool === "pan" && ent && (ent.col === "marks" || ent.part === "label")) {
      drag = { kind: "move", ent, p0: p, sx: e.clientX, sy: e.clientY, before: clone(st[ent.col][ent.id]), moved: false }; return;
    }
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx, ty, moved: false, ent, p, panOnly: panBtn };
  });
  vp.addEventListener("pointermove", e => {
    const p = toMap(e);
    if (cursor.style.display !== "none") { cursor.setAttribute("cx", p[0]); cursor.setAttribute("cy", p[1]); }
    if (!drag) {
      if (tool === "road" && roadDraft) renderDraft(toLL(p[0], p[1]));
      if (tool === "ruler" && ruler) { ruler.cursor = toLL(p[0], p[1]); renderMeasure(); }
      return;
    }
    if (drag.kind === "paint" && stroke) {
      TM.line(last[0], last[1], p[0], p[1], stroke.r, stroke.v, stroke.opts, stroke.ch);
      const r = stroke.r + 1; preview(Math.min(last[0], p[0]) - r, Math.min(last[1], p[1]) - r, Math.max(last[0], p[0]) + r, Math.max(last[1], p[1]) + r); last = p; return;
    }
    if (drag.kind === "compass") { circ.r = dist(circ.c, toLL(p[0], p[1])); renderMeasure(); return; }
    if (drag.kind === "vtx") { const r = st.roads[sel.id]; r.pts[drag.i] = toLL(p[0], p[1]).map(v => +v.toFixed(3)); drag.moved = true; renderRoads(); renderVertices(); return; }
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) setView(s, drag.tx + dx, drag.ty + dy);
      return;
    }
    if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const en = st[drag.ent.col][drag.ent.id], b = drag.before;
      if (drag.ent.col === "marks") { const ll = toLL(p[0], p[1]); en.lat = +ll[0].toFixed(3); en.lon = +ll[1].toFixed(3); renderMarks(); }
      else { en.label = [Math.round(b.label[0] + p[0] - drag.p0[0]), Math.round(b.label[1] + p[1] - drag.p0[1])]; renderTerr(drag.ent.id); }
    }
  });
  vp.addEventListener("pointerup", async e => {
    const d = drag; drag = null; if (!d) return;
    const p = toMap(e);
    if (d.kind === "paint") { const st2 = stroke; stroke = null; endPaint(st2.ch, st2.v, st2.hadBox); return; }
    if (d.kind === "compass") { if (circ && circ.r > 0.5) meas.circles.push(circ); circ = null; renderMeasure(); return; }
    if (d.kind === "vtx") { if (d.moved) commit("roads", sel.id, d.before, st.roads[sel.id]); return; }
    if (d.kind === "move") { if (d.moved) commit(d.ent.col, d.ent.id, d.before, st[d.ent.col][d.ent.id]); else select(d.ent.part === "label" ? { col: "territories", id: d.ent.id } : d.ent); return; }
    if (d.moved || d.panOnly) return;
    const key = d.ent ? d.ent.col + d.ent.id : "-", now = performance.now();
    const dbl = now - lastClick.t < 380 && lastClick.key === key; lastClick = { t: dbl ? 0 : now, key };
    const ll = toLL(p[0], p[1]), gm = isGm();
    if (tool === "ruler") { if (dbl) finishRuler(); else { (ruler = ruler || { pts: [] }).pts.push(ll); renderMeasure(); } return; }
    if (tool === "road" && gm) {
      if (dbl) { finishRoad(true); return; }
      if (!st.roadTypes[roadType]) { toast("Создайте тип дороги во вкладке «Типы»"); return; }
      (roadDraft = roadDraft || { pts: [] }).pts.push(ll); renderDraft(); return;
    }
    if (tool === "mark" && gm) {
      if (!st.markTypes[markType]) { toast("Создайте тип отметки во вкладке «Типы»"); return; }
      const name = await ask("Название отметки", st.markTypes[markType].name, { multiline: true });
      if (!name) return;
      const id = uid("mk"); commit("marks", id, null, { id, type: markType, name, lat: +ll[0].toFixed(3), lon: +ll[1].toFixed(3) }); return;
    }
    if (tool === "fill" && gm) {
      const v = paintValue(); if (v == null) return;
      const ch = TM.beginStroke(), hadBox = v && !!TM.bbox[v];
      TM.fill(p[0], p[1], v, { land: false, keep: false }, ch);
      endPaint(ch, v, hadBox); return;
    }
    if (tool === "picker" && gm) { pick(p); setTool("brush"); return; }
    if (tool === "erase" && gm) { if (d.ent) removeEntity(d.ent.col, d.ent.id); else { const v = TM.at(p[0], p[1]); if (v && st.territories[v]) removeEntity("territories", String(v)); } return; }
    // выбор
    if (dbl && gm && d.ent) { const e2 = st[d.ent.col][d.ent.id]; const v = await ask("Новое название", e2.name, { multiline: true }); if (v && v !== e2.name) { const a = clone(e2); a.name = v; commit(d.ent.col, d.ent.id, e2, a); } return; }
    if (d.ent && d.ent.col !== "territories") { select(d.ent); return; }
    const v = TM.at(p[0], p[1]); select(v && st.territories[v] ? { col: "territories", id: String(v) } : null);
  });

  window.addEventListener("keydown", e => {
    if (!active || (e.target.matches && e.target.matches("input, textarea, select")) || !$("modal").classList.contains("hidden") || !$("formModal").classList.contains("hidden")) return;
    const k = e.key.toLowerCase();
    if (tool === "road" && roadDraft) {
      if (e.key === "Enter") { finishRoad(true); return; }
      if (e.key === "Escape") { finishRoad(false); return; }
      if (e.key === "Backspace") { roadDraft.pts.pop(); if (!roadDraft.pts.length) roadDraft = null; renderDraft(); e.preventDefault(); return; }
    }
    if (tool === "ruler" && e.key === "Enter") { finishRuler(); return; }
    if (e.key === "Escape") { ruler = null; circ = null; renderMeasure(); select(null); return; }
    if (!isGm()) return;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "я")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "н")) { e.preventDefault(); redo(); return; }
    if (k === "[" || k === "]" || k === "х" || k === "ъ") { const sz = $("mbSize"); sz.value = Math.max(+sz.min, Math.min(+sz.max, +sz.value + (k === "]" || k === "ъ" ? 2 : -2))); sz.dispatchEvent(new Event("input")); }
  });

  // ---------- шар Луны (WebGL) ----------
  const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float; varying vec2 v;
uniform vec2 uView; uniform float uRad; uniform vec2 uRot; uniform sampler2D uTex, uIds, uPal;
uniform vec4 uShow; // поверхность, заливка, границы, подсветка границ
uniform float uSel;
const float PI = 3.141592653589793;
float cid(vec2 uv){ return floor(texture2D(uIds, uv).r * 255.0 + 0.5); }
void main(){
  vec2 q = v * uView * 0.5 / uRad; float r2 = dot(q, q);
  if (r2 > 1.0) { gl_FragColor = vec4(0.75, 0.8, 0.9, 1.0) * exp(-(sqrt(r2) - 1.0) * 30.0) * 0.25; return; }
  float z = sqrt(1.0 - r2), c0 = cos(uRot.x), s0 = sin(uRot.x);
  float lat = asin(clamp(q.y * c0 + z * s0, -1.0, 1.0));
  float lon = mod(uRot.y + atan(q.x, z * c0 - q.y * s0) + PI, 2.0 * PI) - PI;
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 col = uShow.x > 0.5 ? texture2D(uTex, uv).rgb : vec3(0.35);
  float id = cid(uv);
  if (id > 0.5 && uShow.y > 0.5) col = mix(col, texture2D(uPal, vec2((id + 0.5) / 256.0, 0.5)).rgb, 0.45);
  if (abs(id - uSel) < 0.5 && id > 0.5) col = mix(col, vec3(1.0, 0.45, 0.85), 0.2);
  if (uShow.z > 0.5) {
    vec2 e = vec2(1.0 / 2048.0, 1.0 / 1024.0) * max(1.0, 1.4 * length(fwidth(uv * vec2(2048.0, 1024.0))));
    if (cid(uv + vec2(e.x, 0.0)) != id || cid(uv + vec2(0.0, e.y)) != id) col = uShow.w > 0.5 ? mix(col, vec3(1.0, 0.6, 0.91), 0.95) : mix(col, vec3(0.08, 0.05, 0.12), 0.7);
  }
  float light = 0.45 + 0.55 * clamp(dot(normalize(vec3(q, z)), normalize(vec3(-0.4, 0.45, 0.8))), 0.0, 1.0);
  gl_FragColor = vec4(col * light * smoothstep(1.0, 0.99, sqrt(r2)), 1.0);
}`;
  let globe = null, gRaf = 0;
  function MoonGlobe(cv, ov) {
    const gl = cv.getContext("webgl", { antialias: true }); this.gl = gl; this.cv = cv; this.ov = ov;
    if (!gl) return;
    gl.getExtension("OES_standard_derivatives");
    const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr); this.pr = pr;
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; ["uView", "uRad", "uRot", "uTex", "uIds", "uPal", "uShow", "uSel"].forEach(n => (this.u[n] = gl.getUniformLocation(pr, n)));
    this.t = { tex: gl.createTexture(), ids: gl.createTexture(), pal: gl.createTexture() };
    this.lat = 0; this.lon = 0; this.zoom = 1;
  }
  MoonGlobe.prototype._bind = function (k, unit, filter) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.t[k]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  };
  MoonGlobe.prototype.setTex = function (img) { const gl = this.gl; this._bind("tex", 0, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); };
  MoonGlobe.prototype.setIds = function (ids) { const gl = this.gl; this._bind("ids", 1, gl.NEAREST); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, MW, MH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, ids); };
  MoonGlobe.prototype.setPal = function (st2) {
    const gl = this.gl, d = new Uint8Array(1024), c = document.createElement("canvas").getContext("2d");
    for (const id in st2.territories) { c.fillStyle = st2.territories[id].color; const h = c.fillStyle; const i = +id; if (i > 0 && i < 256) { d[i * 4] = parseInt(h.slice(1, 3), 16); d[i * 4 + 1] = parseInt(h.slice(3, 5), 16); d[i * 4 + 2] = parseInt(h.slice(5, 7), 16); d[i * 4 + 3] = 255; } }
    this._bind("pal", 2, gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  };
  MoonGlobe.prototype.radius = function () { return Math.min(this.cv.clientWidth, this.cv.clientHeight) * 0.45 * this.zoom; };
  // rho — расстояние от центра в радиусах Луны (1 — поверхность; у спутников больше)
  MoonGlobe.prototype.project = function (lat, lon, rho) {
    rho = rho || 1;
    const r = this.radius() * rho, p = lat * D, l = lon * D - this.lon;
    return [Math.cos(p) * Math.sin(l) * r, -(Math.sin(p) * Math.cos(this.lat) - Math.cos(p) * Math.sin(this.lat) * Math.cos(l)) * r,
      (Math.sin(p) * Math.sin(this.lat) + Math.cos(p) * Math.cos(this.lat) * Math.cos(l)) * rho];
  };
  MoonGlobe.prototype.hidden = function (pr) { const r = this.radius(); return pr[2] < 0 && pr[0] * pr[0] + pr[1] * pr[1] < r * r; };
  MoonGlobe.prototype.unproject = function (sx, sy) {
    const r = this.radius(), qx = sx / r, qy = -sy / r, r2 = qx * qx + qy * qy; if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2), c0 = Math.cos(this.lat), s0 = Math.sin(this.lat);
    const lat = Math.asin(qy * c0 + z * s0); let lon = this.lon + Math.atan2(qx, z * c0 - qy * s0);
    lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return [lat / D, lon / D];
  };
  MoonGlobe.prototype.render = function () {
    const gl = this.gl; if (!gl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(this.cv.clientWidth * dpr), h = Math.round(this.cv.clientHeight * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    gl.viewport(0, 0, w, h); gl.useProgram(this.pr);
    gl.uniform2f(this.u.uView, w, h); gl.uniform1f(this.u.uRad, this.radius() * dpr); gl.uniform2f(this.u.uRot, this.lat, this.lon);
    gl.uniform1i(this.u.uTex, 0); gl.uniform1i(this.u.uIds, 1); gl.uniform1i(this.u.uPal, 2);
    gl.uniform4f(this.u.uShow, visOf("tex") ? 1 : 0, visOf("fills") ? 1 : 0, visOf("borders") ? 1 : 0, mui.hl.borders ? 1 : 0);
    gl.uniform1f(this.u.uSel, sel && sel.col === "territories" ? +sel.id : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // поверх: дороги, отметки, названия
    const ov = this.ov, cw = ov.clientWidth, ch = ov.clientHeight;
    if (ov.width !== Math.round(cw * dpr)) { ov.width = Math.round(cw * dpr); ov.height = Math.round(ch * dpr); }
    const c = ov.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
    this.hits = [];
    for (const r of Object.values(st.roads)) {
      if (!visOf("road:" + r.type)) continue;
      const t = st.roadTypes[r.type] || { color: "#fff", width: 1.5, dash: "solid" };
      let pts = []; for (let i = 1; i < r.pts.length; i++) { const seg = arc(r.pts[i - 1], r.pts[i], 16); if (i > 1) seg.shift(); pts = pts.concat(seg); }
      c.strokeStyle = t.color; c.lineWidth = Math.max(1, t.width * this.zoom * 0.8); c.setLineDash(t.dash === "dash" ? [6, 4] : t.dash === "dot" ? [1.5, 3] : []);
      if (mui.hl["road:" + r.type] || (sel && sel.col === "roads" && sel.id === r.id)) { c.shadowColor = t.color; c.shadowBlur = 8; }
      c.beginPath(); let pen = false;
      for (const p of pts) { const q = this.project(p[0], p[1]); if (q[2] < 0) { pen = false; continue; } if (!pen) c.moveTo(cx + q[0], cy + q[1]); else c.lineTo(cx + q[0], cy + q[1]); pen = true; }
      c.stroke(); c.shadowBlur = 0; c.setLineDash([]);
    }
    {
      // порог размера подписи зависит от приближения шара
      const minSz = this.zoom >= 3 ? 0 : this.zoom >= 2 ? 4 : this.zoom >= 1.4 ? 5.5 : this.zoom >= 0.7 ? 8 : 99; // издалека — без названий
      c.strokeStyle = "rgba(10,10,20,.75)"; c.lineWidth = 3;
      for (const [n, la, lo, sz, cat] of FEATURES) {
        if (!visOf("cat:" + cat)) continue;
        const q = this.project(la, lo); if (q[2] < 0.2) continue;
        const x = cx + q[0], y = cy + q[1], col = (CATS.find(k => k.id === cat) || {}).color || "#dde";
        if (cat === "site") {
          c.fillStyle = col; c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 3.5, y + 2.5); c.lineTo(x - 3.5, y + 2.5); c.closePath(); c.fill();
          if (this.zoom >= 1.6) { c.font = `300 10px ${fontOf("moonNames")}`; c.textAlign = "left"; c.strokeText(n, x + 6, y); c.fillText(n, x + 6, y); c.textAlign = "center"; }
          continue;
        }
        if (sz < minSz) continue;
        c.font = `${cat === "crater" || cat === "relief" ? "italic " : ""}300 ${Math.min(14, 6 + sz * 0.6 + this.zoom).toFixed(0)}px ${fontOf("moonNames")}`;
        c.fillStyle = col; c.globalAlpha = 0.85; c.strokeText(n, x, y); c.fillText(n, x, y); c.globalAlpha = 1;
      }
    }
    if (visOf("tnames")) {
      const tsz = Math.min(16, 9 + this.zoom * 2);
      c.font = `400 ${tsz.toFixed(0)}px ${fontOf("moon")}`; c.fillStyle = "#ffc3ef"; c.strokeStyle = "rgba(28,12,44,.9)"; c.lineWidth = 3;
      if (mui.hl.tnames) { c.shadowColor = "#ff3fd0"; c.shadowBlur = 8; }
      for (const t of Object.values(st.territories)) { const ll = toLL(t.label[0], t.label[1]); const q = this.project(ll[0], ll[1]); if (q[2] < 0.2) continue; L.canvas(c, t.name.toUpperCase(), cx + q[0], cy + q[1], tsz, true); }
      c.shadowBlur = 0;
    }
    for (const m of Object.values(st.marks)) {
      if (!visOf("mark:" + m.type)) continue;
      const t = st.markTypes[m.type] || { color: "#fff", shape: "dot" }, q = this.project(m.lat, m.lon);
      if (q[2] < 0.05) continue;
      const x = cx + q[0], y = cy + q[1], isSel = sel && sel.col === "marks" && sel.id === m.id;
      c.fillStyle = t.color; c.shadowColor = t.color; c.shadowBlur = isSel || mui.hl["mark:" + m.type] ? 12 : 4;
      c.beginPath(); c.arc(x, y, isSel ? 6 : 4.5, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      c.font = `300 11px ${fontOf("moon")}`; c.strokeStyle = "rgba(5,5,15,.9)"; c.lineWidth = 3;
      const nl = String(m.name).split("\n").length; L.canvas(c, m.name, x, y - 13 - (nl - 1) * 11 * 1.15 / 2, 11, true);
      this.hits.push({ x, y, ent: { col: "marks", id: m.id } });
    }
    // спутники Луны
    if (msat.items.length) { c.textAlign = "center"; window.KGGlobe.drawSats(this, c, msat, cx, cy); c.lineCap = "butt"; }
  };
  function globeDirty() { if (!globe || gRaf || sub !== "globe" || msat.loop) return; gRaf = requestAnimationFrame(() => { gRaf = 0; globe.render(); }); }
  function syncGlobe(ids) { if (!globe) return; if (ids) globe.setIds(TM.ids); globe.setPal(st); globeDirty(); }
  function setSub(m) {
    sub = m;
    $("moonSubSwitch").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.msub === m));
    vp.classList.toggle("hidden", m !== "flat");
    $("moonGlobeWrap").classList.toggle("hidden", m !== "globe");
    wrap.classList.toggle("moon-globe", m === "globe");
    $("mSatPanel").classList.toggle("hidden", m !== "globe");
    if (m === "globe") {
      if (!globe) {
        try { globe = new MoonGlobe($("moonGlobe"), $("moonGlobeOv")); } catch (e) { console.error(e); globe = null; }
        if (!globe || !globe.gl) { globe = null; toast("Не удалось запустить шар (WebGL)"); setSub("flat"); return; }
        const ready = tex.complete ? Promise.resolve() : new Promise(r => tex.addEventListener("load", r, { once: true }));
        ready.then(() => { globe.setTex(tex); globeDirty(); });
      }
      const c = toLL((vp.clientWidth / 2 - tx) / s || MW / 2, (vp.clientHeight / 2 - ty) / s || MH / 2);
      globe.lat = Math.max(-35, Math.min(35, c[0] || 0)) * D; globe.lon = (c[1] || 0) * D;
      syncGlobe(true); refreshSats(); startSatLoop();
    } else requestAnimationFrame(() => { if (!fitS || s < fitS) fit(); });
    setTool("pan");
  }
  $("moonSubSwitch").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setSub(b.dataset.msub)));
  (function globeInput() {
    const cv = $("moonGlobe"); let g = null;
    cv.addEventListener("pointerdown", e => { cv.setPointerCapture(e.pointerId); g = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }; });
    cv.addEventListener("pointermove", e => {
      if (!g || !globe) return; const r = globe.radius();
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) { g.moved = true; if (msat.follow) { msat.follow = false; $("mSatFollow").checked = false; } }
      globe.lon -= (e.clientX - g.x) / r; globe.lat = Math.max(-1.5, Math.min(1.5, globe.lat + (e.clientY - g.y) / r));
      g.x = e.clientX; g.y = e.clientY; globeDirty();
    });
    cv.addEventListener("pointerup", e => {
      const w = g; g = null; if (!w || w.moved || !globe) return;
      const rc = cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
      let best = null, bd = 12;
      for (const it of msat.items) { if (!it.on || !it.screen) continue; const dd = Math.hypot(it.screen[0] - mx, it.screen[1] - my); if (dd < bd) { bd = dd; best = it; } }
      if (best) { selectSat(best.s.id, false); return; }
      const hit = (globe.hits || []).find(h => Math.hypot(h.x - mx, h.y - my) < 10);
      if (hit) { select(hit.ent); return; }
      const ll = globe.unproject(mx - rc.width / 2, my - rc.height / 2); if (!ll) { select(null); return; }
      const [x, y] = toXY(ll[0], ll[1]), v = TM.at(x, y); select(v && st.territories[v] ? { col: "territories", id: String(v) } : null);
    });
    cv.addEventListener("wheel", e => { e.preventDefault(); if (globe) { globe.zoom = Math.min(6, Math.max(0.04, globe.zoom * Math.pow(1.0015, -e.deltaY))); globeDirty(); } }, { passive: false });
    window.addEventListener("resize", () => { if (active) { if (sub === "globe") globeDirty(); else fit(); } });
  })();
  $("moonZoomIn").onclick = () => (sub === "globe" ? (globe.zoom = Math.min(6, globe.zoom * 1.4), globeDirty()) : zoomAt(1.4, vp.clientWidth / 2, vp.clientHeight / 2));
  $("moonZoomOut").onclick = () => (sub === "globe" ? (globe.zoom = Math.max(0.04, globe.zoom / 1.4), globeDirty()) : zoomAt(1 / 1.4, vp.clientWidth / 2, vp.clientHeight / 2));
  $("moonZoomFit").onclick = () => (sub === "globe" ? (globe.zoom = 1, globeDirty()) : fit());
  document.querySelectorAll(".moon-tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".moon-tabs button").forEach(x => x.classList.toggle("active", x === b));
    ["Terr", "Layers", "Types"].forEach(k => $("moonPane" + k).classList.toggle("hidden", b.dataset.mtab !== k));
  }));


  // ---------- спутники Луны (та же механика, что у глобуса Земли) ----------
  const SatM = window.KGSats.Moon;
  const msat = { items: [], sel: null, hidden: {}, orbits: true, names: true, follow: false, speed: 60, time: Date.now(), last: 0, loop: 0 };
  function rebuildSatItems() {
    const types = st.satTypes || {};
    msat.items = Object.values(st.satellites || {}).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(raw => {
      const t = types[raw.type] || { name: "Без типа", color: "#ffffff", shape: "dot" };
      return { raw, s: { id: raw.id, name: raw.name, note: raw.note || "", color: t.color, shape: t.shape, typeName: t.name }, on: !msat.hidden[raw.id], pos: null, ring: null, screen: null };
    });
    if (msat.sel && !(st.satellites || {})[msat.sel]) msat.sel = null;
  }
  function updateSats() {
    for (const it of msat.items) {
      it.pos = SatM.at(it.raw, msat.time);
      it.ring = msat.orbits && it.on ? SatM.ring(it.raw, msat.time, it.raw.orbit === "ell" ? 240 : 160) : null;
    }
    if (msat.follow && msat.sel && globe) {
      const it = msat.items.find(x => x.s.id === msat.sel);
      if (it && it.pos) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * D)); globe.lon = it.pos.lon * D; }
    }
  }
  function startSatLoop() {
    if (msat.loop) return;
    msat.last = performance.now();
    const tick = now => {
      if (!active || sub !== "globe" || !globe) { msat.loop = 0; return; }
      msat.time += (now - msat.last) * msat.speed; msat.last = now;
      updateSats(); globe.render(); renderSatInfo();
      msat.loop = requestAnimationFrame(tick);
    };
    msat.loop = requestAnimationFrame(tick);
  }
  function buildSatList() {
    const list = $("mSatList"); if (!list) return;
    const gm = isGm();
    list.innerHTML = msat.items.length ? "" : `<div class="small">${gm ? "Спутников нет — нажмите «+ Спутник»." : "Спутников пока нет."}</div>`;
    for (const it of msat.items) {
      const r = document.createElement("div"); r.className = "sat-row"; r.dataset.id = it.s.id;
      r.innerHTML = `<input type="checkbox" ${it.on ? "checked" : ""} title="Показывать"><span class="sat-dot" style="background:${it.s.color};box-shadow:0 0 6px ${it.s.color}"></span>` +
        `<span class="sat-name">${esc(it.s.name)}</span><span class="sat-type">${esc(it.s.typeName)}</span>` +
        (gm ? `<button class="c-go sat-edit" title="Изменить">✎</button><button class="c-del sat-del" title="Удалить">✕</button>` : "");
      r.querySelector("input").addEventListener("change", e => { it.on = e.target.checked; msat.hidden[it.s.id] = !it.on; });
      r.addEventListener("click", e => {
        if (e.target.tagName === "INPUT") return;
        if (e.target.classList.contains("sat-edit")) { editSat(it.s.id); return; }
        if (e.target.classList.contains("sat-del")) { deleteSat(it.s.id); return; }
        selectSat(it.s.id, true);
      });
      list.append(r);
    }
    const box = $("mSatTypeList");
    if (box) {
      box.innerHTML = "";
      for (const t of Object.values(st.satTypes || {})) {
        const used = Object.values(st.satellites || {}).filter(x => x.type === t.id).length;
        const r = document.createElement("div"); r.className = "sat-row";
        r.innerHTML = `<span class="sat-dot" style="background:${t.color}"></span><span class="sat-name">${esc(t.name)}</span>` +
          `<span class="sat-type">${esc(SatM.SHAPES[t.shape] || t.shape)} · ${used}</span>` +
          `<button class="c-go" title="Изменить тип">✎</button><button class="c-del" title="Удалить тип">✕</button>`;
        r.querySelector(".c-go").addEventListener("click", () => editSatType(t.id));
        r.querySelector(".c-del").addEventListener("click", () => deleteSatType(t.id));
        box.append(r);
      }
    }
    markSatRows();
  }
  function refreshSats() { if (!st) return; rebuildSatItems(); buildSatList(); }
  function markSatRows() { document.querySelectorAll("#mSatList .sat-row").forEach(r => r.classList.toggle("active", r.dataset.id === msat.sel)); }
  function selectSat(id, center) {
    msat.sel = id; markSatRows();
    const it = msat.items.find(x => x.s.id === id);
    if (center && it && it.pos && globe) { globe.lat = Math.max(-1.3, Math.min(1.3, it.pos.lat * D)); globe.lon = it.pos.lon * D; if (globe.zoom > 0.6) globe.zoom = 0.6; }
  }
  function renderSatInfo() {
    const it = msat.items.find(x => x.s.id === msat.sel), box = $("mSatInfo");
    const t = new Date(msat.time);
    const ts = t.toLocaleString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
    if ($("mSatTime").textContent !== ts) $("mSatTime").textContent = ts;
    if (!it || !it.pos) { if (box.dataset.h) { box.textContent = ""; box.dataset.h = ""; } return; }
    const p = it.pos, ns = p.lat >= 0 ? "с. ш." : "ю. ш.", ew = p.lon >= 0 ? "в. д." : "з. д.";
    const html = `<b style="color:${it.s.color}">${esc(it.s.name)}</b> · ${esc(it.s.typeName)}${it.s.note ? " — " + esc(it.s.note) : ""}<br>` +
      `Высота ${Math.round(p.alt).toLocaleString("ru-RU")} км · скорость ${SatM.speed(it.raw, p.alt).toFixed(2).replace(".", ",")} км/с · виток ${SatM.fmtPeriod(SatM.period(it.raw))}<br>` +
      `Над точкой ${Math.abs(p.lat).toFixed(1)}° ${ns}, ${Math.abs(p.lon).toFixed(1)}° ${ew}`;
    if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; }
  }
  const satTypeOptions = () => Object.values(st.satTypes || {}).map(t => [t.id, t.name]);
  const MSAT_FIELDS = () => [
    { key: "name", label: "Название" },
    { key: "type", label: "Тип", type: "select", options: satTypeOptions() },
    { key: "note", label: "Описание" },
    { key: "orbit", label: "Орбита", type: "select", options: Object.entries(SatM.ORBITS) },
    { key: "h", label: "Высота, км", type: "number", min: 10, show: v => v.orbit === "circ", hint: "Низкая лунная ≈ 100, ретранслятор ≈ 3 000–10 000" },
    { key: "hp", label: "Периселений, км", type: "number", min: 10, show: v => v.orbit === "ell", hint: "Ближайшая к Луне точка орбиты" },
    { key: "ha", label: "Апоселений, км", type: "number", min: 10, show: v => v.orbit === "ell", hint: "Дальняя точка; не выше 40 000 км" },
    { key: "argp", label: "Аргумент периселения, °", type: "number", show: v => v.orbit === "ell", hint: "90 — дальняя точка над южным полюсом" },
    { key: "i", label: "Наклонение, °", type: "number", min: 0, max: 180, hint: "0 — над экватором Луны, 90 — через полюса" },
    { key: "raan", label: "Долгота восходящего узла, °", type: "number", hint: "Поворот плоскости орбиты вокруг оси Луны" },
    { key: "phase", label: "Начальное положение на орбите, °", type: "number" }
  ];
  async function editSat(id) {
    if (!isGm()) return;
    if (!Object.keys(st.satTypes || {}).length) { toast("Сначала создайте тип спутника"); return; }
    const before = id ? st.satellites[id] : null;
    const base = before ? clone(before) : { name: "", type: Object.keys(st.satTypes)[0], note: "", orbit: "circ", h: 100, hp: 100, ha: 8000, argp: 90, i: 90, raan: 0, phase: 0 };
    const v = await form(before ? "Спутник Луны: " + before.name : "Новый спутник Луны", MSAT_FIELDS(), base, SatM.validate);
    if (!v) return;
    const nid = before ? id : uid("msat");
    const rec = { id: nid, name: v.name, type: v.type, note: v.note, orbit: v.orbit, i: v.i, raan: v.raan || 0, phase: v.phase || 0 };
    if (v.orbit === "ell") Object.assign(rec, { hp: v.hp, ha: v.ha, argp: v.argp || 0 }); else rec.h = v.h;
    commit("satellites", nid, before, rec);
    msat.sel = nid; refreshSats();
    toast(before ? "Спутник изменён" : "Спутник добавлен — он уже на орбите Луны");
  }
  async function deleteSat(id) {
    const c = st.satellites[id]; if (!c || !isGm()) return;
    if (!(await ask("Удалить спутник «" + c.name + "»?", "", { confirm: true, note: "Ctrl+Z — вернуть." }))) return;
    commit("satellites", id, c, null); refreshSats();
  }
  async function editSatType(id) {
    if (!isGm()) return;
    const before = id ? st.satTypes[id] : null;
    const base = before ? clone(before) : { name: "", color: "#7fe8ff", shape: "dot" };
    const v = await form(before ? "Тип: " + before.name : "Новый тип спутников Луны",
      [{ key: "name", label: "Название типа" }, { key: "color", label: "Цвет", type: "color" }, { key: "shape", label: "Значок", type: "select", options: Object.entries(SatM.SHAPES) }],
      base, x => (x.name ? "" : "Укажите название типа"));
    if (!v) return;
    const nid = before ? id : uid("mst");
    commit("satTypes", nid, before, { id: nid, name: v.name, color: v.color, shape: v.shape });
    refreshSats();
  }
  async function deleteSatType(id) {
    const t = st.satTypes[id]; if (!t || !isGm()) return;
    const users = Object.values(st.satellites || {}).filter(x => x.type === id);
    if (users.length) { toast("Тип используют: " + users.map(u => u.name).join(", ")); return; }
    if (!(await ask("Удалить тип «" + t.name + "»?", "", { confirm: true }))) return;
    commit("satTypes", id, t, null); refreshSats();
  }
  $("mAddSat").onclick = () => editSat(null);
  $("mAddSatType").onclick = () => editSatType(null);
  $("mSatOrbits").addEventListener("change", e => { msat.orbits = e.target.checked; });
  $("mSatNames").addEventListener("change", e => { msat.names = e.target.checked; });
  $("mSatFollow").addEventListener("change", e => { msat.follow = e.target.checked; });
  document.querySelectorAll("#mSatSpeed button").forEach(b => b.addEventListener("click", () => {
    msat.speed = +b.dataset.speed;
    if (b.dataset.speed === "now") { msat.time = Date.now(); msat.speed = 1; }
    document.querySelectorAll("#mSatSpeed button").forEach(x => x.classList.toggle("active", x === b));
  }));
  $("mSatToggle").addEventListener("click", () => $("mSatPanel").classList.toggle("collapsed"));

  // ---------- флаги лунных территорий (как у стран Земли) ----------
  const mFlagCache = {}; // id -> dataURL, пока опубликованный файл не дошёл до GitHub Pages
  const flagSrc = (id, t) => mFlagCache[id] || t.flag || "";
  function bindFlag(id) {
    const inp = $("mFlagInput"), clr = $("mFlagClear");
    if (inp) inp.addEventListener("change", e => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f || !isGm() || !st.territories[id]) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 300 / img.width, 200 / img.height);
          const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          const b = st.territories[id], a = clone(b); a.flag = cv.toDataURL("image/png");
          commit("territories", id, b, a); toast("Флаг установлен (опубликуйте, чтобы его увидели все)");
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    if (clr) clr.addEventListener("click", () => { delete mFlagCache[id]; const b = st.territories[id], a = clone(b); a.flag = null; commit("territories", id, b, a); });
  }
  // многострочные названия в разметке SVG: первая строка на y, остальные ниже
  function tspans(str) {
    const parts = String(str || "").split("\n");
    return parts.length === 1 ? esc(parts[0]) : parts.map((p, i) => `<tspan x="0" dy="${i ? "1.15em" : 0}">${esc(p)}</tspan>`).join("");
  }
  const L = window.KG.lines;
  const fontOf = slot => { const f = window.KGMap && window.KGMap.fonts && window.KGMap.fonts[slot]; return (f ? `"${f}", ` : "") + "Unbounded, sans-serif"; };

  // ---------- загрузка, открытие, публикация ----------
  let pendingFlags = {};
  async function load() {
    const bust = "?t=" + Date.now();
    if (!tex.getAttribute("src")) tex.src = "assets/moon/moon.jpg";
    st = await fetch("data/moon.json" + bust, { cache: "no-store" }).then(r => r.json());
    ["territories", "marks", "markTypes", "roads", "roadTypes", "satellites", "satTypes"].forEach(k => (st[k] = st[k] || {}));
    await TM.load("data/moon_territories.png" + bust, new Uint8Array(MW * MH).fill(1));
    for (const [id, d] of TM.allPaths()) if (st.territories[String(id)]) setTerrPath(id, d);
    loaded = true;
    rebuildSatItems(); renderAll(); updUndo();
  }
  const M = {
    async open() {
      active = true; document.body.classList.add("moon-mode"); wrap.classList.remove("hidden");
      if (!loaded) {
        $("moonLoading").classList.remove("hidden");
        try { loading = loading || load(); await loading; } catch (e) { console.error(e); toast("Не удалось загрузить Луну"); }
        $("moonLoading").classList.add("hidden");
      }
      buildLists(); updateCard(); setTool(tool);
      if (sub === "globe") { syncGlobe(true); refreshSats(); startSatLoop(); } else requestAnimationFrame(fit);
    },
    close() { active = false; document.body.classList.remove("moon-mode"); wrap.classList.add("hidden"); if (roadDraft) finishRoad(false); },
    get active() { return active; },
    get state() { return st; },
    select: ent => select(ent),
    get sats() { return msat; },
    isDirty: () => dirty,
    async files() {
      if (!dirty) return [];
      const out = [], snap = clone(st); snap.updated = new Date().toISOString();
      // новые флаги (dataURL) — отдельными файлами data/moon_flags/<id>.png
      const stamp = Date.now().toString(36); pendingFlags = {};
      for (const id in snap.territories) {
        const t = snap.territories[id];
        if (!t.flag || !t.flag.startsWith("data:")) continue;
        const path = `data/moon_flags/${id}.png`;
        out.push({ path, content: Uint8Array.from(atob(t.flag.split(",")[1]), ch => ch.charCodeAt(0)) });
        pendingFlags[id] = { data: t.flag, path: `${path}?v=${stamp}` }; t.flag = pendingFlags[id].path;
      }
      out.push({ path: "data/moon.json", content: JSON.stringify(snap) });
      if (terrDirty) out.push({ path: "data/moon_territories.png", content: await TM.toPngBlob() });
      return out;
    },
    published() {
      dirty = terrDirty = false;
      for (const id in pendingFlags) { mFlagCache[id] = pendingFlags[id].data; if (st.territories[id] && st.territories[id].flag === pendingFlags[id].data) st.territories[id].flag = pendingFlags[id].path; }
      pendingFlags = {};
    },
    onGmChange() { if (loaded) { buildLists(); updateCard(); setTool(tool); renderVertices(); buildSatList(); } },
    // для показа Луны на глобусе Земли
    open3d() { M.open().then(() => setSub("globe")); }
  };
  window.KGMoon = M;
})();
