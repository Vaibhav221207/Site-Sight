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
    // ONE-TIME purchase flag for the GPR (Ground Penetrating Radar) System:
    // bought once to unlock the GPR fleet, then deployed as consumable units
    // (just like the Drone System). A GPR sweep is a SECOND survey tier that
    // reveals SUBSurface data (minerals, water table, stability) for tiles that
    // have already had an aerial Drone scan.
    gprSystemPurchased: false,
    gprCost: 4000,            // price of one GPR System
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
      // GPR fleet — mirrors the drone fleet.
      gprCount: 0,
      selectedGprId: null,
      gprDeployed: null,
    },
    // permanently scanned tiles (AERIAL / Drone tier), keyed "col,row" -> true.
    // A completed Drone System scan marks EVERY tile inside its 5x10 footprint;
    // placing a new scan centered on an already-scanned tile is rejected
    // (scan-once rule).
    scanned: {},
    // permanently SUBSURFACE-scanned tiles (GPR tier), keyed "col,row" -> true.
    // A GPR sweep marks every tile in its footprint as subsurface-surveyed;
    // scan-once applies per tier independently.
    subsurfaceScanned: {},
  };

  // has this tile already been scanned (aerial) by a completed deployment?
  api.isTileScanned = function (col, row) {
    return !!api.scanned[col + "," + row];
  };

  // mark every tile in an array of { col, row } as permanently (aerial) scanned.
  api.markAreaScanned = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      api.scanned[tiles[i].col + "," + tiles[i].row] = true;
    }
  };

  // has this tile already had its subsurface surveyed by a GPR deployment?
  api.isTileSubsurfaceScanned = function (col, row) {
    return !!api.subsurfaceScanned[col + "," + row];
  };

  // mark every tile in an array of { col, row } as permanently subsurface-scanned.
  api.markAreaSubsurfaceScanned = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      api.subsurfaceScanned[tiles[i].col + "," + tiles[i].row] = true;
    }
  };

  return api;
})();
