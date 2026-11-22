// Заливка стран одной картинкой для общего вида карты (js/map.js, buildFill): те же пути и цвета, что у SVG-слоя «Заливка стран»
// (fill-opacity .9, правило nonzero), в масштабе k от размера карты. Рисуется в фоновом потоке, странице приходит готовый PNG.
self.onmessage = async e => {
  const { job, W, H, k, items } = e.data; // items: [[d, цвет], …] — в порядке слоёв SVG
  try {
    const w = Math.round(W * k), h = Math.round(H * k), cv = new OffscreenCanvas(w, h), ctx = cv.getContext("2d");
    ctx.setTransform(w / W, 0, 0, h / H, 0, 0); // картинку растягивают ровно на W×H — масштаб по осям точно под её размер

    ctx.globalAlpha = 0.9;
    for (const [d, color] of items) { if (!d) continue; ctx.fillStyle = color; ctx.fill(new Path2D(d)); }
    const blob = await cv.convertToBlob({ type: "image/png" });
    self.postMessage({ job, blob });
  } catch (err) {
    self.postMessage({ job, error: String((err && err.message) || err) });
  }
};
