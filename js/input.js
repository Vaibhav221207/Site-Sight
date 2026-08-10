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

  // pointer position in CSS pixels relative to the canvas
  function pointerPos(evt) {
    var rect = api.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function onPointerDown(evt) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (api._pressed) return; // ignore secondary pointers (multi-touch)
    api._pressed = true;
    api._dragging = false;
    api._activePointer = evt.pointerId;
    // capture so the drag keeps tracking (and the release arrives) even
    // when the pointer leaves the canvas mid-drag
    if (api.canvas.setPointerCapture) {
      try { api.canvas.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
    }
    var pos = pointerPos(evt);
    api._dragStart = pos;
    api._lastPos = pos;
    if (!api._droneMode) api.canvas.style.cursor = "grabbing";
  }

  function onPointerMove(evt) {
    // only the pointer that started the gesture drives it
    if (api._pressed && evt.pointerId !== api._activePointer) return;
    var pos = pointerPos(evt);
    // drone placement preview follows the pointer even without a press
    if (api._droneMode && window.DroneDeploy) {
      var tile = api.grid.screenToTile(pos.x, pos.y);
      window.DroneDeploy.setHover(tile ? tile.col : null, tile ? tile.row : null);
    }
    if (!api._pressed) return;
    if (window.HqPanel && window.HqPanel.isOpen) return;
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
    if (cancelled) return; // gesture was interrupted (no click)

    var pos = pointerPos(evt);
    var moved = Math.sqrt(
      Math.pow(pos.x - api._dragStart.x, 2) + Math.pow(pos.y - api._dragStart.y, 2)
    );
    if (moved < DRAG_THRESHOLD) {
      var tile = api.grid.screenToTile(pos.x, pos.y);
      if (tile && isClickable(tile.col, tile.row)) {
        api.onTileClick(tile.col, tile.row);
      }
    }
  }

  function isClickable(c, r) {
    if (!api.terrain) return true;
    // placement modes defer to their own module validation (e.g. drones can
    // target hill/river/trench tiles, which are scenery in normal inspect mode)
    if (api._placementMode) {
      return !!(window.HQBuild && window.HQBuild.isValid(c, r));
    }
    if (api._droneMode) {
      return !!(window.DroneDeploy && window.DroneDeploy.isValid(c, r));
    }
    // normal inspect mode: hills & rivers are non-interactive scenery
    var type = api.terrain.typeAt(c, r);
    if (type === "hill" || type === "river") return false;
    return true;
  }

  api.isTileOccupied = function (c, r) {
    return (window.GameState.hqTile && window.GameState.hqTile.col === c && window.GameState.hqTile.row === r);
  };
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

  // single click router: drone placement -> DroneDeploy.attempt;
  // placement mode -> HQBuild.attempt; otherwise normal inspect click
  api.onTileClick = function (col, row) {
    if (window.HqPanel && window.HqPanel.isOpen) return;
    if (api._droneMode) {
      if (window.DroneDeploy) {
        window.DroneDeploy.attempt(col, row);
      }
      return;
    }
    if (api._placementMode) {
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
      var isHQ = window.Terrain && window.Terrain.isHQ(col, row);
      if (isHQ && window.HqPanel) {
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