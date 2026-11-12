// Модель движения спутников (одна механика для Земли и Луны). Спутники и их типы хранятся в данных:
// Земля — data/map.json, Луна — data/moon.json. Орбиты: circ — круговая (высота h), ell — эллиптическая
// (перигей hp, апогей ha, аргумент перигея argp), geo — стационарная над долготой lon (только у Земли).
// Общие поля: наклонение i, долгота восходящего узла raan, начальное положение phase (°).
(function () {
  "use strict";
  const D = Math.PI / 180;
  const EPOCH = Date.UTC(2026, 0, 1);
  const SHAPES = { station: "Станция (корпус и панели)", dot: "Точка", diamond: "Ромб", triangle: "Треугольник", square: "Квадрат" };

  function gmst(ms) {
    const jd = ms / 86400000 + 2440587.5;
    return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) * D;
  }

  // cfg: { name, MU (км³/с²), R (км), rot(ms) — угол поворота тела, rad; minAlt, maxAlt (км); geo (разрешена ли стационарная) }
  function make(cfg) {
    const { MU, R } = cfg;
    const SYNC = 2 * Math.PI / Math.abs(cfg.rate); // период вращения тела, с
    const ORBITS = cfg.geo ? { circ: "Круговая", ell: "Эллиптическая", geo: "Стационарная (над точкой экватора)" } : { circ: "Круговая", ell: "Эллиптическая" };
    const cache = new Map();
    function prep(s) {
      const key = [s.orbit, s.h, s.hp, s.ha, s.i, s.raan, s.argp, s.phase, s.lon].join("|");
      const c = cache.get(s.id);
      if (c && c.key === key) return c;
      const o = { key, e: 0, i: +s.i || 0, raan: +s.raan || 0, argp: +s.argp || 0, phase: +s.phase || 0 };
      if (s.orbit === "geo") { o.a = Math.cbrt(MU * Math.pow(SYNC / (2 * Math.PI), 2)); o.i = 0; o.geo = +s.lon || 0; }
      else if (s.orbit === "ell") { const rp = R + (+s.hp), ra = R + Math.max(+s.ha, +s.hp); o.a = (rp + ra) / 2; o.e = (ra - rp) / (ra + rp); }
      else o.a = R + (+s.h);
      o.n = Math.sqrt(MU / Math.pow(o.a, 3));
      o.period = 2 * Math.PI / o.n;
      cache.set(s.id, o);
      return o;
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
    function toBody(v, th) {
      const c = Math.cos(th), sn = Math.sin(th);
      const x = c * v[0] + sn * v[1], y = -sn * v[0] + c * v[1], z = v[2];
      const r = Math.hypot(x, y, z);
      return { lat: Math.asin(z / r) / D, lon: Math.atan2(y, x) / D, rho: r / R, alt: r - R };
    }
    const M = {
      SHAPES, ORBITS, RE: R, R, MU, toBody, gmst: cfg.rot,
      prep,
      at(s, ms) {
        const o = prep(s);
        if (o.geo != null) return { lat: 0, lon: o.geo, rho: o.a / R, alt: o.a - R };
        const an = (o.phase * D + o.n * (ms - EPOCH) / 1000) % (2 * Math.PI);
        return toBody(inertial(o, an), cfg.rot(ms));
      },
      ring(s, ms, n) {
        const o = prep(s), out = [];
        if (o.geo != null) { for (let k = 0; k <= n; k++) out.push({ lat: 0, lon: k / n * 360 - 180, rho: o.a / R }); return out; }
        const th = cfg.rot(ms);
        for (let k = 0; k <= n; k++) out.push(toBody(inertial(o, k / n * 2 * Math.PI), th));
        return out;
      },
      speed(s, alt) { const o = prep(s); return Math.sqrt(MU * (2 / (R + alt) - 1 / o.a)); },
      period(s) { return prep(s).period; },
      fmtPeriod(sec) { const m = Math.round(sec / 60); return m < 120 ? m + " мин" : m < 72 * 60 ? (m / 60).toFixed(1).replace(".", ",") + " ч" : (m / 1440).toFixed(1).replace(".", ",") + " сут"; },
      validate(s) {
        const num = v => v !== "" && v != null && isFinite(+v);
        const lo = cfg.minAlt, hi = cfg.maxAlt;
        if (!s.name) return "Укажите название";
        if (s.orbit === "geo") { if (!cfg.geo) return "У этого тела нет стационарной орбиты"; return num(s.lon) && Math.abs(+s.lon) <= 180 ? "" : "Долгота от −180 до 180"; }
        if (!num(s.i) || +s.i < 0 || +s.i > 180) return "Наклонение от 0 до 180°";
        if (s.orbit === "ell") {
          if (!num(s.hp) || +s.hp < lo) return `Перигей не ниже ${lo} км (${cfg.lowWhy})`;
          if (!num(s.ha) || +s.ha < +s.hp) return "Апогей должен быть не ниже перигея";
          if (+s.ha > hi) return `Апогей не выше ${hi.toLocaleString("ru-RU")} км (${cfg.highWhy})`;
          return "";
        }
        if (!num(s.h) || +s.h < lo) return `Высота не ниже ${lo} км (${cfg.lowWhy})`;
        if (+s.h > hi) return `Высота не выше ${hi.toLocaleString("ru-RU")} км (${cfg.highWhy})`;
        return "";
      }
    };
    return M;
  }

  // Земля
  const S = make({
    name: "Земля", MU: 398600.4418, R: 6371.0088, rate: 7.2921159e-5, rot: gmst, geo: true,
    minAlt: 160, lowWhy: "иначе спутник сгорит в атмосфере", maxAlt: 400000, highWhy: "дальше — уже орбита Луны"
  });
  // Луна: вращается синхронно, один оборот за 27,32 суток
  const MOON_DAY = 27.321661 * 86400;
  S.Moon = make({
    name: "Луна", MU: 4902.800, R: 1737.4, rate: 2 * Math.PI / MOON_DAY,
    rot: ms => ((ms - EPOCH) / 1000 / MOON_DAY % 1) * 2 * Math.PI, geo: false,
    minAlt: 10, lowWhy: "иначе спутник врежется в горы", maxAlt: 40000, highWhy: "дальше Земля утащит спутник с орбиты Луны"
  });

  // Луна вокруг Земли: средние элементы орбиты (точность — единицы градусов)
  S.moonAt = function (ms, uOverride) {
    const d = (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;
    const node = (125.04 - 0.0529539 * d) * D;
    const L = (218.316 + 13.176396 * d) * D;
    const u = uOverride != null ? uOverride : L - node;
    const inc = 5.145 * D, eps = 23.4393 * D, dist = 384400;
    const x = Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(inc);
    const y = Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(inc);
    const z = Math.sin(u) * Math.sin(inc);
    return S.toBody([x * dist, (y * Math.cos(eps) - z * Math.sin(eps)) * dist, (y * Math.sin(eps) + z * Math.cos(eps)) * dist], gmst(ms));
  };
  S.moonRing = function (ms, n) { const out = []; for (let k = 0; k <= n; k++) out.push(S.moonAt(ms, k / n * 2 * Math.PI)); return out; };
  S.MOON_R = 1737.4;
  window.KGSats = S;
})();
