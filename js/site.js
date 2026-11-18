// Содержимое и оформление сайта: тексты, картинки, разделы Вики (события, лор), галерея, фон и музыка.
// Данные — data/site.json. ГМ правит прямо на страницах (кнопка «✎ Правка» вверху), публикует кнопкой «⇪ Сайт».
// Разметка: [data-edit="ключ"] — текст с оформлением, [data-edit-text="ключ"] — простая надпись.
// Ключ «list:<список>:<id>:<поле>» — поле элемента списка (events, lore, gallery), остальные хранятся в texts.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const KG = window.KG, GH = window.KGGitHub;
  const toast = m => KG.toast(m), ask = (t, v, o) => KG.ask(t, v, o);
  const clone = o => JSON.parse(JSON.stringify(o));
  const DRAFT_KEY = "kg-site-draft";
  const uid = p => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
  const isGm = () => !!(window.KGMap && window.KGMap.gm);
  const SEL = "[data-edit],[data-edit-text]";

  const DEF_LORE = [
    { id: "ideologies", title: "Идеологии 23-го века", sub: "Во что верят и за что воюют", html: "", special: "ideologies" },
    { id: "corporations", title: "Корпорации", sub: "Кто владеет водой, орбитой и всем остальным", html: "", special: "corporations" },
    { id: "chronology", title: "Хронология", sub: "От Великого Потопа до наших дней", html: "", special: "chronology" },
    { id: "states", title: "Государства", sub: "Страны, союзы и территории на карте", html: "", special: "states" },
    { id: "regions", title: "Регионы", sub: "Старый Свет, Африка, Азия, Америка и Океания", html: "", special: "regions" },
    { id: "currencies", title: "Валюты", sub: "Деньги 2200 года и их курс к кредиту", html: "", special: "currencies" }
  ];
  // особые разделы (наполняются из механик); у разделов из старого site.json пометки может не быть — узнаём по id
  const specialOf = a => a.special || ((DEF_LORE.find(x => x.id === a.id) || {}).special || "");
  const defaults = () => ({
    v: 1, updated: null, texts: {},
    media: { bg: { type: "video", yt: "IisYtJGfVFU", img: "" }, music: { src: "video", yt: "", file: "", name: "" } },
    events: [], lore: clone(DEF_LORE), gallery: []
  });
  let site = defaults(), pub = null, config = null, editing = false, dirty = false, draftOffered = false;
  const orig = {}; // исходные тексты из разметки: ключ → html / текст

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = sanitize(v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
    return e;
  }

  // ---------- очистка HTML (только безопасные теги и атрибуты) ----------
  const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH"]);
  const KEEP = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "H2", "H3", "H4", "UL", "OL", "LI", "A", "IMG", "DIV", "SPAN", "SMALL", "SUP", "SUB",
    "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "NAV", "FIGURE", "FIGCAPTION", "HR", "CODE", "ARTICLE", "SECTION"]);
  const ATTR = new Set(["href", "src", "alt", "title", "class", "id", "target", "rel", "colspan", "rowspan"]);
  function clean(node) {
    for (const el of [...node.children]) {
      if (DROP.has(el.tagName)) { el.remove(); continue; }
      clean(el);
      if (!KEEP.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (!(ATTR.has(n) || n.startsWith("data-")) || n === "data-edit" || n === "data-edit-text") el.removeAttribute(a.name);
        else if ((n === "href" || n === "src") && !/^(https?:|data:image\/|data:audio\/|#|assets\/|data\/|mailto:|\.?\/)/i.test(a.value.trim())) el.removeAttribute(a.name);
      }
      if (el.tagName === "A" && /^https?:/i.test(el.getAttribute("href") || "")) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    }
  }
  function sanitize(html) {
    const t = document.createElement("template");
    t.innerHTML = String(html || "");
    clean(t.content);
    return t.innerHTML;
  }
  // HTML правленого блока: без служебных атрибутов и без содержимого живых списков механик
  function richHtml(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("[data-mech-list]").forEach(x => (x.innerHTML = ""));
    c.querySelectorAll("[contenteditable]").forEach(x => x.removeAttribute("contenteditable"));
    c.querySelectorAll(".editable").forEach(x => x.classList.remove("editable"));
    return sanitize(c.innerHTML).trim();
  }

  // ---------- значения по ключу ----------
  const LIST_RE = /^list:(\w+):([^:]+):(\w+)$/;
  // элемент списка по ключу; «evimg» — картинка события, id = «событие~картинка»
  function listItem(list, id) {
    if (list === "evimg") {
      const [e, i] = id.split("~"), ev = site.events.find(x => x.id === e);
      return ev && Array.isArray(ev.imgs) ? ev.imgs.find(x => x.id === i) : undefined;
    }
    return (site[list] || []).find(x => x.id === id);
  }
  function getVal(key) {
    const m = key.match(LIST_RE);
    if (m) { const it = listItem(m[1], m[2]); return it ? it[m[3]] : undefined; }
    return site.texts[key];
  }
  // надпись с учётом правки ГМа (для кнопок и карточек, которые сами не правятся, но показывают правленый текст)
  const tx = (key, def) => (site.texts[key] != null ? site.texts[key] : def);
  function setVal(key, v) {
    const m = key.match(LIST_RE);
    if (m) { const it = listItem(m[1], m[2]); if (!it || it[m[3]] === v) return; it[m[3]] = v; }
    else { if (site.texts[key] === v) return; if (v === orig[key]) delete site.texts[key]; else site.texts[key] = v; }
    markDirty();
  }

  // ---------- тексты страниц ----------
  function captureOrig(root) {
    (root || document).querySelectorAll(SEL).forEach(el => {
      const rich = el.hasAttribute("data-edit"), key = el.getAttribute(rich ? "data-edit" : "data-edit-text");
      if (!key.startsWith("list:") && !(key in orig)) orig[key] = rich ? el.innerHTML.trim() : el.textContent;
    });
  }
  // применить тексты из site.json (или вернуть исходные) к разметке
  function applyTexts(root) {
    captureOrig(root);
    let mechTouched = false;
    (root || document).querySelectorAll(SEL).forEach(el => {
      const rich = el.hasAttribute("data-edit"), key = el.getAttribute(rich ? "data-edit" : "data-edit-text");
      if (key.startsWith("list:") || el.contains(document.activeElement)) return;
      const v = site.texts[key];
      if (rich) {
        const want = v != null ? sanitize(v) : orig[key];
        if (richHtml(el) !== richHtml(h("div", { html: want }))) { el.innerHTML = want; if (el.querySelector("[data-mech-list]")) mechTouched = true; }
      } else {
        const want = v != null ? v : orig[key];
        if (el.textContent !== want) el.textContent = want;
      }
    });
    if (mechTouched && window.KGMech && window.KGMech.refreshArticle) window.KGMech.refreshArticle();
    (root || document).querySelectorAll("[data-edit-img]").forEach(paintSlot);
    refreshEditable();
  }

  // ---------- шапки 1280×720: внешний вид войск, флота, техники ----------
  // Картинка хранится в site.json → texts["img:<ключ>"]; при публикации сайта уходит файлом в assets/site/.
  // Посетитель видит шапку, только если картинка загружена; ГМ в режиме правки видит пустую рамку 16:9 и кнопки.
  const IMG_W = 1280, IMG_H = 720, imgKey = k => "img:" + k;
  // Картинка по умолчанию (assets/mech/*.svg, список — assets/mech/art.js) видна, пока ГМ не загрузил свою.
  // «✕» у картинки по умолчанию прячет её (значение "none"), «↺» возвращает.
  const ART = window.KGMechArt || { files: {} }, artFiles = ART.files || {};
  const defaultImg = key => (artFiles[key] ? artFiles[key] + "?v=" + ART.v : "");
  function paintSlot(el) {
    const key = el.getAttribute("data-edit-img"), own = site.texts[imgKey(key)], v = own === "none" ? "" : own || defaultImg(key);
    el.classList.toggle("has-img", !!v);
    el.classList.toggle("img-default", !!v && !own);
    el.classList.toggle("img-reset", !!own && !!defaultImg(key));
    el.style.backgroundImage = v ? 'url("' + String(v).replace(/"/g, "%22") + '")' : "";
  }
  // картинка → ровно 1280×720 (обрезка по центру, как background-size: cover)
  async function readCover(f) {
    const img = new Image(); img.src = await readDataUrl(f);
    await img.decode();
    const cv = document.createElement("canvas"); cv.width = IMG_W; cv.height = IMG_H;
    const k = Math.max(IMG_W / img.naturalWidth, IMG_H / img.naturalHeight), w = img.naturalWidth * k, hh = img.naturalHeight * k;
    cv.getContext("2d").drawImage(img, (IMG_W - w) / 2, (IMG_H - hh) / 2, w, hh);
    return cv.toDataURL("image/jpeg", 0.86);
  }
  async function uploadSlot(el) {
    if (!editing) return;
    const f = await pickFile("image/*"); if (!f) return;
    try { setVal(imgKey(el.getAttribute("data-edit-img")), await readCover(f)); paintSlot(el); }
    catch (e) { toast("Не удалось прочитать картинку: " + e.message); }
  }
  function imgSlot(key, label) {
    const el = h("div", { class: "img-slot", "data-edit-img": key, role: "img", "aria-label": label, title: editing ? "Шапка 1280×720: " + label : null },
      h("span", { class: "img-slot-ph" }, h("b", { text: "Шапка 1280 × 720" }), h("small", { text: label })),
      h("span", { class: "img-slot-tools edit-only" },
        h("button", { type: "button", class: "small-btn", text: "Картинка", title: "Загрузить картинку (обрежется до 1280×720)", onclick: e => { e.stopPropagation(); uploadSlot(el); } }),
        h("button", { type: "button", class: "small-btn img-back", text: "↺", title: "Вернуть рисунок по умолчанию", onclick: e => { e.stopPropagation(); setVal(imgKey(key), undefined); paintSlot(el); } }),
        h("button", { type: "button", class: "small-btn danger", text: "✕", title: "Убрать картинку", onclick: e => { e.stopPropagation(); setVal(imgKey(key), defaultImg(key) ? "none" : undefined); paintSlot(el); } })));
    el.addEventListener("click", () => { if (editing && !el.classList.contains("has-img")) uploadSlot(el); });
    paintSlot(el);
    return el;
  }

  // ---------- режим правки ----------
  function refreshEditable() {
    document.querySelectorAll(SEL).forEach(el => {
      const can = editing && !el.closest("button, a, select, label, .tabs");
      if (can) { if (el.getAttribute("contenteditable") !== "true") el.setAttribute("contenteditable", "true"); }
      else if (el.hasAttribute("contenteditable")) el.removeAttribute("contenteditable");
      el.classList.toggle("editable", can);
    });
    document.querySelectorAll("[data-mech-list]").forEach(el => (editing ? el.setAttribute("contenteditable", "false") : el.removeAttribute("contenteditable")));
  }
  function setEditing(on) {
    editing = !!on && isGm();
    document.body.classList.toggle("site-edit", editing);
    $("siteEditBtn").classList.toggle("active", editing);
    $("siteEditBtn").title = editing ? "Выключить правку страниц" : "Правка текстов, картинок и разделов прямо на страницах";
    refreshEditable();
    if (!editing) { if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); bar.classList.add("hidden"); }
    const t = $("sdEditToggle"); if (t) t.textContent = editing ? "Выключить правку страниц" : "Включить правку страниц";
    // механики (справочник, корпорации) переходят в режим правки вместе со страницами
    window.dispatchEvent(new CustomEvent("siteedit", { detail: editing }));
  }
  $("siteEditBtn").addEventListener("click", () => { setEditing(!editing); toast(editing ? "Правка страниц включена: щёлкните по любому тексту" : "Правка страниц выключена"); });
  function record(el) {
    const rich = el.hasAttribute("data-edit"), key = el.getAttribute(rich ? "data-edit" : "data-edit-text");
    setVal(key, rich ? richHtml(el) : el.textContent.replace(/\s*\n\s*/g, " "));
  }
  // описания карточек механик ([data-rule-desc]) — поля правил, их ведёт mech.js; статья вокруг них не считается правленой
  const ruleDesc = t => !!(t && t.closest && t.closest("[data-rule-desc]"));
  document.addEventListener("input", e => {
    if (!editing || !e.target.closest || ruleDesc(e.target)) return;
    const el = e.target.closest(SEL);
    if (el && el.isContentEditable) record(el);
  });
  // простые надписи — в одну строку; вставка — только текст
  document.addEventListener("keydown", e => {
    if (!editing || !e.target.closest) return;
    const el = e.target.closest("[data-edit-text]");
    if (el && el.isContentEditable && e.key === "Enter") { e.preventDefault(); el.blur(); }
  }, true);
  document.addEventListener("paste", e => {
    if (!editing || !e.target.closest || ruleDesc(e.target)) return;
    const el = e.target.closest(SEL);
    if (!el || !el.isContentEditable) return;
    const files = [...(e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
    e.preventDefault();
    if (files.length && el.hasAttribute("data-edit")) { insertImageFile(files[0]); return; }
    const text = e.clipboardData.getData("text/plain") || "";
    document.execCommand("insertText", false, el.hasAttribute("data-edit-text") ? text.replace(/\s+/g, " ") : text);
  });
  // ссылки в правленых блоках не уводят со страницы
  document.addEventListener("click", e => {
    if (!editing || !e.target.closest) return;
    const a = e.target.closest("a");
    if (a && a.closest("[contenteditable=true]")) e.preventDefault();
  }, true);

  // ---------- панель оформления текста ----------
  const RTE = [["B", "bold", "Жирный"], ["I", "italic", "Курсив"], ["H2", "h2", "Заголовок"], ["H3", "h3", "Подзаголовок"], ["¶", "p", "Обычный абзац"],
    ["•", "ul", "Список"], ["1.", "ol", "Нумерованный список"], ["ƒ", "formula", "Рамка (формула)"], ["🔗", "link", "Ссылка"], ["🖼", "img", "Картинка"], ["⌫", "clear", "Убрать оформление"]];
  const bar = h("div", { class: "rte-bar panel hidden", id: "rteBar" }, RTE.map(([t, c, title]) => h("button", { type: "button", title, "data-c": c, text: t })));
  document.body.append(bar);
  let rteEl = null;
  bar.addEventListener("mousedown", e => e.preventDefault()); // не терять выделение
  bar.addEventListener("click", e => { const b = e.target.closest("button"); if (b) rteCmd(b.dataset.c); });
  document.addEventListener("focusin", e => {
    const el = editing && e.target.closest && !ruleDesc(e.target) ? e.target.closest("[data-edit]") : null;
    rteEl = el && el.isContentEditable ? el : null;
    bar.classList.toggle("hidden", !rteEl);
  });
  document.addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest("[data-edit]")) { bar.classList.add("hidden"); } }, 150));
  const saveRange = () => { const s = getSelection(); return s.rangeCount ? s.getRangeAt(0).cloneRange() : null; };
  const restoreRange = r => { if (!r) return; const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  async function rteCmd(c) {
    const el = rteEl; if (!el) return;
    el.focus();
    if (c === "bold" || c === "italic") document.execCommand(c);
    else if (c === "h2" || c === "h3" || c === "p") document.execCommand("formatBlock", false, "<" + c + ">");
    else if (c === "ul") document.execCommand("insertUnorderedList");
    else if (c === "ol") document.execCommand("insertOrderedList");
    else if (c === "clear") { document.execCommand("removeFormat"); document.execCommand("formatBlock", false, "<p>"); }
    else if (c === "formula") {
      const s = getSelection(); let n = s.anchorNode; if (!n) return;
      n = n.nodeType === 1 ? n : n.parentElement;
      let blk = n.closest("p, div, h2, h3, li");
      if (!blk || blk === el || !el.contains(blk)) { document.execCommand("formatBlock", false, "<div>"); n = getSelection().anchorNode; n = n && (n.nodeType === 1 ? n : n.parentElement); blk = n && n.closest("div"); }
      if (blk && blk !== el && el.contains(blk)) blk.classList.toggle("formula");
    } else if (c === "link") {
      const r = saveRange();
      const url = await ask("Адрес ссылки", "https://", { note: "Сначала выделите текст. Пустое поле — убрать ссылку." });
      el.focus(); restoreRange(r);
      if (url && url !== "https://") document.execCommand("createLink", false, url.trim()); else if (url === null) return; else document.execCommand("unlink");
    } else if (c === "img") {
      const r = saveRange();
      const f = await pickFile("image/*");
      if (!f) return;
      el.focus(); restoreRange(r);
      await insertImageFile(f);
      return;
    }
    record(el);
  }
  async function insertImageFile(f) {
    const el = rteEl || (document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-edit]"));
    if (!el) return;
    const url = await readImage(f, 1600);
    document.execCommand("insertImage", false, url);
    record(el);
  }

  // ---------- файлы ----------
  function pickFile(accept, multiple) {
    return new Promise(res => {
      const inp = h("input", { type: "file", accept, multiple: multiple || null });
      inp.addEventListener("change", () => res(multiple ? [...inp.files] : inp.files[0] || null));
      inp.click();
    });
  }
  const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  // картинка → data URL, большие уменьшаются до maxSide по длинной стороне
  async function readImage(f, maxSide) {
    const url = await readDataUrl(f);
    if (/svg|gif/.test(f.type)) return url;
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch (e) { return url; }
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (k >= 1 && f.size < 900e3) return url;
    const cv = document.createElement("canvas"); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return f.type === "image/png" ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.86);
  }

  // ---------- иконки (спрайт в index.html: <symbol id="i-…">) ----------
  const NS = "http://www.w3.org/2000/svg";
  function icon(name) {
    const s = document.createElementNS(NS, "svg"), u = document.createElementNS(NS, "use");
    s.setAttribute("class", "ico-svg"); s.setAttribute("aria-hidden", "true"); u.setAttribute("href", "#i-" + name); s.append(u);
    return s;
  }
  const LORE_ICON = { ideologies: "ideologies", corporations: "corporations", chronology: "chronology", states: "states", regions: "regions", currencies: "currencies" };

  // ---------- обложки и баннеры Лора ----------
  // Картинка — texts["cover:<ключ>"] (при публикации уходит файлом в assets/site/), положение по вертикали —
  // texts["coverpos:<ключ>"], 0–100 % (0 — виден верх картинки). Одна картинка — и на карточке, и в баннере статьи.
  // Ключи: lore/<раздел>, region/<регион>, state/<статья о стране>, union/<союз>. Загружает и двигает ГМ в режиме правки.
  const coverOf = key => site.texts["cover:" + key] || "";
  const coverPosOf = key => { const v = parseFloat(site.texts["coverpos:" + key]); return isFinite(v) ? Math.max(0, Math.min(100, v)) : 50; };
  const cssUrl = s => "url('" + String(s).replace(/'/g, "%27") + "')";
  // картинка — прямо в background-image: относительный адрес в CSS-переменной считался бы от папки css/
  const coverStyle = key => (coverOf(key) ? "background-image:" + cssUrl(coverOf(key)) + ";background-position:50% " + coverPosOf(key) + "%" : null);
  const rerouteWiki = () => { if (KG.route.tab === "wiki") window.dispatchEvent(new CustomEvent("routechange", { detail: KG.route })); };
  async function uploadCover(key) {
    if (!editing) return;
    const f = await pickFile("image/*"); if (!f) return;
    // без обрезки: пропорции сохраняются, иначе в баннере нечего двигать
    try { setVal("cover:" + key, await readImage(f, 2000)); setVal("coverpos:" + key, undefined); rerouteWiki(); }
    catch (e) { toast("Не удалось прочитать картинку: " + e.message); }
  }
  async function removeCover(key) {
    if (!(await ask("Убрать обложку?", "", { confirm: true, note: "Карточка и баннер вернутся к неоновой сетке." }))) return;
    setVal("cover:" + key, undefined); setVal("coverpos:" + key, undefined); rerouteWiki();
  }
  // карточка с обложкой (раздел Лора, регион); count — число материалов внутри
  function coverCard(key, o) {
    const has = !!coverOf(key);
    return h("button", { type: "button", class: "ccard" + (has ? "" : " no-cover"), "data-cover": key, onclick: o.onclick },
      h("span", { class: "cover-img", style: coverStyle(key) }),
      has ? null : h("span", { class: "cover-ph" }, icon("image"), "Место под обложку"),
      o.count != null ? h("span", { class: "cnt", text: o.count }) : null,
      h("span", { class: "ct" }, h("b", null, o.icon ? icon(o.icon) : null, o.title), o.sub ? h("span", { text: o.sub }) : null));
  }
  // баннер статьи: обложка (или размытый флаг страны), кнопка «назад», заголовок и подпись — правятся на месте
  function hero(key, o) {
    const own = coverOf(key);
    const el = h("div", { class: "hero" + (own || o.flagCover ? "" : " no-cover") + (!own && o.flagCover ? " flag-cover" : ""), "data-hint": "Тяните картинку вверх или вниз" },
      h("span", { class: "cover-img", style: own ? coverStyle(key) : o.flagCover ? "background-image:" + cssUrl(o.flagCover) : null }),
      own ? null : h("span", { class: "cover-ph" }, icon("image"), "Место под баннер"),
      h("h2", { class: "hero-title" },
        o.back ? h("button", { type: "button", class: "back", title: "Назад", "aria-label": "Назад", onclick: () => KG.go(o.back) }, icon("back")) : null,
        o.flags || null,
        h("span", { "data-edit-text": o.titleKey || null, "data-placeholder": o.titlePh || "Название…", text: o.title || "" })),
      o.subKey ? h("div", { class: "hero-sub", "data-edit-text": o.subKey, "data-placeholder": "Подпись на карточке…", text: o.sub || "" })
        : o.sub ? h("div", { class: "hero-sub", text: o.sub }) : null);
    el.append(heroTools(el, key));
    return el;
  }
  // кнопки ГМа в баннере: «Обложка», «⇅ Положение» (сдвиг вверх-вниз мышью, пальцем или ↑ ↓), «✕»
  function heroTools(el, key) {
    const own = coverOf(key), box = h("div", { class: "hero-tools edit-only" });
    box.append(toolBtn("Обложка", own ? "Заменить картинку" : "Загрузить картинку: любая горизонтальная от 1280 px в ширину, без обрезки", () => uploadCover(key)));
    if (!own) return box;
    const cv = el.querySelector(".cover-img");
    let pos = coverPosOf(key), ar = 0, drag = null;
    const paint = () => { cv.style.backgroundPosition = "50% " + pos + "%"; };
    const save = () => setVal("coverpos:" + key, pos === 50 ? undefined : String(pos));
    const nudge = d => { pos = Math.max(0, Math.min(100, pos + d)); paint(); save(); };
    const up = toolBtn("↑", "Показать верх картинки", () => nudge(-10)), down = toolBtn("↓", "Показать низ картинки", () => nudge(10));
    up.classList.add("hidden"); down.classList.add("hidden");
    const mv = toolBtn("⇅ Положение", "Сдвинуть картинку вверх или вниз", async () => {
      const on = el.classList.toggle("moving");
      mv.classList.toggle("on", on); mv.textContent = on ? "Готово" : "⇅ Положение";
      up.classList.toggle("hidden", !on); down.classList.toggle("hidden", !on);
      if (on && !ar) { const im = new Image(); im.src = own; try { await im.decode(); ar = im.naturalHeight / im.naturalWidth; } catch (e) { ar = 9 / 16; } }
    });
    box.append(up, down, mv, toolBtn("✕", "Убрать обложку", () => removeCover(key), "danger"));
    el.addEventListener("pointerdown", e => {
      if (!editing || !el.classList.contains("moving") || e.target.closest("button, [contenteditable=true]")) return;
      const r = el.getBoundingClientRect(), over = r.width * (ar || 9 / 16) - r.height; // сколько картинки не влезло по высоте, px
      if (over <= 1) { el.dataset.hint = "Картинка уже видна целиком по высоте"; return; }
      drag = { y: e.clientY, pos, over };
      el.setPointerCapture(e.pointerId); el.classList.add("dragging"); e.preventDefault();
    });
    el.addEventListener("pointermove", e => {
      if (!drag) return;
      pos = Math.round(Math.max(0, Math.min(100, drag.pos - (e.clientY - drag.y) / drag.over * 100)) * 10) / 10; paint();
    });
    const end = () => { if (!drag) return; drag = null; el.classList.remove("dragging"); save(); };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    return box;
  }
  // число материалов в разделах Лора (для карточек и дерева Вики)
  let countsP = null;
  function loreCounts() {
    if (!countsP) countsP = Promise.all([KG.lore(), fetch("data/ideologies.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null), mapState()])
      .then(([L, I, st]) => ({ ideologies: I && Array.isArray(I.list) ? I.list.length : null, states: L.states.length, regions: regionsOf(L).length,
        currencies: Object.keys((st && st.currencies) || {}).length || null }));
    return countsP;
  }

  // ---------- Вики: события, лор ----------
  const WIKI = { events: "wikiEvents", lore: "wikiLore", mech: "wikiMech" };
  let wikiSub = "events";
  document.querySelectorAll("#wikiNav button").forEach(b => b.addEventListener("click", () => KG.go("wiki/" + b.dataset.wiki)));
  window.addEventListener("routechange", e => {
    const p = e.detail.parts;
    if (p[0] === "gallery") renderGallery();
    if (p[0] !== "wiki") return;
    if (!WIKI[p[1]]) { KG.go("wiki/" + wikiSub, true); return; }
    wikiSub = p[1];
    document.querySelectorAll("#wikiNav button").forEach(b => b.classList.toggle("active", b.dataset.wiki === wikiSub));
    for (const k in WIKI) $(WIKI[k]).classList.toggle("hidden", k !== wikiSub);
    if (wikiSub === "events") renderEvents();
    if (wikiSub === "lore") { if (p[2]) renderLoreArticle(p[2], p[3]); else renderLoreGrid(); }
  });
  const toolBtn = (text, title, onclick, cls) => h("button", { type: "button", class: "small-btn " + (cls || ""), text, title, onclick });
  function moveIn(list, item, d, redraw) {
    const i = list.indexOf(item), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, item); markDirty(); redraw();
  }
  async function removeFrom(list, item, what, redraw) {
    if (!(await ask("Удалить " + what + "?", "", { confirm: true, note: "Удаление попадёт на сайт после публикации." }))) return;
    list.splice(list.indexOf(item), 1); markDirty(); redraw();
  }

  function renderEvents() {
    const box = $("eventsList"); box.innerHTML = "";
    if (!site.events.length) box.append(h("p", { class: "empty", text: "Событий пока нет." }));
    for (const ev of site.events) {
      const k = f => "list:events:" + ev.id + ":" + f;
      box.append(h("article", { class: "event", id: "ev-" + ev.id },
        h("div", { class: "ev-head" },
          h("span", { class: "ev-date", "data-edit-text": k("date"), text: ev.date || "" }),
          h("h3", { "data-edit-text": k("title"), text: ev.title || "" }),
          h("span", { class: "card-tools edit-only" }, toolBtn("↑", "Выше", () => moveIn(site.events, ev, -1, renderEvents)), toolBtn("↓", "Ниже", () => moveIn(site.events, ev, 1, renderEvents)),
            toolBtn("✕", "Удалить событие", () => removeFrom(site.events, ev, "событие «" + (ev.title || "") + "»", renderEvents), "danger"))),
        h("div", { class: "rich ev-text", "data-edit": k("html"), "data-placeholder": "Текст события…", html: ev.html || "" }),
        eventGallery(ev)));
    }
    refreshEditable();
  }
  // картинки события: лента под текстом, клик — увеличение; ГМ добавляет, двигает, заменяет, удаляет, подписывает
  function eventGallery(ev) {
    const imgs = Array.isArray(ev.imgs) ? ev.imgs : [];
    const redraw = () => { markDirty(); renderEvents(); };
    const add = async () => {
      const fs = await pickFile("image/*", true);
      if (!fs || !fs.length) return;
      if (!Array.isArray(ev.imgs)) ev.imgs = [];
      for (const f of fs) ev.imgs.push({ id: uid("ei"), img: await readImage(f, 2200), cap: "" });
      redraw();
    };
    return h("div", { class: "ev-gallery" + (imgs.length ? "" : " no-imgs") },
      imgs.map(im => h("figure", { class: "ev-img" },
        h("img", { src: im.img, alt: im.cap || "", loading: "lazy", onclick: () => { if (!editing) showImage({ img: im.img, title: im.cap || "" }); } }),
        h("figcaption", { "data-edit-text": "list:evimg:" + ev.id + "~" + im.id + ":cap", "data-placeholder": "Подпись…", text: im.cap || "" }),
        h("div", { class: "card-tools edit-only" },
          toolBtn("←", "Левее", () => moveIn(ev.imgs, im, -1, renderEvents)), toolBtn("→", "Правее", () => moveIn(ev.imgs, im, 1, renderEvents)),
          toolBtn("⟳", "Заменить картинку", async () => { const f = await pickFile("image/*"); if (!f) return; im.img = await readImage(f, 2200); redraw(); }),
          toolBtn("✕", "Удалить картинку", () => removeFrom(ev.imgs, im, "картинку", renderEvents), "danger")))),
      h("div", { class: "ev-add edit-only" }, toolBtn("+ Картинка", "Добавить картинки к событию (можно несколько)", add)));
  }
  $("evAdd").addEventListener("click", () => {
    const t = window.KGMech && window.KGMech.turn;
    const ev = { id: uid("ev"), date: t ? (t.label || "Ход " + t.turn + ", " + t.year + " год") : new Date().toLocaleDateString("ru-RU"), title: "Новое событие", html: "" };
    site.events.unshift(ev); markDirty(); renderEvents();
    const el = document.querySelector('[data-edit="list:events:' + ev.id + ':html"]'); if (el) el.focus();
  });

  function renderLoreGrid() {
    $("loreHome").classList.remove("hidden"); $("loreArticle").classList.add("hidden");
    const grid = $("loreGrid"); grid.innerHTML = ""; grid.classList.add("cgrid");
    for (const a of site.lore) grid.append(h("div", { class: "lore-cell" },
      coverCard("lore/" + a.id, { title: a.title || "Без названия", sub: a.sub || "", icon: LORE_ICON[specialOf(a)] || "article", onclick: () => KG.go("wiki/lore/" + a.id) }),
      h("div", { class: "card-tools edit-only" }, toolBtn("←", "Левее", () => moveIn(site.lore, a, -1, renderLoreGrid)), toolBtn("→", "Правее", () => moveIn(site.lore, a, 1, renderLoreGrid)),
        toolBtn("🖼", coverOf("lore/" + a.id) ? "Заменить обложку" : "Загрузить обложку", () => uploadCover("lore/" + a.id)),
        specialOf(a) ? null : toolBtn("✕", "Удалить раздел", () => removeFrom(site.lore, a, "раздел «" + a.title + "»", renderLoreGrid), "danger"))));
    KG.stagger(grid);
    // счётчики: сколько материалов в разделе
    loreCounts().then(c => site.lore.forEach(a => {
      const n = c[specialOf(a)], card = grid.querySelector('[data-cover="lore/' + a.id + '"]');
      if (n == null || !card || card.querySelector(".cnt")) return;
      card.append(h("span", { class: "cnt", text: n, title: "Материалов: " + n }));
    }));
  }
  $("loreAdd").addEventListener("click", () => {
    const a = { id: uid("lore"), title: "Новый раздел", sub: "Подпись на карточке", html: "" };
    site.lore.push(a); markDirty(); KG.go("wiki/lore/" + a.id);
  });
  function renderLoreArticle(id, sub) {
    const a = site.lore.find(x => x.id === id);
    if (!a) { KG.go("wiki/lore", true); return; }
    $("loreHome").classList.add("hidden");
    const art = $("loreArticle"); art.classList.remove("hidden"); art.innerHTML = "";
    if (specialOf(a) === "states" && sub) { renderStatePage(art, sub); return; }
    if (specialOf(a) === "regions" && sub) { renderRegionPage(art, sub); return; }
    const k = f => "list:lore:" + a.id + ":" + f;
    art.append(hero("lore/" + a.id, { back: "wiki/lore", titleKey: k("title"), title: a.title || "", subKey: k("sub"), sub: a.sub || "" }),
      h("div", { class: "rich lore-text" + (specialOf(a) ? " special" : ""), "data-edit": k("html"), "data-placeholder": specialOf(a) ? "Вступление к разделу (необязательно)…" : "Раздел в разработке. Скоро здесь появятся статьи — а пока лор живёт в головах игроков и ГМа.", html: a.html || "" }));
    if (a.special === "corporations" && window.KGMech) {
      const body = h("div", { class: "lore-body" }); art.append(body);
      Promise.resolve(window.KGMech.renderCorpLore(body)).then(() => applyTexts(body));
    }
    if (specialOf(a) === "states") {
      const body = h("div", { class: "lore-body" }); art.append(body);
      renderStatesIndex(body);
    }
    if (specialOf(a) === "regions") {
      const body = h("div", { class: "lore-body" }); art.append(body);
      renderRegionsIndex(body);
    }
    if (specialOf(a) === "currencies") {
      const body = h("div", { class: "lore-body" }); art.append(body);
      renderCurrencies(body);
    }
    if (specialOf(a) === "chronology") {
      const body = h("div", { class: "lore-body chron" }); art.append(body);
      // текст хронологии — из data/lore.json; правка ГМа хранится в site.json и переживает пересборку лора
      KG.lore().then(L => { body.append(h("div", { class: "rich chron-text", "data-edit": "lore.chron.html", "data-label": "Лор: хронология", html: L.chronology || "" }),
        h("p", { class: "mech-note" }, h("span", { "data-edit-text": "lore.chron.note", text: "Летопись государств и союзов — в разделе " }), h("button", { class: "linkish", text: "«Государства»", onclick: () => KG.go("wiki/lore/states") }), "."));
        applyTexts(body); });
    }
    if (specialOf(a) === "ideologies" && window.KGMech) {
      const body = h("div", { class: "lore-body" }); art.append(body);
      Promise.resolve(window.KGMech.renderIdeoLore(body)).then(() => { applyTexts(body); refreshEditable(); });
    }
    refreshEditable();
  }

  // ---------- лор: государства и союзы (data/lore.json, собран из «Летописи мира 2200») ----------
  // Адреса: #wiki/lore/states — союзы и страны по регионам; #wiki/lore/states/<статья> — страна; #wiki/lore/states/<id союза> — союз.
  async function mapState() {
    const KM = window.KGMap;
    if (KM && KM.state) return KM.state;
    if (KM && KM.stateReady) { try { await KM.stateReady(); } catch (e) { /* */ } }
    return (KM && KM.state) || { countries: {}, alliances: {} };
  }
  const oneLine = t => String(t || "").replace(/\s*\n\s*/g, " ");
  function flagOf(c) {
    const src = c && c.flag;
    return h("span", { class: "ls-flag", style: src ? "background-image:url('" + String(src).replace(/'/g, "%27") + "')" : "", title: c ? oneLine(c.name) : "" });
  }
  // ключи правок ГМа для статей лора о государствах и союзах (тексты — data/lore.json, правки — site.json → texts)
  const stateKey = (s, f) => "lore.state." + s.id + "." + f, unionKey = (u, f) => "lore.union." + u.id + "." + f;
  async function renderStatesIndex(body) {
    const [L, st] = await Promise.all([KG.lore(), mapState()]);
    const C = st.countries || {}, AL = st.alliances || {};
    if (!L.states.length) { body.append(h("p", { class: "empty", text: "Статьи о государствах ещё не загружены." })); return; }
    const q = h("input", { type: "search", class: "ls-search", placeholder: "Найти страну, союз или лидера…" });
    body.append(h("p", { class: "mech-note", "data-edit-text": "lore.states.note", text: L.states.length + " статей о государствах и " + L.unions.length + " союзов. Нажмите страну, чтобы прочесть о ней, или «на карте», чтобы увидеть её границы." }), q);
    const cards = [];
    // союзы (названия на карточках — с правками ГМа со страниц союзов)
    const ug = h("div", { class: "ls-unions" });
    for (const u of L.unions) {
      const al = AL[u.id] || {}, mem = Object.keys(C).filter(id => C[id].alliance === u.id);
      const name = tx(unionKey(u, "name"), u.name), members = tx(unionKey(u, "members"), u.members);
      const card = h("button", { class: "ls-union", "data-union": u.id, onclick: () => KG.go("wiki/lore/states/" + u.id) },
        h("b", null, h("span", { class: "sc-swatch", style: "background:" + (al.color || "transparent") }), name),
        h("span", { class: "ls-flags" }, mem.map(id => flagOf(C[id]))), h("small", { text: members }));
      card.dataset.q = (name + " " + members).toLowerCase(); cards.push(card); ug.append(card);
    }
    body.append(h("h3", { class: "ls-h", "data-edit-text": "lore.states.h.unions", text: "Союзы" }), ug);
    // государства по регионам
    for (const r of L.regions) {
      const list = L.states.filter(s => s.region === r.id);
      if (!list.length) continue;
      const g = h("div", { class: "ls-grid" });
      for (const s of list) { const card = stateCard(s, C, AL); cards.push(card); g.append(card); }
      body.append(h("h3", { class: "ls-h", "data-edit-text": "lore.states.region." + r.id, text: r.title }), g);
    }
    applyTexts(body);
    q.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase();
      cards.forEach(c => c.classList.toggle("hidden", !!v && !c.dataset.q.includes(v)));
      body.querySelectorAll(".ls-h").forEach(hh => { const n = hh.nextElementSibling; hh.classList.toggle("hidden", !!n && ![...n.children].some(c => !c.classList.contains("hidden"))); });
    });
  }
  function stateCard(s, C, AL) {
    const al = (C[s.map[0]] || {}).alliance, un = al && AL[al] ? AL[al].name : "";
    const title = tx(stateKey(s, "title"), s.title);
    const card = h("button", { class: "ls-state", "data-state": s.id, onclick: () => KG.go("wiki/lore/states/" + s.id) },
      h("span", { class: "ls-flags" }, s.map.map(id => flagOf(C[id]))),
      h("span", { class: "ls-name" }, h("b", { text: title }), h("small", { text: [s.passport["Лидер"] || s.passport["Власть"] || s.passport["Лидеры"] || "", un].filter(Boolean).join(" · ") })));
    card.dataset.q = (title + " " + Object.values(s.passport).join(" ")).toLowerCase();
    return card;
  }

  // ---------- лор: регионы мира ----------
  // Адреса: #wiki/lore/regions — карточки регионов; #wiki/lore/regions/<регион> — страница региона.
  // Регионы — как в «Государствах» (data/lore.json → regions, без «Держав»); державы стоят в своём регионе по полю geo.
  // Старый Свет (Европа) и Африка — механика регионов из Механик (угроза союзов, договор, резолюции, у Африки ещё треки);
  // у остальных регионов пока заглушка, которую ГМ правит на странице.
  const REGION_TITLE = { eu: "Старый Свет (Европа)" };
  const REGION_SUB = { eu: "Бесчестье союзов, Бернский договор и резолюции", af: "Угроза союзов, Яундский компромисс, Разлом, Нил и пустыня", na: "Накопление, Денверский пакт, Хартия дистриктов и резолюции",
    as: "Азиатский Дракон, Сибирский Медведь и Бенгальский Тигр", me: "Угроза держав, Мекканское перемирие, жажда и спор за святыни" };
  const MECH_REGION = { eu: true, af: true, na: true, as: true, me: true };
  // земли без государства (lore.notStates), которые лежат в регионе
  const REGION_LANDS = { af: ["56", "59", "60", "145", "146"] };
  const REGION_STUB = "<p>Раздел заполняется по ходу кампании.</p>";
  const regionKey = (r, f) => "lore.region." + r.id + "." + f;
  const regionsOf = L => L.regions.filter(r => r.id !== "powers").map(r => ({ id: r.id, title: REGION_TITLE[r.id] || r.title }));
  const statesOf = (L, id) => L.states.filter(s => (s.geo || s.region) === id);
  async function renderRegionsIndex(body) {
    const L = await KG.lore();
    const g = h("div", { class: "lore-grid cgrid regions-grid" });
    for (const r of regionsOf(L)) {
      const n = statesOf(L, r.id).length;
      const card = coverCard("region/" + r.id, { title: tx(regionKey(r, "title"), r.title), icon: "regions", count: n, onclick: () => KG.go("wiki/lore/regions/" + r.id),
        sub: (REGION_SUB[r.id] ? REGION_SUB[r.id] + " · " : "") + n + " " + (n % 10 === 1 && n % 100 !== 11 ? "государство" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "государства" : "государств") });
      card.dataset.region = r.id;
      g.append(h("div", { class: "lore-cell" }, card, h("div", { class: "card-tools edit-only" },
        toolBtn("🖼", coverOf("region/" + r.id) ? "Заменить обложку" : "Загрузить обложку", () => uploadCover("region/" + r.id)))));
    }
    body.append(KG.stagger(g));
    applyTexts(body);
  }
  async function renderRegionPage(art, sub) {
    const [L, st] = await Promise.all([KG.lore(), mapState()]);
    const r = regionsOf(L).find(x => x.id === sub);
    if (!r) { KG.go("wiki/lore/regions", true); return; }
    const C = st.countries || {}, AL = st.alliances || {};
    art.append(hero("region/" + r.id, { back: "wiki/lore/regions", titleKey: regionKey(r, "title"), title: r.title, titlePh: "Название региона…" }),
      h("div", { class: "rich lore-text", "data-edit": regionKey(r, "html"), "data-placeholder": MECH_REGION[r.id] ? "Вступление к региону (необязательно)…" : "О регионе…",
        html: MECH_REGION[r.id] ? "" : REGION_STUB }));
    if (MECH_REGION[r.id] && window.KGMech) {
      const ow = h("div", { class: "lore-body region-ow" }); art.append(ow);
      Promise.resolve(window.KGMech.renderRegion(ow, r.id)).then(() => applyTexts(ow));
    }
    const list = statesOf(L, r.id);
    art.append(h("h3", { class: "ls-h", "data-edit-text": "lore.region.h.states", text: "Государства региона" }),
      list.length ? h("div", { class: "ls-grid" }, list.map(s => stateCard(s, C, AL))) : h("p", { class: "empty", text: "Статей о государствах этого региона пока нет." }));
    const lands = (REGION_LANDS[r.id] || []).filter(id => (L.notStates || {})[id] && C[id]);
    if (lands.length) art.append(h("p", { class: "mech-note region-lands" }, "Земли без государства: ",
      lands.map((id, i) => [i ? ", " : "", h("button", { class: "linkish", title: "Показать на карте", text: L.notStates[id], onclick: () => KG.showOnMap(id) })]).flat(),
      " — кочевые племена Сахары без армии и правительства."));
    applyTexts(art); refreshEditable();
  }

  async function renderStatePage(art, sub) {
    const [L, st] = await Promise.all([KG.lore(), mapState()]);
    const C = st.countries || {}, AL = st.alliances || {};
    const bigFlag = id => h("span", { class: "hero-flag", title: oneLine((C[id] || {}).name || ""), style: (C[id] || {}).flag ? "background-image:" + cssUrl(C[id].flag) : null });
    const onMap = id => h("button", { class: "small-btn ls-map", "data-country": id, title: "Открыть карту на этой стране", onclick: () => KG.showOnMap(id) }, flagOf(C[id]), " " + oneLine((C[id] || {}).name || id) + " на карте");
    const u = L.unions.find(x => x.id === sub);
    if (u) { // союз
      const al = AL[u.id] || {}, mem = Object.keys(C).filter(id => C[id].alliance === u.id).sort((a, b) => (String(al.leader) === b) - (String(al.leader) === a));
      const lead = al.leader != null ? C[String(al.leader)] : null;
      art.append(hero("union/" + u.id, { back: "wiki/lore/states", titleKey: unionKey(u, "name"), title: u.name, titlePh: "Название союза…",
          flags: h("span", { class: "sc-swatch", style: "background:" + (al.color || "transparent") }), flagCover: lead && lead.flag }),
        h("div", { class: "ls-passport", "data-edit-text": unionKey(u, "members"), "data-placeholder": "Состав союза…", text: u.members }),
        h("div", { class: "rich lore-body ls-text", "data-edit": unionKey(u, "html"), "data-placeholder": "Статья о союзе…", html: u.html }),
        h("h3", { class: "ls-h", "data-edit-text": "lore.union.h.members", text: "Страны союза" }),
        h("div", { class: "ls-grid" }, mem.map(id => { const s = L.byMap[id]; return h("button", { class: "ls-state", "data-state": s ? s.id : "", onclick: () => (s ? KG.go("wiki/lore/states/" + s.id) : KG.showOnMap(id)) },
          h("span", { class: "ls-flags" }, flagOf(C[id])), h("span", { class: "ls-name" }, h("b", { text: oneLine(C[id].name) }), h("small", { text: String(al.leader) === id ? "лидер союза" : "" }))); })),
        h("p", { class: "mech-note" }, h("span", { "data-edit-text": "lore.union.mechnote", text: "Союз в механиках: " }), h("button", { class: "linkish", text: "Механики → Союзы", onclick: () => KG.go("wiki/mech/blocs") }), "."));
      applyTexts(art); return;
    }
    const s = L.byId[sub];
    if (!s) { KG.go("wiki/lore/states", true); return; }
    const al = (C[s.map[0]] || {}).alliance, un = L.unions.find(x => x.id === al);
    const i = L.states.indexOf(s), prev = L.states[i - 1], next = L.states[i + 1];
    // паспорт, заголовок и статья правятся ГМом прямо на странице
    const pas = h("div", { class: "rich ls-passport", "data-edit": stateKey(s, "passport"), "data-placeholder": "Паспорт страны…" }, Object.entries(s.passport).map(([k, v]) => h("span", null, k + " ", h("b", { text: v }))));
    art.append(hero("state/" + s.id, { back: "wiki/lore/states", titleKey: stateKey(s, "title"), title: s.title,
        flags: h("span", { class: "hero-flags" }, s.map.map(bigFlag)), flagCover: (C[s.map[0]] || {}).flag }),
      h("div", { class: "ls-tools" }, s.map.map(onMap), un ? h("button", { class: "small-btn", "data-union": un.id, onclick: () => KG.go("wiki/lore/states/" + un.id) }, "Союз: " + tx(unionKey(un, "name"), un.name)) : null),
      h("div", { class: "lore-body ls-text" }, pas,
        h("div", { class: "rich", "data-edit": stateKey(s, "html"), "data-placeholder": "Статья о государстве…", html: s.html.replace(/<div class="passport">[\s\S]*?<\/div>/, "") })));
    art.append(h("div", { class: "ls-pager" }, prev ? h("button", { class: "small-btn", onclick: () => KG.go("wiki/lore/states/" + prev.id) }, "← " + tx(stateKey(prev, "title"), prev.title)) : h("span"),
      next ? h("button", { class: "small-btn", onclick: () => KG.go("wiki/lore/states/" + next.id) }, tx(stateKey(next, "title"), next.title) + " →") : h("span")));
    applyTexts(art);
    livePassport(art.querySelector(".ls-passport"), s);
  }
  // Паспорт статьи: население (города страны на карте + пустоши), язык и валюта (карточка страны на карте) —
  // всегда живые: перекрывают и текст летописи, и правку ГМа в паспорте.
  function livePassport(pas, s) {
    const KM = window.KGMap, st = KM && KM.state;
    if (!pas || !st || !KM.countryPop) return;
    const ids = (s.map || []).map(String).filter(id => st.countries[id]);
    if (!ids.length) return;
    const info = id => (st.countries[id] || {}).info || {}, uniq = a => [...new Set(a.filter(Boolean))];
    const total = ids.reduce((acc, id) => acc + KM.countryPop(id).total, 0);
    const langs = uniq(ids.map(id => info(id).lang)).join("; ");
    const curs = uniq(ids.map(id => info(id).cur)).map(k => (st.currencies || {})[k]).filter(Boolean).map(cu => KM.curText(cu)).join("; ");
    let after = setPass(pas, "Население", total ? "≈ " + KM.fmtMln(total) : "", null, "Сумма городов страны на карте и население пустошей");
    after = setPass(pas, "Язык", langs, after) || after;
    setPass(pas, "Валюта", curs, after);
  }
  function setPass(pas, key, val, after, title) {
    let span = [...pas.children].find(e => e.tagName === "SPAN" && e.firstChild && e.firstChild.nodeType === 3 && e.firstChild.textContent.trim() === key);
    if (!val) return span || null;
    if (!span) {
      span = h("span", null, key + " ", h("b"));
      if (after && after.parentNode === pas) after.after(span); else pas.append(span);
    }
    let b = span.querySelector("b"); if (!b) { b = h("b"); span.append(b); }
    b.textContent = val; span.classList.add("ls-live"); if (title) span.title = title;
    return span;
  }
  // ГМ поправил город, долю пустошей, язык или валюту на карте — обновляем открытую статью и справочник валют
  window.addEventListener("kg:cities", () => {
    const art = $("loreArticle"); if (!art || art.classList.contains("hidden")) return;
    const p = (KG.route && KG.route.parts) || [];
    if (p[0] !== "wiki" || p[1] !== "lore") return;
    const a = site.lore.find(x => x.id === p[2]);
    if (!a) return;
    if (specialOf(a) === "states" && p[3]) { KG.lore().then(L => { const s = L.byId[p[3]]; if (s) livePassport(art.querySelector(".ls-passport"), s); }); }
    if (specialOf(a) === "currencies") { const body = art.querySelector(".cur-body"); if (body && !body.contains(document.activeElement)) { body.innerHTML = ""; renderCurrencies(body, true); } }
  });

  // ---------- лор: валюты (map.json → currencies, валюта страны — info.cur в карточке страны на карте) ----------
  // Курс — справочный (сколько кредитов за 1 единицу), в расчётах механик не участвует. ГМ правит валюты прямо здесь:
  // это правка карты (Ctrl+Z на карте, публикуется кнопкой карты или вместе с механиками).
  async function renderCurrencies(body, inner) {
    const [L, st] = await Promise.all([KG.lore(), mapState()]);
    const KM = window.KGMap, gmOn = !!(KM && KM.gm), C = st.countries || {};
    const box = inner ? body : h("div", { class: "cur-body" });
    if (!inner) {
      body.append(h("p", { class: "mech-note", "data-edit-text": "lore.cur.note", text: "Все расчёты механик — ВВП, бюджеты, долги — ведутся в кредитах (кр.), расчётной единице мирового рынка. Курс валют к кредиту справочный: он показывает, сколько кредитов стоит одна единица, и в расчётах не участвует. Валюта страны указана в её карточке на карте." }), box);
      applyTexts(body);
    }
    const list = Object.values(st.currencies || {}).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, "ru"));
    const users = {};
    for (const id in C) { const k = ((C[id] || {}).info || {}).cur; if (k) (users[k] = users[k] || []).push(id); }
    const fmtRate = v => (+v).toLocaleString("ru-RU", { maximumFractionDigits: 4 });
    const stateBtn = id => { const s = L.byMap[id]; return h("button", { class: "ls-state cur-state", title: s ? "Статья о стране" : "Показать на карте", onclick: () => (s ? KG.go("wiki/lore/states/" + s.id) : KG.showOnMap(id)) },
      flagOf(C[id]), h("span", { text: oneLine(C[id].name) })); };
    const save = (cu, patch) => { const next = Object.assign({}, cu, patch); KM.setCurrency(cu.id, next); };
    const inp = (cu, f, type, cls) => h("input", { class: "sc-in " + (cls || ""), type: type || "text", value: cu[f] ?? "", step: type === "number" ? "any" : null, min: type === "number" ? 0 : null,
      onchange: e => { const v = type === "number" ? +e.target.value : e.target.value.trim(); if (type === "number" ? !(v > 0) : !v && f !== "note") { e.target.value = cu[f] ?? ""; return; } save(cu, { [f]: v }); } });
    const tbl = h("table", { class: "mt cur-table" }, h("thead", null, h("tr", null, ["Валюта", "Знак", "1 = кр.", "Где ходит", "О валюте"].map((t, i) => h("th", { class: i === 2 ? "num" : null, text: t })), gmOn ? h("th") : null)));
    const tb = h("tbody");
    for (const cu of list) {
      const us = (users[cu.id] || []).sort((a, b) => oneLine(C[a].name).localeCompare(oneLine(C[b].name), "ru"));
      tb.append(h("tr", { "data-cur": cu.id },
        h("td", null, gmOn ? inp(cu, "name") : h("b", { text: cu.name })),
        h("td", null, gmOn ? inp(cu, "sign", "text", "cur-sign") : cu.sign),
        h("td", { class: "num" }, gmOn ? inp(cu, "rate", "number", "cur-rate") : fmtRate(cu.rate)),
        h("td", { class: "cur-users" }, us.length ? us.map(stateBtn) : h("span", { class: "muted", text: "—" })),
        h("td", { class: "cur-note" }, gmOn ? h("textarea", { class: "sc-in", rows: 2, text: cu.note || "", onchange: e => save(cu, { note: e.target.value.trim() }) }) : (cu.note || "")),
        gmOn ? h("td", null, us.length || cu.id === "kr" ? null : h("button", { class: "small-btn danger", title: "Удалить валюту (ни одна страна её не использует)", text: "✕", onclick: () => KM.setCurrency(cu.id, null) })) : null));
    }
    tbl.append(tb);
    box.append(h("div", { class: "mt-scroll" }, tbl));
    if (gmOn) box.append(h("p", { class: "mech-note" }, h("button", { class: "small-btn", text: "+ Валюта", onclick: () => {
      const id = "c" + Date.now().toString(36);
      KM.setCurrency(id, { id, name: "Новая валюта", sign: "¤", rate: 1, note: "", order: list.length });
    } }), " Правки валют — это правки карты: отмена — Ctrl+Z на карте, публикация — кнопкой карты «Опубликовать» (или вместе с механиками). Валюту стране выбирают в её карточке на карте."));
  }

  // ---------- галерея ----------
  let lightbox = null;
  function showImage(it) {
    if (!lightbox) {
      lightbox = h("div", { class: "modal hidden lightbox", role: "dialog", "aria-label": "Просмотр картинки", onclick: () => KG.hideModal(lightbox) }, h("figure", null, h("img", { alt: "" }), h("figcaption")));
      document.body.append(lightbox);
      document.addEventListener("keydown", e => { if (e.key === "Escape") KG.hideModal(lightbox); });
    }
    lightbox.querySelector("img").src = it.img; lightbox.querySelector("figcaption").textContent = it.title || "";
    KG.showModal(lightbox);
  }
  function renderGallery() {
    const box = $("galGrid"); box.innerHTML = "";
    if (!site.gallery.length) box.append(h("p", { class: "empty", text: "Картинок пока нет." }));
    for (const it of site.gallery) box.append(h("figure", { class: "gal-item" },
      h("img", { src: it.img, alt: it.title || "", loading: "lazy", onclick: () => { if (!editing) showImage(it); } }),
      h("figcaption", { "data-edit-text": "list:gallery:" + it.id + ":title", text: it.title || "" }),
      h("div", { class: "card-tools edit-only" }, toolBtn("←", "Левее", () => moveIn(site.gallery, it, -1, renderGallery)), toolBtn("→", "Правее", () => moveIn(site.gallery, it, 1, renderGallery)),
        toolBtn("⟳", "Заменить картинку", async () => { const f = await pickFile("image/*"); if (!f) return; it.img = await readImage(f, 2200); markDirty(); renderGallery(); }),
        toolBtn("✕", "Удалить", () => removeFrom(site.gallery, it, "картинку", renderGallery), "danger"))));
    refreshEditable();
  }
  $("galAdd").addEventListener("click", async () => {
    const fs = await pickFile("image/*", true);
    if (!fs || !fs.length) return;
    for (const f of fs) site.gallery.push({ id: uid("img"), title: f.name.replace(/\.[^.]+$/, ""), img: await readImage(f, 2200) });
    markDirty(); renderGallery();
  });

  // ---------- Режим ГМа: калькулятор / оформление ----------
  // калькулятор переехал во вкладку Вики → Механики → «Калькулятор»; здесь — только переход к нему
  document.querySelectorAll("#gmModeNav button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.gmm === "calc") { KG.go("wiki/mech/calc"); return; }
    renderDesign();
  }));
  function renderDesign() {
    const box = $("siteDesign"); box.innerHTML = "";
    const M = site.media;
    const row = (label, ...ctl) => h("label", { class: "f-row sd-row" }, h("span", { text: label }), h("span", { class: "sd-ctl" }, ...ctl));
    // правка страниц
    box.append(h("section", { class: "mblock" }, h("h3", { text: "Правка страниц" }),
      h("p", { class: "mech-note", text: "Включите правку и щёлкните по любому тексту на любой странице: заголовки, вступления, статья механик, «О нас», подписи Солнечной системы. Для текста с оформлением появится панель: заголовки, списки, рамка, ссылка, картинка. В Вики и Галерее появятся кнопки «+», «✕» и стрелки: добавление, удаление и порядок разделов, событий и картинок. Отмена — Ctrl+Z в поле. Всё уходит на сайт кнопкой «Опубликовать сайт»." }),
      h("div", { class: "auth-btns" }, h("button", { class: "accent", id: "sdEditToggle", text: editing ? "Выключить правку страниц" : "Включить правку страниц", onclick: () => setEditing(!editing) }))));
    // фон
    const bgSel = h("select", null, [["video", "Видео YouTube"], ["image", "Картинка"], ["none", "Без фона"]].map(([v, t]) => h("option", { value: v, text: t })));
    bgSel.value = M.bg.type || "video";
    const bgYt = h("input", { type: "text", value: M.bg.yt || "", placeholder: "Ссылка на видео YouTube" });
    const bgImg = h("div", { class: "sd-media" }, M.bg.img ? h("img", { src: M.bg.img, alt: "Фон" }) : h("span", { class: "mech-note", text: "Картинка не выбрана" }),
      h("button", { type: "button", class: "small-btn", text: "Загрузить картинку", onclick: async () => { const f = await pickFile("image/*"); if (!f) return; M.bg.img = await readImage(f, 2400); M.bg.type = "image"; mediaChanged(); renderDesign(); } }));
    bgSel.addEventListener("change", () => { M.bg.type = bgSel.value; mediaChanged(); renderDesign(); });
    bgYt.addEventListener("change", () => { const id = KG.ytId(bgYt.value); if (bgYt.value && !id) { toast("Не похоже на ссылку YouTube"); return; } M.bg.yt = id; mediaChanged(); });
    box.append(h("section", { class: "mblock" }, h("h3", { text: "Фон сайта" }), row("Фон", bgSel),
      M.bg.type === "video" ? row("Видео", bgYt) : null, M.bg.type === "image" ? row("Картинка", bgImg) : null));
    // музыка
    const muSel = h("select", null, [["video", "Звук фонового видео"], ["yt", "Другое видео YouTube"], ["file", "Свой файл (mp3, ogg)"], ["none", "Без музыки"]].map(([v, t]) => h("option", { value: v, text: t })));
    muSel.value = M.music.src || "video";
    muSel.addEventListener("change", () => { M.music.src = muSel.value; mediaChanged(); renderDesign(); });
    const muYt = h("input", { type: "text", value: M.music.yt || "", placeholder: "Ссылка на видео YouTube" });
    muYt.addEventListener("change", () => { const id = KG.ytId(muYt.value); if (muYt.value && !id) { toast("Не похоже на ссылку YouTube"); return; } M.music.yt = id; mediaChanged(); });
    const muFile = h("div", { class: "sd-media" }, M.music.file ? h("audio", { src: M.music.file, controls: true, preload: "none" }) : h("span", { class: "mech-note", text: "Файл не выбран" }),
      M.music.name ? h("small", { class: "mech-note", text: M.music.name }) : null,
      h("button", { type: "button", class: "small-btn", text: "Загрузить файл", onclick: async () => {
        const f = await pickFile("audio/*"); if (!f) return;
        if (f.size > 20e6) { toast("Файл больше 20 МБ — GitHub его не примет, возьмите поменьше"); return; }
        M.music.file = await readDataUrl(f); M.music.name = f.name; M.music.src = "file"; mediaChanged(); renderDesign();
      } }));
    box.append(h("section", { class: "mblock" }, h("h3", { text: "Музыка" }), row("Источник", muSel),
      M.music.src === "yt" ? row("Видео", muYt) : null, M.music.src === "file" ? row("Файл", muFile) : null,
      h("p", { class: "mech-note", text: "Посетитель включает звук кнопкой «Звук» вверху или первым кликом; громкость каждый выбирает сам." })));
    // все надписи
    captureOrig();
    const lab = h("div", { class: "sd-labels" });
    const seen = new Set();
    document.querySelectorAll("[data-edit-text][data-label]").forEach(el => {
      const key = el.getAttribute("data-edit-text"); if (seen.has(key)) return; seen.add(key);
      const inp = h("input", { type: "text", value: site.texts[key] != null ? site.texts[key] : orig[key] });
      inp.addEventListener("input", () => { setVal(key, inp.value); document.querySelectorAll('[data-edit-text="' + key + '"]').forEach(x => (x.textContent = inp.value)); });
      lab.append(h("label", { class: "f-row sd-row" }, h("span", { text: el.getAttribute("data-label") }), h("span", { class: "sd-ctl" }, inp,
        site.texts[key] != null ? h("button", { type: "button", class: "small-btn", text: "↺", title: "Вернуть исходный текст", onclick: () => { delete site.texts[key]; markDirty(); applyTexts(); renderDesign(); } }) : null)));
    });
    box.append(h("section", { class: "mblock" }, h("h3", { text: "Надписи и кнопки" }),
      h("p", { class: "mech-note", text: "Вкладки, кнопки Вики, заголовки страниц. Длинные тексты правятся прямо на страницах." }), lab));
    // публикация
    box.append(h("section", { class: "mblock" }, h("h3", { text: "Публикация" }),
      h("p", { class: "mech-note", text: dirty ? "Есть неопубликованные правки сайта." : "Неопубликованных правок нет." }),
      h("div", { class: "auth-btns" }, h("button", { class: "accent", text: "Опубликовать сайт", onclick: publish }),
        h("button", { text: "Отменить неопубликованное", disabled: !dirty || null, onclick: revert }))));
  }
  function mediaChanged() { KG.setMedia(site.media); markDirty(); }

  // ---------- черновик, публикация ----------
  let draftTimer = null;
  function markDirty() {
    dirty = true; $("siteDirty").classList.remove("hidden");
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 800);
  }
  function saveDraft() {
    const d = { base: pub ? pub.updated : null, time: Date.now(), site };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }
    catch (e) {
      // слишком много картинок или музыка: сохраняем без тяжёлых файлов
      const light = JSON.stringify(d).replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{300000,}/g, "");
      try { localStorage.setItem(DRAFT_KEY, light); toast("Черновик сохранён без больших файлов — опубликуйте, чтобы их не потерять"); }
      catch (x) { toast("Не удалось сохранить черновик сайта в браузере"); }
    }
  }
  async function offerDraft() {
    if (draftOffered) return;
    draftOffered = true;
    let d = null; try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { /* */ }
    if (!d || !d.site) return;
    const note = "Черновик от " + new Date(d.time).toLocaleString("ru-RU") + (d.base === (pub && pub.updated) ? "." : ". Он сделан для более старой версии сайта: опубликованное с тех пор будет перезаписано.");
    if (!(await ask("Восстановить неопубликованный черновик сайта?", "", { confirm: true, note }))) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ } return; }
    site = normalize(d.site); dirty = true; $("siteDirty").classList.remove("hidden");
    applyAll();
    toast("Черновик сайта восстановлен");
  }
  async function revert() {
    if (!(await ask("Отменить все неопубликованные правки сайта?", "", { confirm: true }))) return;
    site = normalize(pub ? clone(pub) : defaults()); dirty = false; $("siteDirty").classList.add("hidden");
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ }
    applyAll(); renderDesign();
  }
  async function ensureToken() {
    if (GH.token()) return true;
    const t = await ask("Токен GitHub для публикации", "", { password: true, note: "Fine-grained token с правом Contents: Read and write только для репозитория " + config.repo.owner + "/" + config.repo.name + ". Хранится только в этом браузере." });
    if (!t) return false;
    GH.setToken(t);
    try { await GH.check(config.repo); toast("GitHub подключён"); return true; }
    catch (e) { GH.setToken(""); toast(e.message); return false; }
  }
  const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/ogg": "ogg",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/webm": "webm", "audio/flac": "flac" };
  // встроенные файлы (data URL) → отдельные файлы assets/site/<хэш>.<расширение>
  async function extractFiles(obj, files) {
    const known = {};
    const fix = async str => {
      const re = /data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)/g;
      let out = "", last = 0, m;
      while ((m = re.exec(str))) {
        out += str.slice(last, m.index); last = re.lastIndex;
        const ext = EXT[m[1]];
        if (!ext) { out += m[0]; continue; }
        if (!known[m[0]]) {
          const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
          known[m[0]] = "assets/site/" + hash + "." + ext;
          files.push({ path: known[m[0]], content: bytes });
        }
        out += known[m[0]];
      }
      return out + str.slice(last);
    };
    const walk = async o => {
      for (const k in o) {
        if (typeof o[k] === "string" && o[k].includes("data:")) o[k] = await fix(o[k]);
        else if (o[k] && typeof o[k] === "object") await walk(o[k]);
      }
    };
    await walk(obj);
  }
  async function publish() {
    if (!isGm()) return;
    if (!config) { toast("Конфигурация сайта ещё не загружена"); return; }
    if (!(await ensureToken())) return;
    const btn = $("sitePublishBtn"); btn.disabled = true;
    try {
      const out = clone(site); out.updated = new Date().toISOString();
      const files = [];
      await extractFiles(out, files);
      files.push({ path: "data/site.json", content: JSON.stringify(out, null, 1) });
      await GH.commit(config.repo, files, "Сайт: правки ГМа " + new Date().toLocaleString("ru-RU"), m => toast(m));
      pub = clone(out);
      site.updated = out.updated; // на странице остаются встроенные копии файлов, пока GitHub Pages обновляется
      dirty = false; $("siteDirty").classList.add("hidden");
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* */ }
      if (!$("siteDesign").classList.contains("hidden")) renderDesign();
      toast("Сайт опубликован (" + files.length + " файл.). Посетители увидят изменения примерно через минуту.");
    } catch (e) { toast("Не удалось опубликовать сайт: " + e.message); console.error(e); }
    finally { btn.disabled = false; }
  }
  $("sitePublishBtn").addEventListener("click", publish);
  window.addEventListener("beforeunload", e => { if (dirty && isGm()) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- загрузка ----------
  function normalize(s) {
    const d = defaults();
    s = s && typeof s === "object" ? s : {};
    const out = Object.assign(d, s);
    out.texts = s.texts && typeof s.texts === "object" ? s.texts : {};
    out.media = { bg: Object.assign(d.media.bg, (s.media || {}).bg || {}), music: Object.assign(d.media.music, (s.media || {}).music || {}) };
    for (const k of ["events", "lore", "gallery"]) out[k] = Array.isArray(s[k]) ? s[k] : d[k];
    for (const a of DEF_LORE) if (a.special && !out.lore.some(x => x.id === a.id)) out.lore.push(clone(a));
    return out;
  }
  function applyAll() {
    applyTexts();
    KG.setMedia(site.media);
    renderLoreGrid();
    const r = KG.route;
    if (r.tab === "wiki") window.dispatchEvent(new CustomEvent("routechange", { detail: r }));
    renderGallery(); renderEvents();
  }
  captureOrig(); // исходные тексты разметки — до любых подстановок
  async function load() {
    const get = u => fetch(u, { cache: "no-cache" }).then(r => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(u + ": " + r.status))));
    try {
      const [cfg, sj] = await Promise.all([get("data/config.json"), get("data/site.json").catch(() => null)]);
      config = cfg; pub = sj; site = normalize(sj ? clone(sj) : null);
    } catch (e) { console.error(e); }
    applyAll();
    if (isGm()) { offerDraft(); renderDesign(); }
  }
  window.addEventListener("gmchange", e => {
    if (!e.detail) { setEditing(false); return; }
    offerDraft(); renderDesign();
  });
  load();

  window.KGSite = { get data() { return site; }, applyTexts, sanitize, setEditing, get editing() { return editing; }, publish, imgSlot, IMG_W, IMG_H,
    // для дерева Вики и поиска (js/wiki-nav.js)
    tx, icon, specialOf, loreCounts, LORE_ICON, regionsOf, statesOf, livePassport,
    names: { region: r => tx(regionKey(r, "title"), r.title), state: s => tx(stateKey(s, "title"), s.title), union: u => tx(unionKey(u, "name"), u.name) } };
})();
