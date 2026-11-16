// Общие вещи сайта: маршруты и вкладки, фон и музыка, всплывающие сообщения, диалог ввода.
(function () {
  "use strict";

  // ---------- маршруты ----------
  // Адрес: #вкладка/подраздел/…  Например #map/earth/globe, #wiki/lore/corporations, #wiki/mech/my.
  // Вкладка выбирается здесь, подразделы разбирают модули по событию «routechange» (detail: { tab, parts }).
  const TABS = ["home", "map", "wiki", "gallery", "about"];
  const ALIAS = { lore: "wiki/lore", mech: "wiki/mech", news: "wiki/events", events: "wiki/events" }; // старые ссылки
  const tabs = document.querySelectorAll("#tabs button");
  let route = { tab: "", parts: [] }, booted = false;
  function parse(h) {
    let parts = String(h || "").replace(/^#/, "").split("/").filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    if (parts[0] && ALIAS[parts[0]]) parts = ALIAS[parts[0]].split("/").concat(parts.slice(1));
    if (!TABS.includes(parts[0])) parts = ["home"];
    return parts;
  }
  const hashOf = parts => "#" + parts.map(encodeURIComponent).join("/");
  function applyRoute(parts) {
    const tab = parts[0], changed = tab !== route.tab;
    route = { tab, parts };
    tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll("main > .page").forEach(p => p.classList.toggle("active", p.id === "page-" + tab));
    if (!booted) return; // до загрузки всех модулей события не шлём
    if (changed) window.dispatchEvent(new CustomEvent("tabchange", { detail: tab }));
    window.dispatchEvent(new CustomEvent("routechange", { detail: route }));
  }
  // перейти по адресу; replace — без новой записи в истории (уточнение подраздела)
  function go(path, replace) {
    const parts = parse(path), h = hashOf(parts);
    if (location.hash === h) { applyRoute(parts); return; }
    if (replace) { history.replaceState(null, "", h); applyRoute(parts); }
    else location.hash = h;
  }
  const openTab = name => go(name);
  tabs.forEach(b => b.addEventListener("click", () => go(b.dataset.tab)));
  document.addEventListener("click", e => { const b = e.target.closest("[data-goto]"); if (b) go(b.dataset.goto); });
  window.addEventListener("hashchange", () => applyRoute(parse(location.hash)));
  applyRoute(parse(location.hash));
  // события маршрута — когда все скрипты подключены
  document.addEventListener("DOMContentLoaded", () => {
    booted = true;
    const p = route.parts; route = { tab: "", parts: [] };
    if (location.hash !== hashOf(p)) history.replaceState(null, "", hashOf(p));
    applyRoute(p);
  });

  // ---------- фон и музыка ----------
  // Фон: видео YouTube или картинка. Музыка: звук фонового видео, другое видео YouTube или свой файл (mp3/ogg).
  // Браузеры разрешают автозапуск только без звука, поэтому звук включается первым кликом или кнопкой «Звук».
  const yt = document.getElementById("yt");
  const bgBox = document.getElementById("bg-video");
  const soundBtn = document.getElementById("soundBtn");
  const DEF_YT = "IisYtJGfVFU";
  let soundOn = false;
  const ytSrc = id => "https://www.youtube.com/embed/" + id + "?autoplay=1&mute=1&loop=1&playlist=" + id + "&controls=0&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&iv_load_policy=3&disablekb=1";
  function ytCmd(frame, func, args) {
    try { frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*"); } catch (e) { /* ignore */ }
  }
  function ytPlayer(frame) {
    return { frame, on(v) { ytCmd(frame, "unMute"); ytCmd(frame, "setVolume", [v]); ytCmd(frame, "playVideo"); }, off() { ytCmd(frame, "mute"); }, vol(v) { ytCmd(frame, "setVolume", [v]); } };
  }
  function audioPlayer(a) {
    return { on(v) { a.volume = v / 100; a.muted = false; a.play().catch(() => {}); }, off() { a.muted = true; a.pause(); }, vol(v) { a.volume = v / 100; } };
  }
  const silent = { on() {}, off() {}, vol() {} };
  // ссылка или id видео YouTube → id
  function ytId(s) {
    s = String(s || "").trim();
    const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
    return m ? m[1] : /^[\w-]{11}$/.test(s) ? s : "";
  }
  const bgPlayer = ytPlayer(yt);
  let player = bgPlayer, musicFrame = null, audio = null;
  function setFrame(frame, id) { const src = id ? ytSrc(id) : "about:blank"; if (frame.getAttribute("src") !== src) frame.setAttribute("src", src); }
  // media: { bg: { type: "video" | "image" | "none", yt, img }, music: { src: "video" | "yt" | "file" | "none", yt, file } }
  function setMedia(media) {
    media = media || {};
    const bg = media.bg || {}, mu = media.music || {};
    const bgType = bg.type || "video", bgId = ytId(bg.yt) || DEF_YT;
    let src = mu.src || "video";
    if (src === "yt" && !ytId(mu.yt)) src = "video";
    if (src === "file" && !mu.file) src = "video";
    const old = player;
    // фоновое видео нужно, если оно фон или источник музыки
    setFrame(yt, bgType === "video" || src === "video" ? bgId : "");
    yt.classList.toggle("off", bgType !== "video");
    bgBox.style.backgroundImage = bgType === "image" && bg.img ? 'url("' + String(bg.img).replace(/"/g, "%22") + '")' : "";
    bgBox.classList.toggle("bg-image", bgType === "image");
    if (src === "yt") {
      if (!musicFrame) {
        musicFrame = document.createElement("iframe");
        musicFrame.className = "music-frame"; musicFrame.title = "Музыка"; musicFrame.tabIndex = -1;
        musicFrame.setAttribute("allow", "autoplay; encrypted-media");
        musicFrame.addEventListener("load", () => { if (soundOn && player.frame === musicFrame) player.on(volume); else ytCmd(musicFrame, "playVideo"); });
        document.body.append(musicFrame);
      }
      setFrame(musicFrame, ytId(mu.yt));
      player = player.frame === musicFrame ? player : ytPlayer(musicFrame);
    } else {
      if (musicFrame) setFrame(musicFrame, "");
      if (src === "file") {
        if (!audio) { audio = new Audio(); audio.loop = true; audio.preload = "auto"; }
        if (audio.getAttribute("src") !== mu.file) audio.setAttribute("src", mu.file);
        player = player.audio ? player : Object.assign(audioPlayer(audio), { audio: true });
      } else {
        if (audio) audio.pause();
        player = src === "none" ? silent : bgPlayer;
      }
    }
    if (old !== player) { old.off(); if (soundOn) player.on(volume); }
    if (player !== bgPlayer) bgPlayer.off(); // фоновое видео без звука, если музыка из другого источника
  }
  // громкость музыки (0–100) — ползунок рядом с кнопкой, запоминается в браузере
  const volEl = document.getElementById("volume");
  let volume = 60;
  try { const v = localStorage.getItem("kg-volume"); if (v != null && isFinite(+v)) volume = Math.max(0, Math.min(100, +v)); } catch (e) { /* */ }
  if (volEl) { volEl.value = volume; volEl.style.setProperty("--v", volume + "%"); }
  function setSound(on) {
    soundOn = on;
    if (on) { if (!volume) volume = 30; player.on(volume); } else player.off();
    soundBtn.classList.toggle("on", on);
    soundBtn.querySelector(".ico").textContent = on ? "🔊" : "🔇";
    if (volEl) { volEl.value = on ? volume : 0; volEl.style.setProperty("--v", (on ? volume : 0) + "%"); }
  }
  soundBtn.addEventListener("click", e => { e.stopPropagation(); setSound(!soundOn); });
  if (volEl) {
    ["pointerdown", "click", "keydown"].forEach(t => volEl.addEventListener(t, e => e.stopPropagation()));
    volEl.addEventListener("input", () => {
      const v = +volEl.value;
      firstGesture = false;
      volEl.style.setProperty("--v", v + "%");
      volEl.title = "Громкость: " + v + "%";
      if (v > 0) { volume = v; if (!soundOn) setSound(true); else player.vol(v); }
      else if (soundOn) setSound(false);
      try { localStorage.setItem("kg-volume", String(v > 0 ? v : volume)); } catch (e) { /* */ }
    });
  }
  let firstGesture = true;
  function onFirstGesture() {
    if (!firstGesture) return;
    firstGesture = false;
    setSound(true);
    window.removeEventListener("pointerdown", onFirstGesture, true);
    window.removeEventListener("keydown", onFirstGesture, true);
  }
  window.addEventListener("pointerdown", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);
  yt.addEventListener("load", () => { ytCmd(yt, "playVideo"); if (soundOn && player === bgPlayer) player.on(volume); });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- диалог ввода текста ----------
  // opts: { password } — поле пароля; { note } — пояснение; { confirm } — только кнопки;
  // { multiline } — многострочное поле: Shift+Enter переносит строку, Enter — OK
  function ask(title, value, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const m = document.getElementById("modal"), one = document.getElementById("modalInput"), area = document.getElementById("modalArea");
      document.getElementById("modalTitle").textContent = title;
      document.getElementById("modalNote").textContent = opts.note || (opts.multiline ? "Shift+Enter — перенос на следующую строку." : "");
      one.type = opts.password ? "password" : "text";
      const inp = opts.multiline ? area : one;
      one.style.display = opts.confirm || opts.multiline ? "none" : "";
      area.classList.toggle("hidden", !opts.multiline || !!opts.confirm);
      inp.value = value || "";
      if (opts.multiline) area.rows = Math.min(4, Math.max(2, (value || "").split("\n").length));
      m.classList.remove("hidden");
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      function done(v) {
        m.classList.add("hidden");
        ok.removeEventListener("click", onOk); cancel.removeEventListener("click", onCancel); inp.removeEventListener("keydown", onKey);
        resolve(v);
      }
      const ok = document.getElementById("modalOk"), cancel = document.getElementById("modalCancel");
      const clean = v => v.split("\n").map(x => x.trim()).filter(Boolean).join("\n");
      const onOk = () => done(opts.confirm ? true : (clean(inp.value) || null));
      const onCancel = () => done(opts.confirm ? false : null);
      const onKey = e => {
        if (e.key === "Enter" && !(opts.multiline && e.shiftKey)) { e.preventDefault(); onOk(); }
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      };
      ok.addEventListener("click", onOk); cancel.addEventListener("click", onCancel); inp.addEventListener("keydown", onKey);
    });
  }

  // многострочные названия: в данных — перевод строки, в однострочных полях — « ↵ », в SVG — строки tspan
  const lines = {
    toInput: s => String(s || "").replace(/\n/g, " ↵ "),
    fromInput: s => String(s || "").split(/\s*↵\s*/).map(x => x.trim()).filter(Boolean).join("\n"),
    oneLine: s => String(s || "").replace(/\n/g, " "),
    // текст SVG: каждая строка — tspan, блок центрируется по вертикали относительно y
    svg(el, str, lh) {
      lh = lh || 1.15;
      const parts = String(str || "").split("\n");
      el.textContent = "";
      if (parts.length === 1) { el.textContent = parts[0]; return; }
      const x = el.getAttribute("x") || 0;
      parts.forEach((p, i) => {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        t.setAttribute("x", x);
        t.setAttribute("dy", (i === 0 ? -(parts.length - 1) / 2 * lh : lh).toFixed(3) + "em");
        t.textContent = p; el.appendChild(t);
      });
    },
    // текст на холсте построчно
    canvas(ctx, str, x, y, size, stroke) {
      const parts = String(str || "").split("\n"), lh = size * 1.15, y0 = y - (parts.length - 1) * lh / 2;
      parts.forEach((p, i) => { if (stroke) ctx.strokeText(p, x, y0 + i * lh); ctx.fillText(p, x, y0 + i * lh); });
    }
  };

  // ---------- лор (data/lore.json): статьи о государствах из летописи, союзы, хронология ----------
  // Загружается один раз и нужен и Вики, и карте (ссылка «Статья в лоре» в карточке страны).
  let lorePromise = null;
  function lore() {
    if (!lorePromise) lorePromise = fetch("data/lore.json?t=" + Date.now(), { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(L => {
        L = L && Array.isArray(L.states) ? L : { states: [], unions: [], regions: [], chronology: "" };
        L.byMap = {}; L.byId = {};
        for (const s of L.states) { L.byId[s.id] = s; for (const id of s.map || []) L.byMap[String(id)] = s; }
        return L;
      });
    return lorePromise;
  }
  // показать страну карты: Земля, плоская карта, выбрать и приблизить
  const showOnMap = id => go("map/earth/flat/" + encodeURIComponent(id));
  window.KG = { toast, ask, openTab, go, get route() { return route; }, lines, setMedia, ytId, lore, showOnMap };
})();
