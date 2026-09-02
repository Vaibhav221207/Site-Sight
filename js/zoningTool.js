/* js/zoningTool.js — Zoning paint: assign zoneType to scanned land tiles.
 * Step 2: drag-select with live grid-snapped rectangle preview, lock-in on release, confirm/cancel, continuous mode, and Stop.
 * Step 3: cost calculation with mismatch penalty, cash deduction, and mismatch visual cue.
 */

window.ZoningTool = (function () {
  var api = {
    isActive: false,
    _selection: null,
    _selectionStart: null,
    _selectionEnd: null,
    _activeZoneType: null,
    _pendingSelection: null, // locked-in selection awaiting confirm (Step 3)
    _pendingCost: null,      // { matched, mismatched, totalCost, validTiles }
  };

  var ZONE_COLORS = {
    residential: "#66BB6A",
    commercial:  "#42A5F5",
    industrial:  "#8D6E63",
    mining:      "#FFB300"
  };

  var BASE_COST = 500;
  var MISMATCH_COST = 1000;

  function zoneColor() {
    var z = api._activeZoneType || (window.HqPanel && window.HqPanel.selectedZoneType);
    return ZONE_COLORS[z] || "#42A5F5";
  }

  function isMatch(zoneType, bestUse) {
    if (!zoneType || !bestUse) return false;
    return zoneType.toLowerCase() === bestUse.toLowerCase();
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
    api._pendingSelection = null;
    api._pendingCost = null;
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
    hideConfirmUI();
    return true;
  };

  api.setPreview = function (startScreen, endScreen) {
    api._selectionStart = startScreen ? { x: startScreen.x, y: startScreen.y } : null;
    api._selectionEnd = endScreen ? { x: endScreen.x, y: endScreen.y } : null;
    // If there's a pending selection, clear it when starting a new drag
    if (api._pendingSelection) {
      api._pendingSelection = null;
      api._pendingCost = null;
      hideConfirmUI();
    }
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
    api._pendingSelection = null;
    api._pendingCost = null;
    hideConfirmUI();
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

  api.getCostBreakdown = function (selection) {
    var validTiles = api.getValidTilesInSelection(selection);
    if (validTiles.length === 0) return null;
    var zone = api._activeZoneType || (window.HqPanel && window.HqPanel.selectedZoneType);
    if (!zone) return null;
    var matched = 0, mismatched = 0;
    for (var i = 0; i < validTiles.length; i++) {
      var t = validTiles[i];
      var d = window.GameState.getTileData(t.col, t.row);
      var bestUse = d ? d.bestUse : null;
      if (isMatch(zone, bestUse)) matched++;
      else mismatched++;
    }
    var totalCost = matched * BASE_COST + mismatched * MISMATCH_COST;
    return {
      validTiles: validTiles,
      matched: matched,
      mismatched: mismatched,
      totalCost: totalCost,
      zone: zone
    };
  };

  api.lockSelection = function (selection) {
    var breakdown = api.getCostBreakdown(selection);
    if (!breakdown || breakdown.validTiles.length === 0) {
      if (window.HqPanel) window.HqPanel.showMsg("No scannable land in selection", true);
      return false;
    }
    api._pendingSelection = selection;
    api._pendingCost = breakdown;
    showConfirmUI(breakdown);
    return true;
  };

  function showConfirmUI(breakdown) {
    hideConfirmUI();
    var cash = window.GameState ? window.GameState.cash : 0;
    var canAfford = cash >= breakdown.totalCost;
    var container = document.getElementById('zoning-confirm-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'zoning-confirm-container';
      container.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:1200;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:auto;';
      document.body.appendChild(container);
    }
    container.innerHTML = '';
    container.style.display = 'flex';
    var breakdownDiv = document.createElement('div');
    breakdownDiv.style.cssText = 'background:#FFFBF0;border:3px solid #2B2320;border-radius:14px;padding:10px 14px;box-shadow:3px 3px 0 #000;font-size:13px;font-weight:700;text-align:center;';
    if (canAfford) {
      var matchedText = breakdown.matched + ' matched ($' + (breakdown.matched * BASE_COST).toLocaleString() + ')';
      var mismatchedText = breakdown.mismatched + ' mismatched ($' + (breakdown.mismatched * MISMATCH_COST).toLocaleString() + ')';
      var totalText = '$' + breakdown.totalCost.toLocaleString();
      if (breakdown.mismatched === 0) {
        breakdownDiv.innerHTML = matchedText + ' = ' + totalText + ' — Confirm Zoning';
      } else if (breakdown.matched === 0) {
        breakdownDiv.innerHTML = mismatchedText + ' = ' + totalText + ' — Confirm Zoning';
      } else {
        breakdownDiv.innerHTML = matchedText + ' + ' + mismatchedText + ' = ' + totalText + ' — Confirm Zoning';
      }
      breakdownDiv.style.cursor = 'pointer';
      breakdownDiv.style.color = '#2B2320';
      breakdownDiv.addEventListener('click', function() {
        api.confirmPending();
      });
    } else {
      breakdownDiv.textContent = 'Insufficient funds ($' + cash.toLocaleString() + ' < $' + breakdown.totalCost.toLocaleString() + ')';
      breakdownDiv.style.color = '#C0392B';
      breakdownDiv.style.cursor = 'default';
    }
    container.appendChild(breakdownDiv);
    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';
    if (canAfford) {
      var confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.style.cssText = 'padding:8px 16px;background:#E8604A;border:3px solid #2B2320;border-radius:12px;color:#fff;font-weight:700;cursor:pointer;box-shadow:2px 2px 0 #000;';
      confirmBtn.addEventListener('click', function() { api.confirmPending(); });
      btnRow.appendChild(confirmBtn);
    }
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;background:#FFFBF0;border:3px solid #2B2320;border-radius:12px;color:#2B2320;font-weight:700;cursor:pointer;box-shadow:2px 2px 0 #000;';
    cancelBtn.addEventListener('click', function() {
      api._pendingSelection = null;
      api._pendingCost = null;
      hideConfirmUI();
      api.clearPreview();
      if (window.BlockRender) window.BlockRender.invalidate();
    });
    btnRow.appendChild(cancelBtn);
    container.appendChild(btnRow);
  }

  function hideConfirmUI() {
    var c = document.getElementById('zoning-confirm-container');
    if (c) c.style.display = 'none';
  }

  api.confirmPending = function (onSuccess) {
    if (!api._pendingSelection || !api._pendingCost) {
      if (window.HqPanel) window.HqPanel.showMsg("No selection to confirm", true);
      return false;
    }
    var breakdown = api._pendingCost;
    var zone = breakdown.zone;
    var cash = window.GameState ? window.GameState.cash : 0;
    if (cash < breakdown.totalCost) {
      if (window.HqPanel) window.HqPanel.showMsg("Insufficient funds", true);
      return false;
    }
    // Deduct cash
    window.GameState.cash -= breakdown.totalCost;
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    // Assign zoneType and zoneMismatched
    for (var i = 0; i < breakdown.validTiles.length; i++) {
      var t = breakdown.validTiles[i];
      var d = window.GameState.getTileData(t.col, t.row);
      d.zoneType = zone;
      var bestUse = d.bestUse;
      d.zoneMismatched = !isMatch(zone, bestUse);
      if (window.GameState.recalcBestUse) window.GameState.recalcBestUse(t.col, t.row);
    }
    if (window.BlockRender) {
      window.BlockRender.invalidate();
      if (window.BlockRender.popTiles) window.BlockRender.popTiles(breakdown.validTiles);
    }
    console.log("[Zoning] Painted " + breakdown.validTiles.length + " tiles as " + zone + " cost $" + breakdown.totalCost + " (matched " + breakdown.matched + " mismatched " + breakdown.mismatched + ")");
    // Clear pending but stay in zoning continuous mode
    api._pendingSelection = null;
    api._pendingCost = null;
    hideConfirmUI();
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
    if (window.HqPanel) window.HqPanel.showMsg("Zoned " + breakdown.validTiles.length + " tile(s) as " + zone + " — drag another area or Stop", false);
    if (typeof onSuccess === "function") onSuccess(true);
    return true;
  };

  // Backward compat: direct confirm without UI (used by tests)
  api.confirmSelection = function (selection, onSuccess) {
    // For tests, directly compute cost and confirm without UI
    var breakdown = api.getCostBreakdown(selection);
    if (!breakdown) {
      if (window.HqPanel) window.HqPanel.showMsg("No scannable land in selection", true);
      return false;
    }
    var cash = window.GameState ? window.GameState.cash : 0;
    if (cash < breakdown.totalCost) {
      if (window.HqPanel) window.HqPanel.showMsg("Insufficient funds", true);
      return false;
    }
    api._pendingSelection = selection;
    api._pendingCost = breakdown;
    return api.confirmPending(onSuccess);
  };

  // ---- preview rendering (mirrors Compactor's drawBlueprintPreview but color-coded) ----
  function drawPreview(ctx, grid) {
    if (!api.isActive || !api._selectionStart || !api._selectionEnd) return false;
    // If there's a pending locked selection, don't show live preview (confirm UI is shown instead)
    if (api._pendingSelection) return false;
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
    var col = zoneColor();
    // hex to rgba for fill
    var rC = parseInt(col.slice(1,3),16), gC = parseInt(col.slice(3,5),16), bC = parseInt(col.slice(5,7),16);
    var fillRgba = "rgba("+rC+","+gC+","+bC+",0.22)";
    var strokeRgba = col;
    var tiles = [];
    for (var c2 = sc; c2 <= ec; c2++) for (var r2 = sr; r2 <= er; r2++) tiles.push({c:c2,r:r2});
    tiles.sort(function(a,b){ return (a.c+a.r)-(b.c+b.r); });
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
    // Also draw pending confirm badge if locked
    if (api._pendingSelection && api._pendingCost) {
      var sel = api._pendingSelection;
      var cost = api._pendingCost;
      var gs = grid;
      if (!gs || !gs.isoSize) return;
      var iso = gs.isoSize;
      var cxSum2 = 0, cySum2 = 0, n2 = 0;
      for (var c3 = sel.startCol; c3 <= sel.endCol; c3++) for (var r3 = sel.startRow; r3 <= sel.endRow; r3++) {
        var pp = gs.worldToScreen(c3, r3);
        cxSum2 += pp.x; cySum2 += pp.y - 4; n2++;
      }
      if (n2 === 0) return;
      var bx2 = cxSum2 / n2;
      var by2 = (cySum2 / n2) - iso - 30;
      var cash2 = window.GameState ? window.GameState.cash : 0;
      var canAfford2 = cash2 >= cost.totalCost;
      var text2, sub2;
      if (canAfford2) {
        if (cost.mismatched === 0) text2 = cost.matched + " matched ($" + (cost.matched*BASE_COST).toLocaleString() + ") = $" + cost.totalCost.toLocaleString() + " — Confirm Zoning";
        else if (cost.matched === 0) text2 = cost.mismatched + " mismatched ($" + (cost.mismatched*MISMATCH_COST).toLocaleString() + ") = $" + cost.totalCost.toLocaleString() + " — Confirm Zoning";
        else text2 = cost.matched + " matched ($" + (cost.matched*BASE_COST).toLocaleString() + ") + " + cost.mismatched + " mismatched ($" + (cost.mismatched*MISMATCH_COST).toLocaleString() + ") = $" + cost.totalCost.toLocaleString() + " — Confirm Zoning";
        sub2 = "";
      } else {
        text2 = "Insufficient funds";
        sub2 = "$" + cash2.toLocaleString() + " < $" + cost.totalCost.toLocaleString();
      }
      // Use canvas badge for confirm (also have DOM confirm, but this is visible on map)
      // We keep DOM confirm as primary, this is just a visual on map
    }
  };

  return api;
})();
