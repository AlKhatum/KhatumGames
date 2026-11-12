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
  if (top && R(top).height > 64) issues.push("верхняя панель выше нормы: " + Math.round(R(top).height) + " px");
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
      : [".view-switch:not(.moon-sub)", ".gm-bar", ".map-title", "#toolbar", "#brushBar", ".measure:not(.moon-measure)", "#mapFrame > .zoom", "#hint", "#satPanel"];
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
  return issues;
};
