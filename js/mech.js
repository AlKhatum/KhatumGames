// Вкладка «Механики»: статья, справочник, рейтинг, кабинет игрока («Моя страна») и калькулятор ГМа.
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

  // ---------- загрузка ----------
  async function fetchJSON(url) {
    const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) { const e = new Error(url + ": " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function load() {
    const [cfg, mj, mp] = await Promise.all([
      fetchJSON("data/config.json"),
      fetchJSON("data/mech.json").catch(e => (e.status === 404 ? null : Promise.reject(e))),
      window.KGMap && window.KGMap.state ? Promise.resolve(window.KGMap.state) : fetchJSON("data/map.json")
    ]);
    config = cfg;
    mech = mj || { v: 1, updated: null, turn: 1, year: 2200, rules: null, gm: null, countries: {} };
    mech.countries = mech.countries || {};
    mechPub = clone(mech);
    rules = M.normalizeRules(mech.rules);
    mapCountries = (mp && mp.countries) || {};
  }
  async function init() {
    if (inited) return loading;
    inited = true;
    loading = (async () => {
      try { await load(); }
      catch (e) { $("mechRating").textContent = "Не удалось загрузить механики: " + e.message; console.error(e); return; }
      fillArticleLists();
      renderRef(); renderRating();
      await restorePlayer(); renderMy();
      await restoreGm(); renderGm();
    })();
    return loading;
  }

  // ---------- вкладки внутри «Механик» ----------
  let pane = "article";
  function openPane(name) {
    pane = name;
    document.querySelectorAll("#mechNav button").forEach(b => b.classList.toggle("active", b.dataset.mech === name));
    const ids = { article: "mechArticle", ref: "mechRef", rating: "mechRating", my: "mechMy", gm: "mechGM" };
    for (const k in ids) $(ids[k]).classList.toggle("hidden", k !== name);
    if (name === "gm") renderGm();
    if (name === "my" && !player && mech) renderMy();
  }
  document.querySelectorAll("#mechNav button").forEach(b => b.addEventListener("click", () => openPane(b.dataset.mech)));
  // оглавление статьи — прокрутка внутри страницы, без смены вкладки сайта
  document.querySelectorAll(".mech-toc a").forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    const t = document.querySelector(a.getAttribute("href"));
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  window.addEventListener("tabchange", e => { if (e.detail === "mech") init(); });
  if (location.hash === "#mech") init();

  function fillArticleLists() {
    const law = document.querySelector('[data-mech-list="law"]'), tier = document.querySelector('[data-mech-list="tier"]');
    const short = (v, f) => fmt(v, f).replace(/,0+(%?)$/, "$1");
    if (law) { law.innerHTML = ""; rules.tables.law.forEach((l, i) => law.append(h("li", null, h("b", { text: (i + 1) + ". " + l.name }), " — к призыву " + short(+l.share, "pct") + " МОП" + (+l.stab ? ", −" + String(l.stab).replace(".", ",") + " стабильности за ход" : "")))); }
    if (tier) { tier.innerHTML = ""; rules.tables.tier.slice().sort((a, b) => a.min - b.min).forEach(t => tier.append(h("li", null, h("b", { text: t.name }), " — от " + short(+t.min, "d1") + ". " + (t.desc || "")))); }
  }

  // ---------- справочник ----------
  function rulesView(editable, onChange) {
    const root = h("div", { class: "rules" });
    const changed = () => { fillArticleLists(); if (onChange) onChange(); };
    const order = ["div", "ac", "ship", "sat", "industry", "energy", "food", "law", "tier"];
    for (const t of order) {
      const meta = M.TABLES[t], rows = rules.tables[t];
      const sec = h("section", { class: "mblock" }, h("h3", { text: meta.title }));
      const tbl = h("table", { class: "mt rules-t" });
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
              cell = h("td", { class: type === "num" ? "num" : "", text: type === "sel" ? ((opts.find(o => o[0] === String(v)) || [, v])[1]) : type === "num" ? fmt(+v, Math.abs(+v) < 1 && +v !== 0 ? "d3" : "d2").replace(/,?0+$/, "") : v });
            } else if (type === "sel") {
              const s = h("select", { onchange: () => { row[f] = s.value; changed(); } }, opts.map(([v, l]) => h("option", { value: v, text: l })));
              s.value = String(row[f]); cell = h("td", null, s);
            } else {
              const inp = h("input", { type: type === "num" ? "number" : "text", step: "any", value: row[f] == null ? "" : row[f], class: type === "num" ? "num" : "",
                oninput: () => { row[f] = type === "num" ? (inp.value === "" ? 0 : +inp.value) : inp.value; changed(); } });
              cell = h("td", null, inp);
            }
            tr.append(cell);
          }
          if (editable) tr.append(h("td", null, h("button", { class: "small-btn danger", title: "Удалить строку", text: "✕", onclick: async () => {
            const ok = await ask("Удалить «" + (row.name || row.id) + "»?", "", { confirm: true, note: "У стран пропадут юниты этого типа (их количество перестанет учитываться)." });
            if (!ok) return; rows.splice(i, 1); draw(); changed();
          } })));
          body.append(tr);
        });
      };
      draw();
      tbl.append(body);
      sec.append(h("div", { class: "mt-scroll" }, tbl));
      if (editable) sec.append(h("button", { class: "small-btn", text: "+ Добавить строку", onclick: () => {
        const row = { id: uid(t + "_") };
        for (const [f, , type, opts] of meta.fields) row[f] = type === "num" ? 0 : type === "sel" ? opts[0][0] : (f === "name" ? "Новый тип" : "");
        rows.push(row); draw(); changed();
      } }));
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
  function renderRef() {
    const box = $("mechRef"); box.innerHTML = "";
    box.append(h("p", { class: "mech-note", text: "Действующие правила игры: характеристики юнитов, стоимость постройки и коэффициенты формул. Меняет их ГМ." }), rulesView(false));
  }

  // ---------- рейтинг ----------
  function renderRating() {
    const box = $("mechRating"); box.innerHTML = "";
    const list = Object.keys(mech.countries).filter(id => mech.countries[id].pub).map(id => Object.assign({ id }, mech.countries[id].pub)).sort((a, b) => a.rank - b.rank);
    box.append(h("p", { class: "mech-note" }, "Ход " + mech.turn + ", " + mech.year + " год. Индекс национальной мощи (ИНМ) сравнивает страну с мировым лидером по ВВП, армии, населению, технологиям, стабильности и спутникам." +
      (mech.updated ? " Обновлено " + new Date(mech.updated).toLocaleString("ru-RU") + "." : "")));
    if (!list.length) { box.append(h("p", { class: "empty", text: "ГМ ещё не опубликовал данные стран." })); return; }
    const tbl = h("table", { class: "mt rating" }, h("thead", null, h("tr", null, h("th", { text: "Место" }), h("th", { text: "Государство" }), h("th", { text: "ИНМ" }), h("th", { text: "Уровень экономики" }))));
    const body = h("tbody");
    for (const p of list) {
      body.append(h("tr", { class: p.rank <= 3 ? "top" + p.rank : "" }, h("td", { class: "num", text: String(p.rank) }), h("td", null, flagEl(p.id), " ", countryName(p.id)),
        h("td", { class: "num" }, h("span", { class: "bar" }, h("i", { style: "width:" + Math.max(2, Math.min(100, p.inm)) + "%" })), fmt(p.inm, "d1")), h("td", { text: p.econ || "—" })));
    }
    tbl.append(body);
    box.append(h("div", { class: "mt-scroll" }, tbl));
  }

  // ---------- карточка страны (общая для игрока и ГМа) ----------
  const LAYOUT = [
    { id: "overview", title: "Обзор" },
    { id: "state", title: "Государство", blocks: [
      ["Общие сведения", ["in:capital", "in:gov", "in:ideology", "in:position", "in:megapolis"]],
      ["Территория и среда", ["in:territory", "in:habitable", "out:habitable_area", "in:flooded", "in:radiation", "in:waste_threat", "in:climate"]],
      ["Население", ["in:pop_meg", "in:pop_waste", "out:pop_total", "out:urban", "out:pop_per_meg", "in:working_share", "in:mob_share", "in:education", "in:healthcare", "out:health", "out:labor"]],
      ["Политика и общество", ["in:stability", "in:support", "in:corruption", "in:mob_law", "out:mob_law_name", "in:tech", "out:tech_mult", "in:infra", "out:infra_mult", "out:stab_mult", "out:hdi", "out:inm", "out:rank"]]] },
    { id: "econ", title: "Экономика", blocks: [
      ["Энергетика", ["tab:energy", "out:en_supply", "out:en_demand", "out:en_balance", "out:en_coef"]],
      ["Промышленность", ["tab:industry", "out:ind_total", "out:labor_need", "out:labor_coef", "out:pm_base", "out:ind_eff", "out:pm_eff", "out:pm_pc", "out:vpk_eff", "out:ship_eff", "out:aero_eff"]],
      ["Сырьё, продовольствие, вода", ["in:raw", "out:raw_need", "out:raw_bal", "tab:food", "out:field_yield", "out:food_prod", "out:food_need", "out:food_coef", "in:water", "out:water_need", "out:water_coef"]],
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
      ["Орбита (общая для всего мира)", ["out:world_sats", "out:kessler", "out:kessler_status"]]] },
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
    if (+I.mob_law >= 4) w.push("Режим «" + r.mob_law_name + "» каждый ход снижает стабильность.");
    return w;
  }

  // opts: { c, world, editable, base, onChange, gm }
  function countryView(opts) {
    const c = opts.c;
    c.in = c.in || {}; c.cnt = c.cnt || {}; c.mods = c.mods || [];
    M.COUNT_TABLES.forEach(t => (c.cnt[t] = c.cnt[t] || {}));
    const lives = [];
    let r = null;
    const calc = () => { r = M.compute(rules, c); M.applyWorld(rules, c, r, opts.world); return r; };
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
      if (kind === "in") {
        const [label, unit, , , , hint] = M.INPUTS[key];
        return h("div", { class: "mrow in" + (opts.editable ? " edit" : "") }, h("span", { class: "l", text: label }), h("span", { class: "c" }, inField(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
      }
      const [label, unit, , okind, hint] = M.OUT[key];
      return h("div", { class: "mrow out" + (okind === "res" ? " is-res" : "") }, h("span", { class: "l", text: label }), h("span", { class: "c" }, outVal(key)), h("span", { class: "u", text: unit === "%" ? "" : unit }), h("span", { class: "hint", text: hint || "" }));
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
        const tr = h("tr", { class: cur ? "" : "zero" }, h("td", { text: rowT.name }), cell,
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
        kpi("Спутники", r => fmt(r.sat_total, "int"), r => "орбита: " + r.kessler_status.toLowerCase())
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
      box.append(h("h3", { text: opts.gm ? "Заметки ГМа для игрока" : "Заметки ГМа" }));
      if (opts.gm) {
        const ta = h("textarea", { class: "notes", rows: 6, placeholder: "Что видит игрок: итоги хода, события, ответы на заявки…" });
        ta.value = c.notes || "";
        ta.addEventListener("input", () => { c.notes = ta.value; if (opts.onChange) opts.onChange(r); });
        box.append(ta);
      } else box.append(h("div", { class: "notes-view", text: c.notes || "Пока заметок нет." }));
      return box;
    }

    const root = h("div", { class: "cv" });
    const tabs = h("div", { class: "cv-tabs" });
    const panes = {};
    for (const sec of LAYOUT) {
      const p = h("div", { class: "cv-pane hidden" });
      if (sec.id === "overview") p.append(overview());
      else if (sec.id === "effects") p.append(effectsPane());
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
  function renderMy() {
    const box = $("mechMy"); box.innerHTML = "";
    if (!C.ready()) { box.append(h("p", { class: "empty", text: "Вход в страну работает только по https." })); return; }
    if (!player) {
      const ids = Object.keys(mech.countries).filter(id => mech.countries[id].kp && mech.countries[id].data).sort((a, b) => countryName(a).localeCompare(countryName(b), "ru"));
      if (!ids.length) { box.append(h("p", { class: "empty", text: "Пока ни одна страна не подключена к механикам. Пароль для входа выдаёт ГМ." })); return; }
      const sel = h("select", null, ids.map(id => h("option", { value: id, text: countryName(id) })));
      const pw = h("input", { type: "password", placeholder: "Пароль страны", autocomplete: "current-password" });
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
          sandbox = false; renderMy();
        } catch (e) { fails++; err.textContent = e.name === "OperationError" ? "Неверный пароль" : e.message; }
        finally { btn.disabled = false; }
      };
      btn.onclick = go;
      pw.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") go(); });
      box.append(h("div", { class: "login-box" }, h("h2", { text: "Вход в страну" }),
        h("p", { class: "mech-note", text: "Выберите своё государство и введите пароль, который выдал ГМ. Данные страны зашифрованы этим паролем." }),
        h("label", { class: "f-row" }, h("span", { text: "Государство" }), sel), h("label", { class: "f-row" }, h("span", { text: "Пароль" }), pw), err, btn));
      return;
    }
    const id = player.id, d = player.data;
    const head = h("div", { class: "cv-head" }, flagEl(id, "big"), h("div", { class: "cv-title" }, h("h2", { text: countryName(id) }),
      h("span", { class: "mech-note", text: "Ход " + (d.turn || mech.turn) + ", " + (d.year || mech.year) + " год" + (sandbox ? " · режим «Что если»: правки не сохраняются, ▲▼ — разница с текущим положением" : "") })));
    const btns = h("div", { class: "cv-btns" });
    if (sandbox) btns.append(h("button", { text: "Сбросить", onclick: () => { player.c = clone(player.data.c); renderMy(); } }), h("button", { text: "Выйти из «Что если»", onclick: () => { sandbox = false; player.c = clone(player.data.c); renderMy(); } }));
    else btns.append(h("button", { class: "accent", text: "Что если…", title: "Прикинуть последствия решений. Правки не сохраняются", onclick: () => { sandbox = true; renderMy(); } }));
    btns.append(h("button", { text: "Выйти", onclick: () => { player = null; sandbox = false; try { sessionStorage.removeItem(PLAYER_KEY); } catch (e) { /* */ } renderMy(); } }));
    head.append(btns);
    box.append(head, countryView({ c: sandbox ? player.c : clone(player.data.c), world: d.world, editable: sandbox, base: sandbox ? player.base : null }));
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
      await GH.commit(config.repo, [{ path: "data/mech.json", content: JSON.stringify(out) }], "Механики: правки ГМа " + new Date().toLocaleString("ru-RU"));
      mech = out; mechPub = clone(out);
      gmDirty = false; try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ }
      snapshotBase();
      renderRef(); renderRating(); renderGm(); if (!player) renderMy();
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

  function renderGm() {
    const box = $("mechGM");
    if (!box || pane !== "gm" || !mech) return;
    box.innerHTML = "";
    if (!isGm()) {
      box.append(h("div", { class: "login-box" }, h("h2", { text: "Калькулятор ГМа" }),
        h("p", { class: "mech-note", text: "Здесь ГМ ведёт данные стран: вносит решения игроков, добавляет юниты и особые эффекты, настраивает правила и публикует результат. Игроки смотрят своё положение на вкладке «Моя страна»." }),
        h("button", { class: "accent", text: "🔒 Вход ГМ", onclick: () => window.KGMap && window.KGMap.login && window.KGMap.login() })));
      return;
    }
    if (!mk) {
      box.append(h("div", { class: "login-box" }, h("h2", { text: "Данные стран зашифрованы" }),
        h("p", { class: "mech-note", text: "Чтобы открыть калькулятор, расшифруйте данные паролем ГМа." }),
        h("button", { class: "accent", text: "Расшифровать", onclick: async () => { if (await unlockGm()) renderGm(); } })));
      return;
    }
    const top = h("div", { class: "gm-top" },
      h("button", { class: "turn", title: "Изменить ход и год", text: "Ход " + mech.turn + " · " + mech.year + " год", onclick: editTurn }),
      h("button", { class: gmView === "countries" ? "active" : "", text: "Страны", onclick: () => { gmView = "countries"; renderGm(); } }),
      h("button", { class: gmView === "rules" ? "active" : "", text: "Правила", onclick: () => { gmView = "rules"; renderGm(); } }),
      h("span", { class: "sp" }),
      h("button", { text: "+ Страна", onclick: addCountry }),
      h("button", { text: "Следующий ход", onclick: nextTurn }),
      h("span", { class: "gm-dirty" + (gmDirty ? "" : " hidden"), id: "mechDirty", title: "Есть неопубликованные правки", text: "●" }),
      h("button", { class: "accent", id: "mechPublish", text: "Опубликовать", onclick: publish }));
    box.append(top);
    if (gmView === "rules") {
      box.append(h("p", { class: "mech-note", text: "Правила общие для всех стран и видны всем во вкладке «Справочник». Новый тип юнита сразу появляется у всех стран с количеством 0." }),
        rulesView(true, () => { markDirty(); }));
      return;
    }
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
      main.append(countryView({ c: gmData[id], world: ctx[id], editable: true, gm: true, base: gmBase[id] || null, onChange: () => markDirty() }));
    }
    box.append(h("div", { class: "gm-grid" }, list, main));
  }

  // ---------- связь с режимом ГМа карты ----------
  window.addEventListener("gmchange", async e => {
    if (!inited) return;
    await loading;
    if (!e.detail) { lockGm(); renderRating(); }
    else if (!mk && gmPw && mech.gm) await unlockGm(); // только что вошёл паролем — расшифровываем сразу
    renderGm();
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
    open: () => { window.KG.openTab("mech"); init(); },
    get model() { return M; }
  };
})();
