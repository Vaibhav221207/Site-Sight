/* js/dataMap.js — flat top-down mini-map + category summary for the HQ DATA
 * tab. Read-only view of the tile data model (GameState.tileData) that the
 * Drone/GPR scan systems populate. NOT isometric: a simple 20x20 square grid,
 * one square per tile, colored by the tile's current bestUse.
 */

window.DataMap = (function () {
  // Category palette — used consistently in both the mini-map and the summary
  // list. `bestUse: null` (no scan data at all) maps to "Unscanned".
  var CATEGORIES = [
    { id: "unscanned",   label: "Unscanned",     color: "#E0E0DA" },
    { id: "partial",     label: "Partial Data",  color: "#FFE082" },
    { id: "unsuitable",  label: "Unsuitable",    color: "#EF5350" },
    { id: "commercial",  label: "Commercial",    color: "#42A5F5" },
    { id: "residential", label: "Residential",   color: "#66BB6A" },
    { id: "industrial",  label: "Industrial",    color: "#8D6E63" },
    { id: "mining",      label: "Mining",        color: "#FFB300" },
  ];

  var api = {
    _init: false,
    canvas: null,
    ctx: null,
    detailsEl: null,
    categoriesEl: null,
    selected: null, // { col, row } | null
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

  function render() {
    if (!api.ctx || !api.canvas) return;
    var g = gridSize();
    var canvas = api.canvas;
    var ctx = api.ctx;
    var cell = canvas.width / g;
    var pad = 1; // 1px gap between squares

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // dark background (matches the wrap)
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (var row = 0; row < g; row++) {
      for (var col = 0; col < g; col++) {
        var d = window.GameState.getTileData(col, row);
        var cat = categoryById(categoryFor(d.bestUse));
        var x = col * cell + pad / 2;
        var y = row * cell + pad / 2;
        ctx.fillStyle = cat.color;
        ctx.fillRect(x, y, cell - pad, cell - pad);
      }
    }

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

  // ---- lifecycle ----------------------------------------------------------

  api.init = function () {
    if (api._init) return;
    api.canvas = document.getElementById("data-minimap");
    api.detailsEl = document.getElementById("data-details");
    api.categoriesEl = document.getElementById("data-categories");
    if (!api.canvas) return;

    var dpr = window.devicePixelRatio || 1;
    var g = gridSize();
    var cell = Math.round(20 * dpr);
    api.canvas.width = g * cell;
    api.canvas.height = g * cell;
    api.ctx = api.canvas.getContext("2d");

    api.canvas.addEventListener("click", onCanvasClick);

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