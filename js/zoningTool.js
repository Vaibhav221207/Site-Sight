/* js/zoningTool.js — Zoning paint: assign zoneType to scanned land tiles.
 * Reuses the Dynamic Compactor's exact mechanic: drag-select with live
 * grid-snapped rectangle preview, lock-in on release, confirm/cancel,
 * continuous mode, and Stop. No cost in this step.
 */

window.ZoningTool = (function () {
  var api = {
    isActive: false,
    _selection: null,
    _selectionStart: null,
    _selectionEnd: null,
    _activeZoneType: null, // residential/commercial/industrial/mining for this placement session
  };

  var ZONE_COLORS = {
    residential: "#66BB6A",
    commercial:  "#42A5F5",
    industrial:  "#8D6E63",
    mining:      "#FFB300"
  };

  function zoneColor() {
    var z = api._activeZoneType || (window.HqPanel && window.HqPanel.selectedZoneType);
    return ZONE_COLORS[z] || "#42A5F5";
  }

  api.startPlacement = function () {
    var sel = window.HqPanel && window.HqPanel.selectedZoneType;
    if (!sel) {
      if (window.HqPanel) window.HqPanel.showMsg("Select a zone type first", true);
      return false;
    }
    api._activeZoneType = sel;
    api.isActive = true;
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode('zoning');
      window.InputHandler.setCursor("crosshair");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(true);
      window.InputHandler.setCursor("crosshair");
    }
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "inline-flex";
    var muStop = document.getElementById("mu-stop");
    if (muStop) muStop.style.display = "inline-flex";
    if (window.HqPanel) window.HqPanel.showMsg("Drag to paint " + sel + " zone onto scanned land", false);
    console.log("[Zoning] Placement entered zone=" + sel);
    return true;
  };

  api.setPreview = function (startScreen, endScreen) {
    api._selectionStart = startScreen ? { x: startScreen.x, y: startScreen.y } : null;
    api._selectionEnd = endScreen ? { x: endScreen.x, y: endScreen.y } : null;
  };

  api.clearPreview = function () {
    api._selectionStart = null;
    api._selectionEnd = null;
  };

  api.cancel = function () {
    api.isActive = false;
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    api._activeZoneType = null;
    if (window.InputHandler && window.InputHandler.setMode) {
      if (window.InputHandler.getMode() === 'zoning') window.InputHandler.setMode('idle');
      window.InputHandler.setCursor("grab");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "none";
    var muStop2 = document.getElementById("mu-stop");
    if (muStop2) muStop2.style.display = "none";
  };

  // Only flat, droneScanned land tiles can be zoned
  api.isValidTile = function (col, row) {
    if (!window.Terrain || !window.GameState) return false;
    var t = window.Terrain.typeAt(col, row);
    if (t === "river" || t === "rock" || t === "trench" || t === "hq") return false;
    if (t !== "land") return false;
    var d = window.GameState.getTileData(col, row);
    if (!d || !d.droneScanned) return false;
    return true;
  };

  api.isValid = function (col, row) { return api.isValidTile(col, row); };

  api.getValidTilesInSelection = function (selection) {
    var tiles = [];
    for (var c = selection.startCol; c <= selection.endCol; c++) {
      for (var r = selection.startRow; r <= selection.endRow; r++) {
        if (api.isValidTile(c, r)) tiles.push({ col: c, row: r });
      }
    }
    return tiles;
  };

  api.confirmSelection = function (selection, onSuccess) {
    var validTiles = api.getValidTilesInSelection(selection);
    if (validTiles.length === 0) {
      if (window.HqPanel) window.HqPanel.showMsg("No scannable land in selection", true);
      return false;
    }
    var zone = api._activeZoneType || (window.HqPanel && window.HqPanel.selectedZoneType);
    if (!zone) {
      if (window.HqPanel) window.HqPanel.showMsg("Select a zone type first", true);
      return false;
    }
    // No cost in this step
    for (var i = 0; i < validTiles.length; i++) {
      var t = validTiles[i];
      var d = window.GameState.getTileData(t.col, t.row);
      d.zoneType = zone;
      if (window.GameState.recalcBestUse) window.GameState.recalcBestUse(t.col, t.row);
    }
    if (window.BlockRender) {
      window.BlockRender.invalidate();
      if (window.BlockRender.popTiles) window.BlockRender.popTiles(validTiles);
    }
    console.log("[Zoning] Painted " + validTiles.length + " tiles as " + zone);
    // Continuous mode: stay in zoning, keep active zone
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode('zoning');
      window.InputHandler.setCursor("crosshair");
    }
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "inline-flex";
    var muStop = document.getElementById("mu-stop");
    if (muStop) muStop.style.display = "inline-flex";
    if (window.HqPanel) window.HqPanel.showMsg("Zoned " + validTiles.length + " tile(s) as " + zone + " — drag another area or Stop", false);
    if (typeof onSuccess === "function") onSuccess(true);
    return true;
  };

  // ---- preview rendering (mirrors Compactor's drawBlueprintPreview but color-coded) ----
  function drawPreview(ctx, grid) {
    if (!api.isActive || !api._selectionStart || !api._selectionEnd) return false;
    var gs = grid;
    if (!gs || !gs.isoSize) return false;
    var iso = gs.isoSize, half = iso / 2;
    var sTile = gs.screenToTile(api._selectionStart.x, api._selectionStart.y);
    var eTile = gs.screenToTile(api._selectionEnd.x, api._selectionEnd.y);
    if (!sTile || !eTile) {
      var p1 = api._selectionStart, p2 = api._selectionEnd;
      var x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
      var w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = zoneColor();
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = zoneColor();
      ctx.globalAlpha = 0.15;
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
      return true;
    }
    var sc = Math.min(sTile.col, eTile.col), ec = Math.max(sTile.col, eTile.col);
    var sr = Math.min(sTile.row, eTile.row), er = Math.max(sTile.row, eTile.row);
    sc = Math.max(0, sc); sr = Math.max(0, sr);
    ec = Math.min(gs.gridSize - 1, ec); er = Math.min(gs.gridSize - 1, er);
    var total = (ec - sc + 1) * (er - sr + 1);
    var validCount = 0;
    var cxSum = 0, cySum = 0, nTiles = 0;
    for (var c = sc; c <= ec; c++) {
      for (var r = sr; r <= er; r++) {
        if (api.isValidTile(c, r)) validCount++;
      }
    }
    var tiles = [];
    for (var c2 = sc; c2 <= ec; c2++) for (var r2 = sr; r2 <= er; r2++) tiles.push({c:c2,r:r2});
    tiles.sort(function(a,b){ return (a.c+a.r)-(b.c+b.r); });
    var col = zoneColor();
    // hex to rgba for fill
    var fillCol = col;
    // convert #RRGGBB to rgba
    var rC = parseInt(col.slice(1,3),16), gC = parseInt(col.slice(3,5),16), bC = parseInt(col.slice(5,7),16);
    var fillRgba = "rgba("+rC+","+gC+","+bC+",0.22)";
    var strokeRgba = col;
    ctx.save();
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var p = gs.worldToScreen(t.c, t.r);
      var x0 = p.x, y0 = p.y;
      var topY = y0 - 4;
      var isValid = api.isValidTile(t.c, t.r);
      cxSum += x0; cySum += topY; nTiles++;
      ctx.beginPath();
      ctx.moveTo(x0, topY - half);
      ctx.lineTo(x0 + iso, topY);
      ctx.lineTo(x0, topY + half);
      ctx.lineTo(x0 - iso, topY);
      ctx.closePath();
      if (isValid) {
        ctx.fillStyle = fillRgba;
        ctx.fill();
        ctx.strokeStyle = strokeRgba;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x0, topY - half*0.55);
        ctx.lineTo(x0 + iso*0.55, topY);
        ctx.lineTo(x0, topY + half*0.55);
        ctx.lineTo(x0 - iso*0.55, topY);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.09)";
        ctx.fill();
        ctx.strokeStyle = "rgba(43,35,32,0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4,3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x0 - iso*0.6, topY);
        ctx.lineTo(x0 + iso*0.6, topY);
        ctx.moveTo(x0, topY - half*0.6);
        ctx.lineTo(x0, topY + half*0.6);
        ctx.strokeStyle = "rgba(43,35,32,0.10)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
    if (nTiles > 0) {
      var bx = cxSum / nTiles;
      var by = (cySum / nTiles) - iso - 18;
      var label = validCount + " zone";
      if (total !== validCount) label += " / " + total + " tiles";
      else label = total + (total===1?" zone tile":" zone tiles");
      var dims = (ec - sc + 1) + "\u00D7" + (er - sr + 1);
      ctx.save();
      ctx.font = "700 13px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var padX = 10, padY = 6;
      var tw = ctx.measureText(label).width;
      var tw2 = ctx.measureText(dims).width;
      var bw = Math.max(tw, tw2) + padX*2;
      var bh = 32;
      ctx.fillStyle = "#FFFBF0";
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx - bw/2, by - bh/2, bw, bh, 10); }
      else { ctx.rect(bx - bw/2, by - bh/2, bw, bh); }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx - bw/2 + 2, by - bh/2 + 2, bw, bh, 10); }
      ctx.fill();
      ctx.fillStyle = "#2B2320";
      ctx.font = "700 10px 'Baloo 2', sans-serif";
      ctx.fillText(dims, bx, by - 7);
      ctx.font = "700 11px 'Baloo 2', sans-serif";
      ctx.fillStyle = validCount > 0 ? "#0E8A5A" : "#C0392B";
      ctx.fillText(label, bx, by + 7);
      ctx.restore();
    }
    return true;
  }

  api.render = function (ctx, grid) {
    drawPreview(ctx, grid);
  };

  return api;
})();
