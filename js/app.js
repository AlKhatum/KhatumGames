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
  function setSound(on) {
    soundOn = on;
    if (on) { ytCmd("unMute"); ytCmd("setVolume", [60]); ytCmd("playVideo"); } else ytCmd("mute");
    soundBtn.classList.toggle("on", on);
    soundBtn.querySelector(".ico").textContent = on ? "🔊" : "🔇";
  }
  soundBtn.addEventListener("click", e => { e.stopPropagation(); setSound(!soundOn); });
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
  // opts: { password: true } — поле пароля; { note: "…" } — пояснение под полем
  function ask(title, value, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const m = document.getElementById("modal"), inp = document.getElementById("modalInput");
      document.getElementById("modalTitle").textContent = title;
      document.getElementById("modalNote").textContent = opts.note || "";
      inp.type = opts.password ? "password" : "text";
      inp.value = value || "";
      inp.style.display = opts.confirm ? "none" : "";
      m.classList.remove("hidden");
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      function done(v) {
        m.classList.add("hidden");
        ok.removeEventListener("click", onOk); cancel.removeEventListener("click", onCancel); inp.removeEventListener("keydown", onKey);
        resolve(v);
      }
      const ok = document.getElementById("modalOk"), cancel = document.getElementById("modalCancel");
      const onOk = () => done(opts.confirm ? true : (inp.value.trim() || null));
      const onCancel = () => done(opts.confirm ? false : null);
      const onKey = e => { if (e.key === "Enter") onOk(); if (e.key === "Escape") onCancel(); e.stopPropagation(); };
      ok.addEventListener("click", onOk); cancel.addEventListener("click", onCancel); inp.addEventListener("keydown", onKey);
    });
  }

  window.KG = { toast, ask, openTab };
})();
