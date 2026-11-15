// Бесшовная плоская карта: слева и справа от основного мира стоят копии слоёв со сдвигом на ширину
// карты. Векторные слои повторяются через <use> (браузер сам держит копию в актуальном виде),
// картинки и фон — клонами, у которых атрибуты синхронизируются с оригиналом.
// Вид всегда держит центр экрана над основной копией, поэтому все правки и клики идут в неё.
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  // world — контейнер слоёв (его двигает transform), W×H — размер карты в её пикселях
  function create(world, W, H) {
    world.style.setProperty("--ww", W + "px");
    const sides = ["l", "r"];
    const copies = [];
    function syncAttrs(src, dst, side) {
      for (const a of [...dst.attributes]) if (!src.hasAttribute(a.name)) dst.removeAttribute(a.name);
      for (const a of src.attributes) if (a.name !== "id" && dst.getAttribute(a.name) !== a.value) dst.setAttribute(a.name, a.value);
      dst.classList.add("wc", "wc-" + side);
    }
    // el — слой из world; копии ставятся сразу за ним, чтобы порядок слоёв сохранялся и на стыке
    function add(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === "canvas") return; // холст кисти: рисуют всегда в основной копии
      let last = el;
      for (const side of sides) {
        let c;
        if (tag === "svg") {
          if (!el.id) continue;
          c = document.createElementNS(NS, "svg");
          c.setAttribute("viewBox", `0 0 ${W} ${H}`); c.setAttribute("width", W); c.setAttribute("height", H);
          c.setAttribute("overflow", "visible"); c.setAttribute("aria-hidden", "true");
          c.setAttribute("class", "layer wc wc-" + side); c.dataset.of = el.id;
          const u = document.createElementNS(NS, "use"); u.setAttribute("href", "#" + el.id); c.append(u);
        } else {
          c = el.cloneNode(false); syncAttrs(el, c, side);
          new MutationObserver(() => syncAttrs(el, c, side)).observe(el, { attributes: true });
        }
        last.after(c); last = c; copies.push(c);
      }
    }
    // tx — сдвиг основной копии на экране, mw — её ширина на экране, vw — ширина окна
    function show(tx, mw, vw) {
      const l = tx > 0.5, r = tx + mw < vw - 0.5;
      if (world.classList.contains("show-l") !== l) world.classList.toggle("show-l", l);
      if (world.classList.contains("show-r") !== r) world.classList.toggle("show-r", r);
    }
    // сдвиг, при котором центр окна стоит над основной копией (картинка от этого не меняется)
    function norm(tx, mw, vw) {
      const c = vw / 2 - tx;
      return vw / 2 - (((c % mw) + mw) % mw);
    }
    return { add, show, norm, copies };
  }
  const wrapX = (x, W) => ((x % W) + W) % W;
  const norm = (tx, mw, vw) => vw / 2 - ((((vw / 2 - tx) % mw) + mw) % mw);
  window.KGWrap = { create, wrapX, norm };
})();
