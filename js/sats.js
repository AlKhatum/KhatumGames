// Модель движения спутников. Сами спутники и их типы хранятся в data/map.json (ГМ может их править).
// Орбиты: circ — круговая (высота h), ell — эллиптическая (перигей hp, апогей ha, аргумент перигея argp),
// geo — геостационарная (долгота lon). Общие поля: наклонение i, долгота восходящего узла raan, фаза phase (°).
(function () {
  "use strict";
  const MU = 398600.4418;     // км³/с²
  const RE = 6371.0088;       // км
  const D = Math.PI / 180;
  const EPOCH = Date.UTC(2026, 0, 1);
  const SIDEREAL = 86164.0905;

  const SHAPES = { station: "Станция (корпус и панели)", dot: "Точка", diamond: "Ромб", triangle: "Треугольник", square: "Квадрат" };
  const ORBITS = { circ: "Круговая", ell: "Эллиптическая", geo: "Геостационарная" };

  // вычисляемые параметры орбиты (кэшируются по содержимому записи)
  const cache = new Map();
  function prep(s) {
    const key = [s.orbit, s.h, s.hp, s.ha, s.i, s.raan, s.argp, s.phase, s.lon].join("|");
    const c = cache.get(s.id);
    if (c && c.key === key) return c;
    const o = { key, e: 0, i: +s.i || 0, raan: +s.raan || 0, argp: +s.argp || 0, phase: +s.phase || 0 };
    if (s.orbit === "geo") { o.a = Math.cbrt(MU * Math.pow(SIDEREAL / (2 * Math.PI), 2)); o.i = 0; o.geo = +s.lon || 0; }
    else if (s.orbit === "ell") { const rp = RE + (+s.hp), ra = RE + Math.max(+s.ha, +s.hp); o.a = (rp + ra) / 2; o.e = (ra - rp) / (ra + rp); }
    else o.a = RE + (+s.h);
    o.n = Math.sqrt(MU / Math.pow(o.a, 3));
    o.period = 2 * Math.PI / o.n;
    cache.set(s.id, o);
    return o;
  }
  function gmst(ms) {
    const jd = ms / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) * D;
  }
  function inertial(o, anomaly) {
    const raan = o.raan * D, inc = o.i * D;
    let x, y;
    if (o.e > 0) {
      let E = anomaly;
      for (let k = 0; k < 8; k++) E -= (E - o.e * Math.sin(E) - anomaly) / (1 - o.e * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));
      const r = o.a * (1 - o.e * Math.cos(E)), u = nu + o.argp * D;
      x = r * Math.cos(u); y = r * Math.sin(u);
    } else { x = o.a * Math.cos(anomaly); y = o.a * Math.sin(anomaly); }
    const xo = x, yo = y * Math.cos(inc), zo = y * Math.sin(inc);
    return [xo * Math.cos(raan) - yo * Math.sin(raan), xo * Math.sin(raan) + yo * Math.cos(raan), zo];
  }
  function toEarth(v, th) {
    const c = Math.cos(th), sn = Math.sin(th);
    const x = c * v[0] + sn * v[1], y = -sn * v[0] + c * v[1], z = v[2];
    const r = Math.hypot(x, y, z);
    return { lat: Math.asin(z / r) / D, lon: Math.atan2(y, x) / D, rho: r / RE, alt: r - RE };
  }

  const S = {
    SHAPES, ORBITS, RE,
    prep,
    at(s, ms) {
      const o = prep(s);
      if (o.geo != null) return { lat: 0, lon: o.geo, rho: o.a / RE, alt: o.a - RE };
      const M = (o.phase * D + o.n * (ms - EPOCH) / 1000) % (2 * Math.PI);
      return toEarth(inertial(o, M), gmst(ms));
    },
    ring(s, ms, n) {
      const o = prep(s), out = [];
      if (o.geo != null) { for (let k = 0; k <= n; k++) out.push({ lat: 0, lon: k / n * 360 - 180, rho: o.a / RE }); return out; }
      const th = gmst(ms);
      for (let k = 0; k <= n; k++) out.push(toEarth(inertial(o, k / n * 2 * Math.PI), th));
      return out;
    },
    speed(s, alt) { const o = prep(s); return Math.sqrt(MU * (2 / (RE + alt) - 1 / o.a)); },
    period(s) { return prep(s).period; },
    fmtPeriod(sec) { const m = Math.round(sec / 60); return m < 120 ? m + " мин" : (m / 60).toFixed(1).replace(".", ",") + " ч"; },
    // проверка параметров орбиты; возвращает текст ошибки или ""
    validate(s) {
      const num = v => v !== "" && v != null && isFinite(+v);
      if (!s.name) return "Укажите название";
      if (s.orbit === "geo") return num(s.lon) && Math.abs(+s.lon) <= 180 ? "" : "Долгота от −180 до 180";
      if (!num(s.i) || +s.i < 0 || +s.i > 180) return "Наклонение от 0 до 180°";
      if (s.orbit === "ell") {
        if (!num(s.hp) || +s.hp < 160) return "Перигей не ниже 160 км (иначе спутник сгорит в атмосфере)";
        if (!num(s.ha) || +s.ha < +s.hp) return "Апогей должен быть не ниже перигея";
        if (+s.ha > 400000) return "Апогей не выше 400 000 км";
        return "";
      }
      if (!num(s.h) || +s.h < 160) return "Высота не ниже 160 км (иначе спутник сгорит в атмосфере)";
      if (+s.h > 400000) return "Высота не выше 400 000 км";
      return "";
    }
  };
  window.KGSats = S;
})();
