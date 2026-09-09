/* Road placement: one tile at a time, like a city-builder street tool. */
window.RoadTool = (function () {
  var COST = 75;
  var api = {};

  api.startPlacement = function () {};
  api.cancel = function () {};
  api.isValid = function (col, row) {
    if (!window.GameState || !window.Terrain) return false;
    if (window.Terrain.typeAt(col, row) !== "land") return false;
    if (window.Terrain.isHQ && window.Terrain.isHQ(col, row)) return false;
    var data = window.GameState.getTileData ? window.GameState.getTileData(col, row) : null;
    // Roads may cross zoned land, just as in classic city builders. The zone
    // designation remains on the tile, but a building cannot occupy a road.
    if (window.GameState.roads[col + "," + row] || (data && data.zoneBuilding)) return false;
    var hq = window.GameState.hqTile;
    var adjacent = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < adjacent.length; i++) {
      var nc = col + adjacent[i][0], nr = row + adjacent[i][1];
      if (window.GameState.roads[nc + "," + nr]) return true;
      if (hq && hq.col === nc && hq.row === nr) return true;
    }
    return false;
  };
  api.connections = function (col, row) {
    var roads = window.GameState && window.GameState.roads || {};
    return {
      north: !!roads[col + "," + (row - 1)],
      east: !!roads[(col + 1) + "," + row],
      south: !!roads[col + "," + (row + 1)],
      west: !!roads[(col - 1) + "," + row]
    };
  };
  api.attempt = function (col, row) {
    if (!api.isValid(col, row) || window.GameState.cash < COST) return false;
    if (!window.GameState.spend(COST, "Road")) return false;
    window.GameState.roads[col + "," + row] = true;
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.BlockRender) {
      window.BlockRender.invalidate();
    }
    if (window.BuildMenu && window.BuildMenu.onBuildSuccess) window.BuildMenu.onBuildSuccess();
    return true;
  };
  api.cost = COST;
  return api;
})();
