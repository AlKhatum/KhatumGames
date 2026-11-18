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
  let config = null, mech = null, mechPub = null, mapCountries = {}, mapCurrencies = {};
  let rules = M.defaultRules();
  // ГМ
  let mk = null, gmPw = null, dks = {}, gmData = {}, gmSel = null, gmView = "countries", gmDirty = false, gmBase = {}, gmLinks = [];
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
    const r = await fetch(url, { cache: "no-cache" }); // проверка по ETag: неизменный файл берётся из кэша
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
    mech = mj || { v: 1, updated: null, turn: 1, year: 2200, turn_months: M.TURN_MONTHS, rules: null, gm: null, countries: {} };
    mech.countries = mech.countries || {};
    mechPub = clone(mech);
    rules = pubRules(mech);
    mapCountries = (mp && mp.countries) || {};
    M.setMap(mapCountries, (mp && mp.alliances) || {}); // союзы карты = союзы механик
    syncCityPop(mp);
  }
  // население стран — из городов карты (страна города — по растру карты, без него — поле cc города)
  function syncCityPop(mp) {
    const KM = window.KGMap, own = KM && KM.cityOwner && KM.state && KM.state === mp ? KM.cityOwner : null;
    mapCurrencies = (mp && mp.currencies) || {};
    M.setCityPop(M.cityPopOf((mp && mp.cities) || {}, own));
  }
  // ГМ поправил город, границу, долю пустошей или валюту на карте — пересчитываем открытые карточки
  window.addEventListener("kg:cities", () => {
    const KM = window.KGMap;
    if (!mech || !KM || !KM.state) return;
    mapCountries = KM.state.countries || mapCountries;
    M.setMap(mapCountries, KM.state.alliances || {});
    syncCityPop(KM.state);
    if (pane === "calc" && isGm()) renderGm();
    if (pane === "my") renderMy();
    if (pane === "rating") renderRating();
  });
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
  // данные нужны и Главной (вход), и Вики — грузим сразу. Если сайт открыт на карте — после её показа:
  // большой mech.json иначе отнимает канал у map.json и растров, и карта появляется заметно позже.
  if (/^#map(\/|$)/.test(location.hash) && window.KGMap && window.KGMap.ready) {
    Promise.race([window.KGMap.ready(), new Promise(r => setTimeout(r, 15000))]).then(init);
    window.addEventListener("routechange", e => { if (e.detail.tab !== "map") init(); });
  } else init();

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
        h("p", { class: "unit-desc", "data-rule-desc": tb + ":" + r.id, "data-placeholder": "Описание…", text: r.desc || "" })));
    });
    // чудеса: владелец, эффекты, описание. Чудо выдаёт ГМ за сюжет; пока не выдано, игрок видит «Данные недоступны»
    const wl = document.querySelector('[data-mech-list="wonder"]');
    if (wl) {
      wl.innerHTML = "";
      const tName = k => (M.MOD_TARGETS.find(x => x[0] === k) || [, k])[1];
      const fx = (k, v) => k && +v ? tName(k) + " " + (+v > 0 ? "+" : "−") + String(Math.abs(+v)).replace(".", ",") + (M.wonderMode(k) === "add" ? " за ход" : "%") : "";
      for (const w of rules.tables.wonder) {
        const open = !!w.owner || isGm(), eff = [fx(w.t1, w.v1), fx(w.t2, w.v2)].filter(Boolean).join(" · ");
        wl.append(h("article", { class: "unit-card wonder-card" + (w.owner ? "" : " locked"), "data-wonder": w.id },
          slot("mech.wonder." + w.id, w.name), h("h4", { text: w.name }),
          h("div", { class: "unit-stats" + (open ? "" : " na"), text: open ? eff || "Эффектов нет" : "Эффекты: данные недоступны",
            title: open && !w.owner ? "Чудо не выдано: эффекты видит только ГМ" : null }),
          h("div", { class: "wonder-owner" + (w.owner ? "" : " none"), text: w.owner ? "Владелец: " + countryName(w.owner) : "Не выдано" }),
          h("p", { class: "unit-desc", "data-rule-desc": "wonder:" + w.id, "data-placeholder": "Данные недоступны", text: w.desc || "" })));
      }
    }
    // словарь показателей: запись летописи → строки калькулятора
    const pl = document.querySelector('[data-mech-list="params"]'), L = window.KGMechLore;
    if (pl && L) {
      pl.innerHTML = "";
      const groups = new Map();
      for (const k in L.params) { const x = L.params[k], g = x.name || (M.INPUTS[k] || M.OUT[k] || [k])[0]; if (!groups.has(g)) groups.set(g, { text: x.text, keys: [] }); groups.get(g).keys.push(k); }
      // название и описание правит ГМ («✎ Правка», публикация «⇪ Сайт»): site.json → texts["mech.param.<ключ>(.name)"]
      for (const [g, x] of groups) pl.append(h("div", { class: "param-row", "data-param": x.keys[0] },
        h("div", { class: "pt", "data-edit-text": "mech.param." + x.keys[0] + ".name", "data-label": "Словарь: " + g, text: g }),
        h("div", { class: "pd" }, h("span", { "data-edit-text": "mech.param." + x.keys[0], "data-placeholder": "Описание…", text: x.text }),
          h("small", { text: "В калькуляторе: " + x.keys.map(k => (M.INPUTS[k] || M.OUT[k])[0]).join(", ") }))));
    }
    // справочные записи: ресурсы, здания, законы (в расчётах пока не участвуют); описание правит ГМ, как тексты страницы
    document.querySelectorAll('[data-mech-list="ref"]').forEach(el => {
      el.innerHTML = "";
      const names = String(el.dataset.names || "").split("|");
      for (const n of names) { const x = L && L.reference[n]; if (x) el.append(h("div", { class: "param-row", "data-ref": n }, h("div", { class: "pt" }, n, h("small", { text: x.unit })),
        h("div", { class: "pd", "data-edit-text": "mech.ref." + n, "data-placeholder": "Описание…", text: x.text }))); }
    });
    // правки ГМа к текстам словаря и справочных записей; описания карточек — из правил
    document.querySelectorAll('[data-mech-list="params"], [data-mech-list="ref"]').forEach(el => { if (window.KGSite && window.KGSite.applyTexts) window.KGSite.applyTexts(el); });
    markRuleDescs();
  }
  // описание показателя для подсказки: правка ГМа из словаря (site.json → texts["mech.param.<первый ключ группы>"]) или летопись
  function paramText(key) {
    const L = window.KGMechLore, x = L && L.params[key];
    if (!x) return null;
    const g = x.name || (M.INPUTS[key] || M.OUT[key] || [key])[0];
    const first = Object.keys(L.params).find(k => (L.params[k].name || (M.INPUTS[k] || M.OUT[k] || [k])[0]) === g) || key;
    const t = window.KGSite && window.KGSite.data && window.KGSite.data.texts;
    return (t && t["mech.param." + first] != null ? t["mech.param." + first] : x.text);
  }
  // ---------- описания карточек статьи (типы войск, техники, энергии, еды, отраслей, чудеса) ----------
  // это поле «Описание» из Справочника: правится на месте после расшифровки калькулятора, попадает в его черновик
  function ruleRow(ref) {
    const [tb, id] = String(ref).split(":");
    return (rules.tables[tb] || []).find(r => String(r.id) === id) || null;
  }
  function markRuleDescs() {
    const edit = pageEdit(), can = canEditRules();
    document.querySelectorAll("[data-rule-desc]").forEach(el => {
      if (can) el.setAttribute("contenteditable", "true"); else el.removeAttribute("contenteditable");
      el.classList.toggle("editable", can);
      el.title = can ? "Описание из Справочника: правка попадёт в черновик калькулятора, на сайт — кнопкой «Опубликовать» в калькуляторе"
        : edit ? "Описание из Справочника: правится после расшифровки калькулятора паролем ГМа" : "";
    });
  }
  let ruleDescTouched = false;
  document.addEventListener("input", e => {
    const el = e.target.closest && e.target.closest("[data-rule-desc]");
    if (!el || !canEditRules()) return;
    const r = ruleRow(el.dataset.ruleDesc); if (!r) return;
    r.desc = el.textContent.replace(/\s*\n\s*/g, " ");
    ruleDescTouched = true;
    markDirty();
  });
  document.addEventListener("keydown", e => {
    const el = e.target.closest && e.target.closest("[data-rule-desc]");
    if (el && el.isContentEditable && e.key === "Enter") { e.preventDefault(); el.blur(); }
  }, true);
  document.addEventListener("paste", e => {
    const el = e.target.closest && e.target.closest("[data-rule-desc]");
    if (!el || !el.isContentEditable) return;
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  }, true);
  document.addEventListener("focusout", e => {
    if (!ruleDescTouched || !(e.target.closest && e.target.closest("[data-rule-desc]"))) return;
    ruleDescTouched = false;
    renderRef(); // Справочник показывает то же описание
  });
  // строка характеристик карточки типа (числа — из действующего справочника)
  const n2 = v => fmt(+v, Math.abs(+v) < 1 && +v !== 0 ? "d3" : "d2").replace(/,?0+$/, "");
  const UNIT_STATS = {
    div: r => "Л/с " + n2(r.pers) + " тыс. · мощь " + n2(r.power) + " · содержание " + n2(r.upkeep) + " млрд/год · постройка " + n2(r.cost) + " ОВП",
    ac: r => "Мощь " + n2(r.power) + " · содержание " + n2(r.upkeep) + " млрд/год · постройка " + n2(r.cost) + " ОВП" + (+r.wh ? " · боеголовок " + n2(r.wh) : ""),
    ship: r => "Экипаж " + n2(r.pers) + " тыс. · мощь " + n2(r.power) + " · " + n2(r.ton) + " тыс. т · постройка " + n2(r.cost) + " ОВП" + (+r.wh ? " · боеголовок " + n2(r.wh) : ""),
    sat: r => "Запуск " + n2(r.cost) + " млрд кр. · содержание " + n2(r.upkeep) + " млрд/год",
    energy: () => "", food: r => String(r.weather) === "1" ? "Зависит от климата и радиации" : "Не зависит от погоды",
    industry: r => (M.TABLES.industry.fields[1][3].find(o => o[0] === r.role) || [, ""])[1]
  };

  // ---------- справочник ----------
  // варианты выбора: список или функция от правил (отрасли, корпорации, союзы)
  const optsOf = o => (typeof o === "function" ? o(rules) : o) || [];
  const STRUCT_TABLES = ["csector", "corp", "bloc", "owbloc", "afbloc", "aftrack", "nabloc", "naland", "drbloc", "drland", "drfac", "sbbloc", "sbland", "sbfac",
    "tgbloc", "tgland", "tgfac", "mebloc", "metrack"]; // на них ссылаются другие таблицы
  function rulesView(editable, onChange, rerender) {
    const root = h("div", { class: "rules" });
    const changed = () => { fillArticleLists(); if (onChange) onChange(); };
    const order = ["div", "ac", "ship", "sat", "industry", "energy", "food", "law", "tier", "wonder", "ideo", "csector", "corp", "bloc", "bkind", "cdeal"]
      .concat(...M.REGIONS.map(d => ["bloc", "land", "fac", "loy", "res", "track", "tland"].map(x => d.p + x).filter(t => M.TABLES[t])));
    for (const t of order) {
      const meta = M.TABLES[t], rows = rules.tables[t];
      if (!editable && !rows.length) continue;
      const restruct = () => { if (rerender && STRUCT_TABLES.includes(t)) rerender(); };
      const sec = h("section", { class: "mblock" + (t === "csector" ? " corp-first" : "") }, t === "csector" ? h("h2", { text: "Корпорации и союзы" }) : M.REGIONS.some(d => t === d.p + "bloc") ? h("h2", { text: M.REGIONS.find(d => t === d.p + "bloc").title }) : null, h("h3", { text: meta.title }), meta.note ? h("p", { class: "mech-note", text: meta.note }) : null);
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
            if (!editable && t === "wonder" && (f === "desc" ? !row.desc : /^[tv][12]$/.test(f) && !row.owner && !isGm())) {
              cell = h("td", { class: "na" + (f === "desc" ? " desc" : ""), text: f === "desc" || f === "t1" ? "Данные недоступны" : "—" });
            } else if (!editable) {
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
        for (const [f, , type, opts] of meta.fields) row[f] = type === "num" ? 0 : type === "sel" ? ((optsOf(opts)[0] || [""])[0]) : (f === "name" ? (t === "corp" ? "Новая корпорация" : t === "bloc" ? "Новый союз" : t === "ideo" ? "Новая идеология" : /res$/.test(t) && M.REGIONS.some(d => t === d.p + "res") ? "Новая резолюция" : /track$/.test(t) ? "Новый трек" : /fac$/.test(t) && M.REGIONS.some(d => t === d.p + "fac") ? "Новая сила" : "Новый тип") : "");
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
    renderRef(); renderRating(); renderBlocs(); renderGm(); markRuleDescs();
    if (corpLoreEl && corpLoreEl.isConnected) Promise.resolve(renderCorpLore(corpLoreEl)).then(() => { if (window.KGSite) window.KGSite.applyTexts(corpLoreEl); });
    for (const rid in rgLoreEls) if (rgLoreEls[rid].isConnected) Promise.resolve(renderRegion(rgLoreEls[rid], rid)).then(() => { if (window.KGSite) window.KGSite.applyTexts(rgLoreEls[rid]); });
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
    const rgReps = M.REGIONS.map(d => rgReportNow(d.id));
    box.append(h("p", { class: "mech-note ow-link" }, "Угроза союзов, договоры и резолюции регионов — в разделах ",
      rgReps.map((r, i) => [i ? ", " : "", h("button", { class: "linkish", text: "Лор → Регионы → " + r.def.page, onclick: () => window.KG.go(RG_ROUTE(r.def.id)) })]).flat(), "."));
    const owOf = id => { for (const r of rgReps) { const b = r.blocs.find(x => x.id === id); if (b) return Object.assign({ rep: r }, b); } return null; };
    const grid = h("div", { class: "bloc-grid" });
    const filt = h("div", { class: "bloc-filter" }, [["", "Все"]].concat(kinds).map(([k, t]) => h("button", { class: "small-btn" + (k ? "" : " active"), "data-kind": k, text: t, onclick: e => {
      filt.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === e.currentTarget));
      grid.querySelectorAll(".bloc-card").forEach(x => x.classList.toggle("hidden", !!k && x.dataset.kind !== k));
    } })));
    // связи по виду союза (таблица «Виды союзов»): что союз сам даёт своим членам
    const tgName = k => { const s = (M.MOD_TARGETS.find(x => x[0] === k) || [, k])[1]; return /^[A-ZА-ЯЁ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1); };
    const bkOf = (b, n) => {
      const rows = (rules.tables.bkind || []).filter(x => x.bkind === b.kind && x.link && x.target && +x.value);
      if (!rows.length) return "";
      return (n < 2 ? "Когда в союзе будет больше одной страны: " : "По виду союза: ") +
        rows.map(x => x.name + " (" + tgName(x.target) + ", " + (x.target === "d_stab" && x.link !== "echo" ? "+" + fmt(+x.value, "d2") : x.link === "echo" ? "×" + fmt(+x.value, "d2") : fmt(+x.value, "d1").replace(/,0$/, "") + "%") + ")").join(", ") + ".";
    };
    for (const b of blocs) {
      const mem = M.blocMembers(rules, b.id, gm), deals = rules.tables.cdeal.filter(d => d.bloc === b.id);
      grid.append(h("section", { class: "bloc-card", id: "bloc-" + b.id, "data-kind": b.kind, "data-bloc": b.id },
        h("h3", null, h("span", { class: "bloc-sw", style: "background:" + ((colors[b.id] || {}).color || "transparent") }), b.name),
        h("div", { class: "bloc-kind", text: kindName(b.kind) + " · " + mem.length + " " + plural(mem.length, "страна", "страны", "стран") }),
        owOf(b.id) ? h("div", { class: "bloc-ow" + (owOf(b.id).infamous || (owOf(b.id).rep.acc && owOf(b.id).rep.acc.stage >= 2) ? " bad" : "") }, h("button", { class: "linkish", text: owOf(b.id).rep.def.title, onclick: () => window.KG.go(RG_ROUTE(owOf(b.id).rep.def.id)) }),
          owOf(b.id).rep.acc ? " · " + owOf(b.id).rep.def.meterAcc + " " + fmt(owOf(b.id).rep.acc.v, "d1").replace(/,0$/, "") + " из 100 · " + owOf(b.id).rep.acc.stageName.toLowerCase()
            : " · " + owOf(b.id).rep.def.meterAcc + " " + fmt(owOf(b.id).dis, "d1").replace(/,0$/, "") + " из " + fmt(owOf(b.id).rep.threshold, "d1").replace(/,0$/, "") + (owOf(b.id).infamous ? " · агрессор" : "")) : null,
        mem.length ? h("ul", { class: "bloc-members" }, mem.map(x => h("li", null,
          h("button", { class: "linkish", title: "Показать на карте", "data-country": x.id, onclick: () => window.KG.showOnMap(x.id) }, flagEl(x.id), " ", countryName(x.id)),
          x.leader ? h("small", { text: " · лидер" }) : x.how === "gm" ? h("small", { text: " · отмечено ГМом" }) : null)))
          : h("p", { class: "empty", text: "В блоке пока нет стран." }),
        b.desc ? h("p", { class: "bloc-desc", text: b.desc }) : null,
        bkOf(b, mem.length) ? h("div", { class: "hint bloc-bk", text: bkOf(b, mem.length) }) : null,
        deals.length ? h("div", { class: "hint", text: "Договоры корпораций: " + deals.map(d => groupName(d.corp) + " (присутствие " + fmt(+d.pres, "d1") + ")").join(", ") }) : null));
    }
    box.append(filt, grid);
  }

  // ---------- Регионы (Старый Свет, Африка): Лор → Регионы → <регион>; у ГМа — вкладка калькулятора на каждый регион ----------
  const RG_ROUTE = rid => "wiki/lore/regions/" + ((M.REGIONS.find(d => d.id === rid) || {}).region || rid);
  const rgDef = rid => M.REGIONS.find(d => d.id === rid) || M.REGIONS[0];
  // карточка союза в Механики → Союзы: переходим и прокручиваем, когда вкладка отрисуется
  function goBloc(id) {
    window.KG.go("wiki/mech/blocs");
    let n = 0; const t = setInterval(() => { const el = document.getElementById("bloc-" + id); if (el || ++n > 40) { clearInterval(t); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } }, 50);
  }
  // для страницы региона в лоре (site.js): блок целиком, перерисовывается вместе с механиками
  const rgLoreEls = {};
  async function renderRegion(el, rid) {
    // rid — страница региона (eu, af, na, as, me) или механика; у Азии на одной странице три механики
    const defs = M.REGIONS.filter(d => d.region === rid).length ? M.REGIONS.filter(d => d.region === rid) : [rgDef(rid)];
    el.innerHTML = "";
    el.append(h("p", { class: "mech-note", text: "Загрузка…" }));
    await init();
    el.innerHTML = "";
    rgLoreEls[rid] = el;
    if (!rules) { el.append(h("p", { class: "empty", text: "Правила механик ещё не загружены." })); return; }
    if (defs.length > 1) el.append(h("nav", { class: "rg-jump" }, defs.map(d => h("a", { href: "#rg-" + d.id, class: "small-btn", text: d.title,
      onclick: e => { e.preventDefault(); const x = document.getElementById("rg-" + d.id); if (x) x.scrollIntoView({ behavior: "smooth", block: "start" }); } }))));
    for (const d of defs) el.append(regionView(d.id, rgReportNow(d.id)));
  }
  const renderOldWorld = el => renderRegion(el, "eu");
  // у ГМа с расшифрованными данными — живой расчёт, у остальных — снимок доли силы и прироста с последней публикации
  function rgReportNow(rid) {
    const live = isGm() && mk && Object.keys(gmData).length;
    return M.rgReport(rules, rid, rgS(rid), live ? M.computeAll(rules, gmData, gmLinks, rgAllS()).results : null, live ? gmData : null);
  }
  const RG_LORE = {
    eu: ["История: почему Европа так и не объединилась", [
      "До Великой ошибки казалось, что Европа стоит на пороге объединения. Мечты разрушил внезапный коллапс экономики и международных отношений. Европейский союз отступил на запад, Россия заняла обширные земли Восточной Европы. Годы сложились в десятилетия, но память о почти объединённой Европе так и не угасла.",
      "Консолидация Франко-Иберии и подъём движения ИНТЕГР стали прелюдией, итальянская интервенция и Североморский альянс — началом новой эры. Швейцарский плебисцит 2107 года стал первой крупной вспышкой между великими державами после Великой ошибки. За ним последовали Паданское движение и неожиданный союз Балканской Федерации с изолированной Евразией. Евразийская реформация, превратившая российское государство во что-то зловещее, лишь подлила масла в огонь.",
      "Европа пала низко, но её падение ещё не завершено. Чтобы справиться с растущей нестабильностью, каждый союз стремится объединить континент по своему образу — дипломатией или силой оружия."]],
    af: ["История: «Развод» и гонка за континент", [
      "Африканский Союз пережил Великую ошибку: пока Европа раскалывалась, а в Америке шла гражданская война, Африка сплотилась, чтобы выжить. Но коррупция, раздоры и нехватка ресурсов подтачивали Союз, и точкой невозврата стал Конголезский кризис 2150-х годов. Нативистское восстание в Конго отрезало восточные центры Союза от его армий на западе; западные войска разбежались, дезертировали или были разбиты. В Найроби этот распад зовут «Талака», развод, в Киншасе — «Лумбу я кимпванза», день свободы.",
      "Из обломков выросли четыре лагеря. Восточноафриканская Федерация объявила себя наследницей Союза. Конго собрало Лигу Кимпванза из тех, кто ушёл от Найроби навсегда. Нвабудике Морган купил Биафру, Бенин и Огове и строит «Африку — компанию Morgan Industries». Сахель сплотился вокруг учёных Исполнительного совета в Бамако. С севера в эту гонку вошёл Египет: его Объединённый арабский альянс тянется через Судан к Оромии.",
      "Когда-то Яундский компромисс заставил Федерацию отказаться от военного вмешательства в Западной Африке. Между Федерацией и Конго лежит Разлом Мвитанзиге — пояс полевых командиров, которых проще вооружить, чем убрать. А Нил, который вырубленный бассейн больше не держит, и пустыня, отвоёвывающая Сахель, бьют по всем без разбора. Каждый лагерь хочет объединить континент по-своему, и пока никому это не удалось."]]
  };
  RG_LORE.na = ["История: Союз, который держится на штыках", [
    "В 2084 году армия осадила Вашингтон и выгнала довоенное правительство. С тех пор Централ трижды собирал континент заново: после каждой гражданской войны генералы обещали вернуть власть гражданским и ни разу не сдержали слова. Канаду и Мексику записали в «Великую американскую идентичность», восемь дистриктов платят дань и отдают рекрутов, а надзиратели Централа сидят в каждой столице.",
    "Рядом с генералами выросла ARC — корпорация, которая отвоёвывает сушу у моря и держит собственные армии. Денверский пакт удерживает их от открытой схватки, Хартия дистриктов — дистрикты от ухода. Но в Детройте рабочие слушают Управление переселения, а не Чикаго, в Техасе спорят люди Филдинг и лоялисты Баррона, в старой Канаде мечтают о своей стране, а в руинах Восточного побережья Голубые каски кормят тех, кого бросили и Централ, и корпорация.",
    "Надрыв копится годами, и все это видят. Квебек ждёт, когда генералам станет не до севера, адмиралы Ньюфаундленда — когда можно будет пересечь пролив, а Дания из-за внутреннего моря Гренландии шлёт им корабли и оружие. Никто не знает, сколько ещё выдержит Союз, но никто не верит, что вечно."]];
  RG_LORE.dr = ["История: угасающая сверхдержава", [
    "После Великой ошибки Китай остался единственным лидером мира и занял место, которое веками принадлежало США. В золотой век своего могущества Пекин создал Организацию стратегического сотрудничества — пояс торговли и влияния от Японии до Непала. Десятилетия наводнений подточили и страну, и пояс: Китай с трудом держит собственные провинции, а ОСС из инструмента влияния стала союзом зависимых.",
    "Председательница партии Фу Чжун умерла в 2199 году при обстоятельствах, обросших теориями заговора. Унитарист Лян Сяовэнь объявил себя временным председателем, федералисты Сунь Цзунъин требуют своего, а генералы армии и Дунбэя ждут, когда обе клики ослабят друг друга. Китай един под властью одной партии с 1949 года — и впервые за двести пятьдесят лет это единство под вопросом.",
    "Члены ОСС смотрят на Пекин и считают. Монголии некуда идти, Японии есть куда, Непал продаёт воду обеим сторонам Гималаев. На севере Сибирь вспоминает Приамурье, на юге Нусантара — старые обиды. Если партия расколется, пояс рассыплется вместе с ней."]];
  RG_LORE.sb = ["История: два обломка одной страны", [
    "Когда Великая ошибка дошла до Сибири, некоторые думали, что Сибирь от неё выиграет. Вместо этого запылала тайга, реки разлились, а Москва, потерявшая Север, отступила за Урал. В 2156 году республиканцы пошли маршем на столицу Евразии и были расстреляны; уцелевшие бежали в Карелию и в Иркутск, где их наследники и создали Республику Сибирь.",
    "За Обью тем временем доживала своё Группа армий «Юг» — разгромленная в Центральной Азии евразийская армия, которая сорок лет правила выжженными землями под именем Зауралья. Иркутску нужны были солдаты, Зауралью — законная власть, и они объединились. С тех пор в одной республике спорят три силы: евразийцы, сторонники независимости и реваншисты.",
    "На юге стоит Китай. Северный договор 2168 года провёл границу по Олёкме и Витиму, но беженцы Дунбэя переходят реки тысячами, а бригада Ло Чжэньсянь ведёт в китайских посёлках тайную войну. Реваншисты считают дни до похода на Хабаровск. Пекин занят своим наследником — и именно на это они рассчитывают."]];
  RG_LORE.tg = ["История: Индия после наставника", [
    "Индо-пакистанская война 2080-х оставила от Северной Индии пустую оболочку: ядерные удары от Исламабада до Варанаси, отравленный Пенджаб, супертрущобы Дели. Века осадков и голода держали субконтинент в анархии, пока из Бхарата не поднялся Радж Тхакур — духовный наставник, чей портрет три поколения индийцев видели в каждом доме.",
    "Тхакур не объединил Индию, но заставил её не воевать. Хайдарабадский пакт — скорее огромный договор о ненападении, чем союз: Бхарат, Дели, Раджастан, Махараштра, Карнатака, Тамилакам, Керала и Шри-Ланка держатся на памяти о нём крепче, чем на подписях. Пенджаб, Одиша, наксалиты, Синд и Кашмир живут вне пакта и ждут.",
    "Теперь наставник умирает. Он назначил преемником Радху Мандала, бывшего послушника из монастыря у Непала. Его старшая дочь Кавита, которую всю жизнь называли наследницей, правит Дели и не простила отца. Лорды Махараштры, Бангалорский совет и молодая хунта Одиши не признают ни одного из них. Вся Индия знает: когда Тхакур умрёт, мир умрёт вместе с ним."]];
  RG_LORE.me = ["История: Аравийская война и то, что от неё осталось", [
    "Нефть кончилась раньше, чем море поднялось, и Ближний Восток пережил Великую ошибку дважды: сначала без денег, потом без побережий. Залив проглотил Катар и Бахрейн, Басру и Шатт-эль-Араб, Газу и Тель-Авив. Остались горы, оазисы, последние реки — и старые соперники, которые веками делили Аравию.",
    "В 2188 году Иран и Турция сошлись за Аравийский полуостров в решающей войне, увязнув в мелких конфликтах с марионетками друг друга. Обоих разбил Египет — людскими волнами, которых никто не ждал. Мекканское перемирие закончило войну, но не спор: Иран хочет мести и паломников в Тегеране, Египет — Великого Арабского государства, Турция — вернуть уважение.",
    "Новые игроки выросли на обломках. Эмираты Омана мечтают собрать Аравию заново, Хиджаз держит святыни, Машрик и Аль-Хиляль делят пересыхающие Тигр и Евфрат, Палестина и Израиль — горы и источники. Жажда растёт с каждым годом, спор за святыни — с каждой речью в Тегеране и Каире."]];
  // история региона: текст по умолчанию — RG_LORE, правка ГМа хранится в site.json (ключи lore.region.<механика>.history[.title]).
  // На странице региона её правят в режиме «✎ Правка», как статьи государств; во вкладке ГМа — только чтение с правками.
  function rgLoreBox(d, inGm) {
    const lore = RG_LORE[d.id]; if (!lore) return null;
    const kT = "lore.region." + d.id + ".history.title", kH = "lore.region." + d.id + ".history";
    const S = window.KGSite, T = (S && S.data && S.data.texts) || {}, editing = !!(S && S.editing);
    const def = lore[1].map(x => h("p", { text: x }));
    if (inGm) {
      const body = h("div", { class: "rich" }, def);
      if (T[kH] != null && S.sanitize) body.innerHTML = S.sanitize(T[kH]);
      return h("details", { class: "ow-lore" }, h("summary", { text: T[kT] != null ? T[kT] : lore[0] }), body);
    }
    const box = h("details", { class: "ow-lore" },
      h("summary", null, h("span", { "data-edit-text": kT, "data-label": "Регион: заголовок истории (" + d.title + ")", text: lore[0] })),
      h("div", { class: "rich", "data-edit": kH, "data-label": "Регион: история (" + d.title + ")", "data-placeholder": "История региона…" }, def));
    box.open = editing;
    // щелчок по заголовку в режиме правки ставит курсор, а не сворачивает историю
    box.querySelector("summary").addEventListener("click", e => { if (window.KGSite && window.KGSite.editing) e.preventDefault(); });
    return box;
  }
  const stripZero = s => s.replace(/,0+$/, "");
  const rgSign = v => (+v > 0 ? "+" : "−") + stripZero(fmt(Math.abs(+v), "d2"));
  // регион с накоплением (Северная Америка): шкала надрыва Союза, два договора, вклад членов, внешние силы, резолюции союза и стран
  function accView(d, rep, inGm) {
    const p = d.p, K = rules.K, A = rep.acc, T = d.txt, tName = k => (M.MOD_TARGETS.find(t => t[0] === k) || [, k])[1];
    const sec = h("section", { class: "ow rg-" + d.id, id: inGm ? null : "rg-" + d.id }, h("h2", { text: inGm ? "Как это видят все" : d.title }));
    const lore = rgLoreBox(d, inGm);
    if (lore) sec.append(lore);
    const st = n => stripZero(fmt(n, "d2")), lc = s => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");
    sec.append(h("p", { class: "mech-note", text: T.intro.replace("{base}", st(A.base)).replace("{lvl}", st(K[p + "_acc_stab_lvl"])) }));
    const tLine = (name, sts, notes, cur, sK) => {
      const lab = (sts.find(t => t[0] === cur) || sts[0])[1];
      const note = cur === "active" ? notes.active.replace(/\.$/, "") : lc(notes[cur]) + " (" + st(K[p + sK[cur]]) + " стабильности за ход)";
      return h("div", { class: "ow-st" + (cur === "active" ? "" : " bad") }, h("b", { text: name + ": " + lab.toLowerCase() }), h("span", { text: " — " + note + "." }));
    };
    const bar = (v, steps) => h("span", { class: "bar rg-acc-bar" }, h("i", { style: "width:" + Math.max(1, Math.min(100, v)) + "%" }),
      steps.map(s => h("u", { style: "left:" + s.at + "%", title: s.name + " — с " + s.at })));
    const stepFx = i => [+K[p + "_st" + i + "_stab"] ? st(K[p + "_st" + i + "_stab"]) + " стабильности за ход" : "", +K[p + "_st" + i + "_sec"] ? st(K[p + "_st" + i + "_sec"]) + "% безопасности" : ""].filter(Boolean).join(" и ");
    const stg = h("div", { class: "rg-acc" + (A.stage >= 2 ? " bad" : "") },
      h("div", { class: "rg-track-h" }, h("b", { text: d.meter + ": " + A.stageName.toLowerCase() }),
        h("span", { class: "num", text: st(A.v) + " / 100" + (A.growth == null ? "" : " · за ход +" + st(A.growth)) })),
      bar(A.v, A.steps),
      h("div", { class: "hint", text: A.steps.map((s, i) => s.name + " с " + st(s.at) + ": " + T.who + " " + stepFx(i + 1) + ", " +
        T.oppH.toLowerCase() + " +" + st(K[p + "_st" + (i + 1) + "_opp"]) + "% боевого духа").join("; ") + "." }));
    sec.append(stg, h("div", { class: "ow-status" },
      A.full ? h("div", { class: "ow-st bad" }, h("b", { text: T.full }), h("span", { text: " — " + T.fullNote })) : null,
      tLine(d.treaty, d.st, d.notes, rep.treaty, { amended: "_amend_stab", void: "_void_stab" }),
      d.treaty2 ? tLine(d.treaty2.name, d.treaty2.st, d.treaty2.notes, rep.treaty2, { amended: "_ch_amend_stab", void: "_ch_void_stab" }) : null,
      rep.viol.length ? h("div", { class: "ow-st bad" }, h("b", { text: "Нарушители " + d.treatyGen + ": " }), h("span", { text: rep.viol.map(countryName).join(", ") + " (" + st(K[p + "_viol_stab"]) + " стабильности за ход)." })) : null));
    const fxOf = (t, v) => (t && +v ? linkVal({ value: v, mode: t === "d_stab" ? "add" : "pct", target: t }) + " " + tName(t).toLowerCase() : "");
    // силы (клики, претенденты)
    if (rep.fac) {
      const F = rep.fac, lead = F.rows.find(f => f.lead);
      const ft = h("table", { class: "mt ow-t" }, h("thead", null, h("tr", null, [d.fac.one.charAt(0).toUpperCase() + d.fac.one.slice(1), "Лидеры", "Вес", "Пока ведёт"].map(t => h("th", { text: t })))));
      const fb = h("tbody");
      for (const f of F.rows.slice().sort((a, b) => b.w - a.w)) {
        const fx = [fxOf(f.row.t1, f.row.v1), fxOf(f.row.t2, f.row.v2)].filter(Boolean);
        fb.append(h("tr", { class: f.lead ? "on" : "" }, h("td", null, h("b", { text: f.name }), f.row.desc ? h("div", { class: "hint", text: f.row.desc }) : null), h("td", { text: f.who || "—" }),
          h("td", { class: "num" }, h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, f.w)) + "%" })), st(f.w) + "%"),
          h("td", { text: fx.length ? countryName(f.country) + ": " + fx.join(", ") : "—" })));
      }
      ft.append(fb);
      sec.append(h("h3", { text: d.fac.title }), h("p", { class: "mech-note", text: (lead ? d.fac.lead + ": " + lead.name + " (" + st(lead.w) + "%)." : d.fac.none + " (нужно " + st(F.major) + "%)" +
        (A.nomaj ? ": " + d.meterAcc + " растёт ещё на " + st(A.nomaj) + " за ход." : ".")) + " Вес сдвигают резолюции: остальные теряют или получают свою долю пропорционально." }), h("div", { class: "mt-scroll" }, ft));
    }
    // вторая шкала (реванш)
    if (rep.s2) {
      const S2 = rep.s2, s2 = d.scale2;
      sec.append(h("h3", { text: s2.name }), h("p", { class: "mech-note", text: s2.note }), h("div", { class: "rg-acc" + (S2.stage >= 2 ? " bad" : "") },
        h("div", { class: "rg-track-h" }, h("b", { text: s2.name + ": " + S2.stageName.toLowerCase() }), h("span", { class: "num", text: st(S2.v) + " / 100 · за ход +" + st(S2.growth) })),
        bar(S2.v, S2.steps),
        h("div", { class: "hint", text: S2.steps.map((s, i) => s.name + " с " + st(s.at) + ": +" + st(K[p + "_s2_st" + (i + 1) + "_rdy"]) + "% боеготовности, " + st(K[p + "_s2_st" + (i + 1) + "_bud"]) + "% доходов бюджета").join("; ") +
          ". За ход: сам +" + st(S2.base) + ", от веса реваншистов +" + st(S2.fromFac) + "." }),
        S2.full ? h("div", { class: "ow-st bad" }, h("b", { text: s2.name + " на пределе" }), h("span", { text: " — войну начинает ГМ." })) : null));
    }
    // верность членов союза
    if (rep.loy) {
      const lt = h("table", { class: "mt ow-t" }, h("thead", null, h("tr", null, ["Член союза", "Верность", "Положение"].map(t => h("th", { text: t })))));
      const lb = h("tbody");
      for (const x of rep.loy) lb.append(h("tr", { class: x.st ? "bad" : "" }, h("td", null, flagEl(x.id), " ", countryName(x.id), x.row.note ? h("div", { class: "hint", text: x.row.note }) : null),
        h("td", { class: "num" }, h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, x.v)) + "%" })), st(x.v)), h("td", { text: d.loy.st[x.st] })));
      lt.append(lb);
      sec.append(h("h3", { text: d.loy.title }), h("p", { class: "mech-note", text: "Верность падает каждый ход на " + st(K[p + "_loy_drift"]) + " за каждую стадию: " + d.meterGen + ". Ниже " + st(K[p + "_loy_low"]) + " член союза сомневается, ниже " +
        st(K[p + "_loy_exit"]) + " готов уйти (выход оформляет ГМ), а лидер теряет " + st(Math.abs(K[p + "_loy_exit_acc"])) + "% доступа к рынкам за каждого такого." }), h("div", { class: "mt-scroll" }, lt));
    }
    // вклад членов союза (у Тигра стабильность штатов на угасание не влияет — таблицы нет)
    if (+K[p + "_acc_stab_k"]) {
      const tbl = h("table", { class: "mt ow-t" }, h("thead", null, h("tr", null, [T.part, "Стабильность", T.partV].map(t => h("th", { text: t })))));
      const body = h("tbody");
      for (const x of A.parts.slice().sort((a, b) => +(b.v) - +(a.v))) body.append(h("tr", { class: +(x.v) > 0 ? "bad" : "" },
        h("td", null, flagEl(x.id), " ", countryName(x.id)), h("td", { class: "num", text: x.stab == null ? "—" : st(x.stab) }), h("td", { class: "num", text: x.v == null ? "—" : "+" + st(x.v) })));
      tbl.append(body);
      sec.append(h("h3", { text: T.parts }), h("div", { class: "mt-scroll" }, tbl));
    }
    sec.append(h("p", { class: "hint", text: "За ход " + d.meterAcc + " растёт сам по себе на " + st(A.base) + (A.nomaj ? ", без большинства — ещё на " + st(A.nomaj) : "") +
      (A.pactAdd ? ", " + d.treaty + " — на " + st(A.pactAdd) : "") + (A.chAdd ? ", " + d.treaty2.name + " — на " + st(A.chAdd) : "") + "." }));
    sec.append(h("h3", { text: T.oppH }), h("p", { class: "mech-note", text: (A.opp.map(countryName).join(", ") || "—") +
      " " + T.oppWait + (A.stage ? ": сейчас +" + st(K[p + "_st" + A.stage + "_opp"]) + "% боевого духа." : ".") }));
    // резолюции
    const facName = id => ((rep.fac && rep.fac.rows.find(f => f.id === id)) || {}).name || id;
    const fx = (x, actor) => [fxOf(x.t1, x.v1) ? (actor ? (T.member ? "членам " : T.union + " ") : "членам ") + fxOf(x.t1, x.v1) : "",
      fxOf(x.t2, x.v2) ? (actor ? "себе " : "лидеру ") + fxOf(x.t2, x.v2) : "",
      x.fac && +x.df ? "«" + facName(x.fac) + "» " + rgSign(x.df) + "% веса" : "", d.scale2 && +x.d2 ? d.scale2.name.toLowerCase() + " " + rgSign(x.d2) : "",
      d.loy && +x.dl ? "верность " + rgSign(x.dl) : ""].filter(Boolean).join(", ");
    const resBox = h("details", { class: "ow-res" }, h("summary", { text: "Резолюции" }));
    const resT = rules.tables[p + "res"] || [];
    const groups = rep.blocs.map(b => ({ name: b.name, rows: resT.filter(x => (x.bloc || "") === b.id || !x.bloc), on: b.res, actor: false }))
      .concat(rep.actors.map(a => ({ name: countryName(a.country), rows: a.rows, on: a.res, actor: true })));
    for (const g of groups) {
      if (!g.rows.length) continue;
      resBox.append(h("h4", { text: g.name }), h("ul", null, g.rows.map(x => h("li", { class: g.on.includes(x) ? "on" : "" },
        h("b", { text: x.name }), h("small", { text: (+x.dis ? " · " + d.meterAcc + " " + (+x.dis > 0 ? "+" : "−") + st(Math.abs(+x.dis)) : "") + (fx(x, g.actor) ? " · " + fx(x, g.actor) : "") + (g.on.includes(x) ? " · принята" : "") }),
        x.desc ? h("div", { class: "hint", text: x.desc }) : null))));
    }
    sec.append(resBox);
    if (rep.log.length) sec.append(h("details", { class: "ow-log" }, h("summary", { text: "Журнал " + d.meterGen }), h("ul", null, rep.log.slice(-12).reverse().map(e =>
      h("li", null, h("small", { text: "Ход " + e.turn + " · " }), (+e.d ? (+e.d > 0 ? "+" : "−") + st(Math.abs(+e.d)) + " — " : "") + (e.why || ""))))));
    return sec;
  }
  function regionView(rid, rep, inGm) {
    const d = rep.def || rgDef(rid), p = d.p, K = rules.K, tName = k => (M.MOD_TARGETS.find(t => t[0] === k) || [, k])[1];
    if (d.acc) return accView(d, rep, inGm);
    const sec = h("section", { class: "ow rg-" + d.id, id: inGm ? null : (d.id === "eu" ? "ow" : "rg-" + d.id) }, h("h2", { text: inGm ? "Как это видят все" : d.title }));
    const lore = rgLoreBox(d, inGm);
    if (lore) sec.append(lore);
    const treaty = (d.st.find(t => t[0] === rep.treaty) || d.st[0])[1];
    const lc = s => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");
    const tNote = rep.treaty === "active" ? d.notes.active
      : lc(d.notes[rep.treaty]) + " (" + stripZero(fmt(K[p + (rep.treaty === "void" ? "_void_stab" : "_amend_stab")], "d2")) + " стабильности за ход всем странам региона).";
    const thr = stripZero(fmt(rep.threshold, "d1"));
    sec.append(h("p", { class: "mech-note", text: "У каждого крупного союза " + d.whereGen + " есть " + d.meterAcc + " — мера угрозы в глазах остальных держав региона. " +
      "Она растёт каждый ход вместе с силой и размером союза, скачками — от прокси-войн и резолюций, а снижается лишь в редких случаях. С " + thr +
      " союз становится агрессором: против него вправе воевать все союзы региона, а его члены теряют " + stripZero(fmt(Math.abs(K[p + "_inf_access"]), "d1")) + "% доступа к рынкам и " +
      stripZero(fmt(Math.abs(K[p + "_inf_stab"]), "d2")) + " стабильности за ход. Объединение континента возможно, только когда уцелеет один союз." +
      (rep.tracks.length ? " Кроме того, на страны региона давят общие беды — треки: чем выше уровень, тем сильнее эффект." : "") }),
      h("div", { class: "ow-status" },
        h("div", { class: "ow-st" + (rep.treaty === "active" ? "" : " bad") }, h("b", { text: d.treaty + ": " + treaty.toLowerCase() }), h("span", { text: " — " + tNote })),
        rep.infamous.length ? h("div", { class: "ow-st bad" }, h("b", { text: "Агрессор: " + rep.infamous.map(b => b.name).join(", ") }), h("span", { text: " — все союзы региона вправе объявить ему войну." })) : null,
        h("div", { class: "ow-st" }, h("b", { text: rep.united ? d.notes.united[0] : d.notes.united[1] }),
          h("span", { text: rep.united ? " — уцелел один союз: «" + rep.united.name + "»." : " — союзов в регионе: " + rep.blocs.filter(b => b.members.length).length + "." })),
        rep.viol.length ? h("div", { class: "ow-st bad" }, h("b", { text: "Нарушители: " }), h("span", { text: rep.viol.map(countryName).join(", ") + " (" + stripZero(fmt(K[p + "_viol_stab"], "d2")) + " стабильности за ход)." })) : null));
    const tbl = h("table", { class: "mt ow-t" }, h("thead", null, h("tr", null, ["Союз", d.meter, "За ход", "Доля силы " + d.whereGen, "Принятые резолюции"].map(t => h("th", { text: t })))));
    const body = h("tbody");
    for (const b of rep.blocs.slice().sort((x, y) => y.dis - x.dis)) {
      body.append(h("tr", { class: b.infamous ? "bad" : "" },
        h("td", null, b.leader ? flagEl(b.leader) : null, " ", h("button", { class: "linkish", text: b.name, onclick: () => (/^c:/.test(b.id) ? window.KG.showOnMap(b.id.slice(2)) : goBloc(b.id)) })),
        h("td", { class: "num" }, h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, b.dis / (rep.threshold || 1) * 100)) + "%" })), stripZero(fmt(b.dis, "d2")) + " / " + thr),
        h("td", { class: "num", text: b.growth == null ? "—" : "+" + fmt(b.growth, "d2") }),
        h("td", { class: "num", text: b.share == null ? "—" : fmt(b.share, "pct") }),
        h("td", { text: b.res.length ? b.res.map(x => x.name).join(", ") : "—" })));
    }
    tbl.append(body);
    sec.append(h("div", { class: "mt-scroll" }, tbl));
    // треки региона
    if (rep.tracks.length) {
      const fxT = t => [t.row.t1 && +t.row.v1 ? rgSign(t.row.v1) + (t.row.t1 === "d_stab" ? "" : "%") + " " + tName(t.row.t1).toLowerCase() : "",
        t.row.t2 && +t.row.v2 ? rgSign(t.row.v2) + (t.row.t2 === "d_stab" ? "" : "%") + " " + tName(t.row.t2).toLowerCase() : ""].filter(Boolean).join(", ");
      const tt = h("div", { class: "rg-tracks" });
      for (const t of rep.tracks) tt.append(h("div", { class: "rg-track" + (t.v >= t.max ? " bad" : "") },
        h("div", { class: "rg-track-h" }, h("b", { text: t.name }), h("span", { class: "num", text: stripZero(fmt(t.v, "d2")) + " / " + t.max + (t.grow ? " · сам растёт на " + stripZero(fmt(t.grow, "d2")) + " за ход" : "") })),
        h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, t.v / (t.max || 1) * 100)) + "%" })),
        h("div", { class: "hint", text: "За каждый уровень: " + (fxT(t) || "—") + ". Задевает: " + (t.countries.map(countryName).join(", ") || "—") + "." }),
        t.row.desc ? h("div", { class: "hint", text: t.row.desc }) : null));
      sec.append(h("h3", { text: "Треки региона" }), tt);
    }
    // резолюции союзов
    const trName = id => ((rep.tracks.find(t => t.id === id) || {}).name || id);
    const fx = x => [x.t1 && +x.v1 ? "членам " + linkVal({ value: x.v1, mode: x.t1 === "d_stab" ? "add" : "pct", target: x.t1 }) + " " + tName(x.t1).toLowerCase() : "",
      x.t2 && +x.v2 ? "лидеру " + linkVal({ value: x.v2, mode: x.t2 === "d_stab" ? "add" : "pct", target: x.t2 }) + " " + tName(x.t2).toLowerCase() : "",
      x.track && +x.dt ? "«" + trName(x.track) + "» " + rgSign(x.dt) : ""].filter(Boolean).join(", ");
    const resBox = h("details", { class: "ow-res" }, h("summary", { text: "Резолюции союзов" }));
    const resT = rules.tables[p + "res"] || [];
    for (const b of rep.blocs.concat([{ id: "", name: "Любой союз региона", res: [] }])) {
      const list = resT.filter(x => (x.bloc || "") === b.id);
      if (!list.length) continue;
      resBox.append(h("h4", { text: b.name }), h("ul", null, list.map(x => h("li", { class: b.res && b.res.includes(x) ? "on" : "" },
        h("b", { text: x.name }), h("small", { text: " · " + (x.who === "any" ? "любой член союза" : "только лидер") + (+x.dis ? " · " + d.meterAcc + " " + (+x.dis > 0 ? "+" : "−") + stripZero(fmt(Math.abs(+x.dis), "d1")) : "") + (fx(x) ? " · " + fx(x) : "") + (b.res && b.res.includes(x) ? " · принята" : "") }),
        x.desc ? h("div", { class: "hint", text: x.desc }) : null))));
    }
    sec.append(resBox);
    if (rep.log.length) {
      const bn = id => (rep.blocs.find(b => b.id === id) || { name: id }).name;
      sec.append(h("details", { class: "ow-log" }, h("summary", { text: "Журнал " + d.meterGen }), h("ul", null, rep.log.slice(-12).reverse().map(e =>
        h("li", null, h("small", { text: "Ход " + e.turn + " · " }), (e.bloc ? bn(e.bloc) + (+e.d ? ": " + (+e.d > 0 ? "+" : "−") + stripZero(fmt(Math.abs(+e.d), "d2")) : "") + " — " : "") + (e.why || ""))))));
    }
    return sec;
  }

  // правила из опубликованного mech.json (опубликованные при ходе длиной в год переводятся на квартал)
  const pubRules = m => M.normalizeRules(M.isOldTurn(m) ? M.quarterRules(m.rules) : m.rules);
  // регионы: состояние хода (угроза, договор, резолюции, треки) — открытые поля mech[p] (mech.ow — Старый Свет, mech.af — Африка), правит ГМ
  // (нормализуется на месте: ссылки на mech[p] остаются живыми между вызовами)
  const rgS = rid => { const d = rgDef(rid), n = M.rgState(rules, d.id, mech[d.p]); if (!mech[d.p] || typeof mech[d.p] !== "object") mech[d.p] = {}; return Object.assign(mech[d.p], n); };
  const owS = () => rgS("eu");
  const rgAllS = () => { const o = {}; for (const d of M.REGIONS) o[d.p] = rgS(d.id); return o; };

  // ---------- рейтинг ----------
  function renderRating() {
    const box = $("mechRating"); box.innerHTML = "";
    const note = rulesNote(); if (note) box.append(note);
    const list = Object.keys(mech.countries).filter(id => mech.countries[id].pub).map(id => Object.assign({ id }, mech.countries[id].pub)).sort((a, b) => a.rank - b.rank);
    box.append(h("p", { class: "mech-note" }, M.turnLabel(mech.turn, mech.year) + ". Индекс национальной мощи (ИНМ) сравнивает страну с мировым лидером по ВВП, армии, населению, технологиям, стабильности и спутникам." +
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
    // дефолты по госдолгу — публично; суммы долгов видят только сами страны и ГМ
    const defs = ((mech.debtPub && mech.debtPub.def) || []).filter(id => mech.countries[id]);
    box.append(h("h2", { text: "Дефолты" }), defs.length
      ? h("div", null, h("p", { class: "mech-note", text: "Эти государства не платят по долгам: кредиторы заморозили им рынки, а занять больше негде." }),
        h("ul", { class: "debt-defs" }, defs.map(id => h("li", null, flagEl(id), " ", countryName(id)))))
      : h("p", { class: "empty", text: "Ни одно государство не объявило дефолт." }));
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
    try { lore = await fetch("data/ideologies.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)); } catch (e) { lore = null; }
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
    const axes = h("div", { class: "ideo-axes" }, h("h3", { "data-edit-text": "lore.ideo.h.axes", text: "Оси противостояния" }),
      (lore.axes || []).map(a => h("div", { class: "ideo-axis-row" },
        h("b", { "data-edit-text": "lore.ideo.axis." + a.a + "-" + a.b + ".name", text: a.name }), h("span", { class: "q", "data-edit-text": "lore.ideo.axis." + a.a + "-" + a.b + ".q", text: a.q }),
        h("div", { class: "pair" },
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.a].color, onclick: () => go(a.a) }, icon(byId[a.a], "ideo-chip-ico"), nameOf(a.a), h("small", { text: a.a_note })),
          h("span", { class: "vs", text: "↔" }),
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.b].color, onclick: () => go(a.b) }, icon(byId[a.b], "ideo-chip-ico"), nameOf(a.b), h("small", { text: a.b_note }))))),
      h("p", { class: "mech-note", "data-edit-text": "lore.ideo.axes.note", text: "Каждый гибрид противостоит вершине напротив. Цвета смешиваются так же, как идеи: красный и жёлтый дают оранжевое Господство, жёлтый и бирюзовый — зелёную Ненасытность, бирюзовый и красный — пурпурную Духовность." }));
    el.append(h("div", { class: "ideo-top" }, h("div", { class: "ideo-tri-wrap" }, svg), axes));

    // карточки: тексты из data/ideologies.json, правки ГМа (✎ Правка) — site.json → texts["lore.ideo.<id>.<поле>"]
    const cards = h("div", { class: "ideo-cards" });
    for (const x of L) {
      const fx = ideoEffects(ruleOf(x.id));
      cards.append(h("article", { class: "ideo-card", id: "ideo-" + x.id, style: "--c:" + x.color },
        h("header", null, icon(x), h("div", null, h("h3", { text: nameOf(x.id) }),
          h("div", { class: "ideo-meta", "data-edit-text": "lore.ideo." + x.id + ".meta", text: [x.en, x.kind, x.opposite ? "противник — " + nameOf(x.opposite) : ""].filter(Boolean).join(" · ") }))),
        h("p", { class: "ideo-desc", "data-edit-text": "lore.ideo." + x.id + ".desc", text: x.desc }),
        h("dl", null,
          h("dt", { "data-edit-text": "lore.ideo.dt.blame", text: "Виновник Великой ошибки" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".blame", text: x.blame }),
          h("dt", { "data-edit-text": "lore.ideo.dt.real", text: "Реальные аналоги" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".real", text: x.real }),
          h("dt", { "data-edit-text": "lore.ideo.dt.state", text: "Влияние на государство" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".state", text: x.state })),
        h("div", { class: "ideo-fx" }, fx.length ? fx.map(e => h("span", { class: "fx " + (e.v > 0 ? "up" : "down"), text: e.text })) : h("span", { class: "fx", text: "Без модификаторов" }))));
    }
    el.append(h("h2", { class: "ideo-h", "data-edit-text": "lore.ideo.h.cards", text: "Семь идеологий" }), cards);

    // отношения
    const rel = h("table", { class: "mt ideo-rel" },
      h("thead", null, h("tr", null, h("th"), L.map(x => h("th", { style: "color:" + x.color, text: nameOf(x.id) })))),
      h("tbody", null, L.map(a => h("tr", null, h("th", { style: "color:" + a.color, text: nameOf(a.id) }),
        L.map(b => { const v = ideoRel(lore, a.id, b.id); return h("td", { class: "num" + (v > 0 ? " up" : v < 0 ? " down" : "") + (a.id === b.id ? " self" : ""), text: sgn(v) || "0" }); })))));
    const R = lore.relations || {};
    el.append(h("h2", { class: "ideo-h", "data-edit-text": "lore.ideo.h.rel", text: "Отношения между идеологиями" }),
      h("p", { class: "mech-note", "data-edit-text": "lore.ideo.rel.note", text: "Своя " + sgn(R.self) + " · соседняя по треугольнику " + sgn(R.near) + " · через одну " + sgn(R.far) + " · противоположная " + sgn(R.opposite) + " · с Равновесием " + (sgn(R.center) || "0") + ". Пока справочно: в расчётах не участвует." }),
      h("div", { class: "mt-scroll" }, rel),
      h("p", { class: "mech-note", "data-edit-text": "lore.ideo.note", text: "Модификаторы — правила ГМа: Вики → Механики → Справочник → «Идеологии». Те же числа — на листе «Идеологии» в таблице «Механики_Мир2200.xlsx». Идеология страны выбирается в её карточке." }));
  }

  // ---------- карточка страны (общая для игрока и ГМа) ----------
  const LAYOUT = [
    { id: "overview", title: "Обзор" },
    { id: "state", title: "Государство", blocks: [
      ["Общие сведения", ["in:capital", "in:gov", "in:ideology", "out:wonders", "in:position", "map:lang", "map:cur", "in:megapolis"]],
      ["Территория и среда", ["in:territory", "in:habitable", "out:habitable_area", "in:flooded", "in:radiation", "in:waste_threat", "in:climate"]],
      ["Население", ["in:pop_meg", "in:pop_waste", "out:pop_total", "out:urban", "out:pop_per_meg", "in:working_share", "in:mob_share", "in:education", "in:healthcare", "out:health", "out:labor"]],
      ["Политика и общество", ["in:stability", "in:support", "in:corruption", "out:corruption_eff", "in:mob_law", "out:mob_law_name", "in:tech", "out:tech_mult", "in:infra", "out:infra_mult", "out:stab_mult", "out:hdi", "out:inm", "out:rank"]]] },
    { id: "econ", title: "Экономика", blocks: [
      ["Энергетика", ["tab:energy", "out:en_supply", "out:en_demand", "out:en_balance", "out:en_coef"]],
      ["Промышленность", ["tab:industry", "out:ind_total", "out:labor_need", "out:labor_coef", "out:pm_base", "out:ind_eff", "out:pm_eff", "out:pm_pc", "out:vpk_eff", "out:ship_eff", "out:aero_eff"]],
      ["Сырьё, продовольствие, вода", ["in:raw", "out:raw_need", "out:raw_bal", "tab:food", "out:field_yield", "out:food_prod", "out:food_need", "out:food_coef", "in:water", "out:water_sup", "out:water_need", "out:water_coef"]],
      ["Внешняя торговля", ["in:routes", "in:exp_share", "out:access", "out:export", "out:import", "out:trade_bal", "out:world_share"]],
      ["ВВП", ["out:gdp_ind", "out:gdp_agro", "out:gdp_raw", "out:gdp_svc", "out:gdp", "out:gdp_pc", "out:econ_level", "out:ind_share"]],
      ["Бюджет", ["in:tax", "out:revenue", "out:debt_service", "out:budget", "in:b_def", "in:b_space", "in:b_sci", "in:b_soc", "in:b_infra", "out:b_other", "out:def_budget", "out:space_budget", "out:sci_budget", "out:soc_budget", "out:infra_budget"]],
      ["Государственный долг", ["out:debt_status", "out:debt_total", "out:debt_gdp", "out:debt_rate", "out:debt_service", "out:debt_new", "out:debt_repay", "out:debt_stab", "debt:loans"]],
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
    if (r.debt_def) w.push("Дефолт по госдолгу: выплаты заморожены, доступ к рынкам и стабильность падают, занять нельзя — статьи сверх 100% срезаны. Выход — погасить долг ниже " + fmt(+rules.K.debt_default, "pct") + " ВВП или договориться с кредиторами.");
    else if (r.b_other < -1e-9) w.push("Перерасход бюджета: статьи в сумме превышают 100%. За ход в долг уйдёт " + fmt(r.debt_new, "d1") + " млрд кр.");
    if (!r.debt_def && r.debt_gdp >= +rules.K.debt_default) w.push("Госдолг " + fmt(r.debt_gdp, "pct") + " ВВП — при переходе хода будет объявлен дефолт.");
    else if (!r.debt_def && r.debt_gdp > +rules.K.debt_safe) w.push("Тяжёлый госдолг: " + fmt(r.debt_gdp, "pct") + " ВВП, стабильность " + fmt(r.debt_stab, "d2") + " за ход.");
    if (r.readiness < 0.999) w.push("Военный бюджет не покрывает содержание: боеготовность " + fmt(r.readiness, "pct") + ".");
    if (r.staffing < 0.999) w.push("Армия больше доступного МОП: укомплектованность " + fmt(r.staffing, "pct") + ". Ужесточите закон о мобилизации или сократите войска.");
    if (r.mop_load > +rules.K.mop_safe) w.push("Нагрузка на МОП " + fmt(r.mop_load, "pct") + " годных к службе — экономика теряет рост.");
    if (r.security < 0.999) w.push("Не хватает гарнизонов: безопасность " + fmt(r.security, "pct") + ". Страдают пустоши и стабильность.");
    if (r.equip < 0.9) w.push("Дивизиям не хватает техники: оснащённость " + fmt(r.equip, "pct") + ".");
    if (r.ac_base_coef < 0.999) w.push("Аэродромов не хватает на всю авиацию.");
    if (r.nav_base_coef < 0.999) w.push("Военно-морских баз не хватает на весь флот.");
    if (r.nav_supply < 0.999) w.push("Флоту не хватает судов снабжения.");
    if (r.coverage < 0.999) w.push("Космический бюджет не покрывает группировку: в конце хода сойдут с орбиты " + r.sat_loss + " спутн.");
    if (r.kessler >= 0.75) w.push("Орбита перегружена: индекс Кесслера " + fmt(r.kessler, "d2") + ".");
    if (r.debris_loss >= 0.5) w.push("Мусор на орбите: за ход может погибнуть ≈ " + fmt(r.debris_loss, "d1") + " спутн.; запуски дороже на " + fmt(r.launch_cost, "pct") + ".");
    if (+I.mob_law >= 4) w.push("Режим «" + r.mob_law_name + "» каждый ход снижает стабильность.");
    if (r.corp_sov_pen > 0) w.push("Корпорации подмяли государство (влияние " + fmt(r.corp_infl, "d1") + "): общество теряет " + fmt(r.corp_sov_pen, "d2") + " стабильности за ход.");
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
    const calc = () => { r = M.compute(rules, c, opts.id, opts.world); M.applyWorld(rules, c, r, opts.world); return r; };
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
          ((kind === "coef" && v < 0.995) || (kind === "neg" && v < -1e-9) || (kind === "load" && v >= 1) ? " bad" : "") + (kind === "load" && v >= 0.5 && v < 1 ? " warn" : "") +
          (kind === "mop" && v > +rules.K.mop_safe ? " warn" : "") +
          (kind === "debt" ? (v >= +rules.K.debt_default ? " bad" : v > +rules.K.debt_safe ? " warn" : "") : "");
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
      if (kind === "debt") return loansBlock();
      if (kind === "map") return mapRow(key);
      // описание показателя из летописи — подсказка при наведении на название строки
      const lore = M.paramLore(key), tip = lore ? paramText(key) : null, lab = text => h("span", { class: "l" + (lore ? " lored" : ""), text, title: tip, "data-lore": lore ? key : null });
      if (kind === "in" && (key === "pop_meg" || key === "pop_waste") && M.hasCityPop(opts.id)) return popRow(key, lab);
      if (kind === "in") {
        const [label, unit, , , , hint] = M.INPUTS[key];
        return h("div", { class: "mrow in" + (opts.editable ? " edit" : "") }, lab(label), h("span", { class: "c" }, inField(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
      }
      const [label, unit, , okind, hint] = M.OUT[key];
      return h("div", { class: "mrow out" + (okind === "res" ? " is-res" : "") }, lab(label), h("span", { class: "c" }, outVal(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
    }
    // язык и валюта — из карточки страны на карте (ГМ правит их там; курсы валют — Вики → Лор → Валюты)
    function mapRow(key) {
      const info = (mapCountries[String(opts.id)] || {}).info || {};
      let text = "—";
      if (key === "lang") text = info.lang || "—";
      if (key === "cur") {
        const cu = info.cur && mapCurrencies[info.cur];
        text = cu ? cu.name + " (" + cu.sign + ")" + (cu.id === "kr" ? "" : " · 1 " + cu.sign + " = " + (+cu.rate).toLocaleString("ru-RU", { maximumFractionDigits: 3 }) + " кр.") : "—";
      }
      return h("div", { class: "mrow out" }, h("span", { class: "l", text: key === "lang" ? "Язык" : "Валюта" }), h("span", { class: "c" }, h("span", { class: "v", text })), h("span", { class: "u" }),
        h("span", { class: "hint", text: "из карточки страны на карте" }));
    }
    // население мегаполисов и пустошей — из городов карты: правятся на карте, а не здесь
    function popRow(key, lab) {
      const [label, unit] = M.INPUTS[key];
      const v = live(e => { const p = M.popOf(c, opts.id); e.textContent = fmt(key === "pop_meg" ? p.meg : p.waste, "d2"); e.className = "v"; });
      return h("div", { class: "mrow out" }, lab(label), h("span", { class: "c" }, v), h("span", { class: "u", text: unit }),
        h("span", { class: "hint", text: key === "pop_meg" ? "сумма городов страны на карте" : "по доле пустошей в карточке страны на карте" }));
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
    // займы страны: кредитор, сумма, проценты. ГМ (и игрок в «Что если») выдаёт, правит и списывает займы
    function loansBlock() {
      const box = h("div", { class: "loans" });
      const crOptions = () => [["market", "Рынок (перерасход бюджета)"]]
        .concat(Object.keys(mapCountries).filter(x => x !== String(opts.id)).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru")).map(x => ["c:" + x, "Страна: " + countryName(x)]))
        .concat((rules.tables.corp || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "ru")).map(x => ["k:" + x.id, "Корпорация: " + x.name]));
      async function editLoan(L) {
        const v = await window.KGForm(L ? "Заём: " + M.debtCreditor(rules, L.cr) : "Новый заём", [
          { key: "cr", label: "Кредитор", type: "select", options: crOptions(), hint: "Стране-кредитору идут проценты; корпорации — уходят из экономики" },
          { key: "amt", label: "Сумма долга, млрд кр.", type: "number", step: "any", min: 0 },
          { key: "cash", label: "Деньги в этот ход", type: "select", options: [["1", "Да — разовая прибавка к бюджету (у страны-кредитора — расход)"], ["0", "Нет — только долг (старый долг, реструктуризация)"]] },
          { key: "note", label: "Заметка", type: "textarea" }
        ], L ? { cr: L.cr, amt: L.amt, cash: L.fresh > 0 ? "1" : "0", note: L.note || "" } : { cr: "market", amt: 10, cash: "1", note: "" },
        v => (!(+v.amt > 0) ? "Сумма должна быть больше нуля" : ""));
        if (!v) return;
        const o = { cr: v.cr, amt: +v.amt, fresh: v.cash === "1" ? +v.amt : 0, note: v.note || "" };
        if (L) Object.assign(L, o); else c.debt.loans.push(Object.assign({ id: uid("loan") }, o));
        draw(); changed();
      }
      const draw = () => {
        box.innerHTML = "";
        const D = M.debtState(c);
        c.debt = Object.assign(c.debt && typeof c.debt === "object" ? c.debt : {}, D);
        if (opts.editable) {
          const cb = h("input", { type: "checkbox" }); cb.checked = !!c.debt.def;
          cb.addEventListener("change", () => { c.debt.def = cb.checked; changed(); });
          box.append(h("label", { class: "debt-def", title: "Дефолт объявляется и снимается сам при переходе хода (порог — в Справочнике). Здесь его можно объявить или снять вручную." }, cb, " Дефолт: выплаты заморожены"));
        }
        if (!c.debt.loans.length) box.append(h("p", { class: "empty", text: "Займов нет." }));
        else {
          const body = h("tbody");
          for (const L of c.debt.loans) {
            const tr = h("tr", null, h("td", null, h("b", { text: M.debtCreditor(rules, L.cr) }), L.note ? h("small", { class: "sub", text: L.note }) : null),
              h("td", { class: "num", text: fmt(L.amt, "d1") + (L.fresh > 0 ? " (выдан в этот ход)" : "") }),
              h("td", { class: "num" }, live((e, r) => { e.textContent = r.debt_def ? "заморожены" : fmt(L.amt * r.debt_rate, "d2"); })));
            if (opts.editable) tr.append(h("td", { class: "btns" },
              h("button", { class: "small-btn", text: "✎", title: "Изменить", onclick: () => editLoan(L) }),
              h("button", { class: "small-btn danger", text: "Списать", title: "Списать долг (прощение, реструктуризация)", onclick: async () => {
                if (await ask("Списать долг «" + M.debtCreditor(rules, L.cr) + "» (" + fmt(L.amt, "d1") + " млрд кр.)?", "", { confirm: true })) { c.debt.loans.splice(c.debt.loans.indexOf(L), 1); draw(); changed(); }
              } })));
            body.append(tr);
          }
          box.append(h("div", { class: "mt-scroll" }, h("table", { class: "mt units loans-t" }, h("thead", null, h("tr", null, h("th", { text: "Кредитор" }), h("th", { class: "num", text: "Долг, млрд кр." }),
            h("th", { class: "num", text: "Проценты, млрд кр./год" }), opts.editable ? h("th") : null)), body)));
        }
        if (opts.editable) box.append(h("button", { class: "small-btn", text: "+ Заём", onclick: () => editLoan(null) }));
        box.append(h("p", { class: "hint", text: "Перерасход бюджета каждый ход уходит в долг «Рынку». Резерв («Прочее») гасит сначала его, затем остальные займы пропорционально. Проценты вычитаются из доходов до раздела по статьям." }));
      };
      draw();
      return box;
    }

    // обзор
    function overview() {
      const box = h("div", { class: "overview" });
      const kpi = (label, fn, sub) => h("div", { class: "kpi" }, h("span", { class: "kl", text: label }), live((e, r, b) => { e.textContent = fn(r); }, "kv"), sub ? live((e, r) => { e.textContent = sub(r); }, "ks") : null);
      box.append(h("div", { class: "kpis" },
        kpi("Место в рейтинге", r => r.rank + "", r => "ИНМ " + fmt(r.inm, "d1")),
        kpi("ВВП, млрд кр./год", r => fmt(r.gdp, "d1"), r => "рост " + fmt(r.d_gdp, "pct") + " за ход"),
        kpi("ВВП на душу", r => fmt(r.gdp_pc, "d1"), r => r.econ_level),
        kpi("Население, млн", r => fmt(r.pop_total, "d2"), r => "прирост " + fmt(r.d_pop, "pct")),
        kpi("Промышленная мощь", r => fmt(r.pm_eff, "d1"), r => "доля мирового экспорта " + fmt(r.world_share, "pct")),
        kpi("Бюджет, млрд кр.", r => fmt(r.budget, "d1"), r => "оборона " + fmt(r.def_budget, "d1")),
        kpi("Госдолг, % ВВП", r => fmt(r.debt_gdp, "pct"), r => r.debt_status.toLowerCase() + (r.debt_service > 0 ? " · проценты " + fmt(r.debt_service, "d1") + " млрд/год" : "")),
        kpi("Военная мощь", r => fmt(r.total_power, "d1"), r => fmt(r.world_mil_share, "pct") + " мировой"),
        kpi("Армия, тыс. чел.", r => fmt(r.active, "d1"), r => r.div_total + " див. · " + r.ships_total + " кор. · " + r.ac_total + " ЛА"),
        kpi("Стабильность", () => fmt(+c.in.stability, "d1"), r => (r.d_stab >= 0 ? "+" : "") + fmt(r.d_stab, "d2") + " за ход"),
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
      // связи стран и обстоятельства: эффекты считает калькулятор ГМа по положению партнёров, игрок видит только свои
      const lk = (opts.world && opts.world.links) || [];
      if (lk.length) {
        const by = new Map();
        for (const m of lk) { if (!by.has(m.link)) by.set(m.link, []); by.get(m.link).push(m); }
        const ll = h("div", { class: "links-list" });
        for (const ms of by.values()) ll.append(h("div", { class: "mod link" }, h("b", { text: ms[0].name }),
          h("span", { class: "mod-v", text: ms.map(m => linkVal(m) + " · " + targetName(m.target)).join(" · ") }), ms[0].note ? h("span", { class: "hint", text: ms[0].note }) : null));
        box.append(h("h3", { text: "Связи и обстоятельства" }),
          h("p", { class: "mech-note", text: "Следствия союзов, долгов и событий мира. Сила связей меняется вместе с положением стран-партнёров" + (opts.gm ? "; правятся во вкладке «Связи»." : ".") }), ll);
      }
      // займы, выданные страной: проценты от должников (свои долги — во вкладке «Экономика» → «Государственный долг»)
      const dl = (opts.world && opts.world.debt) || [];
      if (dl.length) {
        const dd = h("div", { class: "links-list" });
        for (const m of dl) dd.append(h("div", { class: "mod link" }, h("b", { text: m.name }),
          h("span", { class: "mod-v", text: (+m.value ? linkVal(m) + " млрд кр./год" : "выплат нет") + " · " + targetName(m.target) }), m.note ? h("span", { class: "hint", text: m.note }) : null));
        box.append(h("h3", { text: "Займы другим странам" }),
          h("p", { class: "mech-note", text: "Проценты от должников прибавляются к доходам бюджета. Свои долги — во вкладке «Экономика» → «Государственный долг»." }), dd);
      }
      // регионы (Старый Свет, Африка): угроза союза, договор, резолюции, треки
      const ow = (opts.world && opts.world.ow) || [];
      for (const d of M.REGIONS) {
        const mine = ow.filter(m => (m.rg || "eu") === d.id);
        if (!mine.length) continue;
        const by = new Map();
        for (const m of mine) { const k = m.name + "|" + m.note; if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
        const ol = h("div", { class: "links-list" });
        for (const ms of by.values()) ol.append(h("div", { class: "mod link" }, h("b", { text: ms[0].name }),
          h("span", { class: "mod-v", text: ms.map(m => linkVal(m) + " · " + targetName(m.target)).join(" · ") }), ms[0].note ? h("span", { class: "hint", text: ms[0].note }) : null));
        box.append(h("h3", { text: d.title }),
          h("p", { class: "mech-note", text: "Дела региона: " + (d.acc ? d.meterAcc + ", " + d.treaty + (d.treaty2 ? " и " + d.treaty2.name : "") + (d.fac ? ", " + d.fac.title.toLowerCase() : "") : d.meterAcc + " союза, " + d.treaty) + ", резолюции" + (d.tracks ? " и треки" : "") + ". Положение всех союзов — в Вики → Лор → Регионы → " + d.page + (opts.gm ? "; правится во вкладке «" + d.title + "»." : ".") }), ol);
      }
      if (opts.gm && c.dossier != null) {
        // справка из импорта: источники и что смоделировано. Игроку на странице не показывается
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
    if (M.isOldTurn(data)) {
      data.c.mods = M.quarterMods(data.c.mods);
      if (data.world && data.world.links) data.world.links = M.quarterMods(data.world.links);
    }
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
      h("span", { class: "mech-note", text: M.turnLabel(d.turn || mech.turn, d.year || mech.year) + (sandbox ? " · режим «Что если»: правки не сохраняются, ▲▼ — разница с текущим положением" : "") })));
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
    // связи стран и обстоятельства — только ГМу (зашифрованы мастер-ключом)
    gmLinks = [];
    if (mech.links) { try { gmLinks = M.normLinks(await C.decJSON(mk, mech.links)); } catch (e) { console.error(e); toast("Не удалось расшифровать связи стран"); } }
    if (M.isOldTurn(mech)) {
      for (const id in gmData) if (gmData[id]) gmData[id].mods = M.quarterMods(gmData[id].mods);
      gmLinks = M.quarterLinks(gmLinks);
    }
    snapshotBase();
  }
  function snapshotBase() {
    gmBase = {};
    try { gmBase = M.computeAll(rules, gmData, gmLinks, rgAllS()).results; } catch (e) { console.error(e); }
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
    mk = null; dks = {}; gmData = {}; gmSel = null; gmDirty = false; gmLinks = [];
    try { sessionStorage.removeItem(MK_KEY); } catch (e) { /* */ }
    mech = clone(mechPub); rules = pubRules(mech);
    fillArticleLists(); renderRef();
  }

  // черновик ГМа (в этом браузере)
  let draftTimer = null;
  function markDirty() {
    gmDirty = true;
    const dot = $("mechDirty"); if (dot) dot.classList.remove("hidden");
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: mechPub.updated, time: Date.now(), turn_months: M.TURN_MONTHS, mech, gmData, rules, gmLinks })); } catch (e) { toast("Не удалось сохранить черновик в браузере"); }
    }, 800);
  }
  async function offerDraft() {
    let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { /* */ }
    if (!d) return;
    const note = "Черновик от " + new Date(d.time).toLocaleString("ru-RU") + (d.base === mechPub.updated ? "." : ". Он сделан для более старой версии данных: опубликованное с тех пор будет перезаписано.");
    const ok = await ask("Восстановить неопубликованный черновик механик?", "", { confirm: true, note });
    if (!ok) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ } return; }
    const gmBox = mech.gm; // пароль ГМа мог смениться после черновика — оставляем актуальную обёртку ключа
    mech = d.mech; mech.gm = gmBox || mech.gm; gmData = d.gmData;
    // черновик, сохранённый при ходе длиной в год, переводим на квартал
    const oldDraft = M.isOldTurn(d);
    rules = M.normalizeRules(oldDraft ? M.quarterRules(d.rules) : d.rules);
    if (oldDraft) for (const id in gmData) if (gmData[id]) gmData[id].mods = M.quarterMods(gmData[id].mods);
    if (Array.isArray(d.gmLinks)) gmLinks = M.normLinks(oldDraft ? M.quarterLinks(d.gmLinks) : d.gmLinks);
    mech.turn_months = M.TURN_MONTHS;
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
      const { results, ctx } = M.computeAll(rules, gmData, gmLinks, rgAllS());
      const out = clone(mech);
      out.rules = rules;
      out.turn_months = M.TURN_MONTHS;
      out.updated = new Date().toISOString();
      if (gmLinks.length || out.links) out.links = await C.encJSON(mk, gmLinks);
      // регионы открыты всем: снимок доли силы и прироста угрозы для страниц регионов и «Союзов» (там данных стран нет)
      for (const d of M.REGIONS) {
        const st = out[d.p] = M.rgState(rules, d.id, out[d.p]); st.growth = {}; st.share = {};
        const rr = M.rgReport(rules, d.id, st, results, gmData);
        if (d.acc) { st.accGrowth = +(+rr.acc.growth || 0).toFixed(3); st.accParts = {}; for (const x of rr.acc.parts) st.accParts[x.id] = +(+x.v || 0).toFixed(3); continue; }
        for (const b of rr.blocs) { st.growth[b.id] = +b.growth.toFixed(3); st.share[b.id] = +b.share.toFixed(4); }
      }
      for (const id in out.countries) {
        if (!gmData[id] || !dks[id]) continue;
        out.countries[id].data = await C.encJSON(dks[id], { c: gmData[id], world: ctx[id], turn: out.turn, year: out.year, turn_months: M.TURN_MONTHS, at: out.updated });
        out.countries[id].pub = { inm: +results[id].inm.toFixed(2), rank: results[id].rank, econ: results[id].econ_level };
      }
      // дефолты открыты всем (суммы долгов видят только сами страны и ГМ)
      out.debtPub = { def: Object.keys(out.countries).filter(id => gmData[id] && M.debtState(gmData[id]).def) };
      // публичный рейтинг корпораций: только место, выручка и число стран
      const cw = M.corpWorld(rules, results);
      out.corpPub = {};
      for (const id in cw) out.corpPub[id] = { rank: cw[id].rank, rev: +cw[id].rev.toFixed(1), grp: +cw[id].grp.toFixed(1), n: cw[id].n };
      // карта с правками (население городов после хода и всё остальное, что ГМ не опубликовал) — тем же коммитом
      const KM = window.KGMap, mapPub = KM && KM.gm && KM.dirty ? await KM.publishFiles() : null;
      await GH.commit(config.repo, [{ path: "data/mech.json", content: JSON.stringify(out) }].concat(mapPub ? mapPub.files : []), "Механики: правки ГМа " + new Date().toLocaleString("ru-RU"));
      if (mapPub) KM.afterPublish(mapPub.st);
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
    const fileCorps = ids.filter(id => data.countries[id].corp && Object.keys(data.countries[id].corp).length).length;
    const v = await window.KGForm("Импорт стран: " + f.name, [
      { key: "mode", label: "Уже подключённые страны", type: "select", options: [["skip", "Не трогать"], ["replace", "Заменить данные (пароли игроков сохраняются)"]],
        hint: "В файле стран: " + all.length + ". Новых: " + fresh.length + ", уже подключено: " + have.length + (all.length > ids.length ? ", нет на карте: " + (all.length - ids.length) : "") + ". Новым странам пароли создаются автоматически — их можно посмотреть в карточке страны." },
      { key: "corp", label: "Корпорации в заменяемых странах", type: "select", options: [["file", "Взять из файла"], ["keep", "Оставить как есть"]],
        hint: fileCorps ? "В файле корпорации расставлены в " + fileCorps + " странах (присутствие, отношения, анклавы)." : "В файле корпораций нет — у заменяемых стран останутся прежние." },
      { key: "links", label: "Связи стран и обстоятельства", type: "select", options: [["file", "Заменить из файла"], ["keep", "Оставить как есть"]],
        hint: data.links ? "В файле связей: " + data.links.length + ". Сейчас в калькуляторе: " + gmLinks.length + "." : "В файле связей нет — останутся прежние (" + gmLinks.length + ")." }
    ], { mode: "skip", corp: fileCorps ? "file" : "keep", links: data.links && data.links.length ? "file" : "keep" });
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
        // заметки и собственные эффекты ГМа не трогаем; эффекты из прошлого импорта (imp_…) заменяются новыми;
        // корпорации — из файла или прежние (по выбору ГМа)
        c.notes = gmData[id].notes || "";
        if (v.corp !== "file" || !Object.keys(c.corp || {}).length) c.corp = gmData[id].corp || {};
        c.mods = (gmData[id].mods || []).filter(m => !String(m.id).startsWith("imp_")).concat(c.mods);
        // госдолг: стартовые займы — из файла, накопленный в игре долг и займы ГМа — прежние
        const D0 = M.debtState(gmData[id]);
        c.debt = { def: D0.def, loans: c.debt.loans.concat(D0.loans.filter(L => !L.id.startsWith("imp_"))) };
      }
      gmData[id] = c; n++;
      if (n % 10 === 0) toast("Импорт: " + n + " из " + todo.length + "…");
    }
    const linksIn = v.links === "file" && data.links;
    if (linksIn) gmLinks = data.links;
    if (!n && !linksIn) { toast("Новых стран нет — ничего не изменено"); return; }
    if (!n) { markDirty(); gmView = "links"; renderGm(); toast("Связи стран заменены: " + gmLinks.length + ". Проверьте и нажмите «Опубликовать»."); return; }
    gmSel = todo[0]; gmView = "countries";
    markDirty(); renderGm();
    toast("Импортировано стран: " + n + (linksIn ? ", связей: " + gmLinks.length : "") + ". Проверьте и нажмите «Опубликовать».");
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
    const { results } = M.computeAll(rules, gmData, gmLinks, rgAllS());
    const losses = ids.filter(id => results[id].sat_loss > 0).map(id => countryName(id) + ": " + results[id].sat_loss);
    // мусор: ожидаемые потери дробные — ГМ решает, кого задело (≥ 0,5 — скорее да)
    const debris = ids.filter(id => results[id].debris_loss >= 0.3).map(id => countryName(id) + " ≈ " + fmt(results[id].debris_loss, "d1"));
    if (debris.length) losses.push("от мусора: " + debris.join(", "));
    const y0 = M.firstYear(mech.turn, mech.year);
    const ok = await ask("Перейти к ходу " + (mech.turn + 1) + " (" + M.turnMonths(mech.turn + 1) + " " + M.turnYear(mech.turn + 1, y0) + ")?", "", { confirm: true,
      note: "У всех стран технологии, стабильность и население примут прогнозные значения (население городов на карте умножится на прирост и опубликуется вместе с механиками), перерасход бюджета уйдёт в госдолг, резерв погасит часть долга, а при долге от " + fmt(+rules.K.debt_default, "pct") + " ВВП будет объявлен дефолт. Бесчестье союзов Старого Света вырастет на прирост за ход." + (losses.length ? " Не забудьте убрать спутники, сошедшие с орбиты (" + losses.join("; ") + ")." : "") });
    if (!ok) return;
    const debtNews = [], grow = {};
    for (const id of ids) {
      const c = gmData[id], r = results[id];
      c.in.tech = +r.next_tech.toFixed(3);
      c.in.stability = +r.next_stab.toFixed(1);
      // население: прирост за ход умножает города страны на карте; в данных страны — то же число (запасной вариант без карты)
      const p = M.popOf(c, id);
      if (p.city) grow[id] = 1 + r.d_pop;
      c.in.pop_meg = +(p.meg * (1 + r.d_pop)).toFixed(3);
      c.in.pop_waste = +(p.waste * (1 + r.d_pop)).toFixed(3);
      const wasDef = M.debtState(c).def, D = M.debtNextTurn(rules, c, r);
      if (D.def !== wasDef) debtNews.push(countryName(id) + (D.def ? ": дефолт" : ": дефолт снят"));
    }
    for (const d of M.REGIONS) M.rgNextTurn(rules, d.id, rgS(d.id), results, gmData, mech.turn);
    const KM = window.KGMap, nCities = KM && KM.scaleCities && Object.keys(grow).length ? KM.scaleCities(grow) : 0;
    if (nCities) syncCityPop(KM.state);
    mech.turn++; mech.year = M.turnYear(mech.turn, y0);
    markDirty(); renderGm(); renderBlocs();
    toast(M.turnLabel(mech.turn, mech.year) + ". " + (debtNews.length ? "Госдолг — " + debtNews.join("; ") + ". " : "") + "Опубликуйте, чтобы игроки увидели.");
  }
  async function editTurn() {
    const v = await window.KGForm("Ход и год", [{ key: "turn", label: "Номер хода", type: "number", min: 1, hint: "1 ход = 3 месяца, 4 хода = игровой год." },
      { key: "y0", label: "Год первого хода", type: "number", hint: "Ход 1 — январь–март этого года. Год текущего хода считается сам." }],
      { turn: mech.turn, y0: M.firstYear(mech.turn, mech.year) });
    if (!v) return;
    mech.turn = Math.max(1, Math.round(+v.turn || 1)); mech.year = M.turnYear(mech.turn, +v.y0 || 2200); markDirty(); renderGm();
  }

  // значение эффекта связи: пункты, проценты или прибавка в единицах показателя
  const linkVal = m => (+m.value >= 0 ? "+" : "−") + fmt(Math.abs(+m.value), m.mode === "add" && Math.abs(+m.value) >= 10 ? "d1" : Math.abs(+m.value) < 1 ? "d3" : "d2").replace(/,0+$|(,\d*?)0+$/, "$1") + (m.mode === "pct" ? "%" : m.target === "d_stab" ? " за ход" : "");

  // ГМ: связи стран и обстоятельства (видит только ГМ; игрок — свои эффекты в карточке страны)
  let gmLinkQ = "";
  function gmLinksView() {
    const wrap = h("div", { class: "gm-links" });
    const kinds = M.LINK_KINDS, tName = k => (M.MOD_TARGETS.find(t => t[0] === k) || [, k])[1];
    const kindHint = {
      fixed: "Страны «Кому» получают эффект, как особый эффект ГМа. Стабильность — пункты за ход, остальное — проценты.",
      share: "Каждая страна «Откуда» теряет значение % показателя, страны «Кому» делят собранное между собой (прибавкой в единицах).",
      sync: "Все страны из обоих списков связаны: показатель каждой меняется на значение × зависимость × состояние партнёров. Зависимость больше у маленьких экономик, состояние от −1 (стабильность 0) до +1 (стабильность 70 и выше).",
      aid: "Страны «Откуда» платят цену, страны «Кому» получают значение × состояние доноров (полностью при стабильности 60 и выше, ноль при 20 и ниже).",
      echo: "Если показатель стран «Откуда» за ход падает, страны «Кому» получают значение × это падение. Для стабильности 2 значит: кризис отзывается вдвое громче."
    };
    const { ctx } = M.computeAll(rules, gmData, gmLinks, rgAllS());
    const effOf = L => Object.keys(ctx).flatMap(id => (ctx[id].links || []).filter(m => m.link === L.id).map(m => countryName(id) + ": " + linkVal(m) + " " + tName(m.target)));
    const ids = Object.keys(gmData).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    const changed = () => { markDirty(); renderGm(); };
    wrap.append(h("p", { class: "mech-note", text: "Связи стран и лорные обстоятельства: общие рынки, дань, дотации, кризисы. Таблицу видит только ГМ (она хранится зашифрованной), игрок видит в своей карточке только эффекты на свою страну с пояснением. Эффекты пересчитываются по положению стран-партнёров при каждом расчёте и уходят игрокам с публикацией." }));
    const q = h("input", { type: "search", placeholder: "Поиск по названию или стране…", value: gmLinkQ, oninput: () => { gmLinkQ = q.value; filter(); } });
    wrap.append(h("div", { class: "gm-links-top" }, q, h("span", { class: "mech-note", text: "Связей: " + gmLinks.length }), h("button", { class: "small-btn", text: "+ Связь", onclick: () => {
      gmLinks.unshift({ id: uid("link_"), name: "Новая связь", kind: "fixed", from: [], to: [], target: "d_stab", value: 0, cost_t: "", cost_v: 0, note: "", off: false }); gmLinkQ = ""; changed();
    } })));
    const cards = [];
    const chips = (L, f) => {
      const box = h("div", { class: "chips" });
      for (const id of L[f]) box.append(h("span", { class: "chip" }, countryName(id), h("button", { type: "button", text: "✕", title: "Убрать", onclick: () => { L[f] = L[f].filter(x => x !== id); changed(); } })));
      const add = h("select", { onchange: () => { if (add.value && !L[f].includes(add.value)) { L[f].push(add.value); changed(); } } },
        h("option", { value: "", text: "+ страна" }), ids.filter(id => !L[f].includes(id)).map(id => h("option", { value: id, text: countryName(id) })));
      box.append(add);
      return box;
    };
    const sel = (list, val, on) => { const s = h("select", { onchange: () => on(s.value) }, list.map(([v, l]) => h("option", { value: v, text: l }))); s.value = val || ""; return s; };
    const numIn = (val, on) => { const i = h("input", { type: "number", step: "any", class: "num", value: val, onchange: () => on(+i.value || 0) }); return i; };
    for (const L of gmLinks) {
      const eff = effOf(L);
      const name = h("input", { type: "text", class: "ln-name", value: L.name, onchange: () => { L.name = name.value.trim() || "Связь"; changed(); } });
      const note = h("textarea", { rows: 2, placeholder: "Пояснение для игрока (видно в его карточке)", onchange: () => { L.note = note.value; markDirty(); } });
      note.value = L.note || "";
      const card = h("section", { class: "link-card" + (L.off ? " off" : "") },
        h("div", { class: "lc-head" }, name, sel(kinds, L.kind, v => { L.kind = v; changed(); }),
          h("button", { class: "small-btn", text: L.off ? "Включить" : "Выключить", onclick: () => { L.off = !L.off; changed(); } }),
          h("button", { class: "small-btn danger", text: "✕", title: "Удалить связь", onclick: async () => { if (await ask("Удалить «" + L.name + "»?", "", { confirm: true })) { gmLinks.splice(gmLinks.indexOf(L), 1); changed(); } } })),
        h("p", { class: "mech-note", text: kindHint[L.kind] || "" }),
        h("div", { class: "lc-grid" },
          L.kind !== "fixed" ? h("label", null, h("span", { text: L.kind === "sync" ? "Участники" : "Откуда" }), chips(L, "from")) : null,
          h("label", null, h("span", { text: L.kind === "sync" ? "Ещё участники" : "Кому" }), chips(L, "to")),
          h("label", null, h("span", { text: "Показатель" }), sel(M.MOD_TARGETS, L.target, v => { L.target = v; changed(); })),
          h("label", null, h("span", { text: L.kind === "share" ? "Доля, %" : L.kind === "echo" ? "Множитель" : "Значение" }), numIn(L.value, v => { L.value = v; changed(); })),
          L.kind === "aid" ? h("label", null, h("span", { text: "Цена для доноров" }), sel([["", "— без цены —"]].concat(M.MOD_TARGETS), L.cost_t, v => { L.cost_t = v; changed(); })) : null,
          L.kind === "aid" ? h("label", null, h("span", { text: "Цена, % (у стабильности — пункты)" }), numIn(L.cost_v, v => { L.cost_v = v; changed(); })) : null),
        note,
        h("div", { class: "lc-eff" + (eff.length ? "" : " empty"), text: eff.length ? "Сейчас: " + eff.join(" · ") : L.off ? "Выключена" : "Сейчас эффекта нет" }));
      card.dataset.q = (L.name + " " + L.from.concat(L.to).map(countryName).join(" ") + " " + (L.note || "")).toLowerCase();
      cards.push(card); wrap.append(card);
    }
    if (!gmLinks.length) wrap.append(h("p", { class: "empty", text: "Связей нет. Их можно добавить кнопкой «+ Связь» или импортом стран из файла." }));
    const filter = () => { const t = gmLinkQ.trim().toLowerCase(); cards.forEach(c => c.classList.toggle("hidden", !!t && !c.dataset.q.includes(t))); };
    filter();
    return wrap;
  }

  // ГМ: регион (Старый Свет, Африка) — угроза союзов, прокси-войны, резолюции, договор, треки (всё публикуется открыто)
  // ГМ: регион с накоплением (Северная Америка) — шкала, кризисы, два договора, резолюции союза и стран, нарушители пакта
  function gmAcc(d) {
    const p = d.p, wrap = h("div", { class: "gm-ow" }), S = rgS(d.id), rep = rgReportNow(d.id), A = rep.acc;
    const changed = () => { markDirty(); renderGm(); renderBlocs(); };
    const logIt = (dd, why) => { S.log.push({ turn: mech.turn, bloc: "", d: +(+dd).toFixed(3), why }); S.log = S.log.slice(-60); };
    const addAcc = (dd, why) => { const v = +Math.max(0, Math.min(100, (S.acc || 0) + dd)).toFixed(3); logIt(v - (S.acc || 0), why); S.acc = v; };
    const st = n => stripZero(fmt(n, "d2"));
    wrap.append(h("p", { class: "mech-note", text: "Видно всем на странице «Лор → Регионы → " + d.page + "». " + d.meter + " растёт само кнопкой «Следующий ход»" +
      (d.fac ? " (быстрее, пока ни у одной силы нет большинства)" : "") + "; кризисы, уступки и резолюции вносит ГМ здесь. На 100 — «" + d.txt.full.toLowerCase() + "»: дальнейшее — решение ГМа." }));
    const tSel = (cur, sts, name, set) => {
      const s = h("select", { onchange: () => { set(s.value); logIt(0, name + ": " + (sts.find(t => t[0] === s.value) || [, ""])[1].toLowerCase()); changed(); } },
        sts.map(([v, l]) => h("option", { value: v, text: l })));
      s.value = cur;
      return h("div", { class: "ow-gm-row" }, h("label", null, h("b", { text: name + ": " }), s));
    };
    wrap.append(tSel(S.treaty, d.st, d.treaty, v => (S.treaty = v)));
    if (d.treaty2) wrap.append(tSel(S.treaty2, d.treaty2.st, d.treaty2.name, v => (S.treaty2 = v)));
    const aIn = h("input", { type: "number", step: "any", min: 0, max: 100, class: "num", value: S.acc, onchange: () => {
      const v = Math.max(0, Math.min(100, +aIn.value || 0)), dd = v - (S.acc || 0);
      if (Math.abs(dd) > 1e-9) { S.acc = v; logIt(dd, "Правка ГМа"); changed(); }
    } });
    const jump = n => h("button", { class: "small-btn", text: (n > 0 ? "+" : "−") + Math.abs(n), title: n > 0 ? "Кризис" : "Уступка", onclick: async () => {
      const why = await ask(d.meter + " " + (n > 0 ? "+" : "−") + Math.abs(n), n > 0 ? "Кризис" : "Уступка", { note: "Причина попадёт в открытый журнал " + d.meterGen + "." });
      if (why == null) return; addAcc(n, why || (n > 0 ? "Кризис" : "Уступка")); changed();
    } });
    wrap.append(h("section", { class: "ow-gm-card" + (A.stage >= 2 ? " bad" : "") }, h("h3", { text: d.meter + " · " + A.stageName.toLowerCase() }),
      h("div", { class: "ow-gm-row" }, h("label", null, d.meter + " ", aIn), " из 100" + (A.growth == null ? "" : " · за ход +" + st(A.growth))),
      h("div", { class: "ow-gm-row" }, "Кризис / уступка: ", jump(-5), jump(-2), jump(2), jump(5), jump(10))));
    // силы: вес и сдвиги (остальные — пропорционально)
    if (rep.fac) {
      const shift = (f, n) => { M.facShift(rules, d.id, S, f.id, n); logIt(0, "ГМ: «" + f.name + "» " + rgSign(n) + "% веса → " + st(S.fac[f.id]) + "%"); changed(); };
      wrap.append(h("section", { class: "ow-gm-card" }, h("h3", { text: d.fac.title + (rep.fac.lead ? " · ведут: " + rep.fac.rows.find(f => f.lead).name : " · большинства нет") }),
        h("p", { class: "mech-note", text: "Вес в сумме 100%. Сдвиг одной силы забирает или отдаёт долю остальным пропорционально. Большинство — с " + st(rep.fac.major) + "%." }),
        rep.fac.rows.map(f => {
          const fIn = h("input", { type: "number", step: "any", min: 0, max: 100, class: "num", value: st(f.w).replace(",", "."), onchange: () => { const dd = Math.max(0, Math.min(100, +fIn.value || 0)) - f.w; if (Math.abs(dd) > 1e-9) shift(f, +dd.toFixed(3)); } });
          return h("div", { class: "ow-gm-row" + (f.lead ? " on" : "") }, h("label", null, h("b", { text: f.name + " " }), fIn, "% "),
            [-10, -5, 5, 10].map(n => h("button", { class: "small-btn", text: (n > 0 ? "+" : "−") + Math.abs(n), onclick: () => shift(f, n) })));
        })));
    }
    // вторая шкала
    if (rep.s2) {
      const s2 = d.scale2;
      const sIn = h("input", { type: "number", step: "any", min: 0, max: 100, class: "num", value: S.acc2, onchange: () => {
        const v = Math.max(0, Math.min(100, +sIn.value || 0)), dd = v - (S.acc2 || 0);
        if (Math.abs(dd) > 1e-9) { S.acc2 = v; logIt(0, s2.name + ": правка ГМа → " + st(v)); changed(); }
      } });
      const j2 = n => h("button", { class: "small-btn", text: (n > 0 ? "+" : "−") + Math.abs(n), onclick: () => { S.acc2 = +Math.max(0, Math.min(100, (S.acc2 || 0) + n)).toFixed(3); logIt(0, s2.name + " " + rgSign(n) + " → " + st(S.acc2)); changed(); } });
      wrap.append(h("section", { class: "ow-gm-card" + (rep.s2.stage >= 2 ? " bad" : "") }, h("h3", { text: s2.name + " · " + rep.s2.stageName.toLowerCase() }),
        h("div", { class: "ow-gm-row" }, h("label", null, s2.name + " ", sIn), " из 100 · за ход +" + st(rep.s2.growth)),
        h("div", { class: "ow-gm-row" }, "Сдвиг: ", j2(-5), j2(-2), j2(2), j2(5), j2(10))));
    }
    // верность членов союза
    if (rep.loy) {
      wrap.append(h("section", { class: "ow-gm-card" }, h("h3", { text: d.loy.title }),
        h("p", { class: "mech-note", text: "0–100. Падает каждый ход со стадией; резолюции сдвигают её у принявшего (у резолюции союза — у всех членов). Выход из союза на карте оформляет ГМ." }),
        rep.loy.map(x => {
          const lIn = h("input", { type: "number", step: "any", min: 0, max: 100, class: "num", value: st(x.v).replace(",", "."), onchange: () => {
            const v = Math.max(0, Math.min(100, +lIn.value || 0));
            if (Math.abs(v - x.v) > 1e-9) { S.loy[x.id] = v; logIt(0, "Верность " + countryName(x.id) + ": правка ГМа → " + st(v)); changed(); }
          } });
          return h("div", { class: "ow-gm-row" + (x.st ? " bad" : "") }, h("label", null, flagEl(x.id), " ", countryName(x.id), " ", lIn), " · " + d.loy.st[x.st].toLowerCase());
        })));
    }
    const resT = rules.tables[p + "res"] || [];
    const card = (key, title, rows, actor) => {
      const resList = h("ul", { class: "ow-gm-res" }, rows.map(x => {
        const cb = h("input", { type: "checkbox", onchange: () => {
          const cur = S.res[key] = (S.res[key] || []).filter(id => id !== x.id);
          if (cb.checked) { cur.push(x.id); M.rgAccApply(rules, d.id, S, key, x, mech.turn); }
          else logIt(0, "Резолюция отменена: " + x.name);
          changed();
        } });
        cb.checked = (S.res[key] || []).includes(x.id);
        return h("li", null, h("label", null, cb, " ", h("b", { text: x.name }), h("small", { text: (actor ? "" : " · " + (x.who === "any" ? "любой член" : "лидер")) + (+x.dis ? " · " + d.meterAcc + " " + (+x.dis > 0 ? "+" : "") + x.dis : "") +
          (x.fac && +x.df ? " · вес " + rgSign(x.df) + "%" : "") + (d.scale2 && +x.d2 ? " · " + d.scale2.name.toLowerCase() + " " + rgSign(x.d2) : "") + (d.loy && +x.dl ? " · верность " + rgSign(x.dl) : "") })));
      }));
      return h("section", { class: "ow-gm-card" }, h("h3", { text: title }),
        h("details", null, h("summary", { text: "Резолюции (" + (S.res[key] || []).length + " в силе)" }), h("p", { class: "mech-note", text: "Галочка — резолюция принята: " + d.meterAcc + " и другие сдвиги применяются сразу, эффекты действуют, пока галочка стоит. Снятие галочки сдвиги не возвращает." }), resList));
    };
    for (const b of rep.blocs) wrap.append(card(b.id, b.name, resT.filter(x => (x.bloc || "") === b.id || !x.bloc), false));
    for (const a of rep.actors) wrap.append(card(a.id, countryName(a.country), a.rows, true));
    const land = rep.land.slice().sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    const vBox = h("div", { class: "chips" });
    for (const id of S.viol) vBox.append(h("span", { class: "chip" }, countryName(id), h("button", { type: "button", text: "✕", title: "Убрать", onclick: () => { S.viol = S.viol.filter(x => x !== id); changed(); } })));
    const vAdd = h("select", { onchange: () => { if (vAdd.value && !S.viol.includes(vAdd.value)) { S.viol.push(vAdd.value); logIt(0, "Нарушитель " + d.treatyGen + ": " + countryName(vAdd.value)); changed(); } } },
      h("option", { value: "", text: "+ страна" }), land.filter(id => !S.viol.includes(id)).map(id => h("option", { value: id, text: countryName(id) })));
    vBox.append(vAdd);
    wrap.append(h("section", { class: "ow-gm-card" }, h("h3", { text: "Нарушители " + d.treatyGen }),
      h("p", { class: "mech-note", text: d.notes.viol.replace(/\.$/, "") + ": " + st(rules.K[p + "_viol_stab"]) + " стабильности за ход, пока отметка стоит." }), vBox));
    wrap.append(regionView(d.id, rep, true));
    return wrap;
  }
  function gmRegion(rid) {
    if (rgDef(rid).acc) return gmAcc(rgDef(rid));
    const d = rgDef(rid), p = d.p, wrap = h("div", { class: "gm-ow" }), S = rgS(d.id), rep = rgReportNow(d.id);
    const changed = () => { markDirty(); renderGm(); renderBlocs(); };
    const logIt = (bloc, dd, why) => { S.log.push({ turn: mech.turn, bloc, d: +(+dd).toFixed(3), why }); S.log = S.log.slice(-60); };
    const addDis = (bloc, dd, why) => { S.dis[bloc] = +(Math.max(0, (S.dis[bloc] || 0) + dd)).toFixed(3); logIt(bloc, dd, why); };
    const trackBy = id => rep.tracks.find(t => t.id === id);
    const moveTrack = (id, dd, why) => {
      const t = trackBy(id); if (!t || !+dd) return;
      S.tr[id] = +Math.max(0, Math.min(t.max, (S.tr[id] || 0) + +dd)).toFixed(3);
      logIt("", 0, why + ": «" + t.name + "» " + rgSign(dd) + " → " + stripZero(fmt(S.tr[id], "d2")));
    };
    wrap.append(h("p", { class: "mech-note", text: "Видно всем на странице «Лор → Регионы → " + d.page + "». " + d.meter + " растёт само кнопкой «Следующий ход» (сила и размер союза); прокси-войны, снижения и резолюции вносит ГМ здесь. " +
      "С порога союз — агрессор: его члены получают штрафы, остальные союзы региона вправе объявить ему войну. Когда кто-то объявит войну агрессору, договор обычно расторгают." }));
    const tSel = h("select", { onchange: () => { S.treaty = tSel.value; logIt("", 0, d.treaty + ": " + (d.st.find(t => t[0] === tSel.value) || [, ""])[1].toLowerCase()); changed(); } },
      d.st.map(([v, l]) => h("option", { value: v, text: l })));
    tSel.value = S.treaty;
    wrap.append(h("div", { class: "ow-gm-row" }, h("label", null, h("b", { text: d.treaty + ": " }), tSel)));
    // треки
    for (const t of rep.tracks) {
      const tIn = h("input", { type: "number", step: "any", min: 0, max: t.max, class: "num", value: S.tr[t.id], onchange: () => {
        const v = Math.max(0, Math.min(t.max, +tIn.value || 0)), dd = v - (S.tr[t.id] || 0);
        if (Math.abs(dd) > 1e-9) { moveTrack(t.id, dd, "Правка ГМа"); changed(); }
      } });
      const step = n => h("button", { class: "small-btn", text: (n > 0 ? "+" : "−") + Math.abs(n), onclick: () => { moveTrack(t.id, n, "ГМ"); changed(); } });
      wrap.append(h("section", { class: "ow-gm-card" + (t.v >= t.max ? " bad" : "") }, h("h3", { text: t.name }),
        h("div", { class: "ow-gm-row" }, h("label", null, "Уровень ", tIn), " из " + t.max + (t.grow ? " · сам растёт на " + stripZero(fmt(t.grow, "d2")) + " за ход" : ""), step(-1), step(-0.5), step(0.5), step(1)),
        h("p", { class: "mech-note", text: "Задевает: " + (t.countries.map(countryName).join(", ") || "—") + "." + (t.row.desc ? " " + t.row.desc : "") })));
    }
    const resT = rules.tables[p + "res"] || [];
    for (const b of rep.blocs) {
      const disIn = h("input", { type: "number", step: "any", min: 0, class: "num", value: S.dis[b.id], onchange: () => {
        const v = Math.max(0, +disIn.value || 0), dd = v - (S.dis[b.id] || 0);
        if (Math.abs(dd) > 1e-9) { S.dis[b.id] = v; logIt(b.id, dd, "Правка ГМа"); changed(); }
      } });
      const proxy = n => h("button", { class: "small-btn", text: "+" + n, title: "Прокси-война или иной скачок: " + d.meterGen, onclick: async () => {
        const why = await ask(d.meter + " «" + b.name + "» +" + n, "Прокси-война", { note: "Причина попадёт в открытый журнал " + d.meterGen + "." });
        if (why == null) return; addDis(b.id, n, why || "Прокси-война"); changed();
      } });
      const avail = resT.filter(x => (x.bloc || "") === b.id || !x.bloc);
      const resList = h("ul", { class: "ow-gm-res" }, avail.map(x => {
        const on = (S.res[b.id] || []).includes(x.id);
        const cb = h("input", { type: "checkbox", onchange: () => {
          const cur = S.res[b.id] = (S.res[b.id] || []).filter(id => id !== x.id);
          if (cb.checked) {
            cur.push(x.id);
            if (+x.dis) addDis(b.id, +x.dis, "Резолюция: " + x.name); else logIt(b.id, 0, "Резолюция: " + x.name);
            if (x.track && +x.dt) moveTrack(x.track, +x.dt, "Резолюция «" + x.name + "»");
          } else logIt(b.id, 0, "Резолюция отменена: " + x.name);
          changed();
        } });
        cb.checked = on;
        return h("li", null, h("label", null, cb, " ", h("b", { text: x.name }), h("small", { text: " · " + (x.who === "any" ? "любой член" : "лидер") +
          (+x.dis ? " · " + d.meterAcc + " " + (+x.dis > 0 ? "+" : "") + x.dis : "") + (x.track && +x.dt && trackBy(x.track) ? " · «" + trackBy(x.track).name + "» " + rgSign(x.dt) : "") })));
      }));
      wrap.append(h("section", { class: "ow-gm-card" + (b.infamous ? " bad" : "") },
        h("h3", null, b.leader ? flagEl(b.leader) : null, " ", b.name, b.infamous ? h("small", { text: " · агрессор" }) : null),
        h("div", { class: "ow-gm-row" }, h("label", null, d.meter + " ", disIn), " из " + stripZero(fmt(rep.threshold, "d1")) +
          (b.growth == null ? "" : " · за ход +" + fmt(b.growth, "d2") + " (доля силы " + d.whereGen + " " + fmt(b.share, "pct") + ")") + " · членов " + b.members.length),
        h("div", { class: "ow-gm-row" }, "Прокси-война / скачок: ", proxy(1), proxy(2), proxy(4)),
        h("details", null, h("summary", { text: "Резолюции (" + (S.res[b.id] || []).length + " в силе)" }), h("p", { class: "mech-note", text: "Галочка — резолюция принята: " + d.meterAcc + " прибавляется сразу" + (rep.tracks.length ? ", трек сдвигается сразу" : "") + ", эффекты действуют, пока галочка стоит. Снятие галочки " + d.meterAcc + " и трек не возвращает." }), resList)));
    }
    // нарушители договора
    const land = rep.land.slice().sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    const vBox = h("div", { class: "chips" });
    for (const id of S.viol) vBox.append(h("span", { class: "chip" }, countryName(id), h("button", { type: "button", text: "✕", title: "Убрать", onclick: () => { S.viol = S.viol.filter(x => x !== id); changed(); } })));
    const vAdd = h("select", { onchange: () => { if (vAdd.value && !S.viol.includes(vAdd.value)) { S.viol.push(vAdd.value); logIt("", 0, "Нарушитель " + d.treatyGen + ": " + countryName(vAdd.value)); changed(); } } },
      h("option", { value: "", text: "+ страна" }), land.filter(id => !S.viol.includes(id)).map(id => h("option", { value: id, text: countryName(id) })));
    vBox.append(vAdd);
    wrap.append(h("section", { class: "ow-gm-card" }, h("h3", { text: "Нарушители " + d.treatyGen }),
      h("p", { class: "mech-note", text: d.notes.viol.replace(/\.$/, "") + ", пока договор в силе: " + stripZero(fmt(rules.K[p + "_viol_stab"], "d2")) + " стабильности за ход, пока отметка стоит." }), vBox));
    wrap.append(regionView(d.id, rep, true));
    return wrap;
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
    let all = M.computeAll(rules, gmData, gmLinks, rgAllS()), cw = M.corpWorld(rules, all.results);
    const lives = [];
    const live = (fn, tag, cls) => { const e = h(tag || "span", { class: cls || "" }); lives.push({ e, fn }); fn(e); return e; };
    const refresh = () => { all = M.computeAll(rules, gmData, gmLinks, rgAllS()); cw = M.corpWorld(rules, all.results); lives.forEach(L => L.fn(L.e)); };
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
      h("button", { class: "turn", title: "Изменить ход и год", text: M.turnLabel(mech.turn, mech.year), onclick: editTurn }),
      h("button", { class: gmView === "countries" ? "active" : "", text: "Страны", onclick: () => { gmView = "countries"; renderGm(); } }),
      h("button", { class: gmView === "corps" ? "active" : "", text: "Корпорации", onclick: () => { gmView = "corps"; renderGm(); } }),
      h("button", { class: gmView === "links" ? "active" : "", text: "Связи", title: "Связи стран и обстоятельства — видит только ГМ", onclick: () => { gmView = "links"; renderGm(); } }),
      M.REGIONS.map(d => h("button", { class: gmView === "rg:" + d.id ? "active" : "", text: d.title, title: (d.acc ? d.meter + ", " + d.treaty + (d.treaty2 ? ", " + d.treaty2.name : "") + (d.fac ? ", " + d.fac.title.toLowerCase() : "") : d.meter + " союзов, " + d.treaty) + ", резолюции" + (d.tracks ? ", треки" : "") + " — видно всем", onclick: () => { gmView = "rg:" + d.id; renderGm(); } })),
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
    if (gmView === "links") { box.append(gmLinksView()); return; }
    if (gmView === "ow") gmView = "rg:eu";
    if (gmView.startsWith("rg:")) { box.append(gmRegion(gmView.slice(3))); return; }
    const ids = Object.keys(gmData).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
    if (gmSel && !gmData[gmSel]) gmSel = null;
    if (!gmSel && ids.length) gmSel = ids[0];
    const { results, ctx } = M.computeAll(rules, gmData, gmLinks, rgAllS());
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
    if (e.detail) { fillArticleLists(); renderRef(); } // ГМ видит эффекты невыданных чудес
    renderGm(); renderBlocs(); renderHomeAuth();
    // вышел из режима ГМа, стоя на калькуляторе, — уводим на статью
    if (!e.detail && pane === "calc" && !$("wikiMech").classList.contains("hidden")) window.KG.go("wiki/mech/article", true);
    // вход ГМа восстановился уже после открытия адреса #wiki/mech/calc — показываем калькулятор
    if (e.detail && /^#wiki\/mech\/calc/.test(location.hash)) openPane("calc");
  });
  // «✎ Правка» включена или выключена — справочник, рейтинг и лор корпораций переключаются между чтением и правкой
  window.addEventListener("siteedit", async e => {
    // в режиме правки история регионов раскрыта, чтобы её было видно и можно было править
    if (e.detail) document.querySelectorAll("#loreArticle details.ow-lore").forEach(x => { x.open = true; });
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
    renderOldWorld,
    renderRegion,
    hasRegion: rid => M.REGIONS.some(d => d.id === rid),
    open: () => { window.KG.go("wiki/mech"); init(); },
    ready: () => init(),
    refreshArticle: () => fillArticleLists(),
    countryView: o => countryView(o), // для автотестов: карточка страны без входа
    get turn() { return mech ? { turn: mech.turn, year: mech.year, label: M.turnLabel(mech.turn, mech.year) } : null; },
    get rules() { return rules; },
    corpLabel: id => groupName(id),
    get model() { return M; }
  };
})();
