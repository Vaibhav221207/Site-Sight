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
    // Startup budget covers HQ + one of every survey/stabilization tool
    // ($20,000) and leaves a forgiving $20,000 operating reserve.
    startingCash: 40000,
    cash: 40000,
    startupBudget: {
      requiredTools: 20000,
      starterReserve: 20000,
      total: 40000,
    },
    hqCost: 5000,             // accessible early command-center unlock
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
    roads: {},
    cashLedger: [],
  };

  api.spend = function (amount, reason) {
    amount = Math.max(0, Number(amount) || 0);
    if (api.cash < amount) return false;
    api.cash -= amount;
    api.cashLedger.push({ type: "expense", amount: amount, reason: reason || "Purchase", at: Date.now() });
    if (api.cashLedger.length > 100) api.cashLedger.shift();
    return true;
  };

  api.earn = function (amount, reason) {
    amount = Math.max(0, Number(amount) || 0);
    if (!amount) return 0;
    api.cash += amount;
    api.cashLedger.push({ type: "income", amount: amount, reason: reason || "City income", at: Date.now() });
    if (api.cashLedger.length > 100) api.cashLedger.shift();
    return amount;
  };

  api.getStartupBudget = function () {
    var requiredTools = api.hqCost + api.droneCost + api.gprCost + api.compactorCost;
    return {
      requiredTools: requiredTools,
      starterReserve: api.startingCash - requiredTools,
      total: api.startingCash,
      tools: {
        hq: api.hqCost,
        drone: api.droneCost,
        gpr: api.gprCost,
        compactor: api.compactorCost,
      },
    };
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
  // Only used for display-only fields now (soil type) — everything that
  // feeds Best Use comes from the smooth survey fields below.
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

  // ---- seeded survey fields (districts, not dice) -------------------------
  // Rolling every tile independently made the survey map salt-and-pepper
  // noise. Instead stability/bedrock/minerals each sample a smooth
  // value-noise field (two octaves), so attributes form natural blobs and
  // Best Use reads in districts. Deterministic per map seed; falls back to
  // a fixed constant (stable tests + first paint) when Terrain has no seed.
  function surveySeed() {
    var s = window.Terrain && window.Terrain.seed;
    if (typeof s === "number" && isFinite(s)) return s >>> 0;
    return 0x9E3779B9;
  }

  function rng32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var fieldCache = {}; // "channel:seed" -> { n, lat }
  function fieldLattice(channel, n) {
    var key = channel + ":" + surveySeed();
    if (!fieldCache[key]) {
      var rand = rng32((surveySeed() ^ Math.imul(channel, 0x85EBCA6B)) >>> 0);
      var lat = [];
      for (var i = 0; i < n * n; i++) lat.push(rand());
      fieldCache[key] = { n: n, lat: lat };
    }
    return fieldCache[key];
  }

  function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  function sampleLattice(L, u, v) {
    var n = L.n, lat = L.lat;
    var x = Math.min(Math.max(u, 0), n - 1.001), y = Math.min(Math.max(v, 0), n - 1.001);
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = smootherstep(x - x0), fy = smootherstep(y - y0);
    var a = lat[y0 * n + x0], b = lat[y0 * n + x0 + 1];
    var c = lat[(y0 + 1) * n + x0], d = lat[(y0 + 1) * n + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  // 0..1 smooth field value for (channel, tile). Coarse octave builds the
  // blobs (~5-tile features), fine octave adds shoreline wobble.
  function sampleField(channel, col, row) {
    var g = (window.IsoGrid && window.IsoGrid.gridSize) || 20;
    var u = (g <= 1) ? 0 : col / (g - 1), v = (g <= 1) ? 0 : row / (g - 1);
    var coarse = sampleLattice(fieldLattice(channel, 5), u * 4, v * 4);
    var fine = sampleLattice(fieldLattice(channel + 101, 9), u * 8, v * 8);
    return coarse * 0.65 + fine * 0.35;
  }

  // trench AND rock are "hazard" sites — surface stability is always Poor and
  // they read as Unsuitable, and the Dynamic Compactor can clear them to land.
  function isHazardTile(col, row) {
    if (!window.Terrain || !window.Terrain.typeAt) return false;
    var t = window.Terrain.typeAt(col, row);
    return t === "trench" || t === "rock";
  }

  // river AND rock can never hold a Best Use — nothing builds on water or
  // boulders. Survey still records the scans (fields fill in), but bestUse
  // stays null so the DATA map reads them as unscanned ground under the
  // river/rock overlays instead of fake zoning categories.
  function isUnbuildable(col, row) {
    if (!window.Terrain || !window.Terrain.typeAt) return false;
    var t = window.Terrain.typeAt(col, row);
    return t === "river" || t === "rock";
  }

  // get (and lazily create) the data record for a tile. Record shape:
  //   droneScanned, gprScanned, surfaceStability, soilType, mineralDeposits,
  //   bedrockDepth, bestUse, zoneType, zoneMismatched, zoneVerdict,
  //   zoneBuilding
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
        zoneType: null,
        isHQ: true
      };
    }
    var k = col + "," + row;
    if (!api.tileData[k]) {
      api.tileData[k] = {
          col: col,
          row: row,
        droneScanned: false,
        gprScanned: false,
        surfaceStability: null,   // "Poor" | "Fair" | "Good" | "Excellent"
        soilType: null,           // "Sandy" | "Clay" | "Rocky" | "Loam"
        mineralDeposits: null,    // "None" | "Trace" | "Rich"
        bedrockDepth: null,       // "Shallow" | "Moderate" | "Deep"
        bestUse: null,            // computed, see computeBestUse
        zoneType: null,           // "residential" | "commercial" | "industrial" | "mining" | null
        zoneMismatched: null,     // true when zoneType disagrees with bestUse (set on confirm)
        zoneVerdict: null,        // "ok" | "mild" | "severe" (see js/buildings.js)
        zoneBuilding: null,       // building id (see js/buildings.js) | null
        buildingSprite: null,      // Kenney sprite filename for constructed building
        pollution: 0,             // 0-100 ground stain (see js/economy.js)
        blighted: false,          // true at max stain: earns $0 until scrubbed
      };
    }
    if (api.tileData[k].col === undefined) api.tileData[k].col = col;
    if (api.tileData[k].row === undefined) api.tileData[k].row = row;
    return api.tileData[k];
  };

  // Suitability scoring is deliberately deterministic. Survey facts decide the
  // category; there is no per-tile jitter or hash-based roulette that can make
  // adjacent, otherwise-identical tiles recommend unrelated uses.
  api.computeBestUse = function (d) {
    if (!d) return null;
    var drone = !!d.droneScanned, gpr = !!d.gprScanned;
    if (!drone && !gpr) return null;
    if (!drone || !gpr) return "Partial Data";
    if (d.surfaceStability === "Poor") return "Unsuitable";
    // Use explicit planning rules instead of close floating-point scores. This
    // keeps a tile's recommendation explainable in the DATA panel and ensures
    // all four buildable categories remain available.
    if (d.mineralDeposits === "Rich") return "Mining";
    if (d.bedrockDepth === "Shallow") return "Industrial";
    if (d.bedrockDepth === "Deep" &&
        (d.surfaceStability === "Excellent" || d.surfaceStability === "Good")) return "Commercial";
    if (d.bedrockDepth === "Moderate" &&
        (d.surfaceStability === "Excellent" || d.surfaceStability === "Good")) return "Commercial";
    return "Residential";
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

  // Drone (aerial) scan completed for this tile: mark it scanned and sample
  // surface stability from the smooth field (Poor pockets, Fair/Good ground,
  // Excellent ridges). The trench is ALWAYS "Poor", matching its
  // problem-site identity. Thresholds mirror the old 15/35/35/15 odds.
  api.markDroneScanned = function (col, row) {
    var d = api.getTileData(col, row);
    d.droneScanned = true;
    if (isHazardTile(col, row)) {
      d.surfaceStability = "Poor";
    } else {
      var sv = sampleField(1, col, row);
      d.surfaceStability = sv < 0.27 ? "Poor" : sv < 0.50 ? "Fair" : sv < 0.86 ? "Good" : "Excellent";
    }
    api._recalcBestUse(d);
    if (isUnbuildable(col, row)) d.bestUse = null;
    return d;
  };

  // GPR (subsurface) scan completed for this tile: soil stays a per-tile
  // roll (display-only), but minerals and bedrock sample the smooth fields —
  // Rich ground arrives in rare pockets, bedrock in Shallow/Deep regions.
  // The trench never yields "Rich" deposits so it consistently reads as
  // "Unsuitable".
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
    if (trench) {
      d.mineralDeposits = weightedPick([{ value: "None", w: 70 }, { value: "Trace", w: 30 }]);
    } else {
      var mv = sampleField(2, col, row);
      d.mineralDeposits = mv > 0.73 ? "Rich" : mv > 0.45 ? "Trace" : "None";
    }
    var bv = sampleField(3, col, row);
    d.bedrockDepth = bv < 0.42 ? "Shallow" : bv < 0.78 ? "Moderate" : "Deep";
    api._recalcBestUse(d);
    if (isUnbuildable(col, row)) d.bestUse = null;
    return d;
  };

  // light spatial smoothing for bestUse — makes DATA less salt-and-pepper,
  // a little more district-like, without changing generation odds
  function smoothBestUseForArea(tiles) {
    if (!tiles || tiles.length === 0) return;
    // Build a map of current bestUse for the area + 1-ring border
    var candidates = {};
    var toCheck = [];
    for (var i = 0; i < tiles.length; i++) {
      toCheck.push(tiles[i]);
      for (var dc = -1; dc <= 1; dc++) for (var dr = -1; dr <= 1; dr++) {
        var cc = tiles[i].col + dc, rr = tiles[i].row + dr;
        if (cc < 0 || cc >= 20 || rr < 0 || rr >= 20) continue;
        var k2 = cc + "," + rr;
        if (!candidates[k2]) {
          var d2 = api.tileData[k2];
          if (d2 && d2.bestUse) candidates[k2] = d2.bestUse;
        }
      }
    }
    // For each tile in the area, a clear local majority creates a district.
    var changes = [];
    for (var j = 0; j < tiles.length; j++) {
      var t = tiles[j];
      var d = api.getTileData(t.col, t.row);
      if (!d || !d.bestUse || d.bestUse === "Partial Data") continue;
      var counts = {};
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var nc = t.col + dx, nr = t.row + dy;
        if (nc < 0 || nc >= 20 || nr < 0 || nr >= 20) continue;
        var kd = api.tileData[nc + "," + nr];
        var bu = kd ? kd.bestUse : null;
        if (bu && bu !== "Partial Data" && bu !== "Unscanned") {
          counts[bu] = (counts[bu] || 0) + 1;
        }
      }
      var best = null, bestCount = 0;
      for (var k in counts) if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
      if (best && best !== d.bestUse && bestCount >= 5) {
        changes.push({ col: t.col, row: t.row, bestUse: best });
      }
    }
    for (var c2 = 0; c2 < changes.length; c2++) {
      var ch = changes[c2];
      var dd = api.getTileData(ch.col, ch.row);
      // keep underlying stability/soil for now, just nudge the category for clustering
      dd.bestUse = ch.bestUse;
    }
  }

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
    // light cluster pass after both tiers are present
    smoothBestUseForArea(tiles);
  };

  return api;
})();
