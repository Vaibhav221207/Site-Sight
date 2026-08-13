/* js/landData.js — deterministic land survey data.
 * Seeded by (col,row) so the same tile always shows the same values
 * (logical), but values vary across the map (random-feeling).
 * Tied to terrain type for logical consistency.
 */

window.LandData = (function () {
  var GRID_SIZE = 20;

  // ---- seeded pseudo-random ------------------------------------------------
  function hash32(col, row, salt) {
    var x = (col + 1) * 0x9e3779b9;
    var y = (row + 1) * 0x9e3779b9;
    var h = x ^ y ^ (salt || 0x517cc1b7);
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = h ^ (h >>> 16);
    return h >>> 0;
  }

  function rand01(col, row, salt) {
    return (hash32(col, row, salt) % 10000) / 10000;
  }

  function randInt(col, row, min, max, salt) {
    return Math.floor(rand01(col, row, salt) * (max - min + 1)) + min;
  }

  function pickWeighted(col, row, weights, salt) {
    var r = rand01(col, row, salt);
    var acc = 0;
    for (var i = 0; i < weights.length; i++) {
      acc += weights[i][1];
      if (r <= acc) return weights[i][0];
    }
    return weights[weights.length - 1][0];
  }

  // ---- terrain reference ---------------------------------------------------
  function getTerrain(c, r) {
    return window.Terrain && window.Terrain.typeAt ? window.Terrain.typeAt(c, r) : "land";
  }

  function getElevation(c, r) {
    return window.Terrain && window.Terrain.elevationAt ? window.Terrain.elevationAt(c, r) : 0;
  }

  function isHQ(c, r) {
    return window.Terrain && window.Terrain.isHQ ? window.Terrain.isHQ(c, r) : false;
  }

  function isScanned(c, r) {
    return window.GameState && window.GameState.isScanned ? window.GameState.isScanned(c, r) : false;
  }

  function isSubsurfaceScanned(c, r) {
    return window.GameState && window.GameState.isSubsurfaceScanned ? window.GameState.isSubsurfaceScanned(c, r) : false;
  }

  // ---- data generators per tile -------------------------------------------
  function genSoil(c, r) {
    var t = getTerrain(c, r);
    var e = getElevation(c, r);
    if (t === "river") return pickWeighted(c, r, [["silt", 0.5], ["clay", 0.3], ["sand", 0.2]], 1);
    if (t === "trench") return pickWeighted(c, r, [["clay", 0.6], ["loam", 0.3], ["sand", 0.1]], 2);
    if (t === "hill") return pickWeighted(c, r, [["bedrock", 0.5], ["gravel", 0.3], ["loam", 0.2]], 3);
    // land
    if (e >= 4) return pickWeighted(c, r, [["gravel", 0.4], ["loam", 0.3], ["bedrock", 0.3]], 4);
    if (e >= 2) return pickWeighted(c, r, [["loam", 0.5], ["clay", 0.3], ["sand", 0.2]], 5);
    return pickWeighted(c, r, [["loam", 0.4], ["sand", 0.3], ["clay", 0.3]], 6);
  }

  function genQuality(c, r) {
    var soil = genSoil(c, r);
    var base = { loam: 70, clay: 45, sand: 35, gravel: 55, silt: 60, bedrock: 80 }[soil] || 50;
    var e = getElevation(c, r);
    var mod = randInt(-10, 10, 7);
    return Math.max(0, Math.min(100, base + mod + e * 2));
  }

  function genWaterTable(c, r) {
    var t = getTerrain(c, r);
    if (t === "river") return randInt(0, 2, 8);
    if (t === "trench") return randInt(1, 3, 9);
    // distance to nearest river (approximate via elevation + noise)
    var base = 8 + randInt(0, 12, 10);
    if (getElevation(c, r) >= 4) base += 6;
    return Math.min(30, base);
  }

  function genStability(c, r) {
    var t = getTerrain(c, r);
    if (t === "trench") return randInt(15, 40, 11);
    if (t === "hill") return randInt(70, 95, 12);
    if (t === "river") return randInt(30, 60, 13);
    var base = 55 + randInt(-15, 15, 14);
    if (getElevation(c, r) >= 4) base += 10;
    return Math.max(0, Math.min(100, base));
  }

  function genMineral(c, r) {
    var t = getTerrain(c, r);
    if (t === "hill") {
      var r = rand01(c, r, 15);
      if (r < 0.12) return "gold";
      if (r < 0.35) return "copper";
      if (r < 0.65) return "iron";
    }
    if (t === "trench") {
      if (rand01(c, r, 16) < 0.25) return "iron";
    }
    if (t === "land" && getElevation(c, r) >= 4) {
      if (rand01(c, r, 17) < 0.08) return "copper";
    }
    return "none";
  }

  function genVegetation(c, r) {
    var t = getTerrain(c, r);
    if (t === "river") return "dense";
    if (t === "trench") return "sparse";
    if (t === "hill") return rand01(c, r, 18) < 0.5 ? "moderate" : "sparse";
    return rand01(c, r, 19) < 0.6 ? "moderate" : "sparse";
  }

  function getScanGrade(c, r) {
    // THREE survey tiers:
    //   HQ CORE     — the HQ tile itself (always fully known)
    //   PRECISE     — subsurface surveyed by a GPR deployment (full data)
    //   AERIAL SURVEY — only aerial Drone scanned (surface data, no subsurface)
    //   NO DATA     — not yet surveyed at all
    if (isHQ(c, r)) return "HQ CORE";
    if (isSubsurfaceScanned(c, r)) return "PRECISE";
    if (isScanned(c, r)) return "AERIAL SURVEY";
    return "NO DATA";
  }

  // ---- public API ----------------------------------------------------------
  function getTileData(c, r) {
    if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) return null;
    var t = getTerrain(c, r);
    var hq = isHQ(c, r);
    var scanned = isScanned(c, r);
    var sub = isSubsurfaceScanned(c, r);
    // Surface data is revealed by the aerial Drone scan (or the HQ tile).
    // Subsurface data (water table, stability, minerals) requires a GPR pass.
    var hasSurface = hq || scanned;
    var hasSubsurface = hq || sub;
    return {
      col: c,
      row: r,
      terrain: t,
      elevation: getElevation(c, r),
      // surface fields (null until an aerial survey exists)
      soil: hasSurface ? genSoil(c, r) : null,
      quality: hasSurface ? genQuality(c, r) : null,
      vegetation: hasSurface ? genVegetation(c, r) : null,
      // subsurface fields (null until a GPR pass exists)
      waterTable: hasSubsurface ? genWaterTable(c, r) : null,
      stability: hasSubsurface ? genStability(c, r) : null,
      mineral: hasSubsurface ? genMineral(c, r) : null,
      scanned: scanned,
      subsurfaceScanned: sub,
      isHQ: hq,
      grade: getScanGrade(c, r)
    };
  }

  function getAllTiles() {
    var out = [];
    for (var r = 0; r < GRID_SIZE; r++) {
      for (var c = 0; c < GRID_SIZE; c++) {
        out.push(getTileData(c, r));
      }
    }
    return out;
  }

  function getSummary() {
    var tiles = getAllTiles();
    var counts = { land: 0, hill: 0, river: 0, trench: 0, hq: 0 };
    var scanned = 0;
    var subsurface = 0;
    var mineralCounts = { iron: 0, copper: 0, gold: 0 };
    var avgQuality = 0, avgStability = 0, avgWater = 0;
    var qN = 0, sN = 0, wN = 0;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.terrain === "hq") counts.hq++;
      else counts[t.terrain]++;
      if (t.scanned) scanned++;
      if (t.subsurfaceScanned) subsurface++;
      // quality is a surface metric (aerial survey)
      if (t.quality != null) { avgQuality += t.quality; qN++; }
      // stability/water/minerals are subsurface metrics (GPR survey)
      if (t.stability != null) { avgStability += t.stability; sN++; }
      if (t.waterTable != null) { avgWater += t.waterTable; wN++; }
      if (t.mineral && t.mineral !== "none") mineralCounts[t.mineral]++;
    }
    var n = tiles.length;
    return {
      totalTiles: n,
      scannedTiles: scanned,
      scannedPct: Math.round((scanned / n) * 100),
      subsurfaceTiles: subsurface,
      subsurfacePct: Math.round((subsurface / n) * 100),
      terrainCounts: counts,
      mineralCounts: mineralCounts,
      avgQuality: qN ? Math.round(avgQuality / qN) : 0,
      avgStability: sN ? Math.round(avgStability / sN) : 0,
      avgWaterTable: wN ? Math.round(avgWater / wN) : 0
    };
  }

  // color scales for heatmap rendering
  var QUALITY_COLORS = [
    { v: 0, c: "#2a2038" },   // deep purple
    { v: 25, c: "#4a3068" },
    { v: 50, c: "#007b8f" },
    { v: 75, c: "#00b87c" },
    { v: 100, c: "#7fff4f" }
  ];

  var STABILITY_COLORS = [
    { v: 0, c: "#381010" },
    { v: 30, c: "#8b2020" },
    { v: 60, c: "#cc7700" },
    { v: 80, c: "#007b40" },
    { v: 100, c: "#00cc66" }
  ];

  var WATER_COLORS = [
    { v: 0, c: "#081830" },
    { v: 5, c: "#0a3060" },
    { v: 10, c: "#0060a0" },
    { v: 20, c: "#00a0d0" },
    { v: 30, c: "#40d0ff" }
  ];

  function lerpColor(c1, c2, t) {
    var r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    var r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    var r = Math.round(r1 + (r2 - r1) * t);
    var g = Math.round(g1 + (g2 - g1) * t);
    var b = Math.round(b1 + (b2 - b1) * t);
    return "#" + ("0" + r.toString(16)).slice(-2) + ("0" + g.toString(16)).slice(-2) + ("0" + b.toString(16)).slice(-2);
  }

  function getColorForValue(val, scale) {
    for (var i = 0; i < scale.length - 1; i++) {
      if (val <= scale[i + 1].v) {
        var t = (val - scale[i].v) / (scale[i + 1].v - scale[i].v);
        return lerpColor(scale[i].c, scale[i + 1].c, t);
      }
    }
    return scale[scale.length - 1].c;
  }

  function getQualityColor(v) { return getColorForValue(v, QUALITY_COLORS); }
  function getStabilityColor(v) { return getColorForValue(v, STABILITY_COLORS); }
  function getWaterColor(v) { return getColorForValue(v, WATER_COLORS); }

  var TERRAIN_COLORS = {
    land: "#4a5a3a",
    hill: "#7a6a4a",
    river: "#1a5a8a",
    trench: "#2a1a3a",
    hq: "#ffcc00"
  };

  var MINERAL_COLORS = {
    none: "transparent",
    iron: "#a05030",
    copper: "#b87333",
    gold: "#ffd700"
  };

  var SOIL_LABELS = {
    loam: "Loam",
    clay: "Clay",
    sand: "Sand",
    gravel: "Gravel",
    silt: "Silt",
    bedrock: "Bedrock"
  };

  var VEGETATION_LABELS = {
    dense: "Dense",
    moderate: "Moderate",
    sparse: "Sparse"
  };

  var GRADE_LABELS = {
    "NO DATA": "NO DATA",
    "AERIAL SURVEY": "AERIAL SURVEY",
    PRECISE: "PRECISE",
    "HQ CORE": "HQ CORE"
  };

  return {
    GRID_SIZE: GRID_SIZE,
    getTileData: getTileData,
    getAllTiles: getAllTiles,
    getSummary: getSummary,
    getQualityColor: getQualityColor,
    getStabilityColor: getStabilityColor,
    getWaterColor: getWaterColor,
    TERRAIN_COLORS: TERRAIN_COLORS,
    MINERAL_COLORS: MINERAL_COLORS,
    SOIL_LABELS: SOIL_LABELS,
    VEGETATION_LABELS: VEGETATION_LABELS,
    GRADE_LABELS: GRADE_LABELS
  };
})();