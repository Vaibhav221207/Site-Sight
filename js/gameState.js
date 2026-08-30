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
    compactorSystemPurchased: false,
    compactorCost: 6000,
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
      selectedCompactorId: null,
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
    // TILE DATA MODEL — per-tile survey records, keyed "col,row". Populated by
    // the Drone (aerial) and GPR (subsurface) scan systems when their chunk
    // scans complete (see markDroneScanned / markGprScanned). The Drone writes
    // surface data; the GPR writes subsurface data; bestUse is recomputed after
    // every update (see computeBestUse).
    tileData: {},
  };

  // HQ tiles are never part of a scan (visual + data). The scanning
  // grid must never overlap the HQ building for any terrain/HQ position.
  function isHqTile(col, row) {
    if (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) return true;
    var hq = api.hqTile;
    if (hq && hq.col === col && hq.row === row) return true;
    return false;
  }

  // has this tile already been scanned (aerial) by a completed deployment?
  api.isTileScanned = function (col, row) {
    if (isHqTile(col, row)) return true; // HQ never needs scanning; treat as already scanned so chunks skip it
    return !!api.scanned[col + "," + row];
  };

  // mark every tile in an array of { col, row } as permanently (aerial) scanned.
  api.markAreaScanned = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].col, r = tiles[i].row;
      if (isHqTile(c, r)) continue;
      api.scanned[c + "," + r] = true;
    }
  };

  // has this tile already had its subsurface surveyed by a GPR deployment?
  api.isTileSubsurfaceScanned = function (col, row) {
    if (isHqTile(col, row)) return true;
    return !!api.subsurfaceScanned[col + "," + row];
  };

  // mark every tile in an array of { col, row } as permanently subsurface-scanned.
  api.markAreaSubsurfaceScanned = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].col, r = tiles[i].row;
      if (isHqTile(c, r)) continue;
      api.subsurfaceScanned[c + "," + r] = true;
    }
  };

  // ---------------------------------------------------------------------------
  // TILE DATA MODEL
  // ---------------------------------------------------------------------------

  // pick a value from a list of { value, w } using weighted randomness.
  function weightedPick(options) {
    var total = 0, i;
    for (i = 0; i < options.length; i++) total += options[i].w;
    var r = Math.random() * total;
    for (i = 0; i < options.length; i++) {
      r -= options[i].w;
      if (r <= 0) return options[i].value;
    }
    return options[options.length - 1].value;
  }

  // trench AND rock are "hazard" sites — surface stability is always Poor and
  // they read as Unsuitable, and the Dynamic Compactor can clear them to land.
  function isHazardTile(col, row) {
    if (!window.Terrain || !window.Terrain.typeAt) return false;
    var t = window.Terrain.typeAt(col, row);
    return t === "trench" || t === "rock";
  }

  // get (and lazily create) the data record for a tile. Record shape:
  //   droneScanned, gprScanned, surfaceStability, soilType, mineralDeposits,
  //   bedrockDepth, bestUse
  api.getTileData = function (col, row) {
    if (isHqTile(col, row)) {
      // HQ replaces the tile — no survey data, just HQ sentinel (never "Not yet scanned")
      return {
        droneScanned: true,
        gprScanned: true,
        surfaceStability: "HQ",
        soilType: "HQ",
        mineralDeposits: "HQ",
        bedrockDepth: "HQ",
        bestUse: "HQ",
        isHQ: true
      };
    }
    var k = col + "," + row;
    if (!api.tileData[k]) {
      api.tileData[k] = {
        droneScanned: false,
        gprScanned: false,
        surfaceStability: null,   // "Poor" | "Fair" | "Good" | "Excellent"
        soilType: null,           // "Sandy" | "Clay" | "Rocky" | "Loam"
        mineralDeposits: null,    // "None" | "Trace" | "Rich"
        bedrockDepth: null,       // "Shallow" | "Moderate" | "Deep"
        bestUse: null,            // computed, see computeBestUse
      };
    }
    return api.tileData[k];
  };

  // Simple rule-based best-use recommendation. Pure logic — easy to test and to
  // extend later with a real scoring formula. Order of checks matters:
  //   - no scans               -> null
  //   - only one scan type     -> "Partial Data" (needs the other tier too)
  //   - both scanned           -> one of the real categories below.
  api.computeBestUse = function (d) {
    if (!d) return null;
    var drone = !!d.droneScanned, gpr = !!d.gprScanned;
    if (!drone && !gpr) return null;
    if (!drone || !gpr) return "Partial Data";
    if (d.mineralDeposits === "Rich") return "Mining";
    var goodStab = (d.surfaceStability === "Good" || d.surfaceStability === "Excellent");
    if (d.bedrockDepth === "Shallow" && goodStab) return "Industrial";
    if (goodStab && (d.bedrockDepth === "Moderate" || d.bedrockDepth === "Deep")) return "Residential";
    if (d.surfaceStability === "Fair") return "Commercial";
    if (d.surfaceStability === "Poor") return "Unsuitable";
    return null; // both scanned but fields missing — should not normally happen
  };

  // recompute a record's bestUse in place after any data change.
  api._recalcBestUse = function (d) {
    if (!d) return;
    d.bestUse = api.computeBestUse(d);
  };

  // public: recompute bestUse for a specific tile after external data change
  api.recalcBestUse = function (col, row) {
    var d = api.getTileData(col, row);
    api._recalcBestUse(d);
    return d.bestUse;
  };

  // Drone (aerial) scan completed for this tile: mark it scanned and generate
  // surface stability (weighted — mostly Fair/Good, Poor/Excellent rarer; the
  // trench is ALWAYS "Poor", matching its problem-site identity).
  api.markDroneScanned = function (col, row) {
    var d = api.getTileData(col, row);
    d.droneScanned = true;
    d.surfaceStability = isHazardTile(col, row)
      ? "Poor"
      : weightedPick([
          { value: "Poor", w: 15 },
          { value: "Fair", w: 35 },
          { value: "Good", w: 35 },
          { value: "Excellent", w: 15 }
        ]);
    api._recalcBestUse(d);
    return d;
  };

  // GPR (subsurface) scan completed for this tile: mark it scanned and generate
  // soil type, mineral deposits ("Rich" is rare/notable) and bedrock depth. The
  // trench never yields "Rich" deposits so it consistently reads as "Unsuitable".
  api.markGprScanned = function (col, row) {
    var d = api.getTileData(col, row);
    d.gprScanned = true;
    var trench = isHazardTile(col, row);
    d.soilType = weightedPick([
      { value: "Sandy", w: 25 },
      { value: "Clay", w: 30 },
      { value: "Rocky", w: 20 },
      { value: "Loam", w: 25 }
    ]);
    d.mineralDeposits = trench
      ? weightedPick([{ value: "None", w: 70 }, { value: "Trace", w: 30 }])
      : weightedPick([
          { value: "None", w: 60 },
          { value: "Trace", w: 30 },
          { value: "Rich", w: 10 }
        ]);
    d.bedrockDepth = weightedPick([
      { value: "Shallow", w: 35 },
      { value: "Moderate", w: 40 },
      { value: "Deep", w: 25 }
    ]);
    api._recalcBestUse(d);
    return d;
  };

  // convenience bulk hooks called by the scan systems on chunk completion.
  api.markAreaDroneData = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].col, r = tiles[i].row;
      if (isHqTile(c, r)) continue;
      api.markDroneScanned(c, r);
    }
  };

  api.markAreaGprData = function (tiles) {
    if (!tiles) return;
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].col, r = tiles[i].row;
      if (isHqTile(c, r)) continue;
      api.markGprScanned(c, r);
    }
  };

  return api;
})();
