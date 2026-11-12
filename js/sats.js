// Орбитальные спутники мира после Потопа: каталог и простая модель движения.
// Круговые орбиты — равномерное движение, эллиптические — уравнение Кеплера.
// Земля вращается с сидерической скоростью; положения считаются в земной (вращающейся) системе.
(function () {
  "use strict";
  const MU = 398600.4418;      // гравитационный параметр Земли, км³/с²
  const RE = 6371.0088;        // радиус Земли, км
  const D = Math.PI / 180;
  const EPOCH = Date.UTC(2026, 0, 1); // начало отсчёта фаз

  // type: station — станция (аналог МКС), sat — спутник, nav — навигация, comm — связь
  const CATALOG = [
    { id: "kovcheg", name: "Ковчег", type: "station", note: "Международная станция — аналог МКС", h: 418, i: 51.64, raan: 40, u0: 0, color: "#7dff6a" },
    { id: "kovcheg2", name: "Ковчег-Восток", type: "station", note: "Вторая орбитальная станция", h: 385, i: 41.47, raan: 150, u0: 120, color: "#b6ff5a" },
    { id: "novmir", name: "Новый Мир", type: "station", note: "Старая станция, частично законсервирована", h: 355, i: 51.6, raan: 262, u0: 210, color: "#e8ff8a" },
    { id: "meteor", name: "Метеор-П", type: "sat", note: "Метеоспутник, солнечно-синхронная орбита", h: 830, i: 98.7, raan: 300, u0: 60, color: "#19e6ff" },
    { id: "oko", name: "Око-3", type: "sat", note: "Наблюдение за уровнем океана", h: 705, i: 98.2, raan: 70, u0: 300, color: "#5fd2ff" },
    { id: "zerkalo", name: "Зеркало", type: "sat", note: "Орбитальный телескоп", h: 540, i: 28.5, raan: 200, u0: 90, color: "#c58bff" },
    { id: "molniya", name: "Молния-Ковчег", type: "comm", note: "Связь для северных широт, вытянутая орбита", hp: 600, ha: 39700, i: 63.4, raan: 100, argp: 270, m0: 30, color: "#ffa646" },
    { id: "nav1", name: "Звезда-Нав 1", type: "nav", note: "Навигационная система", h: 19100, i: 64.8, raan: 0, u0: 0, color: "#ffe14d" },
    { id: "nav2", name: "Звезда-Нав 2", type: "nav", note: "Навигационная система", h: 19100, i: 64.8, raan: 120, u0: 45, color: "#ffe14d" },
    { id: "nav3", name: "Звезда-Нав 3", type: "nav", note: "Навигационная система", h: 19100, i: 64.8, raan: 240, u0: 90, color: "#ffe14d" },
    { id: "strazh", name: "Страж-ГСО", type: "comm", note: "Геостационарный ретранслятор над 60° в. д.", geo: 60, color: "#ff3fd0" }
  ];
  const TYPE_RU = { station: "Станция", sat: "Спутник", nav: "Навигация", comm: "Связь" };

  // параметры орбит
  CATALOG.forEach(s => {
    if (s.geo != null) { s.a = Math.cbrt(MU * Math.pow(86164.0905 / (2 * Math.PI), 2)); s.e = 0; s.i = 0; s.h = s.a - RE; }
    else if (s.hp != null) { const rp = RE + s.hp, ra = RE + s.ha; s.a = (rp + ra) / 2; s.e = (ra - rp) / (ra + rp); }
    else { s.a = RE + s.h; s.e = 0; }
    s.n = Math.sqrt(MU / Math.pow(s.a, 3));     // рад/с
    s.period = 2 * Math.PI / s.n;               // с
    s.typeRu = TYPE_RU[s.type];
  });

  // звёздное время (угол поворота Земли), рад
  function gmst(ms) {
    const jd = ms / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) * D;
  }
  // положение в инерциальной системе (км) по аномалии
  function inertial(s, anomaly) {
    const raan = (s.raan || 0) * D, inc = s.i * D;
    let x, y, r;
    if (s.e > 0) {
      // anomaly — средняя аномалия; решаем уравнение Кеплера
      let E = anomaly;
      for (let k = 0; k < 8; k++) E -= (E - s.e * Math.sin(E) - anomaly) / (1 - s.e * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2));
      r = s.a * (1 - s.e * Math.cos(E));
      const u = nu + (s.argp || 0) * D;
      x = r * Math.cos(u); y = r * Math.sin(u);
    } else {
      r = s.a; x = r * Math.cos(anomaly); y = r * Math.sin(anomaly);
    }
    // поворот: аргумент широты в плоскости орбиты -> наклонение -> долгота узла
    const xo = x, yo = y * Math.cos(inc), zo = y * Math.sin(inc);
    return [xo * Math.cos(raan) - yo * Math.sin(raan), xo * Math.sin(raan) + yo * Math.cos(raan), zo];
  }
  function anomalyAt(s, ms) {
    const dt = (ms - EPOCH) / 1000;
    if (s.e > 0) return ((s.m0 || 0) * D + s.n * dt) % (2 * Math.PI);
    return ((s.u0 || 0) * D + s.n * dt) % (2 * Math.PI);
  }
  // инерциальная -> земная система, перевод в широту/долготу/высоту
  function toEarth(v, th) {
    const c = Math.cos(th), sn = Math.sin(th);
    const x = c * v[0] + sn * v[1], y = -sn * v[0] + c * v[1], z = v[2];
    const r = Math.hypot(x, y, z);
    return { lat: Math.asin(z / r) / D, lon: Math.atan2(y, x) / D, rho: r / RE, alt: r - RE };
  }

  const S = {
    list: CATALOG,
    // положение спутника в момент ms
    at(s, ms) {
      const th = gmst(ms);
      if (s.geo != null) return { lat: 0, lon: s.geo, rho: s.a / RE, alt: s.h };
      return toEarth(inertial(s, anomalyAt(s, ms)), th);
    },
    // мгновенная орбита (кольцо) в земной системе, n точек
    ring(s, ms, n) {
      const th = gmst(ms), out = [];
      if (s.geo != null) { for (let k = 0; k <= n; k++) out.push({ lat: 0, lon: k / n * 360 - 180, rho: s.a / RE }); return out; }
      for (let k = 0; k <= n; k++) out.push(toEarth(inertial(s, k / n * 2 * Math.PI), th));
      return out;
    },
    speed(s, alt) { const r = RE + alt; return Math.sqrt(MU * (2 / r - 1 / s.a)); }, // км/с
    fmtPeriod(sec) { const m = Math.round(sec / 60); return m < 120 ? m + " мин" : (m / 60).toFixed(1).replace(".", ",") + " ч"; }
  };
  window.KGSats = S;
})();
