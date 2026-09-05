/* js/input.js — single unified tile-interaction state machine.
 *
 * ONE state variable (InteractionState.mode) gates every canvas pointer.
 * No tool registers its own canvas listener; all clicks/drags/pans flow
 * through exactly ONE pointerdown/pointermove/pointerup triple on the
 * canvas, which dispatches to the active mode's handler and returns.
 *
 * Modes: 'idle' (default), 'placing-hq', 'compacting',
 *        'deploying-drone' (whole-map, no click target, kept for symmetry)
 * Idle is the only mode that shows HQ terminal or tile popup.
 * Any non-idle mode consumes the click entirely. (Zoning lives in the DATA
 * tab mini-map now — there is no canvas zoning mode anymore.)
 *
 * Pan (5px drag threshold) works in idle; drag-select preview works in
 * compacting; pinch-zoom is not handled here (DataMap owns its
 * minimap pinch, main map uses pointer-drag pan only) and is left
 * untouched so it cannot conflict.
 */

window.InputHandler = (function () {
  var DRAG_THRESHOLD = 5;

  // ---- single source of truth ----
  var InteractionState = { mode: 'idle' }; // 'idle' | 'placing-hq' | 'compacting' | 'deploying-drone'

  var api = {
    canvas: null,
    grid: null,
    terrain: null,
    InteractionState: InteractionState, // exposed for tools and debugging
    _userOnTileClick: null, // (col,row) -> void  (idle-mode inspect)
    onPan: null,
    _pressed: false,
    _dragging: false,
    _activePointer: null,
    _dragStart: { x: 0, y: 0 },
    _lastPos: { x: 0, y: 0 },
    _compactorDragStart: null,
    _compactorSelectionEnd: null,
    _cursor: "grab",
    // backward-compat mirrors (derived from InteractionState.mode, not independent)
    _placementMode: false,
    _droneMode: false,
  };

  // keep legacy booleans in sync for callers that still read them
  function syncLegacyFlags() {
    var m = InteractionState.mode;
    api._placementMode = (m === 'placing-hq' || m === 'compacting');
    api._droneMode = (m === 'deploying-drone');
    // legacy alias used by some callers
    api._compactorDragSelect = (m === 'compacting' && api._pressed && !!api._compactorDragStart);
  }

  api.setMode = function (mode) {
    InteractionState.mode = mode;
    syncLegacyFlags();
    // cursor management per mode
    if (mode === 'placing-hq' || mode === 'compacting') {
      api.setCursor("crosshair");
    } else if (mode === 'idle') {
      api.setCursor("grab");
    }
  };

  api.getMode = function () { return InteractionState.mode; };

  // legacy wrappers — now delegate to InteractionState
  api.isPlacementMode = function () { return api._placementMode; };
  api.setPlacementMode = function (v) {
    // true means placing-hq (BuildMenu/HQBuild path); false means idle
    // Compactor callers should use api.setMode('compacting') directly
    if (v) {
      if (InteractionState.mode === 'idle') api.setMode('placing-hq');
    } else {
      if (InteractionState.mode === 'placing-hq') api.setMode('idle');
    }
  };
  api.isDroneMode = function () { return api._droneMode; };
  api.setDroneMode = function (v) {
    if (v) api.setMode('deploying-drone');
    else if (InteractionState.mode === 'deploying-drone') api.setMode('idle');
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
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dragstart", function (e) { e.preventDefault(); });
  }

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

  function pointerPos(evt) {
    var rect = api.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  // ---- mode-specific handlers (all go through central dispatch) ----

  function handlePlacingHq(pos, tile) {
    if (!tile) return;
    // HQBuild validates land/rock/river/trench and cash; on success it
    // will call BuildMenu.onBuildSuccess which resets mode to idle
    var success = window.HQBuild && window.HQBuild.attempt(tile.col, tile.row, function () {
      api.setMode('idle');
      if (window.BuildMenu && window.BuildMenu.onBuildSuccess) window.BuildMenu.onBuildSuccess();
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      if (typeof api.onPan === "function") api.onPan();
    });
    if (!success) {
      // stay in placing-hq so player can pick another tile
    } else {
      // HQBuild.attempt already called onSuccess which set idle, but ensure
      api.setMode('idle');
    }
  }

  function handleCompactingClick(pos, tile) {
    // Compactor uses drag-select, not single clicks; single clicks are ignored
    // while compacting is active. The drag flow is handled in pointerDown/Move/Up
    // when mode === 'compacting'. If a click without drag occurs, do nothing.
  }

  function handleIdleClick(pos, tile) {
    // HQ tile always opens terminal, never the small popup
    var isHq = false;
    if (tile) {
      isHq = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(tile.col, tile.row)) ||
             (window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === tile.col && window.GameState.hqTile.row === tile.row);
    }
    if (isHq && window.HqPanel) {
      if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
      window.BlockRender.setSelected(tile.col, tile.row);
      window.HqPanel.open();
      if (typeof api.onPan === "function") api.onPan();
      return;
    }
    if (tile && isClickable(tile.col, tile.row)) {
      api.onTileClick(tile.col, tile.row);
    }
  }

  // ---- central pointer handlers (exactly ONE pair) ----

  function onPointerDown(evt) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (api._pressed) return;
    api._pressed = true;
    api._dragging = false;
    api._activePointer = evt.pointerId;
    if (api.canvas.setPointerCapture) {
      try { api.canvas.setPointerCapture(evt.pointerId); } catch (e) {}
    }
    var pos = pointerPos(evt);
    api._dragStart = pos;
    api._lastPos = pos;

    // Mode-gated drag start
    if (InteractionState.mode === 'compacting' && window.CompactorTool && window.CompactorTool.isActive) {
      api._compactorDragStart = pos;
      api._compactorSelectionEnd = pos;
      window.CompactorTool.setPreview(pos, pos);
    } else if (InteractionState.mode === 'idle' && !api._droneMode) {
      api.canvas.style.cursor = "grabbing";
    }
  }

  function onPointerMove(evt) {
    if (api._pressed && evt.pointerId !== api._activePointer) return;
    var pos = pointerPos(evt);
    // Drone hover preview (whole-map, no placement) — still gated by mode
    if (InteractionState.mode === 'deploying-drone' && window.DroneDeploy) {
      var hoverTile = api.grid.screenToTile(pos.x, pos.y);
      window.DroneDeploy.setHover(hoverTile ? hoverTile.col : null, hoverTile ? hoverTile.row : null);
    }
    if (!api._pressed) return;
    if (window.HqPanel && window.HqPanel.isOpen) return;

    // Mode-gated drag preview
    if (InteractionState.mode === 'compacting' && window.CompactorTool && window.CompactorTool.isActive) {
      api._compactorSelectionEnd = pos;
      window.CompactorTool.setPreview(api._compactorDragStart, pos);
      if (window.BlockRender) window.BlockRender.invalidate();
      return;
    }
    var dx = pos.x - api._lastPos.x;
    var dy = pos.y - api._lastPos.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= DRAG_THRESHOLD) api._dragging = true;
    if (api._dragging) {
      // Pan only in idle (or when not in a drag-select mode)
      if (InteractionState.mode === 'idle') {
        api.grid.camera.x += dx;
        api.grid.camera.y += dy;
        api._lastPos = pos;
        if (typeof api.onPan === "function") api.onPan();
      } else {
        // In placing modes, dragging is for selection, not pan — still update lastPos for threshold
        api._lastPos = pos;
      }
      return;
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
      try { api.canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
    }
    if (InteractionState.mode !== 'compacting') {
      api.canvas.style.cursor = api._cursor;
    }

    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (cancelled) return;

    var pos = pointerPos(evt);
    var moved = Math.sqrt(Math.pow(pos.x - api._dragStart.x, 2) + Math.pow(pos.y - api._dragStart.y, 2));

    // ---- compacting drag-select completion (mode-gated) ----
    if (InteractionState.mode === 'compacting' && window.CompactorTool && window.CompactorTool.isActive) {
      var compStart = api._compactorDragStart;
      api._compactorDragStart = null;
      api._compactorSelectionEnd = null;
      if (!compStart) {
        window.CompactorTool.clearPreview();
        if (window.BlockRender) window.BlockRender.invalidate();
        return;
      }
      var startTile = api.grid.screenToTile(compStart.x, compStart.y);
      var endTile = api.grid.screenToTile(pos.x, pos.y);
      if (startTile && endTile) {
        var startCol = Math.min(startTile.col, endTile.col);
        var endCol = Math.max(startTile.col, endTile.col);
        var startRow = Math.min(startTile.row, endTile.row);
        var endRow = Math.max(startTile.row, endTile.row);
        var selection = { startCol: startCol, endCol: endCol, startRow: startRow, endRow: endRow };
        if (window.CompactorTool.isValidSelection) {
          var validTiles = window.CompactorTool.getValidTilesInSelection(selection);
          if (validTiles.length > 0) {
            if (window.HqPanel) window.HqPanel.showMsg("Compacting " + validTiles.length + " trench tile" + (validTiles.length>1?"s":"") + "…", false);
            window.CompactorTool.confirmSelection(selection, function() {});
            // compactor stays in 'compacting' (continuous mode); Stop control will set idle
          } else {
            window.CompactorTool.clearPreview();
            if (window.HqPanel) window.HqPanel.showMsg("No trench tiles — need scanned trench, not Excellent", true);
            if (window.BlockRender) window.BlockRender.invalidate();
          }
        }
      } else {
        window.CompactorTool.clearPreview();
        if (window.BlockRender) window.BlockRender.invalidate();
      }
      return;
    }

    if (moved >= DRAG_THRESHOLD) return; // was a pan, not a click

    // Dismiss popup on any tap in idle (so it never blocks map on mobile)
    if (InteractionState.mode === 'idle' && window.TilePanel && window.TilePanel.isOpen) {
      // Don't auto-close if the tap will immediately reopen the same tile — let toggle handle it
      // Instead, we hide and let the dispatch below decide; toggle will handle same-tile close
      window.TilePanel.hide();
    }

    // Resolve tile under cursor (with fat-finger fallback on touch)
    var tile = api.grid.screenToTile(pos.x, pos.y);
    if (!tile && window.MobileUI && window.MobileUI.enabled) {
      tile = nearestTile(pos.x, pos.y);
    }
    if (!tile) return;

    // ---- central dispatch by mode (ORDER MATTERS) ----
    // Any non-idle mode consumes the click entirely and returns — idle popup logic never runs
    if (InteractionState.mode === 'placing-hq') {
      handlePlacingHq(pos, tile);
      return;
    }
    if (InteractionState.mode === 'compacting') {
      handleCompactingClick(pos, tile);
      return;
    }
    if (InteractionState.mode === 'deploying-drone') {
      // whole-map deploy has no click target; ignore clicks while deploying
      return;
    }

    // ---- idle mode only beyond this point ----
    // HQ building footprint check (tower overhang maps to neighbor via Math.round)
    // Do this BEFORE generic isClickable so HQ never shows tile popup
    var hq = window.GameState && window.GameState.hqTile;
    if (hq) {
      try {
        var hp2 = api.grid.worldToScreen(hq.col, hq.row);
        var iso2 = api.grid.isoSize, half2 = iso2/2;
        var elev2 = (window.Terrain && window.Terrain.elevationAt) ? window.Terrain.elevationAt(hq.col, hq.row) : 0;
        var groundY2 = hp2.y - (4 + elev2);
        // base diamond (1.35 covers helipad wings)
        var dx0 = Math.abs(pos.x - hp2.x);
        var dy0 = Math.abs(pos.y - groundY2);
        if (dx0/iso2 + dy0/half2 <= 1.35) {
          window.BlockRender.setSelected(hq.col, hq.row);
          if (window.HqPanel) window.HqPanel.open();
          if (typeof api.onPan === "function") api.onPan();
          return;
        }
        var bHalf2 = iso2 * 0.99;
        var tHalf2 = iso2 * 0.60;
        var hHalf2 = tHalf2 * 1.22;
        var baseH2 = Math.max(8, Math.round(iso2 * 0.42));
        var towerH2 = Math.max(14, Math.round(iso2 * 0.78));
        var antH2 = Math.max(12, Math.round(iso2 * 0.55));
        var baseTopY2 = groundY2 - baseH2;
        var towerTopY2 = baseTopY2 - towerH2;
        var topY2 = towerTopY2 - tHalf2/2 - antH2 - 10;
        var botY2 = groundY2 + half2;
        var buildingHalfW2 = Math.max(bHalf2, hHalf2) + 4;
        if (Math.abs(pos.x - hp2.x) <= buildingHalfW2 * 0.85 && pos.y >= topY2 && pos.y <= botY2) {
          window.BlockRender.setSelected(hq.col, hq.row);
          if (window.HqPanel) window.HqPanel.open();
          if (typeof api.onPan === "function") api.onPan();
          return;
        }
      } catch(e){}
    }

    // Exact HQ tile (replaces tile, never inspectable)
    var isHqAt = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(tile.col, tile.row)) ||
                 (hq && hq.col===tile.col && hq.row===tile.row);
    if (isHqAt) {
      window.BlockRender.setSelected(tile.col, tile.row);
      if (window.HqPanel) window.HqPanel.open();
      if (typeof api.onPan === "function") api.onPan();
      return;
    }

    // Normal idle inspect — only non-HQ, clickable tiles
    if (isClickable(tile.col, tile.row)) {
      api.onTileClick(tile.col, tile.row);
    }
  }

  function isClickable(c, r) {
    if (!api.terrain) return true;
    if (InteractionState.mode === 'placing-hq') {
      return !!(window.HQBuild && window.HQBuild.isValid(c, r));
    }
    if (InteractionState.mode === 'compacting') {
      return !!(window.CompactorTool && window.CompactorTool.isValidTile && window.CompactorTool.isValidTile(c, r));
    }
    if (InteractionState.mode === 'deploying-drone') {
      return !!(window.DroneDeploy && window.DroneDeploy.isValid && window.DroneDeploy.isValid(c, r));
    }
    // idle: rock & river are scenery, HQ is replaced by building (not inspectable)
    var type = api.terrain.typeAt(c, r);
    if (type === "rock" || type === "river" || type === "hq") return false;
    var hq2 = window.GameState && window.GameState.hqTile;
    if (hq2 && hq2.col === c && hq2.row === r) return false;
    return true;
  }

  api.isTileOccupied = function (c, r) {
    return (window.GameState.hqTile && window.GameState.hqTile.col === c && window.GameState.hqTile.row === r);
  };
  api.isScanBusy = isScanBusy;
  api.isPlacementMode = function () { return InteractionState.mode === 'placing-hq' || InteractionState.mode === 'compacting'; };
  api.setPlacementMode = function (v) {
    if (v) { if (InteractionState.mode === 'idle') api.setMode('placing-hq'); }
    else { if (InteractionState.mode === 'placing-hq') api.setMode('idle'); }
  };
  api.isDroneMode = function () { return InteractionState.mode === 'deploying-drone'; };
  api.setDroneMode = function (v) {
    if (v) api.setMode('deploying-drone');
    else if (InteractionState.mode === 'deploying-drone') api.setMode('idle');
  };
  api.setCursor = function (v) {
    api._cursor = v || "grab";
    if (api.canvas) api.canvas.style.cursor = api._cursor;
  };

  function isScanBusy() {
    return !!((window.DroneDeploy && window.DroneDeploy.deploying) ||
              (window.GprDeploy && window.GprDeploy.deploying));
  }

  api.onTileClick = function (col, row) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (isScanBusy()) return;
    // This is only called from idle dispatch, but keep guards for direct callers
    if (InteractionState.mode !== 'idle') return;
    if (typeof api._userOnTileClick === "function") {
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