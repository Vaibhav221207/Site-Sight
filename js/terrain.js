/* js/terrain.js — deterministic 20x20 terrain map + palette.
 * Provides per-tile: terrain type (land/hill/trench/river), a screen-pixel
 * elevation offset applied to a block's total height, and the base color
 * for a block's top face. Generation logic lives here.
 *
 * Layout (border-placement):
 *   - hills are scattered rock clusters hugging the NORTH, WEST and SOUTH
 *     grid edges (framing the site on most sides)
 *   - the river hugs the EAST grid edge (2 cells wide, flowing south)
 *   - the trench is a diagonal slash in the interior (lower-left area)
 *   - everything else is flat land
 *
 * blockRender.js consumes this data: hill tiles are NOT drawn as blocks —
 * each cluster is instead rendered as a scattered rock/boulder formation.
 */

window.Terrain = (function () {
  var GRID = window.IsoGrid.gridSize;

  var T = { LAND: 0, HILL: 1, TRENCH: 2, RIVER: 3, HQ: 4 };

  // elevation added to a tile's block total height (px). Hills draw their own
  // smooth mountain height in blockRender, so they stay at ground level.
  var ELEVATION = { land: 0, hill: 0, trench: -5, river: 0, hq: 0 };

  // base top-face palette (side faces get shaded darker in blockRender)
  var PALETTE = {
    land: "#7EB24A",   // soft moss green — muted sage from reference (was vivid lime #6dd400)
    hill: "#6A9A3E",   // moss hill base under rocks (desaturated to match reference foliage)
    trench: "#4A3F6B", // deep violet/indigo hazard — distinct from black + moss land
    river: "#1E9AC8",  // natural river blue — reference vibe (was blue-violet)
    hq: "#44ddbb",     // base tone under HQ building
  };

  var NAMES = ["land", "hill", "trench", "river", "hq"];

  // deterministic PRNG (mulberry32) so the map is identical on every load
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
  var prng = mulberry32(1337);

  // paints a rough circular cluster of hill tiles over flat land and returns
  // the list of tiles it claimed (used as the smooth-shape footprint).
  // The jitter is small so the footprint stays compact.
  function hillCluster(m, cc, rr, rad) {
    var tiles = [];
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        if (m[r][c] !== T.LAND) continue;
        var dx = c - cc, dy = r - rr;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < rad + prng() * 0.5) {
          m[r][c] = T.HILL;
          tiles.push({ c: c, r: r });
        }
      }
    }
    return tiles;
  }

  function generate() {
    var m = [];
    for (var r = 0; r < GRID; r++) {
      var row = [];
      for (var c = 0; c < GRID; c++) row.push(T.LAND);
      m.push(row);
    }

    // river: 2-cell-wide path hugging the EAST edge, winding slightly south
    for (var r = 0; r < GRID; r++) {
      var c1 = Math.round(18 - 1.5 * Math.sin(r / 2.6));
      for (var c = c1; c <= c1 + 1; c++) {
        if (c >= 0 && c < GRID) m[r][c] = T.RIVER;
      }
    }

    // hills: rock/boulder clusters hugging the NORTH, WEST and SOUTH edges
    // (only over flat land). Each cluster carries `rocks`: a hub-and-satellite
    // boulder formation in tile units — ONE dominant central boulder (largest
    // `size`) plus 4-6 smaller rocks tightly clustered around its base (dc/dr
    // = offset from the cluster centre, size = scale factor; sizes are scaled
    // by isoSize at render time). The boulders read as a scattered stone pile
    // with a clear size hierarchy, never as a green mountain. Footprints are
    // deliberately compact so the rocks read as a contained landmark and leave
    // the interior open and buildable. The tiles stay LAND underneath — the
    // rocks are a visual overlay, never a replacement. New clusters are pushed
    // AFTER the originals so the shared PRNG jitter for the existing
    // footprints stays byte-for-byte identical.
    var clusters = [];
    clusters.push({
      cx: 3, cy: 0, radius: 1.7, tiles: hillCluster(m, 3, 0, 1.7),
      rocks: [
        { dc: 0.0, dr: 0.35, size: 1.0 },    // dominant central boulder
        { dc: -0.75, dr: 0.8, size: 0.5 },   // satellite
        { dc: 0.85, dr: 0.75, size: 0.45 },  // satellite
        { dc: 0.3, dr: 0.95, size: 0.4 },    // satellite
        { dc: -0.35, dr: 0.4, size: 0.42 },  // satellite
        { dc: 0.55, dr: 0.35, size: 0.38 },  // satellite
      ],
    });
    clusters.push({
      cx: 16, cy: 0, radius: 1.5, tiles: hillCluster(m, 16, 0, 1.5),
      rocks: [
        { dc: 0.15, dr: 0.35, size: 0.9 },   // dominant central boulder
        { dc: -0.7, dr: 0.8, size: 0.5 },    // satellite
        { dc: 0.75, dr: 0.8, size: 0.42 },   // satellite
        { dc: 0.25, dr: 0.95, size: 0.4 },   // satellite
        { dc: -0.35, dr: 0.35, size: 0.38 }, // satellite
      ],
    });
    // WEST edge: one cluster hugging the west side. All rock offsets keep
    // dc >= 0 so nothing hangs off the left (col 0) edge of the grid.
    clusters.push({
      cx: 0, cy: 7, radius: 1.5, tiles: hillCluster(m, 0, 7, 1.5),
      rocks: [
        { dc: 0.4, dr: 0.35, size: 1.0 },    // dominant central boulder
        { dc: 0.95, dr: 0.75, size: 0.5 },   // satellite
        { dc: 0.55, dr: 0.4, size: 0.42 },   // satellite
        { dc: 0.75, dr: 0.95, size: 0.4 },   // satellite
        { dc: 0.95, dr: 0.35, size: 0.38 },  // satellite
        { dc: 1.15, dr: 0.6, size: 0.45 },   // satellite
      ],
    });
    // SOUTH edge: two clusters hugging the south edge. Their dr offsets are
    // shifted behind the hub (dr <= 0) so every rock lands on rows 18-19
    // instead of hanging off the bottom (row 19) edge of the grid.
    clusters.push({
      cx: 4, cy: 19, radius: 1.5, tiles: hillCluster(m, 4, 19, 1.5),
      rocks: [
        { dc: 0.0, dr: -0.05, size: 1.0 },   // dominant central boulder
        { dc: -0.75, dr: -0.4, size: 0.5 },  // satellite
        { dc: 0.85, dr: -0.45, size: 0.45 }, // satellite
        { dc: 0.3, dr: -0.25, size: 0.4 },   // satellite
        { dc: -0.35, dr: -0.8, size: 0.42 }, // satellite
        { dc: 0.55, dr: -0.85, size: 0.38 }, // satellite
      ],
    });
    clusters.push({
      cx: 14, cy: 19, radius: 1.5, tiles: hillCluster(m, 14, 19, 1.5),
      rocks: [
        { dc: 0.15, dr: -0.05, size: 0.9 },  // dominant central boulder
        { dc: -0.7, dr: -0.4, size: 0.5 },   // satellite
        { dc: 0.75, dr: -0.45, size: 0.42 }, // satellite
        { dc: 0.25, dr: -0.25, size: 0.4 },  // satellite
        { dc: -0.35, dr: -0.8, size: 0.38 }, // satellite
      ],
    });

    // trench: diagonal slash across the lower-left interior (only over flat land)
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        var along = c - r;
        if (m[r][c] === T.LAND && along >= -4 && along <= -1 && r > 9 && c < 12) {
          m[r][c] = T.TRENCH;
        }
      }
    }

    return { map: m, clusters: clusters };
  }

  var gen = generate();
  var map = gen.map;

  var api = {
    // hill cluster footprints (tile lists) + rock/boulder shapes for the
    // scattered-formation overlay rendering
    hillClusters: gen.clusters,
    typeAt: function (c, r) { return NAMES[map[r][c]]; },
    isRiver: function (c, r) { return map[r][c] === T.RIVER; },
    isHill: function (c, r) { return map[r][c] === T.HILL; },
    elevationAt: function (c, r) { return ELEVATION[NAMES[map[r][c]]]; },
    colorAt: function (c, r) { return PALETTE[NAMES[map[r][c]]]; },
    // the color of the flat land tile drawn UNDERNEATH a tile. Hill tiles keep
    // their normal flat land base (the peak shapes are drawn on top of it), so
    // the grid always renders complete with no gaps.
    baseColorAt: function (c, r) {
      return map[r][c] === T.HILL ? PALETTE.land : PALETTE[NAMES[map[r][c]]];
    },
    // -- HQ support ---------------------------------------------------
    isHQ: function (c, r) { return map[r][c] === T.HQ; },
    setHQ: function (c, r) { map[r][c] = T.HQ; },
    // render color for the HQ building (different from land color)
    hqColor: "#4fc3f7",
  };

  return api;
})();
