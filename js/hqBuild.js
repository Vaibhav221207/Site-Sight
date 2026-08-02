/* js/hqBuild.js — handles ConTech HQ placement mode, validation,
 *   cash handling, and visual rendering of the HQ building.
 */

window.HQBuild = (function () {
  var api = {
    isActive: false,          // are we currently in HQ placement mode?
  };

  api.startPlacement = function () {
    api.isActive = true;
  };

  api.cancel = function () {
    api.isActive = false;
  };

  api.attempt = function (col, row, onSuccess) {
    var valid = api.isValid(col, row);
    if (!valid) return false;

    if (window.GameState.cash < window.GameState.hqCost) {
      return false;
    }

    window.GameState.cash -= window.GameState.hqCost;
    window.GameState.hqBuilt = true;
    window.GameState.hqTile = { col, row };

    // record the HQ tile as 'hq' in the terrain map (protected access)
    var terrain = window.Terrain;
    if (typeof terrain.setHQTile === "function") {
      terrain.setHQTile(row, col);
    } else {
      // fallback for compatibility: add a hidden property to the map array
      terrain.hqTileMap = terrain.hqTileMap || {};
      terrain.hqTileMap[row + "," + col] = true;
    }

    api.isActive = false;
    if (typeof onSuccess === "function") onSuccess(col, row);
    return true;
  };

  api.isValid = function (col, row) {
    if (!api.isActive) return false;

    var terrain = window.Terrain;
    var type = terrain.typeAt(col, row);

    if (type === "hill" || type === "river" || type === "trench") {
      return false;
    }

    if (window.GameState.hqTile && window.GameState.hqTile.col === col && window.GameState.hqTile.row === row) {
      return false;
    }

    // also check terrain-specific occupied flag (if any)
    if (typeof terrain.isTileOccupied === "function" && terrain.isTileOccupied(col, row)) {
      return false;
    }

    return true;
  };

  api.render = function (ctx, grid, col, row) {
    var g = grid;
    var iso = g.isoSize;
    var p = g.worldToScreen(col, row);
    var cx = p.x, cy = p.y;

    ctx.save();
    ctx.fillStyle = "#2a8";
    ctx.strokeStyle = "#135";
    ctx.lineWidth = 2;

    var height = iso * 1.8;
    var width = iso * 1.5;
    var topY = cy - height;

    ctx.fillStyle = "#2a8";
    ctx.fillRect(cx - width / 2, topY, width, height);

    ctx.beginPath();
    ctx.moveTo(cx - width * 0.4, topY);
    ctx.lineTo(cx + width * 0.4, topY);
    ctx.lineTo(cx, topY - iso * 0.6);
    ctx.closePath();
    ctx.fillStyle = "#135";
    ctx.fill();

    ctx.restore();
  };

  return api;
})();
