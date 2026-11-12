// Фоновый поток: строит плавные контуры стран/провинций и береговую линию из растра id,
// чтобы страница не «замирала» на время расчёта. Использует тот же движок, что и основная страница.
self.window = self;
importScripts("territory.js?v=20261113a");

self.onmessage = function (e) {
  const { job, ids, land, W, H, wide } = e.data;
  try {
    const T = self.KGTerritoryMake(!!wide);
    T.W = W; T.H = H; T.ids = ids;
    const t0 = Date.now();
    const paths = Array.from(T.allPaths());
    let coast = null;
    if (land) { T.land = land; coast = T.coastTiles(); }
    self.postMessage({ job, paths, coast, ms: Date.now() - t0 });
  } catch (err) {
    self.postMessage({ job, error: String(err && err.message || err) });
  }
};
