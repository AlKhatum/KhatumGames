// Модель расчёта калькулятора (новая редакция). Чистые функции: данные в, показатели вне. Работает и в браузере, и в Node (для проверок).
// Формулы выведены из документов «Государство», «Экономика» и «Армия»; всё, чего в документах нет, помечено в data/calc.json как «предложено».
(function (root) {
  "use strict";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
  const sumI = (n, f) => { let s = 0; for (let i = 0; i < n; i++) s += f(i); return s; };

  // взвешенная медиана: items = [{v, w}]
  function wmedian(items) {
    const a = items.filter(x => x.w > 0).sort((p, q) => p.v - q.v), tot = sum(a, x => x.w);
    if (!tot) return 0;
    let acc = 0;
    for (const x of a) { acc += x.w; if (acc >= tot / 2) return x.v; }
    return a[a.length - 1].v;
  }

  // множитель параметров от технологического уровня страны (при уровне 5 равен 1)
  const techMult = (K, tech) => Math.max(0.4, 1 + K.tech_k * (tech - K.tech_ref));
  const n0 = (x, d) => (x == null || x === "" || isNaN(x) ? d : +x);
  const BUILD_ORDER = ["energy", "bmat", "metals", "mech", "elec", "minerals", "precious"]; // продукты, нужные стройкам

  // правила, которых может не быть в старых данных (все — «предложено»): стабильность, АВ, эффекты, жильё, консервация
  const DEF_K = {
    st_tax_norm: 0.25, st_tax: 1, st_soc_lo: 0.15, st_soc: 1, st_soc_hi: 0.25, st_soc_bonus: 0.5, st_food: 4, st_energy: 2, st_goods: 1.5,
    st_wage_lo: 0.8, st_wage: 2, st_idle_lo: 0.05, st_idle: 1.5, st_base: 50, st_drift: 0.02, st_corr0: 20, st_corr: 0.5, st_fat: 1,
    st_pol_lo: 6, st_pol: 0.5, st_out: 0.5, st_cover: 2, st_tax_floor: 0.8, st_os_floor: 0.85, st_att_floor: 0.8, st_gr_base: 0.5, st_gr_out: 20,
    st_av_floor: 0.7, st_av_w: 0.6, st_mor_floor: 0.9, st_mor_w: 0.2, st_sup: 0.1, st_fall: 1.5, av_base: 10,
    soc_ruin2: 15, soc_ruin: 30, soc_weak: 45, soc_firm: 65, soc_recent: 4, soc_stag1: 4, soc_stag2: 12,
    cons_div: 5, home_max: 0.4, rn_turns: 8
  };
  function rules(D) { const K = D.K; if (!K.__def) { for (const k in DEF_K) if (K[k] == null) K[k] = DEF_K[k]; Object.defineProperty(K, "__def", { value: true }); } return K; }

  // ---------- особые эффекты ГМа ----------
  // c.fx = [{ id, name, note, tpl, pos: [{ t, p, m, v }], from, until, vis, off, applied }]
  // t — показатель, p — уточнение (продукт, вид заводов или энергоблоков, тип войск), m — "pct" (множитель: +10 = +10%), "add" (прибавка каждый ход), "once" (разовая позиция при вводе).
  // from — ход, в котором эффект введён; until — ход окончания (null — бессрочно); vis — "player" (игроку страны), "public" (всем), "gm" (только ГМу).
  const FX_TARGETS = [
    ["gdp", "ВВП", "pct"], ["budget", "Доходы бюджета", "pct"], ["prod", "Выпуск продукта", "pct", "product"], ["nat", "Добыча природных ресурсов", "pct"],
    ["os", "Очки строительства", "pct"], ["nip", "НИП", "pct add"], ["av", "Административное влияние", "pct add"], ["upkeep", "Содержание войск", "pct"],
    ["pow_land", "Мощь сухопутных войск", "pct"], ["pow_air", "Мощь авиации", "pct"], ["pow_navy", "Мощь флота", "pct"], ["morale", "Мораль войск", "pct"],
    ["att", "Привлекательность корпораций", "pct"], ["growth", "Прирост населения", "pct"], ["trade", "Объём внешней торговли", "pct"],
    ["stab", "Стабильность", "add once"], ["support", "Поддержка власти", "add once"], ["pol", "Загрязнение", "add once"], ["treasury", "Казна, млрд кр.", "add once"],
    ["stock", "Склад, УЕ продукта", "add once", "product"], ["ind", "Заводы", "once", "ind"], ["en", "Энергоблоки", "once", "en"],
    ["div", "Дивизии", "once", "div"], ["ac", "Самолёты", "once", "ac"], ["ship", "Корабли", "once", "ship"]];
  const fxOn = (D, f) => !!f && !f.off && (f.until == null || n0(D.turnN, 0) < f.until);
  function fxSum(D, c, t, m, p) {
    let s = 0;
    for (const f of (c && c.fx) || []) if (fxOn(D, f)) for (const x of f.pos || []) if (x.t === t && x.m === m && (p == null || x.p === p)) s += n0(x.v, 0);
    return s;
  }
  const fxMul = (D, c, t, p) => Math.max(0, 1 + fxSum(D, c, t, "pct", p) / 100);

  // ---------- экономика ----------
  // территория: площадь застройки и средний КУТ провинций (доли пригодной, затопленной и заражённой земли)
  function terrain(D, c) {
    const K = D.K, t = c.terr || {}, meg = n0(t.meg, 0), prov = n0(t.prov, 0);
    const h = clamp(n0(t.hab, 0.5), 0, 1), f = clamp(n0(t.flood, 0), 0, 1 - h), w = 1 - h - f, r = clamp(n0(t.rad, 0) / 10, 0, 1);
    const sh = { norm: h, flood: f, waste: w * (1 - r), infect: w * r };
    const kutProv = sh.norm * K.kut_norm + sh.flood * K.kut_flood + sh.waste * K.kut_waste + sh.infect * K.kut_infect;
    return { meg, prov, areaMeg: meg * K.meg_area, areaProv: prov * K.prov_area, area: meg * K.meg_area + prov * K.prov_area, sh, kutProv, kutMeg: K.kut_meg };
  }
  // ---------- ресурсы: природные, продукты ----------
  // Рецепты лежат в data/calc.json → products: у каждого продукта мощность (cap), расход на единицу выпуска (inputs) и потребители (use, build).
  // Природные ресурсы: залежи, породы, руды = запасы страны × доля × освоение × (1 − истощение). Переработка идёт в три шага:
  // 1) обратный проход: сколько каждого продукта нужно населению, заводам, армии и стройкам с учётом следующих звеньев цепочек;
  // 2) выпуск под нужды: каждое звено берёт сырьё только под свою нужду, а при нехватке сырья его делят пропорционально заявкам;
  // 3) излишки: остаток сырья идёт в переработку до предела мощностей — это запас на склад и на экспорт.
  function resources(D, c, os, mil) {
    const K = D.K, P = D.products || [], ind = c.ind || {}, en = c.en || {}, mul = (c.lore && c.lore.res) || {}, nat = c.nat || {}, depl = c.depl || {};
    const t = terrain(D, c), S = t.area / 100, hab = t.area * clamp(n0(c.terr && c.terr.hab, 0.5), 0, 1), dev = clamp(n0(c.dev, 0.6), 0, 1);
    const tm = 1 + K.tm_ext * (n0(c.tech, 5) - 5), lm = {}, natK = fxMul(D, c, "nat");
    for (const [old, ids] of Object.entries(D.loreMap || {})) for (const id of ids) lm[id] = n0(mul[old], 1);
    const capOf = p => {
      const cp = p.cap || {}; let v = 0, has = false;
      if (cp.ind) { has = true; for (const [k, w] of Object.entries(cp.ind)) v += n0(ind[k], 0) * w; }
      if (cp.en) { has = true; for (const [k, w] of Object.entries(cp.en)) v += n0(en[k], 0) * w; }
      if (cp.land) { has = true; v += hab * cp.land; }
      if (cp.water) { has = true; v += n0(c.water, 0) * cp.water; }
      if (cp.hydro) { has = true; v += n0(c.hydro, 0) * cp.hydro; }          // гидропоника и аквафермы (единиц выпуска)
      return has ? v : Infinity;
    };
    const mpop = n0(c.pop, 0), facN = c.ind ? sum(Object.values(c.ind)) : 0; // заводы (энергоблоки энергию не потребляют)
    const L = {}, cap = {}, dem = {}, need = {}, qT = {}, qN = {}, prod = {}, avail = {}, used = {}, lim = {};
    for (const p of P) {
      const u = p.use || {};
      L[p.id] = n0(lm[p.id], 1) * fxMul(D, c, "prod", p.id) * (p.nat ? natK : 1);
      dem[p.id] = { pop: mpop * n0(u.pop, 0), fac: facN * n0(u.fac, 0), army: mil ? mil.upkeep * n0(u.army, 0) : 0, build: os * n0(p.build, 0) };
      need[p.id] = dem[p.id].pop + dem[p.id].fac + dem[p.id].army + dem[p.id].build;
      if (!p.nat) cap[p.id] = capOf(p);
      prod[p.id] = 0; avail[p.id] = 0; used[p.id] = 0;
    }
    const enP = P.find(p => p.id === "energy"), fosK = enP && enP.cap && enP.cap.en ? n0(enP.cap.en.fossil, 1) : 1, fosCap = n0(en.fossil, 0) * fosK;
    const conv = p => (p.conv != null ? p.conv : K.conv);
    // 1. обратный проход: заявки на сырьё
    const fosNeed = {};
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.nat) continue;
      if (p.id === "energy") {
        const q = Math.min(cap.energy, need.energy / Math.max(1e-9, L.energy));
        qT.energy = q;
        const fos = clamp(q - (cap.energy - fosCap), 0, fosCap);                          // термоядерные и возобновляемые блоки работают первыми
        fosNeed.blocks = fos / Math.max(1e-9, fosK);
        if (need.fuel != null) need.fuel += fosNeed.blocks * K.fuel_block;
        continue;
      }
      if (!p.inputs) { qT[p.id] = cap[p.id]; continue; }
      const q = Math.min(cap[p.id], need[p.id] / Math.max(1e-9, conv(p) * L[p.id]));
      qT[p.id] = q;
      for (const [inp, k] of Object.entries(p.inputs)) if (need[inp] != null) need[inp] += q * k;
    }
    // 2. выпуск под нужды (сырьё делится пропорционально заявкам)
    const share = id => (need[id] > 1e-9 ? Math.min(1, prod[id] / need[id]) : 1);
    let fossilCut = 1;
    for (const p of P) {
      if (p.nat) {
        const sh = n0(nat[p.nat], 0), d = clamp(n0(depl[p.nat], 0), 0, 1);
        prod[p.id] = n0(c.raw, 0) * K.raw_k * sh * dev * (1 - d) * tm * L[p.id];
      } else if (p.id === "energy") {
        const base = Math.min(qT.energy, cap.energy - fosCap), fosQ = Math.max(0, qT.energy - base);
        const fu = n0(fosNeed.blocks, 0) * K.fuel_block, f = fu > 0 ? share("fuel") : 1;
        fossilCut = fu > 0 ? f : 1; if (f < 1) lim.energy = "fuel";
        qN.energy = base + fosQ * f; used.fuel += fu * f;
        prod.energy = qN.energy * L.energy;
        if (qT.energy < need.energy / Math.max(1e-9, L.energy) - 1e-9 && !lim.energy) lim.energy = "cap";
      } else if (!p.inputs) {
        qN[p.id] = cap[p.id]; prod[p.id] = cap[p.id] * L[p.id];
      } else {
        let f = 1;
        for (const inp of Object.keys(p.inputs)) { const s = share(inp); if (s < f) { f = s; lim[p.id] = inp; } }
        qN[p.id] = qT[p.id] * f;
        for (const [inp, k] of Object.entries(p.inputs)) used[inp] += qN[p.id] * k;
        prod[p.id] = qN[p.id] * conv(p) * L[p.id];
        if (!lim[p.id] && qT[p.id] < need[p.id] / Math.max(1e-9, conv(p) * L[p.id]) - 1e-9) lim[p.id] = "cap";
      }
    }
    // 3. излишки: остаток сверх нужд идёт в переработку до предела мощностей
    const left = id => Math.max(0, prod[id] - used[id] - (dem[id] ? dem[id].pop + dem[id].fac + dem[id].army + dem[id].build : 0));
    for (const p of P) {
      if (p.nat || !p.inputs) {
        if (p.id === "energy") {
          const freeCap = Math.max(0, cap.energy - fosCap - Math.min(qN.energy, cap.energy - fosCap)), fosUsed = Math.max(0, qN.energy - Math.min(qN.energy, cap.energy - fosCap));
          const fosFree = Math.max(0, fosCap - fosUsed), blocks = Math.min(fosFree / Math.max(1e-9, fosK), left("fuel") / Math.max(1e-9, K.fuel_block));
          used.fuel += blocks * K.fuel_block;
          const extra = freeCap + blocks * fosK;
          qN.energy += extra; prod.energy += extra * L.energy;
        }
        continue;
      }
      let q = Math.max(0, cap[p.id] - qN[p.id]);
      for (const [inp, k] of Object.entries(p.inputs)) q = Math.min(q, k > 0 ? left(inp) / k : Infinity);
      if (!(q > 1e-9)) continue;
      for (const [inp, k] of Object.entries(p.inputs)) used[inp] += q * k;
      qN[p.id] += q; prod[p.id] += q * conv(p) * L[p.id];
    }
    const rows = [];
    for (const p of P) {
      avail[p.id] = Math.max(0, prod[p.id] - used[p.id]);
      rows.push({ id: p.id, k: p.id, cat: p.cat, name: p.name, note: p.note || "", prod: prod[p.id], cap: p.nat || cap[p.id] === Infinity ? null : cap[p.id], lim: lim[p.id] || null, mul: L[p.id],
        dem: dem[p.id], share: p.nat ? n0(nat[p.nat], 0) : null, depl: p.nat ? clamp(n0(depl[p.nat], 0), 0, 1) : null, need: need[p.id] });
    }
    const stock = c.stock || {}, capStore = S * K.store_cap + n0(c.store, 0);
    let room = Math.max(0, capStore - sum(rows, r => n0(stock[r.id], 0)));
    for (const r of rows) {
      r.leftOwn = avail[r.id] || 0;                       // остаток после цепочек переработки (свой выпуск)
      const first = r.dem.pop + r.dem.fac + r.dem.army;   // первыми берут население, заводы и армия
      const needD = first + r.dem.build;
      r.stock = n0(stock[r.id], 0);
      r.draw = Math.min(r.stock, Math.max(0, needD - r.leftOwn)); // дефицит закрывается складом
      r.left = r.leftOwn + r.draw;
      r.afterBasic = r.left - first;
      r.needBuild = r.dem.build;
      r.ratio = r.dem.build > 0 ? clamp(Math.max(0, r.afterBasic) / r.dem.build, 0, 9.99) : null; // обеспеченность стройки
      r.basicRatio = first > 0 ? r.left / first : null;    // покрытие базовых нужд (для рынка: <1 — дефицит)
      r.bal = r.left - first - r.dem.build;                // баланс после всех потребителей
      r.state = first > 0 && r.left < first - 1e-9 ? "deficit" : r.bal < -1e-9 && r.dem.build > 0 ? "build" : "ok";
      // склад копит излишки, пока есть место; рынок видит остаток сверх своих нужд
      r.surplus = Math.max(0, r.leftOwn - needD);
      r.add = Math.min(r.surplus, room); room -= r.add;
      r.stockNext = r.stock - r.draw + r.add;
      // местная цена: спрос / предложение; склад гасит скачок
      const Dm = (r.prod - r.leftOwn) + needD, base = n0((P.find(x => x.id === r.id) || {}).price, 0);
      let mult = Dm > 0 ? clamp(Dm / Math.max(r.prod, 1e-9), K.price_min, K.price_max) : K.price_min;
      mult = 1 + (mult - 1) * (1 - K.stock_damp * Math.min(1, r.stock / Math.max(Dm, 1e-9)));
      r.base = base; r.priceLive = base * mult; r.price = c.priceSnap && c.priceSnap[r.id] != null ? c.priceSnap[r.id] : r.priceLive; r.mult = base > 0 ? r.price / base : mult;
    }
    const bRows = rows.filter(r => r.ratio != null);
    const needB = sum(bRows, r => r.needBuild);   // обеспеченность стройки — доля потребности в продуктах, которую удалось закрыть (по весу потребности)
    const supply = needB > 0 ? sum(bRows, r => Math.min(1, r.ratio) * r.needBuild) / needB : 1;
    const worst = bRows.reduce((x, y) => (y.ratio < x.ratio ? y : x), bRows[0] || { ratio: 1, name: "" });
    return { rows, supply, worst, fossilCut, area: t.area, hab, dev, S, capStore, stockSum: sum(rows, r => r.stock), stockNext: sum(rows, r => r.stockNext) };
  }

  // прирост населения от стабильности: × (0,5 + С/100); ниже 20 прирост падает до нуля к 10 и уходит в отток
  const growthK = (K, S) => (S >= K.st_gr_out ? K.st_gr_base + S / 100 : (K.st_gr_base + K.st_gr_out / 100) * (S - K.st_gr_out / 2) / (K.st_gr_out / 2));
  // трудовые кадры: ТК = ТЕ, СТК = КТЕ (100 тыс. человек), ВТК/СВТК — из личного состава армии (тыс. чел.), РН — резерв населения без жилья
  // Жильё строится в первую очередь: под прирост и 1/rn_turns резерва, но не больше home_max от ОС с учётом ресурсов.
  function labor(D, c, E, mil) {
    const K = D.K, pers = mil ? mil.pers : 0, sk = clamp(K.army_sk + K.army_sk_tech * (n0(c.tech, 3) - 3), 0, 0.9), S = n0(c.stab, 50);
    const vtk = pers * (1 - sk) / 100, svtk = pers * sk / 100;            // 1 ТЕ = 100 тыс. человек
    const gk = growthK(K, S) * fxMul(D, c, "growth");
    const growth = n0(c.pop, 0) * 10 * K.growth_turn * gk;               // прирост за ход, ед. по 100 тыс. (отрицательный — отток)
    const rn = n0(c.rn, 0), want = Math.max(0, growth) + rn / K.rn_turns;
    const osHome = Math.min(E.osEff * K.home_max, want * K.os_home), homes = osHome / K.os_home; // жильё за ход, ед. по 100 тыс.
    const move = Math.min(rn + Math.max(0, growth), homes);              // РН переходят в ТК, пока хватает жилья
    return { tk: E.te, stk: E.kte, vtk, svtk, rn, growth, gk, homes, osHome, want, move, rnNext: Math.max(0, rn + Math.max(0, growth) - move), idle: rn / Math.max(1, E.te + E.kte) };
  }
  // экологическая нагрузка: шкала 0–10; выбросы заводов и тепловых блоков на площадь страны, очистка из бюджета инфраструктуры
  function ecology(D, c, E) {
    const K = D.K, ind = c.ind || {}, en = c.en || {}, pol = clamp(n0(c.pol, 0), 0, 10);
    const emit = n0(ind.heavy, 0) * K.pol_heavy + n0(ind.chem, 0) * K.pol_chem + n0(ind.vpk, 0) * K.pol_vpk + n0(ind.hitech, 0) * K.pol_hitech + n0(ind.ship, 0) * K.pol_ship + n0(ind.aero, 0) * K.pol_aero + n0(en.fossil, 0) * K.pol_fossil;
    const nOut = (c.outbreaks || []).length, S = Math.max(1, E.terr.area / 100), add = emit / S * K.pol_area + nOut * K.out_add, clean = E.infra * K.clean_bn / S * 10, decay = pol * K.pol_decay;
    const fx = fxSum(D, c, "pol", "add");
    const next = clamp(pol + add - clean - decay + fx, 0, 10);
    const risk = clamp(pol / 10, 0, 1) * K.pol_out;                       // шанс нового очага за ход
    const dm = n0(c.dev, 0.6) * K.depl_base * (1 + K.depl_pol * pol / 10); // истощение месторождений за ход
    return { pol, emit, add, clean, decay, fx, next, delta: next - pol, risk, dm, outbreaks: c.outbreaks || [], gdpLoss: K.pol_gdp * Math.max(0, pol - 5) / 5 };
  }

  // корпорации страны как предприятия: выручка, издержки, ожидаемая и реальная ЗП, МРОТ, привлекательность, риск банкротства
  function corporations(D, c, gdp, workers, priv, te, kte) {
    const K = D.K, SEC = D.sectors || {}, list = c.corps || [];
    const kw = K.wage_dev + K.wage_tech * n0(c.tech, 5);
    const slack = n0(c.rn, 0) / Math.max(1, te + kte);
    const mod = 1 + clamp(K.lab_mod * (0.05 - slack), -0.15, 0.15);       // рынок труда: избыток рук снижает цену труда
    const expected0 = workers > 0 ? gdp / workers * kw : 0;               // средняя ожидаемая ЗП по стране, тыс. кр. за ход на работника
    const mrot = K.mrot * expected0, tax = n0(c.tax, 0.25) * K.corp_tax;
    const totalPres = clamp(sum(list, x => n0(x.pres, 0)) * K.pres_share, 0, 0.8);
    const ents = list.map(x => ({ id: x.id, name: x.name, sector: x.sector, w: totalPres ? n0(x.pres, 0) * K.pres_share : 0, cap: x.cap }));
    ents.push({ id: "other", name: "Прочий частный бизнес", sector: "other", w: Math.max(0.2, 1 - totalPres) });
    const wSum = sum(ents, e => e.w); ents.forEach(e => { e.w /= wSum; });
    const labW = sum(ents, e => e.w * n0((SEC[e.sector] || SEC.other || {}).lab, 1));
    for (const e of ents) {
      const sc = SEC[e.sector] || SEC.other || { raw: 0.35, lab: 1 };
      e.rev = gdp * priv * e.w;
      e.n = workers * priv * e.w * n0(sc.lab, 1) / Math.max(1e-9, labW);  // занятые, млн
      e.raw = e.rev * sc.raw; e.tax = e.rev * tax; e.exc = e.rev * K.excise; e.logi = e.rev * K.logi;
      e.pre = e.rev - e.raw - e.tax - e.exc - e.logi;
      e.exp = expected0 * mod;
      e.afford = e.n > 0 ? e.pre / e.n : 0;
      e.real = clamp(e.afford, mrot, e.exp * K.wage_cap);
      e.profit = e.pre - e.real * e.n;
      e.att = e.exp > 0 ? e.real / e.exp : 1;
      e.loss = Math.max(0, mrot - e.afford);                               // фактор убыточных зарплат
      e.bankrupt = e.afford < mrot && n0(c.subsidy, 0) <= 0;               // убыток даже на МРОТ без субсидий
    }
    const stateN = workers * (1 - priv), stateReal = expected0 * clamp(K.state_wage + 0.5 * (n0(c.b && c.b.soc, 0.2) - 0.2), 0.6, 1.1);
    const nAll = sum(ents, e => e.n) + stateN;
    const avgReal = nAll > 0 ? (sum(ents, e => e.n * e.real) + stateN * stateReal) / nAll : 0;
    const avgAtt = sum(ents, e => e.w * clamp(e.att, K.att_min, K.att_max));
    return { ents, expected: expected0 * mod, expected0, mod, mrot, avgReal, avgAtt, gap: expected0 * mod > 0 ? avgReal / (expected0 * mod) : 1, stateReal, stateN, bankrupt: ents.filter(e => e.bankrupt).map(e => e.name) };
  }

  // частный сектор по экономической модели страны (повестка «Экономическая модель»)
  function economy(D, c, mil) {
    const K = D.K, pop = c.pop, workers = pop * c.work, S = n0(c.stab, 50);   // млн работников; S — стабильность этого хода
    const fac = c.ind ? sum(Object.values(c.ind)) : n0(c.factories, 0), energy = c.en ? sum(Object.values(c.en)) : n0(c.energy, 0);
    const corp = c.corp || {};
    const teAll = workers * K.te_per_mln;                                  // ТЕ всего (100 тыс. человек)
    const q = clamp(K.skilled_base + K.skilled_edu * c.edu + K.skilled_tech * (c.tech - 3), K.skilled_base, K.skilled_max);
    const kte = teAll * q, te = teAll - kte;
    const prod = K.prod_base + K.prod_tech * c.tech;
    const stab = K.stab_floor + K.stab_w * S / 100;                         // стабильность → ВВП
    const taxS = K.st_tax_floor + (1 - K.st_tax_floor) * S / 100;          // стабильность → собираемость налогов
    const osS = K.st_os_floor + (1 - K.st_os_floor) * S / 100;             // стабильность → очки строительства
    const attS = K.st_att_floor + (1 - K.st_att_floor) * S / 100;          // стабильность → привлекательность корпораций
    const terr = terrain(D, c);
    const pol0 = clamp(n0(c.pol, 0), 0, 10), polK = 1 - K.pol_gdp * Math.max(0, pol0 - 5) / 5;  // сильное загрязнение снижает выработку
    const labor0 = (te + K.kte_w * kte) * prod * stab;                     // доля от труда
    const epp0 = K.epp_fact * fac + K.epp_en * energy;
    const made = (epp0 * K.gdp_epp + (te + K.kte_w * kte) * K.gdp_lab) * stab; // доля от производства (заводы и энергия)
    const priv = clamp(n0(c.priv_base, 0.35) + K.priv_infl * n0(corp.infl, 0), 0, 0.95);
    const gdpBase = (K.gdp_labor_share * labor0 + (1 - K.gdp_labor_share) * made) * (1 + n0(corp.gdp, 0)) * n0(c.lore && c.lore.gdp, 1) * polK * fxMul(D, c, "gdp"); // кредитов в ход (кредит = 1 млрд)
    const wages = corporations(D, c, gdpBase, workers, priv, te, kte);
    const attEff = wages.avgAtt * attS * fxMul(D, c, "att");
    const gdpTurn = gdpBase * (1 - priv + priv * attEff);                  // привлекательность корпораций множит их выпуск
    const wage = te * K.wage_te + kte * K.wage_kte;
    const epp = K.epp_fact * fac + K.epp_en * energy;
    const os = epp * K.os_per_epp * osS * fxMul(D, c, "os"), res = resources(D, c, os, mil);
    const tribute = n0(c.tribute, 0) / K.turns_year;                       // дань по лору, млрд кр. в ход
    const budget = gdpTurn * c.tax * taxS * (1 + n0(corp.bud, 0)) * fxMul(D, c, "budget") + tribute;
    const sci = budget * c.b.sci;
    const E = { workers, te, kte, skilled: q, prod, stab, taxS, osS, attS, attEff, gdpTurn, gdpYear: gdpTurn * K.turns_year, wage, epp, os, osEff: os * res.supply, res, terr, priv, tribute, factories: fac, energy, budget, polK,
      def: budget * c.b.def, space: budget * c.b.space, sci, soc: budget * c.b.soc, infra: budget * c.b.infra,
      perCapita: pop ? gdpTurn * K.turns_year / pop : 0 };
    E.nip = (sci * K.eni_bn + terr.meg * K.eni_meg + n0(c.ind && c.ind.hitech, 0) * K.nip_hitech) * fxMul(D, c, "nip") + fxSum(D, c, "nip", "add"); // НИП за ход
    E.eni = E.nip;
    E.labor = labor(D, c, E, mil); E.eco = ecology(D, c, E); E.wages = wages; E.gdpBase = gdpBase; E.expand = expansion(D, c, E);
    return E;
  }

  // ---------- расширение производства ----------
  // Часть ОС (expand_share от ОС с учётом ресурсов) идёт на новые заводы и энергоблоки. Государственная доля (1 − частный сектор) делится по плану страны
  // (c.plan — доли; пусто — автоплан по приоритетам: текущая структура плюс нехватка продуктов). Частная доля делится рынком: к видам, где доход на 1 ОС выше
  // (выручка по местным ценам / стоимость), и умножается на привлекательность корпораций. Стройка копится по видам и завершается, когда набрана стоимость.
  function expansion(D, c, E) {
    const K = D.K, types = D.buildTypes || [], P = D.products || [], t = E.terr, R = E.res;
    const kutAvg = t.area > 0 ? (t.areaMeg * t.kutMeg + t.areaProv * t.kutProv) / t.area : 1;
    const coefOf = (ty, p) => { const cp = p.cap || {}, g = cp[ty.group]; return g ? n0(g[ty.id], 0) : 0; };
    const cur = ty => n0((c[ty.group] || {})[ty.id], 0), total = Math.max(1, sum(types, cur));
    const need = {}; for (const r of R.rows) need[r.id] = r.state === "deficit" ? 1 - n0(r.basicRatio, 1) : r.ratio != null && r.ratio < 1 ? 1 - r.ratio : 0;
    const maxC = {}; for (const p of P) maxC[p.id] = Math.max(1e-9, ...types.map(ty => coefOf(ty, p)));
    const rows = types.map(ty => {
      const cost = K.os_unit * ty.cat * kutAvg, price = {}; R.rows.forEach(r => { price[r.id] = r.price; });
      const boost = sum(P, p => (coefOf(ty, p) / maxC[p.id]) * n0(need[p.id], 0));
      const yieldOS = sum(P, p => coefOf(ty, p) * n0(price[p.id], 0)) / cost;       // выручка с завода по местным ценам на 1 ОС стоимости
      return { id: ty.id, group: ty.group, name: ty.name, cat: ty.cat, cost, now: cur(ty), boost, yieldOS, auto: (cur(ty) / total + K.plan_floor) * (1 + K.plan_boost * boost), prog: n0((c.build || {})[ty.id], 0) };
    });
    const plan = c.plan || {}, pSum = sum(rows, r => n0(plan[r.id], 0)), mSum = sum(rows, r => Math.pow(Math.max(0, r.yieldOS), K.mkt_k)) || 1, aSum = sum(rows, r => r.auto) || 1;
    const pool = E.osEff * K.expand_share, stateOS = pool * (1 - E.priv), attf = clamp(E.attEff, K.att_min, K.att_max) / K.att_max, mktOS = pool * E.priv * attf;
    for (const r of rows) {
      r.planShare = pSum > 0 ? n0(plan[r.id], 0) / pSum : r.auto / aSum;
      r.mktShare = Math.pow(Math.max(0, r.yieldOS), K.mkt_k) / mSum;
      r.osState = stateOS * r.planShare; r.osMarket = mktOS * r.mktShare; r.os = r.osState + r.osMarket;
      const all = r.prog + r.os; r.built = Math.floor(all / r.cost + 1e-9); r.progNext = all - r.built * r.cost;
      r.turns = r.os > 0 ? r.cost / r.os : Infinity;                                  // ходов на одну единицу при таком темпе
    }
    const model = E.priv < 0.2 ? "Плановая" : E.priv <= 0.6 ? "Смешанная" : "Рыночная";
    return { rows, model, pool, stateOS, mktOS, attf, kutAvg, auto: pSum <= 0, builtTotal: sum(rows, r => r.built) };
  }

  // ---------- санкции и блокады ----------
  // Меры лежат в D.measures: { id, kind: "sanction" | "blockade" | "other", by, against ("*" — все), products: "all" | [id], mode: "ban" | "tariff" (санкции),
  // tariff (надбавка), share (доля перекрытия блокады), mult (квота прочих ограничений), until (ход окончания или null), note }.
  // Бан: торговля между вводящим и целью по продуктам прекращается в обе стороны. Надбавка: растёт пошлина вводящего на импорт из страны-цели.
  // Физическая блокада: поток в страну-цель и из неё умножается на (1 − доля); цель теряет мощь и стабильность, вводящий платит за содержание блокады.
  const mActive = (D, m) => m.until == null || n0(D.turnN, 0) < m.until;
  const activeMeasures = D => (D.measures || []).filter(m => mActive(D, m));
  const mHit = (m, pid) => m.products == null || m.products === "all" || (Array.isArray(m.products) && m.products.includes(pid));
  const tgt = (m, id) => m.against === "*" || m.against === id;
  function flowRule(D, ms, a, b, pid) { // поток a -> b (a экспортёр, b импортёр)
    let ban = false, cap = 1, add = 0;
    for (const m of ms) {
      if (m.kind === "sanction") {
        if (!mHit(m, pid)) continue;
        if (m.mode === "tariff") { if (m.by === b && tgt(m, a)) add += n0(m.tariff, 0); }
        else if ((m.by === a && tgt(m, b)) || (m.by === b && tgt(m, a))) ban = true;
      } else if (m.kind === "blockade") { const f = 1 - clamp(n0(m.share, 0), 0, 1); if ((tgt(m, a) && m.by !== a) || (tgt(m, b) && m.by !== b)) cap *= f; }
      else if (m.kind === "other") { if (mHit(m, pid) && ((m.by === a && tgt(m, b)) || (m.by === b && tgt(m, a)) || (m.against === "*" && (m.by === a || m.by === b)))) cap *= clamp(n0(m.mult, 1), 0, 1); }
    }
    return { ban, cap, add };
  }
  // итог по стране: под блокадой, ввела, санкции
  function measuresOf(D, id) {
    const ms = activeMeasures(D), r = { against: [], by: [], blockShare: 0, byBlk: 0, bySanc: 0, bySancShare: 0 };
    for (const m of ms) {
      if (m.against === id || (m.against === "*" && m.by !== id)) { r.against.push(m); if (m.kind === "blockade") r.blockShare = Math.max(r.blockShare, clamp(n0(m.share, 0), 0, 1)); }
      if (m.by === id) { r.by.push(m); if (m.kind === "blockade") r.byBlk += clamp(n0(m.share, 0), 0, 1); else if (m.kind === "sanction") r.bySanc++; }
    }
    return r;
  }

  // ---------- глобальный рынок ----------
  // Торгуют страны с торговым договором (D.trade). Экспорт = излишек сверх своих нужд × (1 − протекционизм страны), импорт = нехватка × (1 − протекционизм);
  // поток по паре ограничен пропускной способностью пути. Мировая цена = базовая × спрос/предложение; пошлину платит импортёр и получает как доход бюджета.
  // Особый эффект «Объём внешней торговли» множит и экспорт, и импорт страны.
  function market(D, ids, rs) {
    const K = D.K, P = (D.products || []).filter(p => p.cat === "prod" || p.id === "dep" || p.id === "rock" || p.id === "ore");
    const ms = activeMeasures(D), pair = new Map(); for (const t of D.trade || []) { pair.set(t.a + "|" + t.b, t); pair.set(t.b + "|" + t.a, t); }
    const out = ids.map(() => ({ rows: {}, exp: 0, imp: 0, tariff: 0, balance: 0, supplyTrade: null }));
    const tk = ids.map(id => fxMul(D, D.countries[id], "trade"));
    for (const p of P) {
      const X = rs.map(r => { const x = r.eco.res.rows.find(y => y.id === p.id); return x ? x.surplus : 0; });
      const M = rs.map((r, j) => { const x = r.eco.res.rows.find(y => y.id === p.id); return x ? Math.max(0, (x.dem.pop + x.dem.fac + x.dem.army + x.dem.build) - x.left) * (1 - n0(D.countries[ids[j]].protect, 0)) * tk[j] : 0; });
      const Xe = X.map((x, i) => x * (1 - n0(D.countries[ids[i]].protect, 0)) * tk[i]);
      const flows = ids.map(() => ids.map(() => 0));
      for (let i = 0; i < ids.length; i++) {
        if (Xe[i] <= 0) continue;
        const targets = ids.map((_, j) => (j !== i && pair.has(ids[i] + "|" + ids[j]) && M[j] > 0 ? j : -1)).filter(j => j >= 0), tot = sum(targets, j => M[j]);
        for (const j of targets) {
          const t = pair.get(ids[i] + "|" + ids[j]), fr = flowRule(D, ms, ids[i], ids[j], p.id), route = K.route_k * Math.min(rs[i].eco.res.S, rs[j].eco.res.S) * n0(t.cap, 1) * fr.cap;
          flows[i][j] = fr.ban ? 0 : Math.min(Xe[i] * M[j] / tot, M[j], route) * 1;
        }
      }
      for (let j = 0; j < ids.length; j++) { const got = sumI(ids.length, i => flows[i][j]); if (got > M[j]) for (let i = 0; i < ids.length; i++) flows[i][j] *= M[j] / got; }
      const sumX = sum(Xe), sumM = sum(M);
      const mult = sumM <= 0 ? K.price_min : sumX <= 0 ? K.price_max : clamp(sumM / Math.max(sumX, 1e-9), K.price_min, K.price_max);
      const wpLive = p.price * mult, wp = D.worldSnap && D.worldSnap[p.id] != null ? D.worldSnap[p.id] : wpLive; // мировая цена: действующая (обновляется раз в 2 хода)
      ids.forEach((id, k) => {
        const exp = sum(flows[k]), imp = sumI(ids.length, i => flows[i][k]);
        let cost = 0, tar = 0; ids.forEach((__, i) => { const f = flows[i][k]; if (f > 0) { const t = pair.get(ids[i] + "|" + ids[k]), ta = n0(t.tariff, 0) + flowRule(D, ms, ids[i], ids[k], p.id).add; cost += f * wp * (1 + ta); tar += f * wp * ta; } });
        const rev = exp * wp;
        out[k].rows[p.id] = { id: p.id, name: p.name, exp, imp, wp, wpLive, rev, cost, tariff: tar, can: Xe[k], needImp: M[k], mult };
        out[k].exp += rev; out[k].imp += cost; out[k].tariff += tar;
      });
    }
    ids.forEach((id, k) => { // обеспеченность стройки с учётом импорта
      out[k].balance = out[k].exp - out[k].imp + out[k].tariff;
      const rows = rs[k].eco.res.rows.filter(x => x.ratio != null), need = sum(rows, x => x.needBuild);
      out[k].supplyTrade = need > 0 ? sum(rows, x => Math.min(1, Math.max(0, x.afterBasic + n0((out[k].rows[x.id] || {}).imp, 0)) / x.needBuild) * x.needBuild) / need : 1;
      rs[k].mk = out[k];
    });
    return out;
  }

  // ---------- стабильность ----------
  // Шкала 0–100. Каждый ход меняется на сумму факторов: экономика (налог, соцрасходы, нехватка еды, воды, энергии и товаров, зарплаты, безработица),
  // политика и мир (возврат к уровню цивилизационного вектора, коррупция, усталость от конфронтаций, загрязнение, неоплата войск) и особые эффекты ГМа.
  // Санкции и блокады снижают стабильность сразу, пока действуют (r.stabAdj), и в сумму за ход не входят.
  const VEC_BASE = { "Чистота": 60, "Духовность": 58, "Гармония": 55, "Господство": 52, "Превосходство": 50, "Равновесие": 48, "Ненасытность": 45 };
  const REG_AV = { "Жёсткий тоталитаризм": 1.3, "Тоталитаризм": 1.3, "Авторитаризм": 1.15, "Лёгкий авторитаризм": 1.15, "Демократия": 1, "Абсолютная демократия": 1, "Охлократия": 0.7 };
  const SOCIETY = [["ruin2", "Крайняя разруха", 40], ["ruin", "Разруха", 25], ["fail", "Провалившаяся реформация", 20], ["stag2", "Закрепившийся застой", 15],
    ["over", "Чрезмерная реформация", 10], ["stag1", "Лёгкий застой", 5], ["stagS", "Стабильность, переходящая в застой", -10], ["weak", "Неустойчивая стабильность", -15],
    ["firm", "Устойчивая стабильность", -20], ["ok", "Успешная реформация", -25]];
  // состояние общественности: по стабильности и по истории реформ (c.reform = { turn — ход последней реформы, ok — 1 успешная / −1 провалившаяся, n4 — реформ за последние 4 хода })
  function society(D, c, S) {
    const K = D.K, rf = c.reform || {}, n = n0(D.turnN, 0), has = rf.turn != null && rf.turn !== "", since = has ? n - n0(rf.turn, 0) : n, recent = has && since < K.soc_recent;
    let k;
    if (S < K.soc_ruin2) k = "ruin2"; else if (S < K.soc_ruin) k = "ruin";
    else if (recent && (rf.res === "fail" || n0(rf.ok, 0) < 0)) k = "fail";
    else if (n0(rf.n4, 0) >= 2) k = "over";
    else if (recent && (rf.res === "ok" || n0(rf.ok, 0) > 0) && S >= K.soc_weak) k = "ok";
    else if (since >= K.soc_stag2) k = S >= K.soc_firm ? "stagS" : "stag2";
    else if (since >= K.soc_stag1 && S < K.soc_weak) k = "stag1";
    else if (S >= K.soc_firm) k = "firm"; else if (S >= K.soc_weak) k = "weak"; else k = "stag1";
    const s = SOCIETY.find(x => x[0] === k);
    return { id: k, name: s[1], mod: s[2], since };
  }
  function stability(D, c, r) {
    const K = rules(D), E = r.eco, S = n0(c.stab, 50), f = [], pc = x => Math.round(x * 100) + "%";
    const add = (k, g, name, v) => { if (Math.abs(v) >= 0.005) f.push({ k, g, name, v }); };
    // экономика → стабильность
    const tax = n0(c.tax, 0.25), soc = n0(c.b && c.b.soc, 0.2);
    add("tax", "eco", "Налог " + pc(tax) + " выше нормы " + pc(K.st_tax_norm), -Math.max(0, tax - K.st_tax_norm) / 0.05 * K.st_tax);
    if (soc < K.st_soc_lo) add("soc", "eco", "Социальные расходы " + pc(soc) + " ниже " + pc(K.st_soc_lo), -(K.st_soc_lo - soc) / 0.05 * K.st_soc);
    else if (soc > K.st_soc_hi) add("soc", "eco", "Социальные расходы " + pc(soc) + " выше " + pc(K.st_soc_hi), K.st_soc_bonus);
    const cov = id => {
      const x = E.res.rows.find(y => y.id === id); if (!x) return 1;
      const first = x.dem.pop + x.dem.fac + x.dem.army; if (first <= 1e-9) return 1;
      const imp = r.mk && r.mk.rows[id] ? n0(r.mk.rows[id].imp, 0) : 0;
      return clamp((x.left + imp) / first, 0, 1);
    };
    const fw = Math.min(cov("food"), cov("water")), ce = cov("energy"), cg = cov("goods");
    add("food", "eco", "Нехватка еды и воды (покрыто " + pc(fw) + ")", -K.st_food * (1 - fw));
    add("energy", "eco", "Нехватка энергии (покрыто " + pc(ce) + ")", -K.st_energy * (1 - ce));
    add("goods", "eco", "Нехватка товаров народного потребления (покрыто " + pc(cg) + ")", -K.st_goods * (1 - cg));
    const gap = n0(E.wages.gap, 1), idle = n0(E.labor.idle, 0);
    add("wage", "eco", "Реальная зарплата — " + pc(gap) + " от ожидаемой", -K.st_wage * clamp((K.st_wage_lo - gap) / 0.3, 0, 1));
    add("idle", "eco", "Безработица: резерв без жилья — " + pc(idle) + " кадров", -K.st_idle * clamp((idle - K.st_idle_lo) / 0.15, 0, 1));
    // политика и мир → стабильность
    const vec = (c.gov && c.gov.vector) || "", base = n0(VEC_BASE[vec], K.st_base);
    add("drift", "pol", "Возврат к уровню вектора" + (vec ? " «" + vec + "»" : "") + " (" + base + ")", K.st_drift * (base - S));
    const corr = n0(c.corr, 0), fat = n0(c.fatigue, 0), pol = n0(E.eco.pol, 0);
    add("corr", "pol", "Коррупция " + Math.round(corr) + "%", -Math.max(0, corr - K.st_corr0) / 20 * K.st_corr);
    add("fat", "pol", "Усталость от конфронтаций " + Math.round(fat) + "%", -Math.max(0, fat - 100) / 10 * K.st_fat);
    add("pol", "pol", "Загрязнение " + pol.toFixed(1) + " из 10", -Math.max(0, pol - K.st_pol_lo) * K.st_pol);
    add("cover", "pol", "Содержание войск оплачено на " + pc(clamp(r.cover, 0, 1)), -K.st_cover * (1 - clamp(r.cover, 0, 1)));
    add("fx", "fx", "Особые эффекты", fxSum(D, c, "stab", "add"));
    const delta = sum(f, x => x.v), next = clamp(S + delta, 0, 100);
    const sup = n0(c.support, 50), supNext = clamp(sup + K.st_sup * (S - sup) + fxSum(D, c, "support", "add"), 0, 100);
    const eff = n0(r.stabAdj, S), soc2 = society(D, c, eff);
    return { S, eff, instant: eff - S, f, delta, next, base, vec, society: soc2, support: sup, supNext,
      out: { gdp: K.stab_floor + K.stab_w * eff / 100, tax: K.st_tax_floor + (1 - K.st_tax_floor) * eff / 100, os: K.st_os_floor + (1 - K.st_os_floor) * eff / 100,
        att: K.st_att_floor + (1 - K.st_att_floor) * eff / 100, growth: growthK(K, eff), av: K.st_av_floor + K.st_av_w * eff / 100, morale: K.st_mor_floor + K.st_mor_w * eff / 100 } };
  }

  // ---------- ход ----------
  const TURN_FIELDS = ["ind", "en", "build", "stock", "rn", "pop", "work", "pol", "depl", "dev", "treasury", "outbreaks", "priceSnap", "stab", "support"];
  const ROMAN = ["I", "II", "III", "IV"];
  const turnLabel = (start, n) => { const q = (n0(start && start.q, 1) - 1) + n; return (n0(start && start.year, 2200) + Math.floor(q / 4)) + ", " + ROMAN[((q % 4) + 4) % 4] + " кв."; };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const clone = o => JSON.parse(JSON.stringify(o));
  // advance: по результатам расчёта (rs, market уже вызван) строит новое состояние стран и запись журнала; сам данные не меняет
  function advance(D, ids, rs, n) {
    const K = rules(D), patches = {}, entry = { n: n + 1, countries: {}, events: [] };
    const newTurn = n + 1, updPrices = newTurn % Math.max(1, K.price_turns) === 0;
    ids.forEach((id, k) => {
      const c = D.countries[id], r = rs[k], E = r.eco, L = E.labor, G = E.eco, mk = r.mk || { rows: {}, balance: 0 }, R = E.res, st = stability(D, c, r);
      const before = {}; for (const f of TURN_FIELDS) if (c[f] !== undefined) before[f] = clone(c[f]);
      const stock = {}, depl = clone(c.depl || {});
      for (const x of R.rows) {
        const t = mk.rows[x.id] || {}, draw = Math.max(0, x.draw - n0(t.imp, 0)), add = Math.max(0, x.add - n0(t.exp, 0)), fxa = fxSum(D, c, "stock", "add", x.id);
        const v = x.stock - draw + add + fxa; if (v > 0.01) stock[x.id] = Math.round(v * 100) / 100;
        if (["dep", "rock", "ore"].includes(x.id)) depl[x.id] = clamp(n0(depl[x.id], 0) + G.dm, 0, 1);
      }
      const pop = n0(c.pop, 0) * (1 + K.growth_turn * L.gk), work = clamp((n0(c.pop, 0) * n0(c.work, 0) + L.move / 10) / Math.max(1e-9, pop), 0, 0.95);
      const ev = [], outbreaks = (c.outbreaks || []).slice(), roll = rng(newTurn * 7919 + k * 104729)();
      let pol = G.next, stab = st.next;
      if (roll < G.risk) { outbreaks.push("Очаг загрязнения (ход " + newTurn + ")"); pol = clamp(pol + K.out_pol, 0, 10); stab = clamp(stab - K.st_out, 0, 100); ev.push("Новый очаг загрязнения (шанс " + Math.round(G.risk * 100) + "%, бросок " + Math.round(roll * 100) + "). ГМ может отменить правкой страны."); }
      const unalloc = E.budget * Math.max(0, 1 - Object.values(c.b || {}).reduce((a, b) => a + (+b || 0), 0));
      const treasury = n0(c.treasury, 0) + unalloc + mk.balance + fxSum(D, c, "treasury", "add"); // казна: нераспределённая часть бюджета, торговый баланс и эффекты (недобор на армию уже снижает мощь)
      const priceSnap = updPrices ? Object.fromEntries(R.rows.filter(x => x.base > 0).map(x => [x.id, Math.round(x.priceLive * 1000) / 1000])) : c.priceSnap;
      const p = { stock, rn: Math.round(L.rnNext * 100) / 100, pop: Math.round(pop * 1000) / 1000, work: Math.round(work * 10000) / 10000, pol: Math.round(pol * 1000) / 1000, depl, dev: clamp(n0(c.dev, 0.6) + K.dev_grow * (1 + 10 * n0(c.b && c.b.infra, 0)), 0, 1), treasury: Math.round(treasury * 100) / 100, outbreaks,
        stab: Math.round(stab * 100) / 100, support: Math.round(st.supNext * 100) / 100 };
      if (priceSnap) p.priceSnap = priceSnap;
      const ind = clone(c.ind || {}), enb = clone(c.en || {}), build = {}, built = [];
      for (const x of E.expand.rows) { (x.group === "ind" ? ind : enb)[x.id] = Math.round((n0((x.group === "ind" ? ind : enb)[x.id], 0) + x.built) * 100) / 100; build[x.id] = Math.round(x.progNext * 100) / 100; if (x.built > 0) built.push(x.name.toLowerCase() + " +" + x.built); }
      p.ind = ind; p.en = enb; p.build = build;
      patches[id] = p;
      if (built.length) ev.push("Построено: " + built.join(", "));
      if (R.rows.some(x => x.state === "deficit")) ev.push("Дефицит: " + R.rows.filter(x => x.state === "deficit").map(x => x.name).join(", "));
      if (E.wages.bankrupt.length) ev.push("Риск банкротства: " + E.wages.bankrupt.join(", "));
      if (st.delta <= -K.st_fall) ev.push("Стабильность падает: " + (Math.round(st.delta * 10) / 10) + " за ход");
      const delta = {}; // в журнал идут только изменившиеся поля (null — поля раньше не было): так журнал 126 стран остаётся компактным
      for (const f of TURN_FIELDS) { if (p[f] === undefined) continue; const b = before[f]; if (b === undefined) delta[f] = null; else if (JSON.stringify(b) !== JSON.stringify(p[f])) delta[f] = b; }
      entry.countries[id] = { name: c.name, before: delta, gdp: E.gdpTurn, supply: R.supply, supplyTrade: mk.supplyTrade, balance: mk.balance, nip: E.nip, pol: G.pol, polNext: p.pol, treasury: p.treasury, stab: st.S, stabNext: p.stab, events: ev };
    });
    let world = null;
    if (updPrices) { world = {}; for (const k of ids.keys()) for (const [pid, t] of Object.entries((rs[k].mk || { rows: {} }).rows)) if (world[pid] == null) world[pid] = Math.round(t.wpLive * 1000) / 1000; }
    return { patches, entry, world, updPrices };
  }

  // ---------- соединения ----------
  // Общая формула «Армия.docx»: параметр соединения = медиана параметров частей × (1 + число частей / 100); снабжение суммируется.
  // Отдельные дивизии (не армия) прибавки за число частей не получают.
  function formation(K, parts, tm, noGrow) {
    // parts: [{n, atk (массив из 3 или число), dfn, sup, upkeep, pers, wh, cost}], tm — множитель технологий
    const N = sum(parts, p => p.n);
    if (!N) return { N: 0, power: 0, atk: 0, dfn: 0, fast: 0, react: 0, sup: 0, upkeep: 0, pers: 0, wh: 0 };
    const g = noGrow ? 1 : 1 + K.army_grow * N;
    const med = key => wmedian(parts.map(p => ({ v: p[key], w: p.n }))) * tm;
    const atk = Math.min(100, med("a1")) , fast = Math.min(100, med("a2")) , scale = Math.min(100, med("a0"));
    const dfn = Math.min(100, med("d1")), react = Math.min(100, med("d2")), front = Math.min(100, med("d0"));
    const comb = (K.w_atk * atk * g + K.w_def * dfn * g + K.w_fast * fast + K.w_react * react) / 100;
    return { N, atk: atk * g, dfn: dfn * g, fast, react, scale, front, comb, power: N * comb,
      sup: sum(parts, p => p.n * p.sup), upkeep: sum(parts, p => p.n * p.upkeep), pers: sum(parts, p => p.n * p.pers), wh: sum(parts, p => p.n * (p.wh || 0)) };
  }
  const divPart = (D, id, n) => { const t = D.divTypes.find(x => x.id === id); return t ? { n, a0: t.atk[0], a1: t.atk[1], a2: t.atk[2], d0: t.dfn[0], d1: t.dfn[1], d2: t.dfn[2], sup: t.sup, upkeep: t.upkeep, pers: t.pers } : null; };
  const acPart = (D, id, n) => { const t = D.aircraft.find(x => x.id === id); return t ? { n, a0: t.atk, a1: t.atk, a2: t.man, d0: t.dfn, d1: t.dfn, d2: t.dfn, sup: D.K.sup_flight_ac, upkeep: t.upkeep, pers: t.pers, wh: t.wh } : null; };
  const shPart = (D, id, n) => { const t = D.ships.find(x => x.id === id); return t ? { n, a0: t.atk, a1: t.atk, a2: t.man, d0: t.dfn, d1: t.dfn, d2: t.man, sup: t.sup, upkeep: t.upkeep, pers: t.pers, wh: t.wh } : null; };

  function army(D, c, a) {
    const parts = Object.entries(a.div || {}).map(([id, n]) => divPart(D, id, +n || 0)).filter(Boolean);
    return Object.assign({ name: a.name, sep: !!a.sep }, formation(D.K, parts, techMult(D.K, c.tech), !!a.sep));
  }
  function flight(D, c, f) {
    const parts = Object.entries(f.mix || {}).map(([id, n]) => acPart(D, id, +n || 0)).filter(Boolean);
    const r = formation(D.K, parts, techMult(D.K, c.tech)), N = r.N;
    return Object.assign({ name: f.name, over: N > D.K.flight_max, count: f.count || 1 }, r);
  }
  function squadron(D, c, f) {
    const parts = Object.entries(f.mix || {}).map(([id, n]) => shPart(D, id, +n || 0)).filter(Boolean);
    const r = formation(D.K, parts, techMult(D.K, c.tech)), N = r.N, count = f.count || 1;
    return Object.assign({ name: f.name, over: N > D.K.squad_max, count, cons: clamp(Math.round(n0(f.cons, 0)), 0, count) }, r);
  }

  // ---------- страна целиком ----------
  function country(D, c0) {
    const K = rules(D), ms0 = measuresOf(D, c0.cid), stabAdj = clamp(n0(c0.stab, 50) - K.blk_stab * ms0.blockShare - Math.min(K.meas_stab_cap, K.meas_stab_sanc * ms0.bySanc + K.meas_stab_blk * ms0.byBlk), 0, 100);
    const c = ms0.against.length || ms0.by.length ? Object.assign({}, c0, { stab: stabAdj }) : c0;
    const S = n0(c.stab, 50);
    const armies = (c.armies || []).map(a => army(D, c, a));
    const flights = (c.flights || []).map(f => flight(D, c, f));
    const squads = (c.squadrons || []).map(f => squadron(D, c, f));
    const mult = x => x.count || 1, act = x => (x.count || 1) - (x.cons || 0), cd = Math.max(1, K.cons_div), keep = x => act(x) + (x.cons || 0) / cd;
    const air = { n: sum(flights, f => f.N * mult(f)), power: sum(flights, f => f.power * mult(f)), sup: sum(flights, f => f.sup * mult(f)), upkeep: sum(flights, f => f.upkeep * mult(f)), pers: sum(flights, f => f.pers * mult(f)), wh: sum(flights, f => f.wh * mult(f)), units: sum(flights, mult) };
    // флот: эскадры на консервации — содержание и снабжение ÷ cons_div, в мощи не учитываются
    const navy = { n: sum(squads, f => f.N * mult(f)), power: sum(squads, f => f.power * act(f)), sup: sum(squads, f => f.sup * keep(f)), upkeep: sum(squads, f => f.upkeep * keep(f)), pers: sum(squads, f => f.pers * mult(f)), wh: sum(squads, f => f.wh * act(f)), units: sum(squads, mult),
      cons: sum(squads, f => f.cons || 0), consShips: sum(squads, f => f.N * (f.cons || 0)) };
    const land = { n: sum(armies, a => a.N), power: sum(armies, a => a.power), sup: sum(armies, a => a.sup), upkeep: sum(armies, a => a.upkeep), pers: sum(armies, a => a.pers), sep: sum(armies.filter(a => a.sep), a => a.N) };
    const morale = (K.st_mor_floor + K.st_mor_w * S / 100) * fxMul(D, c, "morale");
    const power = (K.w_land * land.power * fxMul(D, c, "pow_land") + K.w_air * air.power * fxMul(D, c, "pow_air") + K.w_navy * navy.power * fxMul(D, c, "pow_navy")) * morale * (1 - K.blk_power * ms0.blockShare);
    const upkeepYear = (land.upkeep + air.upkeep + navy.upkeep) * K.upkeep_mult * fxMul(D, c, "upkeep");   // млрд кредитов в год (как в старой версии)
    const upkeepBase = upkeepYear / K.turns_year, blkCost = Math.min(1, ms0.byBlk) * K.blk_upkeep * upkeepBase, upkeepTurn = upkeepBase + blkCost; // блокада стоит доли содержания войск
    const eco = economy(D, c, { upkeep: upkeepTurn, pers: land.pers + air.pers + navy.pers });
    const cover = upkeepTurn > 0 ? Math.min(1, eco.def / upkeepTurn) : 1;     // покрытие содержания оборонным бюджетом
    const regime = (c.gov && c.gov.regime) || "", compat = clamp(n0(c.compat, 1), 0.6, 1.4);
    const av = K.av_base * n0(REG_AV[regime], 1) * compat * (K.st_av_floor + K.st_av_w * S / 100) * fxMul(D, c, "av") + fxSum(D, c, "av", "add"); // запас АВ на ход
    return { ms: ms0, blkCost, stabAdj, eco, armies, flights, squads, land, air, navy, power, morale, upkeepTurn, cover, supply: land.sup + air.sup + navy.sup,
      pers: land.pers + air.pers + navy.pers, wh: air.wh + navy.wh, tech: c.tech, pop: c.pop, av, regime, compat };
  }

  // ---------- Индекс национальной мощи ----------
  // Каждая составляющая — доля от лучшей страны набора (0–100), затем взвешенная сумма.
  function inm(D, list) {
    const K = D.K, mx = f => Math.max(1e-9, ...list.map(f));
    const mE = mx(r => r.eco.gdpTurn), mA = mx(r => r.power * (0.5 + 0.5 * r.cover)), mT = 10, mP = mx(r => r.pop);
    return list.map(r => {
      const e = 100 * r.eco.gdpTurn / mE, a = 100 * r.power * (0.5 + 0.5 * r.cover) / mA, t = 100 * r.tech / mT, p = 100 * r.pop / mP;
      const total = (K.inm_eco * e + K.inm_army * a + K.inm_tech * t + K.inm_pop * p) / (K.inm_eco + K.inm_army + K.inm_tech + K.inm_pop);
      return { eco: e, army: a, tech: t, pop: p, total };
    });
  }

  // ---------- предупреждения: проблемы и перекосы страны (показываются красным) ----------
  // Нехватка для населения, заводов и армии считается с учётом склада и импорта по торговым договорам.
  function warnings(D, c, r) {
    const K = rules(D), w = [], pc = x => Math.round(x * 100) + "%";
    const E = r.eco, mk = r.mk;
    for (const x of E.res.rows) {
      const imp = mk && mk.rows[x.id] ? n0(mk.rows[x.id].imp, 0) : 0, first = x.dem.pop + x.dem.fac + x.dem.army;
      const ratioT = x.dem.build > 0 ? clamp(Math.max(0, x.afterBasic + imp) / x.dem.build, 0, 9.99) : null, basicT = first > 0 ? (x.left + imp) / first : null;
      if (ratioT != null && ratioT < 0.5) w.push("Стройкам не хватает ресурса «" + x.name + "»: они получают лишь " + pc(ratioT) + " нужного.");
      if (basicT != null && basicT < 0.9) w.push("Дефицит ресурса «" + x.name + "»: покрыто " + pc(basicT) + " нужд населения, заводов и армии.");
      if (x.depl != null && x.depl > 0.5) w.push("Истощение: «" + x.name + "» выработано на " + pc(x.depl) + ".");
    }
    if (E.res.supply < 0.7) w.push("Строительство упирается в ресурсы: ОС урезаны до " + pc(E.res.supply) + " (" + Math.round(E.osEff) + " из " + Math.round(E.os) + ").");
    if (E.eco.pol >= 7) w.push("Экологическая нагрузка " + E.eco.pol.toFixed(1) + " из 10: растёт шанс очагов (" + pc(E.eco.risk) + " за ход), ВВП снижен на " + pc(E.eco.gdpLoss) + ".");
    else if (E.eco.delta > 0.3 && E.eco.pol >= 5) w.push("Загрязнение растёт на " + E.eco.delta.toFixed(2) + " за ход: стоит вложиться в очистку.");
    if (E.labor.rn > 0 && E.labor.homes < E.labor.growth) w.push("Жилья строится меньше прироста: резерв населения без жилья растёт (" + Math.round(E.labor.rn) + " ед. по 100 тыс.).");
    if (E.wages.bankrupt.length) w.push("Риск банкротства без субсидий: " + E.wages.bankrupt.join(", ") + " (не хватает прибыли даже на МРОТ).");
    if (E.wages.gap < 0.8) w.push("Реальная зарплата по стране — " + pc(E.wages.gap) + " от ожидаемой: растёт социальное напряжение.");
    if (mk && mk.balance < -0.05 * E.budget) w.push("Торговый баланс отрицателен: " + Math.round(mk.balance) + " млрд кр. за ход.");
    if (E.res.stockSum <= 0.01 && E.res.rows.some(x => x.state === "deficit")) w.push("Склад пуст, дефициты нечем сглаживать: цены на рынке растут.");
    if (r.ms && r.ms.blockShare > 0) w.push("Страна под блокадой: перекрыто " + pc(r.ms.blockShare) + " торговли и снабжения, стабильность падает на " + Math.round(K.blk_stab * r.ms.blockShare) + " п.");
    if (r.ms && r.ms.byBlk > 0) w.push("Блокада стоит " + Math.round(r.blkCost) + " млрд кр. за ход сверх обычного содержания войск.");
    if (r.ms && r.ms.against.some(x => x.kind === "sanction")) w.push("Против страны действуют санкции: часть торговли закрыта или дороже.");
    if (E.priv > 0.6 && n0(c.corr, 0) >= 40) w.push("Частный сектор " + pc(E.priv) + " при коррупции " + n0(c.corr, 0) + "%: риск потери контроля над рынком.");
    const bs = Object.values(c.b).reduce((a, b) => a + (+b || 0), 0);
    if (bs > 1.02) w.push("Доли бюджета в сумме дают " + pc(bs) + ": больше 100%.");
    if (c.b.def > 0.45) w.push("Оборона забирает " + pc(c.b.def) + " бюджета: перекос в сторону армии.");
    if (c.b.soc < 0.1) w.push("Социальные расходы всего " + pc(c.b.soc) + " бюджета: рискуют стабильность и поддержка власти.");
    if (c.tax > 0.3) w.push("Налог " + pc(c.tax) + " выше нормы 25%: падают стабильность и рост ВВП.");
    if (c.stab < 40) w.push("Низкая стабильность (" + Math.round(c.stab) + "%): ВВП снижается на " + pc(1 - r.eco.stab) + ".");
    const st = stability(D, c, r);
    const probs = st.f.filter(x => x.v < 0 && x.k !== "drift"), pSum = sum(probs, x => x.v);   // возврат к уровню вектора — не проблема, а медленная норма
    if (pSum <= -K.st_fall || st.delta <= -2 * K.st_fall) { const worst = probs.sort((a, b) => a.v - b.v)[0]; w.push("Стабильность падает на " + Math.abs(st.delta).toFixed(1) + " за ход" + (worst ? ": главная причина — " + worst.name.charAt(0).toLowerCase() + worst.name.slice(1) : "") + "."); }
    if (c.support < 35) w.push("Низкая поддержка власти (" + Math.round(c.support) + "%).");
    if (r.upkeepTurn > 0 && r.cover < 1) w.push("Оборонный бюджет покрывает содержание войск на " + pc(r.cover) + ": мощь в рейтинге снижена.");
    const share = r.pers / 1000 / Math.max(0.001, r.eco.workers);
    if (share > 0.1) w.push("Под ружьём " + pc(share) + " работающих: экономика теряет рабочие руки.");
    const total = r.land.n, byType = {};
    for (const a of c.armies || []) for (const [id, n] of Object.entries(a.div || {})) byType[id] = (byType[id] || 0) + (+n || 0);
    if (total >= 10) {
      for (const [id, n] of Object.entries(byType)) if (n / total > 0.7) w.push("Перекос в составе дивизий: " + pc(n / total) + " — " + ((D.divTypes.find(x => x.id === id) || {}).name || id).toLowerCase() + ".");
      if ((byType.ad || 0) / total < 0.05 && r.air.n > 0) w.push("Слабая ПВО: противовоздушных дивизий меньше 5%.");
    }
    (c.armies || []).forEach((a, i) => { const n = r.armies[i].N; if (!a.sep && n > 0 && n < 5) w.push("«" + a.name + "»: в армии " + n + " дивизий, по правилам нужно от 5."); });
    (c.flights || []).forEach((f, i) => { if (r.flights[i].over) w.push("Звено «" + f.name + "»: самолётов больше " + K.flight_max + "."); });
    (c.squadrons || []).forEach((f, i) => {
      if (r.squads[i].over) w.push("Эскадра «" + f.name + "»: кораблей больше " + K.squad_max + ".");
      const mix = f.mix || {}, cv = Object.entries(mix).filter(([id, n]) => n > 0 && (D.ships.find(x => x.id === id) || {}).cls === "carrier").reduce((a, b) => a + b[1], 0);
      const esc = Object.entries(mix).filter(([id, n]) => n > 0 && ["destroyer", "cruiser", "frigate"].includes((D.ships.find(x => x.id === id) || {}).cls)).reduce((a, b) => a + b[1], 0);
      if (cv && esc < 3) w.push("Эскадра «" + f.name + "»: авианосцы без охранения (нужно хотя бы 3 эсминца, крейсера или фрегата).");
    });
    const aux = (c.squadrons || []).reduce((a, f) => a + (f.count || 1) * ((f.mix || {}).aux || 0), 0), combat = r.navy.n - aux;
    if (combat > 8 && aux * 8 < combat) w.push("Не хватает судов снабжения: на " + combat + " кораблей их " + aux + " (нужно 1 на 8).");
    return w;
  }

  const API = { activeMeasures, measuresOf, flowRule, advance, turnLabel, TURN_FIELDS, market, corporations, warnings, wmedian, techMult, economy, terrain, resources, labor, ecology, BUILD_ORDER, formation, army, flight, squadron, country, inm,
    stability, society, SOCIETY, VEC_BASE, REG_AV, FX_TARGETS, fxSum, fxMul, fxOn, rules, DEF_K, growthK };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.KGCalcModel = API;
})(typeof window !== "undefined" ? window : globalThis);
