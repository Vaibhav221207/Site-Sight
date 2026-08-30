/* js/input.js — canvas pointer input: pan (press+drag) + tile click
 * detection. Uses the Pointer Events API so mouse and touch share ONE
 * code path (pointerdown/pointermove/pointerup fire identically for both).
 *   - Drag threshold prevents accidental clicks during panning.
 *   - Pointer capture keeps the drag smooth even off-canvas and releases
 *     cleanly, so no mouseleave-style handler is needed.
 *   - In placement mode (HQ build), only valid flat land tiles are
 *     clickable.
 *   - Normal mode: hill & river tiles are non-interactive scenery; only
 *     land and trench tiles trigger a click.
 */

window.InputHandler = (function () {
  var DRAG_THRESHOLD = 5; // px movement before we treat the gesture as a drag

  var api = {
    canvas: null,
    grid: null,
    terrain: null,
    _userOnTileClick: null, // (col, row) -> void  (normal-mode inspect click)
    onPan: null,            // () -> void   (called after each pan frame)
    _pressed: false,
    _dragging: false,
    _activePointer: null,   // pointerId currently tracked (multi-touch guard)
    _dragStart: { x: 0, y: 0 },
    _lastPos: { x: 0, y: 0 },
    _placementMode: false,
    _droneMode: false,      // drone placement mode (click-to-place a drone)
    _compactorDragSelect: false,
    _compactorDragStart: null,
    _compactorSelectionEnd: null,
    _cursor: "grab",
  };

  api.init = function (canvas, grid, onTileClick, onPan, terrain) {
    api.canvas = canvas;
    api.grid = grid;
    api.terrain = terrain || null;
    api._userOnTileClick = typeof onTileClick === "function" ? onTileClick : function () {};
    api.onPan = typeof onPan === "function" ? onPan : function () {};
    bind(canvas);
  };

  function bind(canvas) {
    canvas.style.cursor = "grab";
    // Pointer Events: one code path for mouse + touch. touch-action must be
    // none (CSS also sets it) so the browser never hijacks a drag for
    // scrolling/zooming and pointermove keeps streaming.
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dragstart", function (e) { e.preventDefault(); });
  }

  // fat-finger tap snapping (touch devices only, where tiles are small):
  // resolve the tap to the NEAREST tile center within a forgiving radius
  // instead of requiring an exact hit inside the diamond. Checks all four
  // candidate lattice centers around the tap (exact nearest by screen
  // distance) and returns null when nothing is within radius.
  function nearestTile(sx, sy) {
    var g = api.grid;
    var fr = g.screenToWorld(sx, sy);
    var c0 = Math.floor(fr.col);
    var r0 = Math.floor(fr.row);
    var R = Math.max(18, g.isoSize * 0.8);
    var best = null;
    var bestD = Infinity;
    for (var dc = 0; dc <= 1; dc++) {
      for (var dr = 0; dr <= 1; dr++) {
        var c = c0 + dc, r = r0 + dr;
        if (c < 0 || c >= g.gridSize || r < 0 || r >= g.gridSize) continue;
        var p = g.worldToScreen(c, r);
        var dx = sx - p.x, dy = sy - p.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { col: c, row: r }; }
      }
    }
    if (!best || Math.sqrt(bestD) > R) return null;
    return best;
  }

  // pointer position in CSS pixels relative to the canvas
  function pointerPos(evt) {
    var rect = api.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function onPointerDown(evt) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (api._pressed) return;
    api._pressed = true;
    api._dragging = false;
    api._compactorDragSelect = false;
    api._activePointer = evt.pointerId;
    if (api.canvas.setPointerCapture) {
      try { api.canvas.setPointerCapture(evt.pointerId); } catch (e) {}
    }
    var pos = pointerPos(evt);
    api._dragStart = pos;
    api._lastPos = pos;
    if (window.CompactorTool && window.CompactorTool.isActive) {
      api._compactorDragSelect = true;
      api._compactorDragStart = pos;
      api._compactorSelectionEnd = pos;
      window.CompactorTool.setPreview(pos, pos);
    } else if (!api._droneMode) {
      api.canvas.style.cursor = "grabbing";
    }
  }

  function onPointerMove(evt) {
    if (api._pressed && evt.pointerId !== api._activePointer) return;
    var pos = pointerPos(evt);
    if (api._droneMode && window.DroneDeploy) {
      var tile = api.grid.screenToTile(pos.x, pos.y);
      window.DroneDeploy.setHover(tile ? tile.col : null, tile ? tile.row : null);
    }
    if (!api._pressed) return;
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (api._compactorDragSelect && window.CompactorTool && window.CompactorTool.isActive) {
      var cur = pointerPos(evt);
      api._compactorSelectionEnd = cur;
      window.CompactorTool.setPreview(api._compactorDragStart, cur);
      if (window.BlockRender) window.BlockRender.invalidate();
      return;
    }
    var dx = pos.x - api._lastPos.x;
    var dy = pos.y - api._lastPos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= DRAG_THRESHOLD) api._dragging = true;
    if (api._dragging) {
      api.grid.camera.x += dx;
      api.grid.camera.y += dy;
      api._lastPos = pos;
      if (typeof api.onPan === "function") api.onPan();
      return; // don't fire a click while panning
    }
  }

  function onPointerUp(evt) {
    if (evt.pointerId !== api._activePointer) return;
    var cancelled = evt.type === "pointercancel";
    if (!api._pressed) return;
    api._pressed = false;
    api._dragging = false;
    api._activePointer = null;
    if (api.canvas.releasePointerCapture) {
      try { api.canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
    }
    if (!api._droneMode) api.canvas.style.cursor = api._cursor;

    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (cancelled) return;

    var pos = pointerPos(evt);
    var moved = Math.sqrt(
      Math.pow(pos.x - api._dragStart.x, 2) + Math.pow(pos.y - api._dragStart.y, 2)
    );

    if (api._compactorDragSelect && window.CompactorTool && window.CompactorTool.isActive) {
      api._compactorDragSelect = false;
      var endPos = pos;
      api._compactorSelectionEnd = endPos;
      if (api._compactorDragStart) {
        var startTile = api.grid.screenToTile(api._compactorDragStart.x, api._compactorDragStart.y);
        var endTile = api.grid.screenToTile(endPos.x, endPos.y);
        if (startTile && endTile) {
          var startCol = Math.min(startTile.col, endTile.col);
          var endCol = Math.max(startTile.col, endTile.col);
          var startRow = Math.min(startTile.row, endTile.row);
          var endRow = Math.max(startTile.row, endTile.row);
          var selection = { startCol: startCol, endCol: endCol, startRow: startRow, endRow: endRow };
          if (window.CompactorTool && window.CompactorTool.isValidSelection) {
            var validTiles = window.CompactorTool.getValidTilesInSelection(selection);
            if (validTiles.length > 0) {
              // no native confirm — compact directly with a chunky toast
              if (window.HqPanel) window.HqPanel.showMsg("Compacting " + validTiles.length + " trench tile" + (validTiles.length>1?"s":"") + "…", false);
              window.CompactorTool.confirmSelection(selection, function() {});
            } else {
              window.CompactorTool.clearPreview();
              if (window.HqPanel) window.HqPanel.showMsg("No trench tiles — need scanned trench, not Excellent", true);
              if (window.BlockRender) window.BlockRender.invalidate();
            }
          }
        } else {
          // drag outside grid — clear ghost
          window.CompactorTool.clearPreview();
          if (window.BlockRender) window.BlockRender.invalidate();
        }
        api._compactorDragStart = null;
        api._compactorSelectionEnd = null;
        return;
      }
      // no start recorded — clear ghost
      window.CompactorTool.clearPreview();
      if (window.BlockRender) window.BlockRender.invalidate();
      api._compactorDragStart = null;
      api._compactorSelectionEnd = null;
      return;
    }

    if (moved < DRAG_THRESHOLD) {
      // HQ has a taller visual than its tile — taps on the tower/beacon
      // would otherwise map to a neighbor tile. Treat any tap within a
      // generous radius of the HQ as an HQ tap.
      var hq = window.GameState && window.GameState.hqTile;
      var isHqAt = function(c,r){
        return (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(c,r)) ||
               (hq && hq.col===c && hq.row===r);
      };
      // Old mechanism that worked: exact HQ tile never pops, plus a tight
      // building hit for the tower that overhangs. No large circle.
      if (hq) {
        try {
          var hp2 = api.grid.worldToScreen(hq.col, hq.row);
          var iso2 = api.grid.isoSize, half2 = iso2/2;
          // exact diamond hit for the base tile
          var dx0 = Math.abs(pos.x - hp2.x);
          var dy0 = Math.abs(pos.y - (hp2.y - 4));
          if (dx0/iso2 + dy0/half2 <= 1) {
            if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
            window.BlockRender.setSelected(hq.col, hq.row);
            if (window.HqPanel) window.HqPanel.open();
            if (typeof api.onPan === "function") api.onPan();
            return;
          }
          // tower column above the diamond (narrow, so it doesn't cover neighbors)
          var bHalf2 = iso2 * 0.99;
          var tHalf2 = iso2 * 0.60;
          var towerW = tHalf2 * 0.9;
          if (Math.abs(pos.x - hp2.x) <= towerW && pos.y >= hp2.y - 60 && pos.y <= hp2.y + half2) {
            if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
            window.BlockRender.setSelected(hq.col, hq.row);
            if (window.HqPanel) window.HqPanel.open();
            if (typeof api.onPan === "function") api.onPan();
            return;
          }
        } catch(e){}
      }
      // if the tile popup is open, close it first — a tap anywhere on the
      // canvas should dismiss the card so it never blocks the map on mobile
      if (window.TilePanel && window.TilePanel.isOpen) {
        window.TilePanel.hide();
      }
      var tile = api.grid.screenToTile(pos.x, pos.y);
      // touch devices: exact diamond hit, else fat-finger snap to the
      // nearest tile center (desktop keeps the strict hit test)
      if (!tile && window.MobileUI && window.MobileUI.enabled) {
        tile = nearestTile(pos.x, pos.y);
      }
      // Exact HQ tile — never show tile popup, always HQ terminal (replaces tile)
      if (tile && isHqAt(tile.col, tile.row)) {
        if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
        window.BlockRender.setSelected(tile.col, tile.row);
        if (window.HqPanel) window.HqPanel.open();
        if (typeof api.onPan === "function") api.onPan();
        return;
      }
      if (tile && isClickable(tile.col, tile.row)) {
        api.onTileClick(tile.col, tile.row);
      }
    }
  }

  function isClickable(c, r) {
    if (!api.terrain) return true;
    if (api._placementMode) {
      if (window.CompactorTool && window.CompactorTool.isActive) return !!(window.CompactorTool && window.CompactorTool.isValidTile && window.CompactorTool.isValidTile(c, r));
      return !!(window.HQBuild && window.HQBuild.isValid(c, r));
    }
    if (api._droneMode) {
      return !!(window.DroneDeploy && window.DroneDeploy.isValid(c, r));
    }
    // normal inspect mode: rock & river are scenery, HQ is replaced by the building (not inspectable)
    var type = api.terrain.typeAt(c, r);
    if (type === "rock" || type === "river" || type === "hq") return false;
    // also block via GameState.hqTile in case Terrain hasn't updated yet
    var hq = window.GameState && window.GameState.hqTile;
    if (hq && hq.col === c && hq.row === r) return false;
    return true;
  }

  api.isTileOccupied = function (c, r) {
    return (window.GameState.hqTile && window.GameState.hqTile.col === c && window.GameState.hqTile.row === r);
  };
  api.isScanBusy = isScanBusy;
  api.isPlacementMode = function () { return api._placementMode || false; };
  api.setPlacementMode = function (v) { api._placementMode = !!v; };
  api.isDroneMode = function () { return api._droneMode || false; };
  api.setDroneMode = function (v) { api._droneMode = !!v; };
  // set the canvas cursor (placement modes manage this rather than the grab
  // cursor that onDown/onUp would otherwise restore)
  api.setCursor = function (v) {
    api._cursor = v || "grab";
    if (api.canvas) api.canvas.style.cursor = api._cursor;
  };

  // true while a Drone or GPR sweep is running. During a scan the map tiles and
  // the HQ become non-interactive (no inspect popups, no HQ terminal) so the
  // scan reads cleanly; camera panning still works so the player can watch.
  function isScanBusy() {
    return !!((window.DroneDeploy && window.DroneDeploy.deploying) ||
              (window.GprDeploy && window.GprDeploy.deploying));
  }

  // single click router: drone placement -> DroneDeploy.attempt;
  // placement mode -> HQBuild.attempt; otherwise normal inspect click
  api.onTileClick = function (col, row) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (isScanBusy()) return; // tiles + HQ disabled while a scan is running
    if (api._droneMode) {
      if (window.DroneDeploy) {
        window.DroneDeploy.attempt(col, row);
      }
      return;
    }
    if (api._placementMode) {
      if (window.CompactorTool && window.CompactorTool.isActive) {
        var cSuccess = window.CompactorTool.attempt(col, row, function () {
          api.setPlacementMode(false);
          if (typeof api.onPan === "function") api.onPan();
        });
        if (!cSuccess) { /* invalid compactor target — stay in placement mode */ }
        return;
      }
        var success = window.HQBuild && window.HQBuild.attempt(col, row, function () {
          api.setPlacementMode(false);
          if (window.BuildMenu && window.BuildMenu.onBuildSuccess) window.BuildMenu.onBuildSuccess();
          if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
          if (typeof api.onPan === "function") api.onPan();
        });
      if (!success) {
        // invalid spot (river/hill/trench, already built, or not enough cash) —
        // stay in placement mode so the player can pick another tile
      }
    } else if (typeof api._userOnTileClick === "function") {
      var isHQ = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) ||
                 (window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === col && window.GameState.hqTile.row === row);
      if (isHQ && window.HqPanel) {
        if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
        window.BlockRender.setSelected(col, row);
        window.HqPanel.open();
        if (typeof api.onPan === "function") api.onPan();
      } else {
        api._userOnTileClick(col, row);
      }
    }
  };

  return api;
})();