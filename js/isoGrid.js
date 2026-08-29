/* js/isoGrid.js — isometric grid math (tile <-> screen conversion) + flat rendering.
 * No terrain / elevation. Handles camera panning offset.
 */

window.IsoGrid = (function () {
  // ---- configuration -------------------------------------------------
  var GRID_SIZE = 20;      // 20 x 20 diamond tiles
  var PADDING = 80;        // screen border padding used for auto-sizing

  // dark sci-fi palette
  var TILE_FILL = "rgba(26, 30, 52, 0.4)";
  var TILE_STROKE = "rgba(80, 100, 160, 0.3)";
  var HIGHLIGHT_FILL = "rgba(0, 210, 255, 0.35)";
  var HIGHLIGHT_STROKE = "rgba(0, 220, 255, 0.95)";

  // ---- public state --------------------------------------------------
  var api = {
    gridSize: GRID_SIZE,
    isoSize: 0,       // half tile height (== tileWidth / 2)
    tileWidth: 0,     // full diamond width  = 2 * isoSize
    tileHeight: 0,    // full diamond height = isoSize
    camera: { x: 0, y: 0 },
    canvasW: 0,
    canvasH: 0,
    highlight: null,  // { col, row } | null
  };

  // ---- layout --------------------------------------------------------
  api.resize = function (w, h) {
    api.canvasW = w;
    api.canvasH = h;
    // adaptive border padding: full PADDING on desktop-sized viewports, but a
    // much smaller margin on small screens (phones — especially landscape,
    // where the height is ~350-420px) so the map auto-fits reasonably large
    // instead of rendering tiny in the middle of a mostly-empty canvas.
    var minDim = Math.min(w, h);
    var pad = (minDim < 560)
      ? Math.min(PADDING, Math.max(24, Math.round(minDim * 0.14)))
      : PADDING;
    var availW = w - pad * 2;
    var availH = h - pad * 2;
    // 20 tiles span 2*(GRID_SIZE-1) horizontally and (GRID_SIZE-1) vertically (in iso units)
    var isoByW = availW / (2 * (GRID_SIZE - 1));
    var isoByH = availH / (GRID_SIZE - 1);
    api.isoSize = Math.min(isoByW, isoByH);
    api.tileWidth = 2 * api.isoSize;
    api.tileHeight = api.isoSize;
    // center the grid's "center tile" on the canvas center
    var vertSpanHalf = (GRID_SIZE - 1) * api.isoSize / 2;
    api.camera.x = w / 2;
    api.camera.y = h / 2 - vertSpanHalf;
  };

  // ---- coordinate conversion ----------------------------------------
  // grid (col, row) -> screen (x, y) using current camera offset
  api.worldToScreen = function (col, row) {
    var iso = api.isoSize;
    return {
      x: (col - row) * iso + api.camera.x,
      y: (col + row) * iso / 2 + api.camera.y,
    };
  };

  // screen (x, y) -> fractional grid (col, row)
  api.screenToWorld = function (sx, sy) {
    var iso = api.isoSize;
    var u = sx - api.camera.x;
    var v = sy - api.camera.y;
    return {
      col: (u + 2 * v) / (2 * iso),
      row: (2 * v - u) / (2 * iso),
    };
  };

  // screen click -> snapped integer tile within the grid, or null
  api.screenToTile = function (sx, sy) {
    var fr = api.screenToWorld(sx, sy);
    var c = Math.round(fr.col);
    var r = Math.round(fr.row);
    if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) return null;
    return { col: c, row: r };
  };

  // ---- selection ----------------------------------------------------
  api.setHighlight = function (col, row) {
    api.highlight = (col == null || row == null) ? null : { col: col, row: row };
  };

  api.clearHighlight = function () {
    api.highlight = null;
  };

  // ---- rendering ----------------------------------------------------
  api.render = function (ctx) {
    var w = api.canvasW, h = api.canvasH;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, w, h);

    // back-to-front by (col+row) for correct 2.5D overlap
    var order = [];
    for (var r = 0; r < GRID_SIZE; r++) {
      for (var c = 0; c < GRID_SIZE; c++) {
        order.push({ c: c, r: r });
      }
    }
    order.sort(function (a, b) { return (a.c + a.r) - (b.c + b.r); });

    for (var i = 0; i < order.length; i++) {
      drawTile(ctx, order[i].c, order[i].r, false);
    }
    if (api.highlight) {
      drawTile(ctx, api.highlight.col, api.highlight.row, true);
    }
  };

  function drawTile(ctx, col, row, highlight) {
    var p = api.worldToScreen(col, row);
    var cx = p.x, cy = p.y;
    var iso = api.isoSize;
    var half = iso / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy - half);   // top
    ctx.lineTo(cx + iso, cy);     // right
    ctx.lineTo(cx, cy + half);    // bottom
    ctx.lineTo(cx - iso, cy);     // left
    ctx.closePath();

    if (highlight) {
      ctx.fillStyle = HIGHLIGHT_FILL;
      ctx.strokeStyle = HIGHLIGHT_STROKE;
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(0, 220, 255, 0.6)";
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = TILE_FILL;
      ctx.strokeStyle = TILE_STROKE;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.stroke();
  }

  // initial auto-size from the viewport
  api.resize(window.innerWidth, window.innerHeight);

  return api;
})();
