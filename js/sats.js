// Модель движения спутников (одна механика для Земли и Луны). Спутники и их типы хранятся в данных:
// Земля — data/map.json, Луна — data/moon.json. Орбиты: circ — круговая (высота h), ell — эллиптическая
// (перигей hp, апогей ha, аргумент перигея argp), geo — стационарная над долготой lon (только у Земли).
// Общие поля: наклонение i, долгота восходящего узла raan, начальное положение phase (°).
(function () {
  "use strict";
  const D = Math.PI / 180;
  const EPOCH = Date.UTC(2026, 0, 1);
  const SHAPES = { station: "Станция (корпус и панели)", dot: "Точка", diamond: "Ромб", triangle: "Треугольник", square: "Квадрат", star: "Звезда", cross: "Крест" };

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
    // положение спутника в инерциальной системе, км
    function inertialAt(s, ms) {
      const o = prep(s);
      if (o.geo != null) { const th = cfg.rot(ms) + o.geo * D; return [o.a * Math.cos(th), o.a * Math.sin(th), 0]; }
      return inertial(o, (o.phase * D + o.n * (ms - EPOCH) / 1000) % (2 * Math.PI));
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    // детерминированный генератор: у всех зрителей одно и то же облако
    function rng(seed) {
      let h = 1779033703 ^ String(seed).length;
      for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
      return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
    }
    const J2 = cfg.J2 || 0, MIN_RP = R + (cfg.burnAlt || 120);
    // Облако обломков: ev = { t (ISO или мс), n — число обломков, dv — разлёт, м/с, seed }, parents — 1–2 спутника.
    // Каждый обломок получает скорость родителя + случайный толчок и дальше летит по своей кеплеровой орбите
    // с прецессией от сжатия планеты (J2): за минуты облако вытягивается в шлейфы вдоль орбит родителей,
    // за сутки расползается в кольцо. Обломки, ушедшие в атмосферу или на слишком вытянутую орбиту, отбрасываются.
    function breakup(ev, parents) {
      const t = typeof ev.t === "number" ? ev.t : Date.parse(ev.t);
      const n = Math.max(1, Math.min(5000, Math.round(+ev.n || 500))), dv = Math.max(0, +ev.dv || 0) / 1000;
      const rnd = rng(ev.seed || ev.id || "debris");
      const K = 12, el = new Float64Array(n * K), who = new Uint8Array(n);
      const origins = [];
      let k = 0;
      parents.forEach((p, pi) => {
        const r0 = inertialAt(p, t), v0 = sub(inertialAt(p, t + 500), inertialAt(p, t - 500)); // км/с
        origins.push(r0);
        const cnt = Math.round(n * (pi + 1) / parents.length) - Math.round(n * pi / parents.length);
        for (let j = 0; j < cnt; j++) {
          const z = 2 * rnd() - 1, ph = 2 * Math.PI * rnd(), q = Math.sqrt(1 - z * z);
          const m = dv * Math.min(3, -Math.log(1 - rnd() * 0.999) * 0.6); // экспоненциальный разлёт: мелких толчков больше
          const v = [v0[0] + q * Math.cos(ph) * m, v0[1] + q * Math.sin(ph) * m, v0[2] + z * m];
          const r = len(r0), vv = dot(v, v), a = 1 / (2 / r - vv / MU);
          if (!(a > 0) || !isFinite(a)) continue;
          const h = cross(r0, v), hm = len(h);
          const ev3 = sub(cross(v, h).map(x => x / MU), r0.map(x => x / r)), e = len(ev3);
          if (e >= 0.97 || a * (1 - e) < MIN_RP) continue;
          const P = e > 1e-9 ? ev3.map(x => x / e) : r0.map(x => x / r), Wv = h.map(x => x / hm), Q = cross(Wv, P);
          const nu = Math.atan2(dot(r0, Q), dot(r0, P));
          const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
          const nn = Math.sqrt(MU / (a * a * a)), p = a * (1 - e * e), kj = 1.5 * J2 * (R / p) * (R / p) * nn, ci = Wv[2];
          el.set([P[0], P[1], P[2], Q[0], Q[1], Q[2], a, e, nn, E0 - e * Math.sin(E0), -kj * ci, kj * (5 * ci * ci - 1) / 2], k * K);
          who[k] = pi; k++;
        }
      });
      return { t, count: k, el, who, origins };
    }
    // положения обломков на момент ms: out — Float32Array(count·3) широта, долгота, rho; вернёт число обломков.
    // step > 1 — считать только каждый step-й обломок (остальные ячейки out не трогаются)
    function debrisAt(cloud, ms, out, step) {
      const dt = (ms - cloud.t) / 1000; if (dt < 0) return 0;
      const th = cfg.rot(ms), K = 12, el = cloud.el, st = Math.max(1, step | 0);
      for (let i = 0; i < cloud.count; i += st) {
        const o = i * K, a = el[o + 6], e = el[o + 7], M = el[o + 9] + el[o + 8] * dt;
        let E = M + e * Math.sin(M);
        for (let it = 0; it < 6; it++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        let x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
        const dw = el[o + 11] * dt, cw = Math.cos(dw), sw = Math.sin(dw); // поворот перигея
        const x2 = x * cw - y * sw, y2 = x * sw + y * cw;
        let X = x2 * el[o] + y2 * el[o + 3], Y = x2 * el[o + 1] + y2 * el[o + 4], Z = x2 * el[o + 2] + y2 * el[o + 5];
        const dO = el[o + 10] * dt - th, cO = Math.cos(dO), sO = Math.sin(dO); // поворот узла и вращение планеты
        const bx = X * cO - Y * sO, by = X * sO + Y * cO, r = Math.hypot(bx, by, Z);
        out[i * 3] = Math.asin(Z / r) / D; out[i * 3 + 1] = Math.atan2(by, bx) / D; out[i * 3 + 2] = r / R;
      }
      return cloud.count;
    }
    // ближайшее сближение двух спутников в окне [from, from + span] (мс): { t, km }
    function closest(a, b, from, span) {
      const d = ms => len(sub(inertialAt(a, ms), inertialAt(b, ms)));
      let best = from, bd = d(from);
      for (let ms = from; ms <= from + span; ms += 15000) { const v = d(ms); if (v < bd) { bd = v; best = ms; } }
      let lo = best - 15000, hi = best + 15000;
      for (let it = 0; it < 40; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d(m1) < d(m2)) hi = m2; else lo = m1; }
      const t = Math.round((lo + hi) / 2);
      return { t, km: d(t) };
    }
    const M = {
      SHAPES, ORBITS, RE: R, R, MU, toBody, gmst: cfg.rot,
      prep, inertialAt, breakup, debrisAt, closest,
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
    name: "Земля", MU: 398600.4418, R: 6371.0088, rate: 7.2921159e-5, rot: gmst, geo: true, J2: 1.08263e-3, burnAlt: 120,
    minAlt: 160, lowWhy: "иначе спутник сгорит в атмосфере", maxAlt: 400000, highWhy: "дальше — уже орбита Луны"
  });
  // Луна: вращается синхронно, один оборот за 27,32 суток
  const MOON_DAY = 27.321661 * 86400;
  S.Moon = make({
    name: "Луна", MU: 4902.800, R: 1737.4, rate: 2 * Math.PI / MOON_DAY, J2: 2.03e-4, burnAlt: 5,
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
