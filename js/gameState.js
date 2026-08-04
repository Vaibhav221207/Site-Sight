/* js/gameState.js — persistent game state for Site Sight:
 *   - cash balance
 *   - HQ building status and tile position (if any)
 *   - owned inventory (extensible for future item types)
 */

window.GameState = (function () {
  var api = {
    cash: 50000,             // starting cash
    hqCost: 10000,            // fixed HQ cost
    hqBuilt: false,           // has the player built an HQ yet?
    hqTile: null,             // { col, row } of the HQ tile, or null
    droneCost: 5000,          // price of one Recon Drone
    inventory: {              // owned items — add future item types here
      droneCount: 0,
    },
  };

  return api;
})();
