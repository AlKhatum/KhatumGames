// Лор: «Цивилизационные векторы» (бывшие «Идеологии») и «Корпорации» — без калькулятора и правил ГМа.
// Подключается до js/site.js, которая вызывает KGLoreExtra.renderIdeoLore / renderCorpLore.
(function () {
  "use strict";
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  };
  const IDEO_POS = { top: [200, 46], "left-mid": [122, 182], "right-mid": [278, 182], left: [44, 318], "bottom-mid": [200, 318], right: [356, 318], center: [200, 228] };

  // тексты — из документа «Государство» (раздел «Цивилизационный вектор»)
  const VEC = {
    purity: { desc: "Консервативный путь. Человечество обязано сохранить свою исходную биологическую и культурную идентичность.", blame: "Разложение традиционных культурных и моральных устоев.", real: "Традиционализм, биоконсерватизм, национал-консерватизм: политика изоляции сакоку в Японии эпохи Токугава, Корея династии Чосон.", state: "Жёсткий запрет на генную модификацию людей, культурный протекционизм, строгие миграционные барьеры. Высокая сплочённость и лояльность общества, но медленнее заимствуются чужие технологии и слабее внешняя торговля." },
    harmony: { desc: "Экологический путь. Выживание возможно лишь в симбиозе с обновлённой природой: ради устойчивости допустимо менять и традиции, и человеческий геном.", blame: "Безудержная индустриализация и хищническое потребление ресурсов.", real: "Глубинная экология, экосоциализм, концепция «антироста», солярпанк: права природы в конституции Эквадора 2008 года.", state: "Промышленные квоты и лимиты выбросов, контроль рождаемости, генетическая адаптация граждан. Растут здоровье населения и продовольственная база, но сдерживается рост тяжёлой промышленности." },
    supremacy: { desc: "Материалистический путь. Абсолютный приоритет науки и технологического прогресса; всё, что не поддаётся рациональному объяснению, признаётся бесполезным.", blame: "Иррационализм, религиозные распри и отказ от научной логики.", real: "Технократия, позитивизм, сциентизм, государственный атеизм: Культ Разума во Франции 1793 года, научный атеизм в СССР.", state: "Правление экспертов, государственный атеизм, приоритетное финансирование науки. Максимальные темпы технологий и эффективная промышленность, но население лишено духовных ориентиров." },
    divinity: { desc: "Спиритуалистический путь. Вера в сакральность человеческого разума и души. В отличие от сторонников Чистоты, спокойно относится к модификации тела, считая его временным сосудом.", blame: "Слепой материализм, утрата веры и нравственных ориентиров.", real: "Теократия, религиозный спиритуализм, картезианский дуализм, христианская демократия: Папская область, Тибет до 1950 года, «валовое национальное счастье» Бутана.", state: "Высокое влияние духовенства на власть, религиозное образование, законы о морали. Биотехнологии и протезирование разрешены. Армия стойкая, но фундаментальная наука развивается крайне медленно." },
    voracity: { desc: "Акселерационистский путь. Чтобы выжить и доминировать, человечество должно ускорить собственную эволюцию любыми доступными средствами.", blame: "Чрезмерный консерватизм в вопросах генетики и культуры, помешавший вовремя адаптироваться к кризису.", real: "Акселерационизм, трансгуманизм, социал-дарвинизм, итальянский футуризм.", state: "Полная свобода биотехнологий, обязательная аугментация, жёсткая меритократия по принципу естественного отбора. Быстрый технологический рывок и превосходство солдат ценой хронического социального напряжения." },
    mastery: { desc: "Путь покорения среды. Вместо того чтобы подстраиваться под природу, человечество должно подчинить её своей воле и перестроить планету под свои нужды.", blame: "Хрупкость биосферы и неспособность старого мира взять её под полный контроль.", real: "Прометеизм, экомодернизм, масштабная геоинженерия: голландские польдеры, проект «Зелёная стена» в Китае, планы преобразования природы середины XX века.", state: "Ставка на мегапроекты: дамбы, управление климатом, ГМО-сельское хозяйство, терраформирование пустошей. Больше энергии и продовольствия, но мегапроекты поглощают значительную долю бюджета." },
    balance: { desc: "Прагматичный и нейтральный путь. Государство не признаёт абсолютной правоты ни одной из крайностей и берёт работающие решения у всех сторон.", blame: "Коллективная ответственность всего человечества.", real: "Политический прагматизм, центризм, плюрализм: нейтралитет Швейцарии, Движение неприсоединения.", state: "Нет жёстких идеологических запретов, свободная торговля со всеми державами. Но государству не хватает объединяющей идеи для сплочения общества и армии." }
  };
  const KIND = { purity: "вершина", harmony: "вершина", supremacy: "вершина", divinity: "гибрид Чистоты и Гармонии", voracity: "гибрид Превосходства и Гармонии", mastery: "гибрид Чистоты и Превосходства", balance: "центр схемы" };

  async function renderIdeoLore(el) {
    el.innerHTML = "";
    let lore = null, L = null;
    try { lore = await fetch("data/ideologies.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)); } catch (e) { lore = null; }
    try { L = await window.KG.lore(); } catch (e) { L = null; }
    if (!lore || !Array.isArray(lore.list)) { el.append(h("p", { class: "mech-note", text: "Не удалось загрузить описание векторов." })); return; }
    const list = lore.list, byId = {}; list.forEach(x => (byId[x.id] = x));
    const countries = id => (L ? L.states.filter(s => (s.passport || {}).Идеология === list.find(x => x.id === id).name) : []);
    const go = id => { const t = document.getElementById("ideo-" + id); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); };
    const icon = (x, cls) => h("img", { class: cls || "ideo-ico", src: "assets/ideology/" + x.id + ".png", alt: "", loading: "lazy" });

    el.append(h("div", { class: "rich", "data-edit": "lore.vec.intro", "data-label": "Векторы: вступление" }, h("p", { class: "lead", text: "Цивилизационный вектор — философский и идеологический курс общества: его отношение к технологиям, природе, генетике и причинам Великой ошибки. Три базовые вершины стоят в углах треугольника, три гибрида на его гранях (каждый — антагонист противоположной вершины), в центре — Равновесие." })));

    // схема-треугольник
    const P = id => IDEO_POS[(byId[id] || {}).pos] || [200, 228];
    const NS = "http://www.w3.org/2000/svg";
    const s = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); kids.forEach(k => e.append(k)); return e; };
    const tri = [IDEO_POS.top, IDEO_POS.left, IDEO_POS.right].map(p => p.join(",")).join(" ");
    const defs = s("defs", {}, s("clipPath", { id: "ideoTri" }, s("polygon", { points: tri })));
    const glow = ["purity", "supremacy", "harmony"].filter(id => byId[id]).map(id => {
      defs.append(s("radialGradient", { id: "ideoG-" + id }, s("stop", { offset: "0", "stop-color": byId[id].color, "stop-opacity": ".75" }), s("stop", { offset: "1", "stop-color": byId[id].color, "stop-opacity": "0" })));
      const [x, y] = P(id); return s("circle", { cx: x, cy: y, r: 240, fill: "url(#ideoG-" + id + ")" });
    });
    const svg = s("svg", { viewBox: "-24 0 448 380", class: "ideo-tri", role: "img", "aria-label": "Схема цивилизационных векторов: треугольник" }, defs,
      s("polygon", { points: tri, fill: "#0a1426" }), s("g", { "clip-path": "url(#ideoTri)" }, ...glow),
      ...(lore.axes || []).map(a => { const [x1, y1] = P(a.a), [x2, y2] = P(a.b); return s("line", { x1, y1, x2, y2, class: "ideo-axis" }); }),
      s("polygon", { points: tri, class: "ideo-edge" }));
    for (const x of list) {
      const [cx, cy] = P(x.id), big = x.pos === "center" ? 25 : 28;
      const g = s("g", { class: "ideo-node", tabindex: "0", role: "button", "aria-label": x.name },
        s("image", { href: "assets/ideology/" + x.id + ".png", x: cx - big, y: cy - big, width: big * 2, height: big * 2 }),
        s("text", { x: cx, y: cy + big + 18, "text-anchor": "middle", fill: x.color }, x.name));
      g.addEventListener("click", () => go(x.id));
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(x.id); } });
      svg.append(g);
    }
    const axes = h("div", { class: "ideo-axes" }, h("h3", { text: "Оси противостояния" }),
      (lore.axes || []).map(a => h("div", { class: "ideo-axis-row" },
        h("b", { text: a.name }), h("span", { class: "q", text: a.q }),
        h("div", { class: "pair" },
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.a].color, onclick: () => go(a.a) }, icon(byId[a.a], "ideo-chip-ico"), byId[a.a].name, h("small", { text: a.a_note })),
          h("span", { class: "vs", text: "↔" }),
          h("button", { class: "ideo-chip", style: "--c:" + byId[a.b].color, onclick: () => go(a.b) }, icon(byId[a.b], "ideo-chip-ico"), byId[a.b].name, h("small", { text: a.b_note }))))),
      h("p", { class: "mech-note", text: "Каждый гибрид противостоит вершине напротив." }));
    el.append(h("div", { class: "ideo-top" }, h("div", { class: "ideo-tri-wrap" }, svg), axes));

    // карточки
    const cards = h("div", { class: "ideo-cards" });
    for (const x of list) {
      const v = VEC[x.id] || x, cs = countries(x.id);
      cards.append(h("article", { class: "ideo-card", id: "ideo-" + x.id, style: "--c:" + x.color },
        h("header", null, icon(x), h("div", null, h("h3", { "data-edit-text": "lore.ideo." + x.id + ".name", text: x.name }),
          h("div", { class: "ideo-meta", text: [x.en, KIND[x.id], x.opposite ? "антагонист — " + byId[x.opposite].name : ""].filter(Boolean).join(" · ") }))),
        h("p", { class: "ideo-desc", "data-edit-text": "lore.ideo." + x.id + ".desc", text: v.desc }),
        h("dl", null, h("dt", { text: "Виновник Великой ошибки" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".blame", text: v.blame }), h("dt", { text: "Реальные аналоги" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".real", text: v.real }),
          h("dt", { text: "Влияние на государство" }), h("dd", { "data-edit-text": "lore.ideo." + x.id + ".state", text: v.state }),
          h("dt", { text: "Государства с этим вектором: " + cs.length }),
          h("dd", { class: "vec-states" }, cs.length ? cs.map((s, i) => [i ? ", " : "", h("a", { href: "#wiki/lore/states/" + s.id, text: String(s.title).replace(/\s*[—(].*$/, "") })]).flat() : "пока нет"))));
    }
    el.append(h("h2", { class: "ideo-h", text: "Семь векторов" }), cards,
      h("p", { class: "mech-note" }, "Как вектор связан с повестками и реформами — в разделе ", h("a", { href: "#wiki/mech/state/vector", text: "Механики → Государство" }), "."));
  }

  async function renderCorpLore(el) {
    el.innerHTML = "";
    let L = null; try { L = await window.KG.lore(); } catch (e) { L = null; }
    const corps = (L && L.corps) || [];
    el.append(h("div", { class: "rich", "data-edit": "lore.corp.intro", "data-label": "Корпорации: вступление" }, h("p", { class: "lead", text: "После Великой ошибки государства потеряли берега, столицы и казну. Корпорации потеряли меньше: их заводы стоят за стенами, а их товары нужны всем." }),
      h("p", null, "Корпорациями не управляет ни один игрок: ими ведает ГМ. Страна может с ними договариваться, воевать, пускать их на свою территорию или изгонять. Чем глубже корпорация вросла в страну, тем больше она даёт экономике и тем меньше у страны суверенитета. Правила госзаказов и контроля: ", h("a", { href: "#wiki/mech/economy/corps", text: "Механики → Экономика → Корпорации" }), ".")));
    const kidSet = new Set(corps.flatMap(c => c.kids || [])), byId = {}; corps.forEach(c => (byId[c.id] = c));
    const link = c => h("a", { href: "#wiki/lore/corporations/" + c.id, text: c.title });
    const top = corps.filter(c => !kidSet.has(c.id));
    const tbl = h("table", { class: "mt corp-list" }, h("thead", null, h("tr", null, ["Корпорация", "Отрасль", "Штаб-квартира", "Основана"].map(t => h("th", { text: t })))),
      h("tbody", null, top.map(c => {
        const p = c.passport || {}, kids = (c.kids || []).map(k => byId[k]).filter(Boolean);
        return h("tr", null,
          h("td", null, link(c), h("br"), h("small", { class: "sub", text: c.sub || "" }),
            kids.length ? h("details", { class: "corp-kids" }, h("summary", { text: "подразделения: " + kids.length }), h("ul", null, kids.map(k => h("li", null, link(k))))) : null),
          h("td", { class: "tag", text: p["Отрасль"] || "—" }), h("td", { class: "tag", text: p["Штаб-квартира"] || "—" }), h("td", { class: "tag", text: p["Основана"] || "—" }));
      })));
    el.append(h("div", { class: "mt-scroll" }, tbl));
  }

  window.KGLoreExtra = { renderIdeoLore, renderCorpLore };
})();
