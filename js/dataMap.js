/* js/dataMap.js — flat top-down mini-map + category summary for the HQ DATA
 * tab. Read-only view of the tile data model (GameState.tileData) that the
 * Drone/GPR scan systems populate. NOT isometric: a simple 20x20 square grid,
 * one square per tile, colored by the tile's current bestUse.
 */

window.DataMap = (function () {
  // Category palette — used consistently in both the mini-map and the summary
  // list. `bestUse: null` (no scan data at all) maps to "Unscanned".
  var CATEGORIES = [
    { id: "unscanned",   label: "Unscanned",     short: "Unscanned",    color: "#E0E0DA" },
    { id: "partial",     label: "Partial Data",  short: "Partial",      color: "#FFE082" },
    { id: "unsuitable",  label: "Unsuitable",    short: "Unsuitable",   color: "#EF5350" },
    { id: "commercial",  label: "Commercial",    short: "Commercial",   color: "#42A5F5" },
    { id: "residential", label: "Residential",   short: "Residential",  color: "#66BB6A" },
    { id: "industrial",  label: "Industrial",    short: "Industrial",   color: "#8D6E63" },
    { id: "mining",      label: "Mining",        short: "Mining",       color: "#FFB300" },
  ];

  var api = {
    _init: false,
    canvas: null,
    ctx: null,
    wrap: null,       // mini-map container (used for mobile pan/scroll)
    detailsEl: null,
    categoriesEl: null,
    legendEl: null,
    selected: null,   // { col, row } | null
    // mobile touch state (pan + pinch-zoom; Pointer Events like the main map)
    _touch: { pointers: {}, pinch: null, panStart: null, zoom: 1, baseWidth: 0 },
  };

  function gridSize() {
    return (window.IsoGrid && window.IsoGrid.gridSize) || 20;
  }

  // map a bestUse value to a category id (null -> unscanned).
  function categoryFor(bestUse) {
    if (bestUse == null) return "unscanned";
    if (bestUse === "Partial Data") return "partial";
    if (bestUse === "Unsuitable") return "unsuitable";
    if (bestUse === "Commercial") return "commercial";
    if (bestUse === "Residential") return "residential";
    if (bestUse === "Industrial") return "industrial";
    if (bestUse === "Mining") return "mining";
    return "unscanned"; // unknown value -> treat as unscanned
  }

  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return CATEGORIES[0];
  }

  // how many tiles currently fall into each category, derived from tileData.
  function getCounts() {
    var counts = {};
    for (var i = 0; i < CATEGORIES.length; i++) counts[CATEGORIES[i].id] = 0;
    var total = gridSize() * gridSize();
    var recorded = 0;
    var gs = window.GameState;
    if (gs && gs.tileData) {
      var keys = Object.keys(gs.tileData);
      for (var k = 0; k < keys.length; k++) {
        var d = gs.tileData[keys[k]];
        counts[categoryFor(d.bestUse)]++;
        recorded++;
      }
    }
    // tiles with no record have never been scanned -> Unscanned
    counts.unscanned += Math.max(0, total - recorded);
    return counts;
  }

  // ---- mini-map rendering -------------------------------------------------

  // rounded-rect path helper (canvas lacks it in older browsers)
  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // faint terrain-context overlays on top of the category grid: river, trench,
  // rock clusters and the HQ building. Reads the SAME terrain state as the main
  // isometric map (window.Terrain) — nothing is recalculated here. Every marker
  // is drawn with a dark under-stroke + bright core so it stays visible on ANY
  // category fill (e.g. river blue vs Commercial blue, gray rocks vs Industrial
  // brown, dark trench vs Unsuitable red).
  function drawTerrainOverlays(ctx, cell) {
    var t = window.Terrain;
    if (!t) return;
    var g = gridSize();
    var inset = Math.max(1, cell * 0.05);

    // river: bright white-cyan DASHED line with a thin dark shadow stroke
    // behind it — clear contrast against every fill, incl. Commercial blue
    ctx.setLineDash([Math.max(3, cell * 0.32), Math.max(2, cell * 0.22)]);
    for (var r = 0; r < g; r++) {
      for (var c = 0; c < g; c++) {
        if (!t.isRiver(c, r)) continue;
        var rx = c * cell + inset;
        var ry = r * cell + inset;
        var rw = cell - inset * 2;
        var rh = cell - inset * 2;
        ctx.strokeStyle = "rgba(15, 25, 45, 0.65)"; // dark shadow behind
        ctx.lineWidth = Math.max(2.5, cell * 0.15);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.strokeStyle = "rgba(225, 248, 255, 0.95)"; // bright core
        ctx.lineWidth = Math.max(1, cell * 0.07);
        ctx.strokeRect(rx, ry, rw, rh);
      }
    }
    ctx.setLineDash([]);

    // trench: thin dark outline around trench tiles (dark on red/light both read)
    ctx.strokeStyle = "rgba(15, 15, 20, 0.55)";
    ctx.lineWidth = Math.max(1.5, cell * 0.09);
    for (var r = 0; r < g; r++) {
      for (var c = 0; c < g; c++) {
        if (t.typeAt(c, r) !== "trench") continue;
        ctx.strokeRect(c * cell + inset, r * cell + inset, cell - inset * 2, cell - inset * 2);
      }
    }

    // rock clusters: light gray dots with a strong dark outline — readable on
    // Industrial brown as well as on light fills
    var clusters = t.hillClusters || [];
    for (var ci = 0; ci < clusters.length; ci++) {
      var rocks = (clusters[ci].rocks || []).slice();
      for (var ri = 0; ri < rocks.length; ri++) {
        var rock = rocks[ri];
        var px = (clusters[ci].cx + rock.dc) * cell;
        var py = (clusters[ci].cy + rock.dr) * cell;
        var rad = Math.max(1.5, cell * 0.13 * (rock.size || 1));
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(205, 205, 212, 0.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(20, 20, 25, 0.6)";
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.stroke();
      }
    }

    // HQ: small amber building glyph (roof + body) at the HQ tile
    for (var r = 0; r < g; r++) {
      for (var c = 0; c < g; c++) {
        if (!t.isHQ(c, r)) continue;
        var hcx = (c + 0.5) * cell;
        var hcy = (r + 0.5) * cell;
        var s = cell * 0.32; // building half-size
        var roof = s * 0.15;
        ctx.beginPath();
        ctx.moveTo(hcx - s, hcy - roof);
        ctx.lineTo(hcx, hcy - s * 1.1);
        ctx.lineTo(hcx + s, hcy - roof);
        ctx.closePath();
        ctx.fillStyle = "#FFD54F";
        ctx.fill();
        ctx.strokeStyle = "rgba(60, 40, 0, 0.8)";
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.stroke();
        ctx.fillStyle = "#FFE082";
        ctx.fillRect(hcx - s * 0.7, hcy - roof, s * 1.4, s * 0.9);
        ctx.strokeRect(hcx - s * 0.7, hcy - roof, s * 1.4, s * 0.9);
        return;
      }
    }
  }

  function render() {
    if (!api.ctx || !api.canvas) return;
    var g = gridSize();
    var canvas = api.canvas;
    var ctx = api.ctx;
    var cell = canvas.width / g;
    var radius = Math.max(2, cell * 0.1); // subtle corner rounding

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // dark background (matches the wrap)
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1) base fill — one rounded square per tile, flush (no dark gaps), each
    //    colored by its discrete category. Colors stay crisp and unblended.
    for (var row = 0; row < g; row++) {
      for (var col = 0; col < g; col++) {
        var d = window.GameState.getTileData(col, row);
        var cat = categoryById(categoryFor(d.bestUse));
        var x = col * cell;
        var y = row * cell;
        roundedRectPath(ctx, x, y, cell, cell, radius);
        ctx.fillStyle = cat.color;
        ctx.fill();
      }
    }

    // 2) soft grid lines — thin light strokes (not harsh dark borders), so the
    //    grid reads as one cohesive surface with a gentle tile separation
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    for (var row = 0; row < g; row++) {
      for (var col = 0; col < g; col++) {
        roundedRectPath(ctx, col * cell, row * cell, cell, cell, radius);
        ctx.stroke();
      }
    }

    // 3) terrain-context overlays (river / trench / rocks / HQ) — faint on top
    drawTerrainOverlays(ctx, cell);

    // highlight the selected tile
    if (api.selected) {
      var sx = api.selected.col * cell;
      var sy = api.selected.row * cell;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = Math.max(2, cell * 0.12);
      ctx.strokeRect(sx + 1, sy + 1, cell - 2, cell - 2);
    }
  }

  // ---- tile details panel -------------------------------------------------

  function renderDetails(col, row) {
    if (!api.detailsEl) return;
    var d = window.GameState.getTileData(col, row);
    var cat = categoryById(categoryFor(d.bestUse));
    var textColor = (cat.id === "unsuitable" || cat.id === "commercial" || cat.id === "industrial") ? "#FFFFFF" : "#2D3561";

    var html = "";
    html += '<div class="hq-data-details-row"><span>Tile</span><strong>' + col + ", " + row + '</strong></div>';
    html += '<div class="hq-data-details-row"><span>Surface Stability</span><strong>' +
      (d.droneScanned ? d.surfaceStability : "Not yet scanned") + '</strong></div>';
    html += '<div class="hq-data-details-row"><span>Soil Type</span><strong>' +
      (d.gprScanned ? d.soilType : "Not yet scanned") + '</strong></div>';
    html += '<div class="hq-data-details-row"><span>Mineral Deposits</span><strong>' +
      (d.gprScanned ? d.mineralDeposits : "Not yet scanned") + '</strong></div>';
    html += '<div class="hq-data-details-row"><span>Bedrock Depth</span><strong>' +
      (d.gprScanned ? d.bedrockDepth : "Not yet scanned") + '</strong></div>';
    html += '<div class="hq-data-details-row"><span>Best Use</span>' +
      '<span class="hq-data-badge" style="background:' + cat.color + ';color:' + textColor + '">' + cat.label + '</span></div>';
    api.detailsEl.innerHTML = html;
  }

  // ---- category summary list ----------------------------------------------

  function renderCategories() {
    if (!api.categoriesEl) return;
    var counts = getCounts();
    var html = "";
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      html += '<div class="hq-data-cat-row">' +
        '<span class="hq-data-cat-swatch" style="background:' + cat.color + '"></span>' +
        '<span class="hq-data-cat-label">' + cat.label + '</span>' +
        '<span class="hq-data-cat-count">' + counts[cat.id] + ' tiles</span>' +
      '</div>';
    }
    api.categoriesEl.innerHTML = html;
  }

  // ---- click handling -----------------------------------------------------

  function onCanvasClick(e) {
    if (!api.canvas) return;
    var rect = api.canvas.getBoundingClientRect();
    var g = gridSize();
    var col = Math.floor((e.clientX - rect.left) / rect.width * g);
    var row = Math.floor((e.clientY - rect.top) / rect.height * g);
    if (col < 0 || col >= g || row < 0 || row >= g) return;
    api.selected = { col: col, row: row };
    render();
    renderDetails(col, row);
  }

  // ---- compact inline legend (always-visible quick reference under the map) --

  function renderLegend() {
    if (!api.legendEl) return;
    var html = "";
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      html += '<span class="hq-data-minimap-legend-item">' +
        '<span class="hq-data-minimap-legend-swatch" style="background:' + cat.color + '"></span>' +
        cat.short +
      '</span>';
    }
    api.legendEl.innerHTML = html;
  }

  // ---- mobile pan + pinch-zoom (Pointer Events, like the main game map) -----
  // One-finger drag pans (wrap scroll), two-finger pinch scales the canvas up
  // to PINCH_MAX so tiles never have to shrink into illegibility on small
  // screens. touch-action:none on the canvas keeps the browser out of the way.

  var PINCH_MIN = 1;
  var PINCH_MAX = 2.5;

  function touchPointers() {
    var pts = [];
    for (var k in api._touch.pointers) pts.push(api._touch.pointers[k]);
    return pts;
  }

  function touchDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function applyZoom(z) {
    api._touch.zoom = Math.min(PINCH_MAX, Math.max(PINCH_MIN, z));
    if (!api._touch.baseWidth) {
      api._touch.baseWidth = api.wrap ? api.wrap.clientWidth : (api.canvas ? api.canvas.clientWidth : 320);
    }
    api.canvas.style.width = Math.round(api._touch.baseWidth * api._touch.zoom) + "px";
  }

  function isTouchPointer(e) {
    return e && e.pointerType === "touch";
  }

  function onTouchPointerDown(e) {
    if (!isTouchPointer(e)) return; // mouse keeps native click-to-select
    api._touch.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { api.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var pts = touchPointers();
    if (pts.length >= 2) {
      // switch to pinch: remember start distance + zoom level
      api._touch.pinch = { dist: touchDist(pts[0], pts[1]), zoom: api._touch.zoom };
      api._touch.panStart = null;
    } else {
      api._touch.pinch = null;
      api._touch.panStart = {
        x: e.clientX, y: e.clientY,
        sx: api.wrap ? api.wrap.scrollLeft : 0,
        sy: api.wrap ? api.wrap.scrollTop : 0,
      };
    }
  }

  function onTouchPointerMove(e) {
    if (!isTouchPointer(e) || !api._touch.pointers[e.pointerId]) return;
    api._touch.pointers[e.pointerId].x = e.clientX;
    api._touch.pointers[e.pointerId].y = e.clientY;
    if (api._touch.pinch) {
      var pts = touchPointers();
      if (pts.length >= 2 && api._touch.pinch.dist > 0) {
        applyZoom(api._touch.pinch.zoom * touchDist(pts[0], pts[1]) / api._touch.pinch.dist);
      }
    } else if (api._touch.panStart && api.wrap) {
      api.wrap.scrollLeft = api._touch.panStart.sx - (e.clientX - api._touch.panStart.x);
      api.wrap.scrollTop = api._touch.panStart.sy - (e.clientY - api._touch.panStart.y);
    }
  }

  function onTouchPointerEnd(e) {
    if (!isTouchPointer(e)) return;
    delete api._touch.pointers[e.pointerId];
    if (api._touch.pinch) {
      api._touch.pinch = null;
      var pts = touchPointers();
      if (pts.length === 1) {
        api._touch.panStart = {
          x: pts[0].x, y: pts[0].y,
          sx: api.wrap ? api.wrap.scrollLeft : 0,
          sy: api.wrap ? api.wrap.scrollTop : 0,
        };
      }
    }
    if (touchPointers().length === 0) api._touch.panStart = null;
  }

  // ---- lifecycle ----------------------------------------------------------

  api.init = function () {
    if (api._init) return;
    api.canvas = document.getElementById("data-minimap");
    api.detailsEl = document.getElementById("data-details");
    api.categoriesEl = document.getElementById("data-categories");
    api.legendEl = document.getElementById("data-minimap-legend");
    if (!api.canvas) return;
    api.wrap = api.canvas.parentElement;

    var dpr = window.devicePixelRatio || 1;
    var g = gridSize();
    var cell = Math.round(20 * dpr);
    api.canvas.width = g * cell;
    api.canvas.height = g * cell;
    api.ctx = api.canvas.getContext("2d");

    api.canvas.addEventListener("click", onCanvasClick);
    api.canvas.addEventListener("pointerdown", onTouchPointerDown);
    api.canvas.addEventListener("pointermove", onTouchPointerMove);
    api.canvas.addEventListener("pointerup", onTouchPointerEnd);
    api.canvas.addEventListener("pointercancel", onTouchPointerEnd);

    renderLegend();

    api.refresh();

    // entrance animation (anime.js) for the DATA tab blocks
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: "#data-minimap",
        opacity: [0, 1],
        scale: [0.96, 1],
        duration: 500,
        easing: "easeOutCubic"
      });
      anime({
        targets: ".hq-data-section-header, .hq-data-categories, .hq-data-details",
        opacity: [0, 1],
        translateY: [8, 0],
        delay: anime.stagger(70),
        duration: 400,
        easing: "easeOutCubic"
      });
    }
    api._init = true;
  };

  // re-render everything from current GameState — called whenever the DATA tab
  // is opened/viewed, so fresh scan data is always reflected.
  api.refresh = function () {
    render();
    renderCategories();
    if (api.selected) {
      renderDetails(api.selected.col, api.selected.row);
    } else {
      api.detailsEl.innerHTML = '<div class="hq-data-details-empty">Select a tile on the mini-map to see its survey data</div>';
    }
  };

  // pure helpers exposed for debugging/tests
  api._categoryFor = categoryFor;
  api._getCounts = getCounts;

  return api;
})();