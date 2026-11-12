// Территории стран: растровая карта id (1 байт на пиксель, 4087×3554) + построение плавных контуров.
// Растр правится кистью/карандашом/заливкой, контуры пересчитываются только для затронутых стран.
(function () {
  "use strict";

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("не удалось загрузить " + url));
      img.src = url;
    });
  }
  async function readPixels(url) {
    const img = await loadImage(url);
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { w: cv.width, h: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
  }

  // ---------- контуры (marching squares по центрам пикселей) ----------
  // Для каждой метки L ячейка 2×2 даёт код (tl=8, tr=4, br=2, bl=1). Отрезки ориентированы так,
  // что метка всегда справа по ходу — это позволяет однозначно сцеплять их в замкнутые кольца.
  // Рёбра: T,R,B,L. Седловые случаи (5, 10) трактуются как раздельные углы.
  const TABLE = [
    [], [["L", "B"]], [["B", "R"]], [["L", "R"]], [["R", "T"]], [["L", "B"], ["R", "T"]], [["B", "T"]], [["L", "T"]],
    [["T", "L"]], [["T", "B"]], [["T", "L"], ["B", "R"]], [["T", "R"]], [["R", "L"]], [["R", "B"]], [["B", "L"]], []
  ];

  function trace(ids, W, H, want, bx0, by0, bx1, by1) {
    const S = W + 2;
    const hk = (x, y) => ((y + 1) * S + (x + 1)) * 2;     // ребро между пикселями (x,y)-(x+1,y)
    const vk = (x, y) => ((y + 1) * S + (x + 1)) * 2 + 1; // ребро между пикселями (x,y)-(x,y+1)
    const segs = new Map(); // метка -> Map(начало -> конец)
    const x0 = Math.max(-1, bx0 - 1), y0 = Math.max(-1, by0 - 1);
    const x1 = Math.min(W, bx1), y1 = Math.min(H, by1); // ячейки до W-1 включительно замыкают фигуры у края
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : ids[y * W + x]);
    for (let cy = y0; cy < y1; cy++) {
      const inY = cy >= 0 && cy + 1 < H;
      for (let cx = x0; cx < x1; cx++) {
        let a, b, c, d;
        if (inY && cx >= 0 && cx + 1 < W) {
          const i = cy * W + cx;
          a = ids[i]; b = ids[i + 1]; d = ids[i + W]; c = ids[i + W + 1];
        } else {
          a = at(cx, cy); b = at(cx + 1, cy); c = at(cx + 1, cy + 1); d = at(cx, cy + 1);
        }
        if (a === b && b === c && c === d) continue;
        const labels = [a, b, c, d];
        for (let q = 0; q < 4; q++) {
          const L = labels[q];
          if (L === 0 || labels.indexOf(L) !== q) continue;
          if (want && !want.has(L)) continue;
          const code = (a === L ? 8 : 0) | (b === L ? 4 : 0) | (c === L ? 2 : 0) | (d === L ? 1 : 0);
          const ent = TABLE[code];
          if (!ent.length) continue;
          let m = segs.get(L);
          if (!m) { m = new Map(); segs.set(L, m); }
          for (const [f, t] of ent) {
            const key = e => (e === "T" ? hk(cx, cy) : e === "B" ? hk(cx, cy + 1) : e === "L" ? vk(cx, cy) : vk(cx + 1, cy));
            m.set(key(f), key(t));
          }
        }
      }
    }
    // сцепка отрезков в кольца
    const out = new Map();
    for (const [L, m] of segs) {
      const rings = [];
      for (const [k0] of m) {
        if (!m.has(k0)) continue;
        const pts = [];
        let k = k0, guard = 0;
        while (k !== undefined && m.has(k)) {
          const idx = k >> 1, yy = Math.floor(idx / S) - 1, xx = (idx % S) - 1;
          if ((k & 1) === 0) pts.push(xx + 1, yy + 0.5); else pts.push(xx + 0.5, yy + 1);
          const nk = m.get(k); m.delete(k); k = nk;
          if (++guard > 5e6) break;
        }
        if (pts.length >= 6) rings.push(pts);
      }
      out.set(L, rings);
    }
    return out;
  }

  // сглаживание Чайкина (замкнутое кольцо)
  function chaikin(p, iter) {
    for (let it = 0; it < iter; it++) {
      const n = p.length / 2, q = new Array(n * 4);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1];
        q[4 * i] = 0.75 * ax + 0.25 * bx; q[4 * i + 1] = 0.75 * ay + 0.25 * by;
        q[4 * i + 2] = 0.25 * ax + 0.75 * bx; q[4 * i + 3] = 0.25 * ay + 0.75 * by;
      }
      p = q;
    }
    return p;
  }
  // упрощение Дугласа—Пекера для замкнутого кольца
  function simplify(p, tol) {
    const n = p.length / 2;
    if (n < 8) return p;
    const keep = new Uint8Array(n + 1);
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) {
      const dx = p[2 * i] - p[0], dy = p[2 * i + 1] - p[1], d = dx * dx + dy * dy;
      if (d > fd) { fd = d; far = i; }
    }
    keep[0] = keep[far] = keep[n] = 1;
    const X = i => p[2 * (i % n)], Y = i => p[2 * (i % n) + 1];
    const stack = [[0, far], [far, n]], t2 = tol * tol;
    while (stack.length) {
      const [i0, i1] = stack.pop();
      if (i1 <= i0 + 1) continue;
      const x0 = X(i0), y0 = Y(i0), dx = X(i1) - x0, dy = Y(i1) - y0, l2 = dx * dx + dy * dy || 1e-9;
      let bi = -1, bd = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const t = Math.max(0, Math.min(1, ((X(i) - x0) * dx + (Y(i) - y0) * dy) / l2));
        const ex = x0 + t * dx - X(i), ey = y0 + t * dy - Y(i), d = ex * ex + ey * ey;
        if (d > bd) { bd = d; bi = i; }
      }
      if (bd > t2) { keep[bi] = 1; stack.push([i0, bi], [bi, i1]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
    return out;
  }
  function ringsToPath(rings) {
    const parts = [];
    for (const r0 of rings) {
      const r = simplify(chaikin(r0, 2), 0.28);
      if (r.length < 6) continue;
      let s = "M" + r[0].toFixed(1) + " " + r[1].toFixed(1);
      for (let i = 2; i < r.length; i += 2) s += "L" + r[i].toFixed(1) + " " + r[i + 1].toFixed(1);
      parts.push(s + "Z");
    }
    return parts.join("");
  }

  // ---------- модель ----------
  // wide = false: id стран (1 байт, серый PNG); wide = true: id провинций (2 байта: R + G·256)
  function make(wide) {
  const Arr = wide ? Uint16Array : Uint8Array;
  const T = {
    wide,
    W: 0, H: 0, ids: null, land: null, bbox: [],
    async load(idsUrl, land) {
      const a = await readPixels(idsUrl);
      T.W = a.w; T.H = a.h;
      const N = a.w * a.h;
      T.ids = new Arr(N);
      if (wide) for (let i = 0; i < N; i++) T.ids[i] = a.data[i * 4] + a.data[i * 4 + 1] * 256;
      else for (let i = 0; i < N; i++) T.ids[i] = a.data[i * 4];
      if (land instanceof Uint8Array) T.land = land; // общая маска суши
      else {
        const b = await readPixels(land);
        T.land = new Uint8Array(N);
        if (b.w === a.w && b.h === a.h) for (let i = 0; i < N; i++) T.land[i] = b.data[i * 4 + 3] >= 128 ? 1 : 0;
      }
      T.mark = new Uint32Array(N);
      T.strokeNo = 0;
      T.computeBBoxes();
    },
    computeBBoxes() {
      const { W, H, ids } = T;
      T.bbox = [];
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          const v = ids[row + x];
          if (!v) continue;
          const b = T.bbox[v];
          if (!b) T.bbox[v] = [x, y, x + 1, y + 1];
          else { if (x < b[0]) b[0] = x; if (x >= b[2]) b[2] = x + 1; if (y >= b[3]) b[3] = y + 1; }
        }
      }
    },
    // все контуры: Map id -> path d
    allPaths() {
      const res = trace(T.ids, T.W, T.H, null, 0, 0, T.W, T.H);
      const out = new Map();
      for (const [L, rings] of res) out.set(L, ringsToPath(rings));
      return out;
    },
    // контуры только для заданных меток
    pathsFor(labels) {
      const want = new Set([...labels].filter(v => v > 0));
      if (!want.size) return new Map();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const L of want) {
        const b = T.bbox[L]; if (!b) continue;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
      }
      const out = new Map();
      for (const L of want) out.set(L, "");
      if (x0 === Infinity) return out;
      const res = trace(T.ids, T.W, T.H, want, x0, y0, x1, y1);
      for (const [L, rings] of res) out.set(L, ringsToPath(rings));
      return out;
    },
    // береговая линия по маске суши
    coastPath() {
      const r = trace(T.land, T.W, T.H, null, 0, 0, T.W, T.H).get(1) || [];
      return ringsToPath(r);
    },
    at(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || y < 0 || x >= T.W || y >= T.H) return 0;
      return T.ids[y * T.W + x];
    },
    isLand(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      return x >= 0 && y >= 0 && x < T.W && y < T.H && T.land[y * T.W + x] === 1;
    },

    // ---------- рисование ----------
    beginStroke() { T.strokeNo++; return { idx: [], old: [], val: [], labels: new Set(), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; },
    _set(i, v, ch) {
      const old = T.ids[i];
      if (old === v) return;
      if (T.mark[i] !== T.strokeNo) { T.mark[i] = T.strokeNo; ch.idx.push(i); ch.old.push(old); ch.val.push(v); }
      else ch.val[ch.idx.lastIndexOf(i)] = v;
      T.ids[i] = v;
      ch.labels.add(old); ch.labels.add(v);
      const x = i % T.W, y = (i - x) / T.W;
      if (x < ch.x0) ch.x0 = x; if (y < ch.y0) ch.y0 = y; if (x + 1 > ch.x1) ch.x1 = x + 1; if (y + 1 > ch.y1) ch.y1 = y + 1;
    },
    // круглый штамп радиуса r (в пикселях карты)
    stamp(cx, cy, r, v, opt, ch, onPixel) {
      const { W, H, ids, land } = T;
      const r2 = r * r, xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(W - 1, Math.ceil(cx + r));
      const ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = ya; y <= yb; y++) {
        const dy = y + 0.5 - cy;
        for (let x = xa; x <= xb; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy > r2 && !(r < 0.8 && x === Math.floor(cx) && y === Math.floor(cy))) continue;
          const i = y * W + x;
          if (opt.land && !land[i]) continue;
          if (opt.keep && ids[i] !== 0 && ids[i] !== v) continue;
          if (ids[i] !== v) { T._set(i, v, ch); if (onPixel) onPixel(x, y, v); }
        }
      }
    },
    line(ax, ay, bx, by, r, v, opt, ch, onPixel) {
      const d = Math.hypot(bx - ax, by - ay), step = Math.max(0.5, r * 0.35), n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) T.stamp(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, r, v, opt, ch, onPixel);
    },
    // заливка связной области того же значения (пустая область — только по суше)
    fill(sx, sy, v, opt, ch, onPixel) {
      const { W, H, ids, land } = T;
      sx = Math.floor(sx); sy = Math.floor(sy);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) return 0;
      const start = sy * W + sx, target = ids[start];
      if (target === v) return 0;
      const needLand = opt.land || target === 0;
      if (needLand && !land[start]) return 0;
      const stack = new Int32Array(W * H);
      const seen = new Uint8Array(W * H);
      let sp = 0, n = 0;
      stack[sp++] = start; seen[start] = 1;
      while (sp) {
        const i = stack[--sp];
        T._set(i, v, ch); n++;
        if (onPixel) onPixel(i % W, (i / W) | 0, v);
        const x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
        for (const j of nb) {
          if (j < 0 || seen[j] || ids[j] !== target) continue;
          if (needLand && !land[j]) continue;
          seen[j] = 1; stack[sp++] = j;
        }
      }
      return n;
    },
    endStroke(ch) {
      const res = { idx: Int32Array.from(ch.idx), old: Arr.from(ch.old), val: Arr.from(ch.val), labels: ch.labels, wide };
      // расширяем рамки затронутых стран
      for (const L of ch.labels) {
        if (!L || ch.x0 === Infinity) continue;
        const b = T.bbox[L];
        if (!b) T.bbox[L] = [ch.x0, ch.y0, ch.x1, ch.y1];
        else { b[0] = Math.min(b[0], ch.x0); b[1] = Math.min(b[1], ch.y0); b[2] = Math.max(b[2], ch.x1); b[3] = Math.max(b[3], ch.y1); }
      }
      return res;
    },
    // применить/откатить сохранённый мазок
    apply(stroke, useOld) {
      const arr = useOld ? stroke.old : stroke.val;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < stroke.idx.length; k++) {
        const i = stroke.idx[k];
        T.ids[i] = arr[k];
        const x = i % T.W, y = (i - x) / T.W;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
      }
      for (const L of stroke.labels) {
        if (!L || x0 === Infinity) continue;
        const b = T.bbox[L];
        if (!b) T.bbox[L] = [x0, y0, x1, y1];
        else { b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1); }
      }
    },
    // площадь и «полюс недоступности» (для подписи) — грубо, по сетке с шагом 4
    labelPoint(L) {
      const b = T.bbox[L]; if (!b) return null;
      let best = null, bd = -1;
      const { W, ids } = T;
      for (let y = b[1]; y < b[3]; y += 4) for (let x = b[0]; x < b[2]; x += 4) {
        if (ids[y * W + x] !== L) continue;
        let d = 0;
        while (d < 200) {
          d += 3;
          if (T.at(x + d, y) !== L || T.at(x - d, y) !== L || T.at(x, y + d) !== L || T.at(x, y - d) !== L) break;
        }
        if (d > bd) { bd = d; best = [x, y]; }
      }
      return best;
    },
    // PNG (серый) для публикации
    toPngBlob() {
      const cv = document.createElement("canvas");
      cv.width = T.W; cv.height = T.H;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(T.W, T.H), d = img.data;
      for (let i = 0, n = T.W * T.H; i < n; i++) {
        const v = T.ids[i];
        if (wide) { d[i * 4] = v & 255; d[i * 4 + 1] = v >> 8; d[i * 4 + 2] = 0; } else d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return new Promise(res => cv.toBlob(res, "image/png"));
    }
  };

  return T;
  }

  window.KGTerritory = make(false);
  window.KGProvinces = make(true);
  window.KGTerritoryMake = make; // для Луны: отдельный экземпляр движка
})();
