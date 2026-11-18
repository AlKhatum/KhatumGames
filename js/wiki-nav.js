// Вики: дерево разделов слева (иконки, счётчики), «крошки» над содержимым, поиск, статья Механик по подразделам
// и анимация смены разделов. Сами разделы рисуют js/site.js (события, лор) и js/mech.js (механики).
// Адреса: #wiki/events, #wiki/lore/<раздел>[/<страница>], #wiki/mech/<вкладка>, #wiki/mech/article/<id заголовка h2>.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const KG = window.KG, S = window.KGSite;
  if (!KG || !S || !$("wtreeNav")) return;
  const icon = S.icon;

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }
  const oneLine = t => String(t || "").replace(/\s*\n\s*/g, " ");
  const strip = html => { const d = document.createElement("div"); d.innerHTML = S.sanitize(html || ""); return d.textContent.replace(/\s+/g, " ").trim(); };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loreBy = sp => S.data.lore.find(a => S.specialOf(a) === sp);

  // ---------- статья Механик по подразделам ----------
  // Статья — один блок, который ГМ правит целиком (data-edit="mech.article"), поэтому она не режется:
  // у чужих подразделов ставится атрибут hidden (при сохранении правки он вычищается). В режиме правки видна вся статья.
  const ART = $("mechArticle");
  const secId = (el, i) => el.id || "s" + (i + 1);
  function mechSecs() {
    const out = []; let cur = null, i = 0;
    for (const el of ART.children) {
      if (el.tagName === "H2") { cur = { id: secId(el, i++), title: el.textContent.trim(), h2: el, nodes: [] }; out.push(cur); }
      else if (cur && !el.matches("nav.mech-toc")) cur.nodes.push(el);
    }
    return out;
  }
  let mechSec = null; // открытый подраздел (null — вступление и оглавление)
  function applyMechSec() {
    const editing = S.editing;
    let cur = null, i = 0;
    for (const el of ART.children) {
      if (el.tagName === "H2") cur = secId(el, i++);
      const show = editing || (mechSec ? cur === mechSec : cur === null);
      if (el.hidden === show) el.hidden = !show;
    }
  }
  new MutationObserver(() => { if (!S.editing) applyMechSec(); }).observe(ART, { childList: true });
  // вкладку Механик может сменить и сам mech.js (например, «Калькулятор» открывается, когда восстановится вход ГМа):
  // оглавление и «Назад / Дальше» видны, только пока видна статья
  new MutationObserver(() => renderMechExtras()).observe(ART, { attributes: true, attributeFilter: ["class"] });
  const mechArticleOpen = () => KG.route.parts[0] === "wiki" && KG.route.parts[1] === "mech" && !ART.classList.contains("hidden");
  function renderMechExtras() {
    const grid = $("mechSecs"), pager = $("mechPager"), on = mechArticleOpen() && !S.editing;
    grid.classList.toggle("hidden", !on || !!mechSec); pager.classList.toggle("hidden", !on || !mechSec);
    grid.innerHTML = ""; pager.innerHTML = "";
    if (!on) return;
    const secs = mechSecs();
    if (!mechSec) { // оглавление карточками
      grid.append(h("h2", { class: "msec-h", text: "Разделы статьи" }), ...secs.map((s, k) => {
        const p = s.nodes.find(n => n.tagName === "P"), subs = s.nodes.filter(n => n.tagName === "H3").map(n => n.textContent.trim());
        let lead = p ? p.textContent.replace(/\s+/g, " ").replace(/^В мире 2200\.\s*/, "").trim() : "";
        if (lead.length > 150) lead = lead.slice(0, 150).replace(/\s+\S*$/, "") + "…";
        return h("button", { type: "button", class: "msec", onclick: () => KG.go("wiki/mech/article/" + s.id) },
          h("b", null, h("i", { text: String(k + 1).padStart(2, "0") }), s.title), lead ? h("span", { text: lead }) : null,
          subs.length ? h("small", { text: subs.join(" · ") }) : null);
      }));
      [...grid.children].slice(1).forEach((c, k) => c.style.setProperty("--i", Math.min(k, 14)));
      grid.classList.add("stagger");
      return;
    }
    const i = secs.findIndex(s => s.id === mechSec), prev = secs[i - 1], next = secs[i + 1];
    const pg = (x, cls, label) => x ? h("button", { type: "button", class: cls, onclick: () => KG.go("wiki/mech/article/" + x.id) }, h("small", { text: label }), x.title) : null;
    pager.append(pg(prev, "prev", "← Назад"), pg(next, "next", "Дальше →"));
  }
  // ссылки внутри статьи вида #m-… ведут на нужный подраздел (иначе адрес сменился бы на неизвестный и открылась Главная)
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest('#mechArticle a[href^="#"]');
    if (!a || S.editing) return;
    const id = a.getAttribute("href").slice(1), t = id && document.getElementById(id);
    if (!t || !ART.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    const s = mechSecs().find(x => x.h2 === t || x.nodes.some(n => n === t || n.contains(t)));
    if (s) { pending = { el: () => document.getElementById(id) }; KG.go("wiki/mech/article/" + s.id); }
  }, true);

  // ---------- дерево ----------
  let counts = {};
  S.loreCounts().then(c => { counts = c; renderTree(KG.route.parts.slice(1).join("/")); });
  function mechTabs() {
    return [...document.querySelectorAll("#mechNav button")].map(b => ({ id: b.dataset.mech, label: b.textContent.trim(), gm: b.classList.contains("gm-only") }));
  }
  function treeData() {
    const site = S.data, secs = mechSecs();
    return [
      { key: "events", label: S.tx("wiki.nav.events", "События"), icon: "events", count: site.events.length },
      { key: "lore", label: S.tx("wiki.nav.lore", "Лор"), icon: "lore", count: site.lore.length,
        kids: site.lore.map(a => ({ key: "lore/" + a.id, label: a.title || "Без названия", icon: S.LORE_ICON[S.specialOf(a)] || "article", count: counts[S.specialOf(a)] })) },
      { key: "mech", label: S.tx("wiki.nav.mech", "Механики"), icon: "mech",
        kids: mechTabs().map(t => t.id === "article"
          ? { key: "mech/article", label: t.label, icon: "article", count: secs.length, kids: secs.map(s => ({ key: "mech/article/" + s.id, label: s.title })) }
          : { key: "mech/" + t.id, label: t.label, icon: t.id, gm: t.gm }) }
    ];
  }
  let treeSig = "", treeBtns = [];
  function node(n, lvl) {
    const b = h("button", { type: "button", class: "tn" + (lvl ? " l" + Math.min(lvl + 1, 3) : "") + (n.gm ? " gm-only" : ""), "data-key": n.key, title: n.label, onclick: () => KG.go("wiki/" + n.key) },
      n.icon ? icon(n.icon) : null, h("span", { class: "lbl", text: n.label }),
      n.count != null ? h("span", { class: "cnt" + (n.count ? "" : " zero"), text: n.count, title: "Материалов: " + n.count }) : null);
    treeBtns.push(b);
    return b;
  }
  function branch(n, lvl) {
    if (!n.kids && lvl) return node(n, lvl);
    const g = h("div", { class: "tgroup" + (lvl ? " sub" : ""), "data-group": n.key });
    const row = h("div", { class: "trow" }, node(n, lvl));
    if (n.kids) {
      row.append(h("button", { type: "button", class: "tchev", "aria-label": "Развернуть «" + n.label + "»", onclick: () => g.classList.toggle("open") }, icon("chev")));
      g.append(row, h("div", { class: "tkids" }, h("div", null, n.kids.map(k => branch(k, lvl + 1)))));
    } else g.append(row);
    return g;
  }
  function renderTree(key) {
    const data = treeData(), sig = JSON.stringify(data);
    if (sig !== treeSig) { // перестраиваем, только если поменялись разделы, названия или счётчики — иначе не играла бы анимация раскрытия
      treeSig = sig; treeBtns = [];
      $("wtreeNav").replaceChildren(...data.map(n => branch(n, 0)));
    }
    markTree(key);
  }
  function markTree(key) {
    // раскрыта только ветка открытой страницы
    document.querySelectorAll("#wtreeNav .tgroup").forEach(g => { const k = g.dataset.group; g.classList.toggle("open", key === k || key.startsWith(k + "/")); });
    let best = "", act = null;
    for (const b of treeBtns) { const k = b.dataset.key; if ((key === k || key.startsWith(k + "/")) && k.length > best.length) best = k; }
    treeBtns.forEach(b => { const on = b.dataset.key === best; b.classList.toggle("active", on); if (on) act = b; });
    if (act) setTimeout(() => { // прокручиваем только само дерево
      const sc = $("wtreeNav"), r = act.getBoundingClientRect(), s = sc.getBoundingClientRect();
      if (r.top < s.top) sc.scrollTop += r.top - s.top - 8; else if (r.bottom > s.bottom) sc.scrollTop += r.bottom - s.bottom + 8;
    }, 320);
  }

  // ---------- крошки ----------
  let crumbsReq = 0;
  async function renderCrumbs(p) {
    const req = ++crumbsReq, list = [[S.tx("wiki.title", "Вики")]];
    if (p[1] === "events") list.push([S.tx("wiki.nav.events", "События")]);
    if (p[1] === "lore") {
      list.push([S.tx("wiki.nav.lore", "Лор"), "wiki/lore"]);
      const a = p[2] && S.data.lore.find(x => x.id === p[2]);
      if (a) {
        list.push([a.title || "Без названия", "wiki/lore/" + a.id]);
        if (p[3]) {
          const L = await KG.lore(), sp = S.specialOf(a);
          if (sp === "states") { const s = L.byId[p[3]], u = L.unions.find(x => x.id === p[3]); if (s || u) list.push([oneLine(s ? S.names.state(s) : S.names.union(u))]); }
          if (sp === "regions") { const r = S.regionsOf(L).find(x => x.id === p[3]); if (r) list.push([S.names.region(r)]); }
        }
      }
    }
    if (p[1] === "mech") {
      list.push([S.tx("wiki.nav.mech", "Механики"), "wiki/mech/article"]);
      const t = mechTabs().find(x => x.id === (p[2] || "article"));
      if (t) list.push([t.label, "wiki/mech/" + t.id]);
      const s = p[2] === "article" && p[3] && mechSecs().find(x => x.id === p[3]);
      if (s) list.push([s.title]);
    }
    if (req !== crumbsReq) return; // пока ждали лор, адрес сменился
    const box = $("wikiCrumbs");
    box.replaceChildren(h("button", { type: "button", class: "wtree-btn", onclick: () => KG.openDrawer($("wtree")) }, icon("tree"), "Разделы"));
    list.forEach(([label, path], i) => {
      if (i) box.append(h("span", { class: "sep", text: "/" }));
      box.append(i === list.length - 1 || !path ? h("span", { class: i === list.length - 1 ? "cur" : null, text: label }) : h("a", { href: "#" + path, text: label }));
    });
  }
  $("wikiLayout").addEventListener("click", e => { if (e.target === e.currentTarget) KG.closeDrawers(); }); // затемнение вокруг дерева на телефоне

  // ---------- смена адреса ----------
  let lastPath = "", lastTab = "";
  window.addEventListener("routechange", e => {
    const p = e.detail.parts, tab = p[0], path = p.join("/");
    if (tab !== "wiki") { lastTab = tab; return; }
    mechSec = p[1] === "mech" && p[2] === "article" && p[3] ? p[3] : null;
    if (mechSec && !mechSecs().some(s => s.id === mechSec)) { KG.go("wiki/mech/article", true); return; }
    applyMechSec(); renderMechExtras();
    renderTree(p.slice(1).join("/"));
    renderCrumbs(p);
    if (path !== lastPath) {
      if (lastTab === "wiki") KG.replay($("wikiBox")); // внутри Вики — анимация содержимого; при входе во вкладку анимируется вся страница
      $("wmain").scrollTop = 0;
      if (pending) { const hit = pending; pending = null; flash(hit); }
      else if (mechSec && S.editing) scrollToMechSec(); // в правке статья целиком — к заголовку подраздела
    }
    lastPath = path; lastTab = tab;
  });
  // режим правки: статья Механик целиком; после правки — пересобрать дерево (заголовки могли поменяться)
  window.addEventListener("siteedit", () => {
    applyMechSec(); renderMechExtras();
    if (KG.route.tab !== "wiki") return;
    renderTree(KG.route.parts.slice(1).join("/")); renderCrumbs(KG.route.parts);
    if (mechSec) { if (S.editing) scrollToMechSec(); else $("wmain").scrollTop = 0; }
  });
  function scrollToMechSec() {
    const s = mechSecs().find(x => x.id === mechSec); if (!s) return;
    const W = $("wmain");
    W.scrollTop += s.h2.getBoundingClientRect().top - W.getBoundingClientRect().top - 16;
  }

  // ---------- поиск ----------
  const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е");
  async function buildIndex() {
    const out = [], add = e => { e.text = e.text || ""; e.q = norm(e.title + " " + e.text); e.qt = norm(e.title); out.push(e); };
    const site = S.data, tx = S.tx;
    const [L, I] = await Promise.all([KG.lore(), ideologies()]);
    for (const ev of site.events) add({ tag: "Событие", title: ev.title || "Событие", path: "События" + (ev.date ? " · " + ev.date : ""), text: strip(ev.html), route: "wiki/events", el: () => $("ev-" + ev.id) });
    for (const a of site.lore) add({ tag: "Лор", title: a.title || "", path: "Лор", text: (a.sub || "") + " " + strip(a.html), route: "wiki/lore/" + a.id });
    const ideo = loreBy("ideologies");
    if (ideo && I) for (const x of I.list || []) {
      const f = k => tx("lore.ideo." + x.id + "." + k, x[k] || "");
      add({ tag: "Идеология", title: f("name") || x.name, path: "Лор › " + ideo.title, text: [f("desc"), f("blame"), f("real")].join(" "), route: "wiki/lore/" + ideo.id, el: () => $("ideo-" + x.id) });
    }
    const chron = loreBy("chronology");
    if (chron) { const d = document.createElement("div"); d.innerHTML = S.sanitize(tx("lore.chron.html", L.chronology || ""));
      [...d.querySelectorAll("p, li, h2, h3")].forEach(n => { const t = n.textContent.replace(/\s+/g, " ").trim(); if (t.length > 20) add({ tag: "Хронология", title: chron.title, path: "Лор › " + chron.title, text: t, route: "wiki/lore/" + chron.id }); }); }
    const st = loreBy("states");
    if (st) {
      for (const s of L.states) add({ tag: "Страна", title: oneLine(S.names.state(s)), path: "Лор › " + st.title, route: "wiki/lore/" + st.id + "/" + s.id,
        text: Object.entries(s.passport || {}).map(([k, v]) => k + ": " + v).join(" · ") + " " + strip(tx("lore.state." + s.id + ".html", s.html)) });
      for (const u of L.unions) add({ tag: "Союз", title: oneLine(S.names.union(u)), path: "Лор › " + st.title + " › Союзы", route: "wiki/lore/" + st.id + "/" + u.id,
        text: tx("lore.union." + u.id + ".members", u.members || "") + " " + strip(tx("lore.union." + u.id + ".html", u.html)) });
    }
    const rg = loreBy("regions");
    if (rg) for (const r of S.regionsOf(L)) add({ tag: "Регион", title: S.names.region(r), path: "Лор › " + rg.title, route: "wiki/lore/" + rg.id + "/" + r.id, text: S.statesOf(L, r.id).map(s => oneLine(S.names.state(s))).join(", ") });
    // статья механик: подраздел (h2) и каждый его заголовок h3
    for (const s of mechSecs()) {
      let cur = { tag: "Механики", title: s.title, path: "Механики › Статья", text: "", route: "wiki/mech/article/" + s.id };
      const parts = [cur];
      for (const n of s.nodes) {
        if (n.tagName === "H3") { const hd = n; cur = { tag: "Механики", title: n.textContent.trim(), path: "Механики › " + s.title, text: "", route: "wiki/mech/article/" + s.id, el: () => hd.isConnected ? hd : null }; parts.push(cur); }
        else cur.text += " " + n.textContent.replace(/\s+/g, " ").trim();
      }
      parts.forEach(add);
    }
    return out;
  }
  let ideoP = null;
  const ideologies = () => ideoP || (ideoP = fetch("data/ideologies.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // подсветка найденного (е и ё — одна буква)
  function mark(s, terms) {
    const re = new RegExp("(" + terms.map(t => reEsc(esc(t)).replace(/е/g, "[её]")).join("|") + ")", "gi");
    return esc(s).replace(re, "<mark>$1</mark>");
  }
  function snippet(text, terms) {
    const nt = norm(text); let at = -1;
    for (const t of terms) { const i = nt.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return text.length > 160 ? text.slice(0, 160) + "…" : text;
    const s = Math.max(0, at - 60), e = Math.min(text.length, at + 120);
    return (s ? "…" : "") + text.slice(s, e).trim() + (e < text.length ? "…" : "");
  }
  const Q = $("wikiQ"), RES = $("wikiQRes"), MAX = 30;
  let index = null, results = [], active = 0, terms = [], timer = 0, pending = null;
  async function search() {
    const q = norm(Q.value).trim();
    terms = q.split(/\s+/).filter(t => t.length >= 2);
    if (!terms.length) { RES.classList.add("hidden"); return; }
    if (!index) index = await buildIndex();
    results = index.filter(e => terms.every(t => e.q.includes(t)))
      .map(e => ({ e, score: terms.reduce((s, t) => s + (e.qt.startsWith(t) ? 12 : e.qt.includes(t) ? 8 : 0), 0) }))
      .sort((a, b) => b.score - a.score).map(x => x.e);
    active = 0; drawResults();
  }
  function drawResults() {
    RES.replaceChildren(); RES.classList.remove("hidden");
    if (!results.length) { RES.append(h("div", { class: "sr-empty", text: "Ничего не нашлось. Попробуйте другое слово или начало слова." })); return; }
    results.slice(0, MAX).forEach((e, i) => {
      const t = h("span", { class: "sr-title" }); t.innerHTML = mark(e.title, terms);
      const b = h("button", { type: "button", class: "sr" + (i === active ? " active" : ""), role: "option", onmousedown: ev => ev.preventDefault(), onclick: () => openResult(e) },
        h("div", { class: "sr-head" }, t, h("span", { class: "sr-tag", text: e.tag })), h("div", { class: "sr-path", text: e.path }));
      if (e.text.trim()) { const sn = h("div", { class: "sr-snip" }); sn.innerHTML = mark(snippet(e.text.trim(), terms), terms); b.append(sn); }
      RES.append(b);
    });
    if (results.length > MAX) RES.append(h("div", { class: "sr-more", text: "Показаны первые " + MAX + " из " + results.length + ". Уточните запрос." }));
  }
  function openResult(e) {
    RES.classList.add("hidden"); Q.blur(); KG.closeDrawers();
    const hit = { el: e.el, terms: terms.slice() };
    if (KG.route.parts.join("/") === e.route) flash(hit); else { pending = hit; KG.go(e.route); }
  }
  // найти на открытой странице место совпадения (страница может дорисовываться — ждём до 2 с), прокрутить и подсветить
  function flash(hit, tries) {
    tries = tries || 0;
    let el = hit.el ? hit.el() : null;
    if (!el) {
      const t = [...hit.terms].sort((a, b) => b.length - a.length)[0] || "";
      el = [...$("wikiBox").querySelectorAll("p, li, h2, h3, .ls-passport span, .ls-state, .ls-union, .ideo-card, .event, .ccard")]
        .find(x => !x.closest("[hidden], .hidden") && x.offsetParent && norm(x.textContent).includes(t));
    }
    if (!el || !el.offsetParent) { if (tries < 20) setTimeout(() => flash(hit, tries + 1), 100); return; }
    const W = $("wmain"), r = el.getBoundingClientRect(), w = W.getBoundingClientRect();
    W.scrollTo({ top: W.scrollTop + r.top - w.top - W.clientHeight / 2 + Math.min(r.height, W.clientHeight / 2) / 2, behavior: reduced() ? "auto" : "smooth" });
    el.classList.remove("search-hit"); void el.offsetWidth; el.classList.add("search-hit");
    setTimeout(() => el.classList.remove("search-hit"), 2300);
  }
  Q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  Q.addEventListener("focus", () => { index = null; if (Q.value.trim()) search(); }); // при каждом открытии — свежие данные (ГМ мог править)
  Q.addEventListener("blur", () => setTimeout(() => RES.classList.add("hidden"), 150));
  Q.addEventListener("keydown", e => {
    const n = Math.min(results.length, MAX);
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
      e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n; drawResults();
      const a = RES.querySelector(".sr.active"); if (a) RES.scrollTop = a.offsetTop - RES.clientHeight / 2;
    } else if (e.key === "Enter" && results[active] && !RES.classList.contains("hidden")) { e.preventDefault(); openResult(results[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); Q.value = ""; RES.classList.add("hidden"); Q.blur(); }
  });
  // «/» — к поиску с любой страницы
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    e.preventDefault();
    if (KG.route.tab !== "wiki") KG.go("wiki");
    if (matchMedia("(max-width: 900px)").matches) KG.openDrawer($("wtree"));
    setTimeout(() => Q.focus(), 30);
  });
})();
