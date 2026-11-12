// Общие вещи сайта: вкладки, фоновое видео, всплывающие сообщения, диалог ввода.
(function () {
  "use strict";

  // ---------- вкладки ----------
  const tabs = document.querySelectorAll("#tabs button");
  function openTab(name) {
    if (!document.getElementById("page-" + name)) name = "map";
    tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    window.dispatchEvent(new CustomEvent("tabchange", { detail: name }));
  }
  tabs.forEach(b => b.addEventListener("click", () => openTab(b.dataset.tab)));
  document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => openTab(b.dataset.goto)));
  // разделы лора (пока заглушки)
  (function lore() {
    const grid = document.getElementById("loreGrid"), art = document.getElementById("loreArticle");
    if (!grid || !art) return;
    grid.querySelectorAll("[data-lore]").forEach(b => b.addEventListener("click", () => {
      document.getElementById("loreTitle").textContent = b.querySelector("b").textContent;
      grid.classList.add("hidden"); art.classList.remove("hidden");
    }));
    document.getElementById("loreBack").addEventListener("click", () => { art.classList.add("hidden"); grid.classList.remove("hidden"); });
  })();
  document.querySelectorAll(".soon").forEach(b => b.addEventListener("click", () => toast("Раздел «" + b.textContent + "» в разработке")));
  window.addEventListener("hashchange", () => openTab(location.hash.slice(1)));
  openTab(location.hash.slice(1) || "map");

  // ---------- фоновое видео ----------
  // Браузеры разрешают автозапуск только без звука, поэтому видео стартует беззвучно,
  // а звук включается при первом клике по странице или кнопкой «Звук».
  const yt = document.getElementById("yt");
  const soundBtn = document.getElementById("soundBtn");
  let soundOn = false;
  function ytCmd(func, args) {
    try { yt.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*"); } catch (e) { /* ignore */ }
  }
  // громкость музыки (0–100) — ползунок рядом с кнопкой, запоминается в браузере
  const volEl = document.getElementById("volume");
  let volume = 60;
  try { const v = localStorage.getItem("kg-volume"); if (v != null && isFinite(+v)) volume = Math.max(0, Math.min(100, +v)); } catch (e) { /* */ }
  if (volEl) { volEl.value = volume; volEl.style.setProperty("--v", volume + "%"); }
  function setSound(on) {
    soundOn = on;
    if (on) { if (!volume) volume = 30; ytCmd("unMute"); ytCmd("setVolume", [volume]); ytCmd("playVideo"); } else ytCmd("mute");
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
      if (v > 0) { volume = v; if (!soundOn) setSound(true); else ytCmd("setVolume", [v]); }
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
  yt.addEventListener("load", () => { ytCmd("playVideo"); });

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

  window.KG = { toast, ask, openTab, lines };
})();
