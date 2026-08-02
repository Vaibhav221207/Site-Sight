/* js/input.js — canvas mouse input: pan (click+drag) + tile click detection.
 *   - Drag threshold prevents accidental clicks during panning.
 *   - In placement mode (HQ build), only valid flat land tiles are clickable.
 *   - Normal mode: hill & river tiles are non-interactive scenery; only land and trench tiles trigger a click.
 */

window.InputHandler = (function () {
  var DRAG_THRESHOLD = 5; // px movement before we treat the gesture as a drag

  var api = {
    canvas: null,
    grid: null,
    terrain: null,
    onTileClick: null,  // (col, row) -> void
    onPan: null,        // () -> void   (called after each pan frame)
    _pressed: false,
    _dragging: false,
    _dragStart: { x: 0, y: 0 },
    _lastPos: { x: 0, y: 0 },
    _placementMode: false,
  };

  api.init = function (canvas, grid, onTileClick, onPan, terrain) {
    api.canvas = canvas;
    api.grid = grid;
    api.terrain = terrain || null;
    api.onTileClick = typeof onTileClick === "function" ? onTileClick : function () {};
    api.onPan = typeof onPan === "function" ? onPan : function () {};
    bind(canvas);
  };

  function bind(canvas) {
    canvas.style.cursor = "grab";
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("dragstart", function (e) { e.preventDefault(); });
  }

  // mouse position in CSS pixels relative to the canvas
  function canvasPos(evt) {
    var rect = api.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function onDown(evt) {
    api._pressed = true;
    api._dragging = false;
    var pos = canvasPos(evt);
    api._dragStart = pos;
    api._lastPos = pos;
    api.canvas.style.cursor = "grabbing";
  }

  function onMove(evt) {
    if (!api._pressed) return;
    var pos = canvasPos(evt);
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

  function onUp(evt) {
    if (!api._pressed) return;
    api._pressed = false;
    api._dragging = false;
    api.canvas.style.cursor = "grab";

    var pos = canvasPos(evt);
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
    var type = api.terrain.typeAt(c, r);
    if (type === "hill" || type === "river") return false;
    if (api._placementMode) {
      if (!api.hqBuild || !api.hqBuild.isValid(c, r)) return false;
    }
    return true;
  }

  api.isTileOccupied = function (c, r) {
    return (window.GameState.hqTile && window.GameState.hqTile.col === c && window.GameState.hqTile.row === r);
  };
  api.isPlacementMode = function () { return api._placementMode || false; };
  api.setPlacementMode = function (v) { api._placementMode = !!v; };

  api.onTileClick = function (col, row) {
    if (api.isPlacementMode()) {
      var success = api.hqBuild.attempt(col, row, function () {
        api.setPlacementMode(false);
        window.TilePanel.toggle(col, row);
        api.onPan();
      });
      if (!success) {
        // optional: show a subtle invalid placement cue
      }
    } else {
      onTileClicked(col, row);
    }
  };

  return api;
})();

var onTileClicked = function(col, row) {
  window.BlockRender.setSelected(col, row);
  var terrain = window.Terrain;
  var panel = window.TilePanel;
  var isHQ = terrain && terrain.isHQ(col, row);

  if (isHQ) {
    panel.toggle(col, row, true);
  } else {
    panel.toggle(col, row);
  }
  window.Main.render();
};
