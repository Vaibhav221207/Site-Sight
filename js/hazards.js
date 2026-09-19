/* js/hazards.js — ConTech Emergencies: hazard trigger system.
 *
 * Hazards develop on constructed buildings over time, weighted by the
 * same survey/zoning data that drives the economy. This closes the loop:
 * buildings placed on low-stability or mismatched-zoning land are more
 * likely to develop problems, giving real consequence to earlier decisions.
 *
 * Deterministic: seeded mulberry32 RNG, no Math.random in BestUse paths.
 * Runs every 100s of visible run-time (paused in hidden tabs).
 */

window.Hazards = (function () {
  "use strict";

  var HAZARD_INTERVAL_MS = 100000;
  var MAX_PROB_PER_ROLL = 0.6;     // cap total probability per tile per roll

  // Hazard types (cosmetic only — all halve income except Sinkhole=0.25, Leak=spread)
  var HAZARD_TYPES = [
    "Foundation Crack",
    "Structural Fatigue",
    "Utility Fault",
    "Sinkhole",
    "Flood Risk",
    "Contamination Leak"
  ];

  var lastRoll = 0;
  var api = {
    HAZARD_TYPES: HAZARD_TYPES,
    HAZARD_INTERVAL_MS: HAZARD_INTERVAL_MS
  };

  // ---- deterministic RNG (mulberry32) ------------------------------------
  // Returns a 0..1 float deterministically from (seed, col, row, tick)
  function deterministicRandom(col, row, tick) {
    var seed = 0x9E3779B9;
    try {
      if (window.Terrain && typeof window.Terrain.seed === "number" && isFinite(window.Terrain.seed)) {
        seed = window.Terrain.seed >>> 0;
      }
    } catch (e) {}
    var a = (seed ^ (col << 16) ^ row ^ (tick | 0)) >>> 0;
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function isHqTile(col, row) {
    try {
      if (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) return true;
      var hq = window.GameState && window.GameState.hqTile;
      if (hq && hq.col === col && hq.row === row) return true;
    } catch (e) {}
    return false;
  }

  // ---- hazard activation -------------------------------------------------
  function activateHazard(d, type, now) {
    if (!d) return;
    // HQ is permanently immune — never attach a hazard even if debug-forced
    if (d.isHQ || isHqTile(d.col, d.row)) return;
    d.hazard = {
      active: true,
      type: type,
      triggeredAt: now
    };
    // mark save dirty
    try { if (window.SaveSystem && window.SaveSystem.markDirty) window.SaveSystem.markDirty(); } catch (e) {}
  }

  // ---- weight computation per tile ---------------------------------------
  // Returns { type -> weight } for a given constructed building tile
  function computeWeights(d, col, row) {
    var weights = {};
    var stability = d.surfaceStability; // "Poor"|"Fair"|"Good"|"Excellent"
    var mismatch = !!d.zoneMismatched;
    var pollution = d.pollution || 0;
    var zone = d.zoneType;
    var isRiverAdj = false;
    var isTrenchAdj = false;
    var isIndustrial = (zone === "industrial");

    try {
      if (window.Terrain && window.Terrain.isRiverAdjacent) {
        isRiverAdj = window.Terrain.isRiverAdjacent(col, row);
      }
      if (window.Terrain && window.Terrain.isTrenchAdjacent) {
        isTrenchAdj = window.Terrain.isTrenchAdjacent(col, row);
      }
    } catch (e) {}

    // Stability multiplier (Poor=3, Fair=1.5, Good=1, Excellent=0.6)
    var stabMult = 1;
    if (stability === "Poor") stabMult = 3;
    else if (stability === "Fair") stabMult = 1.5;
    else if (stability === "Excellent") stabMult = 0.6;

    // Base weights per type
    // Foundation Crack: stability-driven, worse with mismatch
    weights["Foundation Crack"] = stabMult * (mismatch ? 2 : 1);

    // Structural Fatigue: similar but slightly different scaling
    weights["Structural Fatigue"] = (stabMult * 0.8) * (mismatch ? 1.5 : 1);

    // Utility Fault: primarily mismatch-driven
    weights["Utility Fault"] = (mismatch ? 3 : 1) * (stability === "Poor" ? 1.5 : 1);

    // Sinkhole: trench-adjacent + poor/fair stability
    weights["Sinkhole"] = isTrenchAdj * (stability === "Poor" ? 4 : stability === "Fair" ? 2 : 0);

    // Flood Risk: river-adjacent + poor/fair stability (no rain animation)
    weights["Flood Risk"] = isRiverAdj * (stability === "Poor" ? 3 : stability === "Fair" ? 1.5 : 0);

    // Contamination Leak: industrial + high pollution + river adjacency
    var pollMult = pollution > 60 ? 3 : pollution > 30 ? 1.5 : 0;
    weights["Contamination Leak"] = isIndustrial * pollMult * (isRiverAdj ? 2 : 1);

    return weights;
  }

  // ---- main roll function ------------------------------------------------
  // Called once per frame from main.js loop; rolls hazards every 100s
  api.rollHazards = function (now) {
    if (!window.GameState || !window.GameState.tileData) return;
    if (now - lastRoll < HAZARD_INTERVAL_MS) return;
    lastRoll = now;

    var gs = window.GameState;
    var keys = Object.keys(gs.tileData);
    for (var i = 0; i < keys.length; i++) {
      var d = gs.tileData[keys[i]];
      if (!d) continue;
      // Only constructed buildings (has zoneBuilding), not HQ, no active hazard
      if (!d.zoneBuilding || d.hazard?.active) continue;
      if (d.isHQ || isHqTile(d.col, d.row)) continue; // HQ immune

      var weights = computeWeights(d, d.col, d.row);
      var total = 0;
      for (var k in weights) total += weights[k];
      if (total <= 0) continue;

      var roll = deterministicRandom(d.col, d.row, (now / HAZARD_INTERVAL_MS) | 0);
      var accum = 0;
      for (var t = 0; t < HAZARD_TYPES.length; t++) {
        var type = HAZARD_TYPES[t];
        var w = weights[type] || 0;
        if (w <= 0) continue;
        accum += w / total;
        if (roll < Math.min(accum, MAX_PROB_PER_ROLL)) {
          activateHazard(d, type, now);
          break;
        }
      }
    }
  };

  return api;
})();