// Отрисовка раздела «Механики» (данные — js/mechanics.js). Адрес: #wiki/mech/<страница>[/<раздел>].
(function () {
  "use strict";
  const KG = window.KG, M = window.KGMechanics, box = document.getElementById("mechView");
  if (!KG || !M || !box) return;
  const pageOf = id => M.pages.find(p => p.id === id);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  let shown = "";
  const allowed = pg => !pg.gate || !window.KGCalc || window.KGCalc.allowed(pg.gate);
  function render(pg) {
    box.replaceChildren();
    if (pg.custom) { shown = pg.id; pg.custom(box, pg); return; } // страницы с собственной отрисовкой (калькулятор, «Моя страна»)
    const K = (...a) => "mech." + pg.id + "." + a.join(".");
    const ed = (e, key, rich, label) => { e.setAttribute(rich ? "data-edit" : "data-edit-text", key); e.setAttribute("data-label", label); return e; };
    box.append(ed(h("h1", "mv-title", pg.title), K("title"), false, "Механики: заголовок"), ed(h("p", "mv-sub", pg.sub), K("sub"), false, "Механики: подзаголовок"));
    let ord = []; try { ord = (JSON.parse(window.KGSite.tx("wiki.order", "{}")) || {})["mech/" + pg.id] || []; } catch (e) { /* */ }
    const secsOrdered = pg.sections.map((s, i) => ({ s, i, o: ord.indexOf("mech/" + pg.id + "/" + s.id) })).sort((a, b) => (a.o < 0 ? 1e6 : a.o) - (b.o < 0 ? 1e6 : b.o) || a.i - b.i).map(x => x.s);
    for (const s of secsOrdered) {
      if (s.gm && !document.body.classList.contains("is-gm")) continue;
      const sec = h("section", "mv-sec"); sec.id = "mv-" + pg.id + "-" + s.id;
      const body = ed(h("div", "mv-body rich", s.html), K(s.id, "html"), true, "Механики: " + s.title);
      sec.append(ed(h("h2", null, s.title), K(s.id, "title"), false, "Механики: заголовок раздела"), body);
      box.append(sec);
    }
    const i = M.pages.indexOf(pg), prev = M.pages[i - 1], next = M.pages[i + 1];
    const nav = h("nav", "mpager");
    for (const [x, cls, lab] of [[prev, "prev", "← Назад"], [next, "next", "Дальше →"]]) {
      if (!x) continue;
      const b = h("button", cls, "<small>" + lab + "</small>" + x.title); b.type = "button"; b.onclick = () => KG.go("wiki/mech/" + x.id); nav.append(b);
    }
    box.append(nav);
    if (window.KGSite && window.KGSite.applyTexts) window.KGSite.applyTexts(box);
    shown = pg.id;
    if (pg.hydrate) window.dispatchEvent(new CustomEvent("kg:calc-hydrate", { detail: box }));
  }
  window.addEventListener("routechange", e => {
    const p = e.detail.parts;
    if (p[0] !== "wiki" || p[1] !== "mech") return;
    const pg = pageOf(p[2]);
    if (!pg || !allowed(pg)) { KG.go("wiki/mech/intro", true); return; }
    if (shown !== pg.id) render(pg);
    const secId = p[3] && pg.sections.some(s => s.id === p[3]) ? p[3] : "";
    setTimeout(() => {
      const w = document.getElementById("wmain"), el = secId && document.getElementById("mv-" + pg.id + "-" + secId);
      if (!w) return;
      if (el) w.scrollTop += el.getBoundingClientRect().top - w.getBoundingClientRect().top - 12; else w.scrollTop = 0;
    }, 60);
  });
  // подсветка пункта дерева по мере прокрутки текста (scroll-spy)
  let ticking = false, lastKey = "";
  function spy() {
    ticking = false;
    const p = KG.route.parts;
    if (p[0] !== "wiki" || p[1] !== "mech" || !shown) return;
    const w = document.getElementById("wmain"); if (!w) return;
    const top = w.getBoundingClientRect().top + 60;
    let cur = null;
    for (const sec of box.querySelectorAll(".mv-sec")) { if (sec.getBoundingClientRect().top <= top) cur = sec; else break; }
    const key = cur ? "mech/" + shown + "/" + cur.id.slice(("mv-" + shown + "-").length) : "mech/" + shown;
    if (key === lastKey) return;
    lastKey = key;
    let act = null;
    document.querySelectorAll("#wtreeNav .tn").forEach(b => { const on = b.dataset.key === key; b.classList.toggle("active", on); if (on) act = b; });
    if (act) {
      const grp = act.closest(".tgroup"); if (grp) grp.classList.add("open");
      const sc = document.getElementById("wtreeNav"), r = act.getBoundingClientRect(), t = sc.getBoundingClientRect();
      if (r.top < t.top) sc.scrollTop += r.top - t.top - 8; else if (r.bottom > t.bottom) sc.scrollTop += r.bottom - t.bottom + 8;
    }
  }
  const wm = document.getElementById("wmain");
  if (wm) wm.addEventListener("scroll", () => { if (!ticking) { ticking = true; setTimeout(spy, 60); } }, { passive: true });
  window.addEventListener("routechange", () => { lastKey = ""; setTimeout(spy, 150); });
  setInterval(spy, 300); // страховка: в фоновой вкладке события прокрутки могут не приходить
  // вход или выход (игрок, администратор): закрытая страница пропадает, содержимое открытой пересобирается
  window.addEventListener("kg:order", () => { const p = KG.route.parts; if (p[0] === "wiki" && p[1] === "mech") { const pg = pageOf(p[2]); if (pg && !pg.custom) { shown = ""; render(pg); } } });
  window.addEventListener("kg:auth", () => {
    const p = KG.route.parts;
    if (p[0] !== "wiki" || p[1] !== "mech") return;
    const pg = pageOf(p[2]);
    if (pg && pg.gate) { if (!allowed(pg)) KG.go("wiki/mech/intro", true); else { shown = ""; render(pg); } }
  });
})();
