// Интерактивная карта: слои из PSD, редактируемые страны (векторизованы из слоёв «Страны»),
// подписи, линии границ, отметки, легенда с флагом, отмена/повтор, сохранение в браузере.
(function () {
  "use strict";
  const W = 4087, H = 3554, NS = "http://www.w3.org/2000/svg";
  const STORE_KEY = "kg-map-v1", UI_KEY = "kg-map-ui-v1";
  const $ = id => document.getElementById(id);
  const { toast, ask } = window.KG;
  const viewport = $("viewport"), world = $("world");
  const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));

  // ---------- русские названия для слоёв PSD ----------
  const RU = {
    "Walmapu": "Валмапу", "Patagonia": "Патагония", "Army of andes": "Армия Анд", "Chile": "Чили",
    "Oriental League": "Восточная лига", "Grand Army": "Великая армия", "Слой 38": "Безымянный остров",
    "Caribas": "Карибы", "Cuba": "Куба", "Panama": "Панама", "Aztec": "Ацтлан", "Central America": "Центральная Америка",
    "Seatle": "Сиэтл", "Newfoundland": "Ньюфаундленд", "Quebec": "Квебек",
    "District 8": "Округ 8", "District 7": "Округ 7", "District 6": "Округ 6", "District 5": "Округ 5",
    "District 4": "Округ 4", "District 3": "Округ 3", "District 2": "Округ 2", "District 1": "Округ 1",
    "Central": "Центральный округ", "Mexico": "Мексика", "Фигура 3": "Спорная территория", "Burma": "Бирма",
    "Australasia": "Австралазия", "Westralia": "Вестралия", "Rajastan": "Раджастан", "Delli": "Дели",
    "Bharat": "Бхарат", "Grey X3": "Серая зона", "Balck X3": "Чёрная зона", "Shwartz X3": "Шварц-зона",
    "Odisha": "Одиша", "X3 4": "Зона X3-4", "Manda": "Манда", "X3 6": "Зона X3-6", "X3 5": "Зона X3-5",
    "Bharata": "Бхарата", "Nepal": "Непал", "Butan": "Бутан", "X3 2": "Зона X3-2", "Penjab": "Пенджаб",
    "Kashmir": "Кашмир", "Pakistan": "Пакистан", "Hazaristan": "Хазаристан", "Afganistan": "Афганистан",
    "X3": "Зона X3", "Belughistan": "Белуджистан", "Group South": "Группа «Юг»", "Siberia": "Сибирь",
    "Far East": "Дальний Восток", "China": "Китай", "Xinxiang": "Синьцзян", "Tibet": "Тибет", "Oroma": "Орома",
    "Eritrea": "Эритрея", "Ethiopia": "Эфиопия", "Xueta 4": "Хуэта IV", "Xueta 3": "Хуэта III",
    "Xueta 2": "Хуэта II", "Xueta 1": "Хуэта I", "Kongo": "Конго", "Lolmana": "Лолмана", "Neuadada": "Неуадада",
    "South Sudan": "Южный Судан", "Mbumo": "Мбумо", "Tsade": "Цаде", "Ogowe": "Огове", "Bafra": "Бафра",
    "Benin": "Бенин", "Ghana": "Гана", "Liberia": "Либерия", "Cote D'Ivoire": "Кот-д’Ивуар",
    "Burkino Faso": "Буркина-Фасо", "NLE": "НЛЕ", "Western Sahara": "Западная Сахара", "Mauritania": "Мавритания",
    "Mali": "Мали", "Sokoto": "Сокото", "Kanem": "Канем", "Sudan": "Судан", "Tunjur": "Тунджур",
    "United African Federation": "Африканская Федерация", "Somali": "Сомали", "Angola": "Ангола",
    "South Africa": "Южная Африка", "Iran": "Иран", "Arabia": "Аравия", "Syria": "Сирия", "Mahgreb": "Магриб",
    "Tripolitania": "Триполитания", "Egypt": "Египет", "Israel": "Израиль", "Yemen": "Йемен",
    "United Arabian Something": "Объединённая Аравия", "Azerbaijan": "Азербайджан", "Scotland": "Шотландия",
    "Kourdistan": "Курдистан", "Guiana": "Гвиана", "Colombia": "Колумбия", "Peru": "Перу", "Brazil": "Бразилия",
    "Indonesia": "Индонезия", "Thailand": "Таиланд", "Vietnam": "Вьетнам", "Laos": "Лаос", "Cambodia": "Камбоджа",
    "North Korea": "Северная Корея", "Japan": "Япония", "Greece": "Греция", "Iceland": "Исландия",
    "United Kingdom": "Соединённое Королевство", "Ireland": "Ирландия", "Finland": "Финляндия", "Norway": "Норвегия",
    "Sweden": "Швеция", "Germany": "Германия", "France": "Франция", "Padua": "Падуя", "Italy": "Италия",
    "Greenland": "Гренландия", "Mongolia": "Монголия", "Kazakhstan": "Казахстан", "Latvia": "Латвия",
    "Lithuania": "Литва", "Ukraine": "Украина", "Karelia": "Карелия", "Russia": "Россия", "Turkey": "Турция",
    "Serbia": "Сербия", "Poland": "Польша", "Slovakia": "Словакия", "Czech Republic": "Чехия",
    "Romania": "Румыния", "Hungary": "Венгрия"
  };

  // ---------- 10 типов отметок ----------
  const MARKERS = [
    { type: "capital", name: "Столица", color: "#ffd84a",
      icon: '<path class="m-ico fill" d="M0-7.5 2.2-2.4 7.6-2.2 3.4 1.2 4.8 6.6 0 3.6-4.8 6.6-3.4 1.2-7.6-2.2-2.2-2.4Z"/>' },
    { type: "fortress", name: "Крепость", color: "#ff5470",
      icon: '<path class="m-ico" d="M-6 6.5V-2h2.4v-3h2v3h3.2v-3h2v3H6v8.5ZM-1.6 6.5V3h3.2v3.5"/>' },
    { type: "port", name: "Порт", color: "#19e6ff",
      icon: '<path class="m-ico" d="M0-4.5V6.5M-3.5-2h7M-6 2.5c0 3 2.8 4 6 4s6-1 6-4"/><circle class="m-ico" cx="0" cy="-6" r="1.6"/>' },
    { type: "battle", name: "Поле битвы", color: "#ff3b3b",
      icon: '<path class="m-ico" d="M-6-6 5 5M6-6-5 5M2.5 6.5 6.5 2.5M-2.5 6.5-6.5 2.5"/>' },
    { type: "ruins", name: "Руины", color: "#c9b48a",
      icon: '<path class="m-ico" d="M-7 6.5h14M-5 6.5V-1l1.5-1.5M-1 6.5V-5.5h2.5v4M4 6.5V1.5l1.5-1"/>' },
    { type: "temple", name: "Храм", color: "#c58bff",
      icon: '<path class="m-ico" d="M-7-2.5 0-7l7 4.5ZM-5-2.5v8M-1.7-2.5v8M1.7-2.5v8M5-2.5v8M-7 6.5h14"/>' },
    { type: "mine", name: "Рудник", color: "#ffa646",
      icon: '<path class="m-ico" d="M-5.5 6.5 4-3M-6-4.5c3-2.5 9-2.5 12.5 1.5-4-1-7.5-.7-10 1"/>' },
    { type: "camp", name: "Лагерь выживших", color: "#7dff6a",
      icon: '<path class="m-ico" d="M-7 6.5 0-6.5 7 6.5ZM0-6.5v-1.5M-2 6.5 0 2l2 4.5"/>' },
    { type: "lighthouse", name: "Маяк", color: "#fff38a",
      icon: '<path class="m-ico" d="M-2.5 6.5-1.5-3.5h3l1 10ZM-2-3.5h4l-.5-2h-3ZM-3-4.5h-4M3-4.5h4M-2.5-7l-2.5-1.5M2.5-7l2.5-1.5"/>' },
    { type: "flooded", name: "Затопленный город", color: "#3fa8ff",
      icon: '<path class="m-ico" d="M-4 1.5V-6h3.5v7.5M1.5 1.5V-3.5H5v5M-7 3.5c1.5-1.3 2.5-1.3 3.5 0s2.5 1.3 3.5 0 2.5-1.3 3.5 0 2.5 1.3 3.5 0M-7 6.5c1.5-1.3 2.5-1.3 3.5 0s2.5 1.3 3.5 0 2.5-1.3 3.5 0 2.5 1.3 3.5 0"/>' }
  ];
  const MT = {}; MARKERS.forEach(m => (MT[m.type] = m));

  // Примерные отметки (по одной каждого типа), привязанные к городам из «Текст.psd»
  const SAMPLE_MARKERS = [
    ["capital", "Новый Ковчег", "Аддис Абеба"],
    ["fortress", "Цитадель Нила", "Хартум"],
    ["port", "Порт Последней Надежды", "Тунис"],
    ["battle", "Битва у Песчаной стены", "Эр Рияд"],
    ["ruins", "Руины Старого мира", "Фарго"],
    ["temple", "Храм Высокой Воды", "Мекка"],
    ["mine", "Глубинный рудник", "Йоханнесбург"],
    ["camp", "Лагерь Скитальцев", "Хобарт"],
    ["lighthouse", "Северный маяк", "Акюрейри"],
    ["flooded", "Затопленная Киншаса", "Киншаса"]
  ];

  // ---------- исходные данные ----------
  const COLS = ["countries", "cities", "labels", "borders", "markers"];
  const original = {}; COLS.forEach(c => (original[c] = {}));
  const autoSize = area => Math.max(8, Math.min(56, Math.sqrt(area || 100) * 0.16));
  (window.COUNTRIES || []).forEach(c => {
    original.countries[c.id] = {
      id: c.id, layer: c.layer, name: RU[c.layer] || c.layer, color: c.color, rings: c.rings,
      label: c.label, size: Math.round(autoSize(c.area) * 10) / 10, flag: null
    };
  });
  (window.CITIES || []).forEach((c, i) => { original.cities["ct" + i] = { id: "ct" + i, name: c.n, x: c.x, y: c.y }; });
  SAMPLE_MARKERS.forEach((m, i) => {
    const city = (window.CITIES || []).find(c => c.n === m[2]);
    const x = city ? city.x + 8 : 600 + i * 300, y = city ? city.y - 14 : 600;
    original.markers["m" + i] = { id: "m" + i, type: m[0], title: m[1], x, y };
  });

  const state = clone(original);
  const dirty = {}; COLS.forEach(c => (dirty[c] = new Set()));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved && saved.v === 1) {
      for (const c of COLS) {
        const o = (saved.data || {})[c] || {};
        for (const id in o) { if (o[id] === null) delete state[c][id]; else state[c][id] = o[id]; dirty[c].add(id); }
      }
    }
  } catch (e) { /* хранилище недоступно — работаем без сохранения */ }

  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function save() {
    const data = {};
    for (const c of COLS) { data[c] = {}; for (const id of dirty[c]) data[c][id] = state[c][id] || null; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, data })); }
    catch (e) { toast("Не удалось сохранить правки в браузере (мало места)"); }
  }

  // ---------- история (отмена / повтор) ----------
  const undoStack = [], redoStack = [];
  function setEntity(col, id, val) {
    if (val == null) delete state[col][id]; else state[col][id] = val;
    dirty[col].add(id);
    render(col, id);
    if (sel && sel.col === col && sel.id === id) { if (val == null) select(null); else refreshSelection(); }
    scheduleSave();
  }
  function commit(col, id, before, after) {
    undoStack.push({ col, id, before: clone(before), after: clone(after) });
    if (undoStack.length > 300) undoStack.shift();
    redoStack.length = 0;
    setEntity(col, id, clone(after));
    updUndo();
  }
  function undo() { const a = undoStack.pop(); if (!a) return; redoStack.push(a); setEntity(a.col, a.id, clone(a.before)); updUndo(); }
  function redo() { const a = redoStack.pop(); if (!a) return; undoStack.push(a); setEntity(a.col, a.id, clone(a.after)); updUndo(); }
  function updUndo() { $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length; }

  // ---------- слои ----------
  // style: "neon" — только в неоновом стиле, "white" — только в белом 3D, без style — в обоих.
  // vis может быть объектом { neon, white } — видимость по умолчанию для каждого стиля.
  const LAYERS = [
    { id: "ocean", name: "Океан (стиль шаблона)", kind: "div", cls: "ocean-fill", vis: true, style: "neon" },
    { id: "wOcean", name: "Океан: графит и сетка", kind: "div", cls: "w-ocean", vis: true, style: "white" },
    { id: "wHud", name: "HUD-разметка океана", kind: "svg", vis: true, style: "white" },
    { id: "base", name: "Подложка PSD (оригинал)", kind: "img", src: "assets/map/base.jpg", vis: false, style: "neon" },
    { id: "bathy", name: "Батиметрия (глубины)", kind: "img", src: "assets/map/bathy.jpg", vis: true, blend: "soft-light", opacity: 0.55, style: "neon" },
    { id: "grid", name: "Сетка океана (синие квадраты)", kind: "div", cls: "ocean-grid", vis: true, style: "neon" },
    { id: "land", name: "Суша: гипсометрия", kind: "img", src: "assets/map/land.png", vis: true, style: "neon" },
    { id: "wLand", name: "Суша: белые плиты с объёмом", kind: "img", src: "assets/map/white_land.png", vis: true, style: "white", lazy: true },
    { id: "countries", name: "Страны (редактируемые)", kind: "svg", vis: true },
    { id: "countriesRaster", name: "Страны (оригинал PSD)", kind: "img", src: "assets/map/countries_raster.png", vis: false, blend: "multiply", style: "neon" },
    { id: "hydro", name: "Гидрография", kind: "img", src: "assets/map/hydro.png", vis: true, opacity: 0.8, style: "neon" },
    { id: "hydroBlue", name: "Озёра и реки", kind: "img", src: "assets/map/hydro_blue.png", vis: true, style: "white", lazy: true },
    { group: "roads", name: "Дороги", children: [
      { id: "road_major", name: "Major Highway", kind: "img", src: "assets/map/road_major.png", vis: { neon: true, white: false }, road: "#ff3fd0" },
      { id: "road_secondary", name: "Secondary Highway", kind: "img", src: "assets/map/road_secondary.png", vis: { neon: true, white: false }, road: "#19e6ff" },
      { id: "road_road", name: "Road", kind: "img", src: "assets/map/road_road.png", vis: { neon: true, white: false }, road: "#ffe14d" },
      { id: "road_unknown", name: "Unknown", kind: "img", src: "assets/map/road_unknown.png", vis: false, road: "#7dff6a" }
    ] },
    { id: "rail", name: "Железные дороги", kind: "img", src: "assets/map/rail.png", vis: { neon: true, white: false }, opacity: 0.18 },
    { id: "citiesFill", name: "Города (заливка)", kind: "img", src: "assets/map/cities_fill.png", vis: { neon: true, white: false }, opacity: 0.6 },
    { id: "outline", name: "Обводка", kind: "img", src: "assets/map/outline.png", vis: { neon: true, white: false } },
    { id: "cityIcons", name: "Города (значки)", kind: "img", src: "assets/map/city_icons.png", vis: { neon: true, white: false } },
    { id: "borders", name: "Линии границ", kind: "svg", vis: true },
    { id: "labels", name: "Названия стран и подписи", kind: "svg", vis: true },
    { id: "cities", name: "Названия городов", kind: "svg", vis: true },
    { id: "markers", name: "Отметки", kind: "svg", vis: true },
    { id: "edit", kind: "svg", internal: true }
  ];
  const L = {}; // id -> element
  const flatLayers = [];
  LAYERS.forEach(l => (l.group ? l.children.forEach(c => flatLayers.push(Object.assign(c, { parent: l.group }))) : flatLayers.push(l)));

  let ui = { vis: {}, hl: {}, style: "neon", tilt: false };
  try { ui = Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch (e) { /* */ }
  if (ui.style !== "white") ui.style = "neon";
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* */ } };
  const mapFrame = viewport.closest(".map-frame");

  flatLayers.forEach(l => {
    let el;
    if (l.kind === "img") {
      el = document.createElement("img"); el.alt = ""; el.draggable = false; el.decoding = "async";
      if (!l.lazy) el.src = l.src; // «ленивые» слои грузятся только когда впервые нужны
      el.onerror = () => { el.style.display = "none"; };
    } else if (l.kind === "div") {
      el = document.createElement("div"); el.className = l.cls;
    } else {
      el = document.createElementNS(NS, "svg");
      el.setAttribute("viewBox", `0 0 ${W} ${H}`); el.setAttribute("width", W); el.setAttribute("height", H);
      el.id = l.id + "Svg";
    }
    el.classList.add("layer");
    if (l.road) el.classList.add("road");
    if (l.opacity != null) el.style.opacity = l.opacity;
    if (l.blend) el.style.mixBlendMode = l.blend;
    world.appendChild(el);
    L[l.id] = el;
  });

  const inStyle = l => !l.style || l.style === ui.style;
  const visKey = l => ui.style + ":" + l.id;
  function isVisible(l) {
    if (!inStyle(l)) return false;
    const v = ui.vis[visKey(l)];
    if (v != null) return v;
    return typeof l.vis === "object" ? !!l.vis[ui.style] : l.vis;
  }
  function setVis(l, v) { ui.vis[visKey(l)] = v; }
  function applyLayer(l) {
    const el = L[l.id]; if (!el || l.internal) return;
    const show = isVisible(l);
    if (show && l.lazy && !el.getAttribute("src")) el.src = l.src;
    el.style.display = show ? "" : "none";
    if (l.road) {
      const on = !!ui.hl[l.id];
      el.classList.toggle("hl", on);
      // неон: белая «сердцевина» + цветное свечение; белый стиль: исходная линия + свечение
      const glow = `drop-shadow(0 0 .6px ${l.road}) drop-shadow(0 0 1.4px ${l.road}) drop-shadow(0 0 3px ${l.road})`;
      el.style.filter = on ? (ui.style === "neon" ? "brightness(0) invert(1) " + glow : "saturate(3) " + glow) : "";
    }
  }

  // панель слоёв (сверху — верхние слои, как в Photoshop)
  function buildLayerPanel() {
    const list = $("layerList"); list.innerHTML = "";
    const row = (l, sub) => {
      const r = document.createElement("div"); r.className = "layer-row" + (sub ? " sub" : "");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = isVisible(l);
      cb.addEventListener("change", () => { setVis(l, cb.checked); applyLayer(l); saveUi(); syncGroupBoxes(); });
      const nm = document.createElement("span"); nm.className = "lname"; nm.textContent = l.name;
      nm.addEventListener("click", () => cb.click());
      r.append(cb);
      if (l.road) { const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = l.road; r.append(sw); }
      r.append(nm);
      if (l.road) {
        const b = document.createElement("button"); b.className = "hl-btn" + (ui.hl[l.id] ? " on" : ""); b.textContent = "Подсветка";
        b.style.setProperty("--hl", l.road);
        b.title = "Сделать слой видимым и подсветить";
        b.addEventListener("click", () => {
          ui.hl[l.id] = !ui.hl[l.id];
          if (ui.hl[l.id]) { setVis(l, true); cb.checked = true; }
          b.classList.toggle("on", !!ui.hl[l.id]); applyLayer(l); saveUi(); syncGroupBoxes();
        });
        l._hlBtn = b;
        r.append(b);
      }
      l._cb = cb;
      return r;
    };
    [...LAYERS].reverse().forEach(l => {
      if (l.internal || !inStyle(l)) return;
      if (l.group) {
        const g = document.createElement("div"); g.className = "layer-row group";
        const cb = document.createElement("input"); cb.type = "checkbox";
        const nm = document.createElement("span"); nm.className = "lname"; nm.textContent = l.name + " (Транспорт)";
        const hb = document.createElement("button"); hb.className = "hl-btn"; hb.textContent = "Подсветить все";
        cb.addEventListener("change", () => { l.children.forEach(c => { setVis(c, cb.checked); c._cb.checked = cb.checked; applyLayer(c); }); saveUi(); syncGroupBoxes(); });
        nm.addEventListener("click", () => cb.click());
        hb.addEventListener("click", () => {
          const allOn = l.children.every(c => ui.hl[c.id]);
          l.children.forEach(c => {
            ui.hl[c.id] = !allOn; if (!allOn) { setVis(c, true); c._cb.checked = true; }
            c._hlBtn.classList.toggle("on", !allOn); applyLayer(c);
          });
          saveUi(); syncGroupBoxes();
        });
        l._cb = cb; l._hb = hb;
        g.append(cb, nm, hb); list.append(g);
        l.children.slice().reverse().forEach(c => list.append(row(c, true)));
      } else list.append(row(l));
    });
    syncGroupBoxes();
  }
  function syncGroupBoxes() {
    LAYERS.filter(l => l.group).forEach(l => {
      const v = l.children.map(isVisible);
      l._cb.checked = v.every(Boolean); l._cb.indeterminate = !l._cb.checked && v.some(Boolean);
      const allHl = l.children.every(c => ui.hl[c.id]);
      l._hb.classList.toggle("on", allHl); l._hb.textContent = allHl ? "Снять подсветку" : "Подсветить все";
    });
  }

  // ---------- стиль карты: «Неон» / «Белый 3D» ----------
  function setStyle(st) {
    ui.style = st === "white" ? "white" : "neon";
    mapFrame.classList.toggle("st-white", ui.style === "white");
    document.querySelectorAll("#styleSwitch button").forEach(b => b.classList.toggle("active", b.dataset.style === ui.style));
    flatLayers.forEach(applyLayer);
    buildLayerPanel();
    saveUi();
  }
  document.querySelectorAll("#styleSwitch button").forEach(b => b.addEventListener("click", () => setStyle(b.dataset.style)));

  // HUD-разметка океана в белом стиле (детерминированный «случайный» узор)
  (function buildHud() {
    const svg = L.wHud; let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ang = -28 * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    const parts = [];
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, y = rnd() * H, t = rnd();
      if (t < 0.35) { // длинная тонкая линия под углом
        const len = 120 + rnd() * 380;
        parts.push(`<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x + ca * len).toFixed(0)}" y2="${(y + sa * len).toFixed(0)}" class="hud-l"/>`);
      } else if (t < 0.6) { // пачка коротких штрихов «////»
        const n = 4 + Math.floor(rnd() * 6);
        let d = "";
        for (let k = 0; k < n; k++) d += `M${(x + k * 7).toFixed(0)} ${y.toFixed(0)}l6 -11`;
        parts.push(`<path d="${d}" class="hud-s"/>`);
      } else if (t < 0.85) { // рамка с «текстом»
        const w = 34 + rnd() * 30;
        let g = `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) skewX(-20)"><rect width="${w.toFixed(0)}" height="13" class="hud-r"/>`;
        for (let k = 0; k < 3; k++) g += `<line x1="0" y1="${20 + k * 6}" x2="${(w * (0.5 + rnd() * 0.5)).toFixed(0)}" y2="${20 + k * 6}" class="hud-t"/>`;
        parts.push(g + "</g>");
      } else { // круг-прицел
        const r = 18 + rnd() * 30;
        parts.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" class="hud-c"/>`);
      }
    }
    svg.innerHTML = parts.join("");
  })();
  setStyle(ui.style);


  // ---------- рендер сущностей ----------
  const els = { countries: {}, clabels: {}, cities: {}, labels: {}, borders: {}, markers: {} };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  function ringsToD(rings, closed) {
    const out = [];
    for (const r of rings) {
      if (r.length < 4) continue;
      const parts = ["M", r[0], " ", r[1]];
      for (let i = 2; i < r.length; i += 2) parts.push("L", r[i], " ", r[i + 1]);
      if (closed !== false) parts.push("Z");
      out.push(parts.join(""));
    }
    return out.join("");
  }
  const gCountryLabels = svgEl("g", {}, L.labels);
  const gCustomLabels = svgEl("g", {}, L.labels);

  function render(col, id) {
    const e = state[col][id];
    if (col === "countries") {
      let p = els.countries[id], t = els.clabels[id];
      if (!e) { p && p.remove(); t && t.remove(); delete els.countries[id]; delete els.clabels[id]; return; }
      if (!p) { p = svgEl("path", { "data-col": "countries", "data-id": id }, L.countries); els.countries[id] = p; }
      p.setAttribute("d", ringsToD(e.rings)); p.setAttribute("fill", e.color);
      if (!t) { t = svgEl("text", { class: "lbl-country", "data-col": "countries", "data-id": id, "data-part": "label" }, gCountryLabels); els.clabels[id] = t; }
      t.setAttribute("x", e.label[0]); t.setAttribute("y", e.label[1]);
      t.setAttribute("font-size", e.size); t.setAttribute("stroke-width", Math.max(1, e.size * 0.18));
      t.setAttribute("letter-spacing", (e.size * 0.12).toFixed(1));
      t.textContent = e.name;
    } else if (col === "cities") {
      let t = els.cities[id];
      if (!e) { t && t.remove(); delete els.cities[id]; return; }
      if (!t) { t = svgEl("text", { class: "lbl-city", "data-col": "cities", "data-id": id }, L.cities); els.cities[id] = t; }
      t.setAttribute("x", e.x); t.setAttribute("y", e.y); t.textContent = e.name;
    } else if (col === "labels") {
      let t = els.labels[id];
      if (!e) { t && t.remove(); delete els.labels[id]; return; }
      if (!t) { t = svgEl("text", { class: "lbl-custom", "data-col": "labels", "data-id": id }, gCustomLabels); els.labels[id] = t; }
      t.setAttribute("x", e.x); t.setAttribute("y", e.y); t.setAttribute("font-size", e.size);
      t.setAttribute("stroke-width", Math.max(1, e.size * 0.18)); t.setAttribute("letter-spacing", (e.size * 0.1).toFixed(1));
      t.textContent = e.text;
    } else if (col === "borders") {
      let g = els.borders[id];
      if (!e) { g && g.remove(); delete els.borders[id]; return; }
      if (!g) {
        g = svgEl("g", { "data-col": "borders", "data-id": id }, L.borders);
        svgEl("path", { class: "border-hit" }, g); svgEl("path", { class: "border-line" }, g);
        els.borders[id] = g;
      }
      const d = ringsToD([e.pts], false);
      g.childNodes[0].setAttribute("d", d); g.childNodes[1].setAttribute("d", d);
      g.childNodes[1].style.stroke = e.color || "";
    } else if (col === "markers") {
      let g = els.markers[id];
      if (!e) { g && g.remove(); delete els.markers[id]; return; }
      const mt = MT[e.type] || MARKERS[0];
      if (!g || g.dataset.type !== e.type) {
        g && g.remove();
        g = svgEl("g", { class: "marker", "data-col": "markers", "data-id": id, "data-type": e.type }, L.markers);
        g.innerHTML = `<circle class="m-ring" r="11" stroke="${mt.color}" style="filter:drop-shadow(0 0 3px ${mt.color})"/>` +
          `<g stroke="${mt.color}" fill="${mt.color}">${mt.icon}</g><text y="23"></text>`;
        els.markers[id] = g;
      }
      g.querySelector("text").textContent = e.title || mt.name;
      g.dataset.x = e.x; g.dataset.y = e.y;
      placeMarker(g);
    }
  }
  function renderAll() { for (const c of COLS) for (const id in state[c]) render(c, id); }

  // ---------- вид (масштаб / сдвиг) ----------
  let s = 0.3, tx = 0, ty = 0, fitS = 0.3;
  const markerScale = () => Math.min(2.2, Math.max(0.35, 0.95 / s));
  function placeMarker(g) { g.setAttribute("transform", `translate(${g.dataset.x} ${g.dataset.y}) scale(${markerScale().toFixed(3)})`); }
  function setView(ns, ntx, nty) {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    s = Math.min(6, Math.max(fitS * 0.7, ns));
    const mw = W * s, mh = H * s;
    // не даём карте уехать за экран
    tx = mw < vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, ntx));
    ty = mh < vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, nty));
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    world.classList.toggle("far", s < 0.55);
    L.cities.style.visibility = s < 0.55 ? "hidden" : "";
    Object.values(els.markers).forEach(placeMarker);
    scheduleHandles();
  }
  function fit() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    fitS = Math.min(vw / W, vh / H);
    setView(fitS, (vw - W * fitS) / 2, (vh - H * fitS) / 2);
  }
  function zoomAt(f, cx, cy) {
    const ns = Math.min(6, Math.max(fitS * 0.7, s * f)), k = ns / s;
    setView(ns, cx - (cx - tx) * k, cy - (cy - ty) * k);
  }
  function toMap(e) {
    const r = viewport.getBoundingClientRect();
    return [(e.clientX - r.left - tx) / s, (e.clientY - r.top - ty) / s];
  }
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  $("zoomIn").onclick = () => zoomAt(1.4, viewport.clientWidth / 2, viewport.clientHeight / 2);
  $("zoomOut").onclick = () => zoomAt(1 / 1.4, viewport.clientWidth / 2, viewport.clientHeight / 2);
  $("zoomFit").onclick = fit;
  window.addEventListener("resize", () => { const old = fitS; const vw = viewport.clientWidth, vh = viewport.clientHeight; fitS = Math.min(vw / W, vh / H); if (Math.abs(s - old) < 1e-6) fit(); else setView(s, tx, ty); });
  window.addEventListener("tabchange", e => { if (e.detail === "map") requestAnimationFrame(fit); });

  // ---------- выбор и легенда ----------
  let sel = null; // {col, id}
  function select(ent) {
    if (sel) {
      const o = sel;
      if (o.col === "markers" && els.markers[o.id]) els.markers[o.id].classList.remove("sel");
      if (o.col === "labels" && els.labels[o.id]) els.labels[o.id].classList.remove("selected-label");
      if (o.col === "cities" && els.cities[o.id]) els.cities[o.id].classList.remove("selected-label");
      if (o.col === "countries" && els.clabels[o.id]) els.clabels[o.id].classList.remove("selected-label");
    }
    sel = ent && state[ent.col][ent.id] ? { col: ent.col, id: ent.id } : null;
    refreshSelection();
  }
  function refreshSelection() {
    if (sel) {
      if (sel.col === "markers" && els.markers[sel.id]) els.markers[sel.id].classList.add("sel");
      if (sel.col === "labels" && els.labels[sel.id]) els.labels[sel.id].classList.add("selected-label");
      if (sel.col === "cities" && els.cities[sel.id]) els.cities[sel.id].classList.add("selected-label");
      if (sel.col === "countries" && els.clabels[sel.id]) els.clabels[sel.id].classList.add("selected-label");
    }
    updateLegend();
    drawEditOverlay();
  }
  const nameInp = $("countryName"), colorInp = $("countryColor"), flagImg = $("flagImg"), flagPh = $("flagPh");
  function updateLegend() {
    const c = sel && sel.col === "countries" ? state.countries[sel.id] : null;
    nameInp.disabled = colorInp.disabled = !c;
    $("flagClear").disabled = !(c && c.flag);
    if (document.activeElement !== nameInp) nameInp.value = c ? c.name : "";
    colorInp.value = c ? c.color : "#888888";
    if (c && c.flag) { flagImg.src = c.flag; flagImg.hidden = false; flagPh.hidden = true; }
    else { flagImg.hidden = true; flagImg.removeAttribute("src"); flagPh.hidden = false; }
    $("countryMeta").textContent = c ? (c.layer ? "Слой PSD: " + c.layer : "Новая территория") : "";
  }
  let nameBefore = null;
  nameInp.addEventListener("focus", () => { if (sel) nameBefore = clone(state.countries[sel.id]); });
  nameInp.addEventListener("input", () => { if (!sel) return; state.countries[sel.id].name = nameInp.value; render("countries", sel.id); });
  nameInp.addEventListener("change", () => {
    if (!sel || !nameBefore) return;
    const after = clone(state.countries[sel.id]); after.name = nameInp.value.trim() || nameBefore.name;
    if (after.name !== nameBefore.name) commit("countries", sel.id, nameBefore, after); else render("countries", sel.id);
    nameBefore = clone(state.countries[sel.id]);
  });
  nameInp.addEventListener("keydown", e => { if (e.key === "Enter") nameInp.blur(); e.stopPropagation(); });
  colorInp.addEventListener("change", () => {
    if (!sel) return; const b = state.countries[sel.id]; const a = clone(b); a.color = colorInp.value; commit("countries", sel.id, b, a);
  });
  $("flagBox").addEventListener("click", e => { if (!sel || sel.col !== "countries") { e.preventDefault(); toast("Сначала выберите страну на карте"); } });
  $("flagInput").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f || !sel || sel.col !== "countries") return;
    const id = sel.id;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 300 / img.width, 200 / img.height);
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        const b = state.countries[id]; const a = clone(b); a.flag = cv.toDataURL("image/png");
        commit("countries", id, b, a); toast("Флаг установлен");
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  });
  $("flagClear").addEventListener("click", () => {
    if (!sel) return; const b = state.countries[sel.id]; const a = clone(b); a.flag = null; commit("countries", sel.id, b, a);
  });
  // перетаскивание и сворачивание окна легенды
  (function () {
    const lg = $("legend"), head = $("legendHead");
    let d = null;
    head.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return;
      const r = lg.getBoundingClientRect(), pr = lg.offsetParent.getBoundingClientRect();
      d = { dx: e.clientX - r.left, dy: e.clientY - r.top, pr };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", e => {
      if (!d) return;
      const x = Math.max(0, Math.min(d.pr.width - lg.offsetWidth, e.clientX - d.pr.left - d.dx));
      const y = Math.max(0, Math.min(d.pr.height - 40, e.clientY - d.pr.top - d.dy));
      Object.assign(lg.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto" });
    });
    head.addEventListener("pointerup", () => (d = null));
    $("legendToggle").addEventListener("click", () => {
      lg.classList.toggle("collapsed"); $("legendToggle").textContent = lg.classList.contains("collapsed") ? "+" : "—";
    });
  })();

  // ---------- инструменты ----------
  let tool = "pan", markerType = "capital";
  const HINTS = {
    pan: "Перетаскивайте карту, колесо — масштаб. Клик по стране — легенда. Двойной клик по названию, городу или отметке — переименовать. Отметки и подписи можно перетаскивать.",
    edit: "Выберите страну или линию. Тяните вершины; клик по контуру — новая вершина; Alt+клик или правый клик по вершине — удалить.",
    territory: "Кликами ставьте точки новой территории. Двойной клик или Enter — завершить, Backspace — убрать точку, Esc — отмена.",
    border: "Кликами ставьте точки линии границы. Двойной клик или Enter — завершить, Backspace — убрать точку, Esc — отмена.",
    label: "Кликните по карте, чтобы добавить название.",
    marker: "Выберите тип отметки и кликните по карте.",
    erase: "Кликните по стране, подписи, городу, линии или отметке, чтобы удалить (Ctrl+Z — вернуть)."
  };
  function setTool(t) {
    if (ui.tilt && !["pan", "erase"].includes(t)) { toast("В 3D-наклоне редактирование выключено"); return; }
    tool = t; draft = null;
    document.querySelectorAll("#toolbar [data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
    viewport.className = "viewport tool-" + t + (ui.tilt ? " tilted" : "");
    $("markerPalette").classList.toggle("hidden", t !== "marker");
    $("hint").textContent = ui.tilt ? HINT_TILT : (HINTS[t] || "");
    drawEditOverlay();
  }
  document.querySelectorAll("#toolbar [data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));

  // ---------- 3D-наклон (режим просмотра: выбор, легенда, переименование, удаление) ----------
  const HINT_TILT = "3D-наклон: доступны просмотр, выбор страны, переименование двойным кликом и удаление. Для правки границ и рисования выключите наклон.";
  function setTilt(on) {
    ui.tilt = !!on;
    viewport.classList.toggle("tilted", ui.tilt);
    $("tiltToggle").checked = ui.tilt;
    document.querySelectorAll("#toolbar [data-tool]").forEach(b => { b.disabled = ui.tilt && !["pan", "erase"].includes(b.dataset.tool); });
    if (ui.tilt && !["pan", "erase"].includes(tool)) setTool("pan");
    else $("hint").textContent = ui.tilt ? HINT_TILT : (HINTS[tool] || "");
    saveUi();
  }
  $("tiltToggle").addEventListener("change", e => setTilt(e.target.checked));
  $("undoBtn").onclick = undo; $("redoBtn").onclick = redo;
  // палитра отметок
  (function () {
    const pal = $("markerPalette");
    MARKERS.forEach(m => {
      const b = document.createElement("button"); b.dataset.type = m.type;
      b.innerHTML = `<svg viewBox="-13 -13 26 26"><circle r="11" fill="rgba(9,14,36,.9)" stroke="${m.color}" stroke-width="1.6"/>` +
        `<g stroke="${m.color}" fill="${m.color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${m.icon.replace(/class="m-ico"/g, 'fill="none"').replace(/class="m-ico fill"/g, 'stroke="none"')}</g></svg><span>${m.name}</span>`;
      b.addEventListener("click", () => { markerType = m.type; pal.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b)); });
      if (m.type === markerType) b.classList.add("active");
      pal.append(b);
    });
  })();

  // ---------- рисование и редактирование ----------
  let draft = null; // {pts:[x,y,...], cursor:[x,y]}
  const editSvg = L.edit;
  editSvg.style.pointerEvents = "none";
  function editableRings(ent) {
    if (!ent) return null;
    const e = state[ent.col][ent.id]; if (!e) return null;
    if (ent.col === "countries") return { rings: e.rings, closed: true };
    if (ent.col === "borders") return { rings: [e.pts], closed: false };
    return null;
  }
  let handlesTimer = null;
  function scheduleHandles() { clearTimeout(handlesTimer); handlesTimer = setTimeout(drawEditOverlay, 90); }
  function drawEditOverlay() {
    editSvg.innerHTML = "";
    // контур выбранной страны
    if (sel && sel.col === "countries" && state.countries[sel.id]) {
      svgEl("path", { d: ringsToD(state.countries[sel.id].rings), style: "fill:none;stroke:#ff3fd0;stroke-width:2.5;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 4px #ff3fd0)" }, editSvg);
    }
    if (tool === "edit" && sel) {
      const er = editableRings(sel);
      if (er) {
        const outline = svgEl("path", { d: ringsToD(er.rings, er.closed), class: "edit-outline", style: "fill:none;stroke:transparent;stroke-width:12;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:copy" }, editSvg);
        outline.dataset.edit = "outline";
        // вершины — только в видимой области
        const vw = viewport.clientWidth, vh = viewport.clientHeight;
        const x0 = -tx / s - 20, y0 = -ty / s - 20, x1 = (vw - tx) / s + 20, y1 = (vh - ty) / s + 20;
        const r = 5 / s; let n = 0; const frag = document.createDocumentFragment();
        er.rings.forEach((ring, ri) => {
          for (let i = 0; i < ring.length; i += 2) {
            const x = ring[i], y = ring[i + 1];
            if (x < x0 || x > x1 || y < y0 || y > y1) continue;
            if (++n > 2500) return;
            const c = document.createElementNS(NS, "circle");
            c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", r); c.setAttribute("class", "vertex");
            c.dataset.r = ri; c.dataset.i = i;
            frag.appendChild(c);
          }
        });
        editSvg.appendChild(frag);
        if (n > 2500) $("hint").textContent = "Слишком много вершин на экране — приблизьте карту, чтобы редактировать границу.";
        else $("hint").textContent = HINTS.edit;
      }
    }
    if (draft && draft.pts.length) {
      const pts = draft.pts.concat(draft.cursor || []);
      svgEl("path", { d: ringsToD([pts], tool === "border" ? false : true), class: "draft" }, editSvg);
      for (let i = 0; i < draft.pts.length; i += 2) svgEl("circle", { cx: draft.pts[i], cy: draft.pts[i + 1], r: 4 / s, class: "vertex", style: "pointer-events:none" }, editSvg);
    }
  }
  function nearestSegment(rings, closed, p) {
    let best = null;
    rings.forEach((r, ri) => {
      const n = r.length / 2, last = closed ? n : n - 1;
      for (let k = 0; k < last; k++) {
        const ax = r[2 * k], ay = r[2 * k + 1], bx = r[(2 * k + 2) % r.length], by = r[(2 * k + 3) % r.length];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
        const qx = ax + t * dx, qy = ay + t * dy, d = (qx - p[0]) ** 2 + (qy - p[1]) ** 2;
        if (!best || d < best.d) best = { d, ri, k, qx, qy };
      }
    });
    return best;
  }
  function deleteVertex(ri, i) {
    const before = clone(state[sel.col][sel.id]);
    const after = clone(before);
    const ring = sel.col === "countries" ? after.rings[ri] : after.pts;
    const min = sel.col === "countries" ? 8 : 6;
    if (ring.length <= min) { toast("Нельзя удалить: слишком мало вершин"); return; }
    ring.splice(i, 2);
    commit(sel.col, sel.id, before, after);
  }
  function polyCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = pts.length; i < n; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[(i + 2) % n], y1 = pts[(i + 3) % n], f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) < 1e-6) return [pts[0], pts[1]];
    return [cx / (3 * a), cy / (3 * a)];
  }
  async function finishDraft() {
    if (!draft) return;
    const pts = draft.pts.map(v => Math.round(v * 10) / 10);
    if (tool === "territory") {
      if (pts.length < 6) { toast("Нужно минимум 3 точки"); return; }
      const name = await ask("Название новой территории", "Новая территория");
      if (!name) return;
      const id = "u" + Date.now().toString(36);
      const hue = Math.floor(Math.random() * 360);
      const color = hslHex(hue, 70, 62);
      const area = Math.abs(pts.reduce((acc, v, i) => (i % 2 ? acc : acc + pts[i] * pts[(i + 3) % pts.length] - pts[(i + 2) % pts.length] * pts[i + 1]), 0) / 2);
      commit("countries", id, null, { id, layer: "", name, color, rings: [pts], label: polyCentroid(pts).map(v => Math.round(v)), size: Math.round(autoSize(area / 4) * 10) / 10, flag: null });
      draft = null; select({ col: "countries", id });
    } else if (tool === "border") {
      if (pts.length < 4) { toast("Нужно минимум 2 точки"); return; }
      const id = "b" + Date.now().toString(36);
      commit("borders", id, null, { id, pts });
      draft = null;
    }
    drawEditOverlay();
  }
  function hslHex(h, sat, l) {
    sat /= 100; l /= 100;
    const f = n => { const k = (n + h / 30) % 12, a = sat * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
    return "#" + f(0) + f(8) + f(4);
  }

  function entOf(target) {
    const el = target && target.closest ? target.closest("[data-col]") : null;
    if (!el) return null;
    return { col: el.dataset.col, id: el.dataset.id, part: el.dataset.part || null };
  }
  async function rename(ent) {
    const e = state[ent.col][ent.id]; if (!e) return;
    const field = { countries: "name", cities: "name", labels: "text", markers: "title" }[ent.col];
    if (!field) return;
    const title = { countries: "Переименовать страну", cities: "Переименовать город", labels: "Изменить надпись", markers: "Название отметки" }[ent.col];
    const v = await ask(title, e[field]);
    if (!v || v === e[field]) return;
    const a = clone(e); a[field] = v; commit(ent.col, ent.id, e, a);
  }

  async function handleClick(ent, p, ev) {
    if (tool === "pan") { select(ent && ent.col !== "borders" ? ent : ent); return; }
    if (tool === "edit") { if (ent && (ent.col === "countries" || ent.col === "borders")) select(ent); return; }
    if (tool === "territory" || tool === "border") {
      if (!draft) draft = { pts: [] };
      draft.pts.push(p[0], p[1]); drawEditOverlay(); return;
    }
    if (tool === "label") {
      const text = await ask("Новое название", "");
      if (!text) return;
      const id = "l" + Date.now().toString(36);
      commit("labels", id, null, { id, text, x: Math.round(p[0]), y: Math.round(p[1]), size: 16 });
      return;
    }
    if (tool === "marker") {
      const mt = MT[markerType];
      const title = await ask("Название отметки («" + mt.name + "»)", mt.name);
      if (title === null) return;
      const id = "m" + Date.now().toString(36);
      commit("markers", id, null, { id, type: markerType, title, x: Math.round(p[0]), y: Math.round(p[1]) });
      return;
    }
    if (tool === "erase") {
      if (!ent) return;
      commit(ent.col, ent.id, state[ent.col][ent.id], null);
      toast("Удалено (Ctrl+Z — вернуть)");
    }
  }

  // ---------- указатель: сдвиг, клики, перетаскивание ----------
  const pointers = new Map();
  let drag = null, pinch = null, lastClick = { t: 0, key: "", x: 0, y: 0 };
  viewport.addEventListener("contextmenu", e => {
    const v = e.target.closest && e.target.closest(".vertex");
    e.preventDefault();
    if (v && tool === "edit" && sel) deleteVertex(+v.dataset.r, +v.dataset.i);
  });
  viewport.addEventListener("pointerdown", e => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s }; drag = null; return;
    }
    const p = toMap(e), t = e.target;
    const v = t.closest && t.closest(".vertex");
    if (tool === "edit" && sel && v && v.dataset.r != null && !draft) {
      if (e.altKey) { deleteVertex(+v.dataset.r, +v.dataset.i); return; }
      drag = { kind: "vertex", ri: +v.dataset.r, i: +v.dataset.i, before: clone(state[sel.col][sel.id]), el: v, moved: false };
      return;
    }
    if (tool === "edit" && sel && t.dataset && t.dataset.edit === "outline") {
      const er = editableRings(sel), ns = nearestSegment(er.rings, er.closed, p);
      if (ns) {
        const before = clone(state[sel.col][sel.id]);
        const ring = er.rings[ns.ri];
        ring.splice(2 * ns.k + 2, 0, Math.round(ns.qx * 10) / 10, Math.round(ns.qy * 10) / 10);
        render(sel.col, sel.id); drawEditOverlay();
        drag = { kind: "vertex", ri: ns.ri, i: 2 * ns.k + 2, before, el: null, moved: true };
      }
      return;
    }
    const ent = entOf(t);
    if (tool === "pan" && !ui.tilt && ent && (ent.col === "markers" || ent.col === "labels" || ent.col === "cities" || ent.part === "label")) {
      drag = { kind: "move", ent, sx: e.clientX, sy: e.clientY, p0: p, before: clone(state[ent.col][ent.id]), moved: false };
      return;
    }
    drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx, ty, moved: false, ent, p };
    if (ent && ent.col === "countries") ent.part = ent.part || null;
  });
  viewport.addEventListener("pointermove", e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], r = viewport.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((pinch.s * d / pinch.d) / s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (draft && !drag) { draft.cursor = toMap(e); drawEditOverlayLight(); }
    if (!drag) return;
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; viewport.classList.add("panning"); }
      if (drag.moved) setView(s, drag.tx + dx, drag.ty + dy);
    } else if (drag.kind === "vertex") {
      const p = toMap(e), en = state[sel.col][sel.id];
      const ring = sel.col === "countries" ? en.rings[drag.ri] : en.pts;
      ring[drag.i] = Math.round(p[0] * 10) / 10; ring[drag.i + 1] = Math.round(p[1] * 10) / 10;
      drag.moved = true;
      render(sel.col, sel.id);
      if (drag.el) { drag.el.setAttribute("cx", ring[drag.i]); drag.el.setAttribute("cy", ring[drag.i + 1]); }
      const hi = editSvg.firstChild; if (hi && sel.col === "countries") hi.setAttribute("d", ringsToD(en.rings));
    } else if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const p = toMap(e), dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1], en = state[drag.ent.col][drag.ent.id], b = drag.before;
      if (drag.ent.part === "label") en.label = [Math.round(b.label[0] + dx), Math.round(b.label[1] + dy)];
      else { en.x = Math.round((b.x + dx) * 10) / 10; en.y = Math.round((b.y + dy) * 10) / 10; }
      render(drag.ent.col, drag.ent.id);
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null; viewport.classList.remove("panning");
    if (!d) return;
    if (d.kind === "vertex") {
      if (d.moved) commit(sel.col, sel.id, d.before, state[sel.col][sel.id]);
      drawEditOverlay(); return;
    }
    if (d.kind === "move" && d.moved) { commit(d.ent.col, d.ent.id, d.before, state[d.ent.col][d.ent.id]); return; }
    if (e.type === "pointercancel") return;
    if (d.kind === "pan" && d.moved) return;
    const ent = d.ent ? { col: d.ent.col, id: d.ent.id, part: d.ent.part } : null;
    const p = d.p || toMap(e);
    const key = ent ? ent.col + ":" + ent.id : "none";
    const now = performance.now();
    const dbl = now - lastClick.t < 380 && lastClick.key === key && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
    lastClick = { t: dbl ? 0 : now, key, x: e.clientX, y: e.clientY };
    if (dbl) {
      if (tool === "territory" || tool === "border") { finishDraft(); return; }
      if ((tool === "pan" || tool === "edit") && ent) { rename(ent); return; }
      return;
    }
    handleClick(ent, p, e);
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);
  let lightRaf = 0;
  function drawEditOverlayLight() { if (lightRaf) return; lightRaf = requestAnimationFrame(() => { lightRaf = 0; drawEditOverlay(); }); }

  // ---------- клавиатура ----------
  window.addEventListener("keydown", e => {
    if (!$("page-map").classList.contains("active")) return;
    if (e.target.matches && e.target.matches("input, textarea")) return;
    if (!$("modal").classList.contains("hidden")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "я")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "н")) { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (draft) {
      if (e.key === "Enter") { finishDraft(); return; }
      if (e.key === "Escape") { draft = null; drawEditOverlay(); return; }
      if (e.key === "Backspace") { draft.pts.splice(-2, 2); if (!draft.pts.length) draft = null; drawEditOverlay(); e.preventDefault(); return; }
    }
    if (e.key === "Escape") { select(null); return; }
    if ((e.key === "Delete") && sel) { commit(sel.col, sel.id, state[sel.col][sel.id], null); return; }
    const map = { v: "pan", "м": "pan", e: "edit", "у": "edit", t: "territory", "е": "territory", b: "border", "и": "border", n: "label", "т": "label", m: "marker", "ь": "marker", d: "erase", "в": "erase" };
    if (map[k]) setTool(map[k]);
  });

  // ---------- экспорт / импорт / сброс ----------
  $("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify({ v: 1, data: state }, null, 0)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "khatum-map.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("importInput").addEventListener("change", e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    f.text().then(txt => {
      const j = JSON.parse(txt); if (!j || !j.data) throw new Error("bad");
      for (const c of COLS) {
        const next = j.data[c] || {};
        for (const id of Object.keys(state[c])) if (!next[id]) { delete state[c][id]; dirty[c].add(id); render(c, id); }
        for (const id in next) { state[c][id] = next[id]; dirty[c].add(id); render(c, id); }
      }
      undoStack.length = redoStack.length = 0; updUndo(); select(null); save(); toast("Карта импортирована");
    }).catch(() => toast("Не удалось прочитать файл"));
  });
  $("resetBtn").onclick = async () => {
    const v = await ask("Сбросить все правки карты? Введите «да» для подтверждения", "");
    if (!v || v.toLowerCase() !== "да") return;
    try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(UI_KEY); } catch (e) { /* */ }
    location.reload();
  };

  // ---------- старт ----------
  renderAll();
  updUndo();
  setTool("pan");
  setTilt(ui.tilt);
  requestAnimationFrame(fit);
  window.KGMap = { state, select, setTool, fit, get view() { return { s, tx, ty }; } };
})();
