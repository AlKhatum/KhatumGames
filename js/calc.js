// Калькулятор и показатели войск (тестовая версия). Данные: data/calc.json, формулы: js/calc-model.js.
// Публично в Вики → Механики → «Войска»: рейтинг (Индекс национальной мощи), справочник типов, структура звена и эскадры.
// «Калькулятор» виден только администратору (ГМу), «Моя страна» — игроку после входа по паролю страны (только просмотр).
(function () {
  "use strict";
  const KG = window.KG, M = window.KGMechanics, Model = window.KGCalcModel;
  if (!KG || !M || !Model) return;

  const DRAFT = "kg-calc-draft", PLAYER = "kg-dup-player";
  let D = null, loading = null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const NB = " ";
  function num(x, d) {
    if (x == null || !isFinite(x)) return "—";
    d = d == null ? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2) : d;
    return Number(x).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/ /g, NB);
  }
  const pct = x => num(x * 100, 0) + "%";
  const T = (head, rows, cls) => '<div class="mt-wrap"><table class="mt' + (cls ? " " + cls : "") + '"><thead><tr>' + head.map(x => "<th>" + x + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map(r => "<tr>" + r.map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
  const NOTE = t => '<p class="mech-note">' + t + "</p>";
  const GMN = t => '<p class="mech-note gm-note gm-only">Для администратора: ' + t + "</p>";
  const countryEntries = () => Object.entries(D.countries).map(([id, c]) => [id, c.name]).sort((a, b) => a[1].localeCompare(b[1], "ru"));

  function countryCombo(sel, mount) {
    const root = h("div", "country-combo"), toggle = h("button", "country-combo-toggle"), value = h("span", "country-combo-value"), pop = h("div", "country-combo-pop hidden");
    const search = h("input", "country-combo-search"), list = h("div", "country-combo-list"), empty = h("div", "country-combo-empty hidden", "Ничего не найдено");
    toggle.type = "button"; toggle.setAttribute("aria-haspopup", "listbox"); toggle.setAttribute("aria-expanded", "false");
    value.textContent = "Выберите страну"; toggle.append(value, h("span", "country-combo-arrow", "▾"));
    search.type = "search"; search.placeholder = "Поиск страны…"; search.setAttribute("aria-label", "Поиск страны");
    list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Страны"); pop.append(search, list, empty); root.append(toggle, pop);
    if (mount !== false && sel.parentNode) sel.parentNode.insertBefore(root, sel.nextSibling);
    sel.classList.add("country-native-hidden"); sel.setAttribute("aria-hidden", "true"); sel.tabIndex = -1;
    const norm = s => String(s).toLocaleLowerCase("ru").replace(/ё/g, "е");
    let items = [], visible = [], active = 0;
    const read = () => { items = [...sel.options].map(o => [o.value, o.textContent]).sort((a, b) => a[1].localeCompare(b[1], "ru")); };
    const sync = () => {
      read(); toggle.disabled = sel.disabled; root.classList.toggle("disabled", sel.disabled);
      const found = items.find(x => x[0] === sel.value); value.textContent = found ? found[1] : "Выберите страну";
      toggle.setAttribute("aria-label", "Государство: " + value.textContent);
    };
    const close = focus => { pop.classList.add("hidden"); root.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); if (focus) toggle.focus(); };
    const draw = () => {
      const q = norm(search.value.trim()); visible = items.filter(x => !q || norm(x[1]).includes(q)); active = Math.max(0, Math.min(active, visible.length - 1));
      list.replaceChildren(); empty.classList.toggle("hidden", !!visible.length);
      visible.forEach((x, i) => {
        const b = h("button", "country-combo-option" + (x[0] === sel.value ? " selected" : "") + (i === active ? " active" : ""), esc(x[1]));
        b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", x[0] === sel.value ? "true" : "false"); b.dataset.value = x[0];
        b.onclick = () => { sel.value = x[0]; sync(); sel.dispatchEvent(new Event("change", { bubbles: true })); close(true); };
        list.append(b);
      });
      const current = list.children[active]; if (current) current.scrollIntoView({ block: "nearest" });
    };
    const open = () => {
      if (sel.disabled) return;
      document.querySelectorAll(".country-combo.open").forEach(x => { if (x !== root) { x.classList.remove("open"); x.querySelector(".country-combo-pop").classList.add("hidden"); x.querySelector(".country-combo-toggle").setAttribute("aria-expanded", "false"); } });
      sync(); search.value = ""; active = Math.max(0, items.findIndex(x => x[0] === sel.value)); draw();
      pop.classList.remove("hidden"); root.classList.add("open"); toggle.setAttribute("aria-expanded", "true"); search.focus();
    };
    toggle.onclick = () => root.classList.contains("open") ? close(false) : open();
    search.oninput = () => { active = 0; draw(); };
    search.onkeydown = e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + Math.max(1, visible.length)) % Math.max(1, visible.length); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); const b = list.children[active]; if (b) b.click(); }
      else if (e.key === "Escape") { e.preventDefault(); close(true); }
    };
    root.addEventListener("focusout", () => setTimeout(() => { if (!root.contains(document.activeElement)) close(false); }, 0));
    document.addEventListener("pointerdown", e => { if (!root.contains(e.target)) close(false); });
    sync();
    return { el: root, sync };
  }

  // ---------- данные и черновик ГМа ----------
  const clone = o => JSON.parse(JSON.stringify(o));
  let TS = { start: { year: 2200, q: 1 }, n: 0, log: [], cur: {}, worldSnap: null, stamp: 0, measures: [], pending: [] }; // состояние хода и журнал
  function load() {
    if (!loading) loading = Promise.all([
      fetch("data/calc.json", { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error("calc.json: " + r.status); return r.json(); }),
      fetch("data/turns.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null)]).then(([d, t]) => {
      D = d;
      if (t && t.log) TS = Object.assign(TS, t);
      for (const id in TS.cur || {}) if (D.countries[id]) Object.assign(D.countries[id], TS.cur[id]); // состояние кампании поверх стартовых данных
      try {
        const dr = JSON.parse(localStorage.getItem(DRAFT) || "null");
        if (dr && dr.countries && dr.ver === D.ver && n0(dr.turn && dr.turn.stamp, 0) >= n0(TS.stamp, 0)) { // черновик от другой версии стартовых данных не подмешивается // черновик ГМа новее файла
          for (const id in dr.countries) if (D.countries[id]) D.countries[id] = Object.assign({}, D.countries[id], dr.countries[id]);
          if (dr.turn && dr.turn.log) TS = Object.assign(TS, dr.turn);
        }
      } catch (e) { /* */ }
      D.worldSnap = TS.worldSnap || null; syncMeasures();
      for (const id in D.countries) D.countries[id].cid = id;
      return D;
    });
    return loading;
  }
  const n0 = (x, d) => (x == null || isNaN(x) ? d : +x);
  function syncMeasures() { if (D) { D.measures = TS.measures || []; D.turnN = TS.n; } }
  let orig = null;
  function saveDraft() {
    try { localStorage.setItem(DRAFT, JSON.stringify({ ver: D.ver, countries: D.countries, turn: TS })); } catch (e) { if (window.KG && KG.toast) KG.toast("Черновик не поместился в браузер: скачайте журнал и закрепите его (python Лор/ход.py)"); }
  }
  const results = () => { const ids = Object.keys(D.countries), rs = ids.map(i => Model.country(D, D.countries[i])), ix = Model.inm(D, rs); Model.market(D, ids, rs); return { ids, rs, ix }; };

  // ---------- ход: проведение, откат, журнал ----------
  const turnNow = () => Model.turnLabel(TS.start, TS.n);
  function curState() { const cur = {}; for (const id in D.countries) { const c = D.countries[id], o = {}; for (const f of Model.TURN_FIELDS) if (c[f] !== undefined) o[f] = clone(c[f]); cur[id] = o; } return cur; }
  function endTurn() {
    const { ids, rs } = results(), a = Model.advance(D, ids, rs, TS.n);
    a.entry.label = Model.turnLabel(TS.start, TS.n + 1); a.entry.ts = Date.now(); a.entry.worldBefore = clone(D.worldSnap);
    a.entry.priceUpdate = a.updPrices;
    for (const id of ids) Object.assign(D.countries[id], a.patches[id]);
    if (a.world) D.worldSnap = a.world;
    a.entry.measuresBefore = clone(TS.measures || []); a.entry.measureEvents = (TS.pending || []).slice(); TS.pending = [];
    TS.n++;
    const gone = (TS.measures || []).filter(m => m.until != null && TS.n >= m.until); // срок мер истёк
    for (const m of gone) a.entry.measureEvents.push({ t: "Срок истёк: " + measureText(m), ids: [m.by, m.against] });
    a.entry.fxExpired = [];
    for (const id of ids) {
      const c = D.countries[id], old = (c.fx || []).filter(f => f.until != null && TS.n >= f.until); if (!old.length) continue;
      c.fx = c.fx.filter(f => !old.includes(f));
      for (const f of old) { a.entry.fxExpired.push({ cid: id, f: clone(f) }); a.entry.measureEvents.push({ t: "Срок истёк: эффект «" + f.name + "» (" + c.name + ")", ids: [id], gm: f.vis === "gm" }); }
    }
    TS.measures = (TS.measures || []).filter(m => !gone.includes(m)); syncMeasures();
    TS.log.push(a.entry);
    TS.log.slice(0, -12).forEach(e => { if (!e.noRollback) { e.noRollback = true; for (const id in e.countries) e.countries[id].before = {}; e.worldBefore = null; e.measuresBefore = null; } }); // откат — только на последние 12 ходов
    TS.cur = curState(); TS.worldSnap = D.worldSnap; TS.stamp = Date.now(); saveDraft();
    return a.entry;
  }
  function rollbackTo(n) { // вернуть состояние на начало хода n: ходы n и позже отменяются
    const k = TS.log.findIndex(e => e.n === n); if (k < 0 || TS.log.slice(k).some(e => e.noRollback)) return;
    for (let i = TS.log.length - 1; i >= k; i--) {
      const e = TS.log[i];
      for (const id in e.countries) { const c = D.countries[id]; if (!c) continue; for (const f of Model.TURN_FIELDS) { const v = e.countries[id].before[f]; if (v === undefined) continue; if (v === null) delete c[f]; else c[f] = clone(v); } }
      D.worldSnap = e.worldBefore || null;
      for (const x of e.fxExpired || []) { const c = D.countries[x.cid]; if (c && !(c.fx || []).some(f => f.id === x.f.id)) (c.fx = c.fx || []).push(clone(x.f)); }
    }
    for (const c of Object.values(D.countries)) { const late = (c.fx || []).filter(f => n0(f.from, 0) > k); for (const f of late) undoOnce(c, f); if (late.length) c.fx = c.fx.filter(f => !late.includes(f)); }
    if (TS.log[k].measuresBefore) TS.measures = clone(TS.log[k].measuresBefore);
    TS.pending = [];
    TS.log.length = k; TS.n = k; syncMeasures(); TS.cur = curState(); TS.worldSnap = D.worldSnap; TS.stamp = Date.now(); saveDraft();
  }
  // ---------- санкции и блокады ----------
  const cname = id => (id === "*" ? "все страны" : ((D.countries[id] || {}).name || id));
  const prodNames = pr => (pr == null || pr === "all" ? "все продукты" : pr.map(i => ((D.products || []).find(x => x.id === i) || {}).name || i).join(", "));
  const KINDS = { "sanction:ban": "Санкции: запрет", "sanction:tariff": "Санкции: надбавка к тарифу", blockade: "Физическая блокада", other: "Иное ограничение" };
  const kindOf = m => (m.kind === "sanction" ? "sanction:" + (m.mode || "ban") : m.kind);
  function measureText(m) {
    const w = cname(m.by) + " → " + cname(m.against);
    if (m.kind === "blockade") return "блокада " + w + ", перекрытие " + pct(n0(m.share, 0));
    if (m.kind === "other") return "ограничение " + w + " (" + prodNames(m.products) + "), квота " + pct(n0(m.mult, 1));
    return (m.mode === "tariff" ? "надбавка +" + pct(n0(m.tariff, 0)) + " к пошлине " : "запрет торговли ") + w + " (" + prodNames(m.products) + ")";
  }
  const untilText = m => (m.until == null ? "бессрочно" : "до хода " + m.until + " (" + Math.max(0, m.until - TS.n) + " ход.)");
  function measuresTable(filterId) {
    const list = (TS.measures || []).filter(m => !filterId || m.by === filterId || m.against === filterId || m.against === "*");
    if (!list.length) return NOTE(filterId ? "Санкций и блокад с участием вашей страны нет." : "Сейчас санкций и блокад нет.");
    return T(["Вид", "Кто вводит", "Против", "Что", "Срок", "Заметка"], list.map(m => [KINDS[kindOf(m)], esc(cname(m.by)), esc(cname(m.against)), esc(m.kind === "blockade" ? "перекрытие " + pct(n0(m.share, 0)) + " всей торговли и снабжения" : m.kind === "other" ? prodNames(m.products) + ", квота " + pct(n0(m.mult, 1)) : prodNames(m.products) + (m.mode === "tariff" ? ", +" + pct(n0(m.tariff, 0)) + " к пошлине" : "")), untilText(m), esc(m.note || "—")]));
  }
  function measureEffects(r, c) { // что мера делает со страной
    const ms = r.ms || { against: [], by: [] }, rows = [];
    if (ms.blockShare > 0) rows.push(["Под блокадой", pct(ms.blockShare) + ": мощь −" + pct(D.K.blk_power * ms.blockShare) + ", стабильность −" + num(D.K.blk_stab * ms.blockShare, 1) + " п., торговля урезана"]);
    if (ms.against.some(m => m.kind === "sanction")) rows.push(["Под санкциями", ms.against.filter(m => m.kind === "sanction").length + " шт.: запреты и пошлины в торговле"]);
    if (ms.byBlk > 0) rows.push(["Содержание блокады", "+" + num(r.blkCost, 1) + " млрд кр. за ход к содержанию войск"]);
    if (ms.bySanc || ms.byBlk) rows.push(["Стабильность вводящего", "−" + num(Math.min(D.K.meas_stab_cap, D.K.meas_stab_sanc * ms.bySanc + D.K.meas_stab_blk * ms.byBlk), 1) + " п. (итог " + num(r.stabAdj, 0) + "%)"]);
    return rows.length ? kv(rows) : "";
  }

  const downloadJournal = () => { const blob = new Blob([JSON.stringify(Object.assign({}, TS, { stamp: Date.now() }), null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "turns.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  // журнал: ГМ видит все страны и события; игрок — только свою страну
  function journalHtml(onlyId) {
    if (!TS.log.length) return NOTE("Ходов ещё не было.");
    const rows = [];
    for (const e of TS.log.slice().reverse()) for (const [id, v] of Object.entries(e.countries)) {
      if (onlyId && id !== onlyId) continue;
      rows.push([e.n, esc(e.label)].concat(onlyId ? [] : [esc(v.name)]).concat([num(v.gdp, 1), pct(v.supplyTrade == null ? v.supply : v.supplyTrade), num(v.balance, 1), num(v.treasury, 0), num(v.pol, 1) + " → " + num(v.polNext, 1), esc(v.events.join(" · ") || "—")]));
    }
    const mrows = [];
    for (const e of TS.log.slice().reverse()) for (const ev of e.measureEvents || []) { if (onlyId && (ev.gm || (!(ev.ids || []).includes(onlyId) && !(ev.ids || []).includes("*")))) continue; mrows.push([e.n, esc(e.label), "Решения ГМа", esc(ev.t)]); }
    return T(["Ход", "Дата"].concat(onlyId ? [] : ["Страна"]).concat(["ВВП за ход", "Стройки (с импортом)", "Торговый баланс", "Казна", "Загрязнение", "События"]), rows) +
      (mrows.length ? "<h4>Решения ГМа: санкции, блокады, особые эффекты</h4>" + T(["Ход", "Дата", "Раздел", "Что произошло"], mrows) : "");
  }
  function journalMeasures() {
    const rows = []; for (const e of TS.log.slice().reverse()) for (const ev of e.measureEvents || []) rows.push([e.n, esc(e.label), esc(ev.t)]);
    return rows.length ? "<h3>История решений</h3>" + T(["Ход", "Дата", "Что произошло"], rows) : "";
  }
  function turnBlock(onlyId) {
    return "<h3>Ход " + TS.n + " · " + esc(turnNow()) + "</h3>" + (onlyId ? "" : "") + journalHtml(onlyId);
  }

  // ---------- доступ ----------
  const isGm = () => document.body.classList.contains("is-gm");
  const playerId = () => { try { return sessionStorage.getItem(PLAYER) || ""; } catch (e) { return ""; } };
  const allowed = gate => !gate || (gate === "gm" && isGm()) || (gate === "player" && (isGm() || !!playerId()));
  const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");

  // ---------- подразделы «Армии» и картинки-заглушки ----------
  const PH_EXT = "svg"; // заглушки 1280x720 лежат в assets/ph/<id>.svg; готовую картинку положите рядом и смените расширение
  // картинка-шапка 1280x720: в режиме правки ГМ загружает свою (KGSite.imgSlot), пока её нет, видна заглушка из assets/ph
  const ph = (id, alt) => '<div data-slot="ph.' + esc(id) + '" data-label="' + esc(alt || id) + '"></div>';
  function fillSlots(root) {
    const S = window.KGSite;
    root.querySelectorAll("[data-slot]").forEach(el => { if (S && S.imgSlot) el.replaceWith(S.imgSlot(el.dataset.slot, el.dataset.label)); });
  }
  const armyPage = M.pages.find(p => p.id === "army");
  if (armyPage) {
    for (const s of armyPage.sections) if (["divisions", "attach", "navy", "air", "armies"].includes(s.id)) s.html = '<div data-calc="ph" data-ph="' + s.id + '"></div>' + s.html;
    const at = armyPage.sections.findIndex(s => s.id === "summary");
    armyPage.sections.splice(at < 0 ? armyPage.sections.length : at, 0,
      { id: "t-div", title: "Типы дивизий", html: '<p>Пять типов дивизий. Параметры от 1 до 100 заданы для технологического уровня 5, при другом уровне умножаются на коэффициент технологий.</p><div data-calc="divs"></div>' },
      { id: "t-air", title: "Самолёты и авиационные звенья", html: '<p>Звено собирается из отдельных самолётов: истребителей, штурмовиков, тактических и стратегических бомбардировщиков, вертолётов, БПЛА и других. В звене до 12 самолётов, состав смешанный. Новые типы: тактический бомбардировщик и ударный вертолёт.</p><div data-calc="air"></div>' },
      { id: "t-ships", title: "Корабли и эскадры", html: '<p>Эскадра собирается из отдельных кораблей, в ней до 10 кораблей, состав смешанный. Классы и подклассы взяты из прежней версии армии.</p><div data-calc="ships"></div>' },
      { id: "t-struct", title: "Структура звена и эскадры", html: '<div data-calc="structure"></div>' });
  }

  const resPage = M.pages.find(p => p.id === "resources");
  if (resPage) {
    const at = resPage.sections.findIndex(x => x.id === "summary");
    resPage.sections.splice(at < 0 ? resPage.sections.length : at, 0,
      { id: "t-measures", title: "Действующие санкции и блокады", html: '<p>Сейчас действуют такие меры. Санкции запрещают торговлю по продуктам или повышают пошлину; физическая блокада перекрывает долю торговли и снабжения цели; иные ограничения задают квоту. Меры вводит и снимает администратор.</p><div data-calc="measures"></div>' });
  }
  const ecoPage = M.pages.find(p => p.id === "economy");
  if (ecoPage) {
    const at = ecoPage.sections.findIndex(s => s.id === "summary");
    ecoPage.sections.splice(at < 0 ? ecoPage.sections.length : at, 0,
      { id: "t-ind", title: "Показатели страны", html: '<p>Из чего складываются экономические показатели государства: площадь для стройки, выпуск ресурсов, обеспеченность строек, наука и частный сектор. Значения по каждой стране берутся из её паспорта и статьи в лоре.</p><div data-calc="ecoind"></div>' });
  }

  // ---------- публичные таблицы ----------
  const n0c = x => (x == null || isNaN(x) ? 0 : +x);
  const bar = (v, max) => '<span class="cbar"><i style="width:' + Math.max(1, Math.round(100 * v / max)) + '%"></i></span>';
  function tRating() {
    const { ids, rs, ix } = results();
    const rows = ids.map((id, k) => ({ id, n: D.countries[id].name, r: rs[k], x: ix[k] })).sort((a, b) => b.x.total - a.x.total);
    return GMN("тестовые данные: шесть стран из исходных таблиц. Числа пересчитываются по новым формулам, цифры не окончательные.") +
      T(["#", "Страна", "ИНМ", "Экономика", "Армия", "Технологии", "Население", "ВВП, млрд кр./год", "Мощь войск"], rows.map((o, i) => [i + 1,
        '<a href="#wiki/lore/states/' + esc(loreId(o.id)) + '">' + esc(o.n) + "</a>", "<b>" + num(o.x.total, 1) + "</b> " + bar(o.x.total, 100), num(o.x.eco, 0), num(o.x.army, 0), num(o.x.tech, 0), num(o.x.pop, 0), num(o.r.eco.gdpYear), num(o.r.power)]), "rating-t");
  }
  let loreIdx = null;
  KG.lore().then(L => { loreIdx = L.byMap || {}; });
  const loreId = id => (loreIdx && loreIdx[id] ? loreIdx[id].id : id);
  const dl = rows => '<dl class="tc-kv">' + rows.filter(r => r[1] !== "" && r[1] != null).map(r => "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
  const card = (id, name, tag, rows, isNew) => '<div class="tcard">' + ph(id, name) + "<h4>" + esc(name) + (isNew ? ' <span class="prop">новое</span>' : "") + "</h4>" + (tag ? '<div class="tc-tag">' + esc(tag) + "</div>" : "") + dl(rows) + "</div>";
  function tDivs() {
    return '<div class="tcards">' + D.divTypes.map(t => card("div-" + t.id, t.name, t.role, [["Атака", t.atk.join(" / ") + " (масштаб / мощь / стремительность)"], ["Оборона", t.dfn.join(" / ") + " (протяжённость / сила / реагирование)"],
      ["Снабжение", t.sup + " ед./ход"], ["Личный состав", t.pers + " тыс."], ["Содержание", t.upkeep + " млрд/год"]])).join("") + "</div>";
  }
  function tAir() {
    return '<div class="tcards">' + D.aircraft.map(t => card("ac-" + t.id, t.name, t.role + " · " + t.rod, [["Атака / оборона / манёвр", t.atk + " / " + t.dfn + " / " + t.man], ["Снабжение", t.sup + " ед./ход"],
      ["Экипаж", t.pers + " тыс."], ["Содержание", t.upkeep + " млрд/год"], ["Боеголовки", t.wh || ""], ["Постройка", t.cost + " ОВП"]], t.new)).join("") + "</div>";
  }
  function tShips() {
    let out = "";
    for (const cls of Object.keys(D.shipClasses)) {
      const list = D.ships.filter(s => s.cls === cls);
      if (!list.length) continue;
      out += "<h3>" + esc(D.shipClasses[cls]) + '</h3><div class="tcards">' + list.map(t => card("ship-" + t.id, t.name, "", [["Атака / оборона / манёвр", t.atk + " / " + t.dfn + " / " + t.man], ["Снабжение", t.sup + " ед./ход"], ["Экипаж", t.pers + " тыс."],
        ["Водоизмещение", t.ton + " тыс. т"], ["Авиагруппа", t.air || ""], ["Содержание", t.upkeep + " млрд/год"], ["Боеголовки", t.wh || ""], ["Постройка", t.cost + " ОВП"]])).join("") + "</div>";
    }
    return out;
  }
  function tStructure() {
    const K = D.K, c = D.countries["84"] || Object.values(D.countries)[0];
    const f = c.flights.find(x => Object.keys(x.mix).length) || c.flights[0], s = c.squadrons[0];
    const rf = f && Model.flight(D, c, f), rs = s && Model.squadron(D, c, s);
    const ex = (r, nm) => r ? NOTE("Пример на данных страны «" + esc(c.name) + "»: «" + esc(nm) + "», " + r.N + " ед. Атака = медиана × (1 + " + r.N + "/100) × коэффициент технологий " + num(Model.techMult(K, c.tech), 2) + " = " + num(r.atk, 1) + ". Боевая мощь " + num(r.power, 1) + ".") : "";
    return ph("flight", "Авиационное звено") + ph("squadron", "Эскадра") + "<h3>Размеры</h3><ul><li>Авиационное звено — до <b>" + K.flight_max + "</b> самолётов, состав смешанный.</li><li>Эскадра — до <b>" + K.squad_max + "</b> кораблей, состав смешанный.</li><li>Звенья прикрепляются к дивизиям, армиям, эскадрам и флотам; эскадры входят во флоты.</li></ul>" +
      "<h3>Параметры соединения</h3><p>Как в статье «Армия»: снабжение, содержание и экипаж суммируются, остальные параметры берутся как <b>медиана</b> параметров частей. Параметры атаки и обороны затем умножаются на <b>(1 + число частей / 100)</b>. Параметры каждой части — число от 1 до 100, умножается на коэффициент технологий страны: <b>1 + " + K.tech_k + " × (уровень − " + K.tech_ref + ")</b>.</p>" + ex(rf, f && f.name) + ex(rs, s && s.name) +
      "<h3>Боевая мощь</h3><p>Мощь соединения = число частей × (" + K.w_atk + " × атака + " + K.w_def + " × оборона + " + K.w_fast + " × стремительность + " + K.w_react + " × реагирование) / 100. Мощь страны = " + K.w_land + " × дивизии + " + K.w_air + " × авиация + " + K.w_navy + " × флот. Если оборонный бюджет не покрывает содержание войск, мощь в рейтинге снижается пропорционально покрытию (не ниже половины).</p>" +
      GMN("состав боевой мощи, веса видов войск и ИНМ — предложение редактора, в документах их нет. Размеры звена и эскадры — решение автора.");
  }
  const INDN = { heavy: "тяжёлая", chem: "химическая", hitech: "высокотехнологичная", light: "лёгкая", vpk: "ВПК", ship: "верфи", aero: "авиапром" }, ENN = { fusion: "термоядерные", renew: "возобновляемые", fossil: "тепловые" };
  function tEcoInd() {
    const K = D.K, f = (x, d) => num(x, d == null ? 2 : d), pp = x => num(x * 100, 0) + "%";
    return "<h3>Площадь и КУТ</h3>" +
      "<p>Каждый мегаполис даёт <b>" + K.meg_area + "</b> ячеек застройки, каждая провинция — <b>" + K.prov_area + "</b>. КУТ мегаполиса — " + f(K.kut_meg, 2) + ". КУТ провинции — среднее по её земле: пригодная " + f(K.kut_norm) + ", затопленная " + f(K.kut_flood) + ", радиоактивная пустошь " + f(K.kut_waste) + ", заражённая " + f(K.kut_infect) + ". Доли пригодной и затопленной земли и радиация берутся из паспорта страны; остальная земля — пустошь, чем выше радиация, тем больше в ней заражённой.</p>" +
      "<h3>Природные ресурсы</h3><p>У страны есть три природных запаса: залежи (уголь, нефть, газ), породы (минеральные скопления, соли, камень) и рудные жилы. Добыча за ход = запасы страны × <b>" + f(K.raw_k) + "</b> × доля вида × <b>освоение территории</b> × (1 − истощение) × поправка технологий. Освоение растёт вместе с населением и стройками; пока оно мало, часть запасов недоступна. Богатство показано условными единицами: мало, средне, много, очень много.</p>" +
      "<p>Истощение растёт каждый ход: " + f(K.depl_base, 3) + " × освоение × (1 + загрязнение / 10). Участки становятся «бедными»; живая природа и вода могут пропасть совсем.</p>" +
      "<h3>Продукты и цепочки</h3>" + T(["Продукт", "Из чего делается", "Кто потребляет"], (D.products || []).filter(p => p.cat === "prod" || p.cat === "nat").map(p => {
        const cp = p.cap || {}, from = [];
        if (p.nat) from.push("добыча из недр");
        if (cp.ind) from.push("заводы: " + Object.entries(cp.ind).map(([k, w]) => (INDN[k] || k) + " × " + f(w)).join(", "));
        if (cp.en) from.push("энергоблоки: " + Object.entries(cp.en).map(([k, w]) => (ENN[k] || k) + " × " + f(w)).join(", "));
        if (cp.land) from.push("пригодная земля × " + f(cp.land));
        if (cp.water) from.push("запас воды");
        const inp = Object.entries(p.inputs || {}).map(([k, w]) => f(w) + " " + ((D.products.find(x => x.id === k) || {}).name || k).toLowerCase());
        const u = p.use || {}, use = [];
        if (u.pop) use.push("население " + f(u.pop)); if (u.fac) use.push("заводы " + f(u.fac)); if (u.army) use.push("армия " + f(u.army)); if (p.build) use.push("стройки " + f(p.build, 4) + " на 1 ОС");
        return ["<b>" + esc(p.name) + "</b>" + (p.note ? "<br><small>" + esc(p.note) + "</small>" : ""), esc(from.join("; ")) + (inp.length ? "<br><small>расход: " + esc(inp.join(", ")) + " на единицу</small>" : ""), esc(use.join("; ") || "—")];
      })) +
      "<p>Продукты считаются по порядку таблицы. Выпуск = меньшее из мощности и запаса входов; при переработке получается " + pp(K.conv) + " от потреблённого сырья (кроме товаров, где вход — добавка). Что осталось, делят по очереди население, заводы и армия, затем стройки. Обеспеченность стройки — доля потребности, которую удалось закрыть; ОС урезаются на недостающую долю.</p>" +
      "<h3>Трудовые кадры</h3>" + T(["Кадры", "Что это", "Откуда"], [["ТК", "Работоспособное население", "= ТЕ (100 тыс. человек)"], ["СТК", "Специалисты", "= КТЕ"], ["ВТК", "Неквалифицированный военный и силовой персонал", "личный состав армии × (1 − доля специалистов)"],
        ["СВТК", "Военные и технические специалисты силовых структур", "личный состав × " + pp(K.army_sk) + " + " + pp(K.army_sk_tech) + " за уровень технологий выше 3"],
        ["РН", "Резерв населения: прирост без жилья и рабочих мест", "прирост " + pp(K.growth_turn) + " в ход; в ТК переходит столько, сколько построено жилья (" + pp(K.home_share) + " ОС на жильё, " + K.os_home + " ОС на 100 тыс. человек)"]]) +
      "<h3>Экологическая нагрузка</h3><p>Шкала 0–10. За ход загрязнение прибавляют заводы (на единицу: тяжёлая " + f(K.pol_heavy, 3) + ", химическая " + f(K.pol_chem, 3) + ", ВПК " + f(K.pol_vpk, 3) + ", высокие технологии " + f(K.pol_hitech, 3) + ", верфи " + f(K.pol_ship, 3) + ", авиапром " + f(K.pol_aero, 3) + ") и тепловые блоки (" + f(K.pol_fossil, 3) + "), делённые на площадь страны. Убавляют очистка из бюджета инфраструктуры (" + f(K.clean_bn, 3) + " за млрд) и самоочищение (" + pp(K.pol_decay) + " от уровня). При уровне выше 5 теряется до " + pp(K.pol_gdp) + " ВВП; шанс нового очага за ход (радиоактивная пыль, смог) — до " + pp(K.pol_out) + " при уровне 10. Полная очистка очага дорога, перенос отходов лишь переносит проблему.</p>" +
      "<h3>Цены, склад и торговля</h3><p>У каждого продукта своя базовая цена (млрд кр. за УЕ): чем длиннее цепочка, тем дороже (топливо " + f((D.products.find(x => x.id === "fuel") || {}).price, 1) + ", металлы " + f((D.products.find(x => x.id === "metals") || {}).price, 1) + ", электроника " + f((D.products.find(x => x.id === "elec") || {}).price, 1) + ", драгоценности " + f((D.products.find(x => x.id === "precious") || {}).price, 1) + "). Местная цена = базовая × (спрос / предложение) в пределах ×" + f(K.price_min, 1) + "–×" + f(K.price_max, 1) + ", пересчёт раз в " + K.price_turns + " хода. Один склад на страну вмещает " + f(K.store_cap, 0) + " УЕ на единицу площади (площадь / 100): излишки копятся в нём, дефициты покрываются из него, а запас гасит скачок цены до " + pp(K.stock_damp) + ".</p>" +
      "<p>Страны с торговым договором делят глобальный рынок. Экспорт — излишек сверх своих нужд, импорт — нехватка; оба урезаются протекционизмом страны. Поток по паре ограничен пропускной способностью пути (" + f(K.route_k, 0) + " УЕ на единицу площади меньшей страны). Мировая цена = базовая × спрос / предложение. Пошлину платит импортёр и получает её в бюджет.</p>" +
      '<div class="gm-only">' + T(["Пара стран", "Пошлина"], (D.trade || []).map(t => [esc(((D.countries[t.a] || {}).name || t.a) + " — " + ((D.countries[t.b] || {}).name || t.b)), pp(t.tariff)])) + "</div>" +
      "<h3>Корпорации и зарплаты</h3><p>Предприятия — корпорации страны, «прочий частный бизнес» и государственный сектор. Долю корпорации в частном секторе задаёт её присутствие (" + pp(K.pres_share) + " на единицу). Выручка = ВВП × частный сектор × доля. Издержки: сырьё (по отрасли), налог (" + pp(K.corp_tax) + " от ставки страны), акцизы " + pp(K.excise) + ", логистика " + pp(K.logi) + ".</p>" +
      T(["Показатель", "Как считается"], [["Ожидаемая ЗП по стране", "ВВП на работника × (" + f(K.wage_dev, 2) + " + " + f(K.wage_tech, 2) + " × технологии)"], ["Ожидаемая ЗП предприятия", "средняя ожидаемая × рыночный модификатор труда (избыток рабочих рук снижает, нехватка повышает, до ±15%)"], ["МРОТ", pp(K.mrot) + " от средней ожидаемой"], ["Реальная ЗП предприятия", "прибыль до зарплат на одного занятого, но не ниже МРОТ и не выше " + pp(K.wage_cap) + " ожидаемой"], ["Привлекательность", "реальная ЗП / ожидаемая; множит выпуск корпорации в границах " + f(K.att_min, 2) + "–" + f(K.att_max, 2)], ["Банкротство", "убыток даже на МРОТ без субсидий"]]) +
      "<h3>Расширение производства</h3><p>Часть ОС с учётом ресурсов (" + pp(K.expand_share) + ") идёт на новые заводы и энергоблоки. Стоимость сооружения = " + K.os_unit + " ОС × категория (1–5) × средний КУТ площадок страны. Стройки не завершаются за один ход: ОС копятся по видам, пока не наберётся стоимость.</p>" +
      T(["Сооружение", "Категория"], (D.buildTypes || []).map(b => [esc(b.name), b.cat])) +
      T(["Модель", "Когда", "Как строится"], [["Плановая", "частный сектор до 20%", "Игрок, глава государства или министр экономики, распределяет ОС между видами. Пока план не задан, строит автоплан по приоритетам."], ["Смешанная", "частный сектор 20–60%", "Государственная доля ОС идёт по плану, частная — по рынку."], ["Рыночная", "частный сектор больше 60%", "Почти все ОС распределяет рынок."]]) +
      "<p><b>Автоплан:</b> доля вида = (его доля в текущей структуре + " + pp(K.plan_floor) + ") × (1 + " + f(K.plan_boost, 1) + " × нехватка продуктов, которые он выпускает). <b>Рынок:</b> частные ОС идут туда, где выше доход на 1 ОС стоимости по местным ценам (редкие и дефицитные продукты привлекают больше), в степени " + f(K.mkt_k, 1) + "; весь частный пул умножается на привлекательность корпораций страны. Государственную долю определяет доля, не занятая частным сектором.</p>" +
      "<h3>Научно-исследовательский потенциал (НИП)</h3><p>НИП за ход = " + f(K.eni_bn, 1) + " × бюджет науки + " + f(K.eni_meg, 0) + " × число мегаполисов (научные центры) + " + f(K.nip_hitech, 2) + " × высокотехнологичные заводы. Тратится на технологии и методы (метод уровня k стоит 10 × k НИП); за события НИП выдают отдельно.</p>" +
      "<h3>Частный сектор и корпорации</h3>" +
      T(["Экономическая модель страны (повестка)", "Доля частных сооружений"], Object.entries(D.privBase || {}).map(([k, v]) => [esc(k), pp(v)])) +
      "<p>Каждая единица влияния корпораций добавляет к доле " + f(K.priv_infl * 100, 1) + " п. п. Корпорации прибавляют стране ВВП и забирают часть доходов бюджета: оба числа записаны для каждой страны. Если частный сектор больше 60% при коррупции от 40%, возникает риск потери контроля над рынком.</p>" +
      "<h3>Дань</h3><p>Дань и помощь, названные в лоре, прибавляются к бюджету. Централ получает с дистриктов около 447 млрд кр. в год.</p>" +
      GMN("все коэффициенты этого раздела, кроме КУТ и стоимости методов, предложил редактор: в документах «Экономика» нет формул выпуска УЕ, площади по странам и ЕНИ страны. Множители лора выставлены по статьям шести стран с ручной настройкой (Китай, Евразийский Союз, Централ, Франко-Иберия, Австралазия, Чехия); у остальных природа, освоение и загрязнение подобраны автоматически.");
  }
  function tInm() {
    const K = D.K;
    return "<h3>Как считается индекс</h3>" +
      "<p>ИНМ = (" + K.inm_eco + " × экономика + " + K.inm_army + " × армия + " + K.inm_tech + " × технологии + " + K.inm_pop + " × население) / " + (K.inm_eco + K.inm_army + K.inm_tech + K.inm_pop) + ". Каждая составляющая — доля лучшей страны набора, 0–100; технологии — уровень от 1 до 10.</p>" +
      "<ul><li><b>Экономика</b> — ВВП за ход: наполовину от труда (ТЕ и КТЕ, производительность, стабильность), наполовину от производства (заводы и энергия).</li>" +
      "<li><b>Армия</b> — мощь страны: " + K.w_land + " × дивизии + " + K.w_air + " × авиация + " + K.w_navy + " × флот. Если оборонный бюджет не покрывает содержание войск, мощь снижается пропорционально покрытию, но не ниже половины.</li>" +
      "<li><b>Технологии</b> — технологический уровень страны, шкала 1–10.</li><li><b>Население</b> — число жителей.</li></ul>" +
      "<p>Параметры дивизий, звеньев и эскадр описаны в статье <a href=\"#wiki/mech/army/t-struct\">«Армия»</a>.</p>" +
      GMN("веса ИНМ и состав боевой мощи — предложение редактора, в документах их нет.");
  }
  function hydrate(box) {
    load().then(() => {
      box.querySelectorAll("[data-calc]").forEach(el => {
        const k = el.dataset.calc;
        el.innerHTML = ({ rating: () => tRating() + tInm(), divs: tDivs, air: tAir, ships: tShips, structure: tStructure, ph: () => ph(el.dataset.ph), ecoind: tEcoInd, measures: () => measuresTable(null) + journalMeasures(), fxpublic: fxPublic })[k]();
        fillSlots(el);
      });
    });
  }
  window.addEventListener("kg:calc-hydrate", e => hydrate(e.detail));
  // тексты сайта могут перезаписать блок позже (применение правок): пустые узлы заполняем заново
  const mv = $("mechView");
  if (mv) new MutationObserver(() => { if (mv.querySelector("[data-calc]:empty")) hydrate(mv); }).observe(mv, { childList: true, subtree: true });

  // ---------- общие блоки результата ----------
  const kv = rows => '<dl class="calc-kv">' + rows.map(r => "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>").join("") + "</dl>";
  function overviewCards(c, r, score, rank, total) {
    const e = r.eco, st = Model.stability(D, c, r), card = (label, value, lines) => '<div class="calc-card"><small>' + label + "</small><b>" + value + "</b>" + lines.map(x => "<span>" + x + "</span>").join("") + "</div>";
    return '<div class="calc-cards">' +
      card("ИНМ", num(score.total, 1), ["место " + rank + " из " + total]) +
      card("ВВП за год", num(e.gdpYear), [num(e.gdpTurn) + " млрд кр./ход"]) +
      card("Мощь войск", num(r.power), [r.land.n + " див. · " + r.air.units + " звеньев · " + r.navy.units + " эскадр"]) +
      card("Стабильность", num(st.S, 1), ["из 100 · " + (st.delta > 0 ? "+" : "") + num(st.delta, 2) + " за ход", "→ " + num(st.next, 1)]) +
      card("Бюджет", num(e.budget, 1), ["млрд кр./ход · налог " + pct(c.tax), "собираемость " + pct(e.taxS)]) +
      card("Оборона", num(e.def, 1), ["млрд кр./ход · " + pct(c.b.def) + " бюджета", "содержание " + num(r.upkeepTurn, 1) + " · покрытие " + pct(r.cover)]) +
      card("Административное влияние", num(r.av, 1), ["АВ/ход · приоритет стройки 2 АВ"]) +
      card("Технологии", num(c.tech, 1), ["из 10 · НИП " + num(e.nip, 1) + "/ход"]) + "</div>";
  }
  function ecoBlock(r, c, part) {
    const e = r.eco, t = e.terr, K = D.K, rows = e.res.rows, L = e.labor, G = e.eco;
    const main = kv([["Работников", num(e.workers) + " млн"], ["ТК (ТЕ)", num(e.te)], ["СТК (КТЕ)", num(e.kte) + " (" + pct(e.skilled) + ")"],
      ["ВВП за ход", num(e.gdpTurn) + " млрд кр." + (c.lore && c.lore.gdp != null && c.lore.gdp !== 1 ? " (поправка лора ×" + num(c.lore.gdp, 2) + ")" : "") + (e.polK < 1 ? " (загрязнение −" + pct(1 - e.polK) + ")" : "")], ["ВВП за год", num(e.gdpYear) + " млрд кр."], ["ВВП на душу", num(e.perCapita, 1) + " тыс. кр."],
      ["Оплата труда за ход", num(e.wage) + " кр."], ["ЕПП", num(e.epp, 1)], ["ОС за ход", num(e.os)], ["ОС с учётом ресурсов", "<b>" + num(e.osEff) + "</b> (" + pct(e.res.supply) + ")"],
      ["НИП за ход", num(e.nip, 1)], ["Частный сектор", pct(e.priv)],
      ["Бюджет за ход", num(e.budget) + " млрд кр." + (e.tribute ? " (в т. ч. дань " + num(e.tribute, 0) + ")" : "")], ["Оборона", num(e.def, 1)], ["Наука", num(e.sci, 1)], ["Социальные", num(e.soc, 1)], ["Инфраструктура", num(e.infra, 1)], ["Космос", num(e.space, 1)]]);
    const cp = c.corp || {};
    const terr = "<h3>Территория</h3>" + kv([["Мегаполисы", num(t.meg, 0) + " × " + K.meg_area + " = " + num(t.areaMeg, 0) + " ячеек (КУТ " + num(t.kutMeg, 2) + ")"], ["Провинции", num(t.prov, 0) + " × " + K.prov_area + " = " + num(t.areaProv, 0) + " ячеек (средний КУТ " + num(t.kutProv, 2) + ")"],
      ["Земля провинций", "пригодная " + pct(t.sh.norm) + ", затопленная " + pct(t.sh.flood) + ", пустошь " + pct(t.sh.waste) + ", заражённая " + pct(t.sh.infect)],
      ["Построек 1-й категории за ход", "в мегаполисах ≈ " + num(e.osEff / (100 * t.kutMeg), 1) + ", в провинциях ≈ " + num(e.osEff / (100 * t.kutProv), 1)]]);
    const lvl = x => (x >= 80 ? "очень много" : x >= 40 ? "много" : x >= 15 ? "средне" : "мало");
    const natRows = rows.filter(x => x.cat === "nat" && x.share != null);
    const nat = "<h3>Природные ресурсы (УЕ за ход)</h3>" + T(["Запас", "Доля запасов", "Освоено", "Истощено", "Добыча", "Богатство"], natRows.map(x => [x.name, pct(x.share), pct(e.res.dev), pct(x.depl || 0), num(x.prod, 0) + (x.mul !== 1 ? " (лор ×" + num(x.mul, 2) + ")" : ""), lvl(x.prod / Math.max(1, e.res.S))])) +
      '<p class="mech-note">Живая природа и вода: ' + rows.filter(x => x.cat === "nat" && x.share == null).map(x => esc(x.name) + " — " + num(x.prod, 0)).join("; ") + ". Освоение территории " + pct(e.res.dev) + ", истощение " + num(G.dm * 100, 2) + "% за ход.</p>";
    const state = x => (x.state === "deficit" ? '<span style="color:var(--danger)"><b>дефицит</b></span>' : x.state === "build" ? '<span style="color:var(--pink-soft)">стройкам мало</span>' : "норма");
    const prods = "<h3>Продукты (УЕ за ход)</h3>" + T(["Продукт", "Выпуск", "Лор", "Расход на цепочки", "Население · заводы · армия", "Стройки: нужно", "Обеспеченность", "Состояние"], rows.filter(x => x.cat === "prod" || x.id === "water" || x.id === "flora").map(x => {
      const basic = x.dem.pop + x.dem.fac + x.dem.army, chain = x.prod - x.left;
      return [x.name + (x.lim ? ' <small>(упирается в: ' + (x.lim === "cap" ? "мощности заводов" : esc((rows.find(y => y.id === x.lim) || {}).name || x.lim).toLowerCase()) + ")</small>" : ""), num(x.prod, 0), x.mul === 1 ? "—" : "×" + num(x.mul, 2), num(chain, 0), num(basic, 0), num(x.dem.build, 0),
        x.ratio == null ? "—" : '<span style="color:' + (x.ratio < 0.5 ? "var(--danger)" : "inherit") + '"><b>' + pct(Math.min(x.ratio, 9.99)) + "</b></span> " + bar(Math.min(x.ratio, 1.5), 1.5), state(x)];
    }));
    const labor = "<h3>Трудовые кадры (ед. по 100 тыс. человек)</h3>" + kv([["ТК (рабочие)", num(L.tk)], ["СТК (специалисты)", num(L.stk)], ["ВТК (военные)", num(L.vtk, 1)], ["СВТК (военные специалисты)", num(L.svtk, 1)],
      ["РН: резерв сейчас", num(L.rn, 1)], ["Прирост за ход", "+" + num(L.growth, 1)], ["Жилья за ход", num(L.homes, 1)], ["Перейдёт в ТК", num(L.move, 1)], ["РН после хода", "<b>" + num(L.rnNext, 1) + "</b>"]]);
    const eco = "<h3>Экология</h3>" + kv([["Загрязнение сейчас", "<b>" + num(G.pol, 1) + "</b> из 10 " + bar(G.pol, 10)], ["Выбросы за ход", "+" + num(G.add, 2)], ["Очистка из бюджета", "−" + num(G.clean, 2)], ["Самоочищение", "−" + num(G.decay, 2)],
      ["После хода", "<b>" + num(G.next, 2) + "</b> (" + (G.delta >= 0 ? "+" : "") + num(G.delta, 2) + ")"], ["Шанс нового очага", pct(G.risk) + " за ход"], ["Потеря ВВП", pct(G.gdpLoss)], ["Очаги", (G.outbreaks.length ? G.outbreaks.map(esc).join("; ") : "нет")]]);
    const mk = r.mk, SECN = id => ((D.sectors || {})[id] || {}).name || id;
    const market = "<h3>Цены, склад и торговля</h3>" + T(["Продукт", "Базовая цена", "Местная цена", "Склад: сейчас", "Склад: после хода", "Можно продать", "Нужно закупить", "Мировая цена", "Экспорт", "Импорт"],
      rows.filter(x => x.cat === "prod" || ["dep", "rock", "ore"].includes(x.id)).map(x => { const t = (mk && mk.rows[x.id]) || {}; return [x.name, num(x.base, 2), num(x.price, 2) + " (×" + num(x.mult, 2) + ")", num(x.stock, 0), num(x.stockNext, 0), num(t.can || 0, 0), num(t.needImp || 0, 0), t.wp ? num(t.wp, 2) : "—", num(t.exp || 0, 0), num(t.imp || 0, 0)]; })) +
      kv([["Склад", num(e.res.stockSum, 0) + " из " + num(e.res.capStore, 0) + " УЕ → после хода " + num(e.res.stockNext, 0)], ["Протекционизм", pct(n0c(c.protect))],
        ["Экспорт", mk ? num(mk.exp, 1) + " млрд кр." : "—"], ["Импорт", mk ? num(mk.imp, 1) + " млрд кр." : "—"], ["Пошлины в бюджет", mk ? num(mk.tariff, 1) + " млрд кр." : "—"], ["Торговый баланс", mk ? "<b>" + num(mk.balance, 1) + "</b> млрд кр." : "—"],
        ["Обеспеченность строек с импортом", mk ? "<b>" + pct(mk.supplyTrade) + "</b> (без импорта " + pct(e.res.supply) + ")" : "—"]]) +
      '<p class="mech-note">Цены пересчитываются раз в ' + K.price_turns + ' хода. Торгуют страны с торговым договором; поток по паре ограничен пропускной способностью пути.</p>';
    const W = e.wages;
    const wages = kv([["Ожидаемая ЗП по стране", num(W.expected, 1) + " тыс. кр. за ход"], ["Реальная ЗП по стране", num(W.avgReal, 1) + " (" + pct(W.gap) + " от ожидаемой)"], ["МРОТ", num(W.mrot, 1)], ["Рынок труда", "×" + num(W.mod, 2)],
      ["Привлекательность корпораций", num(W.avgAtt, 2) + " (множит выпуск частного сектора)"], ["Государственный сектор", num(W.stateN, 1) + " млн занятых, ЗП " + num(W.stateReal, 1)]]) +
      T(["Предприятие", "Отрасль", "Выручка", "Занято, млн", "Издержки", "Ожид. ЗП", "Реальная ЗП", "Привлекательность", "Прибыль"], W.ents.map(x => ["<b>" + esc(x.name) + "</b>", esc(SECN(x.sector)), num(x.rev, 1), num(x.n, 2), num(x.raw + x.tax + x.exc + x.logi, 1), num(x.exp, 1), num(x.real, 1) + (x.loss > 0 ? " (убыточная)" : ""), num(x.att, 2), x.bankrupt ? '<span style="color:var(--danger)"><b>банкрот ' + num(x.profit, 1) + "</b></span>" : num(x.profit, 1)]));
    const X = e.expand, expand = "<h3>Расширение производства</h3>" + kv([["Модель", "<b>" + X.model + "</b> (частный сектор " + pct(e.priv) + ")"], ["ОС на новые заводы за ход", num(X.pool, 0) + " (" + pct(D.K.expand_share) + " от ОС с учётом ресурсов)"],
      ["Государственный план", num(X.stateOS, 0) + " ОС · " + (X.auto ? "автоплан по приоритетам" : "план ГМа")], ["Рынок (корпорации)", num(X.mktOS, 0) + " ОС · привлекательность ×" + num(X.attf, 2)], ["КУТ площадки в среднем", num(X.kutAvg, 2)], ["Достроится за ход", num(X.builtTotal, 0) + " сооруж."]]) +
      T(["Сооружение", "Категория", "Сейчас", "Стоимость, ОС", "Доля плана", "Доля рынка", "ОС за ход", "Накоплено", "Достроится", "Ходов на единицу"], X.rows.map(x => [esc(x.name), x.cat, num(x.now, 1), num(x.cost, 0), pct(x.planShare), pct(x.mktShare), num(x.os, 0), num(x.prog, 0), x.built > 0 ? "<b>+" + x.built + "</b>" : "—", isFinite(x.turns) ? num(x.turns, x.turns < 1 ? 2 : 1) : "—"])) +
      '<p class="mech-note">Новые заводы появляются, когда набрана стоимость: ОС копятся по видам от хода к ходу.</p>';
    const lore = ((c.lore && c.lore.cues) || []);
    const corpLore = cp.list ? ["Корпорации: " + cp.list + ". Влияние ≈ " + cp.infl + ": ВВП " + (cp.gdp > 0 ? "+" : "") + Math.round((cp.gdp || 0) * 100) + "%, доходы бюджета " + Math.round((cp.bud || 0) * 100) + "%."] : [];
    const loreHtml = rows => rows.length ? '<h3>Что говорит лор</h3><ul class="calc-cues">' + rows.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "";
    if (part === "corp") return wages + loreHtml(corpLore);
    if (part === "scary") return "<h3>Экономика: исходные и промежуточные числа</h3>" + main + terr + nat + prods + labor + eco + market + expand;
    const mainBrief = kv([["ВВП за ход", num(e.gdpTurn) + " млрд кр."], ["ВВП за год", num(e.gdpYear) + " млрд кр."], ["ВВП на душу", num(e.perCapita, 1) + " тыс. кр."], ["Частный сектор", pct(e.priv)],
      ["Бюджет за ход", num(e.budget) + " млрд кр."], ["Оборона", num(e.def, 1)], ["Наука", num(e.sci, 1)], ["Социальные", num(e.soc, 1)], ["Инфраструктура", num(e.infra, 1)]]);
    const terrBrief = "<h3>Территория</h3>" + kv([["Мегаполисы", num(t.meg, 0)], ["Провинции", num(t.prov, 0)], ["Земля провинций", "пригодная " + pct(t.sh.norm) + ", затопленная " + pct(t.sh.flood) + ", пустошь " + pct(t.sh.waste) + ", заражённая " + pct(t.sh.infect)]]);
    const natBrief = "<h3>Природные ресурсы</h3>" + T(["Запас", "Доля запасов", "Освоено", "Истощено", "Богатство"], natRows.map(x => [x.name, pct(x.share), pct(e.res.dev), pct(x.depl || 0), lvl(x.prod / Math.max(1, e.res.S))])) +
      '<p class="mech-note">Освоение территории ' + pct(e.res.dev) + ", истощение " + num(G.dm * 100, 2) + "% за ход. Добыча в УЕ — во вкладке «Страшные цифры».</p>";
    const prodsBrief = "<h3>Обеспеченность продуктами</h3>" + T(["Продукт", "Обеспеченность", "Состояние"], rows.filter(x => x.cat === "prod" || x.id === "water" || x.id === "flora").map(x => [x.name,
      x.ratio == null ? "—" : '<span style="color:' + (x.ratio < 0.5 ? "var(--danger)" : "inherit") + '"><b>' + pct(Math.min(x.ratio, 9.99)) + "</b></span> " + bar(Math.min(x.ratio, 1.5), 1.5), state(x)]));
    const ecoBrief = "<h3>Экология</h3>" + kv([["Загрязнение сейчас", "<b>" + num(G.pol, 1) + "</b> из 10 " + bar(G.pol, 10)], ["После хода", "<b>" + num(G.next, 2) + "</b> (" + (G.delta >= 0 ? "+" : "") + num(G.delta, 2) + ")"], ["Шанс нового очага", pct(G.risk) + " за ход"], ["Потеря ВВП", pct(G.gdpLoss)], ["Очаги", (G.outbreaks.length ? G.outbreaks.map(esc).join("; ") : "нет")]]);
    const expandBrief = "<h3>Расширение производства</h3>" + kv([["Модель", "<b>" + X.model + "</b> (частный сектор " + pct(e.priv) + ")"], ["Государственный план", X.auto ? "Автоплан по приоритетам" : "План ГМа"], ["Рынок (корпорации)", "Привлекательность ×" + num(X.attf, 2)], ["КУТ площадки в среднем", num(X.kutAvg, 2)], ["Достроится за ход", num(X.builtTotal, 0) + " сооруж."]]) +
      T(["Сооружение", "Категория", "Доля плана", "Доля рынка", "Достроится"], X.rows.map(x => [esc(x.name), x.cat, pct(x.planShare), pct(x.mktShare), x.built > 0 ? "<b>+" + x.built + "</b>" : "—"]));
    return mainBrief + terrBrief + natBrief + prodsBrief + ecoBrief + expandBrief + loreHtml(lore);
  }
  function forcesBlock(r, part) {
    if (part === "land") return kv([["Дивизий", num(r.land.n)], ["Отдельных дивизий (не в армиях)", num(r.land.sep || 0)], ["Мощь сухопутных войск", num(r.land.power, 1)], ["Мораль войск", "×" + num(r.morale, 2)]]);
    if (part === "fleet") return kv([["Самолётов", num(r.air.n)], ["Авиационных звеньев", num(r.air.units)], ["Мощь авиации", num(r.air.power, 1)], ["Кораблей", num(r.navy.n)], ["Эскадр", num(r.navy.units)], ["На консервации", num(r.navy.cons || 0) + " эскадр"], ["Мощь флота", num(r.navy.power, 1)]]);
    return kv([["Мощь страны", "<b>" + num(r.power, 1) + "</b>"], ["Снабжение, ед./ход", num(r.supply, 1)], ["Содержание за ход", num(r.upkeepTurn, 1) + " млрд кр."], ["Покрытие оборонным бюджетом", pct(r.cover)],
      ["Личный состав", num(r.pers) + " тыс."], ["Ядерные боеголовки", num(r.wh)], ["На консервации", num(r.navy.cons || 0) + " эскадр (" + num(r.navy.consShips || 0) + " кораблей): содержание и снабжение ÷" + D.K.cons_div]]);
  }
  function warnBlock(c, r) {
    const w = Model.warnings(D, c, r);
    return w.length ? '<div class="calc-warn"><b>Предупреждения: ' + w.length + "</b><ul>" + w.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>"
      : '<div class="calc-ok">Серьёзных проблем и перекосов не найдено.</div>';
  }
  const typeName = (list, id) => (list.find(x => x.id === id) || { name: id }).name;
  const mixText = (list, mix) => Object.entries(mix || {}).filter(e => e[1] > 0).map(([id, n]) => n + "× " + esc(typeName(list, id))).join(", ") || "—";
  function listTables(r, c, part) {
    if (part === "army") return "<h3>Армии</h3>" + T(["Армия", "Дивизии", "Мощь"], r.armies.map((a, i) => ["<b>" + esc(a.name) + "</b>" + (a.sep ? " <small>(не армия)</small>" : ""), mixText(D.divTypes, c.armies[i].div), "<b>" + num(a.power, 1) + "</b>"]));
    if (part === "fleet") {
      const fl = T(["Звено", "Состав", "×", "Мощь"], r.flights.map((a, i) => ["<b>" + esc(a.name) + "</b>", mixText(D.aircraft, c.flights[i].mix) + (a.over ? ' <span class="prop">больше ' + D.K.flight_max + "</span>" : ""), a.count, num(a.power, 1)]));
      const sq = T(["Эскадра", "Состав", "×", "На консервации", "Мощь"], r.squads.map((a, i) => ["<b>" + esc(a.name) + "</b>", mixText(D.ships, c.squadrons[i].mix) + (a.over ? ' <span class="prop">больше ' + D.K.squad_max + "</span>" : ""), a.count, a.cons || "—", num(a.power, 1)]));
      return "<h3>Авиационные звенья</h3>" + fl + "<h3>Эскадры</h3>" + sq;
    }
    const army = T(["Армия", "Мощь атаки", "Сила обороны", "Снабжение"], r.armies.map(a => ["<b>" + esc(a.name) + "</b>", num(a.atk, 1), num(a.dfn, 1), num(a.sup, 1)]));
    const fl = T(["Звено", "Атака", "Оборона", "Снабжение"], r.flights.map(a => ["<b>" + esc(a.name) + "</b>", num(a.atk, 1), num(a.dfn, 1), num(a.sup, 1)]));
    const sq = T(["Эскадра", "Атака", "Оборона", "Снабжение"], r.squads.map(a => ["<b>" + esc(a.name) + "</b>", num(a.atk, 1), num(a.dfn, 1), num(a.sup, 1)]));
    return "<h3>Детальные параметры армий</h3>" + army + "<h3>Детальные параметры звеньев</h3>" + fl + "<h3>Детальные параметры эскадр</h3>" + sq;
  }

  const COUNTRY_TABS = [["overview", "Обзор"], ["state", "Государство"], ["economy", "Экономика"], ["army", "Армия"], ["fleet", "ВВС и флот"], ["corp", "Корпорации"], ["effects", "Эффекты и заметки"], ["scary", "Страшные цифры"]];
  function countryTabsHtml(active, body) {
    return '<div class="country-tabs" role="tablist" aria-label="Разделы страны">' + COUNTRY_TABS.map(x => '<button type="button" role="tab" data-country-tab="' + x[0] + '" aria-selected="' + (x[0] === active) + '" class="' + (x[0] === active ? "active" : "") + '">' + x[1] + "</button>").join("") + '</div><div class="country-tab-panel" role="tabpanel">' + body + "</div>";
  }
  function bindCountryTabs(root, onTab) {
    root.addEventListener("click", e => { const b = e.target.closest("[data-country-tab]"); if (b && root.contains(b)) onTab(b.dataset.countryTab); });
    root.addEventListener("keydown", e => {
      const b = e.target.closest("[data-country-tab]"); if (!b || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault(); const tabs = [...root.querySelectorAll("[data-country-tab]")], i = tabs.indexOf(b);
      const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      onTab(next.dataset.countryTab); requestAnimationFrame(() => { const active = root.querySelector('[data-country-tab="' + next.dataset.countryTab + '"]'); if (active) active.focus(); });
    });
  }

  function tipInfo(label) {
    const K = D.K;
    const defs = {
      "ИНМ": ["Индекс национальной мощи — сравнительный рейтинг экономики, армии, технологий и населения страны.", "(" + K.inm_eco + " × экономика + " + K.inm_army + " × армия + " + K.inm_tech + " × технологии + " + K.inm_pop + " × население) ÷ 100; компоненты нормируются к лучшей стране."],
      "ВВП за год": ["Совокупный выпуск товаров и услуг страны за четыре хода.", "ВВП за ход × 4."],
      "ВВП за ход": ["Совокупный выпуск товаров и услуг страны за текущий квартал.", "(Доля труда × труд + доля производства × заводы и энергия) × стабильность × корпорации × лор × экология × эффекты."],
      "ВВП на душу": ["Годовой выпуск на одного жителя; позволяет сравнивать страны разного размера.", "ВВП за год ÷ население."],
      "Мощь войск": ["Общая боевая мощь сухопутных войск, авиации и флота с учётом морали и блокады.", K.w_land + " × мощь сухопутных войск + " + K.w_air + " × мощь авиации + " + K.w_navy + " × мощь флота; затем мораль и блокада."],
      "Мощь страны": ["Сводная боевая мощь всех видов вооружённых сил.", "Взвешенная сумма мощи суши, авиации и флота × мораль × эффекты × блокада."],
      "Стабильность": ["Состояние общества и управляемость страны по шкале 0–100; влияет на экономику, АВ и армию.", "Следующее значение = текущее + сумма экономических, политических и особых факторов, в пределах 0–100."],
      "Бюджет": ["Доход государства за ход до распределения по статьям.", "ВВП за ход × налог × собираемость × корпорации × эффекты + дань за ход."],
      "Бюджет за ход": ["Доход государства за текущий квартал до распределения по статьям.", "ВВП за ход × налог × собираемость × корпорации × эффекты + дань за ход."],
      "Оборона": ["Часть бюджета, направленная на содержание вооружённых сил.", "Бюджет за ход × доля обороны."],
      "Административное влияние": ["АВ — ограниченный ресурс управления: тратится на строительные приоритеты и политические действия.", "База × государственный режим × стабильность × эффекты" + (isGm() ? " × совместимость повесток" : "") + "."],
      "Запас АВ на ход": ["Количество административного влияния, доступного в текущем ходу.", "База × государственный режим × стабильность × эффекты" + (isGm() ? " × совместимость повесток" : "") + "."],
      "Запас АВ": ["Показывает, как стабильность изменяет запас административного влияния.", "Множитель АВ = нижняя граница + вес × стабильность ÷ 100."],
      "Технологии": ["Общий технологический уровень страны по шкале 1–10; влияет на производство и войска.", "Параметр с технологией = базовый параметр × (1 + " + K.tech_k + " × (уровень − " + K.tech_ref + "))."],
      "Государственный режим": ["Политическое устройство страны; влияет на запас АВ и проведение решений.", "Запас АВ = база × коэффициент режима × остальные множители."],
      "Форма правления": ["Лорная характеристика власти: республика, монархия, совет и другие формы.", "Справочное поле; отдельной формулы не имеет."],
      "Цивилизационный вектор": ["Идейный путь страны; задаёт равновесный уровень стабильности.", "Изменение за ход += скорость возврата × (базовый уровень вектора − текущая стабильность)."],
      "Уровень вектора": ["Равновесная стабильность, к которой постепенно возвращается страна.", "Вклад за ход = скорость возврата × (уровень вектора − текущая стабильность)."],
      "Экономическая модель": ["Распределение производства между государством, частным бизнесом и смешанным сектором.", "Частный сектор = база модели + влияние корпораций × коэффициент, не более 95%."],
      "Торговая политика": ["Лорный курс внешней торговли страны.", "Справочное поле; фактические потоки считаются через договоры, протекционизм и пути."],
      "За ход": ["Прогноз изменения стабильности за один квартал.", "Сумма всех положительных и отрицательных факторов из таблицы причин."],
      "Состояние общественности": ["Качественное состояние общества и модификатор риска негативной реакции на реформу.", "Определяется текущей стабильностью после мгновенных эффектов санкций и блокад."],
      "Поддержка власти": ["Доля общественной поддержки правительства и её прогноз после хода.", "Следующая поддержка = текущая + коэффициент × (стабильность − поддержка) + эффекты."],
      "Группа": ["Группа факторов: экономика, политика и мир или особые эффекты.", "Изменения внутри группы суммируются."],
      "Причина": ["Конкретный фактор, меняющий стабильность в текущем ходу.", "Вклад фактора прибавляется к изменению стабильности."],
      "Собираемость налогов": ["Эффективность получения налогов; зависит от стабильности.", "Минимум + (1 − минимум) × стабильность ÷ 100."],
      "Очки строительства": ["ОС — ресурс государственного и частного строительства.", "ОС = ЕПП × 30 × множитель стабильности × эффекты; доступные ОС = ОС × обеспеченность ресурсами."],
      "Привлекательность корпораций": ["Желание корпораций работать в стране; влияет на выпуск частного сектора.", "Выпуск частного сектора × средняя привлекательность × стабильность × эффекты."],
      "Привлекательность": ["Отношение реальной зарплаты предприятия к ожидаемой.", "Реальная ЗП ÷ ожидаемая ЗП, с ограничением правил."],
      "Прирост населения": ["Показывает влияние стабильности на естественный прирост жителей.", "Прирост = базовый коэффициент × множитель стабильности."],
      "Мораль войск": ["Боевой дух и готовность войск; умножает общую мощь.", "(Минимум + вес × стабильность ÷ 100) × особые эффекты."],
      "Частный сектор": ["Доля хозяйства, управляемая корпорациями и частным бизнесом.", "База экономической модели + влияние корпораций × коэффициент, не более 95%."],
      "Наука": ["Бюджетные расходы на исследования за ход.", "Бюджет за ход × доля науки."],
      "Социальные": ["Расходы на социальную поддержку; влияют на стабильность.", "Бюджет за ход × доля социальных расходов."],
      "Инфраструктура": ["Расходы на инфраструктуру и очистку окружающей среды.", "Бюджет за ход × доля инфраструктуры."],
      "Космос": ["Бюджет космической программы; отдельный раздел будет возвращён позже.", "Бюджет за ход × доля космоса."],
      "Мегаполисы": ["Крупные обитаемые центры; дают площадь застройки и научный потенциал.", "Площадь = число мегаполисов × 40 ячеек; НИП += число × вклад мегаполиса."],
      "Провинции": ["Территории вне мегаполисов; дают землю и строительные площадки.", "Площадь = число провинций × 12 ячеек; КУТ зависит от типов земли."],
      "Земля провинций": ["Доли пригодной, затопленной, пустошной и заражённой земли.", "КУТ = среднее коэффициентов типов земли, взвешенное по их долям."],
      "КУТ площадки в среднем": ["Коэффициент сложности территории: чем выше, тем дороже строительство.", "Стоимость сооружения = " + K.os_unit + " ОС × категория × средний КУТ."],
      "Запас": ["Природный источник сырья или конкретный продукт.", "Добыча = общий запас × доля вида × освоение × (1 − истощение) × технологии × лор."],
      "Доля запасов": ["Часть суммарных природных запасов страны данного вида.", "Все три доли природных запасов в сумме дают 100%."],
      "Освоено": ["Доля территории, ресурсы которой доступны хозяйству.", "Доступная добыча = потенциальная добыча × освоение."],
      "Истощено": ["Доля запасов, утраченная добычей и деградацией.", "Доступная добыча = запас × (1 − истощение); истощение растёт каждый ход."],
      "Богатство": ["Качественная оценка добычи относительно территории: мало, средне, много или очень много.", "Определяется отношением добычи к суммарной площади страны."],
      "Продукт": ["Ресурс или результат производственной цепочки.", "Выпуск ограничен мощностями и входными ресурсами."],
      "Обеспеченность": ["Доля потребности строительства, закрытая собственными запасами и импортом.", "(Доступно для строек + импорт) ÷ потребность строек."],
      "Состояние": ["Итог баланса: норма, нехватка для строек или дефицит населения и производства.", "Сравниваются выпуск, обязательное потребление и потребность строек."],
      "Загрязнение сейчас": ["Экологическая нагрузка по шкале 0–10; высокие значения снижают ВВП и стабильность.", "Следующее = текущее + выбросы − очистка − самоочищение, в пределах 0–10."],
      "После хода": ["Прогноз значения после завершения текущего хода.", "Текущее значение + рассчитанное изменение за ход."],
      "Шанс нового очага": ["Вероятность дополнительного экологического происшествия за ход.", "Базовый риск загрязнения × текущий уровень загрязнения."],
      "Потеря ВВП": ["Доля выпуска, которую страна теряет из-за сильного загрязнения.", "Максимальная потеря × max(0, загрязнение − 5) ÷ 5."],
      "Очаги": ["Активные локальные экологические происшествия.", "Вероятность нового очага проверяется при проведении хода."],
      "Выбросы за ход": ["Новое загрязнение от заводов, энергетики и площади страны.", "Сумма выбросов производств ÷ площадь."],
      "Очистка из бюджета": ["Снижение загрязнения за счёт инфраструктурных расходов.", "Инфраструктурный бюджет × коэффициент очистки."],
      "Самоочищение": ["Естественное восстановление окружающей среды.", "Текущее загрязнение × коэффициент самоочищения."],
      "Модель": ["Способ распределения строительных ОС между государственным планом и рынком.", "Государству = ОС × (1 − частный сектор); рынку = ОС × частный сектор."],
      "Государственный план": ["Приоритеты распределения государственных ОС по сооружениям.", "ОС вида = государственный пул × доля плана."],
      "Рынок (корпорации)": ["Частные вложения в наиболее доходные и дефицитные производства.", "ОС вида = рыночный пул × доля рынка × привлекательность."],
      "Достроится за ход": ["Число сооружений, накопивших полную стоимость за текущий ход.", "Накоплено ранее + ОС хода; целая стоимость превращается в сооружение."],
      "Достроится": ["Число сооружений этого вида, завершаемых за ход.", "Целая часть от (накоплено + ОС хода) ÷ стоимость."],
      "Сооружение": ["Завод или энергоблок, который можно строить.", "Стоимость = " + K.os_unit + " ОС × категория × КУТ."],
      "Категория": ["Масштаб сооружения от 1 до 5.", "Стоимость прямо пропорциональна категории."],
      "Доля плана": ["Часть государственного строительного пула, назначенная этому виду.", "Государственные ОС вида = государственный пул × доля плана."],
      "Доля рынка": ["Часть частных вложений, направленная в этот вид.", "Рыночные ОС вида = рыночный пул × доля рынка."],
      "Ожидаемая ЗП по стране": ["Зарплата, которую работники ожидают при текущем уровне развития и технологий.", "ВВП на работника × (база + коэффициент × технологии) × рынок труда."],
      "Ожид. ЗП": ["Ожидаемая зарплата на предприятии с учётом рынка труда.", "Средняя ожидаемая ЗП × модификатор предприятия."],
      "Реальная ЗП по стране": ["Средняя фактическая зарплата и её отношение к ожидаемой.", "Среднее реальных ЗП, взвешенное по занятым; разрыв = реальная ÷ ожидаемая."],
      "Реальная ЗП": ["Фактическая зарплата работников предприятия.", "Прибыль до зарплат на одного занятого, но не ниже МРОТ и не выше потолка."],
      "МРОТ": ["Минимальный размер оплаты труда, ниже которого предприятие не может опустить зарплату.", "Ожидаемая ЗП × установленная доля МРОТ."],
      "Рынок труда": ["Модификатор зарплат от соотношения спроса и предложения работников.", "Ожидаемая ЗП × модификатор рынка труда."],
      "Государственный сектор": ["Занятость и оплата труда на государственных производствах.", "Занятые = работники × (1 − частный сектор)."],
      "Предприятие": ["Корпорация, частный бизнес или государственное производство.", "Выручка распределяется на сырьё, налоги, издержки, зарплаты и прибыль."],
      "Отрасль": ["Сектор производства предприятия.", "Определяет потребление сырья и структуру издержек."],
      "Выручка": ["Доход предприятия от выпуска за ход.", "ВВП × частный сектор × доля предприятия."],
      "Занято, млн": ["Число работников предприятия в миллионах человек.", "Занятость = выручка ÷ производительность труда отрасли."],
      "Издержки": ["Обязательные расходы предприятия без зарплат.", "Сырьё + налог + акцизы + логистика."],
      "Прибыль": ["Остаток предприятия после издержек и зарплат.", "Выручка − издержки − фонд реальной зарплаты."],
      "Дивизий": ["Общее число сухопутных дивизий во всех армиях и вне их.", "Сумма дивизий всех типов во всех армиях."],
      "Дивизии": ["Типы и количество дивизий в составе конкретной армии.", "Сумма по типам даёт общую численность соединения."],
      "Отдельных дивизий (не в армиях)": ["Дивизии без армейской структуры; не получают армейскую прибавку за число частей.", "Сумма дивизий в формированиях с отметкой «не армия»."],
      "Мощь сухопутных войск": ["Боевая мощь всех армий и отдельных дивизий.", "Сумма мощи армий и отдельных дивизий."],
      "Самолётов": ["Общее число самолётов и вертолётов во всех звеньях.", "Самолёты в звене × число одинаковых звеньев, затем сумма."],
      "Авиационных звеньев": ["Количество авиационных соединений страны.", "Сумма звеньев с учётом числа одинаковых."],
      "Мощь авиации": ["Сводная боевая мощь авиационных звеньев.", "Сумма мощи звеньев × число одинаковых."],
      "Кораблей": ["Общее число кораблей во всех эскадрах.", "Корабли в эскадре × число одинаковых, затем сумма."],
      "Эскадр": ["Количество корабельных соединений страны.", "Сумма эскадр с учётом числа одинаковых."],
      "Эскадра": ["Соединение кораблей с общими параметрами.", "Параметры = медиана частей × технологии × (1 + число частей ÷ 100)."],
      "На консервации": ["Законсервированные эскадры не дают мощи, но требуют пониженного содержания.", "Содержание и снабжение законсервированной части ÷ 5."],
      "Мощь флота": ["Мощь активных корабельных эскадр без законсервированных.", "Сумма мощи эскадр × активное число одинаковых."],
      "Армия": ["Оперативное объединение дивизий.", "Параметры частей объединяются через медиану и число дивизий."],
      "Мощь": ["Обобщённый боевой параметр соединения.", "Число частей × (вес атаки × атака + вес обороны × оборона + манёвренные параметры) × технологии."],
      "Мощь атаки": ["Наступательный параметр соединения.", "Медиана атаки частей × технологии × (1 + число частей ÷ 100)."],
      "Атака": ["Наступательный параметр соединения.", "Медиана атаки частей × технологии × (1 + число частей ÷ 100)."],
      "Сила обороны": ["Оборонительный параметр соединения.", "Медиана обороны частей × технологии × (1 + число частей ÷ 100)."],
      "Оборона соединения": ["Оборонительный параметр соединения.", "Медиана обороны частей × технологии × (1 + число частей ÷ 100)."],
      "Снабжение": ["Потребность соединения в снабжении за ход.", "Сумма норм снабжения всех частей; у консервации ÷ 5."],
      "Снабжение, ед./ход": ["Суммарная потребность всех вооружённых сил в снабжении.", "Снабжение суши + авиации + флота."],
      "Содержание за ход": ["Фактические расходы на армию, авиацию, флот и блокады.", "(Годовое содержание ÷ 4) + расходы на блокады."],
      "Покрытие оборонным бюджетом": ["Доля содержания войск, которую способен оплатить оборонный бюджет.", "min(100%, оборонный бюджет ÷ содержание)."],
      "Личный состав": ["Численность военнослужащих всех видов вооружённых сил.", "Сумма личного состава дивизий, звеньев и эскадр."],
      "Ядерные боеголовки": ["Запас боеголовок на носителях авиации и флота.", "Сумма боеголовок активных носителей."],
      "Звено": ["Авиационное соединение численностью до 12 самолётов.", "Параметры = медиана частей × технологии × (1 + число самолётов ÷ 100)."],
      "Состав": ["Типы и количество частей внутри соединения.", "Параметры соединения рассчитываются по этим частям."],
      "×": ["Число одинаковых соединений такого состава.", "Итог = параметры одного соединения × количество."],
      "Работников": ["Число жителей, участвующих в экономике.", "Население × доля работающих."],
      "ТК (ТЕ)": ["Рабочие без квалификации специалиста; единица — 100 тыс. человек.", "Все трудовые единицы − специалисты."],
      "СТК (КТЕ)": ["Квалифицированные специалисты; единица — 100 тыс. человек.", "Все трудовые единицы × доля специалистов от образования и технологий."],
      "ТК (рабочие)": ["Рабочие без квалификации специалиста; единица — 100 тыс. человек.", "Население × доля работающих × ТЕ на миллион − специалисты."],
      "СТК (специалисты)": ["Квалифицированные работники; единица — 100 тыс. человек.", "Все трудовые единицы × доля специалистов."],
      "ВТК (военные)": ["Неквалифицированный военный персонал; единица — 100 тыс. человек.", "Личный состав × (1 − доля военных специалистов)."],
      "СВТК (военные специалисты)": ["Военные технические специалисты; единица — 100 тыс. человек.", "Личный состав × доля специалистов от технологий."],
      "Оплата труда за ход": ["Суммарная оценка оплаты рабочих и специалистов.", "ТЕ × ставка ТЕ + КТЕ × ставка КТЕ."],
      "ЕПП": ["Единица производственного потенциала заводов и энергоблоков.", "Заводы × вклад завода + энергоблоки × вклад блока."],
      "ОС за ход": ["Строительные очки до учёта ресурсной обеспеченности.", "ЕПП × 30 × стабильность × особые эффекты."],
      "ОС с учётом ресурсов": ["Реально доступные строительные очки после проверки ресурсов.", "ОС за ход × обеспеченность ресурсами."],
      "ОС на новые заводы за ход": ["Часть доступных ОС, выделяемая на расширение производства.", "ОС с учётом ресурсов × доля расширения."],
      "НИП за ход": ["Научно-исследовательский потенциал для развития технологий и методов.", "Бюджет науки × вклад + мегаполисы × вклад + высокотехнологичные заводы × вклад + эффекты."],
      "Склад": ["Запас продуктов и доступная вместимость хранения.", "Вместимость = площадь ÷ 100 × норма хранения + дополнительная вместимость."],
      "Протекционизм": ["Доля возможного экспорта и импорта, ограничиваемая государством.", "Фактический поток = доступный поток × (1 − протекционизм)."],
      "Экспорт": ["Продажа излишков другим странам.", "Излишек × (1 − протекционизм), с учётом договоров и путей."],
      "Импорт": ["Закупка недостающих продуктов у других стран.", "Нехватка × (1 − протекционизм), с учётом договоров и путей."],
      "Пошлины в бюджет": ["Доход импортёра от таможенных пошлин по торговым парам.", "Сумма по поставкам: объём × мировая цена × ставка пошлины."],
      "Торговый баланс": ["Разница внешнеторговых доходов и расходов с учётом пошлин.", "Экспорт − импорт + пошлины."],
      "Обеспеченность строек с импортом": ["Итоговая доля строительной потребности после закупок.", "(Свои ресурсы + импорт) ÷ потребность строек."],
      "Базовая цена": ["Начальная цена продукта до влияния местного рынка.", "Задаётся правилами для каждого продукта."],
      "Местная цена": ["Цена продукта внутри страны.", "Базовая цена × спрос ÷ предложение, в заданных границах."],
      "Мировая цена": ["Цена продукта в торговле между странами.", "Базовая цена × мировой спрос ÷ мировое предложение; обновляется раз в 2 хода."],
      "Склад: сейчас": ["Текущий запас продукта на складе.", "Остаток после предыдущего хода."],
      "Склад: после хода": ["Прогноз запаса после производства, потребления и торговли.", "Сейчас + выпуск + импорт − потребление − экспорт, в пределах вместимости."],
      "Можно продать": ["Доступный экспортный излишек продукта.", "Излишек после основных потребностей × (1 − протекционизм)."],
      "Нужно закупить": ["Объём импорта для закрытия нехватки.", "Нехватка × (1 − протекционизм)."],
      "Выпуск": ["Произведённый или добытый объём продукта за ход.", "Минимум производственной мощности и доступных входных ресурсов."],
      "Лор": ["Индивидуальный множитель страны из её статьи.", "Итоговый выпуск = расчётный выпуск × лорный множитель."],
      "Расход на цепочки": ["Продукт, израсходованный как сырьё другими производствами.", "Сумма входных норм производственных цепочек."],
      "Население · заводы · армия": ["Обязательное потребление продукта этими тремя группами.", "Население × норма + заводы × норма + армия × норма."],
      "Стройки: нужно": ["Потребность всех текущих строек в продукте.", "Сумма ОС строек × норма продукта на 1 ОС."],
      "Стоимость, ОС": ["Полная стоимость одного сооружения.", K.os_unit + " ОС × категория × средний КУТ площадки."],
      "Накоплено": ["ОС, уже вложенные в этот вид сооружений ранее.", "Прошлое накопление + новые ОС − стоимость завершённых сооружений."],
      "Ходов на единицу": ["Ожидаемый срок строительства одного сооружения при текущем потоке ОС.", "(Стоимость − накоплено) ÷ ОС за ход."],
      "Сейчас": ["Текущее количество сооружений этого вида.", "Исходное количество + завершённые ранее постройки."],
      "РН: резерв сейчас": ["Резерв населения без жилья и работы; единица — 100 тыс. человек.", "Прошлый резерв + прирост − переход в рабочие кадры."],
      "Жилья за ход": ["Новые места проживания в единицах по 100 тыс. человек.", "Доступные ОС × доля жилья ÷ ОС на единицу жилья."],
      "Перейдёт в ТК": ["Часть резерва, получающая жильё и становящаяся рабочими кадрами.", "min(резерв, построенное жильё)."],
      "РН после хода": ["Прогноз резерва населения после перехода в рабочие кадры.", "Резерв + прирост − перешедшие в ТК."]
    };
    return defs[label] || null;
  }

  let tipEl = null, tipOwner = null;
  function hideTip() { if (tipEl) tipEl.classList.add("hidden"); if (tipOwner) tipOwner.removeAttribute("aria-describedby"); tipOwner = null; }
  function showTip(el) {
    if (!tipEl) {
      tipEl = h("div", "kg-tip hidden"); tipEl.id = "kgMetricTip"; tipEl.setAttribute("role", "tooltip"); document.body.append(tipEl);
      document.addEventListener("click", () => hideTip());
      document.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });
      window.addEventListener("resize", hideTip);
    }
    hideTip(); tipOwner = el;
    tipEl.innerHTML = "<b>" + esc(el.dataset.tipLabel) + "</b><span>" + esc(el.dataset.tip) + '</span><small>Формула: ' + esc(el.dataset.formula) + "</small>";
    tipEl.classList.remove("hidden"); el.setAttribute("aria-describedby", tipEl.id);
    const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect(), gap = 8, left = Math.max(8, Math.min(window.innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
    const top = r.top >= t.height + gap + 8 ? r.top - t.height - gap : Math.min(window.innerHeight - t.height - 8, r.bottom + gap);
    tipEl.style.left = Math.round(left) + "px"; tipEl.style.top = Math.round(Math.max(8, top)) + "px";
  }
  function enhanceTips(root) {
    root.querySelectorAll("dt, th, .calc-card small").forEach(el => {
      const label = el.textContent.trim(), info = tipInfo(el.tagName === "TH" && label === "Оборона" ? "Оборона соединения" : label); if (!info) return;
      el.classList.add("has-tip"); el.tabIndex = 0; el.dataset.tipLabel = label; el.dataset.tip = info[0]; el.dataset.formula = info[1];
    });
    if (root.dataset.tipsBound) return; root.dataset.tipsBound = "1";
    root.addEventListener("pointerover", e => { const el = e.target.closest(".has-tip"); if (el && root.contains(el) && !el.contains(e.relatedTarget)) showTip(el); });
    root.addEventListener("pointerout", e => { const el = e.target.closest(".has-tip"); if (el && !el.contains(e.relatedTarget)) hideTip(); });
    root.addEventListener("focusin", e => { const el = e.target.closest(".has-tip"); if (el) showTip(el); });
    root.addEventListener("focusout", e => { if (e.target.closest(".has-tip")) hideTip(); });
    root.addEventListener("click", e => { const el = e.target.closest(".has-tip"); if (!el) return; e.stopPropagation(); showTip(el); });
  }

  // ---------- особые эффекты ГМа ----------
  // Эффект — набор позиций: ±% к показателю (pct), прибавка каждый ход (add) или разовая позиция при вводе (once). Срок — N ходов или бессрочно.
  // Разовые позиции применяются сразу и записываются в эффект (applied); удаление эффекта в том же ходу и откат журнала их возвращают.
  const FX_MODE = { pct: "% к показателю", add: "за ход", once: "разово" };
  const FX_VIS = { player: "игроку страны", public: "всем", gm: "только ГМу" };
  const fxSubs = kind => kind === "product" ? (D.products || []).filter(p => p.cat === "prod" || p.id === "water").map(p => [p.id, p.name])
    : kind === "ind" ? Object.entries(INDN) : kind === "en" ? Object.entries(ENN) : kind === "div" ? D.divTypes.map(t => [t.id, t.name])
    : kind === "ac" ? D.aircraft.map(t => [t.id, t.name]) : kind === "ship" ? D.ships.map(t => [t.id, t.name]) : [];
  const fxT = t => Model.FX_TARGETS.find(x => x[0] === t) || [t, t, "pct"];
  function fxPosText(x) {
    const T = fxT(x.t), sub = x.p ? " «" + ((fxSubs(T[3]).find(s => s[0] === x.p) || [, x.p])[1]) + "»" : "", v = (x.v > 0 ? "+" : "") + num(x.v, 2);
    return T[1] + sub + ": " + (x.m === "pct" ? v + "%" : x.m === "add" ? v + " за ход" : v + " разово");
  }
  const FX_TPL = [
    { id: "harvest", name: "Неурожай", note: "Засуха и болезни посевов сократили урожай.", turns: 2, pos: [{ t: "prod", p: "food", m: "pct", v: -30 }, { t: "stab", m: "add", v: -0.5 }] },
    { id: "drought", name: "Засуха", note: "Реки обмелели, водозаборы работают с перебоями.", turns: 2, pos: [{ t: "prod", p: "water", m: "pct", v: -25 }, { t: "stab", m: "add", v: -0.5 }] },
    { id: "strike", name: "Забастовки", note: "Профсоюзы остановили заводы и стройки.", turns: 1, pos: [{ t: "gdp", m: "pct", v: -5 }, { t: "os", m: "pct", v: -20 }, { t: "stab", m: "add", v: -1 }] },
    { id: "aid", name: "Гуманитарная помощь", note: "Союзники прислали продовольствие и лекарства.", turns: 2, pos: [{ t: "stock", p: "food", m: "add", v: 5 }, { t: "stab", m: "add", v: 0.5 }] },
    { id: "science", name: "Научный прорыв", note: "Лаборатории получили результат, которого ждали десятилетиями.", turns: 4, pos: [{ t: "nip", m: "pct", v: 25 }] },
    { id: "plague", name: "Эпидемия", note: "Болезнь идёт по мегаполисам, введены карантины.", turns: 3, pos: [{ t: "growth", m: "pct", v: -50 }, { t: "gdp", m: "pct", v: -3 }, { t: "stab", m: "add", v: -1 }] },
    { id: "mine", name: "Истощение рудника", note: "Крупнейшее месторождение страны выработано.", turns: 0, pos: [{ t: "nat", m: "pct", v: -15 }] },
    { id: "mobil", name: "Мобилизация", note: "Призыв резервистов и перевод заводов на военные заказы.", turns: 0, pos: [{ t: "pow_land", m: "pct", v: 10 }, { t: "gdp", m: "pct", v: -5 }, { t: "upkeep", m: "pct", v: 10 }] },
    { id: "scandal", name: "Коррупционный скандал", note: "Утечка документов о взятках в правительстве.", turns: 2, pos: [{ t: "support", m: "once", v: -5 }, { t: "stab", m: "add", v: -0.5 }] },
    { id: "boom", name: "Инвестиционный бум", note: "Корпорации охотно вкладываются в страну.", turns: 4, pos: [{ t: "att", m: "pct", v: 10 }, { t: "os", m: "pct", v: 10 }] },
    { id: "guerrilla", name: "Партизанская война", note: "Повстанцы нападают на склады и конвои.", turns: 0, pos: [{ t: "stab", m: "add", v: -1 }, { t: "upkeep", m: "pct", v: 10 }] },
    { id: "rally", name: "Национальный подъём", note: "Победа или праздник сплотили общество.", turns: 2, pos: [{ t: "stab", m: "add", v: 1 }, { t: "morale", m: "pct", v: 5 }] },
    { id: "tribute", name: "Дань натурой", note: "Подчинённая территория отдаёт часть выпуска.", turns: 0, pos: [{ t: "stock", p: "metals", m: "add", v: 3 }] },
    { id: "gift", name: "Поставка вооружений", note: "Союзник передал технику.", turns: 1, pos: [{ t: "div", p: "tech", m: "once", v: 1 }] }];
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  function applyOnce(c, f) {
    const ch = [];
    for (const x of f.pos || []) {
      if (x.m !== "once") continue;
      const v = +x.v || 0;
      if (x.t === "stock") { c.stock = c.stock || {}; const o = n0(c.stock[x.p], 0), nv = Math.max(0, o + v); c.stock[x.p] = nv; ch.push({ k: "stock", p: x.p, d: nv - o }); }
      else if (x.t === "treasury") { c.treasury = n0(c.treasury, 0) + v; ch.push({ k: "treasury", d: v }); }
      else if (["stab", "support", "pol"].includes(x.t)) { const o = n0(c[x.t], 0), nv = lim(o + v, 0, x.t === "pol" ? 10 : 100); c[x.t] = nv; ch.push({ k: x.t, d: nv - o }); }
      else if (x.t === "ind" || x.t === "en") { c[x.t] = c[x.t] || {}; const o = n0(c[x.t][x.p], 0), nv = Math.max(0, o + v); c[x.t][x.p] = nv; ch.push({ k: x.t, p: x.p, d: nv - o }); }
      else if (x.t === "div") {
        if (v > 0) { c.armies.push({ name: f.name + ": отдельные дивизии", sep: true, fx: f.id, div: { [x.p]: v } }); ch.push({ k: "div+" }); }
        else { let need = -v; const took = []; for (const a of c.armies) { const t = Math.min(need, n0(a.div[x.p], 0)); if (t > 0) { a.div[x.p] -= t; took.push([a.name, t]); need -= t; } if (!need) break; } ch.push({ k: "div-", p: x.p, took }); }
      } else if (x.t === "ac" && v > 0) { c.flights.push({ name: f.name + ": звено", fx: f.id, mix: { [x.p]: v }, count: 1 }); ch.push({ k: "ac+" }); }
      else if (x.t === "ship" && v > 0) { c.squadrons.push({ name: f.name + ": эскадра", fx: f.id, kind: "surface", mix: { [x.p]: v }, count: 1 }); ch.push({ k: "ship+" }); }
    }
    f.applied = { turn: TS.n, ch };
  }
  function undoOnce(c, f) {
    for (const x of ((f.applied || {}).ch || []).slice().reverse()) {
      if (x.k === "stock") c.stock[x.p] = Math.max(0, n0(c.stock[x.p], 0) - x.d);
      else if (x.k === "treasury") c.treasury = n0(c.treasury, 0) - x.d;
      else if (["stab", "support", "pol"].includes(x.k)) c[x.k] = n0(c[x.k], 0) - x.d;
      else if (x.k === "ind" || x.k === "en") c[x.k][x.p] = Math.max(0, n0(c[x.k][x.p], 0) - x.d);
      else if (x.k === "div+") c.armies = c.armies.filter(a => a.fx !== f.id);
      else if (x.k === "div-") for (const [nm, t] of x.took) { const a = c.armies.find(y => y.name === nm); if (a) a.div[x.p] = n0(a.div[x.p], 0) + t; }
      else if (x.k === "ac+") c.flights = c.flights.filter(a => a.fx !== f.id);
      else if (x.k === "ship+") c.squadrons = c.squadrons.filter(a => a.fx !== f.id);
    }
    f.applied = null;
  }
  const fxUntil = f => (f.until == null ? "бессрочно" : "до хода " + f.until + " (" + Math.max(0, f.until - TS.n) + " ход.)");
  // список эффектов страны: ГМ видит все, игрок страны — кроме «только ГМу», посетитель — только «всем»
  function fxTable(c, who) {
    const list = (c.fx || []).filter(f => who === "gm" || (who === "player" ? f.vis !== "gm" : f.vis === "public"));
    if (!list.length) return NOTE("Особых эффектов нет.");
    return T(["Эффект", "Что даёт", "Срок"].concat(who === "gm" ? ["Видимость"] : []), list.map(f => ["<b>" + esc(f.name) + "</b>" + (f.off ? " <small>(выключен)</small>" : "") + (f.note ? "<br><small>" + esc(f.note) + "</small>" : ""),
      esc((f.pos || []).map(fxPosText).join("; ")), fxUntil(f)].concat(who === "gm" ? [FX_VIS[f.vis] || f.vis] : [])), "fx-t");
  }
  function fxPublic() {
    const rows = [];
    for (const [id, c] of Object.entries(D.countries)) for (const f of c.fx || []) if (f.vis === "public" && !f.off) rows.push(['<a href="#wiki/lore/states/' + esc(loreId(id)) + '">' + esc(c.name) + "</a>", "<b>" + esc(f.name) + "</b>" + (f.note ? "<br><small>" + esc(f.note) + "</small>" : ""), esc((f.pos || []).map(fxPosText).join("; ")), fxUntil(f)]);
    return rows.length ? T(["Страна", "Эффект", "Что даёт", "Срок"], rows) : NOTE("Сейчас общеизвестных особых эффектов нет.");
  }
  // ---------- государство и стабильность (блок результата) ----------
  function govBlock(c) {
    const g = c.gov || {}, rows = [["Цивилизационный вектор", esc(g.vector || "Не указано в лоре")]];
    for (const a of M.agendas) rows.push([esc(a.title), esc(g[a.key] || "Не указано в лоре")]);
    return "<h3>Политическая повестка</h3>" + kv(rows) + NOTE("«Не указано в лоре» — в статье страны нет прямого ответа; администратор может задать значение в калькуляторе.");
  }
  function stabBlock(r, c, gmView) {
    const st = Model.stability(D, c, r), o = st.out, sg = v => (v > 0 ? "+" : "") + num(v, 2), G = { eco: "Экономика", pol: "Политика и мир", fx: "Особые эффекты" };
    const rows = st.f.map(x => [G[x.g] || x.g, esc(x.name), '<b style="color:' + (x.v < 0 ? "var(--danger)" : "inherit") + '">' + sg(x.v) + "</b>"]);
    return kv([["Стабильность", "<b>" + num(st.S, 1) + "</b> из 100 " + bar(st.S, 100) + (Math.abs(st.instant) > 0.05 ? " · с санкциями и блокадами сейчас " + num(st.eff, 1) : "")],
      ["За ход", "<b>" + sg(st.delta) + "</b> → " + num(st.next, 1)], ["Уровень вектора", st.base + (st.vec ? " («" + esc(st.vec) + "»)" : "")],
      ["Состояние общественности", esc(st.society.name) + " (" + (st.society.mod > 0 ? "+" : "") + st.society.mod + " к шансу негативной реакции на реформу)"],
      ["Поддержка власти", num(st.support, 0) + "% → " + num(st.supNext, 1) + "%"], ["Запас АВ на ход", "<b>" + num(r.av, 1) + "</b> (режим ×" + num(Model.REG_AV[r.regime] || 1, 2) + (gmView ? ", совместимость ×" + num(r.compat, 2) : "") + ")"]]) +
      (rows.length ? T(["Группа", "Причина", "За ход"], rows) : "") +
      "<h4>Что сейчас даёт стабильность</h4>" + kv([["ВВП", "×" + num(o.gdp, 2)], ["Собираемость налогов", "×" + num(o.tax, 2)], ["Очки строительства", "×" + num(o.os, 2)], ["Привлекательность корпораций", "×" + num(o.att, 2)],
        ["Прирост населения", "×" + num(o.growth, 2)], ["Запас АВ", "×" + num(o.av, 2)], ["Мораль войск", "×" + num(o.morale, 2) + " (с эффектами ×" + num(r.morale, 2) + ")"]]);
  }
  // редактор эффектов ГМа (в «Калькуляторе»)
  function fxEditor(c, onChange) {
    c.fx = c.fx || [];
    const wrap = h("div"), list = h("div"), form = h("div", "calc-fx-form");
    const draw = () => {
      list.innerHTML = fxTable(c, "gm");
      const rows = [...list.querySelectorAll("tbody tr")];
      if (list.querySelector("thead tr")) list.querySelector("thead tr").append(h("th", null, ""));
      rows.forEach((tr, i) => {
        const f = c.fx[i]; if (!f) return; const td = h("td");
        const b1 = h("button", "small-btn", f.off ? "Включить" : "Выключить"); b1.type = "button"; b1.onclick = () => { f.off = !f.off; draw(); onChange(); };
        const b2 = h("button", "small-btn danger", "✕"); b2.type = "button"; b2.title = "Удалить";
        b2.onclick = async () => {
          const back = f.applied && f.applied.turn === TS.n && (f.applied.ch || []).length;
          if (!(await KG.ask("Удалить эффект «" + f.name + "»?", "", { confirm: true, note: back ? "Разовые позиции этого хода будут возвращены." : "" }))) return;
          if (back) undoOnce(c, f);
          c.fx.splice(c.fx.indexOf(f), 1); (TS.pending = TS.pending || []).push({ t: "Снят эффект «" + f.name + "» (" + c.name + ")", ids: [c.cid], gm: f.vis === "gm" }); draw(); onChange();
        };
        td.append(b1, b2); tr.append(td);
      });
    };
    // форма нового эффекта
    const tpl = h("select"); tpl.innerHTML = '<option value="">— свой эффект —</option>' + FX_TPL.map(t => '<option value="' + t.id + '">' + esc(t.name) + "</option>").join("");
    const nm = h("input"); nm.placeholder = "Название"; nm.style.width = "200px";
    const nt = h("input"); nt.placeholder = "Пояснение для игрока"; nt.style.width = "320px";
    const turns = h("input"); turns.type = "number"; turns.min = 0; turns.value = 0; turns.style.width = "70px"; turns.title = "Ходов (0 — бессрочно)";
    const vis = h("select"); vis.innerHTML = Object.entries(FX_VIS).map(([k, v]) => '<option value="' + k + '">' + v + "</option>").join("");
    const posBox = h("div"); let pos = [];
    const drawPos = () => {
      posBox.replaceChildren();
      pos.forEach((x, i) => {
        const row = h("div", "mixrow"), st = h("select"), sm = h("select"), sp = h("select"), sv = h("input");
        st.innerHTML = Model.FX_TARGETS.map(t => '<option value="' + t[0] + '">' + esc(t[1]) + "</option>").join(""); st.value = x.t;
        const T0 = fxT(x.t), modes = T0[2].split(" ");
        if (!modes.includes(x.m)) x.m = modes[0];
        sm.innerHTML = modes.map(m => '<option value="' + m + '">' + FX_MODE[m] + "</option>").join(""); sm.value = x.m;
        const subs = fxSubs(T0[3]); sp.innerHTML = subs.map(s => '<option value="' + s[0] + '">' + esc(s[1]) + "</option>").join(""); sp.style.display = subs.length ? "" : "none";
        if (subs.length && !subs.some(s => s[0] === x.p)) x.p = subs[0][0]; if (!subs.length) delete x.p; if (x.p) sp.value = x.p;
        sv.type = "number"; sv.step = "any"; sv.value = x.v; sv.style.width = "80px";
        st.onchange = () => { x.t = st.value; drawPos(); }; sm.onchange = () => { x.m = sm.value; }; sp.onchange = () => { x.p = sp.value; }; sv.oninput = () => { x.v = +sv.value || 0; };
        const del = h("button", "small-btn danger", "✕"); del.type = "button"; del.onclick = () => { pos.splice(i, 1); drawPos(); };
        row.append(st, sp, sm, sv, del); posBox.append(row);
      });
      const add = h("button", "small-btn", "+ позиция"); add.type = "button"; add.onclick = () => { pos.push({ t: "gdp", m: "pct", v: 5 }); drawPos(); }; posBox.append(add);
    };
    tpl.onchange = () => { const t = FX_TPL.find(x => x.id === tpl.value); if (!t) return; nm.value = t.name; nt.value = t.note; turns.value = t.turns; pos = clone(t.pos); drawPos(); };
    const go = h("button", "small-btn accent", "Ввести эффект"); go.type = "button";
    go.onclick = () => {
      if (!nm.value.trim()) { KG.toast("Введите название эффекта"); return; }
      if (!pos.length) { KG.toast("Добавьте хотя бы одну позицию"); return; }
      const f = { id: "fx" + Date.now().toString(36), name: nm.value.trim(), note: nt.value.trim(), tpl: tpl.value || "", pos: clone(pos), from: TS.n, until: +turns.value > 0 ? TS.n + Math.round(+turns.value) : null, vis: vis.value };
      if (f.pos.some(x => x.m === "once")) applyOnce(c, f);
      c.fx.push(f); (TS.pending = TS.pending || []).push({ t: "Введён эффект «" + f.name + "» (" + c.name + "): " + f.pos.map(fxPosText).join("; "), ids: [c.cid], gm: f.vis === "gm" });
      TS.stamp = Date.now(); pos = []; nm.value = nt.value = ""; tpl.value = ""; turns.value = 0; drawPos(); draw(); onChange(true);
    };
    form.append(h("div", "calc-bar"), posBox);
    form.firstChild.append(tpl, nm, nt, h("span", "mech-note", "ходов (0 — бессрочно):"), turns, vis, go);
    drawPos(); draw();
    wrap.append(list, h("h4", null, "Новый эффект"), form, NOTE("Разовые позиции (склад, казна, заводы, войска) применяются сразу при вводе. Срок истекает при проведении хода; откат журнала убирает эффекты, введённые после выбранного хода."));
    return wrap;
  }

  // ---------- «Моя страна» (игрок, только просмотр) ----------
  async function renderMy(box) {
    await load();
    const gm = isGm();
    let id = playerId();
    box.replaceChildren(h("h1", "mv-title", "Моя страна"));
    if (gm) {
      const sel = h("select"); sel.innerHTML = countryEntries().map(([k, name]) => '<option value="' + k + '">' + esc(name) + "</option>").join("");
      sel.value = id && D.countries[id] ? id : countryEntries()[0][0]; id = sel.value;
      const combo = countryCombo(sel, false);
      sel.onchange = () => { id = sel.value; combo.sync(); draw(); };
      box.append(h("p", "mv-sub", "Режим администратора: выберите страну для просмотра."), sel, combo.el);
    }
    if (!gm && (!id || !D.countries[id])) { box.append(h("p", "mech-note", "Войдите как игрок на Главной: государство и пароль.")); return; }
    const out = h("div", "calc-out"); box.append(out);
    let active = "overview";
    bindCountryTabs(out, tab => { active = tab; draw(); });
    function draw() {
      const c = D.countries[id], { ids, rs, ix } = results(), k = ids.indexOf(id), r = rs[k], rank = ix.map(x => x.total).sort((a, b) => b - a).indexOf(ix[k].total) + 1;
      let body = "";
      if (active === "overview") body = overviewCards(c, r, ix[k], rank, ids.length) + '<p class="mv-sub">Ход ' + TS.n + " · " + esc(turnNow()) + "</p>" + warnBlock(c, r);
      else if (active === "state") body = "<h2>Государство и стабильность</h2>" + govBlock(c) + stabBlock(r, c, gm);
      else if (active === "economy") body = "<h2>Экономика</h2>" + ecoBlock(r, c, "main");
      else if (active === "army") body = "<h2>Армия</h2>" + forcesBlock(r, "land") + listTables(r, c, "army");
      else if (active === "fleet") body = "<h2>ВВС и флот</h2>" + forcesBlock(r, "fleet") + listTables(r, c, "fleet");
      else if (active === "corp") body = "<h2>Корпорации и зарплаты</h2>" + ecoBlock(r, c, "corp");
      else if (active === "effects") body = "<h2>Особые эффекты</h2>" + fxTable(c, gm ? "gm" : "player") + "<h2>Санкции и блокады</h2>" + measuresTable(id) + measureEffects(r, c) + "<h2>История ходов</h2>" + journalHtml(id) + NOTE("Только просмотр: значения меняет администратор.") + GMN("данные тестовые.");
      else body = "<h2>Страшные цифры</h2>" + NOTE("Подробные исходные значения и промежуточные расчёты. Основные итоги остаются в тематических вкладках.") + ecoBlock(r, c, "scary") + "<h3>Вооружённые силы: детальные числа</h3>" + forcesBlock(r, "details") + listTables(r, c, "details");
      out.innerHTML = (gm ? "" : '<p class="mv-sub">' + esc(c.name) + " · столица " + esc(c.capital || "—") + "</p>") + countryTabsHtml(active, body);
      enhanceTips(out);
    }
    draw();
  }

  // ---------- Калькулятор (ГМ) ----------
  const FIELDS = [
    ["Население и государство", [["pop", "Население, млн", 0.01], ["work", "Доля работающих", 0.01], ["edu", "Образование (0–1)", 0.01], ["tech", "Технологии (1–10)", 0.5], ["stab", "Стабильность, %", 1], ["support", "Поддержка власти, %", 1],
      ["tax", "Налог (доля)", 0.01], ["corr", "Коррупция, %", 1]]],
    ["Стабильность и власть", [["compat", "Совместимость повесток (0,6–1,4, скрыта от игрока)", 0.05], ["fatigue", "Усталость от конфронтаций, %", 1], ["reform.turn", "Ход последней реформы", 1], ["reform.ok", "Итог последней реформы: 1 — успешная, −1 — провалившаяся", 1], ["reform.n4", "Реформ за последние 4 хода", 1]]],
    ["Промышленность (заводы по видам)", [["ind.heavy", "Тяжёлая", 1], ["ind.chem", "Химическая", 1], ["ind.hitech", "Высокотехнологичная", 1], ["ind.light", "Лёгкая", 1], ["ind.vpk", "ВПК", 1], ["ind.ship", "Верфи", 1], ["ind.aero", "Авиапром", 1]]],
    ["Энергия и сырьё", [["en.fusion", "Термоядерные блоки", 0.1], ["en.renew", "Возобновляемые блоки", 0.1], ["en.fossil", "Тепловые блоки", 0.1], ["raw", "Запасы сырья", 1]]],
    ["Территория", [["terr.meg", "Мегаполисов", 1], ["terr.prov", "Провинций", 1], ["terr.hab", "Доля пригодной земли", 0.01], ["terr.flood", "Доля затопленной земли", 0.01], ["terr.rad", "Радиация (0–10)", 0.1]]],
    ["Корпорации, частный сектор, дань", [["priv_base", "Частный сектор: основа (доля)", 0.01], ["corp.infl", "Влияние корпораций", 1], ["corp.gdp", "Корпорации: прибавка к ВВП (доля)", 0.01], ["corp.bud", "Корпорации: изменение доходов бюджета (доля)", 0.01], ["tribute", "Дань по лору, млрд кр./год", 1]]],
    ["Природные запасы и экология", [["dev", "Освоение территории (0–1)", 0.01], ["nat.dep", "Доля залежей", 0.01], ["nat.rock", "Доля пород", 0.01], ["nat.ore", "Доля рудных жил", 0.01], ["depl.dep", "Истощение залежей (0–1)", 0.01], ["depl.rock", "Истощение пород (0–1)", 0.01], ["depl.ore", "Истощение руд (0–1)", 0.01], ["pol", "Загрязнение (0–10)", 0.1]]],
    ["Торговля, склад, корпорации", [["protect", "Протекционизм (доля)", 0.01], ["subsidy", "Субсидии корпорациям (0 — нет)", 1], ["store", "Склады: дополнительная вместимость, УЕ", 10], ["hydro", "Гидропоника и аквафермы, УЕ еды за ход", 1]]],
    ["План государства: доли ОС на новые сооружения (0 везде — автоплан по приоритетам)", [["plan.heavy", "Тяжёлая", 0.01], ["plan.chem", "Химическая", 0.01], ["plan.hitech", "Высокотехнологичная", 0.01], ["plan.light", "Лёгкая", 0.01], ["plan.vpk", "ВПК", 0.01], ["plan.ship", "Верфи", 0.01], ["plan.aero", "Авиапром", 0.01], ["plan.fusion", "Термоядерные блоки", 0.01], ["plan.renew", "Возобновляемые блоки", 0.01], ["plan.fossil", "Тепловые блоки", 0.01]]],
    ["Кадры", [["rn", "Резерв населения без жилья (ед. по 100 тыс.)", 1]]],
    ["Поправки лора: множители ВВП и выпуска продуктов", [["lore.gdp", "ВВП", 0.05], ["lore.res.en", "Энергия", 0.05], ["lore.res.raw", "Рудные жилы", 0.05], ["lore.res.eq", "Механика и электроника", 0.05], ["lore.res.bm", "Стройматериалы", 0.05], ["lore.res.rare", "Драгоценности", 0.05]]]];
  const getP = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  const setP = (o, p, v) => { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] = a[ks[i]] || {}; a[ks[ks.length - 1]] = v; };
  const BUD = [["def", "Оборона"], ["space", "Космос"], ["sci", "Наука"], ["soc", "Социальные"], ["infra", "Инфраструктура"]];
  const RULES = [["te_per_mln", "ТЕ на 1 млн работников", "док."], ["kte_w", "Вес КТЕ относительно ТЕ", "док."], ["wage_te", "Оплата ТЕ, кр./ход", "док."], ["wage_kte", "Оплата КТЕ, кр./ход", "док."], ["os_per_epp", "ОС на 1 ЕПП", "док."],
    ["turns_year", "Ходов в году", "док."], ["army_grow", "Прирост параметров на 1 часть", "док."], ["flight_max", "Самолётов в звене", "решение"], ["squad_max", "Кораблей в эскадре", "решение"],
    ["skilled_base", "Доля КТЕ: основа", "предл."], ["skilled_edu", "Доля КТЕ: за образование", "предл."], ["skilled_tech", "Доля КТЕ: за технологии", "предл."], ["skilled_max", "Доля КТЕ: потолок", "предл."],
    ["prod_base", "Производительность: основа", "предл."], ["prod_tech", "Производительность за уровень технологий", "предл."], ["stab_floor", "Стабильность: минимум", "предл."], ["stab_w", "Стабильность: вес", "предл."],
    ["epp_fact", "ЕПП с одного завода", "предл."], ["epp_en", "ЕПП с одного энергоблока", "предл."], ["tech_ref", "Опорный уровень технологий", "предл."], ["tech_k", "Параметры за уровень технологий", "предл."],
    ["w_atk", "Вес атаки", "предл."], ["w_def", "Вес обороны", "предл."], ["w_fast", "Вес стремительности", "предл."], ["w_react", "Вес реагирования", "предл."],
    ["w_land", "Вес дивизий в мощи страны", "предл."], ["w_air", "Вес авиации в мощи страны", "предл."], ["w_navy", "Вес флота в мощи страны", "предл."],
    ["inm_eco", "ИНМ: вес экономики", "предл."], ["inm_army", "ИНМ: вес армии", "предл."], ["inm_tech", "ИНМ: вес технологий", "предл."], ["inm_pop", "ИНМ: вес населения", "предл."], ["sup_flight_ac", "Снабжение самолёта, ед./ход", "предл."],
    ["kut_meg", "КУТ мегаполиса", "док."], ["kut_norm", "КУТ обычной провинции", "док."], ["kut_flood", "КУТ затопленной провинции", "док."], ["kut_waste", "КУТ радиоактивной пустоши", "док."], ["kut_infect", "КУТ зоны заражения", "док."],
    ["meg_area", "Ячеек застройки на мегаполис", "предл."], ["prov_area", "Ячеек застройки на провинцию", "предл."],
    ["a_fusion", "Энергия: термоядерный блок", "предл."], ["a_renew", "Энергия: возобновляемый блок", "предл."], ["a_fossil", "Энергия: тепловой блок", "предл."], ["raw_k", "Сырьё: выпуск на единицу запасов", "предл."],
    ["eq_heavy", "Оборудование: тяжёлая промышленность", "предл."], ["eq_hitech", "Оборудование: высокотехнологичная", "предл."], ["eq_vpk", "Оборудование: ВПК", "предл."], ["eq_aero", "Оборудование: авиапром", "предл."], ["eq_ship", "Оборудование: верфи", "предл."],
    ["bm_heavy", "Стройматериалы: тяжёлая", "предл."], ["bm_chem", "Стройматериалы: химическая", "предл."], ["bm_light", "Стройматериалы: лёгкая", "предл."],
    ["rare_hitech", "Редкие элементы: высокотехнологичная", "предл."], ["rare_chem", "Редкие элементы: химическая", "предл."], ["rare_raw", "Редкие элементы: запасы сырья", "предл."],
    ["eni_bn", "НИП за 1 млрд бюджета науки", "предл."], ["eni_meg", "НИП за мегаполис", "предл."], ["nip_hitech", "НИП с высокотехнологичного завода", "предл."],
    ["expand_share", "Доля ОС на новые заводы и энергоблоки", "предл."], ["os_unit", "ОС на единицу категории при КУТ 1", "предл."], ["mkt_k", "Рынок: резкость выбора выгодных видов", "предл."], ["plan_floor", "Автоплан: базовая доля вида", "предл."], ["plan_boost", "Автоплан: реакция на нехватку продуктов", "предл."],
    ["price_min", "Цена: нижняя граница множителя", "предл."], ["price_max", "Цена: верхняя граница множителя", "предл."], ["stock_damp", "Склад гасит скачок цены (доля)", "предл."], ["store_cap", "Вместимость склада на единицу площади", "предл."], ["route_k", "Пропускная способность пути на единицу площади", "предл."], ["price_turns", "Ходов между пересчётами цен", "док."],
    ["wage_dev", "Ожидаемая ЗП: основа", "предл."], ["wage_tech", "Ожидаемая ЗП: за уровень технологий", "предл."], ["lab_mod", "Рынок труда: чувствительность", "предл."], ["mrot", "МРОТ (доля ожидаемой ЗП)", "предл."], ["wage_cap", "Потолок реальной ЗП (доля ожидаемой)", "предл."], ["pres_share", "Доля частного сектора на единицу присутствия", "предл."], ["excise", "Акцизы (доля выручки)", "предл."], ["logi", "Логистика (доля выручки)", "предл."], ["corp_tax", "Налог корпораций (доля ставки страны)", "предл."], ["att_min", "Привлекательность: минимум", "предл."], ["att_max", "Привлекательность: максимум", "предл."], ["state_wage", "ЗП в госсекторе: основа", "предл."],
    ["conv", "Переработка: доля выпуска от сырья", "предл."], ["tm_ext", "Добыча: прирост за уровень технологий", "предл."], ["depl_base", "Истощение за ход (основа)", "предл."], ["depl_pol", "Истощение: влияние загрязнения", "предл."], ["fuel_block", "Топлива на тепловой блок", "предл."],
    ["pol_heavy", "Выброс: тяжёлая", "предл."], ["pol_chem", "Выброс: химическая", "предл."], ["pol_vpk", "Выброс: ВПК", "предл."], ["pol_hitech", "Выброс: высокие технологии", "предл."], ["pol_ship", "Выброс: верфи", "предл."], ["pol_aero", "Выброс: авиапром", "предл."], ["pol_fossil", "Выброс: тепловой блок", "предл."], ["pol_area", "Выбросы на площадь", "предл."], ["pol_decay", "Самоочищение", "предл."], ["clean_bn", "Очистка за 1 млрд бюджета", "предл."], ["pol_gdp", "Потеря ВВП при загрязнении 10", "предл."], ["pol_out", "Шанс очага при загрязнении 10", "предл."],
    ["army_sk", "Доля СВТК в военных кадрах", "предл."], ["army_sk_tech", "СВТК за уровень технологий выше 3", "предл."], ["growth_turn", "Прирост населения за ход", "предл."], ["os_home", "ОС на 100 тыс. жилья", "предл."], ["home_share", "Доля ОС на жильё", "предл."], ["priv_infl", "Частный сектор: за единицу влияния корпораций", "предл."]];

  async function renderCalc(box) {
    await load();
    if (!orig) orig = clone(D.countries);
    box.replaceChildren(h("h1", "mv-title", "Калькулятор"), h("p", "mv-sub", "Страна, исходные числа, армии, звенья и эскадры. Правки сохраняются черновиком в этом браузере."));
    const bar1 = h("div", "calc-bar"), sel = h("select"), out = h("div", "calc-out"), inp = h("div", "calc-in");
    sel.innerHTML = countryEntries().map(([k, name]) => '<option value="' + k + '">' + esc(name) + "</option>").join("");
    const combo = countryCombo(sel, false);
    let id = sel.value;
    const btn = (t, f, cls) => { const b = h("button", "small-btn" + (cls ? " " + cls : ""), t); b.type = "button"; b.onclick = f; return b; };
    bar1.append(sel, combo.el, btn("Сбросить страну", () => { D.countries[id] = clone(orig[id]); saveDraft(); build(); }), btn("Копировать JSON страны", () => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(D.countries[id], null, 1)); KG.toast("Скопировано"); }));
    const turnBox = h("div", "calc-turn panel"), jr = h("div", "calc-journal");
    function drawTurn() {
      turnBox.innerHTML = "";
      const head = h("div", "calc-bar", "<b>Ход " + TS.n + " · " + esc(turnNow()) + "</b>");
      const go = btn("Провести ход", () => { const e = endTurn(); KG.toast("Ход " + e.n + " проведён: " + e.label); build(); drawTurn(); }, "accent");
      const rb = h("select"); rb.innerHTML = '<option value="">Откатить к началу хода…</option>' + TS.log.slice().reverse().filter(e => !e.noRollback).map(e => '<option value="' + e.n + '">ход ' + e.n + " (" + esc(e.label) + ")</option>").join("");
      rb.onchange = async () => { const v = +rb.value; if (!v) return; if (await KG.ask("Откатить к началу хода " + v + "?", "", { confirm: true, note: "Ходы " + v + " – " + TS.n + " будут удалены из журнала, состояние стран вернётся." })) { rollbackTo(v); build(); drawTurn(); } else rb.value = ""; };
      head.append(go, rb, btn("Скачать журнал", downloadJournal), btn("Очистить журнал", async () => { if (TS.log.some(e => e.noRollback)) { KG.toast("Журнал длиннее 12 ходов: откат к началу недоступен. Скачайте журнал."); return; } if (TS.log.length && await KG.ask("Очистить журнал и вернуть страны к началу первого хода?", "", { confirm: true })) { rollbackTo(TS.log[0].n); build(); drawTurn(); } }));
      const st = h("div", "calc-bar", "Старт кампании: год ");
      const y = h("input"); y.type = "number"; y.value = TS.start.year; y.style.width = "80px"; y.disabled = TS.n > 0;
      const q = h("select"); q.innerHTML = [1, 2, 3, 4].map(i => '<option value="' + i + '">' + i + " кв.</option>").join(""); q.value = TS.start.q; q.disabled = TS.n > 0;
      y.oninput = q.onchange = () => { TS.start = { year: +y.value || 2200, q: +q.value || 1 }; TS.stamp = Date.now(); saveDraft(); head.firstChild.innerHTML = "Ход " + TS.n + " · " + esc(turnNow()); };
      st.append(y, q, h("span", "mech-note", TS.n > 0 ? "Старт можно менять, пока не проведён первый ход." : "Ход = квартал, год = " + D.K.turns_year + " хода. Цены пересчитываются раз в " + D.K.price_turns + " хода."));
      turnBox.append(head, st);
      jr.innerHTML = "<h2>Журнал ходов</h2>" + journalHtml(null) + NOTE("Чтобы закрепить состояние в данных сайта, скачайте журнал и положите файл как data/turns.json (команда: python Лор/ход.py путь_к_файлу).");
    }
    const mbox = h("div", "calc-meas panel");
    function drawMeas() {
      mbox.innerHTML = "<h2>Санкции и блокады</h2>";
      const ids = Object.keys(D.countries), opt = (all) => (all ? '<option value="*">все страны</option>' : "") + ids.map(i => '<option value="' + i + '">' + esc(D.countries[i].name) + "</option>").join("");
      const f = h("div", "calc-bar");
      const kind = h("select"); kind.innerHTML = Object.entries(KINDS).map(([k, v]) => '<option value="' + k + '">' + v + "</option>").join("");
      const by = h("select"); by.innerHTML = opt(false); const ag = h("select"); ag.innerHTML = opt(true); ag.value = ids[1] || "*";
      const pr = h("select"); pr.multiple = true; pr.size = 6; pr.innerHTML = '<option value="all" selected>все продукты</option>' + (D.products || []).filter(p => p.cat === "prod" || ["dep", "rock", "ore"].includes(p.id)).map(p => '<option value="' + p.id + '">' + esc(p.name) + "</option>").join("");
      const num1 = (ph, v, w) => { const i = h("input"); i.type = "number"; i.placeholder = ph; i.title = ph; i.value = v; i.style.width = w || "90px"; return i; };
      const tar = num1("Надбавка к пошлине, %", 25), shr = num1("Перекрытие, %", 50), mul = num1("Квота торговли, %", 50), unt = num1("Ходов (0 — бессрочно)", 0, "110px"), note = h("input"); note.placeholder = "Заметка"; note.style.width = "160px";
      f.append(kind, by, h("span", "mech-note", "→"), ag, pr, tar, shr, mul, unt, note);
      const upd = () => { const k = kind.value; tar.style.display = k === "sanction:tariff" ? "" : "none"; shr.style.display = k === "blockade" ? "" : "none"; mul.style.display = k === "other" ? "" : "none"; pr.style.display = k === "blockade" ? "none" : ""; };
      kind.onchange = upd; upd();
      const add = btn("Ввести", () => {
        if (ag.value === by.value) { KG.toast("Страна не может вводить меры против себя"); return; }
        const k = kind.value, sel = [...pr.selectedOptions].map(o => o.value), m = { id: "m" + Date.now().toString(36), kind: k.split(":")[0], by: by.value, against: ag.value, products: sel.includes("all") || !sel.length ? "all" : sel, note: note.value.trim(), from: TS.n };
        if (k.startsWith("sanction")) { m.mode = k.split(":")[1]; if (m.mode === "tariff") m.tariff = (+tar.value || 0) / 100; }
        if (k === "blockade") m.share = Math.min(1, Math.max(0, (+shr.value || 0) / 100));
        if (k === "other") m.mult = Math.min(1, Math.max(0, (+mul.value || 0) / 100));
        if (+unt.value > 0) m.until = TS.n + Math.round(+unt.value);
        (TS.measures = TS.measures || []).push(m); (TS.pending = TS.pending || []).push({ t: "Введено: " + measureText(m), ids: [m.by, m.against] });
        TS.stamp = Date.now(); syncMeasures(); saveDraft(); drawMeas(); drawOut();
      }, "accent");
      f.append(add); mbox.append(f);
      const list = h("div"); list.innerHTML = measuresTable(null); mbox.append(list);
      [...list.querySelectorAll("tbody tr")].forEach((tr, i) => { const m = TS.measures[i]; if (!m) return; const td = h("td"); td.append(btn("Снять", () => { TS.measures.splice(i, 1); (TS.pending = TS.pending || []).push({ t: "Снято: " + measureText(m), ids: [m.by, m.against] }); TS.stamp = Date.now(); syncMeasures(); saveDraft(); drawMeas(); drawOut(); }, "danger")); tr.append(td); });
      if (list.querySelector("thead tr")) list.querySelector("thead tr").append(h("th", null, ""));
    }
    box.append(turnBox, bar1, inp, out, mbox, jr);
    drawMeas();
    drawTurn();
    sel.onchange = () => { id = sel.value; combo.sync(); build(); };

    const numIn = (val, step, set, w) => { const i = h("input"); i.type = "number"; i.step = step; i.value = val; if (w) i.style.width = w; i.oninput = () => { set(i.value === "" ? 0 : +i.value); change(); }; return i; };
    function change() { saveDraft(); drawOut(); }
    function mixEditor(c, list, key, max) {
      // таблица строк «название, состав (тип + число), количество одинаковых»
      const arr = c[key], wrap = h("div");
      const types = key === "flights" ? D.aircraft : D.ships;
      const render = () => {
        wrap.replaceChildren();
        const tb = h("table", "mt calc-tab"); tb.append(h("thead", null, "<tr><th>Название</th><th>Состав (тип × число)</th><th>Всего в соед.</th><th>Одинаковых</th>" + (key === "squadrons" ? "<th>На консервации</th>" : "") + "<th></th></tr>"));
        const body = h("tbody");
        arr.forEach((a, i) => {
          const tr = h("tr"), td0 = h("td"), td1 = h("td"), td2 = h("td"), td3 = h("td"), td4 = h("td");
          const nm = h("input"); nm.value = a.name; nm.oninput = () => { a.name = nm.value; change(); }; td0.append(nm);
          const entries = () => Object.entries(a.mix);
          const drawMix = () => {
            td1.replaceChildren();
            for (const [tid, n] of entries()) {
              const row = h("div", "mixrow"), s = h("select"); s.innerHTML = types.map(t => '<option value="' + t.id + '">' + esc(t.name) + "</option>").join(""); s.value = tid;
              s.onchange = () => { const v = a.mix[tid]; delete a.mix[tid]; a.mix[s.value] = (a.mix[s.value] || 0) + v; drawMix(); change(); };
              const ni = numIn(n, 1, v => { a.mix[tid] = v; tot(); }, "64px");
              const x = btn("✕", () => { delete a.mix[tid]; drawMix(); tot(); change(); }, "danger"); row.append(s, ni, x); td1.append(row);
            }
            td1.append(btn("+ тип", () => { const t = types.find(t => !(t.id in a.mix)) || types[0]; a.mix[t.id] = (a.mix[t.id] || 0) + 1; drawMix(); tot(); change(); }));
          };
          const tot = () => { const n = Object.values(a.mix).reduce((s, v) => s + (+v || 0), 0); td2.innerHTML = n > max ? '<b style="color:var(--danger)">' + n + " (больше " + max + ")</b>" : String(n); };
          drawMix(); tot();
          td3.append(numIn(a.count || 1, 1, v => { a.count = v; }, "56px"));
          const tdc = h("td"); if (key === "squadrons") tdc.append(numIn(a.cons || 0, 1, v => { a.cons = v; }, "56px"));
          td4.append(btn("✕", () => { arr.splice(i, 1); render(); change(); }, "danger"));
          tr.append(td0, td1, td2, td3); if (key === "squadrons") tr.append(tdc); tr.append(td4); body.append(tr);
        });
        tb.append(body); const tw = h("div", "mt-wrap"); tw.append(tb); wrap.append(tw, btn(key === "flights" ? "+ Звено" : "+ Эскадра", () => { arr.push({ name: key === "flights" ? "Новое звено" : "Новая эскадра", mix: {}, count: 1 }); render(); change(); }));
      };
      render(); return wrap;
    }
    function armyEditor(c) {
      const wrap = h("div"), tb = h("table", "mt calc-tab");
      tb.append(h("thead", null, "<tr><th>Армия</th>" + D.divTypes.map(t => "<th>" + esc(t.name) + "</th>").join("") + "<th>Отдельные (не армия)</th><th></th></tr>"));
      const body = h("tbody");
      c.armies.forEach((a, i) => {
        const tr = h("tr"), t0 = h("td"), nm = h("input"); nm.value = a.name; nm.oninput = () => { a.name = nm.value; change(); }; t0.append(nm); tr.append(t0);
        for (const t of D.divTypes) { const td = h("td"); td.append(numIn(a.div[t.id] || 0, 1, v => { a.div[t.id] = v; }, "64px")); tr.append(td); }
        const tds = h("td"), cb = h("input"); cb.type = "checkbox"; cb.checked = !!a.sep; cb.onchange = () => { a.sep = cb.checked; change(); }; tds.append(cb); tr.append(tds);
        const tdx = h("td"); tdx.append(btn("✕", () => { c.armies.splice(i, 1); build(); change(); }, "danger")); tr.append(tdx); body.append(tr);
      });
      tb.append(body); const w = h("div", "mt-wrap"); w.append(tb); wrap.append(w, btn("+ Армия", () => { c.armies.push({ name: "Новая армия", div: {} }); build(); change(); }));
      return wrap;
    }
    function agendaEditor(c) {
      const grid = h("div", "calc-grid");
      const add = (key, title, options) => {
        const label = h("label", "f-row"), select = h("select");
        select.innerHTML = '<option value="">— Не указано в лоре —</option>' + options.map(v => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
        select.value = (c.gov && c.gov[key]) || "";
        select.onchange = () => {
          c.gov = c.gov || {};
          if (select.value) c.gov[key] = select.value; else delete c.gov[key];
          change();
        };
        label.append(h("span", null, title), select); grid.append(label);
      };
      add("vector", "Цивилизационный вектор", ["Превосходство", "Чистота", "Духовность", "Гармония", "Господство", "Ненасытность", "Равновесие"]);
      for (const a of M.agendas) add(a.key, a.title, a.options);
      return grid;
    }
    function build() {
      const c = D.countries[id]; inp.replaceChildren();
      const g = h("div", "calc-grid");
      for (const [grp, list] of FIELDS) {
        g.append(h("h3", "calc-grp", grp));
        for (const [k, label, step] of list) { const l = h("label", "f-row"), s = h("span", null, label), cur = getP(c, k); l.append(s, numIn(cur == null ? (k.startsWith("lore.") ? 1 : 0) : cur, step, v => { setP(c, k, v); })); g.append(l); }
      }
      g.append(h("h3", "calc-grp", "Бюджет"));
      for (const [k, label] of BUD) { const l = h("label", "f-row"), s = h("span", null, "Бюджет: " + label.toLowerCase() + " (доля)"); l.append(s, numIn(c.b[k], 0.01, v => { c.b[k] = v; })); g.append(l); }
      inp.append(h("h2", null, "Политическая повестка"), agendaEditor(c), h("h2", null, "Исходные данные"), g, h("h2", null, "Армии"), armyEditor(c), h("h2", null, "Авиационные звенья"), mixEditor(c, D.aircraft, "flights", D.K.flight_max), h("h2", null, "Эскадры"), mixEditor(c, D.ships, "squadrons", D.K.squad_max), h("h2", null, "Особые эффекты"), fxEditor(c, full => { saveDraft(); if (full) drawMeas(); drawOut(); }));
      drawOut();
    }
    let active = "overview";
    bindCountryTabs(out, tab => { active = tab; drawOut(); });
    function drawOut() {
      const c = D.countries[id], { ids, rs, ix } = results(), k = ids.indexOf(id), r = rs[k], rank = ix.map(x => x.total).sort((a, b) => b - a).indexOf(ix[k].total) + 1;
      let body = "";
      if (active === "overview") body = overviewCards(c, r, ix[k], rank, ids.length) + warnBlock(c, r) + "<h3>Рейтинг ИНМ</h3>" + T(["Страна", "ИНМ", "Экономика", "Армия", "Технологии", "Население"], ids.map((i, j) => [esc(D.countries[i].name), num(ix[j].total, 1), num(ix[j].eco, 0), num(ix[j].army, 0), num(ix[j].tech, 0), num(ix[j].pop, 0)]));
      else if (active === "state") body = "<h3>Государство и стабильность</h3>" + govBlock(c) + stabBlock(r, c, true);
      else if (active === "economy") body = "<h3>Экономика</h3>" + ecoBlock(r, c, "main");
      else if (active === "army") body = "<h3>Армия</h3>" + forcesBlock(r, "land") + listTables(r, c, "army");
      else if (active === "fleet") body = "<h3>ВВС и флот</h3>" + forcesBlock(r, "fleet") + listTables(r, c, "fleet");
      else if (active === "corp") body = "<h3>Корпорации и зарплаты</h3>" + ecoBlock(r, c, "corp");
      else if (active === "effects") body = "<h3>Особые эффекты</h3>" + fxTable(c, "gm") + "<h3>Санкции и блокады</h3>" + measureEffects(r, c);
      else body = "<h3>Страшные цифры</h3>" + NOTE("Подробные исходные значения и промежуточные расчёты. Основные итоги остаются в тематических вкладках.") + ecoBlock(r, c, "scary") + "<h3>Вооружённые силы: детальные числа</h3>" + forcesBlock(r, "details") + listTables(r, c, "details");
      out.innerHTML = '<h2>Результат: ' + esc(c.name) + '</h2>' + countryTabsHtml(active, body);
      enhanceTips(out);
    }
    const rulesWrap = h("div", "mt-wrap"); box.append(h("h2", null, "Правила калькулятора"), rulesWrap);
    rulesWrap.innerHTML = '<table class="mt"><thead><tr><th>Правило</th><th>Значение</th><th>Источник</th></tr></thead><tbody>' + RULES.map(r => "<tr><td>" + r[1] + "</td><td>" + D.K[r[0]] + "</td><td>" + (r[2] === "док." ? "документы" : r[2] === "решение" ? "решение автора" : '<span class="prop">предложено</span>') + "</td></tr>").join("") + "</tbody></table>";
    build();
  }

  // ---------- ТЕХНИЧЕСКОЕ (ГМ): повестки стран и пояснения к ним (только администратору) ----------
  const TECH = [["agendas", "Повестки стран"], ["method", "Как выведено"]];
  async function agendaTable(host) {
    let A = null; try { A = await fetch("data/agendas.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)); } catch (e) { A = null; }
    if (!A) { host.innerHTML = '<p class="mech-note">Не удалось загрузить таблицу.</p>'; return; }
    const cols = [["vector", "Вектор"], ["regime", "Режим"], ["terr", "Территория"], ["gov", "Форма правления"], ["econ", "Экономика"], ["prop", "Собственность"], ["vote", "Выборы"], ["army", "Армия"], ["info", "Информация"]];
    const rows = Object.entries(A).sort((a, b) => a[1].title.localeCompare(b[1].title, "ru"));
    const q = h("input"); q.type = "search"; q.placeholder = "Найти страну или значение…"; q.className = "agenda-q";
    const body = h("tbody"), tbl = h("table", "mt agenda"), note = h("p", "mech-note");
    tbl.append(h("thead", null, "<tr><th>Страна</th>" + cols.map(c => "<th>" + c[1] + "</th>").join("") + "</tr>"), body);
    function draw() {
      const f = q.value.trim().toLowerCase().replace(/ё/g, "е");
      body.replaceChildren();
      let n = 0;
      for (const [id, a] of rows) {
        const text = (a.title + " " + cols.map(c => a[c[0]] || "").join(" ")).toLowerCase().replace(/ё/g, "е");
        if (f && !text.includes(f)) continue;
        n++;
        const tr = h("tr"), td = h("td"), link = h("a", null, esc(a.title)); link.href = "#wiki/lore/states/" + id; td.append(link); tr.append(td);
        for (const c of cols) {
          const prop = a.m && a.m.includes(c[0]);
          tr.append(h("td", a[c[0]] ? null : "dim", (a[c[0]] ? esc(a[c[0]]) : "—") + (prop ? ' <span class="prop" title="Предложено по статье страны: в паспорте формы правления нет">предложено</span>' : "")));
        }
        body.append(tr);
      }
      note.textContent = "Показано стран: " + n + " из " + rows.length + ". Значения выведены автоматически, их нужно проверять по статье страны.";
    }
    q.addEventListener("input", draw); draw();
    const wrap = h("div", "mt-wrap"); wrap.append(tbl);
    host.replaceChildren(q, note, wrap);
  }
  function renderTech(box, sec) {
    box.replaceChildren(h("h1", "mv-title", "ТЕХНИЧЕСКОЕ (ГМ)"), h("p", "mv-sub", "Служебные таблицы и пояснения. Игроки и посетители этот подраздел не видят."));
    const mk = (id, title, html) => { const e = h("section", "mv-sec"); e.id = "tech-" + id; e.append(h("h2", null, title), h("div", "mv-body rich", html)); box.append(e); return e; };
    const host = mk("agendas", "Повестки стран", '<p>Повестки 124 государств и территорий, выведенные из лора. Ссылка в первой колонке открывает статью страны.</p><div id="agendaHost"><p class="mech-note">Загрузка…</p></div>');
    agendaTable(host.querySelector("#agendaHost"));
    mk("method", "Как выведено",
      "<p>Государственный режим и форма правления подобраны по разделу «Государственное устройство» каждой статьи: кто фактически принимает решения, есть ли выборы, парламент, монарх, военный совет. Спорные случаи, где в статье нет прямой опоры, отмечены в таблице автора <code>Лор/таблица_правления.html</code>; источник данных — <code>Лор/правление_стран.py</code>.</p>" +
      "<ul><li><b>Экономическая модель и торговая политика:</b> перенесены из прежнего экономического и торгового закона страны (плановая → плановая, смешанная → смешанная, дерегулированная и свободный рынок → рыночная; ориентация на экспорт → экспортная экономика, ограниченный экспорт → потребительская экономика).</li>" +
      "<li><b>Территориальное устройство:</b> «Федеративное» и «Конфедеративное» — если так названо государство или так сказано в тексте; всё остальное по умолчанию унитарное.</li>" +
      "<li><b>Собственность, избирательное право, армия, информационная политика:</b> по словам статьи («частный сектор», «выборы», «призыв», «контракт», «цензура», «свобода слова»).</li></ul>" +
      NOTE("Остальные категории повесток лор не описывает, их определяет ГМ. Все значения нужно проверять по статье страны."));
    const el = sec && box.querySelector("#tech-" + sec), w = $("wmain");
    setTimeout(() => { if (!w) return; if (el) w.scrollTop += el.getBoundingClientRect().top - w.getBoundingClientRect().top - 12; else w.scrollTop = 0; }, 60);
  }

  // ---------- вход игрока на Главной ----------
  function bindPlayerLogin() {
    const sel = $("plCountry"), pass = $("plPass"), btn = $("plLogin"), card = $("authPlayer");
    if (!sel || !btn) return;
    load().then(() => {
      sel.replaceChildren(...countryEntries().map(([k, name]) => { const o = document.createElement("option"); o.value = k; o.textContent = name; return o; }));
      const combo = countryCombo(sel);
      btn.disabled = false; btn.title = "";
      const note = card.querySelector(".mech-note:last-of-type"); if (note) note.textContent = "Тестовая версия: пароли выдаёт администратор.";
      const out = h("button"); out.type = "button"; out.className = "hidden"; out.textContent = "Выйти"; btn.after(out);
      const sync = () => {
        const id = playerId();
        out.classList.toggle("hidden", !id); btn.classList.toggle("hidden", !!id); sel.disabled = !!id; pass.disabled = !!id;
        if (id && D.countries[id]) sel.value = id;
        combo.sync();
        window.dispatchEvent(new Event("kg:auth"));
      };
      btn.onclick = async () => {
        const id = sel.value, p = D.players[id];
        if (!p || (await sha("kgtest:" + id + ":" + pass.value)) !== p.hash) { KG.toast("Неверный пароль"); return; }
        try { sessionStorage.setItem(PLAYER, id); } catch (e) { /* */ }
        pass.value = ""; KG.toast("Вход выполнен: " + D.countries[id].name); sync();
        KG.go("wiki/my");
      };
      out.onclick = () => { try { sessionStorage.removeItem(PLAYER); } catch (e) { /* */ } sync(); KG.go("home"); };
      sync();
    });
  }
  // отдельный раздел слева: #wiki/calc (ГМ) и #wiki/my (игрок)
  function cabinet() {
    const p = KG.route.parts;
    if (p[0] !== "wiki" || (p[1] !== "calc" && p[1] !== "my")) return;
    const gate = p[1] === "calc" ? "gm" : "player";
    if (!allowed(gate)) { KG.go("wiki/lore", true); return; }
    const box = $("calcView"); if (!box) return;
    if (p[1] === "calc" && p[2] === "tech") renderTech(box, p[3]);
    else (p[1] === "calc" ? renderCalc : renderMy)(box);
  }
  window.addEventListener("routechange", cabinet);
  window.addEventListener("kg:auth", cabinet);
  window.addEventListener("gmchange", () => window.dispatchEvent(new Event("kg:auth")));
  bindPlayerLogin();
  window.KGCalc = { allowed, load, hydrate, TECH };
})();
