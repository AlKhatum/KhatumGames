// Механики (Вики → Механики): статья, справочник, рейтинг, кабинет игрока («Моя страна»); вход на Главной, калькулятор ГМа — в Режиме ГМа.
// Данные — data/mech.json. Данные стран зашифрованы (js/mech-crypto.js), расчёт — js/mech-model.js.
(function () {
  "use strict";
  const M = window.KGMechModel, C = window.KGCrypto, GH = window.KGGitHub;
  const $ = id => document.getElementById(id);
  const toast = m => window.KG.toast(m), ask = (t, v, o) => window.KG.ask(t, v, o);
  const clone = o => JSON.parse(JSON.stringify(o));
  const PLAYER_KEY = "kg-mech-player", MK_KEY = "kg-mech-mk", DRAFT_KEY = "kg-mech-draft";

  let inited = false, loading = null;
  let config = null, mech = null, mechPub = null, mapCountries = {};
  let rules = M.defaultRules();
  // ГМ
  let mk = null, gmPw = null, dks = {}, gmData = {}, gmSel = null, gmView = "countries", gmDirty = false, gmBase = {};
  // игрок
  let player = null, sandbox = false;

  // ---------- мелочи ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }
  const NF = {};
  const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }));
  function fmt(v, f) {
    if (f === "txt") return v == null || v === "" ? "—" : String(v);
    if (v == null || !isFinite(v)) return "—";
    if (f === "int") return nf(0).format(Math.round(v));
    if (f === "d1") return nf(1).format(v);
    if (f === "d3") return nf(3).format(v);
    if (f === "pct") return nf(1).format(v * 100) + "%";
    return nf(2).format(v);
  }
  const countryName = id => (mapCountries[id] ? String(mapCountries[id].name || "").replace(/\n/g, " ") : "Страна " + id);
  function flagEl(id, cls) {
    const c = mapCountries[id] || {};
    const box = h("span", { class: "mflag " + (cls || "") });
    if (c.flag) box.append(h("img", { src: c.flag, alt: "" }));
    else box.style.background = c.color || "#334";
    return box;
  }
  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const corpById = id => rules.tables.corp.find(x => x.id === id);
  const groupName = id => (corpById(id) || { name: id }).name;
  const sectorName = id => (rules.tables.csector.find(s => s.id === id) || { name: "—" }).name;
  const signed = (v, f) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), f);

  // ---------- загрузка ----------
  async function fetchJSON(url) {
    const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) { const e = new Error(url + ": " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function load() {
    // названия и флаги стран берём у карты (она грузит map.json сама), без повторной загрузки
    const mapState = async () => {
      const KM = window.KGMap;
      if (KM && KM.state) return KM.state;
      if (KM && KM.stateReady) {
        const st = await Promise.race([KM.stateReady().then(() => KM.state), new Promise(r => setTimeout(() => r(null), 20000))]);
        if (st) return st;
      }
      return fetchJSON("data/map.json");
    };
    const [cfg, mj, mp] = await Promise.all([
      fetchJSON("data/config.json"),
      fetchJSON("data/mech.json").catch(e => (e.status === 404 ? null : Promise.reject(e))),
      mapState()
    ]);
    config = cfg;
    mech = mj || { v: 1, updated: null, turn: 1, year: 2200, rules: null, gm: null, countries: {} };
    mech.countries = mech.countries || {};
    mechPub = clone(mech);
    rules = M.normalizeRules(mech.rules);
    mapCountries = (mp && mp.countries) || {};
    M.setMap(mapCountries, (mp && mp.alliances) || {}); // союзы карты = союзы механик
  }
  async function init() {
    if (inited) return loading;
    inited = true;
    loading = (async () => {
      try { await load(); }
      catch (e) { $("mechRating").textContent = "Не удалось загрузить механики: " + e.message; $("homeAuth").textContent = "Не удалось загрузить данные стран: " + e.message; console.error(e); return; }
      fillArticleLists();
      renderRef(); renderRating(); renderBlocs();
      await restorePlayer(); renderMy();
      await restoreGm(); renderGm();
      renderHomeAuth();
    })();
    return loading;
  }

  // ---------- вкладки внутри «Механик» (Вики → Механики → …) ----------
  const PANES = { article: "mechArticle", ref: "mechRef", rating: "mechRating", blocs: "mechBlocs", my: "mechMy", calc: "mechGM" };
  let pane = "article";
  function openPane(name) {
    if (!PANES[name] || (name === "calc" && !isGm())) name = "article"; // калькулятор — только ГМу
    pane = name;
    document.querySelectorAll("#mechNav button").forEach(b => b.classList.toggle("active", b.dataset.mech === name));
    for (const k in PANES) $(PANES[k]).classList.toggle("hidden", k !== name);
    if (name === "my" && mech) renderMy();
    if (name === "blocs" && mech) renderBlocs();
    if (name === "calc" && mech) renderGm();
  }
  document.querySelectorAll("#mechNav button").forEach(b => b.addEventListener("click", () => window.KG.go("wiki/mech/" + b.dataset.mech, true)));
  window.addEventListener("routechange", e => {
    const p = e.detail.parts;
    if (p[0] === "wiki" && p[1] === "mech") { init(); openPane(p[2] || pane); }
  });
  // оглавление статьи — прокрутка внутри страницы, без смены адреса (слушатель общий: статью может переписать ГМ)
  document.addEventListener("click", e => {
    const a = e.target.closest(".mech-toc a");
    if (!a) return;
    e.preventDefault();
    if (document.body.classList.contains("site-edit")) return; // в режиме правки ссылки не срабатывают
    const t = document.getElementById((a.getAttribute("href") || "").replace(/^#/, ""));
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // данные нужны и Главной (вход), и Вики — грузим сразу
  init();

  function fillArticleLists() {
    const law = document.querySelector('[data-mech-list="law"]'), tier = document.querySelector('[data-mech-list="tier"]');
    const short = (v, f) => fmt(v, f).replace(/,0+(%?)$/, "$1");
    if (law) { law.innerHTML = ""; rules.tables.law.forEach((l, i) => law.append(h("li", null, h("b", { text: (i + 1) + ". " + l.name }), " — к призыву " + short(+l.share, "pct") + " МОП" + (+l.stab ? ", −" + String(l.stab).replace(".", ",") + " стабильности за ход" : "")))); }
    if (tier) { tier.innerHTML = ""; rules.tables.tier.slice().sort((a, b) => a.min - b.min).forEach(t => tier.append(h("li", null, h("b", { text: t.name }), " — от " + short(+t.min, "d1") + ". " + (t.desc || "")))); }
    if (law) law.querySelectorAll("li").forEach((li, i) => { const d = (rules.tables.law[i] || {}).desc; if (d) li.append(h("small", { class: "law-desc", text: " " + d })); });
    const slot = (key, label) => (window.KGSite && window.KGSite.imgSlot ? window.KGSite.imgSlot(key, label) : h("div", { class: "img-slot", "data-edit-img": key }));
    // шапки разделов статьи 1280×720
    document.querySelectorAll('[data-mech-list="banner"]').forEach(el => { el.innerHTML = ""; el.append(slot("mech.banner." + el.dataset.key, el.dataset.label || el.dataset.key)); });
    // карточки типов: шапка 1280×720, характеристики из справочника, описание
    document.querySelectorAll('[data-mech-list="units"]').forEach(el => {
      const tb = el.dataset.table, rows = rules.tables[tb] || [], st = UNIT_STATS[tb] || (() => "");
      el.innerHTML = "";
      for (const r of rows) el.append(h("article", { class: "unit-card", "data-unit": tb + ":" + r.id },
        slot("mech.unit." + tb + "." + r.id, r.name), h("h4", { text: r.name }), st(r) ? h("div", { class: "unit-stats", text: st(r) }) : null,
        h("p", { class: "unit-desc", text: r.desc || "" })));
    });
    // чудеса: владелец, эффекты, описание
    const wl = document.querySelector('[data-mech-list="wonder"]');
    if (wl) {
      wl.innerHTML = "";
      const tName = k => (M.MOD_TARGETS.find(x => x[0] === k) || [, k])[1];
      const fx = (k, v) => k && +v ? tName(k) + " " + (+v > 0 ? "+" : "−") + String(Math.abs(+v)).replace(".", ",") + (M.wonderMode(k) === "add" ? " за ход" : "%") : "";
      for (const w of rules.tables.wonder) wl.append(h("article", { class: "unit-card wonder-card", "data-wonder": w.id },
        slot("mech.wonder." + w.id, w.name), h("h4", { text: w.name }),
        h("div", { class: "unit-stats", text: [fx(w.t1, w.v1), fx(w.t2, w.v2)].filter(Boolean).join(" · ") }),
        h("div", { class: "wonder-owner" + (w.owner ? "" : " none"), text: w.owner ? "Построено: " + countryName(w.owner) : "Ещё не построено" }),
        h("p", { class: "unit-desc", text: w.desc || "" })));
    }
    // словарь показателей: запись летописи → строки калькулятора
    const pl = document.querySelector('[data-mech-list="params"]'), L = window.KGMechLore;
    if (pl && L) {
      pl.innerHTML = "";
      const groups = new Map();
      for (const k in L.params) { const x = L.params[k], g = x.name || (M.INPUTS[k] || M.OUT[k] || [k])[0]; if (!groups.has(g)) groups.set(g, { text: x.text, keys: [] }); groups.get(g).keys.push(k); }
      for (const [g, x] of groups) pl.append(h("div", { class: "param-row", "data-param": x.keys[0] },
        h("div", { class: "pt", text: g }), h("div", { class: "pd" }, x.text, h("small", { text: "В калькуляторе: " + x.keys.map(k => (M.INPUTS[k] || M.OUT[k])[0]).join(", ") }))));
    }
    // справочные записи мода (в расчётах пока не участвуют)
    document.querySelectorAll('[data-mech-list="ref"]').forEach(el => {
      el.innerHTML = "";
      const names = String(el.dataset.names || "").split("|");
      for (const n of names) { const x = L && L.reference[n]; if (x) el.append(h("div", { class: "param-row", "data-ref": n }, h("div", { class: "pt" }, n, h("small", { text: x.unit })), h("div", { class: "pd", text: x.text }))); }
    });
  }
  // строка характеристик карточки типа (числа — из действующего справочника)
  const n2 = v => fmt(+v, Math.abs(+v) < 1 && +v !== 0 ? "d3" : "d2").replace(/,?0+$/, "");
  const UNIT_STATS = {
    div: r => "Л/с " + n2(r.pers) + " тыс. · мощь " + n2(r.power) + " · содержание " + n2(r.upkeep) + " млрд/ход · постройка " + n2(r.cost) + " ОВП",
    ac: r => "Мощь " + n2(r.power) + " · содержание " + n2(r.upkeep) + " млрд/ход · постройка " + n2(r.cost) + " ОВП" + (+r.wh ? " · боеголовок " + n2(r.wh) : ""),
    ship: r => "Экипаж " + n2(r.pers) + " тыс. · мощь " + n2(r.power) + " · " + n2(r.ton) + " тыс. т · постройка " + n2(r.cost) + " ОВП" + (+r.wh ? " · боеголовок " + n2(r.wh) : ""),
    sat: r => "Запуск " + n2(r.cost) + " млрд кр. · содержание " + n2(r.upkeep) + " млрд/ход",
    energy: () => "", food: r => String(r.weather) === "1" ? "Зависит от климата и радиации" : "Не зависит от погоды",
    industry: r => (M.TABLES.industry.fields[1][3].find(o => o[0] === r.role) || [, ""])[1]
  };

  // ---------- справочник ----------
  // варианты выбора: список или функция от правил (отрасли, корпорации, союзы)
  const optsOf = o => (typeof o === "function" ? o(rules) : o) || [];
  const STRUCT_TABLES = ["csector", "corp", "bloc"]; // на них ссылаются другие таблицы
  function rulesView(editable, onChange, rerender) {
    const root = h("div", { class: "rules" });
    const changed = () => { fillArticleLists(); if (onChange) onChange(); };
    const order = ["div", "ac", "ship", "sat", "industry", "energy", "food", "law", "tier", "wonder", "ideo", "csector", "corp", "bloc", "cdeal"];
    for (const t of order) {
      const meta = M.TABLES[t], rows = rules.tables[t];
      if (!editable && !rows.length) continue;
      const restruct = () => { if (rerender && STRUCT_TABLES.includes(t)) rerender(); };
      const sec = h("section", { class: "mblock" + (t === "csector" ? " corp-first" : "") }, t === "csector" ? h("h2", { text: "Корпорации и союзы" }) : null, h("h3", { text: meta.title }), meta.note ? h("p", { class: "mech-note", text: meta.note }) : null);
      const tbl = h("table", { class: "mt rules-t" + (t === "corp" || t === "bloc" || M.TABLES[t].fields.some(([f]) => f === "desc") ? " wide-text" : "") });
      const head = h("tr", null, t === "law" ? h("th", { text: "Ур." }) : null, meta.fields.map(([, label]) => h("th", { text: label })), editable ? h("th") : null);
      tbl.append(h("thead", null, head));
      const body = h("tbody");
      const draw = () => {
        body.innerHTML = "";
        rows.forEach((row, i) => {
          const tr = h("tr", null, t === "law" ? h("td", { class: "num", text: String(i + 1) }) : null);
          for (const [f, , type, opts] of meta.fields) {
            let cell;
            if (!editable) {
              const v = row[f];
              cell = h("td", { class: (type === "num" ? "num" : "") + (f === "desc" ? " desc" : ""), text: type === "sel" ? ((optsOf(opts).find(o => o[0] === String(v)) || [, v])[1]) : type === "num" ? fmt(+v, Math.abs(+v) < 1 && +v !== 0 ? "d3" : "d2").replace(/,?0+$/, "") : v });
            } else if (type === "sel") {
              const s = h("select", { onchange: () => { row[f] = s.value; changed(); } }, optsOf(opts).map(([v, l]) => h("option", { value: v, text: l })));
              s.value = String(row[f] == null ? "" : row[f]); cell = h("td", null, s);
            } else {
              const inp = h("input", { type: type === "num" ? "number" : "text", step: "any", value: row[f] == null ? "" : row[f], class: type === "num" ? "num" : (f === "desc" ? "desc" : ""), "data-f": f,
                oninput: () => { row[f] = type === "num" ? (inp.value === "" ? 0 : +inp.value) : inp.value; changed(); } });
              cell = h("td", null, inp);
            }
            tr.append(cell);
          }
          if (editable) tr.append(h("td", null, h("button", { class: "small-btn danger", title: "Удалить строку", text: "✕", onclick: async () => {
            const ok = await ask("Удалить «" + (row.name || row.id) + "»?", "", { confirm: true, note: "У стран пропадут юниты этого типа (их количество перестанет учитываться)." });
            if (!ok) return; rows.splice(i, 1); draw(); changed(); restruct();
          } })));
          body.append(tr);
        });
      };
      draw();
      tbl.append(body);
      sec.append(h("div", { class: "mt-scroll" }, tbl));
      if (editable) sec.append(h("button", { class: "small-btn", text: "+ Добавить строку", onclick: () => {
        const row = { id: uid(t + "_") };
        for (const [f, , type, opts] of meta.fields) row[f] = type === "num" ? 0 : type === "sel" ? ((optsOf(opts)[0] || [""])[0]) : (f === "name" ? (t === "corp" ? "Новая корпорация" : t === "bloc" ? "Новый союз" : t === "ideo" ? "Новая идеология" : "Новый тип") : "");
        if (t === "corp") row.scale = 1;
        if (t === "csector") row.infl = 1;
        rows.push(row); draw(); changed(); restruct();
      } }));
      // переименование отрасли, корпорации или союза обновляет списки выбора в других таблицах
      if (editable && STRUCT_TABLES.includes(t)) body.addEventListener("change", e => { if (e.target.dataset.f === "name") restruct(); });
      root.append(sec);
    }
    // константы
    const kSec = h("section", { class: "mblock" }, h("h3", { text: "Коэффициенты" }));
    for (const [g, list] of M.K_GROUPS) {
      const det = h("details", { class: "k-group" }, h("summary", { text: g }));
      const tbl = h("table", { class: "mt" });
      for (const [key, label, , unit, hint] of list) {
        let val;
        if (editable) {
          const inp = h("input", { type: "number", step: "any", class: "num", value: rules.K[key], oninput: () => { if (inp.value !== "" && isFinite(+inp.value)) { rules.K[key] = +inp.value; changed(); } } });
          val = h("td", null, inp);
        } else val = h("td", { class: "num", text: String(rules.K[key]).replace(".", ",") });
        tbl.append(h("tr", null, h("td", { text: label }), val, h("td", { class: "unit", text: unit }), h("td", { class: "hint", text: hint })));
      }
      det.append(h("div", { class: "mt-scroll" }, tbl));
      kSec.append(det);
    }
    root.append(kSec);
    return root;
  }
  // ---------- правка механик прямо на страницах (Режим ГМа → «✎ Правка») ----------
  // правила общие с калькулятором: правятся только после расшифровки, попадают в его черновик и публикуются его кнопкой «Опубликовать»
  const pageEdit = () => isGm() && !!(window.KGSite && window.KGSite.editing);
  const canEditRules = () => pageEdit() && !!mk;
  let corpLoreEl = null;
  function rulesNote() {
    if (!pageEdit()) return null;
    if (!mk) return h("div", { class: "mech-editbar" }, h("span", { text: "Справочник и корпорации правятся после расшифровки калькулятора паролем ГМа." }),
      h("button", { class: "accent", text: "Расшифровать", onclick: async () => { if (await unlockGm()) refreshMechViews(); } }));
    return h("div", { class: "mech-editbar" }, h("span", { text: "Правка включена. Изменения попадают в черновик калькулятора и сразу пересчитывают страны; на сайт их выкладывает «Опубликовать» в калькуляторе." }),
      h("button", { text: "Калькулятор →", onclick: () => window.KG.go("wiki/mech/calc") }));
  }
  function refreshMechViews() {
    renderRef(); renderRating(); renderBlocs(); renderGm();
    if (corpLoreEl && corpLoreEl.isConnected) Promise.resolve(renderCorpLore(corpLoreEl)).then(() => { if (window.KGSite) window.KGSite.applyTexts(corpLoreEl); });
  }
  function renderRef() {
    const box = $("mechRef"); box.innerHTML = "";
    const ed = canEditRules();
    box.append(h("p", { class: "mech-note", text: "Действующие правила игры: характеристики юнитов, стоимость постройки и коэффициенты формул. Меняет их ГМ." }), rulesNote(),
      rulesView(ed, ed ? () => markDirty() : null, ed ? refreshMechViews : null));
  }

  // ---------- союзы и блоки (Механики → Союзы) ----------
  // Состав — с карты (союз в карточке страны) и из поля блока «Страны вне карты»; галочки ГМа видны только в режиме ГМа.
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };
  function renderBlocs() {
    const box = $("mechBlocs"); if (!box || !rules) return;
    box.innerHTML = "";
    const kinds = M.TABLES.bloc.fields[1][3], kindName = k => (kinds.find(o => o[0] === k) || [, ""])[1];
    const blocs = rules.tables.bloc, gm = isGm() ? gmData : null;
    const colors = (window.KGMap && window.KGMap.state && window.KGMap.state.alliances) || {};
    box.append(h("p", { class: "mech-note", text: "Политические, экономические и военные союзы мира. Состав союзов берётся с карты: страна в союзе, если он указан в её карточке на карте. " +
      "Договор корпорации с союзом даёт ей присутствие во всех странах-членах. История союзов — в «Лор → Государства»." }));
    if (!blocs.length) { box.append(h("p", { class: "empty", text: "Союзов пока нет." })); return; }
    const grid = h("div", { class: "bloc-grid" });
    const filt = h("div", { class: "bloc-filter" }, [["", "Все"]].concat(kinds).map(([k, t]) => h("button", { class: "small-btn" + (k ? "" : " active"), "data-kind": k, text: t, onclick: e => {
      filt.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === e.currentTarget));
      grid.querySelectorAll(".bloc-card").forEach(x => x.classList.toggle("hidden", !!k && x.dataset.kind !== k));
    } })));
    for (const b of blocs) {
      const mem = M.blocMembers(rules, b.id, gm), deals = rules.tables.cdeal.filter(d => d.bloc === b.id);
      grid.append(h("section", { class: "bloc-card", id: "bloc-" + b.id, "data-kind": b.kind, "data-bloc": b.id },
        h("h3", null, h("span", { class: "bloc-sw", style: "background:" + ((colors[b.id] || {}).color || "transparent") }), b.name),
        h("div", { class: "bloc-kind", text: kindName(b.kind) + " · " + mem.length + " " + plural(mem.length, "страна", "страны", "стран") }),
        mem.length ? h("ul", { class: "bloc-members" }, mem.map(x => h("li", null,
          h("button", { class: "linkish", title: "Показать на карте", "data-country": x.id, onclick: () => window.KG.showOnMap(x.id) }, flagEl(x.id), " ", countryName(x.id)),
          x.leader ? h("small", { text: " · лидер" }) : x.how === "gm" ? h("small", { text: " · отмечено ГМом" }) : null)))
          : h("p", { class: "empty", text: "В блоке пока нет стран." }),
        b.desc ? h("p", { class: "bloc-desc", text: b.desc }) : null,
        deals.length ? h("div", { class: "hint", text: "Договоры корпораций: " + deals.map(d => groupName(d.corp) + " (присутствие " + fmt(+d.pres, "d1") + ")").join(", ") }) : null));
    }
    box.append(filt, grid);
  }

  // ---------- рейтинг ----------
  function renderRating() {
    const box = $("mechRating"); box.innerHTML = "";
    const note = rulesNote(); if (note) box.append(note);
    const list = Object.keys(mech.countries).filter(id => mech.countries[id].pub).map(id => Object.assign({ id }, mech.countries[id].pub)).sort((a, b) => a.rank - b.rank);
    box.append(h("p", { class: "mech-note" }, "Ход " + mech.turn + ", " + mech.year + " год. Индекс национальной мощи (ИНМ) сравнивает страну с мировым лидером по ВВП, армии, населению, технологиям, стабильности и спутникам." +
      (mech.updated ? " Обновлено " + new Date(mech.updated).toLocaleString("ru-RU") + "." : "")));
    if (!list.length) { box.append(h("p", { class: "empty", text: "ГМ ещё не опубликовал данные стран." })); renderCorpRating(box); return; }
    const tbl = h("table", { class: "mt rating" }, h("thead", null, h("tr", null, h("th", { text: "Место" }), h("th", { text: "Государство" }), h("th", { text: "ИНМ" }), h("th", { text: "Уровень экономики" }))));
    const body = h("tbody");
    for (const p of list) {
      body.append(h("tr", { class: p.rank <= 3 ? "top" + p.rank : "" }, h("td", { class: "num", text: String(p.rank) }), h("td", null, flagEl(p.id), " ", countryName(p.id)),
        h("td", { class: "num" }, h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, p.inm)) + "%" })), fmt(p.inm, "d1")), h("td", { text: p.econ || "—" })));
    }
    tbl.append(body);
    box.append(h("div", { class: "mt-scroll" }, tbl));
    renderCorpRating(box);
  }
  function renderCorpRating(box) {
    const corps = rules.tables.corp, ed = canEditRules();
    if (!corps.length && !ed) return;
    const pub = mech.corpPub || {};
    const has = Object.keys(pub).length > 0;
    box.append(h("h2", { text: "Корпорации" }), h("p", { class: "mech-note", text: "Транснациональные корпорации не принадлежат ни одному государству. Выручка — доля ВВП стран, которую корпорация контролирует, за ход." + (has ? "" : " ГМ ещё не публиковал выручку корпораций.") }));
    const ord = corps.slice().sort((a, b) => ((pub[a.id] || {}).rank || 999) - ((pub[b.id] || {}).rank || 999));
    const tbl = h("table", { class: "mt rating" }, h("thead", null, h("tr", null, h("th", { text: "Место" }), h("th", { text: "Корпорация" }), h("th", { text: "Отрасль" }), h("th", { text: "Класс" }),
      h("th", { text: "Штаб-квартира" }), h("th", { class: "num", text: "Выручка, млрд кр." }), h("th", { class: "num", text: "Стран" }), ed ? h("th") : null)));
    tbl.append(h("tbody", null, ord.map(x => {
      const p = pub[x.id] || {}, par = x.parent && corpById(x.parent) && x.parent !== x.id ? corpById(x.parent).name : "";
      return h("tr", { class: p.rank <= 3 && p.rev > 0 ? "top" + p.rank : "" }, h("td", { class: "num", text: p.rank && p.rev > 0 ? String(p.rank) : "—" }),
        h("td", null, h("b", { text: x.name }), par ? h("small", { class: "sub", text: "входит в " + par }) : null), h("td", { class: "tag", text: sectorName(x.sector) }), h("td", { class: "tag", text: M.corpClass(x.scale) }),
        h("td", { class: "tag", text: x.hq || "—" }), h("td", { class: "num", text: has ? fmt(p.rev || 0, "d1") + (p.grp > p.rev ? " (группа " + fmt(p.grp, "d1") + ")" : "") : "—" }), h("td", { class: "num", text: has ? String(p.n || 0) : "—" }),
        ed ? h("td", { class: "row-tools" }, corpTools(x)) : null);
    })));
    box.append(h("div", { class: "mt-scroll" }, tbl));
    if (ed) box.append(h("button", { class: "small-btn", text: "+ Корпорация", onclick: () => editCorp(null) }));
  }
  // кнопки правки корпорации (рейтинг и лор)
  const corpTools = x => [h("button", { class: "small-btn", title: "Изменить корпорацию", text: "✎", onclick: () => editCorp(x) }),
    h("button", { class: "small-btn danger", title: "Удалить корпорацию", text: "✕", onclick: () => deleteCorp(x) })];

  // ---------- лор: корпорации ----------
  async function renderCorpLore(el) {
    el.innerHTML = "";
    el.append(h("p", { class: "mech-note", text: "Загрузка…" }));
    await init();
    el.innerHTML = "";
    corpLoreEl = el;
    const corps = rules.tables.corp, ed = canEditRules();
    // вступление правит ГМ (Режим ГМа → «✎ Правка»), карточки — из справочника корпораций
    const intro = h("div", { class: "rich", "data-edit": "lore.corp.intro", "data-label": "Лор: вступление к корпорациям" });
    intro.innerHTML = "<p class=\"lead\">После Великой ошибки государства потеряли берега, столицы и казну. Корпорации потеряли меньше: их заводы стояли в горах, деньги лежали на орбитальных серверах, а охрана никуда не делась. К 2200 году самые сильные из них стали государствами в государстве: строят дамбы, кормят и лечат, держат собственные армии, отключают воду и свет несговорчивым правительствам.</p>" +
      "<p>Корпорациями не управляет ни один игрок. Их ведёт ГМ, а страна может с ними договариваться, воевать, пускать их на свою территорию или изгонять. Чем глубже корпорация вросла в страну, тем больше она даёт экономике и тем меньше у страны суверенитета. Подробности — в Вики → Механики, раздел «Корпорации».</p>";
    el.append(intro);
    const note = rulesNote(); if (note) el.append(note);
    if (ed) el.append(h("div", { class: "corp-lore-tools" }, h("button", { class: "small-btn", text: "+ Корпорация", onclick: () => editCorp(null) }),
      h("button", { class: "small-btn", text: "+ Отрасль", onclick: addSector })));
    const isChild = x => x.parent && corpById(x.parent) && x.parent !== x.id;
    const arc = corps.filter(x => !isChild(x) && corps.some(y => y.parent === x.id && y.id !== x.id));
    for (const g of arc) {
      const kids = corps.filter(y => y.parent === g.id && y.id !== g.id);
      el.append(h("section", { class: "corp-group" }, h("h2", { text: g.name }), corpCard(g, true), h("div", { class: "corp-cards" }, kids.map(k => corpCard(k)))));
    }
    for (const s of rules.tables.csector) {
      const list = corps.filter(x => x.sector === s.id && !isChild(x) && !arc.includes(x));
      if (list.length || ed) el.append(h("section", { class: "corp-group" }, h("h2", null, s.name,
        ed ? h("button", { class: "small-btn", title: "Переименовать отрасль", text: "✎", onclick: () => renameSector(s) }) : null),
        list.length ? h("div", { class: "corp-cards" }, list.map(x => corpCard(x))) : h("p", { class: "empty", text: "В этой отрасли пока нет корпораций." })));
    }
    function corpCard(x, wide) {
      const par = isChild(x) ? corpById(x.parent).name : "";
      return h("article", { class: "corp-card" + (wide ? " wide" : "") }, ed ? h("div", { class: "corp-tools" }, corpTools(x)) : null, h("h3", { text: x.name }),
        h("div", { class: "corp-meta", text: [M.corpClass(x.scale), sectorName(x.sector), x.hq, par ? "входит в " + par : "", +x.cap ? "капитализация " + fmt(+x.cap, "int") + " млрд кр." : ""].filter(Boolean).join(" · ") }),
        x.desc ? h("p", { text: x.desc }) : null);
    }
  }

  // ---------- лор: идеологии ----------
  // тексты — data/ideologies.json (те же, что на листе «Идеологии» в Excel), числа модификаторов — справочник «Идеологии» (правила ГМа)
  const IDEO_POS = { top: [200, 46], "left-mid": [122, 182], "right-mid": [278, 182], left: [44, 318], "bottom-mid": [200, 318], right: [356, 318], center: [200, 228] };
  const IDEO_NEAR = ["purity|mastery", "purity|divinity", "supremacy|mastery", "supremacy|voracity", "harmony|divinity", "harmony|voracity"];
  const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "") + String(Math.abs(v)).replace(".", ",");
  function ideoEffects(row) {
    if (!row) return [];
    return M.IDEO_FX.filter(([f]) => +row[f]).map(([f, , mode, label]) => {
      const v = +row[f], name = label.replace(/,.*$/, "");
      return { v, text: mode === "add" ? name + " " + sgn(v) + " за ход" : name + " " + sgn(v) + "%" };
    });
  }
  function ideoRel(lore, a, b) {
    const R = lore.relations || {};
    if (a === b) return R.self;
    if (a === "balance" || b === "balance") return R.center;
    const L = lore.list.find(x => x.id === a);
    if (L && L.opposite === b) return R.opposite;
    return IDEO_NEAR.includes(a + "|" + b) || IDEO_NEAR.includes(b + "|" + a) ? R.near : R.far;
  }
  async function renderIdeoLore(el) {
    el.innerHTML = "";
    el.append(h("p", { class: "mech-note", text: "Загрузка…" }));
    await init();
    let lore = null;
    try { lore = await fetch("data/ideologies.json?t=" + Date.now(), { cache: "no-store" }).then(r => (r.ok ? r.json() : null)); } catch (e) { lore = null; }
    el.innerHTML = "";
    if (!lore || !Array.isArray(lore.list)) { el.append(h("p", { class: "mech-note", text: "Не удалось загрузить описание идеологий." })); return; }
    const L = lore.list, byId = {}; L.forEach(x => (byId[x.id] = x));
    const ruleOf = id => (rules.tables.ideo || []).find(x => x.id === id);
    const nameOf = id => (ruleOf(id) || byId[id] || { name: id }).name;
    const icon = (x, cls) => h("img", { class: cls || "ideo-ico", src: "assets/ideology/" + x.id + ".png", alt: "", loading: "lazy" });
    const go = id => { const t = document.getElementById("ideo-" + id); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); };

    // вступление правит ГМ (Режим ГМа → «✎ Правка»)
    el.append(h("div", { class: "rich", "data-edit": "lore.ideo.intro", "data-label": "Лор: вступление к идеологиям" }, h("p", { class: "lead", text: lore.intro })));

    // схема-треугольник: вершины — базовые, стороны — гибриды, центр — Равновесие
    const P = id => IDEO_POS[(byId[id] || {}).pos] || [200, 228];
    const NS = "http://www.w3.org/2000/svg";
    const s = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); kids.forEach(k => e.append(k)); return e; };
    const [T, Lf, Rt] = [IDEO_POS.top, IDEO_POS.left, IDEO_POS.right];
    const tri = T.join(",") + " " + Lf.join(",") + " " + Rt.join(",");
    const defs = s("defs", {}, s("clipPath", { id: "ideoTri" }, s("polygon", { points: tri })));
    const glow = ["purity", "supremacy", "harmony"].filter(id => byId[id]).map(id => {
      defs.append(s("radialGradient", { id: "ideoG-" + id }, s("stop", { offset: "0", "stop-color": byId[id].color, "stop-opacity": ".75" }), s("stop", { offset: "1", "stop-color": byId[id].color, "stop-opacity": "0" })));
      const [x, y] = P(id); return s("circle", { cx: x, cy: y, r: 240, fill: "url(#ideoG-" + id + ")" });
    });
    const svg = s("svg", { viewBox: "-24 0 448 380", class: "ideo-tri", role: "img", "aria-label": "Схема идеологий: треугольник" }, defs,
      s("polygon", { points: tri, fill: "#0b1230" }), s("g", { "clip-path": "url(#ideoTri)" }, ...glow),
      ...(lore.axes || []).map(a => { const [x1, y1] = P(a.a), [x2, y2] = P(a.b); return s("line", { x1, y1, x2, y2, class: "ideo-axis" }); }),
      s("polygon", { points: tri, class: "ideo-edge" }));
    for (const x of L) {
      const [cx, cy] = P(x.id), big = x.pos === "center" ? 25 : 28;
      const g = s("g", { class: "ideo-node", tabindex: "0", role: "button", "aria-label": x.name },
        s("image", { href: "assets/ideology/" + x.id + ".png", x: cx - big, y: cy - big, width: big * 2, height: big * 2 }),
        s("text", { x: cx, y: cy + big + 18, "text-anchor": "middle", fill: x.color }, nameOf(x.id)));
      g.addEventListener("click", () => go(x.id));
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(x.id); } });
      svg.append(g);
    }
    // оси противостояния — рядом со схемой
    const axes = h("div", { class: "ideo-axes" }, h("h3", { text: "Оси противостояния" }),
      (lore.axes || []).map(a => h("div", { class: "ideo-axis-row" },
        h("b", { text: a.name }), h("span", { class: "q", text: a.q }),
        h("div", { class: "pair" },
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.a].color, onclick: () => go(a.a) }, icon(byId[a.a], "ideo-chip-ico"), nameOf(a.a), h("small", { text: a.a_note })),
          h("span", { class: "vs", text: "↔" }),
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.b].color, onclick: () => go(a.b) }, icon(byId[a.b], "ideo-chip-ico"), nameOf(a.b), h("small", { text: a.b_note }))))),
      h("p", { class: "mech-note", text: "Каждый гибрид противостоит вершине напротив. Цвета смешиваются так же, как идеи: красный и жёлтый дают оранжевое Господство, жёлтый и бирюзовый — зелёную Ненасытность, бирюзовый и красный — пурпурную Духовность." }));
    el.append(h("div", { class: "ideo-top" }, h("div", { class: "ideo-tri-wrap" }, svg), axes));

    // карточки
    const cards = h("div", { class: "ideo-cards" });
    for (const x of L) {
      const fx = ideoEffects(ruleOf(x.id));
      cards.append(h("article", { class: "ideo-card", id: "ideo-" + x.id, style: "--c:" + x.color },
        h("header", null, icon(x), h("div", null, h("h3", { text: nameOf(x.id) }),
          h("div", { class: "ideo-meta", text: [x.en, x.kind, x.opposite ? "противник — " + nameOf(x.opposite) : ""].filter(Boolean).join(" · ") }))),
        h("p", { class: "ideo-desc", text: x.desc }),
        h("dl", null,
          h("dt", { text: "Виновник Великой ошибки" }), h("dd", { text: x.blame }),
          h("dt", { text: "Реальные аналоги" }), h("dd", { text: x.real }),
          h("dt", { text: "Влияние на государство" }), h("dd", { text: x.state })),
        h("div", { class: "ideo-fx" }, fx.length ? fx.map(e => h("span", { class: "fx " + (e.v > 0 ? "up" : "down"), text: e.text })) : h("span", { class: "fx", text: "Без модификаторов" }))));
    }
    el.append(h("h2", { class: "ideo-h", text: "Семь идеологий" }), cards);

    // отношения
    const rel = h("table", { class: "mt ideo-rel" },
      h("thead", null, h("tr", null, h("th"), L.map(x => h("th", { style: "color:" + x.color, text: nameOf(x.id) })))),
      h("tbody", null, L.map(a => h("tr", null, h("th", { style: "color:" + a.color, text: nameOf(a.id) }),
        L.map(b => { const v = ideoRel(lore, a.id, b.id); return h("td", { class: "num" + (v > 0 ? " up" : v < 0 ? " down" : "") + (a.id === b.id ? " self" : ""), text: sgn(v) || "0" }); })))));
    const R = lore.relations || {};
    el.append(h("h2", { class: "ideo-h", text: "Отношения между идеологиями" }),
      h("p", { class: "mech-note", text: "Своя " + sgn(R.self) + " · соседняя по треугольнику " + sgn(R.near) + " · через одну " + sgn(R.far) + " · противоположная " + sgn(R.opposite) + " · с Равновесием " + (sgn(R.center) || "0") + ". Пока справочно: в расчётах не участвует." }),
      h("div", { class: "mt-scroll" }, rel),
      h("p", { class: "mech-note", text: "Модификаторы — правила ГМа: Вики → Механики → Справочник → «Идеологии». Те же числа — на листе «Идеологии» в таблице «Механики_Мир2200.xlsx». Идеология страны выбирается в её карточке." }));
  }

  // ---------- карточка страны (общая для игрока и ГМа) ----------
  const LAYOUT = [
    { id: "overview", title: "Обзор" },
    { id: "state", title: "Государство", blocks: [
      ["Общие сведения", ["in:capital", "in:gov", "in:ideology", "out:wonders", "in:position", "in:megapolis"]],
      ["Территория и среда", ["in:territory", "in:habitable", "out:habitable_area", "in:flooded", "in:radiation", "in:waste_threat", "in:climate"]],
      ["Население", ["in:pop_meg", "in:pop_waste", "out:pop_total", "out:urban", "out:pop_per_meg", "in:working_share", "in:mob_share", "in:education", "in:healthcare", "out:health", "out:labor"]],
      ["Политика и общество", ["in:stability", "in:support", "in:corruption", "out:corruption_eff", "in:mob_law", "out:mob_law_name", "in:tech", "out:tech_mult", "in:infra", "out:infra_mult", "out:stab_mult", "out:hdi", "out:inm", "out:rank"]]] },
    { id: "econ", title: "Экономика", blocks: [
      ["Энергетика", ["tab:energy", "out:en_supply", "out:en_demand", "out:en_balance", "out:en_coef"]],
      ["Промышленность", ["tab:industry", "out:ind_total", "out:labor_need", "out:labor_coef", "out:pm_base", "out:ind_eff", "out:pm_eff", "out:pm_pc", "out:vpk_eff", "out:ship_eff", "out:aero_eff"]],
      ["Сырьё, продовольствие, вода", ["in:raw", "out:raw_need", "out:raw_bal", "tab:food", "out:field_yield", "out:food_prod", "out:food_need", "out:food_coef", "in:water", "out:water_sup", "out:water_need", "out:water_coef"]],
      ["Внешняя торговля", ["in:routes", "in:exp_share", "out:access", "out:export", "out:import", "out:trade_bal", "out:world_share"]],
      ["ВВП", ["out:gdp_ind", "out:gdp_agro", "out:gdp_raw", "out:gdp_svc", "out:gdp", "out:gdp_pc", "out:econ_level", "out:ind_share"]],
      ["Бюджет", ["in:tax", "out:budget", "in:b_def", "in:b_space", "in:b_sci", "in:b_soc", "in:b_infra", "out:b_other", "out:def_budget", "out:space_budget", "out:sci_budget", "out:soc_budget", "out:infra_budget"]],
      ["Прогноз на следующий ход", ["out:d_tech", "out:next_tech", "out:d_stab", "out:next_stab", "out:d_pop", "out:next_pop", "out:d_gdp", "out:next_gdp"]]] },
    { id: "army", title: "Армия", blocks: [
      ["Мобилизационный ресурс", ["out:mop_total", "out:mob_law_name", "out:mop_share", "out:mop_avail", "out:active", "out:mop_load", "out:staffing", "out:reserve"]],
      ["Сухопутные войска", ["tab:div", "out:div_total", "out:pers_ground", "in:eq_tank", "out:need_tank", "in:eq_ifv", "out:need_ifv", "in:eq_art", "out:need_art", "out:equip", "out:ground_power", "out:ground_upkeep"]],
      ["Гарнизоны и безопасность", ["out:garr_need", "out:garr_have", "out:security"]],
      ["ПВО и стратегические силы", ["in:sam", "out:ad_power", "in:icbm", "in:warheads", "out:nuke_cap", "out:nuke_deliv", "out:nuke_power", "out:rod_power", "out:strat_power", "out:pers_strat", "out:strat_upkeep"]],
      ["Обеспечение и боеготовность", ["out:upkeep_total", "out:def_budget", "out:mil_bal", "out:readiness", "out:morale", "out:sat_mult"]],
      ["Военное производство (за ход)", ["out:ovp", "out:ship_ton", "out:ac_prod"]],
      ["Итог", ["out:conv_power", "out:total_power", "out:world_mil_share", "out:power_pc"]]] },
    { id: "fleet", title: "ВВС и флот", blocks: [
      ["Военно-воздушные силы", ["tab:ac", "out:ac_total", "in:airbases", "out:ac_base_coef", "out:pers_air", "out:air_power", "out:air_upkeep"]],
      ["Военно-морской флот", ["tab:ship", "out:ships_total", "out:ships_combat", "in:navbases", "out:tonnage", "out:deck_ac", "out:nav_base_coef", "out:nav_supply", "out:pers_navy", "out:navy_power", "out:navy_upkeep"]]] },
    { id: "space", title: "Космос", blocks: [
      ["Инфраструктура и группировка", ["in:pads", "out:launch_cap", "tab:sat", "out:sat_total", "out:sat_pers", "out:sat_upkeep", "out:space_budget", "out:coverage", "out:sat_loss"]],
      ["Влияние спутников", ["out:b_sci", "out:b_nav_trade", "out:b_nav_mil", "out:b_comm_econ", "out:b_c2", "out:b_recon", "out:b_warn", "out:rod_strikes", "out:rod_tension", "out:asat_cap"]],
      ["Орбита (общая для всего мира)", ["out:world_sats", "out:kessler", "out:kessler_status", "out:debris_loss", "out:launch_cost"]]] },
    { id: "corp", title: "Корпорации" },
    { id: "effects", title: "Эффекты и заметки" }
  ];
  const TAB_INFO = {
    div: [["pers", "тыс. л/с", "d1"], ["power", "мощь", "d1"], ["upkeep", "млрд/ход", "d2"]],
    ac: [["pers", "тыс. л/с", "d2"], ["power", "мощь", "d1"], ["upkeep", "млрд/ход", "d2"]],
    ship: [["pers", "тыс. экипаж", "d2"], ["power", "мощь", "d1"], ["upkeep", "млрд/ход", "d2"]],
    sat: [["upkeep", "млрд/ход", "d2"]]
  };
  function warnings(r, c) {
    const w = [], I = c.in || {};
    if (r.en_coef < 0.999) w.push("Дефицит энергии: заводы работают на " + fmt(r.en_coef, "pct") + ", авиации не хватает топлива.");
    if (r.labor_coef < 0.999) w.push("Не хватает рабочих: заняты " + fmt(r.labor_coef, "pct") + " мест на заводах. Армия или радиация забрали людей.");
    if (r.food_coef < 0.999) w.push("Не хватает продовольствия (" + fmt(r.food_coef, "pct") + "): импорт, падение стабильности и прироста.");
    if (r.water_coef < 0.999) w.push("Не хватает пресной воды (" + fmt(r.water_coef, "pct") + ").");
    if (r.b_other < -1e-9) w.push("Перерасход бюджета: статьи в сумме превышают 100%.");
    if (r.readiness < 0.999) w.push("Военный бюджет не покрывает содержание: боеготовность " + fmt(r.readiness, "pct") + ".");
    if (r.staffing < 0.999) w.push("Армия больше доступного МОП: укомплектованность " + fmt(r.staffing, "pct") + ". Смягчите закон о мобилизации или сократите войска.");
    else if (r.mop_load > 0.5) w.push("Нагрузка на МОП " + fmt(r.mop_load, "pct") + " — экономика теряет рост.");
    if (r.security < 0.999) w.push("Не хватает гарнизонов: безопасность " + fmt(r.security, "pct") + ". Страдают пустоши и стабильность.");
    if (r.equip < 0.9) w.push("Дивизиям не хватает техники: оснащённость " + fmt(r.equip, "pct") + ".");
    if (r.ac_base_coef < 0.999) w.push("Аэродромов не хватает на всю авиацию.");
    if (r.nav_base_coef < 0.999) w.push("Военно-морских баз не хватает на весь флот.");
    if (r.nav_supply < 0.999) w.push("Флоту не хватает судов снабжения.");
    if (r.coverage < 0.999) w.push("Космический бюджет не покрывает группировку: в конце хода сойдут с орбиты " + r.sat_loss + " спутн.");
    if (r.kessler >= 0.75) w.push("Орбита перегружена: индекс Кесслера " + fmt(r.kessler, "d2") + ".");
    if (r.debris_loss >= 0.5) w.push("Мусор на орбите: за ход может погибнуть ≈ " + fmt(r.debris_loss, "d1") + " спутн.; запуски дороже на " + fmt(r.launch_cost, "pct") + ".");
    if (+I.mob_law >= 4) w.push("Режим «" + r.mob_law_name + "» каждый ход снижает стабильность.");
    if (r.corp_sov_pen > 0) w.push("Корпорации подмяли государство (влияние " + fmt(r.corp_infl, "d1") + "): общество теряет " + fmt(r.corp_sov_pen, "d1") + " стабильности за ход.");
    const sis = (r.corp_rows || []).filter(x => x.sis && x.lead);
    if (sis.length) w.push("«Государство в государстве»: " + sis.map(x => groupName(x.group)).join(", ") + ".");
    const hostile = (r.corp_rows || []).filter(x => x.W > 0 && x.rel < 0);
    if (hostile.length) w.push("Враждебные корпорации саботируют экономику: " + hostile.map(x => x.name).join(", ") + ".");
    return w;
  }

  // opts: { c, world, editable, base, onChange, gm }
  function countryView(opts) {
    const c = opts.c;
    c.in = c.in || {}; c.cnt = c.cnt || {}; c.mods = c.mods || [];
    if (!c.corp || typeof c.corp !== "object") c.corp = {};
    if (!Array.isArray(c.blocs)) c.blocs = [];
    M.COUNT_TABLES.forEach(t => (c.cnt[t] = c.cnt[t] || {}));
    const lives = [];
    let r = null;
    const calc = () => { r = M.compute(rules, c, opts.id); M.applyWorld(rules, c, r, opts.world); return r; };
    const live = (fn, cls) => { const e = h("span", { class: cls || "" }); lives.push({ e, fn }); return e; };
    function refresh() {
      calc();
      for (const L of lives) L.fn(L.e, r, opts.base);
    }
    const changed = () => { refresh(); if (opts.onChange) opts.onChange(r); };
    function outVal(key) {
      const [, , f, kind] = M.OUT[key] || [key, "", "d2"];
      return live((e, r, base) => {
        const v = r[key];
        e.textContent = fmt(v, f);
        e.className = "v" + (kind === "res" ? " res" : "") +
          ((kind === "coef" && v < 0.995) || (kind === "neg" && v < -1e-9) || (kind === "load" && v >= 1) ? " bad" : "") + (kind === "load" && v >= 0.5 && v < 1 ? " warn" : "");
        if (base && f !== "txt" && isFinite(base[key]) && isFinite(v)) {
          const d = v - base[key];
          if (Math.abs(d) > Math.max(1e-6, Math.abs(base[key]) * 1e-6)) e.append(h("small", { class: "delta " + (d > 0 ? "up" : "down"), text: (d > 0 ? "▲ " : "▼ ") + fmt(Math.abs(d), f) }));
        }
      });
    }
    function inField(key) {
      const [label, unit, f, mn, mx] = M.INPUTS[key];
      const cur = c.in[key];
      if (!opts.editable) {
        if (key === "mob_law") return live(e => { const l = rules.tables.law[(+c.in.mob_law || 1) - 1]; e.textContent = (+c.in.mob_law || 1) + (l ? " — " + l.name : ""); e.className = "v"; });
        return h("span", { class: "v", text: fmt(f === "txt" ? cur : +cur, f) });
      }
      if (key === "mob_law") {
        const s = h("select", { onchange: () => { c.in.mob_law = +s.value; changed(); } }, rules.tables.law.map((l, i) => h("option", { value: i + 1, text: (i + 1) + " — " + l.name })));
        s.value = String(cur || 1); return s;
      }
      if (key === "ideology") {
        // выбор из справочника идеологий; старое значение не из списка сохраняется отдельным пунктом (без эффектов)
        const names = (rules.tables.ideo || []).map(x => x.name), own = cur && !M.ideologyOf(rules, cur) ? [h("option", { value: cur, text: cur + " (не из справочника, без эффектов)" })] : [];
        const s = h("select", { onchange: () => { c.in.ideology = s.value; changed(); } }, h("option", { value: "", text: "— не выбрана —" }), names.map(n => h("option", { value: n, text: n })), own);
        const found = M.ideologyOf(rules, cur); s.value = found ? found.name : (cur || ""); return s;
      }
      if (f === "txt") return h("input", { type: "text", value: cur || "", oninput: e => { c.in[key] = e.target.value; if (opts.onChange) opts.onChange(r); } });
      const pct = f === "pct";
      const inp = h("input", { type: "number", class: "num", step: f === "int" ? 1 : "any", min: mn != null ? (pct ? mn * 100 : mn) : null, max: mx != null ? (pct ? mx * 100 : mx) : null,
        value: cur == null ? "" : pct ? +(cur * 100).toFixed(4) : cur });
      inp.addEventListener("input", () => {
        if (inp.value === "" || !isFinite(+inp.value)) return;
        c.in[key] = pct ? +inp.value / 100 : +inp.value; changed();
      });
      return pct ? h("span", { class: "pct-in" }, inp, "%") : inp;
    }
    function row(item) {
      const [kind, key] = item.split(":");
      if (kind === "tab") return tableBlock(key);
      // описание показателя из летописи — подсказка при наведении на название строки
      const lore = M.paramLore(key), lab = text => h("span", { class: "l" + (lore ? " lored" : ""), text, title: lore ? lore.text : null, "data-lore": lore ? key : null });
      if (kind === "in") {
        const [label, unit, , , , hint] = M.INPUTS[key];
        return h("div", { class: "mrow in" + (opts.editable ? " edit" : "") }, lab(label), h("span", { class: "c" }, inField(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
      }
      const [label, unit, , okind, hint] = M.OUT[key];
      return h("div", { class: "mrow out" + (okind === "res" ? " is-res" : "") }, lab(label), h("span", { class: "c" }, outVal(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
    }
    function tableBlock(t) {
      const meta = M.TABLES[t], info = TAB_INFO[t] || [];
      const tbl = h("table", { class: "mt units" });
      tbl.append(h("thead", null, h("tr", null, h("th", { text: meta.title.replace(/^Типы |^Классы /, "") }), h("th", { class: "num", text: meta.unit }), info.map(([, l]) => h("th", { class: "num", text: l })),
        t === "industry" ? h("th", { text: "Роль" }) : null, t === "food" ? h("th", { text: "Погода" }) : null, t === "sat" ? h("th", { text: "Эффект" }) : null)));
      const body = h("tbody");
      for (const rowT of rules.tables[t]) {
        const cur = +(c.cnt[t][rowT.id] || 0);
        let cell;
        if (opts.editable) {
          const inp = h("input", { type: "number", class: "num", min: 0, step: ["energy", "food"].includes(t) ? "any" : 1, value: cur });
          inp.addEventListener("input", () => { if (inp.value === "" || !isFinite(+inp.value)) return; c.cnt[t][rowT.id] = Math.max(0, +inp.value); changed(); });
          cell = h("td", { class: "num" }, inp);
        } else cell = h("td", { class: "num" }, h("span", { class: "v", text: fmt(cur, ["energy", "food"].includes(t) ? "d1" : "int") }));
        const tr = h("tr", { class: cur ? "" : "zero" }, h("td", { text: rowT.name, title: rowT.desc || null, class: rowT.desc ? "lored" : null }), cell,
          info.map(([f, , ff]) => h("td", { class: "num" }, live(e => { const n = +(c.cnt[t][rowT.id] || 0); e.textContent = n ? fmt(n * (+rowT[f] || 0), ff) : "·"; tr.classList.toggle("zero", !n); }))));
        if (t === "industry") tr.append(h("td", { class: "tag", text: (M.TABLES.industry.fields[1][3].find(o => o[0] === rowT.role) || [, ""])[1] }));
        if (t === "food") tr.append(h("td", { class: "tag", text: String(rowT.weather) === "1" ? "зависит" : "нет" }));
        if (t === "sat") tr.append(h("td", { class: "tag", text: (M.TABLES.sat.fields[4][3].find(o => o[0] === rowT.effect) || [, ""])[1] }));
        body.append(tr);
      }
      tbl.append(body);
      return h("div", { class: "mt-scroll" }, tbl);
    }

    // обзор
    function overview() {
      const box = h("div", { class: "overview" });
      const kpi = (label, fn, sub) => h("div", { class: "kpi" }, h("span", { class: "kl", text: label }), live((e, r, b) => { e.textContent = fn(r); }, "kv"), sub ? live((e, r) => { e.textContent = sub(r); }, "ks") : null);
      box.append(h("div", { class: "kpis" },
        kpi("Место в рейтинге", r => r.rank + "", r => "ИНМ " + fmt(r.inm, "d1")),
        kpi("ВВП, млрд кр.", r => fmt(r.gdp, "d1"), r => "рост " + fmt(r.d_gdp, "pct") + " за ход"),
        kpi("ВВП на душу", r => fmt(r.gdp_pc, "d1"), r => r.econ_level),
        kpi("Население, млн", r => fmt(r.pop_total, "d2"), r => "прирост " + fmt(r.d_pop, "pct")),
        kpi("Промышленная мощь", r => fmt(r.pm_eff, "d1"), r => "доля мирового экспорта " + fmt(r.world_share, "pct")),
        kpi("Бюджет, млрд кр.", r => fmt(r.budget, "d1"), r => "оборона " + fmt(r.def_budget, "d1")),
        kpi("Военная мощь", r => fmt(r.total_power, "d1"), r => fmt(r.world_mil_share, "pct") + " мировой"),
        kpi("Армия, тыс. чел.", r => fmt(r.active, "d1"), r => r.div_total + " див. · " + r.ships_total + " кор. · " + r.ac_total + " ЛА"),
        kpi("Стабильность", () => fmt(+c.in.stability, "d1"), r => (r.d_stab >= 0 ? "+" : "") + fmt(r.d_stab, "d1") + " за ход"),
        kpi("Технологии", () => fmt(+c.in.tech, "d2"), r => "+" + fmt(r.d_tech, "d3") + " за ход"),
        kpi("Спутники", r => fmt(r.sat_total, "int"), r => "орбита: " + r.kessler_status.toLowerCase()),
        kpi("Суверенитет", r => fmt(r.sovereignty, "d1"), r => r.corp_status.toLowerCase() + (r.corp_share > 0 ? " · корпорации: " + fmt(r.corp_share, "pct") + " ВВП" : ""))
      ));
      box.append(h("h3", { text: "Внимание" }), live((e, r) => {
        e.innerHTML = "";
        const w = warnings(r, c);
        if (!w.length) e.append(h("p", { class: "ok", text: "Серьёзных проблем нет." }));
        else e.append(h("ul", { class: "warns" }, w.map(t => h("li", { text: t }))));
      }, "warn-box"));
      return box;
    }
    function effectsPane() {
      const box = h("div", { class: "effects" });
      const list = h("div");
      const targetName = k => (M.MOD_TARGETS.find(t => t[0] === k) || [, k])[1];
      const draw = () => {
        list.innerHTML = "";
        if (!c.mods.length) list.append(h("p", { class: "empty", text: "Особых эффектов нет." }));
        for (const m of c.mods) {
          const val = (m.mode === "add" ? (+m.value >= 0 ? "+" : "") + fmt(+m.value, "d2") : (+m.value >= 0 ? "+" : "") + fmt(+m.value, "d1") + "%");
          const line = h("div", { class: "mod" + (m.off ? " off" : "") }, h("b", { text: m.name || "Эффект" }), h("span", { class: "mod-v", text: val + " · " + targetName(m.target) }), m.note ? h("span", { class: "hint", text: m.note }) : null);
          if (opts.gm) line.append(h("span", { class: "mod-btns" },
            h("button", { class: "small-btn", text: m.off ? "Включить" : "Выключить", onclick: () => { m.off = !m.off; draw(); changed(); } }),
            h("button", { class: "small-btn", text: "✎", title: "Изменить", onclick: () => editMod(m) }),
            h("button", { class: "small-btn danger", text: "✕", title: "Удалить", onclick: async () => { if (await ask("Удалить эффект «" + m.name + "»?", "", { confirm: true })) { c.mods.splice(c.mods.indexOf(m), 1); draw(); changed(); } } })));
          list.append(line);
        }
      };
      async function editMod(m) {
        const v = await window.KGForm(m ? "Эффект: " + m.name : "Новый особый эффект", [
          { key: "name", label: "Название", hint: "Например: «Снятие морской блокады»" },
          { key: "target", label: "На что влияет", type: "select", options: M.MOD_TARGETS },
          { key: "mode", label: "Как", type: "select", options: [["pct", "Процент (+10 = +10%)"], ["add", "Прибавка в единицах показателя"]] },
          { key: "value", label: "Значение", type: "number", step: "any", hint: "Отрицательное — штраф" },
          { key: "note", label: "Пояснение для игрока", type: "textarea" }
        ], m ? clone(m) : { name: "", target: "gdp", mode: "pct", value: 10, note: "" }, v => (!v.name ? "Введите название" : v.value === "" ? "Введите значение" : ""));
        if (!v) return;
        if (m) Object.assign(m, v); else c.mods.push(Object.assign({ id: uid("mod") }, v));
        draw(); changed();
      }
      box.append(h("h3", { text: "Особые эффекты" }), list);
      if (opts.gm) box.append(h("button", { class: "small-btn", text: "+ Эффект", onclick: () => editMod(null) }));
      draw();
      if (opts.gm && c.dossier != null) {
        // справка из импорта: источники (карта, мод), что смоделировано. Игроку на странице не показывается
        const dt = h("textarea", { class: "notes dossier", rows: 8 });
        dt.value = c.dossier || "";
        dt.addEventListener("input", () => { c.dossier = dt.value; if (opts.onChange) opts.onChange(r); });
        box.append(h("h3", { text: "Справка о стране (видна только ГМу)" }), dt);
      }
      box.append(h("h3", { text: opts.gm ? "Заметки ГМа для игрока" : "Заметки ГМа" }));
      if (opts.gm) {
        const ta = h("textarea", { class: "notes", rows: 6, placeholder: "Что видит игрок: итоги хода, события, ответы на заявки…" });
        ta.value = c.notes || "";
        ta.addEventListener("input", () => { c.notes = ta.value; if (opts.onChange) opts.onChange(r); });
        box.append(ta);
      } else box.append(h("div", { class: "notes-view", text: c.notes || "Пока заметок нет." }));
      return box;
    }

    // корпорации в стране
    function corpPane() {
      const box = h("div", { class: "corp-pane" });
      box.append(h("p", { class: "mech-note", text: "Транснациональные корпорации не подчиняются правительству. Их присутствие в стране и отношения с ней ведёт ГМ по итогам контрактов, переговоров и конфликтов. " +
        "Корпорации приносят инвестиции, производство и технологии, но забирают долю ВВП, уходят от налогов, лоббируют, а при плохих отношениях саботируют экономику. Самые влиятельные становятся государством в государстве." }));
      box.append(h("section", { class: "mblock" }, h("h3", { text: "Корпоративное влияние" }),
        ["out:corp_infl", "out:sovereignty", "out:corp_status", "out:corp_share", "out:corp_rev", "out:corp_tax_loss", "out:corruption_eff", "out:corp_sov_pen", "out:corp_garr", "out:corp_threat", "out:corp_sis_n"].map(row)));

      // союзы и договоры
      const blocs = rules.tables.bloc, kinds = M.TABLES.bloc.fields[1][3];
      const kindName = k => (kinds.find(o => o[0] === k) || [, ""])[1];
      const bsec = h("section", { class: "mblock" }, h("h3", { text: "Союзы и блоки" }));
      // членство: союз с карты и номер в блоке — сами, галочка — решение ГМа (или «Что если» игрока)
      const links = () => M.blocLinks(rules, c, opts.id);
      const HOW = { map: "по карте", list: "состав блока", gm: "отмечено ГМом" };
      const L0 = links(), mine = blocs.filter(b => L0[b.id]);
      if (!blocs.length) bsec.append(h("p", { class: "empty", text: opts.gm ? "Союзов пока нет. Создайте их в «Правилах», таблица «Союзы и блоки»." : "Страна не состоит в союзах." }));
      else if (opts.editable) bsec.append(h("div", { class: "bloc-list" }, blocs.map(b => {
        const how = L0[b.id], fixed = how === "map" || how === "list";
        const cb = h("input", { type: "checkbox" }); cb.checked = !!how; cb.disabled = fixed;
        if (fixed) cb.title = how === "map" ? "Союз задан на карте: поле «Союз» в карточке страны" : "Страна в составе блока («Правила» → «Союзы и блоки»)";
        cb.addEventListener("change", () => { c.blocs = c.blocs.filter(x => x !== b.id && M.OLD_BLOCS[x] !== b.id); if (cb.checked) c.blocs.push(b.id); changed(); });
        return h("label", { class: "bloc" + (how ? " on" : "") }, cb, h("b", { text: b.name }), h("small", { text: kindName(b.kind) + (how ? " · " + HOW[how] : "") }));
      })));
      else bsec.append(mine.length ? h("ul", { class: "bloc-view" }, mine.map(b => h("li", null, h("b", { text: b.name }), " — " + kindName(b.kind) + " (" + HOW[L0[b.id]] + ")" + (b.desc ? ". " + b.desc : "")))) : h("p", { class: "empty", text: "Страна не состоит в союзах." }));
      bsec.append(live(e => {
        e.innerHTML = "";
        const cur = links();
        const ds = rules.tables.cdeal.filter(d => cur[d.bloc]);
        if (!ds.length) return;
        e.append(h("div", { class: "hint", text: "Договоры корпораций с союзами страны:" }), h("ul", { class: "bloc-view" }, ds.map(d => h("li", null, h("b", { text: groupName(d.corp) }), " ↔ " + ((blocs.find(b => b.id === d.bloc) || {}).name || "союз") +
          ": присутствие " + fmt(+d.pres, "d1") + ", отношения " + signed(+d.rel, "int") + (d.note ? ". " + d.note : "")))));
      }, "deals"));
      box.append(bsec);

      // таблица корпораций
      const csec = h("section", { class: "mblock" }, h("h3", { text: "Корпорации на территории" }));
      const list = opts.editable ? rules.tables.corp : rules.tables.corp.filter(x => { const y = r.corp_rows.find(z => z.id === x.id); return y && (y.W > 0 || y.enc > 0 || y.rel); });
      if (!list.length) csec.append(h("p", { class: "empty", text: "Корпорации в стране не представлены." }));
      else {
        const rowOf = id => r.corp_rows.find(z => z.id === id) || {};
        const tbl = h("table", { class: "mt units corp-t" }, h("thead", null, h("tr", null,
          h("th", { text: "Корпорация" }), h("th", { class: "num", text: "Присутствие 0–10" }), h("th", { class: "num", text: "Отношения ±100" }), h("th", { class: "num", text: "Анклавы" }),
          h("th", { class: "num", text: "Вес" }), h("th", { class: "num", text: "Отдача" }), h("th", { class: "num", text: "Влияние" }), h("th", { class: "num", text: "Доля ВВП" }), h("th", { class: "num", text: "Выручка, млрд" }), h("th", { text: "Положение" }))));
        const body = h("tbody");
        for (const corp of list) {
          const field = (f, mn, mx, step) => {
            const o = c.corp[corp.id] || {};
            if (!opts.editable) return h("span", { class: "v", text: f === "rel" ? signed(rowOf(corp.id)[f], "int") : fmt(rowOf(corp.id)[f], f === "enc" ? "int" : "d1") });
            const inp = h("input", { type: "number", class: "num", min: mn, max: mx, step, placeholder: "0", value: o[f] == null ? "" : o[f] });
            if (f !== "enc") live(() => { const x = rowOf(corp.id); inp.placeholder = x.via ? fmt(x[f], f === "rel" ? "int" : "d1") + " (союз)" : "0"; });
            inp.addEventListener("input", () => {
              if (inp.value !== "" && !isFinite(+inp.value)) return;
              const cur = c.corp[corp.id] = c.corp[corp.id] || {};
              if (inp.value === "") delete cur[f]; else cur[f] = Math.max(mn, Math.min(mx, +inp.value));
              if (!Object.keys(cur).length) delete c.corp[corp.id];
              changed();
            });
            return inp;
          };
          const cell = fn => h("td", { class: "num" }, live(e => { e.textContent = fn(rowOf(corp.id)); }));
          const parent = corp.parent && corpById(corp.parent) && corp.parent !== corp.id ? corpById(corp.parent).name : "";
          const tr = h("tr", null,
            h("td", null, h("b", { text: corp.name }), h("small", { class: "sub", text: sectorName(corp.sector) + (parent ? " · " + parent : "") })),
            h("td", { class: "num" }, field("pres", 0, 10, "any")), h("td", { class: "num" }, field("rel", -100, 100, 1)), h("td", { class: "num" }, field("enc", 0, 100, 1)),
            cell(x => (x.W ? fmt(x.W, "d1") : "·")), cell(x => (x.W ? fmt(x.B, "pct").replace(",0%", "%") : "·")), cell(x => (x.infl ? fmt(x.infl, "d1") : "·")),
            cell(x => (x.share ? fmt(x.share, "pct") : "·")), cell(x => (x.rev ? fmt(x.rev, "d1") : "·")),
            h("td", { class: "tag" }, live(e => { const x = rowOf(corp.id); e.textContent = x.status + (x.via ? " · по договору: " + x.via : ""); e.className = x.sis ? "sis" : x.rel < 0 && x.W > 0 ? "hostile" : ""; })));
          live(() => { const x = rowOf(corp.id); tr.classList.toggle("zero", !(x.W > 0 || x.enc > 0)); });
          body.append(tr);
        }
        tbl.append(body);
        csec.append(h("div", { class: "mt-scroll" }, tbl));
        csec.append(h("p", { class: "hint", text: "Вес = присутствие × масштаб корпорации. Отдача: 50% при нейтральных отношениях, 100% при +100, 0 при −100. Пустое поле — значение из договора союза или 0." }));
      }
      box.append(csec);

      // эффекты
      const tName = k => (M.MOD_TARGETS.find(t => t[0] === k) || [, k])[1];
      box.append(h("section", { class: "mblock" }, h("h3", { text: "Как корпорации меняют показатели" }), live(e => {
        e.innerHTML = "";
        const by = {};
        for (const m of r.corp_mods || []) (by[m.name] = by[m.name] || []).push(m);
        const names = Object.keys(by);
        if (!names.length) { e.append(h("p", { class: "empty", text: "Эффектов нет." })); return; }
        e.append(h("ul", { class: "corp-fx" }, names.map(n => h("li", { class: /саботаж/.test(n) ? "neg" : "" }, h("b", { text: n }), " — ",
          by[n].map(m => tName(m.target) + " " + (m.mode === "pct" ? signed(m.value, "d1") + "%" : signed(m.value, Math.abs(m.value) < 0.1 ? "d3" : "d2"))).join(", ")))));
      }, "fx")));
      return box;
    }

    calc();
    const root = h("div", { class: "cv" });
    const tabs = h("div", { class: "cv-tabs" });
    const panes = {};
    for (const sec of LAYOUT) {
      const p = h("div", { class: "cv-pane hidden" });
      if (sec.id === "overview") p.append(overview());
      else if (sec.id === "effects") p.append(effectsPane());
      else if (sec.id === "corp") p.append(corpPane());
      else for (const [title, items] of sec.blocks) p.append(h("section", { class: "mblock" }, h("h3", { text: title }), items.map(row)));
      panes[sec.id] = p;
      tabs.append(h("button", { "data-cv": sec.id, text: sec.title, onclick: () => show(sec.id) }));
    }
    function show(id) {
      tabs.querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.cv === id));
      for (const k in panes) panes[k].classList.toggle("hidden", k !== id);
      countryView.last = id;
    }
    root.append(tabs, ...Object.values(panes));
    refresh();
    show(countryView.last && panes[countryView.last] ? countryView.last : "overview");
    root.refresh = refresh;
    root.result = () => r;
    return root;
  }

  // ---------- кабинет игрока ----------
  async function openPlayer(id, dk) {
    const rec = mech.countries[id];
    if (!rec || !rec.data) throw new Error("Данные страны ещё не опубликованы");
    const data = await C.decJSON(dk, rec.data);
    const base = M.compute(rules, data.c); M.applyWorld(rules, data.c, base, data.world);
    player = { id, dk, data, base, c: clone(data.c) };
  }
  async function restorePlayer() {
    let s = null; try { s = JSON.parse(sessionStorage.getItem(PLAYER_KEY) || "null"); } catch (e) { /* */ }
    if (!s || !mech.countries[s.id]) return;
    try { await openPlayer(s.id, C.unb64(s.dk)); } catch (e) { player = null; try { sessionStorage.removeItem(PLAYER_KEY); } catch (x) { /* */ } }
  }
  function logoutPlayer() { player = null; sandbox = false; try { sessionStorage.removeItem(PLAYER_KEY); } catch (e) { /* */ } renderMy(); renderHomeAuth(); }
  function renderMy() {
    const box = $("mechMy"); box.innerHTML = "";
    if (!player) {
      box.append(h("div", { class: "login-box" }, h("h2", { text: "Моя страна" }),
        h("p", { class: "mech-note", text: "Войдите за свою страну на Главной: выберите государство и введите пароль, который выдал ГМ. После входа здесь будет вся экономика, армия, корпорации и режим «Что если»." }),
        h("button", { class: "accent", text: "Войти на Главной", onclick: () => window.KG.go("home") })));
      return;
    }
    const id = player.id, d = player.data;
    const head = h("div", { class: "cv-head" }, flagEl(id, "big"), h("div", { class: "cv-title" }, h("h2", { text: countryName(id) }),
      h("span", { class: "mech-note", text: "Ход " + (d.turn || mech.turn) + ", " + (d.year || mech.year) + " год" + (sandbox ? " · режим «Что если»: правки не сохраняются, ▲▼ — разница с текущим положением" : "") })));
    const btns = h("div", { class: "cv-btns" });
    if (sandbox) btns.append(h("button", { text: "Сбросить", onclick: () => { player.c = clone(player.data.c); renderMy(); } }), h("button", { text: "Выйти из «Что если»", onclick: () => { sandbox = false; player.c = clone(player.data.c); renderMy(); } }));
    else btns.append(h("button", { class: "accent", text: "Что если…", title: "Прикинуть последствия решений. Правки не сохраняются", onclick: () => { sandbox = true; renderMy(); } }));
    btns.append(h("button", { text: "Выйти", onclick: logoutPlayer }));
    head.append(btns);
    box.append(head, countryView({ id, c: sandbox ? player.c : clone(player.data.c), world: d.world, editable: sandbox, base: sandbox ? player.base : null }));
  }

  // ---------- Главная: вход за страну и вход ГМа ----------
  function renderHomeAuth() {
    const box = $("homeAuth"); if (!box || !mech) return;
    box.innerHTML = "";
    // страна
    const cs = h("section", { class: "auth-card" }, h("h2", { text: "Вход за страну" }));
    if (!C.ready()) cs.append(h("p", { class: "empty", text: "Вход работает только по https." }));
    else if (player) {
      cs.append(h("div", { class: "auth-who" }, flagEl(player.id, "big"), h("div", null, h("b", { text: countryName(player.id) }), h("span", { class: "mech-note", text: "Вы вошли за эту страну." }))),
        h("div", { class: "auth-btns" }, h("button", { class: "accent", text: "Моя страна", onclick: () => window.KG.go("wiki/mech/my") }), h("button", { text: "Выйти", onclick: logoutPlayer })));
    } else {
      const ids = Object.keys(mech.countries).filter(id => mech.countries[id].kp && mech.countries[id].data).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
      if (!ids.length) cs.append(h("p", { class: "empty", text: "Пока ни одна страна не подключена к механикам. Пароль для входа выдаёт ГМ." }));
      else {
        const sel = h("select", { "aria-label": "Государство" }, ids.map(id => h("option", { value: id, text: countryName(id) })));
        const pw = h("input", { type: "password", placeholder: "Пароль страны", autocomplete: "current-password", "aria-label": "Пароль страны" });
        const err = h("div", { class: "form-error" });
        const btn = h("button", { class: "accent", text: "Войти" });
        let fails = 0;
        const go = async () => {
          if (!pw.value) return;
          btn.disabled = true; err.textContent = "";
          await new Promise(r => setTimeout(r, Math.min(4000, fails * 700)));
          try {
            const dk = await C.unlockWithPassword(pw.value, mech.countries[sel.value].kp);
            await openPlayer(sel.value, dk);
            try { sessionStorage.setItem(PLAYER_KEY, JSON.stringify({ id: sel.value, dk: C.b64(dk) })); } catch (e) { /* */ }
            sandbox = false; renderMy(); renderHomeAuth();
          } catch (e) { fails++; err.textContent = e.name === "OperationError" ? "Неверный пароль" : e.message; }
          finally { btn.disabled = false; }
        };
        btn.onclick = go;
        pw.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") go(); });
        cs.append(h("p", { class: "mech-note", text: "Выберите своё государство и введите пароль от ГМа. Данные страны зашифрованы этим паролем." }),
          h("label", { class: "f-row" }, h("span", { text: "Государство" }), sel), h("label", { class: "f-row" }, h("span", { text: "Пароль" }), pw), err, h("div", { class: "auth-btns" }, btn));
      }
    }
    // ГМ
    const gs = h("section", { class: "auth-card" }, h("h2", { text: "Вход ГМа" }));
    if (isGm()) gs.append(h("p", { class: "mech-note", text: "Режим ГМа включён. Калькулятор — Вики → Механики → «Калькулятор», ниже — оформление сайта, а кнопка «✎ Правка» вверху включает правку текстов, картинок и разделов на любой странице." }),
      h("div", { class: "auth-btns" }, h("button", { class: "accent", text: "Калькулятор", onclick: () => window.KG.go("wiki/mech/calc") }), h("button", { text: "Выйти из режима ГМа", onclick: () => window.KGMap && window.KGMap.logout && window.KGMap.logout() })));
    else gs.append(h("p", { class: "mech-note", text: "Ведущий игры правит карту, страны, корпорации, правила и весь сайт." }),
      h("div", { class: "auth-btns" }, h("button", { class: "accent", text: "🔒 Войти как ГМ", onclick: () => window.KGMap && window.KGMap.login && window.KGMap.login() })));
    box.append(h("div", { class: "auth-grid" }, cs, gs));
  }

  // ---------- ГМ ----------
  const isGm = () => !!(window.KGMap && window.KGMap.gm);
  async function pbkdf2Hash(pw, salt, iter) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return C.b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256)));
  }
  async function askGmPassword(title) {
    const pw = await ask(title || "Пароль ГМа", "", { password: true, note: "Нужен, чтобы расшифровать данные стран." });
    return pw || null;
  }
  async function decryptAll() {
    dks = {}; gmData = {};
    for (const id in mech.countries) {
      const rec = mech.countries[id];
      try {
        dks[id] = await C.unlockWithKey(mk, rec.kg);
        gmData[id] = rec.data ? (await C.decJSON(dks[id], rec.data)).c : M.emptyCountry();
      } catch (e) { console.error("страна " + id, e); toast("Не удалось расшифровать страну " + countryName(id)); }
    }
    snapshotBase();
  }
  function snapshotBase() {
    gmBase = {};
    try { gmBase = M.computeAll(rules, gmData).results; } catch (e) { console.error(e); }
  }
  async function unlockGm() {
    if (!isGm()) return false;
    if (mk) return true;
    if (!C.ready()) { toast("Шифрование работает только по https"); return false; }
    if (!mech.gm) {
      // первый запуск: создаём мастер-ключ под паролем ГМа
      let pw = gmPw;
      if (!pw || (await pbkdf2Hash(pw, C.unb64(config.gm.salt), config.gm.iter)) !== config.gm.hash) {
        pw = await askGmPassword("Пароль ГМа для шифрования данных стран");
        if (!pw) return false;
        if ((await pbkdf2Hash(pw, C.unb64(config.gm.salt), config.gm.iter)) !== config.gm.hash) { toast("Неверный пароль"); return false; }
      }
      mk = C.newKey();
      mech.gm = await C.lockWithPassword(pw, mk);
      markDirty();
    } else {
      let ok = false;
      if (gmPw) { try { mk = await C.unlockWithPassword(gmPw, mech.gm); ok = true; } catch (e) { /* пароль сменили — спросим */ } }
      if (!ok) {
        const pw = await askGmPassword();
        if (!pw) return false;
        try { mk = await C.unlockWithPassword(pw, mech.gm); gmPw = pw; } catch (e) { toast("Неверный пароль ГМа"); return false; }
      }
    }
    try { sessionStorage.setItem(MK_KEY, C.b64(mk)); } catch (e) { /* */ }
    await decryptAll();
    await offerDraft();
    return true;
  }
  async function restoreGm() {
    if (!isGm() || !mech.gm) return;
    let s = null; try { s = sessionStorage.getItem(MK_KEY); } catch (e) { /* */ }
    if (!s) return;
    try {
      mk = C.unb64(s);
      const first = Object.values(mech.countries)[0];
      if (first) await C.unlockWithKey(mk, first.kg); // ключ из этой сессии ещё подходит?
      await decryptAll();
    } catch (e) { mk = null; }
  }
  function lockGm() {
    mk = null; dks = {}; gmData = {}; gmSel = null; gmDirty = false;
    try { sessionStorage.removeItem(MK_KEY); } catch (e) { /* */ }
    mech = clone(mechPub); rules = M.normalizeRules(mech.rules);
    fillArticleLists(); renderRef();
  }

  // черновик ГМа (в этом браузере)
  let draftTimer = null;
  function markDirty() {
    gmDirty = true;
    const dot = $("mechDirty"); if (dot) dot.classList.remove("hidden");
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: mechPub.updated, time: Date.now(), mech, gmData, rules })); } catch (e) { toast("Не удалось сохранить черновик в браузере"); }
    }, 800);
  }
  async function offerDraft() {
    let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { /* */ }
    if (!d) return;
    const note = "Черновик от " + new Date(d.time).toLocaleString("ru-RU") + (d.base === mechPub.updated ? "." : ". Он сделан для более старой версии данных: опубликованное с тех пор будет перезаписано.");
    const ok = await ask("Восстановить неопубликованный черновик механик?", "", { confirm: true, note });
    if (!ok) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ } return; }
    const gmBox = mech.gm; // пароль ГМа мог смениться после черновика — оставляем актуальную обёртку ключа
    mech = d.mech; mech.gm = gmBox || mech.gm; gmData = d.gmData; rules = M.normalizeRules(d.rules);
    // ключи стран из черновика: новые страны были созданы в нём
    for (const id in mech.countries) if (!dks[id]) { try { dks[id] = await C.unlockWithKey(mk, mech.countries[id].kg); } catch (e) { /* */ } }
    gmDirty = true; fillArticleLists();
    toast("Черновик восстановлен");
  }

  async function ensureToken() {
    if (GH.token()) return true;
    const t = await ask("Токен GitHub для публикации", "", { password: true, note: "Fine-grained token с правом Contents: Read and write только для репозитория " + config.repo.owner + "/" + config.repo.name + ". Хранится только в этом браузере." });
    if (!t) return false;
    GH.setToken(t);
    try { await GH.check(config.repo); toast("GitHub подключён"); return true; }
    catch (e) { GH.setToken(""); toast(e.message); return false; }
  }
  async function publish() {
    if (!mk) return;
    if (!(await ensureToken())) return;
    const btn = $("mechPublish"); if (btn) btn.disabled = true;
    try {
      const { results, ctx } = M.computeAll(rules, gmData);
      const out = clone(mech);
      out.rules = rules;
      out.updated = new Date().toISOString();
      for (const id in out.countries) {
        if (!gmData[id] || !dks[id]) continue;
        out.countries[id].data = await C.encJSON(dks[id], { c: gmData[id], world: ctx[id], turn: out.turn, year: out.year, at: out.updated });
        out.countries[id].pub = { inm: +results[id].inm.toFixed(2), rank: results[id].rank, econ: results[id].econ_level };
      }
      // публичный рейтинг корпораций: только место, выручка и число стран
      const cw = M.corpWorld(rules, results);
      out.corpPub = {};
      for (const id in cw) out.corpPub[id] = { rank: cw[id].rank, rev: +cw[id].rev.toFixed(1), grp: +cw[id].grp.toFixed(1), n: cw[id].n };
      await GH.commit(config.repo, [{ path: "data/mech.json", content: JSON.stringify(out) }], "Механики: правки ГМа " + new Date().toLocaleString("ru-RU"));
      mech = out; mechPub = clone(out);
      gmDirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ }
      snapshotBase();
      renderRef(); renderRating(); renderBlocs(); renderGm(); if (!player) renderMy();
      toast("Опубликовано. Игроки увидят изменения примерно через минуту.");
    } catch (e) { toast("Не удалось опубликовать: " + e.message); console.error(e); }
    finally { if (btn) btn.disabled = false; }
  }

  async function addCountry() {
    const free = Object.keys(mapCountries).filter(id => !mech.countries[id]).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    if (!free.length) { toast("Все страны карты уже подключены"); return; }
    const v = await window.KGForm("Подключить страну к механикам", [
      { key: "id", label: "Страна с карты", type: "select", options: free.map(id => [id, countryName(id)]) },
      { key: "tpl", label: "Начальные данные", type: "select", options: [["empty", "Пустые (заполнить вручную)"]].concat(M.SAMPLES.map((s, i) => [String(i), "Образец: " + s.profile + " (" + s.name + ")"])) },
      { key: "pw", label: "Пароль игрока", hint: "Сгенерирован автоматически, можно заменить. Его можно посмотреть позже." }
    ], { id: free[0], tpl: "0", pw: C.genPassword() }, v => (!v.pw || v.pw.length < 6 ? "Пароль не короче 6 символов" : ""));
    if (!v) return;
    const dk = C.newKey();
    mech.countries[v.id] = { kg: await C.lockWithKey(mk, dk), kp: await C.lockWithPassword(v.pw, dk), pw: await C.encText(mk, v.pw) };
    dks[v.id] = dk;
    gmData[v.id] = v.tpl === "empty" ? M.emptyCountry() : M.SAMPLES[+v.tpl].make();
    gmSel = v.id; gmView = "countries";
    markDirty(); renderGm();
    toast("Страна подключена. Опубликуйте, чтобы игрок смог войти.");
  }
  // импорт стран из файла: все страны подключаются сразу зашифрованными, пароли игроков генерируются
  function pickJson() {
    return new Promise(res => {
      const inp = h("input", { type: "file", accept: ".json,application/json" });
      inp.addEventListener("change", () => res(inp.files[0] || null));
      inp.click();
    });
  }
  async function importCountries() {
    const f = await pickJson();
    if (!f) return;
    let data;
    try { data = M.parseImport(JSON.parse(await f.text())); } catch (e) { toast("Не удалось прочитать файл: " + e.message); return; }
    const all = Object.keys(data.countries), ids = all.filter(id => mapCountries[id]);
    const have = ids.filter(id => mech.countries[id]), fresh = ids.filter(id => !mech.countries[id]);
    if (!ids.length) { toast("В файле нет стран с этой карты"); return; }
    const v = await window.KGForm("Импорт стран: " + f.name, [
      { key: "mode", label: "Уже подключённые страны", type: "select", options: [["skip", "Не трогать"], ["replace", "Заменить данные (пароли игроков сохраняются)"]],
        hint: "В файле стран: " + all.length + ". Новых: " + fresh.length + ", уже подключено: " + have.length + (all.length > ids.length ? ", нет на карте: " + (all.length - ids.length) : "") + ". Новым странам пароли создаются автоматически — их можно посмотреть в карточке страны." }
    ], { mode: "skip" });
    if (!v) return;
    // союзы из файла — в правила (если такого ещё нет)
    const B = rules.tables.bloc;
    for (const b of data.blocs) if (!B.some(x => x.id === b.id)) B.push({ id: String(b.id), name: String(b.name).slice(0, 120), kind: ["pol", "econ", "mil", "fac"].includes(b.kind) ? b.kind : "pol", desc: String(b.desc || "").slice(0, 500) });
    const blocIds = new Set(B.map(x => x.id));
    const todo = v.mode === "replace" ? ids : fresh;
    let n = 0;
    for (const id of todo) {
      const rec = data.countries[id], c = M.importCountry(rules, rec);
      c.blocs = (Array.isArray(rec.blocs) ? rec.blocs : []).map(String).filter(b => blocIds.has(b));
      if (!mech.countries[id]) {
        const pw = C.genPassword(), dk = C.newKey();
        mech.countries[id] = { kg: await C.lockWithKey(mk, dk), kp: await C.lockWithPassword(pw, dk), pw: await C.encText(mk, pw) };
        dks[id] = dk;
      } else if (gmData[id]) {
        // заметки, корпорации и собственные эффекты ГМа не трогаем; эффекты из прошлого импорта (imp_…) заменяются новыми
        c.notes = gmData[id].notes || ""; c.corp = gmData[id].corp || {};
        c.mods = (gmData[id].mods || []).filter(m => !String(m.id).startsWith("imp_")).concat(c.mods);
      }
      gmData[id] = c; n++;
      if (n % 10 === 0) toast("Импорт: " + n + " из " + todo.length + "…");
    }
    if (!n) { toast("Новых стран нет — ничего не изменено"); return; }
    gmSel = todo[0]; gmView = "countries";
    markDirty(); renderGm();
    toast("Импортировано стран: " + n + ". Проверьте и нажмите «Опубликовать».");
  }
  // корпорация: добавление (corp = null) и правка — из калькулятора, рейтинга и лора
  async function editCorp(corp, fromCalc) {
    if (!mk) { toast("Сначала расшифруйте калькулятор паролем ГМа"); return; }
    const R = rules, isNew = !corp;
    const v = await window.KGForm(isNew ? "Новая корпорация" : "Корпорация: " + corp.name, [
      { key: "name", label: "Название" },
      { key: "sector", label: "Отрасль", type: "select", options: R.tables.csector.map(s => [s.id, s.name]) },
      { key: "parent", label: "Входит в", type: "select", options: [["", "— самостоятельная —"]].concat(R.tables.corp.filter(s => !corp || s.id !== corp.id).map(s => [s.id, s.name])) },
      { key: "hq", label: "Штаб-квартира" },
      { key: "scale", label: "Масштаб", type: "number", step: "any", hint: "0,3 — региональная, 1 — транснациональная, 1,5 и выше — мегакорпорация" },
      { key: "cap", label: "Капитализация, млрд кр.", type: "number", step: "any" },
      { key: "desc", label: "Описание (для лора и рейтинга)", type: "textarea" }
    ], isNew ? { name: "", sector: (R.tables.csector[0] || {}).id || "", parent: "", hq: "", scale: 1, cap: 500, desc: "" }
      : { name: corp.name || "", sector: corp.sector || "", parent: corp.parent || "", hq: corp.hq || "", scale: corp.scale, cap: corp.cap || 0, desc: corp.desc || "" },
    v => (!String(v.name || "").trim() ? "Введите название" : !(+v.scale > 0) ? "Масштаб больше нуля" : ""));
    if (!v) return;
    const vals = { name: String(v.name).trim(), sector: v.sector, parent: v.parent, hq: v.hq || "", scale: +v.scale, cap: +v.cap || 0, desc: v.desc || "" };
    if (isNew) { corp = Object.assign({ id: uid("corp_") }, vals); R.tables.corp.push(corp); }
    else Object.assign(corp, vals);
    if (fromCalc || isNew) gmCorpSel = corp.id;
    if (fromCalc) gmView = "corps";
    markDirty(); refreshMechViews();
    toast(isNew ? "Корпорация добавлена. Присутствие в странах задайте в калькуляторе («Корпорации»), затем опубликуйте." : "Сохранено в черновик калькулятора. Не забудьте опубликовать.");
  }
  function addCorp() { return editCorp(null, true); }
  async function deleteCorp(corp) {
    if (!mk) return;
    const ok = await ask("Удалить корпорацию «" + corp.name + "»?", "", { confirm: true, note: "Её присутствие в странах и договоры с союзами тоже удалятся. Изменение попадёт в черновик калькулятора." });
    if (!ok) return;
    const T = rules.tables, id = corp.id, i = T.corp.indexOf(corp);
    if (i >= 0) T.corp.splice(i, 1);
    T.corp.forEach(x => { if (x.parent === id) x.parent = ""; });
    T.cdeal = T.cdeal.filter(d => d.corp !== id);
    for (const cid in gmData) if (gmData[cid].corp) delete gmData[cid].corp[id];
    if (gmCorpSel === id) gmCorpSel = null;
    markDirty(); refreshMechViews();
    toast("Корпорация удалена из черновика");
  }
  async function renameSector(s) {
    if (!mk) return;
    const v = await ask("Название отрасли", s.name);
    if (!v || !v.trim() || v.trim() === s.name) return;
    s.name = v.trim();
    markDirty(); refreshMechViews();
  }
  async function addSector() {
    if (!mk) return;
    const v = await ask("Новая отрасль", "", { note: "Эффекты отрасли (ВВП, ПМ, военная мощь и др.) задаются в Справочнике, таблица «Отрасли корпораций»." });
    if (!v || !v.trim()) return;
    const row = { id: uid("csector_") };
    for (const [f, , type] of M.TABLES.csector.fields) row[f] = type === "num" ? 0 : "";
    row.name = v.trim(); row.infl = 1;
    rules.tables.csector.push(row);
    markDirty(); refreshMechViews();
  }
  async function showPassword(id) {
    try {
      const pw = await C.decText(mk, mech.countries[id].pw);
      await ask("Пароль игрока: " + countryName(id), pw, { note: "Скопируйте и передайте игроку лично." });
    } catch (e) { toast("Не удалось расшифровать пароль"); }
  }
  async function changePassword(id) {
    const pw = await ask("Новый пароль игрока: " + countryName(id), C.genPassword(), { note: "Старый пароль перестанет работать после публикации." });
    if (!pw) return;
    if (pw.length < 6) { toast("Пароль слишком короткий"); return; }
    mech.countries[id].kp = await C.lockWithPassword(pw, dks[id]);
    mech.countries[id].pw = await C.encText(mk, pw);
    markDirty(); toast("Пароль изменён. Опубликуйте, чтобы он заработал.");
  }
  async function removeCountry(id) {
    const ok = await ask("Отключить «" + countryName(id) + "» от механик?", "", { confirm: true, note: "Все данные страны будут удалены после публикации. Ctrl+Z здесь не работает." });
    if (!ok) return;
    delete mech.countries[id]; delete gmData[id]; delete dks[id];
    if (gmSel === id) gmSel = null;
    markDirty(); renderGm();
  }
  async function nextTurn() {
    const ids = Object.keys(gmData);
    if (!ids.length) return;
    const { results } = M.computeAll(rules, gmData);
    const losses = ids.filter(id => results[id].sat_loss > 0).map(id => countryName(id) + ": " + results[id].sat_loss);
    // мусор: ожидаемые потери дробные — ГМ решает, кого задело (≥ 0,5 — скорее да)
    const debris = ids.filter(id => results[id].debris_loss >= 0.3).map(id => countryName(id) + " ≈ " + fmt(results[id].debris_loss, "d1"));
    if (debris.length) losses.push("от мусора: " + debris.join(", "));
    const ok = await ask("Перейти к ходу " + (mech.turn + 1) + "?", "", { confirm: true,
      note: "У всех стран технологии, стабильность и население примут прогнозные значения." + (losses.length ? " Не забудьте убрать спутники, сошедшие с орбиты (" + losses.join("; ") + ")." : "") });
    if (!ok) return;
    for (const id of ids) {
      const c = gmData[id], r = results[id];
      c.in.tech = +r.next_tech.toFixed(3);
      c.in.stability = +r.next_stab.toFixed(1);
      c.in.pop_meg = +((+c.in.pop_meg || 0) * (1 + r.d_pop)).toFixed(3);
      c.in.pop_waste = +((+c.in.pop_waste || 0) * (1 + r.d_pop)).toFixed(3);
    }
    mech.turn++; mech.year++;
    markDirty(); renderGm();
    toast("Ход " + mech.turn + ". Опубликуйте, чтобы игроки увидели.");
  }
  async function editTurn() {
    const v = await window.KGForm("Ход и год", [{ key: "turn", label: "Номер хода", type: "number", min: 1 }, { key: "year", label: "Год", type: "number" }], { turn: mech.turn, year: mech.year });
    if (!v) return;
    mech.turn = +v.turn || 1; mech.year = +v.year || 2200; markDirty(); renderGm();
  }

  // ГМ: корпорации по всем странам
  let gmCorpSel = null;
  function gmCorps() {
    const wrap = h("div", { class: "gm-corps" });
    const corps = rules.tables.corp;
    wrap.append(h("p", { class: "mech-note", text: "Корпорации транснациональны: ими не управляет ни один игрок. Здесь видна империя корпорации по всем подключённым странам; присутствие, отношения и анклавы правятся прямо в таблице (те же поля есть в карточке страны). Отрасли, масштаб, союзы и договоры с союзами — в «Правилах»." }));
    if (!corps.length) { wrap.append(h("p", { class: "empty", text: "Корпораций нет. Добавьте их в «Правилах»." })); return wrap; }
    if (!gmCorpSel || !corpById(gmCorpSel)) gmCorpSel = corps[0].id;
    const ids = Object.keys(gmData).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    let all = M.computeAll(rules, gmData), cw = M.corpWorld(rules, all.results);
    const lives = [];
    const live = (fn, tag, cls) => { const e = h(tag || "span", { class: cls || "" }); lives.push({ e, fn }); fn(e); return e; };
    const refresh = () => { all = M.computeAll(rules, gmData); cw = M.corpWorld(rules, all.results); lives.forEach(L => L.fn(L.e)); };
    const isChild = x => x.parent && corpById(x.parent) && x.parent !== x.id;

    const list = h("aside", { class: "gm-list corp-list" });
    for (const x of corps) list.append(h("button", { class: "corp-btn" + (x.id === gmCorpSel ? " active" : "") + (isChild(x) ? " child" : ""), onclick: () => { gmCorpSel = x.id; renderGm(); } },
      h("span", { class: "nm", text: x.name }), live(e => { const o = cw[x.id]; e.textContent = sectorName(x.sector) + " · " + (o.n ? o.n + " стр. · " + fmt(o.rev, "d1") + " млрд" : "нет присутствия"); }, "small")));

    const corp = corpById(gmCorpSel), o = () => cw[corp.id];
    const parent = isChild(corp) ? corpById(corp.parent) : null, children = corps.filter(x => x.parent === corp.id && x.id !== corp.id);
    const main = h("div", { class: "gm-main" });
    main.append(h("div", { class: "cv-head" }, h("div", { class: "cv-title" }, h("h2", { text: corp.name }),
      h("span", { class: "mech-note", text: M.corpClass(corp.scale) + " · " + sectorName(corp.sector) + " · масштаб " + fmt(+corp.scale, "d1") + (corp.hq ? " · " + corp.hq : "") + (+corp.cap ? " · капитализация " + fmt(+corp.cap, "int") + " млрд кр." : "") }))));
    if (corp.desc) main.append(h("p", { class: "corp-desc", text: corp.desc }));
    const kpi = (label, fn, sub) => h("div", { class: "kpi" }, h("span", { class: "kl", text: label }), live(e => { e.textContent = fn(); }, "span", "kv"), sub ? live(e => { e.textContent = sub(); }, "span", "ks") : null);
    main.append(h("div", { class: "kpis" },
      kpi("Страны присутствия", () => String(o().n), () => "из " + ids.length + " подключённых"),
      kpi("Выручка, млрд кр./ход", () => fmt(o().rev, "d1"), () => (children.length ? "вся группа: " + fmt(o().grp, "d1") : "место " + o().rank + " в мире")),
      kpi("Средние отношения", () => signed(o().rel, "d1"), () => (o().hostile.length ? "враждебна: " + o().hostile.map(countryName).join(", ") : "")),
      kpi("Государство в государстве", () => String(o().sis.length), () => o().sis.map(countryName).join(", ")),
      kpi("Анклавы", () => fmt(o().enc, "int"))));
    if (parent || children.length) {
      const g = parent || corp, members = [g].concat(corps.filter(x => x.parent === g.id && x.id !== g.id));
      main.append(h("section", { class: "mblock" }, h("h3", { text: "Группа «" + g.name + "»" }), live(e => {
        e.innerHTML = "";
        e.append(h("ul", { class: "bloc-view" }, members.map(m => h("li", null, h("button", { class: "linkish", text: m.name, onclick: () => { gmCorpSel = m.id; renderGm(); } }),
          " — " + sectorName(m.sector) + ", выручка " + fmt(cw[m.id].rev, "d1") + " млрд, " + cw[m.id].n + " стр."))),
          h("p", { class: "hint", text: "Влияние дочерних корпораций складывается с материнской: «государство в государстве» считается по всей группе." }));
      }, "div")));
    }

    // страны
    const sec = h("section", { class: "mblock" }, h("h3", { text: "По странам" }));
    if (!ids.length) sec.append(h("p", { class: "empty", text: "Нет подключённых стран." }));
    else {
      const rowOf = id => (all.results[id].corp_rows || []).find(x => x.id === corp.id) || {};
      const tbl = h("table", { class: "mt units corp-t" }, h("thead", null, h("tr", null, h("th", { text: "Страна" }), h("th", { class: "num", text: "Присутствие 0–10" }), h("th", { class: "num", text: "Отношения ±100" }),
        h("th", { class: "num", text: "Анклавы" }), h("th", { class: "num", text: "Вес" }), h("th", { class: "num", text: "Влияние" }), h("th", { class: "num", text: "Доля ВВП" }), h("th", { class: "num", text: "Выручка" }),
        h("th", { class: "num", text: "Суверенитет страны" }), h("th", { text: "Положение" }))));
      const body = h("tbody");
      for (const id of ids) {
        const c = gmData[id]; c.corp = c.corp || {};
        const field = (f, mn, mx, step) => {
          const cur = c.corp[corp.id] || {};
          const inp = h("input", { type: "number", class: "num", min: mn, max: mx, step, placeholder: "0", value: cur[f] == null ? "" : cur[f] });
          if (f !== "enc") live(() => { const x = rowOf(id); inp.placeholder = x.via ? fmt(x[f], f === "rel" ? "int" : "d1") + " (союз)" : "0"; });
          inp.addEventListener("input", () => {
            if (inp.value !== "" && !isFinite(+inp.value)) return;
            const o2 = c.corp[corp.id] = c.corp[corp.id] || {};
            if (inp.value === "") delete o2[f]; else o2[f] = Math.max(mn, Math.min(mx, +inp.value));
            if (!Object.keys(o2).length) delete c.corp[corp.id];
            markDirty(); refresh();
          });
          return inp;
        };
        const cell = fn => h("td", { class: "num" }, live(e => { e.textContent = fn(rowOf(id), all.results[id]); }));
        const tr = h("tr", null, h("td", null, flagEl(id), " ", countryName(id)),
          h("td", { class: "num" }, field("pres", 0, 10, "any")), h("td", { class: "num" }, field("rel", -100, 100, 1)), h("td", { class: "num" }, field("enc", 0, 100, 1)),
          cell(x => (x.W ? fmt(x.W, "d1") : "·")), cell(x => (x.infl ? fmt(x.infl, "d1") : "·")), cell(x => (x.share ? fmt(x.share, "pct") : "·")), cell(x => (x.rev ? fmt(x.rev, "d1") : "·")),
          cell((x, r) => fmt(r.sovereignty, "d1")),
          h("td", { class: "tag" }, live(e => { const x = rowOf(id); e.textContent = x.status + (x.via ? " · по договору: " + x.via : ""); e.className = x.sis ? "sis" : x.rel < 0 && x.W > 0 ? "hostile" : ""; })));
        live(() => { const x = rowOf(id); tr.classList.toggle("zero", !(x.W > 0 || x.enc > 0)); });
        body.append(tr);
      }
      tbl.append(body);
      sec.append(h("div", { class: "mt-scroll" }, tbl));
    }
    main.append(sec);

    // договоры с союзами
    const deals = rules.tables.cdeal.filter(d => d.corp === corp.id);
    main.append(h("section", { class: "mblock" }, h("h3", { text: "Договоры с союзами" }), deals.length ? h("ul", { class: "bloc-view" }, deals.map(d => {
      const b = rules.tables.bloc.find(x => x.id === d.bloc), mem = ids.filter(id => M.blocsOf(rules, gmData[id], id).includes(d.bloc));
      return h("li", null, h("b", { text: b ? b.name : "союз удалён" }), ": присутствие " + fmt(+d.pres, "d1") + ", отношения " + signed(+d.rel, "int") + (d.note ? ". " + d.note : "") +
        " · члены: " + (mem.length ? mem.map(countryName).join(", ") : "нет"));
    })) : h("p", { class: "empty", text: "Договоров нет. Их заключают в «Правилах», таблица «Договоры корпораций с союзами»." })));

    // мировой рейтинг
    const rank = h("section", { class: "mblock" }, h("h3", { text: "Рейтинг корпораций" }), live(e => {
      e.innerHTML = "";
      const ord = corps.slice().sort((a, b) => cw[a.id].rank - cw[b.id].rank);
      e.append(h("div", { class: "mt-scroll" }, h("table", { class: "mt" }, h("thead", null, h("tr", null, h("th", { text: "Место" }), h("th", { text: "Корпорация" }), h("th", { text: "Отрасль" }), h("th", { class: "num", text: "Выручка" }), h("th", { class: "num", text: "Стран" }), h("th", { class: "num", text: "Гос. в гос." }))),
        h("tbody", null, ord.map(x => h("tr", { class: cw[x.id].n ? "" : "zero" }, h("td", { class: "num", text: String(cw[x.id].rank) }), h("td", { text: x.name }), h("td", { class: "tag", text: sectorName(x.sector) }),
          h("td", { class: "num", text: fmt(cw[x.id].rev, "d1") }), h("td", { class: "num", text: String(cw[x.id].n) }), h("td", { class: "num", text: String(cw[x.id].sis.length) })))))));
    }, "div"));
    main.append(rank);
    wrap.append(h("div", { class: "gm-grid" }, list, main));
    return wrap;
  }

  function renderGm() {
    const box = $("mechGM");
    if (!box || !mech) return;
    box.innerHTML = "";
    if (!isGm()) return; // калькулятор — вкладка Вики → Механики → «Калькулятор», только ГМу
    if (!mk) {
      box.append(h("div", { class: "login-box" }, h("h2", { text: "Данные стран зашифрованы" }),
        h("p", { class: "mech-note", text: "Чтобы открыть калькулятор, расшифруйте данные паролем ГМа." }),
        h("button", { class: "accent", text: "Расшифровать", onclick: async () => { if (await unlockGm()) renderGm(); } })));
      return;
    }
    const top = h("div", { class: "gm-top" },
      h("button", { class: "turn", title: "Изменить ход и год", text: "Ход " + mech.turn + " · " + mech.year + " год", onclick: editTurn }),
      h("button", { class: gmView === "countries" ? "active" : "", text: "Страны", onclick: () => { gmView = "countries"; renderGm(); } }),
      h("button", { class: gmView === "corps" ? "active" : "", text: "Корпорации", onclick: () => { gmView = "corps"; renderGm(); } }),
      h("button", { class: gmView === "rules" ? "active" : "", text: "Правила", onclick: () => { gmView = "rules"; renderGm(); } }),
      h("span", { class: "sp" }),
      h("button", { text: "+ Страна", onclick: addCountry }),
      h("button", { text: "+ Корпорация", onclick: addCorp }),
      h("button", { text: "Импорт стран", title: "Подключить страны из файла стартовых данных (например, Страны_2200.json из папки D:/WorkWPG)", onclick: importCountries }),
      h("button", { text: "Следующий ход", onclick: nextTurn }),
      h("span", { class: "gm-dirty" + (gmDirty ? "" : " hidden"), id: "mechDirty", title: "Есть неопубликованные правки", text: "●" }),
      h("button", { class: "accent", id: "mechPublish", text: "Опубликовать", onclick: publish }));
    box.append(top);
    if (gmView === "rules") {
      box.append(h("p", { class: "mech-note", text: "Правила общие для всех стран и видны всем во вкладке «Справочник». Новый тип юнита сразу появляется у всех стран с количеством 0." }),
        rulesView(true, () => { markDirty(); }, renderGm));
      return;
    }
    if (gmView === "corps") { box.append(gmCorps()); return; }
    const ids = Object.keys(gmData).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    if (gmSel && !gmData[gmSel]) gmSel = null;
    if (!gmSel && ids.length) gmSel = ids[0];
    const { results, ctx } = M.computeAll(rules, gmData);
    const list = h("aside", { class: "gm-list" });
    if (!ids.length) list.append(h("p", { class: "empty", text: "Нет стран. Нажмите «+ Страна»." }));
    for (const id of ids) {
      list.append(h("button", { class: id === gmSel ? "active" : "", onclick: () => { gmSel = id; renderGm(); } }, flagEl(id), h("span", { class: "nm", text: countryName(id) }),
        h("small", { text: "#" + results[id].rank + " · ИНМ " + fmt(results[id].inm, "d1") + (mech.countries[id].data ? "" : " · не опубл.") })));
    }
    const main = h("div", { class: "gm-main" });
    if (gmSel) {
      const id = gmSel;
      main.append(h("div", { class: "cv-head" }, flagEl(id, "big"), h("div", { class: "cv-title" }, h("h2", { text: countryName(id) }),
        h("span", { class: "mech-note", text: "Правки сразу пересчитываются. ▲▼ — изменение с последней публикации." })),
        h("div", { class: "cv-btns" },
          h("button", { text: "Пароль игрока", onclick: () => showPassword(id) }),
          h("button", { text: "Сменить пароль", onclick: () => changePassword(id) }),
          h("button", { class: "danger", text: "Отключить", onclick: () => removeCountry(id) }))));
      main.append(countryView({ id, c: gmData[id], world: ctx[id], editable: true, gm: true, base: gmBase[id] || null, onChange: () => markDirty() }));
    }
    box.append(h("div", { class: "gm-grid" }, list, main));
  }

  // ---------- связь с режимом ГМа карты ----------
  window.addEventListener("gmchange", async e => {
    if (!inited) return;
    await loading;
    if (!e.detail) { lockGm(); renderRating(); }
    else if (!mk && gmPw && mech.gm) await unlockGm(); // только что вошёл паролем — расшифровываем сразу
    else if (!mk) await restoreGm(); // вход сохранён в этой вкладке браузера
    renderGm(); renderBlocs(); renderHomeAuth();
    // вышел из режима ГМа, стоя на калькуляторе, — уводим на статью
    if (!e.detail && pane === "calc" && !$("wikiMech").classList.contains("hidden")) window.KG.go("wiki/mech/article", true);
    // вход ГМа восстановился уже после открытия адреса #wiki/mech/calc — показываем калькулятор
    if (e.detail && /^#wiki\/mech\/calc/.test(location.hash)) openPane("calc");
  });
  // «✎ Правка» включена или выключена — справочник, рейтинг и лор корпораций переключаются между чтением и правкой
  window.addEventListener("siteedit", async () => {
    if (!inited) return;
    await loading;
    refreshMechViews();
  });
  window.addEventListener("beforeunload", e => { if (mk && gmDirty) { e.preventDefault(); e.returnValue = ""; } });

  // смена пароля ГМа: перешифровать мастер-ключ. Возвращает файлы для того же коммита или null (отмена).
  async function rewrapGm(newPw) {
    if (!inited) await init(); else await loading;
    gmPw = newPw;
    if (!mechPub) return [];
    if (!mechPub.gm) { // мастер-ключ создан в этой сессии и ещё не опубликован
      if (mech && mech.gm && mk) mech.gm = await C.lockWithPassword(newPw, mk);
      return [];
    }
    if (!mk) {
      const old = await askGmPassword("Текущий пароль ГМа (для перешифровки данных стран)");
      if (!old) return null;
      try { mk = await C.unlockWithPassword(old, mechPub.gm); } catch (e) { toast("Неверный текущий пароль"); return null; }
    }
    const box = await C.lockWithPassword(newPw, mk);
    mechPub.gm = box; if (mech) mech.gm = box;
    return [{ path: "data/mech.json", content: JSON.stringify(mechPub) }];
  }

  window.KGMech = {
    gmPassword(pw) { gmPw = pw; },
    rewrapGm,
    renderCorpLore,
    renderIdeoLore,
    open: () => { window.KG.go("wiki/mech"); init(); },
    ready: () => init(),
    refreshArticle: () => fillArticleLists(),
    countryView: o => countryView(o), // для автотестов: карточка страны без входа
    get turn() { return mech ? { turn: mech.turn, year: mech.year } : null; },
    get rules() { return rules; },
    corpLabel: id => groupName(id),
    get model() { return M; }
  };
})();
