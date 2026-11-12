// Публикация правок ГМа прямо в репозиторий GitHub (один коммит через Git Data API).
// Токен хранится только в браузере ГМа (localStorage) и никуда, кроме api.github.com, не отправляется.
(function () {
  "use strict";
  const TOKEN_KEY = "kg-gh-token";
  const API = "https://api.github.com";

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* */ } }

  async function api(method, path, body) {
    const res = await fetch(API + path, {
      method,
      headers: {
        "Authorization": "Bearer " + token(),
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch (e) { /* */ }
      const err = new Error(explain(res.status, msg));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  function explain(status, msg) {
    if (status === 401) return "GitHub не принял токен (неверный или истёк).";
    if (status === 403) return "У токена нет прав на запись в репозиторий. " + msg;
    if (status === 404) return "Репозиторий не найден или у токена нет к нему доступа.";
    if (status === 409 || status === 422) return "Конфликт версий на GitHub, попробуйте ещё раз. " + msg;
    return "Ошибка GitHub " + status + ": " + msg;
  }

  // проверка: токен рабочий и может писать в репозиторий
  async function check(repo) {
    const r = await api("GET", `/repos/${repo.owner}/${repo.name}`);
    if (!r.permissions || !r.permissions.push) throw new Error("Токен видит репозиторий, но не может в него писать.");
    return r;
  }

  const enc = new TextEncoder();
  function b64FromBytes(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function toBase64(content) {
    if (typeof content === "string") return b64FromBytes(enc.encode(content));
    if (content instanceof Blob) return b64FromBytes(new Uint8Array(await content.arrayBuffer()));
    return b64FromBytes(content);
  }

  // files: [{ path, content: string | Blob | Uint8Array }]
  async function commit(repo, files, message, onStep) {
    const step = onStep || (() => {});
    const base = `/repos/${repo.owner}/${repo.name}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        step("Получаю состояние ветки…");
        const ref = await api("GET", `${base}/git/ref/heads/${repo.branch}`);
        const head = ref.object.sha;
        const headCommit = await api("GET", `${base}/git/commits/${head}`);
        const tree = [];
        for (const f of files) {
          step("Загружаю " + f.path + "…");
          const blob = await api("POST", `${base}/git/blobs`, { content: await toBase64(f.content), encoding: "base64" });
          tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
        }
        step("Создаю коммит…");
        const newTree = await api("POST", `${base}/git/trees`, { base_tree: headCommit.tree.sha, tree });
        const c = await api("POST", `${base}/git/commits`, { message, tree: newTree.sha, parents: [head] });
        await api("PATCH", `${base}/git/refs/heads/${repo.branch}`, { sha: c.sha });
        return c;
      } catch (e) {
        if (attempt === 0 && (e.status === 409 || e.status === 422)) continue; // ветка ушла вперёд — повторяем
        throw e;
      }
    }
  }

  window.KGGitHub = { token, setToken, check, commit };
})();
