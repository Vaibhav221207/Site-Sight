/* js/economy.js — income tick for built tiles. Pure calc + apply (no DOM):
 * main.js fires collectTick() on cadence; the caller owns the toast/pulse.
 * Forward-compatible: tiles flagged d.blighted (see P2 pollution) earn $0.
 */

window.Economy = (function () {
  var TICK_MS = 10000;
  var MAX_ADJ_BOOST = 0.6; // homes can add at most +60% to a tile
  // pollution stain (P2): 0-100 per tile. Sources drip building output +
  // verdict bonus (mild +1, severe +2); neighbors absorb 25% of source
  // output. >=60: income halved · >=100: blighted ($0 until scrubbed).
  var STAIN_MAX = 100;
  var STAIN_DEBUFF_AT = 60;
  var STAIN_MILD_BONUS = 1;
  var STAIN_SEVERE_BONUS = 2;
  var STAIN_SPREAD = 0.25;
  var SCRUB_COST = 150; // flat fee, requires owning the Dynamic Compactor

  var api = { TICK_MS: TICK_MS, SCRUB_COST: SCRUB_COST };

  function gridSize() {
    return (window.IsoGrid && window.IsoGrid.gridSize) || 20;
  }

  function neighbors(col, row) {
    var g = gridSize(), out = [];
    for (var dc = -1; dc <= 1; dc++) {
      for (var dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        var c = col + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= g || r >= g) continue;
        out.push({ col: c, row: r });
      }
    }
    return out;
  }

  // sum of residential boost auras around a tile (cottages +15%, apartments
  // +30%), capped so ring-stacking homes can't print money.
  function adjacencyBoost(col, row) {
    if (!window.GameState || !window.Buildings) return 0;
    var sum = 0;
    var ns = neighbors(col, row);
    for (var i = 0; i < ns.length; i++) {
      var d = window.GameState.getTileData(ns[i].col, ns[i].row);
      if (!d || !d.zoneBuilding) continue;
      var spec = window.Buildings.byId(d.zoneBuilding);
      if (spec && spec.role === "booster" && spec.boost) sum += spec.boost;
    }
    return Math.min(MAX_ADJ_BOOST, sum);
  }
  api._adjacencyBoost = adjacencyBoost;

  // income for ONE built tile in whole dollars
  // (verdict mult x adjacency x stain debuff; blighted tiles earn $0).
  function tileIncome(col, row) {
    if (!window.GameState || !window.Buildings) return 0;
    var d = window.GameState.getTileData(col, row);
    if (!d || !d.zoneBuilding || d.blighted) return 0;
    var spec = window.Buildings.byId(d.zoneBuilding);
    if (!spec || spec.role === "booster" || !spec.incomePerTick) return 0;
    var mult = window.Buildings.multFor(d.zoneVerdict || "ok");
    var stain = d.pollution || 0;
    var stainMult = stain >= STAIN_MAX ? 0 : (stain >= STAIN_DEBUFF_AT ? 0.5 : 1);
    if (stainMult <= 0) return 0;
    return Math.max(0, Math.round(spec.incomePerTick * mult * (1 + adjacencyBoost(col, row)) * stainMult));
  }
  api._tileIncome = tileIncome;

  // stain output of one built tile (building dirt + verdict bonus).
  function stainOutput(col, row) {
    if (!window.GameState || !window.Buildings) return 0;
    var d = window.GameState.getTileData(col, row);
    if (!d || !d.zoneBuilding) return 0;
    var spec = window.Buildings.byId(d.zoneBuilding);
    var out = spec ? (spec.pollutionPerTick || 0) : 0;
    if (d.zoneVerdict === "mild") out += STAIN_MILD_BONUS;
    else if (d.zoneVerdict === "severe") out += STAIN_SEVERE_BONUS;
    return out;
  }
  api._stainOutput = stainOutput;

  // one pollution pass: every source drips onto itself and breathes 25% of
  // its output onto each neighbor. Two-phase (compute then apply) so update
  // order can't bias the spread. Blight latches at max stain.
  function applyStain() {
    var gs = window.GameState;
    if (!gs || !gs.tileData) return;
    var delta = {}, sources = 0;
    var keys = Object.keys(gs.tileData);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(",");
      var c = +parts[0], r = +parts[1];
      var out = stainOutput(c, r);
      if (out <= 0) continue;
      sources++;
      delta[keys[i]] = (delta[keys[i]] || 0) + out;
      var ns = neighbors(c, r);
      for (var j = 0; j < ns.length; j++) {
        var k = ns[j].col + "," + ns[j].row;
        delta[k] = (delta[k] || 0) + out * STAIN_SPREAD;
      }
    }
    if (!sources) return;
    for (var k2 in delta) {
      if (!Object.prototype.hasOwnProperty.call(delta, k2)) continue;
      var p2 = k2.split(",");
      var d = gs.getTileData(+p2[0], +p2[1]);
      if (!d) continue;
      d.pollution = Math.min(STAIN_MAX, (d.pollution || 0) + delta[k2]);
      if (d.pollution >= STAIN_MAX) d.blighted = true;
    }
    if (window.BlockRender) window.BlockRender.invalidate();
  }
  api._applyStain = applyStain;

  // ---- stabilize (reclaim Unsuitable land) --------------------------------
  // A compactor crew reclaims one Unsuitable tile for a flat fee. The new
  // Best Use is a weighted roll: each candidate starts at 1, +2 per matching
  // scanned neighbor (adopt the local district), +4 if it is currently the
  // scarcest category map-wide (rare land uses spread out). Fields are then
  // rewritten to a coherent archetype so the panel never contradicts the
  // verdict. randFn is injectable for deterministic tests.
  var STABILIZE_COST = 500;
  var STABILIZE_CANDIDATES = ["Residential", "Commercial", "Industrial", "Mining"];

  function globalCounts() {
    var gs = window.GameState;
    var counts = { Residential: 0, Commercial: 0, Industrial: 0, Mining: 0 };
    if (!gs || !gs.tileData) return counts;
    var keys = Object.keys(gs.tileData);
    for (var i = 0; i < keys.length; i++) {
      var bu = gs.tileData[keys[i]].bestUse;
      if (counts[bu] !== undefined) counts[bu]++;
    }
    return counts;
  }
  api._globalCounts = globalCounts;

  function neighborVotes(col, row) {
    var votes = { Residential: 0, Commercial: 0, Industrial: 0, Mining: 0 };
    var ns = neighbors(col, row);
    for (var i = 0; i < ns.length; i++) {
      var d = window.GameState.getTileData(ns[i].col, ns[i].row);
      var bu = d ? d.bestUse : null;
      if (votes[bu] !== undefined && d && d.droneScanned && d.gprScanned) votes[bu]++;
    }
    return votes;
  }

  function pickWeighted(weights, order, r) {
    var total = 0, i;
    for (i = 0; i < order.length; i++) total += weights[order[i]];
    var roll = r * total;
    for (i = 0; i < order.length; i++) {
      roll -= weights[order[i]];
      if (roll <= 0) return order[i];
    }
    return order[order.length - 1];
  }

  function pickField(randFn, pairs) {
    var order = [], weights = {};
    for (var i = 0; i < pairs.length; i++) {
      order.push(pairs[i][0]);
      weights[pairs[i][0]] = pairs[i][1];
    }
    return pickWeighted(weights, order, randFn());
  }

  // No category may be stabilized past 55% of the map: a capped category
  // gets weight 0 (at most one category can ever trip the cap, but the
  // all-zero fallback keeps the roll total sane regardless).
  var STABILIZE_CAP = 0.55;

  api.pickStabilized = function (col, row, randFn) {
    var rand = (typeof randFn === "function") ? randFn : Math.random;
    var votes = neighborVotes(col, row);
    var counts = globalCounts();
    var g = (window.IsoGrid && window.IsoGrid.gridSize) || 20;
    var total = g * g;
    var scarcest = null, fewest = Infinity, k;
    for (k in counts) {
      if (counts[k] < fewest) { fewest = counts[k]; scarcest = k; }
    }
    var weights = {}, sum = 0;
    for (var i = 0; i < STABILIZE_CANDIDATES.length; i++) {
      var c = STABILIZE_CANDIDATES[i];
      var w = (counts[c] / total >= STABILIZE_CAP) ? 0 : 1 + votes[c] * 2 + (c === scarcest ? 4 : 0);
      weights[c] = w;
      sum += w;
    }
    if (!(sum > 0)) {
      for (var j = 0; j < STABILIZE_CANDIDATES.length; j++) weights[STABILIZE_CANDIDATES[j]] = 1;
    }
    return {
      bestUse: pickWeighted(weights, STABILIZE_CANDIDATES, rand()),
      weights: weights,
      votes: votes,
    };
  };

  // fields rewritten to match the stabilized verdict (panel stays coherent).
  function applyArchetype(d, target, randFn) {
    if (target === "Residential") {
      d.surfaceStability = randFn() < 0.7 ? "Good" : "Excellent";
      d.bedrockDepth = randFn() < 0.5 ? "Moderate" : "Deep";
      d.mineralDeposits = randFn() < 0.7 ? "None" : "Trace";
    } else if (target === "Commercial") {
      d.surfaceStability = "Fair";
      d.bedrockDepth = pickField(randFn, [["Shallow", 1], ["Moderate", 1], ["Deep", 1]]);
      d.mineralDeposits = randFn() < 0.8 ? "None" : "Trace";
    } else if (target === "Industrial") {
      d.surfaceStability = "Good";
      d.bedrockDepth = "Shallow";
      d.mineralDeposits = randFn() < 0.8 ? "None" : "Trace";
    } else { // Mining — the prize is guaranteed Rich ground
      d.surfaceStability = randFn() < 0.5 ? "Fair" : "Good";
      d.bedrockDepth = pickField(randFn, [["Shallow", 1], ["Moderate", 1], ["Deep", 1]]);
      d.mineralDeposits = "Rich";
    }
    d.soilType = pickField(randFn, [["Sandy", 25], ["Clay", 30], ["Rocky", 20], ["Loam", 25]]);
    d.bestUse = target;
  }

  // Stabilize one Unsuitable tile: fee, new verdict by surroundings+scarcity,
  // coherent fields, zone flags re-truthed if already zoned.
  // Returns { ok, bestUse?, net?, reason?, cash? } — no DOM.
  api.stabilizeTile = function (col, row, randFn) {
    var gs = window.GameState;
    if (!gs) return { ok: false, reason: "empty" };
    if (!gs.compactorSystemPurchased) return { ok: false, reason: "nocompactor" };
    var d = gs.getTileData(col, row);
    if (!d || d.bestUse !== "Unsuitable") return { ok: false, reason: "notunsuitable" };
    if (gs.cash < STABILIZE_COST) return { ok: false, reason: "funds", cash: gs.cash };
    if (!gs.spend(STABILIZE_COST, "Land stabilization")) return { ok: false, reason: "funds" };
    var pick = api.pickStabilized(col, row, randFn);
    applyArchetype(d, pick.bestUse, (typeof randFn === "function") ? randFn : Math.random);
    if (d.zoneType && window.Buildings) {
      d.zoneVerdict = window.Buildings.verdictFor(d.zoneType, d.bestUse);
      d.zoneMismatched = d.zoneVerdict !== "ok";
    }
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    if (window.BlockRender) window.BlockRender.invalidate();
    try { console.log("[Economy] stabilized " + col + "," + row + " -> " + pick.bestUse + " for $" + STABILIZE_COST); } catch (e) {}
    return { ok: true, bestUse: pick.bestUse, net: STABILIZE_COST, cash: gs.cash };
  };
  api.STABILIZE_COST = STABILIZE_COST;

  // scrub one tile clean with the Dynamic Compactor (flat fee, must own it).
  // Returns { ok, reason? } — no DOM; the caller renders the result inline.
  api.scrubTile = function (col, row) {
    var gs = window.GameState;
    if (!gs) return { ok: false, reason: "empty" };
    if (!gs.compactorSystemPurchased) return { ok: false, reason: "nocompactor" };
    var d = gs.getTileData(col, row);
    if (!d || (!(d.pollution > 0) && !d.blighted)) return { ok: false, reason: "clean" };
    if (gs.cash < SCRUB_COST) return { ok: false, reason: "funds", cash: gs.cash };
    if (!gs.spend(SCRUB_COST, "Pollution cleanup")) return { ok: false, reason: "funds" };
    d.pollution = 0;
    d.blighted = false;
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    if (window.BlockRender) window.BlockRender.invalidate();
    try { console.log("[Economy] scrubbed " + col + "," + row + " for $" + SCRUB_COST); } catch (e) {}
    return { ok: true, cash: gs.cash };
  };

  // one economy tick: stain first (debuffs hit this same tick), then pay.
  // Returns { earned, paid } — paid = per-building-id tile counts.
  api.collectTick = function () {
    var gs = window.GameState;
    if (!gs || !gs.tileData) return { earned: 0, paid: {} };
    applyStain();
    var earned = 0, paid = {};
    var keys = Object.keys(gs.tileData);
    for (var i = 0; i < keys.length; i++) {
      var parts = keys[i].split(",");
      var inc = tileIncome(+parts[0], +parts[1]);
      if (inc > 0) {
        earned += inc;
        var b = gs.tileData[keys[i]].zoneBuilding;
        paid[b] = (paid[b] || 0) + 1;
      }
    }
    if (earned > 0) {
      gs.earn(earned, "Building income");
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    }
    try { console.log("[Economy] tick +$" + earned); } catch (e) {}
    return { earned: earned, paid: paid };
  };

  return api;
})();
