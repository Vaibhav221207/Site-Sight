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
    { id: "industrial",  label: "Industrial",    short: "Industrial",   color: "#8E24AA" },
    { id: "mining",      label: "Mining",        short: "Mining",       color: "#FFB300" },
  ];

  var api = {
    _init: false,
    canvas: null,
    ctx: null,
    wrap: null,       // mini-map frame: fixed fit-bound box (overflow hidden);
                    // pan/pinch drive its scroll offsets programmatically
    detailsEl: null,
    categoriesEl: null,
    legendEl: null,
    selected: null,   // alias: first tile of selection (compat) | null
    selection: [],    // [{ col, row }] in select order — the zoning working set
    cursor: null,     // keyboard tile cursor { col, row } | null (arrows + Enter)
    canvasFocused: false,
    pendingZone: null, // zone id with an open inline confirm | null
    pendingBuilding: null, // building id picked inside the zone | null
    lastZoneMsg: "",   // success line shown once after a confirm
    drag: null,        // active mini-map drag { anchor, end, moved, select }
    suppressClick: false, // set when pointer handlers already committed a selection
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
    var clusters = t.rockClusters || [];
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

    // 1b) zone tint — mirrors the main isometric map: the zone color washed
    // over the category fill, plus an amber edge when mismatched
    var ztint = (window.ZoningTool && window.ZoningTool.zoneColorFor) ? window.ZoningTool : null;
    if (ztint) {
      for (var row = 0; row < g; row++) {
        for (var col = 0; col < g; col++) {
          var zd = window.GameState.getTileData(col, row);
          if (!zd || !zd.zoneType) continue;
          var zc = ztint.zoneColorFor(zd.zoneType);
          if (!zc) continue;
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = zc;
          roundedRectPath(ctx, col * cell, row * cell, cell, cell, radius);
          ctx.fill();
          ctx.restore();
          if (zd.zoneBuilding) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(col * cell + cell / 2, row * cell + cell / 2, Math.max(1.5, cell * 0.12), 0, Math.PI * 2);
            ctx.fillStyle = "#2B2320";
            ctx.fill();
            ctx.restore();
          }
          // zoned mark: inner ink border (dashed near-black when mismatched).
          // The color wash alone is invisible on matched tiles (same hue as
          // the fill), so the border carries the "this tile is zoned" signal.
          // Mismatch is deliberately NOT amber — amber already means Mining.
          ctx.save();
          if (zd.zoneMismatched) {
            ctx.strokeStyle = "#212121";
            ctx.setLineDash([Math.max(3, cell * 0.22), Math.max(2, cell * 0.16)]);
          } else {
            ctx.strokeStyle = "#2B2320";
          }
          ctx.lineWidth = Math.max(2, cell * 0.14);
          roundedRectPath(ctx, col * cell + 3, row * cell + 3, cell - 6, cell - 6, Math.max(1, radius * 0.6));
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 1c) pollution stain — sickly olive wash scaled by stain level, plus a
    // dark X on blighted tiles. Applies to any tile (spread stains even
    // unbuilt land), drawn over zone tint so hazard always reads.
    for (var pr = 0; pr < g; pr++) {
      for (var pc = 0; pc < g; pc++) {
        var pd = window.GameState.getTileData(pc, pr);
        var stain = (pd && pd.pollution) || 0;
        if (!pd || (!(stain > 0) && !pd.blighted)) continue;
        var px = pc * cell, py = pr * cell;
        if (stain > 0) {
          ctx.save();
          ctx.globalAlpha = 0.15 + 0.45 * Math.min(1, stain / 100);
          ctx.fillStyle = "#7A7A2E";
          roundedRectPath(ctx, px, py, cell, cell, radius);
          ctx.fill();
          ctx.restore();
        }
        if (pd.blighted) {
          ctx.save();
          ctx.strokeStyle = "#212121";
          ctx.lineWidth = Math.max(2, cell * 0.12);
          ctx.beginPath();
          ctx.moveTo(px + 2, py + 2);
          ctx.lineTo(px + cell - 2, py + cell - 2);
          ctx.moveTo(px + cell - 2, py + 2);
          ctx.lineTo(px + 2, py + cell - 2);
          ctx.stroke();
          ctx.restore();
        }
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

    // highlight every selected tile: dark outer ring + white inner ring, so
    // the working set reads on light AND dark fills (single white strokes
    // vanish on pale tiles). Excluded tiles get a dark dashed ring instead.
    for (var si = 0; si < api.selection.length; si++) {
      var st = api.selection[si];
      var sValid = true;
      try { sValid = !ztint || ztint.isValidTile(st.col, st.row); } catch (e) { sValid = true; }
      var sx = st.col * cell;
      var sy = st.row * cell;
      ctx.save();
      if (sValid) {
        ctx.strokeStyle = "#2B2320";
        ctx.lineWidth = Math.max(3, cell * 0.2);
        ctx.strokeRect(sx, sy, cell, cell);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(1.5, cell * 0.09);
        ctx.strokeRect(sx + 2.5, sy + 2.5, cell - 5, cell - 5);
      } else {
        // excluded tiles (unscanned / unzonable) dim instead of ringing —
        // keeps dashed borders meaning exactly one thing: mismatch
        ctx.fillStyle = "rgba(20, 20, 25, 0.38)";
        roundedRectPath(ctx, sx, sy, cell, cell, radius);
        ctx.fill();
      }
      ctx.restore();
    }

    // keyboard cursor: coral dashed outset ring, drawn only while the canvas
    // holds focus. Outset + dash + hue all differ from the solid selection
    // rings, the inset zone borders, and the rubber band.
    if (api.cursor && api.canvasFocused) {
      var kx = api.cursor.col * cell;
      var ky = api.cursor.row * cell;
      ctx.save();
      ctx.strokeStyle = "#C7432B";
      ctx.lineWidth = Math.max(2.5, cell * 0.16);
      ctx.setLineDash([Math.max(4, cell * 0.3), Math.max(3, cell * 0.2)]);
      ctx.strokeRect(kx - 3, ky - 3, cell + 6, cell + 6);
      ctx.restore();
    }

    // live drag rubber-band while a multi-select drag is in progress
    if (api.drag && api.drag.select && api.drag.moved && api.drag.anchor && api.drag.end) {
      var a = api.drag.anchor, b = api.drag.end;
      var x0 = Math.min(a.col, b.col) * cell, y0 = Math.min(a.row, b.row) * cell;
      var x1 = (Math.max(a.col, b.col) + 1) * cell, y1 = (Math.max(a.row, b.row) + 1) * cell;
      ctx.save();
      ctx.strokeStyle = "#FFB300";
      ctx.lineWidth = Math.max(2, cell * 0.12);
      ctx.setLineDash([Math.max(4, cell * 0.3), Math.max(3, cell * 0.2)]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---- selection model ----------------------------------------------------
  // Single tap selects one tile; click-drag (mouse, or single-finger touch
  // at zoom 1 where no pan is needed) selects the whole tile rectangle.

  function tileFromClient(x, y) {
    if (!api.canvas) return null;
    var rect = api.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var g = gridSize();
    var col = Math.floor((x - rect.left) / rect.width * g);
    var row = Math.floor((y - rect.top) / rect.height * g);
    if (col < 0 || col >= g || row < 0 || row >= g) return null;
    return { col: col, row: row };
  }

  function rectTiles(a, b) {
    var g = gridSize();
    var c0 = Math.max(0, Math.min(a.col, b.col)), c1 = Math.min(g - 1, Math.max(a.col, b.col));
    var r0 = Math.max(0, Math.min(a.row, b.row)), r1 = Math.min(g - 1, Math.max(a.row, b.row));
    var out = [];
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) out.push({ col: c, row: r });
    }
    return out;
  }

  function updateSelBadge() {
    var badge = null;
    try { badge = document.getElementById("data-sel-count"); } catch (e) { badge = null; }
    if (!badge) return;
    if (!api.selection.length) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.textContent = api.selection.length + (api.selection.length === 1 ? " tile" : " tiles");
    }
  }

  function setSelection(tiles) {
    var seen = {}, out = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t) continue;
      var k = t.col + "," + t.row;
      if (!seen[k]) { seen[k] = true; out.push({ col: t.col, row: t.row }); }
    }
    api.selection = out;
    api.selected = out.length ? out[0] : null;
    api.pendingZone = null;
    api.pendingBuilding = null;
    // keyboard shift-extend keeps its anchor across repeated key presses;
    // every pointer path resets it via the flag left unset
    if (!api._kbExtend) api._kbAnchor = null;
    api._kbExtend = false;
    render();
    renderSelection();
    updateSelBadge();
  }

  // split the selection into zonable tiles vs excluded ones (unscanned or
  // unzonable terrain). Counts unscanned LAND separately for the targeted
  // "complete scanning" message.
  function selectionValidity() {
    var valid = [], invalid = 0, unscannedLand = 0;
    for (var i = 0; i < api.selection.length; i++) {
      var t = api.selection[i];
      if (window.ZoningTool && window.ZoningTool.isValidTile(t.col, t.row)) {
        valid.push(t);
      } else {
        invalid++;
        try {
          var tt = window.Terrain && window.Terrain.typeAt ? window.Terrain.typeAt(t.col, t.row) : null;
          var dd = window.GameState.getTileData(t.col, t.row);
          if (tt === "land" && dd && (!dd.droneScanned || !dd.gprScanned)) unscannedLand++;
        } catch (e) {}
      }
    }
    return { valid: valid, invalid: invalid, unscannedLand: unscannedLand };
  }

  // ---- tile details panel -------------------------------------------------
  // Existing survey rows are byte-identical for a lone tile; the DESIGNATE
  // ZONE section below them is the merged zoning flow.

  function singleTileRows(col, row) {
    if (!api.detailsEl) return "";
    var d = window.GameState.getTileData(col, row);
    var cat = categoryById(categoryFor(d.bestUse));
    var textColor = (cat.id === "unsuitable" || cat.id === "commercial" || cat.id === "industrial") ? "#FFFFFF" : "#2D3561";

    var html = "";
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
    return html;
  }

  // ---- DESIGNATE ZONE + BUILDINGS -----------------------------------------
  // Zone button -> building cards (2 per zone) -> inline confirm with batch
  // totals (permit + building − resource payout) and the worst contradiction
  // verdict across the selection. Re-tapping cancels. No separate screen.

  function pollutionPips(n) {
    var s = "";
    for (var i = 0; i < 3; i++) s += i < n ? "●" : "○";
    return s;
  }

  function buildingSub(spec) {
    if (spec.role === "booster") return "+" + Math.round(spec.boost * 100) + "% neighbors";
    if (spec.role === "extractor") return "$" + spec.incomePerTick + "/tick + payout";
    return "$" + spec.incomePerTick + "/tick";
  }

  function zoneButtonHTML(z, enabled, active) {
    var extra = "";
    if (active) {
      var fg = (z.id === "industrial" || z.id === "mining") ? "#FFFFFF" : "#2B2320";
      extra = ' style="background:' + z.color + ';color:' + fg + '"';
    }
    return '<button type="button" class="hq-data-zone-btn' + (active ? ' hq-data-zone-btn--active' : '') +
      '" data-zone="' + z.id + '"' + (enabled ? '' : ' disabled') + extra + '>' +
      '<span class="hq-data-zone-dot" style="background:' + z.color + '"></span>' +
      '<span class="hq-data-zone-label">' + z.label + '</span></button>';
  }

  function zoneSectionHTML(sel, v) {
    var zt = window.ZoningTool;
    var html = '<div class="hq-data-zone">';
    html += '<div class="hq-data-zone-title">Designate Zone</div>';
    if (sel.length === 1 && v.valid.length === 1 && zt) {
      var d0 = window.GameState.getTileData(sel[0].col, sel[0].row);
      if (d0 && d0.zoneType) {
        html += '<div class="hq-data-zone-note">Currently zoned: <strong>' + zt.zoneLabelFor(d0.zoneType) +
          '</strong>' + (d0.zoneMismatched ? ' (mismatch)' : '') + '</div>';
      }
    }
    if (!zt) { html += '</div>'; return html; }
    var zones = zt.zoneTypes();
    html += '<div class="hq-data-zone-grid">';
    for (var i = 0; i < zones.length; i++) {
      html += zoneButtonHTML(zones[i], v.valid.length > 0, api.pendingZone === zones[i].id);
    }
    html += '</div>';
    if (!v.valid.length) {
      html += '<div class="hq-data-zone-note">' +
        (v.unscannedLand > 0 ? 'Complete scanning to designate a zone' : 'No zonable land in selection') + '</div>';
    } else if (api.pendingZone) {
      var quote = zt.getCostForTiles(v.valid, api.pendingZone);
      html += '<div class="hq-data-zone-note">Zone designation applies to selected land. Use the Build menu to construct one building at a time.</div>';
      if (quote) {
        html += '<div class="hq-data-zone-cost">Permit — $' + quote.totalCost.toLocaleString() + '</div>';
        html += '<button type="button" class="hq-order-btn hq-data-zone-confirm-btn" data-zone-confirm="1">Confirm Zone</button>';
      }
    } else if (v.invalid > 0) {
      html += '<div class="hq-data-zone-note">' + v.invalid + ' tile(s) excluded (unscanned or unzonable)</div>';
    }
    html += '</div>';
    return html;
  }

  function worstVerdict(v) {
    var bl = window.Buildings;
    var worst = "ok", nWorst = 0;
    for (var i = 0; i < v.valid.length; i++) {
      var t = v.valid[i];
      var d = window.GameState.getTileData(t.col, t.row);
      var vd = bl ? bl.verdictFor(api.pendingZone, d ? d.bestUse : null) : "ok";
      if (vd === "severe") {
        if (worst !== "severe") { worst = "severe"; nWorst = 0; }
        nWorst++;
      } else if (vd === "mild" && worst === "ok") {
        worst = "mild";
        nWorst++;
      } else if (vd === "mild") {
        if (worst === "mild") nWorst++;
      }
    }
    return { verdict: worst, count: nWorst, total: v.valid.length };
  }

  function wireZonePanel() {
    if (!api.detailsEl || !api.detailsEl.querySelectorAll) return;
    var zbtns = api.detailsEl.querySelectorAll("[data-zone]");
    for (var i = 0; i < zbtns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled) return;
          var z = btn.getAttribute ? btn.getAttribute("data-zone") : (btn.dataset && btn.dataset.zone);
          api.pendingZone = (api.pendingZone === z) ? null : z; // re-tap cancels
          api.pendingBuilding = null;
          renderSelection();
        });
      })(zbtns[i]);
    }
    var zoneConfirms = api.detailsEl.querySelectorAll("[data-zone-confirm]");
    for (var zc = 0; zc < zoneConfirms.length; zc++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled || !api.pendingZone || !window.ZoningTool) return;
          var res = window.ZoningTool.confirmZoning(selectionValidity().valid, api.pendingZone);
          if (res && res.ok) {
            api.lastZoneMsg = "Zoned " + res.breakdown.validTiles.length + " tile(s) as " +
              window.ZoningTool.zoneLabelFor(api.pendingZone) + " — $" + res.breakdown.totalCost.toLocaleString();
            api.pendingZone = null;
            api.pendingBuilding = null;
          }
          api.refresh();
        });
      })(zoneConfirms[zc]);
    }
    var sbtns = api.detailsEl.querySelectorAll("[data-scrub]");
    for (var s = 0; s < sbtns.length; s++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled || !window.Economy || !api.selected) return;
          var res = window.Economy.scrubTile(api.selected.col, api.selected.row);
          if (res && res.ok) {
            api.lastZoneMsg = "Scrubbed " + api.selected.col + "," + api.selected.row + " clean — $" +
              (window.Economy.SCRUB_COST || 150).toLocaleString();
          } else if (res && res.reason === "funds") {
            api.lastZoneMsg = "";
          }
          api.refresh();
        });
      })(sbtns[s]);
    }
    var bbtns2 = api.detailsEl.querySelectorAll("[data-stabilize-batch]");
    for (var b2 = 0; b2 < bbtns2.length; b2++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled || !window.Economy) return;
          var bad = unsuitableIn(api.selection);
          if (!bad.length) return;
          var fee = window.Economy.STABILIZE_COST || 500;
          if ((window.GameState ? window.GameState.cash : 0) < bad.length * fee) {
            api.lastZoneMsg = "";
            api.refresh();
            return;
          }
          var tally = {}, paid = 0, done = 0;
          for (var i = 0; i < bad.length; i++) {
            var res = window.Economy.stabilizeTile(bad[i].col, bad[i].row);
            if (res && res.ok) {
              paid += res.net;
              done++;
              tally[res.bestUse] = (tally[res.bestUse] || 0) + 1;
            }
          }
          var parts = [];
          for (var k in tally) {
            if (Object.prototype.hasOwnProperty.call(tally, k)) parts.push(tally[k] + " " + k);
          }
          api.lastZoneMsg = "Stabilized " + done + " tile(s) (" + parts.join(", ") + ") — $" + paid.toLocaleString();
          api.refresh();
        });
      })(bbtns2[b2]);
    }
    var tbtns = api.detailsEl.querySelectorAll("[data-stabilize]");
    for (var t = 0; t < tbtns.length; t++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          if (btn.disabled || !window.Economy || !api.selected) return;
          var res = window.Economy.stabilizeTile(api.selected.col, api.selected.row);
          if (res && res.ok) {
            api.lastZoneMsg = "Stabilized " + api.selected.col + "," + api.selected.row + " → " + res.bestUse +
              " — $" + res.net.toLocaleString();
          }
          api.refresh();
        });
      })(tbtns[t]);
    }
  }

  // ground-condition readout + compactor scrub action. Single tile gets the
  // full readout and the scrub key; multi-select only reports the count
  // (scrubbing is one tile at a time, like a work order).
  function conditionHTML(sel) {
    var ec = window.Economy;
    var html = "";
    if (sel.length === 1) {
      var t = sel[0];
      var d = window.GameState.getTileData(t.col, t.row);
      var stain = (d && d.pollution) || 0;
      if (d && (d.blighted || stain > 0)) {
        html += '<div class="hq-data-zone-note' + (d.blighted ? ' hq-data-verdict-severe' : '') + '">';
        html += d.blighted ? 'Blighted — earns $0 until scrubbed'
          : ('Ground stain ' + Math.round(stain) + '%' + (stain >= 60 ? ' — income −50%' : ''));
        html += '</div>';
        var owned = !!(window.GameState && window.GameState.compactorSystemPurchased);
        var fee = (ec && ec.SCRUB_COST) || 150;
        if (owned) {
          html += '<button type="button" class="hq-order-btn hq-data-zone-confirm-btn" data-scrub="1">Scrub — $' +
            fee.toLocaleString() + '</button>';
        } else {
          html += '<div class="hq-data-zone-note">Scrubbing needs the Dynamic Compactor (STORE)</div>';
        }
      }
    } else if (sel.length > 1) {
      var n = 0;
      for (var i = 0; i < sel.length; i++) {
        var dd = window.GameState.getTileData(sel[i].col, sel[i].row);
        if (dd && (dd.blighted || (dd.pollution || 0) > 0)) n++;
      }
      if (n > 0) html += '<div class="hq-data-zone-note">' + n + ' selected tile(s) stained — select one to scrub</div>';
    }
    return html;
  }

  // stabilize box: Unsuitable tiles can be reclaimed. Single tile gets the
  // solo work order; multi-select batches every Unsuitable tile at once
  // (same drag flow as zoning — no tile-by-tile clicking).
  function unsuitableIn(sel) {
    var out = [];
    for (var i = 0; i < sel.length; i++) {
      var d = window.GameState.getTileData(sel[i].col, sel[i].row);
      if (d && d.bestUse === "Unsuitable") out.push(sel[i]);
    }
    return out;
  }
  function stabilizeHTML(sel) {
    if (!sel.length || !window.Economy) return "";
    var fee = window.Economy.STABILIZE_COST || 500;
    var owned = !!(window.GameState && window.GameState.compactorSystemPurchased);
    var html = "";
    if (sel.length === 1) {
      var d = window.GameState.getTileData(sel[0].col, sel[0].row);
      if (!d || d.bestUse !== "Unsuitable") return "";
      html += '<div class="hq-data-zone-note">Unstable ground — reclaim as buildable land (outcome follows surroundings)</div>';
      if (owned) {
        html += '<button type="button" class="hq-order-btn hq-data-zone-confirm-btn" data-stabilize="1">Stabilize — $' +
          fee.toLocaleString() + '</button>';
      } else {
        html += '<div class="hq-data-zone-note">Reclaiming needs the Dynamic Compactor (STORE)</div>';
      }
      return html;
    }
    // multi-select: batch every Unsuitable tile in one work order
    var bad = unsuitableIn(sel);
    if (!bad.length) return "";
    var total = bad.length * fee;
    var cash = window.GameState ? window.GameState.cash : 0;
    html += '<div class="hq-data-zone-note">' + bad.length + ' unstable tile(s) — reclaim as buildable land (each outcome follows its surroundings)</div>';
    if (owned) {
      if (cash >= total) {
        html += '<button type="button" class="hq-order-btn hq-data-zone-confirm-btn" data-stabilize-batch="1">Stabilize ' +
          bad.length + ' — $' + total.toLocaleString() + '</button>';
      } else {
        html += '<button type="button" class="hq-order-btn hq-data-zone-confirm-btn" data-stabilize-batch="1" disabled>Insufficient funds</button>' +
          '<div class="hq-data-zone-note">Have $' + cash.toLocaleString() + ' of $' + total.toLocaleString() + '</div>';
      }
    } else {
      html += '<div class="hq-data-zone-note">Reclaiming needs the Dynamic Compactor (STORE)</div>';
    }
    return html;
  }

  function renderSelection() {
    if (!api.detailsEl) return;
    var sel = api.selection;
    var html = "";
    if (!sel.length) {
      html = '<div class="hq-data-details-empty">Select a tile on the mini-map to see its survey data. New here? Order a Drone in STORE, deploy it from INVENTORY, then review tiles here.</div>';
    } else if (sel.length === 1) {
      html = singleTileRows(sel[0].col, sel[0].row);
      html += zoneSectionHTML(sel, selectionValidity());
      html += stabilizeHTML(sel);
      html += conditionHTML(sel);
    } else {
      var v = selectionValidity();
      html += '<div class="hq-data-details-row"><span>Selected</span><strong>' + sel.length + ' tiles</strong></div>';
      html += '<div class="hq-data-details-row"><span>Zonable</span><strong>' + v.valid.length + ' tiles</strong></div>';
      html += zoneSectionHTML(sel, v);
      html += stabilizeHTML(sel);
      html += conditionHTML(sel);
    }
    if (api.lastZoneMsg) {
      html = '<div class="hq-data-zone-success">' + api.lastZoneMsg + '</div>' + html;
      api.lastZoneMsg = "";
    }
    api.detailsEl.innerHTML = html;
    wireZonePanel();
  }

  // ---- category summary list ----------------------------------------------

  function renderCategories() {
    if (!api.categoriesEl) return;
    var counts = getCounts();
    var g = gridSize();
    var total = g * g;
    var html = "";
    for (var i = 0; i < CATEGORIES.length; i++) {
      var cat = CATEGORIES[i];
      var pct = total > 0 ? Math.max(0, Math.min(100, counts[cat.id] / total * 100)) : 0;
      html += '<div class="hq-data-cat-row">' +
        '<span class="hq-data-cat-swatch" style="background:' + cat.color + '"></span>' +
        '<span class="hq-data-cat-label">' + cat.label + '</span>' +
        '<span class="hq-data-cat-count">' + counts[cat.id] + ' tiles</span>' +
        '<span class="hq-data-cat-bar"><span style="width:' + pct.toFixed(1) + '%;background:' + cat.color + '"></span></span>' +
      '</div>';
    }
    api.categoriesEl.innerHTML = html;
  }

  // ---- click handling -----------------------------------------------------

  function onCanvasClick(e) {
    if (!api.canvas) return;
    // pointer handlers already committed this gesture (tap or drag) — the
    // trailing click must not collapse a fresh multi-select back to one tile
    if (api.suppressClick) { api.suppressClick = false; return; }
    var t = tileFromClient(e.clientX, e.clientY);
    if (!t) return;
    setSelection([t]);
  }

  // ---- keyboard operation (P0 parity with pointer) -------------------------
  // Arrows move a tile cursor (drawn as a coral dashed ring, distinct from
  // the solid selection rings); Enter/Space selects; Shift+Arrows grows a
  // multi-select rect live; Escape clears the selection (and stays in the
  // panel — it must not bubble up to the HQ close handler).

  function moveCursor(dx, dy, extend) {
    var g = gridSize();
    var cur = api.cursor || (api.selected
      ? { col: api.selected.col, row: api.selected.row }
      : { col: Math.floor(g / 2), row: Math.floor(g / 2) });
    var next = {
      col: Math.max(0, Math.min(g - 1, cur.col + dx)),
      row: Math.max(0, Math.min(g - 1, cur.row + dy)),
    };
    if (extend) {
      if (!api._kbAnchor) api._kbAnchor = { col: cur.col, row: cur.row };
      api.cursor = next;
      api._kbExtend = true;
      setSelection(rectTiles(api._kbAnchor, next));
    } else {
      api._kbAnchor = null;
      api.cursor = next;
      render();
    }
  }

  function onCanvasKey(e) {
    if (!e || !e.key) return;
    var k = e.key;
    var dx = 0, dy = 0;
    if (k === "ArrowLeft") dx = -1;
    else if (k === "ArrowRight") dx = 1;
    else if (k === "ArrowUp") dy = -1;
    else if (k === "ArrowDown") dy = 1;
    else if (k === "Enter" || k === " ") {
      if (e.preventDefault) e.preventDefault();
      if (api.cursor) setSelection([api.cursor]);
      else {
        var g = gridSize();
        api.cursor = { col: Math.floor(g / 2), row: Math.floor(g / 2) };
        render();
      }
      return;
    } else if (k === "Escape") {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      setSelection([]);
      return;
    } else {
      return;
    }
    if (e.preventDefault) e.preventDefault();
    moveCursor(dx, dy, !!(e.shiftKey));
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

  // ---- fit-to-frame sizing + mobile pan/pinch-zoom ---------------------------
  // The canvas is always fit-bound to its wrap (see .hq-data-minimap-wrap):
  // fitMap() measures the wrap's inner box and sets the zoom=1 baseline to
  // min(innerW, innerH), so all 20x20 tiles stay fully visible with no outer
  // scroll on ANY breakpoint (desktop short windows, mobile landscape
  // ~390px). One-finger drag pans (wrap scroll), two-finger pinch scales the
  // canvas up to PINCH_MAX for tap precision — clipped inside the wrap only,
  // never spilling into tab layout. touch-action:none on the canvas keeps
  // the browser out of the way.

  var PINCH_MIN = 1;
  var PINCH_MAX = 2.5;
  var FIT_MIN_PX = 80; // never size the map below this (keeps tiles tappable)

  function wrapInnerSize() {
    if (!api.wrap) return null;
    var w = api.wrap.clientWidth, h = api.wrap.clientHeight;
    if (window.getComputedStyle) {
      var cs = window.getComputedStyle(api.wrap);
      w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    }
    return { w: w, h: h };
  }

  // Size the map so the whole square fits the wrap at zoom 1, preserving the
  // 1:1 aspect ratio. Safe to call while hidden (no-op, retried on refresh).
  function fitMap() {
    if (!api.canvas || !api.wrap) return;
    var inner = wrapInnerSize();
    if (!inner || inner.w <= 0 || inner.h <= 0) return;
    api._touch.baseWidth = Math.max(FIT_MIN_PX, Math.floor(Math.min(inner.w, inner.h)));
    applyZoom(api._touch.zoom);
    if (api._touch.zoom <= PINCH_MIN + 0.001) {
      api.wrap.scrollLeft = 0;
      api.wrap.scrollTop = 0;
    }
  }

  // requestAnimationFrame-deferred fit (layout must be computed — the DATA
  // section is display:none until its tab opens).
  function fitMapSoon() {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () { fitMap(); });
    } else {
      fitMap();
    }
  }

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
      var inner = wrapInnerSize();
      var fallback = inner ? Math.min(inner.w, inner.h) : (api.canvas ? api.canvas.clientWidth : 320);
      api._touch.baseWidth = Math.max(FIT_MIN_PX, Math.floor(fallback) || 320);
    }
    var px = Math.round(api._touch.baseWidth * api._touch.zoom);
    api.canvas.style.width = px + "px";
    api.canvas.style.height = px + "px"; // explicit square: aspect preserved at every zoom
  }

  function isTouchPointer(e) {
    return e && e.pointerType === "touch";
  }

  // ---- unified pointer handling: tap = single select, drag = multi-select,
  // pinch = zoom, lone-finger drag while zoomed = pan (unchanged behavior).
  // Mouse always drag-selects (desktop never pans the mini-map). Touch
  // drag-selects only at zoom 1, where the whole map is visible and no pan
  // is needed; zoomed touches keep panning. Any pointer-committed selection
  // sets suppressClick so the trailing click event never double-selects.

  function beginSelectDrag(tile, x, y) {
    api.drag = { anchor: tile, end: tile, moved: false, select: true, sx: x, sy: y };
    api._kbAnchor = null; // pointer takes over from any keyboard gesture
  }

  function updateSelectDrag(tile, x, y) {
    if (!api.drag || !api.drag.select) return;
    if (tile) api.drag.end = tile;
    var dx = x - (api.drag.sx || x), dy = y - (api.drag.sy || y);
    if (tile && (tile.col !== api.drag.anchor.col || tile.row !== api.drag.anchor.row)) api.drag.moved = true;
    if (Math.hypot(dx, dy) > 6) api.drag.moved = true;
    render();
  }

  function commitSelectDrag() {
    if (!api.drag || !api.drag.select) return;
    var tiles = api.drag.moved ? rectTiles(api.drag.anchor, api.drag.end) : [api.drag.anchor];
    api.drag = null;
    api.suppressClick = true;
    setSelection(tiles);
  }

  function onTouchPointerDown(e) {
    if (!isTouchPointer(e)) { onMouseDown(e); return; }
    api._touch.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { api.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    var pts = touchPointers();
    if (pts.length >= 2) {
      // switch to pinch: remember start distance + zoom level
      api._touch.pinch = { dist: touchDist(pts[0], pts[1]), zoom: api._touch.zoom };
      api._touch.panStart = null;
      api.drag = null;
    } else {
      api._touch.pinch = null;
      var tile = tileFromClient(e.clientX, e.clientY);
      if (tile && api._touch.zoom <= PINCH_MIN + 0.001) {
        // whole map visible: one finger draws a selection, not a pan
        beginSelectDrag(tile, e.clientX, e.clientY);
        api._touch.panStart = null;
      } else {
        api.drag = null;
        api._touch.panStart = {
          x: e.clientX, y: e.clientY,
          sx: api.wrap ? api.wrap.scrollLeft : 0,
          sy: api.wrap ? api.wrap.scrollTop : 0,
        };
      }
    }
  }

  function onMouseDown(e) {
    if (e && typeof e.button === "number" && e.button !== 0) return; // left button only
    var tile = tileFromClient(e.clientX, e.clientY);
    if (!tile) return;
    try { if (api.canvas.setPointerCapture && e.pointerId !== undefined) api.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    beginSelectDrag(tile, e.clientX, e.clientY);
  }

  function onTouchPointerMove(e) {
    if (!isTouchPointer(e)) { onMouseMove(e); return; }
    if (!api._touch.pointers[e.pointerId]) return;
    api._touch.pointers[e.pointerId].x = e.clientX;
    api._touch.pointers[e.pointerId].y = e.clientY;
    if (api._touch.pinch) {
      var pts = touchPointers();
      if (pts.length >= 2 && api._touch.pinch.dist > 0) {
        applyZoom(api._touch.pinch.zoom * touchDist(pts[0], pts[1]) / api._touch.pinch.dist);
      }
    } else if (api.drag && api.drag.select) {
      updateSelectDrag(tileFromClient(e.clientX, e.clientY), e.clientX, e.clientY);
    } else if (api._touch.panStart && api.wrap) {
      api.wrap.scrollLeft = api._touch.panStart.sx - (e.clientX - api._touch.panStart.x);
      api.wrap.scrollTop = api._touch.panStart.sy - (e.clientY - api._touch.panStart.y);
    }
  }

  function onMouseMove(e) {
    updateSelectDrag(tileFromClient(e.clientX, e.clientY), e.clientX, e.clientY);
  }

  function onTouchPointerEnd(e) {
    if (!isTouchPointer(e)) { onMouseUp(e); return; }
    delete api._touch.pointers[e.pointerId];
    if (api.drag && api.drag.select) commitSelectDrag();
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

  function onMouseUp(e) {
    if (api.drag && api.drag.select) commitSelectDrag();
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
    // generous backing store (CSS size is fit-bound and usually smaller):
    // stays crisp when pinch-zoomed up to PINCH_MAX on hidpi screens.
    var cell = Math.round(32 * dpr);
    api.canvas.width = g * cell;
    api.canvas.height = g * cell;
    api.ctx = api.canvas.getContext("2d");

    api.canvas.addEventListener("click", onCanvasClick);
    api.canvas.addEventListener("pointerdown", onTouchPointerDown);
    api.canvas.addEventListener("pointermove", onTouchPointerMove);
    api.canvas.addEventListener("pointerup", onTouchPointerEnd);
    api.canvas.addEventListener("pointercancel", onTouchPointerEnd);
    // keyboard operation: focusable canvas with arrow/Enter/Escape contract.
    // No widget role: the canvas is custom-drawn, so a labelled group with
    // live-region details is the honest mapping (not a fake grid widget).
    if (api.canvas.setAttribute) {
      api.canvas.setAttribute("tabindex", "0");
      api.canvas.setAttribute("aria-label",
        "Site survey map. Arrow keys move the tile cursor. Enter selects a tile. " +
        "Hold Shift with arrow keys to select many tiles. Escape clears the selection.");
    }
    api.canvas.addEventListener("keydown", onCanvasKey);
    api.canvas.addEventListener("focus", function () { api.canvasFocused = true; render(); });
    api.canvas.addEventListener("blur", function () { api.canvasFocused = false; render(); });

    // always-visible compact legend strip (desktop under the map, mobile
    // above it in the map column — no toggle needed)
    renderLegend();

    api.refresh();

    // keep the fit live across rotation / window resize / devtools docking.
    // (bound once; api.wrap is fixed for the session)
    if (!api._resizeBound && typeof window.addEventListener === "function") {
      api._resizeBound = true;
      window.addEventListener("resize", fitMapSoon);
      window.addEventListener("orientationchange", fitMapSoon);
    }
    fitMapSoon();

    // entrance animation (anime.js) for the DATA tab blocks.
    // Captures (index.html#shot=*) skip it: final state, synchronously.
    var shot = false;
    try {
      shot = !!window.__SHOT ||
        (window.location && (window.location.hash || "").indexOf("#shot") === 0);
    } catch (e) { shot = false; }
    if (!shot && typeof anime !== "undefined" && anime) {
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
  // is opened/viewed, so fresh scan data is always reflected. Resets zoom to
  // 1 and re-fits, so the tab always opens with the FULL map visible;
  // pinch-zoom stays available for tap precision.
  api.refresh = function () {
    api._touch.zoom = PINCH_MIN;
    api._touch.baseWidth = 0; // re-measured in fitMap (rotation may change it)
    api.pendingZone = null; // fresh intent each open; the selection itself persists
    api.pendingBuilding = null;
    render();
    renderCategories();
    renderSelection();
    updateSelBadge();
    fitMapSoon();
  };

  // pure helpers exposed for debugging/tests
  api._categoryFor = categoryFor;
  api._getCounts = getCounts;
  api._fitMap = fitMap;
  api._pinchRange = function () { return { min: PINCH_MIN, max: PINCH_MAX }; };

  return api;
})();