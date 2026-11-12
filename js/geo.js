// География карты. Карта — проекция Меркатора на весь мир (360°), откалиброванная по 19 реальным городам
// из «Текст.psd» (средняя ошибка ≈ 3.6 px ≈ 30 км). Расстояния считаются по сфере радиусом Земли.
(function () {
  "use strict";
  const W = 4087, H = 3554;
  const R = W / (2 * Math.PI);   // пикселей карты на радиан
  const X0 = 2042.92, Y0 = 2063.21; // пиксель долготы 0° и экватора
  const EARTH = 6371.0088;          // средний радиус Земли, км
  const D = Math.PI / 180;

  const G = {
    W, H, R, X0, Y0, EARTH,
    LAT_MAX: Math.atan(Math.sinh(Y0 / R)) / D,          // ≈ 85.2° с. ш. (верх карты)
    LAT_MIN: Math.atan(Math.sinh((Y0 - H) / R)) / D,    // ≈ −78.5° ю. ш. (низ карты)
    toLL(x, y) { return [Math.atan(Math.sinh((Y0 - y) / R)) / D, (x - X0) / R / D]; },
    toXY(lat, lon) {
      lon = ((lon + 180) % 360 + 360) % 360 - 180;
      const la = Math.max(-89.5, Math.min(89.5, lat)) * D;
      return [X0 + R * lon * D, Y0 - R * Math.log(Math.tan(Math.PI / 4 + la / 2))];
    },
    // расстояние по дуге большого круга, км
    dist(a, b) {
      const p1 = a[0] * D, p2 = b[0] * D, dp = p2 - p1, dl = (b[1] - a[1]) * D;
      const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
    },
    // точка на расстоянии km по азимуту brg (градусы)
    dest(p, brg, km) {
      const d = km / EARTH, b = brg * D, p1 = p[0] * D, l1 = p[1] * D;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      return [p2 / D, l2 / D];
    },
    // промежуточные точки дуги большого круга (для отрисовки «прямой» на сфере)
    arc(a, b, n) {
      const toV = p => [Math.cos(p[0] * D) * Math.cos(p[1] * D), Math.cos(p[0] * D) * Math.sin(p[1] * D), Math.sin(p[0] * D)];
      const va = toV(a), vb = toV(b);
      const om = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
      const out = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        let v;
        if (om < 1e-9) v = va;
        else {
          const s1 = Math.sin((1 - t) * om) / Math.sin(om), s2 = Math.sin(t * om) / Math.sin(om);
          v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
        }
        out.push([Math.atan2(v[2], Math.hypot(v[0], v[1])) / D, Math.atan2(v[1], v[0]) / D]);
      }
      return out;
    },
    // список точек (lat, lon) -> SVG path в пикселях карты с разрывом на линии перемены дат
    pathLL(pts, closed) {
      let d = "", prev = null;
      for (const p of pts) {
        const [x, y] = G.toXY(p[0], p[1]);
        if (!prev || Math.abs(x - prev[0]) > W / 2) d += "M" + x.toFixed(1) + " " + y.toFixed(1);
        else d += "L" + x.toFixed(1) + " " + y.toFixed(1);
        prev = [x, y];
      }
      return d + (closed ? "Z" : "");
    },
    fmt(km) {
      if (km < 1) return Math.round(km * 1000) + " м";
      if (km < 100) return km.toFixed(1).replace(".", ",") + " км";
      return Math.round(km).toLocaleString("ru-RU") + " км";
    }
  };
  window.KGGeo = G;
})();
