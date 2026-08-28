/* js/terrain.js — deterministic 20x20 terrain map + palette.
  * Provides per-tile: terrain type (land/rock/trench/river), a screen-pixel
 * elevation offset applied to a block's total height, and the base color
 * for a block's top face. Generation logic lives here.
 *
 * Layout (border-placement):
 *   - hills are scattered rock clusters hugging the NORTH, WEST and SOUTH
 *     grid edges (framing the site on most sides)
 *   - the river hugs the EAST grid edge (2 cells wide, flowing south)
 *   - the trench is a diagonal slash in the interior (lower-left area);
 *     it compacts to flat land after the Dynamic Compactor runs
 *   - everything else is flat land
 *
  * blockRender.js consumes this data: rock tiles are NOT drawn as blocks —
 * each cluster is instead rendered as a scattered rock/boulder formation.
 */

window.Terrain = (function () {
  var GRID = window.IsoGrid.gridSize;

  var T = { LAND: 0, ROCK: 1, TRENCH: 2, RIVER: 3, HQ: 4 };

  // elevation added to a tile's block total height (px). Rocks draw their own
  // boulder sprites in blockRender, so they stay at ground level.
  var ELEVATION = { land: 0, rock: 0, trench: -5, river: 0, hq: 0 };

  // base top-face palette (side faces get shaded darker in blockRender)
  var PALETTE = {
    land: "#7EB24A",   // soft moss green — muted sage from reference (was vivid lime #6dd400)
    rock: "#9AA3AB",   // rocky gray — boulder field ground (rocks drawn as sprites on top)
    trench: "#4A3F6B", // deep violet/indigo hazard — distinct from black + moss land
    river: "#5B6FA8",  // blue-violet — cooler harmonized partner to trench violet #4A3F6B
    hq: "#44ddbb",     // base tone under HQ building
  };

  var NAMES = ["land", "rock", "trench", "river", "hq"];

  // deterministic PRNG (mulberry32) — same seed always reproduces the SAME map
  function mulberry32(seed) {
    var a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // hub-and-satellite boulder templates (tile-unit offsets). Reused across
  // random clusters so the rock read stays consistent regardless of placement.
  var ROCK_TEMPLATES = [
    [ { dc: 0.0, dr: 0.35, size: 1.0 }, { dc: -0.75, dr: 0.8, size: 0.5 }, { dc: 0.85, dr: 0.75, size: 0.45 }, { dc: 0.3, dr: 0.95, size: 0.4 }, { dc: -0.35, dr: 0.4, size: 0.42 }, { dc: 0.55, dr: 0.35, size: 0.38 } ],
    [ { dc: 0.15, dr: 0.35, size: 0.9 }, { dc: -0.7, dr: 0.8, size: 0.5 }, { dc: 0.75, dr: 0.8, size: 0.42 }, { dc: 0.25, dr: 0.95, size: 0.4 }, { dc: -0.35, dr: 0.35, size: 0.38 } ],
    [ { dc: 0.4, dr: 0.35, size: 1.0 }, { dc: 0.95, dr: 0.75, size: 0.5 }, { dc: 0.55, dr: 0.4, size: 0.42 }, { dc: 0.75, dr: 0.95, size: 0.4 }, { dc: 0.95, dr: 0.35, size: 0.38 }, { dc: 1.15, dr: 0.6, size: 0.45 } ],
    [ { dc: 0.0, dr: -0.05, size: 1.0 }, { dc: -0.75, dr: -0.4, size: 0.5 }, { dc: 0.85, dr: -0.45, size: 0.45 }, { dc: 0.3, dr: -0.25, size: 0.4 }, { dc: -0.35, dr: -0.8, size: 0.42 }, { dc: 0.55, dr: -0.85, size: 0.38 } ],
    [ { dc: 0.15, dr: -0.05, size: 0.9 }, { dc: -0.7, dr: -0.4, size: 0.5 }, { dc: 0.75, dr: -0.45, size: 0.42 }, { dc: 0.25, dr: -0.25, size: 0.4 }, { dc: -0.35, dr: -0.8, size: 0.38 } ],
  ];

  // pick a seed: ?seed=N in the URL reproduces an EXACT map (for bug reports);
  // otherwise a fresh random seed each load so every session differs.
  function pickSeed() {
    try {
      var p = new URLSearchParams(location.search).get("seed");
      if (p != null && /^\d+$/.test(p)) return (parseInt(p, 10) >>> 0);
    } catch (e) {}
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  // paints a rough circular cluster of ROCK tiles over flat land (seed-driven)
  function rockCluster(m, cc, rr, rad, rnd) {
    var tiles = [];
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        if (m[r][c] !== T.LAND) continue;
        var dx = c - cc, dy = r - rr;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < rad + rnd() * 0.5) {
          m[r][c] = T.ROCK;
          tiles.push({ c: c, r: r });
        }
      }
    }
    return tiles;
  }

  // river: a 2-wide straight-or-zigzag channel hugging ONE edge only, confined
  // to the outer 3 tile-layers so it never intrudes on the buildable interior.
  // It spans the full length of that side (corner to corner).
  function paintRiver(m, rnd) {
    var G = GRID;
    function setR(c, r) { if (c >= 0 && c < G && r >= 0 && r < G) m[r][c] = T.RIVER; }
    var edge = Math.floor(rnd() * 4); // 0=N 1=E 2=S 3=W
    var phase = rnd() * Math.PI * 2;
    var freq = 0.4 + rnd() * 0.5;     // gentle zig-zag (1-2 wiggles along the side)
    for (var i = 0; i < G; i++) {
      // perpendicular band base (tiles from the edge): oscillates 1..2, so the
      // 2-wide band stays within the outer 3 layers (deepest tile = layer 3)
      var base = Math.round(1.5 + 0.5 * Math.sin(i * freq + phase));
      if (base < 1) base = 1; else if (base > 2) base = 2;
      if (edge === 0) { setR(i, base); setR(i, base + 1); }
      else if (edge === 2) { setR(i, G - 1 - base); setR(i, G - 1 - base - 1); }
      else if (edge === 3) { setR(base, i); setR(base + 1, i); }
      else { setR(G - 1 - base, i); setR(G - 1 - base - 1, i); }
    }
  }

  // rocks: 4-6 random clusters hugging a RANDOM edge each (only over flat land)
  function paintClusters(m, rnd) {
    var n = 4 + Math.floor(rnd() * 3); // 4-6 clusters
    var clusters = [];
    for (var i = 0; i < n; i++) {
      var edge = Math.floor(rnd() * 4);
      var margin = 1 + Math.floor(rnd() * 2);
      var t = margin + Math.floor(rnd() * (GRID - 2 * margin));
      var cx, cy;
      if (edge === 0) { cx = t; cy = margin; }
      else if (edge === 2) { cx = t; cy = GRID - 1 - margin; }
      else if (edge === 3) { cx = margin; cy = t; }
      else { cx = GRID - 1 - margin; cy = t; }
      var rad = 1.3 + rnd() * 0.6;
      var tiles = rockCluster(m, cx, cy, rad, rnd);
      var rocks = ROCK_TEMPLATES[Math.floor(rnd() * ROCK_TEMPLATES.length)];
      clusters.push({ cx: cx, cy: cy, radius: rad, tiles: tiles, rocks: rocks });
    }
    return clusters;
  }

  // trench: a RANDOM interior blob (only over flat land) — compacts to land
  function paintTrench(m, rnd) {
    var cx = 4 + Math.floor(rnd() * (GRID - 8));
    var cy = 4 + Math.floor(rnd() * (GRID - 8));
    var rad = 2 + rnd() * 2;
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        if (m[r][c] !== T.LAND) continue;
        var dx = c - cx, dy = r - cy;
        if (Math.sqrt(dx * dx + dy * dy) < rad) m[r][c] = T.TRENCH;
      }
    }
  }

  // keep each feature on its OWN tiles: pull rock tiles back from any tile that
  // borders river/trench so the boulder pile never touches those features.
  function separateFeatures(m) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var r = 0; r < GRID; r++) {
        for (var c = 0; c < GRID; c++) {
          if (m[r][c] !== T.ROCK) continue;
          var near = false;
          if (r > 0 && (m[r - 1][c] === T.RIVER || m[r - 1][c] === T.TRENCH)) near = true;
          if (r < GRID - 1 && (m[r + 1][c] === T.RIVER || m[r + 1][c] === T.TRENCH)) near = true;
          if (c > 0 && (m[r][c - 1] === T.RIVER || m[r][c - 1] === T.TRENCH)) near = true;
          if (c < GRID - 1 && (m[r][c + 1] === T.RIVER || m[r][c + 1] === T.TRENCH)) near = true;
          if (near) { m[r][c] = T.LAND; changed = true; }
        }
      }
    }
  }

  function generate(seed) {
    var rnd = mulberry32(seed);
    var m = [];
    for (var r = 0; r < GRID; r++) {
      var row = [];
      for (var c = 0; c < GRID; c++) row.push(T.LAND);
      m.push(row);
    }
    paintRiver(m, rnd);
    var clusters = paintClusters(m, rnd);
    paintTrench(m, rnd);
    separateFeatures(m);
    return { map: m, clusters: clusters };
  }

  // validate: always enough buildable land, some trench (compactor work), and
  // a real river. Re-roll the seed until it holds — so a random map can never
  // produce the "no HQ spot" / "no trench" class of bug.
  function generateValid(seed) {
    var g, s;
    for (var attempt = 0; attempt < 40; attempt++) {
      s = (seed + attempt * 2654435761) >>> 0;
      g = generate(s);
      var land = 0, trench = 0, river = 0;
      for (var r = 0; r < GRID; r++) for (var c = 0; c < GRID; c++) {
        var v = g.map[r][c];
        if (v === T.LAND) land++; else if (v === T.TRENCH) trench++; else if (v === T.RIVER) river++;
      }
      if (land > 60 && trench >= 4 && river >= 6) return { gen: g, seed: s };
    }
    return { gen: g, seed: s };
  }

  var startSeed = pickSeed();
  var valid = generateValid(startSeed);
  var SEED = valid.seed;
  var gen = valid.gen;
  var map = gen.map;

  var api = {
    rockClusters: gen.clusters,
    seed: SEED,
    typeAt: function (c, r) { return NAMES[map[r][c]]; },
    isRiver: function (c, r) { return map[r][c] === T.RIVER; },
    isRock: function (c, r) { return map[r][c] === T.ROCK; },
    isTrench: function (c, r) { return map[r][c] === T.TRENCH; },
    elevationAt: function (c, r) { return ELEVATION[NAMES[map[r][c]]]; },
    colorAt: function (c, r) { return PALETTE[NAMES[map[r][c]]]; },
    baseColorAt: function (c, r) {
      return map[r][c] === T.ROCK ? PALETTE.land : PALETTE[NAMES[map[r][c]]];
    },
    isHQ: function (c, r) { return map[r][c] === T.HQ; },
    setHQ: function (c, r) { map[r][c] = T.HQ; },
    // called by the Dynamic Compactor when a hazard tile (trench OR rock) is
    // filled — turns it into normal flat land (pop-able, 4px base, buildable)
    fillTrench: function (c, r) {
      if (c < 0 || c >= GRID || r < 0 || r >= GRID) return false;
      if (map[r][c] !== T.TRENCH && map[r][c] !== T.ROCK) return false;
      map[r][c] = T.LAND;
      return true;
    },
    fillTrenchArea: function (tiles) {
      var n = 0;
      for (var i = 0; i < tiles.length; i++) if (api.fillTrench(tiles[i].col, tiles[i].row)) n++;
      return n;
    },
    hqColor: "#4fc3f7",
  };

  return api;
})();
