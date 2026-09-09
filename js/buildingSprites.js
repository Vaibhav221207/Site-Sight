/* Kenney Isometric Tiles Buildings sprite registry and loader. */
window.BuildingSprites = (function () {
  var base = "assets/kenney-buildings/PNG/";
  var cache = {};
  var api = {};

  api.pathFor = function (id) {
    return base + (String(id).slice(-4) === ".png" ? id : id + ".png");
  };

  api.load = function (id) {
    if (cache[id]) return cache[id];
    var image = new Image();
    image.src = api.pathFor(id);
    image.onload = function () {
      if (window.BlockRender) window.BlockRender.invalidate();
    };
    cache[id] = image;
    return image;
  };

  api.draw = function (ctx, id, cx, groundY, size, alpha) {
    var image = api.load(id);
    if (!image.complete || !image.naturalWidth) return;
    var scale = size / image.naturalWidth;
    var width = image.naturalWidth * scale;
    var height = image.naturalHeight * scale;
    if (alpha != null) ctx.globalAlpha *= alpha;
    ctx.drawImage(image, cx - width / 2, groundY - height, width, height);
  };

  return api;
})();
