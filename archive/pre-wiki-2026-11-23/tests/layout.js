// Проверка вёрстки: подключите на странице сайта (или вставьте в консоль) и вызовите KGLayoutCheck().
// Ищет горизонтальную прокрутку, элементы, вылезающие за рамку карты/экрана, и наложения панелей.
window.KGLayoutCheck = function () {
  const issues = [];
  const vis = el => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 && el.offsetParent !== null; };
  const R = el => el.getBoundingClientRect();
  const inside = (a, b, tol) => a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const de = document.documentElement;
  if (de.scrollWidth > innerWidth + 1) issues.push("горизонтальная прокрутка страницы: " + de.scrollWidth + " > " + innerWidth);
  const top = document.querySelector(".topbar");
  if (top && R(top).height > (innerWidth <= 700 ? 100 : 64)) issues.push("верхняя панель выше нормы: " + Math.round(R(top).height) + " px");
  const page = document.querySelector(".page.active");
  if (!page) return issues;
  if (page.id === "page-map") {
    const moon = document.getElementById("moonWrap"), inMoon = moon && vis(moon);
    const frame = document.getElementById("mapFrame"), fr = R(frame);
    if (fr.width < 200 || fr.height < 200) issues.push("рамка карты слишком мала: " + Math.round(fr.width) + "×" + Math.round(fr.height));
    // легенда Земли или Луны — на одном и том же месте, рядом с рамкой карты
    const legend = document.getElementById(inMoon ? "moonPanel" : "legend");
    if (vis(legend)) {
      const lr = R(legend);
      if (lr.right > innerWidth + 1 || lr.bottom > innerHeight + 1) issues.push("легенда выходит за экран");
      if (overlap(lr, fr) > 4) issues.push("легенда наезжает на карту");
    }
    const scope = inMoon ? moon : frame;
    const sel = inMoon
      ? ["#moonSubSwitch", "#moonToolbar", "#mBrushBar", ".moon-measure", "#moonWrap .zoom", "#moonHint", "#mSatPanel", ".view-switch:not(.moon-sub)", ".gm-bar"]
      : [".view-switch:not(.moon-sub)", ".gm-bar", ".map-title", "#toolbar", "#brushBar", ".measure:not(.moon-measure)", "#mapFrame > .zoom", "#hint", "#satPanel", "#stateCard"];
    const els = sel.map(s => [s, document.querySelector(s)]).filter(([, e]) => vis(e));
    for (const [s, e] of els) if (!inside(R(e), fr, 1)) issues.push(s + " выходит за рамку карты");
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j], o = overlap(R(a[1]), R(b[1]));
      if (o > 16) issues.push(a[0] + " наезжает на " + b[0] + " (" + Math.round(o) + " px²)");
    }
  } else {
    const panel = page.querySelector(".stub");
    if (panel && (R(panel).left < -1 || R(panel).right > innerWidth + 1)) issues.push("панель страницы шире экрана");
  }
  issues.push(...KGLayoutCheck.text(page), ...KGLayoutCheck.sliders(page));
  return issues;
};
// Слипание текста: строки разных элементов налезают друг на друга. Проверяется верхняя панель и активная страница.
KGLayoutCheck.text = function (page) {
  const issues = [], boxes = [];
  const roots = [document.querySelector(".topbar"), page].filter(Boolean);
  const clipOf = el => { // видимая область с учётом прокручиваемых родителей
    let r = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflow + cs.overflowX + cs.overflowY)) { const q = p.getBoundingClientRect(); r = { left: Math.max(r.left, q.left), top: Math.max(r.top, q.top), right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom) }; }
    }
    return r;
  };
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    for (let n = walker.nextNode(); n && boxes.length < 2500; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest("svg, .hidden, [hidden], option, script, style, .world, .globe-wrap, .moon-wrap, .g-labels")) continue;
      const det = el.closest("details"); if (det && !det.open && !el.closest("summary")) continue; // свёрнутое содержимое не видно
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || +cs.opacity === 0 || el.offsetParent === null && cs.position !== "fixed") continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const clip = clipOf(el);
      for (const r of rg.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        if (r.right <= clip.left || r.left >= clip.right || r.bottom <= clip.top || r.top >= clip.bottom) continue;
        boxes.push({ el, r, t: n.nodeValue.trim().slice(0, 24) });
      }
    }
  }
  const seen = new Set();
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 3 && h > Math.min(a.r.height, b.r.height) * 0.4) {
      const key = a.t + "|" + b.t;
      if (!seen.has(key)) { seen.add(key); issues.push("текст налезает: «" + a.t + "» и «" + b.t + "»"); }
    }
  }
  return issues.slice(0, 20);
};
// Ползунки: не выходят за свой блок и экран, не налезают на соседей.
KGLayoutCheck.sliders = function (page) {
  const issues = [];
  const list = [...document.querySelectorAll('.topbar input[type=range]'), ...page.querySelectorAll('input[type=range]')];
  for (const s of list) {
    const cs = getComputedStyle(s); if (cs.display === "none" || s.offsetParent === null) continue;
    const r = s.getBoundingClientRect(), p = s.parentElement.getBoundingClientRect(), name = s.id || s.title || "ползунок";
    if (r.width < 30) issues.push("ползунок «" + name + "» слишком узкий: " + Math.round(r.width) + " px");
    if (r.left < -1 || r.right > innerWidth + 1) issues.push("ползунок «" + name + "» выходит за экран");
    if (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 4 || r.bottom > p.bottom + 4) issues.push("ползунок «" + name + "» выходит за свой блок");
    for (const sib of s.parentElement.children) {
      if (sib === s || sib.offsetParent === null) continue;
      const q = sib.getBoundingClientRect();
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w > 2 && h > 2) issues.push("ползунок «" + name + "» налезает на соседний элемент");
    }
  }
  return issues;
};
