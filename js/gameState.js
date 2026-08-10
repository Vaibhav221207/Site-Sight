/* js/gameState.js — persistent game state for Site Sight:
 *   - cash balance
 *   - HQ building status and tile position (if any)
 *   - owned inventory (extensible for future item types)
 *   - currently selected inventory item (for placement preview / deploy)
 *   - permanently scanned tiles (a Drone System scan marks every tile in its
 *     area; those tiles can never be re-scanned by a later deployment)
 */

window.GameState = (function () {
  var api = {
    cash: 50000,             // starting cash
    hqCost: 10000,            // fixed HQ cost
    hqBuilt: false,           // has the player built an HQ yet?
    hqTile: null,             // { col, row } of the HQ tile, or null
    // ONE-TIME purchase flag: the Drone System can be bought exactly once per
    // session. Stays true even after the drone is deployed/consumed (droneCount
    // returns to 0), so the STORE Order Drone button remains permanently
    // disabled — same permanent pattern as the Build HQ button.
    droneSystemPurchased: false,
    droneCost: 5000,          // price of one Drone System
    inventory: {              // owned items — add future item types here
      droneCount: 0,
      // id of the drone currently selected in the INVENTORY tab, or null.
      // Each drone is treated as an individually selectable unit even
      // though they share a unit type (Drone System).
      selectedDroneId: null,
      // resting tile of the most recently deployed drone swarm, or null.
      // Drone Systems are CONSUMABLE: confirming a deployment immediately
      // decrements droneCount (the deployed unit leaves the fleet).
      deployed: null,
    },
    // permanently scanned tiles, keyed "col,row" -> true. A completed Drone
    // System scan marks EVERY tile inside its 5x10 footprint; placing a new
    // scan centered on an already-scanned tile is rejected (scan-once rule).
    scanned: {},
  };

  // has this tile already been scanned by a completed deployment?
  api.isTileScanned = function (col, row) {
    return !!api.scanned[col + "," + row];
  };

  // mark every tile in an array of { col, row } as permanently scanned.
  api.markAreaScanned = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      api.scanned[tiles[i].col + "," + tiles[i].row] = true;
    }
  };

  return api;
})();
