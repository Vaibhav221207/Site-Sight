/* js/blockRender.js — renders the world in isometric depth order:
 *   - land/trench/river tiles draw as extruded 3D blocks (top diamond + two
 *     shaded side faces), respecting elevation and the pop-up animation
 *   - hill tiles never draw as blocks; each hill cluster renders as a
 *     scattered rock/boulder formation at its correct depth position
 *   - the trench is one connected depression: a single flat floor polygon
 *     (darkest tone) sunk below the surrounding land, drawn BEFORE the land
 *     blocks so that adjacent tiles' side faces naturally cover the pit at
 *     the boundary; flat-shaded wall quads around the outer boundary add
 *     depth without bleeding onto the land tiles
 *   - a flowing shimmer highlights the river (moving bands along the current)
 *   - the HQ tile renders a detailed ConTech building (ten-block-tall main
 *     structure with windows, entrance door + badge, secondary roof module,
 *     roof details and a ground shadow/cable) instead of a base block
 *
 * Rendering strategy (performance):
 *   - the full scene is cached in an offscreen layer (staticLayer)
 *   - per frame we only blit that layer + draw river-tile shimmer highlights
 *   - the pop animation / pan / resize marks the layer dirty so it is rebuilt
 */

window.BlockRender = (function () {
  var BASE_H = 4;       // subtle base block height for flat land (px)
  var POP_RISE = 16;    // extra height added while a block pops up (px)
  var POP_DUR = 280;    // ms
  var LEFT_SHADE = 0.62;   // brightness factor of the left side face
  var RIGHT_SHADE = 0.42;  // brightness factor of the right side face
  var SELECT_STROKE = "rgba(41, 182, 246, 0.95)";
  var TOP_STROKE = "rgba(8, 10, 22, 0.4)";

  var api = {
    ctx: null,
    grid: null,
    terrain: null,
    staticLayer: null,
    selected: null,     // { col, row } | null
    shimmerPhase: 0,
    ripplePhase: 0,
    _dpr: 1,
    _dirty: false,
  };

  // HQ beacon — subtle pulse (just a little)
  var beaconPulse = { v: 0 };
  // river — simple flat water, single gentle global shimmer
  var RIVER_BASE = "#5B6FA8";
  var RIVER_LIGHT = "#7A90C8";
  var RIVER_ALPHA = 0.85;
  var riverShimmer = { v: 0 };

  var ORDER = [];       // tiles sorted back-to-front by (col+row)
  var rises = {};       // "col,row" -> current animated rise (px)
  var shadeCache = {};

  function key(c, r) { return c + "," + r; }

  // darker/lighter variant of a hex color for the side faces
  function shade(hex, factor) {
    var ck = hex + "|" + factor;
    if (shadeCache[ck]) return shadeCache[ck];
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var out = "rgb(" + Math.min(255, Math.round(r * factor)) + "," + Math.min(255, Math.round(g * factor)) +
              "," + Math.min(255, Math.round(b * factor)) + ")";
    shadeCache[ck] = out;
    return out;
  }

  api.init = function (ctx, grid, terrain) {
    api.ctx = ctx;
    api.grid = grid;
    api.terrain = terrain;
    api.staticLayer = document.createElement("canvas");

    var n = grid.gridSize;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) ORDER.push({ c: c, r: r });
    }
    ORDER.sort(function (a, b) { return (a.c + a.r) - (b.c + b.r); });

    startShimmerAnim();
    startBeaconPulse();
  };

  api.resize = function (w, h, dpr) {
    api._dpr = dpr || 1;
    api.staticLayer.width = Math.floor(w * api._dpr);
    api.staticLayer.height = Math.floor(h * api._dpr);
    api.redrawStatic();
  };

  // total visible height of a tile's block (base + terrain + pop rise)
  function totalHeight(c, r) {
    return BASE_H + api.terrain.elevationAt(c, r) + (rises[key(c, r)] || 0);
  }

  function drawBlock(ctx, c, r, totalH, topColor, isSelected) {
    var g = api.grid;
    var p = g.worldToScreen(c, r);
    var cx = p.x, cy = p.y;
    var iso = g.isoSize, half = iso / 2;
    var topY = cy - totalH;

    // top-face corners (the block rises straight up in screen space)
    var n = { x: cx, y: topY - half };
    var e = { x: cx + iso, y: topY };
    var s = { x: cx, y: topY + half };
    var w = { x: cx - iso, y: topY };

    // base corners of the block's column (at ground level)
    var sb = { x: cx, y: cy + half };      // south base
    var eb = { x: cx + iso, y: cy };       // east base

    if (totalH > 0.5) {
      // left face (front-left): W -> S -> S_base -> W_base
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(s.x, s.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.lineTo(cx - iso, cy);
      ctx.closePath();
      ctx.fillStyle = shade(topColor, LEFT_SHADE);
      ctx.fill();

      // right face (front-right): S -> E -> E_base -> S_base
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.lineTo(eb.x, eb.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.closePath();
      ctx.fillStyle = shade(topColor, RIGHT_SHADE);
      ctx.fill();
    }

    // top face — river shows slight transparency (riverbed depth)
    var isRiverTile = !!(api.terrain && api.terrain.isRiver && api.terrain.isRiver(c, r));
    if (isRiverTile) ctx.save();
    if (isRiverTile) ctx.globalAlpha = RIVER_ALPHA;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(e.x, e.y);
    ctx.lineTo(s.x, s.y);
    ctx.lineTo(w.x, w.y);
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();
    if (isRiverTile) ctx.restore();
    // zone tint overlay (0.4 opacity) — flat land zoned tiles show category color
    try {
      var zd = window.GameState && window.GameState.getTileData ? window.GameState.getTileData(c, r) : null;
      var zt = zd && zd.zoneType;
      if (zt) {
        var ZC = { residential: "#66BB6A", commercial: "#42A5F5", industrial: "#8D6E63", mining: "#FFB300" };
        var zc = ZC[zt] || null;
        if (zc) {
          var zr = parseInt(zc.slice(1,3),16), zg = parseInt(zc.slice(3,5),16), zb = parseInt(zc.slice(5,7),16);
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = "rgba(" + zr + "," + zg + "," + zb + ",1)";
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(e.x, e.y);
          ctx.lineTo(s.x, s.y);
          ctx.lineTo(w.x, w.y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    } catch(e){}
    ctx.strokeStyle = isSelected ? SELECT_STROKE : TOP_STROKE;
    ctx.lineWidth = isSelected ? 2.5 : 1;
    ctx.stroke();
  }

  // ---- scattered rock/boulder formations (hills) ----------------------
  // Hills never render as blocks: each cluster is a hub-and-satellite pile of
  // boulders — ONE dominant central rock plus 4-6 smaller rocks tightly
  // clustered around its base. Every boulder is a chunky irregular polyhedron
  // with a tapered top and EXACTLY three flat-shaded facets (lighter flat top,
  // medium left side, darker right side — no gradients, no glow, no smooth
  // shading). Stone gray tones only (never green), no snow caps. Each rock
  // sits flush on the ground plane and the flat land tile is drawn underneath
  // it, so the grid always renders complete with no gaps.

  var ROCK_TOP = "#AEB8BE";    // cool slate stone — top facet (reference grey)
  var ROCK_LEFT = "#7F8A93";   // slate blue-grey — left-facing side
  var ROCK_RIGHT = "#5B636A";  // dark slate — right-facing side
  var ROCK_TAPER = 0.55;       // top-face inset vs base width (chunky taper)
  var ROCK_JIT = 0.12;         // per-rock vertex irregularity (fraction of width)
  // ---- trench (one connected recessed pit) ---------------------------
  // The trench is NOT drawn per-tile as flat blocks: it is a single hollow
  // carved into the land. After the main loop we build the union of all
  // trench-tile diamonds and draw:
  //   - ONE flat floor polygon (dark purple tone, sunk below the land
  //     surface) with flat-shaded purple wall quads around it
  //   - flat-shaded wall quads ONLY along the outer boundary edges where a
  //     trench tile meets flat land (light west-facing wall + darker
  //     east-facing wall, matching the existing block-face shading style)
  // Internal trench-trench edges are interior to the floor polygon, so the
  // pit reads as one continuous depression with no internal seams.
  // The whole pit is clipped to the union of the trench tiles' ground
  // diamonds so the dark fill never spills past the trench's tile footprint
  // onto the adjacent land tiles.
  var TRENCH_DEPTH = 6;          // px the pit drops below the land surface
  var WALL_SHADE = 0.64;         // lit west-facing wall (matches LEFT_SHADE)
  var WALL_SHADOW = 0.40;        // shadowed east-facing wall (matches RIGHT_SHADE)
  var FLOOR_TONE = "#4A3F6B";    // deep violet/indigo — pit floor (hazard, contrast vs black + green)
  var WALL_TONE = "#6B5AA3";    // lighter violet wall — rim highlight complementing the deep fill

  // deterministic per-rock jitter so every boulder is a different chunk
  function rockJit(cx, cy, size, k) {
    var h = Math.sin(cx * 12.9898 + cy * 78.233 + size * 91.7 + k * 7.13) * 43758.5453;
    return (h - Math.floor(h)) - 0.5; // -0.5 .. 0.5
  }

  function drawRock(layer, cluster, rk) {
    var g = api.grid;
    var iso = g.isoSize;
    // never draw a boulder on top of river / trench / HQ — keep features on
    // their own tiles (the tile separation in terrain.js handles the ground,
    // this keeps stray satellite rocks from visually spilling onto them)
    var G = g.gridSize;
    var tc = Math.round(cluster.cx + rk.dc), tr = Math.round(cluster.cy + rk.dr);
    if (tc < 0 || tc >= G || tr < 0 || tr >= G) return;
    if (api.terrain) {
      var tt = api.terrain.typeAt(tc, tr);
      if (tt === "river" || tt === "trench" || tt === "hq") return;
    }
    var p = g.worldToScreen(cluster.cx + rk.dc, cluster.cy + rk.dr);
    var bx = p.x;
    var by = p.y - BASE_H;          // ground plane: the top face of the tile below
    var s = rk.size || 1;
    var rw = s * iso * 0.6;         // base half-width (px)
    var rh = s * iso * 0.3;         // base depth toward the viewer (px)
    var H = s * iso * 0.55;         // boulder height (px)
    var topY = by - H;
    var rwt = rw * ROCK_TAPER;      // inset top half-width (px)
    var rht = rh * 0.6;             // inset top depth (px)
    var cx0 = cluster.cx, cy0 = cluster.cy;

    // chunky irregular vertices: taper the top toward the apex of the pile and
    // jitter every corner so the silhouette reads as natural broken stone
    var j = ROCK_JIT;
    var n = { x: bx + rockJit(cx0, cy0, s, 0) * rw * j * 2.2, y: topY - rht + rockJit(cx0, cy0, s, 1) * rw * j };
    var e = { x: bx + rwt + rockJit(cx0, cy0, s, 2) * rw * j, y: topY - rockJit(cx0, cy0, s, 3) * rw * j * 0.6 };
    var ss = { x: bx + rockJit(cx0, cy0, s, 4) * rw * j, y: topY + rht + rockJit(cx0, cy0, s, 5) * rw * j * 0.5 };
    var w = { x: bx - rwt + rockJit(cx0, cy0, s, 6) * rw * j, y: topY - rockJit(cx0, cy0, s, 7) * rw * j * 0.6 };
    var wb = { x: bx - rw + rockJit(cx0, cy0, s, 8) * rw * j, y: by };
    var sb = { x: bx + rockJit(cx0, cy0, s, 9) * rw * j * 0.8, y: by + rh };
    var eb = { x: bx + rw + rockJit(cx0, cy0, s, 10) * rw * j, y: by };

    // left face (medium gray)
    layer.beginPath();
    layer.moveTo(w.x, w.y);
    layer.lineTo(ss.x, ss.y);
    layer.lineTo(sb.x, sb.y);
    layer.lineTo(wb.x, wb.y);
    layer.closePath();
    layer.fillStyle = ROCK_LEFT;
    layer.fill();

    // right face (darker gray)
    layer.beginPath();
    layer.moveTo(ss.x, ss.y);
    layer.lineTo(e.x, e.y);
    layer.lineTo(eb.x, eb.y);
    layer.lineTo(sb.x, sb.y);
    layer.closePath();
    layer.fillStyle = ROCK_RIGHT;
    layer.fill();

    // top facet (lighter flat stone)
    layer.beginPath();
    layer.moveTo(n.x, n.y);
    layer.lineTo(e.x, e.y);
    layer.lineTo(ss.x, ss.y);
    layer.lineTo(w.x, w.y);
    layer.closePath();
    layer.fillStyle = ROCK_TOP;
    layer.fill();
  }

  // draw a cluster's rocks back-to-front (front-most rocks last so they
  // overlap the ones behind them naturally). The dominant central boulder is
  // drawn first among the "back" group; smaller rocks in front cluster around
  // its base and read as a scattered pile.
  function drawRocks(layer, cluster) {
    var rocks = (cluster.rocks || []).slice().sort(function (a, b) { return a.dr - b.dr; });
    for (var i = 0; i < rocks.length; i++) drawRock(layer, cluster, rocks[i]);
  }

  // collect every trench tile (back-to-front by c+r for draw ordering)
  function trenchTiles() {
    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var t = ORDER[i];
      if (api.terrain.typeAt(t.c, t.r) === "trench") out.push(t);
    }
    return out;
  }

  // draw the whole trench as ONE recessed pit: every trench tile's diamond is
  // sunk below the land surface into a single continuous floor, and wall quads
  // are drawn ONLY along the outer boundary where a trench tile meets a
  // non-trench tile (light west/north-facing walls, darker east/south-facing
  // walls — matching the block side-face shading). Internal trench-trench
  // edges share the floor, so the pit reads as one hollow with no seams.
  // The pit is drawn BEFORE the land blocks in redrawStatic so that the
  // adjacent land tiles' side faces paint over the pit floor at the boundary,
  // preventing the dark fill from bleeding onto the land tiles' visible faces.
  // The whole pit is also clipped to the union of the trench tiles' ground
  // diamonds so the dark fill never spills past the trench's tile footprint.
  function drawTrenchPit(layer) {
    var g = api.grid;
    var iso = g.isoSize, half = iso / 2;
    var tiles = trenchTiles();
    if (!tiles.length) return;

    var isTrench = function (c, r) {
      return c >= 0 && c < g.gridSize && r >= 0 && r < g.gridSize &&
             api.terrain.typeAt(c, r) === "trench";
    };

    // 0) clip the whole pit to its own footprint (union of ground diamonds)
    layer.save();
    layer.beginPath();
    for (var ci = 0; ci < tiles.length; ci++) {
      var cp = g.worldToScreen(tiles[ci].c, tiles[ci].r);
      layer.moveTo(cp.x, cp.y - half);
      layer.lineTo(cp.x + iso, cp.y);
      layer.lineTo(cp.x, cp.y + half);
      layer.lineTo(cp.x - iso, cp.y);
      layer.closePath();
    }
    layer.clip();

    // 1) continuous floor: the union of all trench diamonds, sunk by depth
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var p = g.worldToScreen(t.c, t.r);
      var fy = p.y + TRENCH_DEPTH;
      layer.beginPath();
      layer.moveTo(p.x, fy - half);
      layer.lineTo(p.x + iso, fy);
      layer.lineTo(p.x, fy + half);
      layer.lineTo(p.x - iso, fy);
      layer.closePath();
      layer.fillStyle = FLOOR_TONE;
      layer.fill();
    }

    // 2) boundary walls: each edge facing a NON-trench tile grows a vertical
    // quad down to the floor (N/W faces catch the light, E/S fall in shadow)
    var shades = [WALL_SHADE, WALL_SHADOW, WALL_SHADOW, WALL_SHADE];
    var nbrs = [
      { dc: 0, dr: -1 },
      { dc: 1, dr: 0 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
    ];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var p = g.worldToScreen(t.c, t.r);
      var x = p.x, y = p.y;
      var corners = [
        { x: x, y: y - half },   // N
        { x: x + iso, y: y },    // E
        { x: x, y: y + half },   // S
        { x: x - iso, y: y },    // W
      ];
      for (var e = 0; e < 4; e++) {
        if (isTrench(t.c + nbrs[e].dc, t.r + nbrs[e].dr)) continue;
        var a = corners[e], b = corners[(e + 1) % 4];
        layer.beginPath();
        layer.moveTo(a.x, a.y);
        layer.lineTo(b.x, b.y);
        layer.lineTo(b.x, b.y + TRENCH_DEPTH);
        layer.lineTo(a.x, a.y + TRENCH_DEPTH);
        layer.closePath();
        layer.fillStyle = shade(WALL_TONE, shades[e]);
        layer.fill();
      }
    }

    layer.restore();
  }

  // ---- City Builder HQ — Figma 1:0.5, chunky 3.5, toy ----
  // Wide base (garages + orange stripe + blue awning), blue lower roof + AC cube,
  // tall centered tower (2×3 windows, half lit), overhanging dark helipad with H, thick antenna + red beacon.
  // Fits tile: base 1.32× iso wide, tower 0.68× iso, heights 3+7*BASE_H.
  var HQ_H = BASE_H * 10;
  var HQ_BASE_H = BASE_H * 3;
  var HQ_TOWER_H = BASE_H * 7;
  var HQ_TOP = "#2563EB";
  var HQ_LEFT = "#F8FAFC";
  var HQ_RIGHT = "#E2E8F0";
  var HQ_EDGE = "#0F172A";
  var WIN_LEFT = "#BAE6FD";
  var WIN_RIGHT = "#7DD3FC";
  var WIN_LIT = "#FDE68A";
  var DOOR_TONE = "#1E293B";
  var DOOR_ORANGE = "#F97316";
  var DOOR_AWNING = "#2563EB";
  var BADGE_OUTER = "#c9c9c2";
  var BADGE_STROKE = "#4a4a45";
  var BADGE_INNER = "#2c5d82";
  var MOD_TOP = "#F1F5F9";
  var MOD_LEFT = "#CBD5E1";
  var MOD_RIGHT = "#94A3B8";
  var VENT_A = "#6f6f68";
  var VENT_B = "#5a5a54";
  var VENT_CAP_A = "#4a4a45";
  var VENT_CAP_B = "#3d3d3a";
  var DISH_TONE = "#c9c9c2";
  var DISH_EDGE = "#8f8f89";
  var DISH_POST = "#4a4a45";
  var ANT_TONE = "#0F172A";
  var BEACON = "#EF4444";
  var HELIPAD_TOP = "#1E293B";
  var HELIPAD_SIDE = "#0F172A";
  var HELIPAD_H = "#FDE68A";

  // local point on the main block's west wall: u runs west -> east along
  // the wall, v runs top -> bottom down the face
  function leftWallPt(cx, topY, iso, half, H, u, v) {
    return { x: cx - iso + u * iso, y: topY + u * half + v * H };
  }

  // local point on the main block's east wall (u: south -> north)
  function rightWallPt(cx, topY, iso, half, H, u, v) {
    return { x: cx + u * iso, y: topY + half * (1 - u) + v * H };
  }

  // point on the roof plane (the top diamond): u runs west -> east,
  // v runs north -> south
  function roofPt(cx, topY, iso, half, u, v) {
    return { x: cx + (u - 0.5) * 2 * iso, y: topY + (v - 0.5) * iso };
  }

  // draw a wall detail (window/door) as a parallelogram following the wall
  // slant: local center (u, v), wu = width in u units, hv = height in v
  function drawWallQuad(ctx, wallPt, cx, topY, iso, half, H, u, v, wu, hv, fill) {
    var tl = wallPt(cx, topY, iso, half, H, u - wu / 2, v - hv / 2);
    var tr = wallPt(cx, topY, iso, half, H, u + wu / 2, v - hv / 2);
    var br = { x: tr.x, y: tr.y + hv * H };
    var bl = { x: tl.x, y: tl.y + hv * H };
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // draw a roof detail as a parallelogram on the roof plane
  function drawRoofQuad(ctx, cx, topY, iso, half, u, v, wu, hv, fill) {
    var tl = roofPt(cx, topY, iso, half, u - wu / 2, v - hv / 2);
    var tr = roofPt(cx, topY, iso, half, u + wu / 2, v - hv / 2);
    var br = roofPt(cx, topY, iso, half, u + wu / 2, v + hv / 2);
    var bl = roofPt(cx, topY, iso, half, u - wu / 2, v + hv / 2);
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // HQ placement — land stays so no void; chunky pop with blueprint/dust (keeps original gray tower palette)
  var hqPlace = { scale: 1, alpha: 1, active: false, blueprint: 0, dust: 0, dustR: 0 };
  api.triggerHQPlace = function (c, r) {
    hqPlace.scale = 0.88;
    hqPlace.alpha = 1;
    hqPlace.blueprint = 1;
    hqPlace.dust = 0;
    hqPlace.dustR = 0;
    hqPlace.active = true;
    if (typeof anime !== "undefined" && anime) {
      anime.remove(hqPlace);
      anime({ targets: hqPlace, blueprint: 0, duration: 380, easing: "easeOutQuad" });
      anime({ targets: hqPlace, dust: [0, 0.5, 0], dustR: [0, 1, 1.45], duration: 560, easing: "easeOutCubic" });
      anime({
        targets: hqPlace,
        scale: [0.88, 1.06, 1],
        duration: 520,
        easing: "easeOutBack",
        complete: function () { hqPlace.active = false; hqPlace.blueprint = 0; hqPlace.dust = 0; api.invalidate(); }
      });
      setTimeout(function () { if (hqPlace.active) { hqPlace.scale = 1; hqPlace.alpha = 1; hqPlace.active = false; hqPlace.blueprint = 0; hqPlace.dust = 0; api.invalidate(); } }, 900);
    } else {
      hqPlace.scale = 1; hqPlace.alpha = 1; hqPlace.blueprint = 0; hqPlace.dust = 0; hqPlace.active = false;
    }
    api.invalidate();
  };

  function drawHQBuilding(layer, c, r) {
    var g = api.grid;
    var iso = g.isoSize, half = iso / 2;
    var p = g.worldToScreen(c, r);
    var cx = p.x, cy = p.y;
    var topY = cy - HQ_H;
    var isNewHQ = hqPlace.active && window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === c && window.GameState.hqTile.row === r;
    if (isNewHQ) {
      if (hqPlace.blueprint > 0.01) {
        layer.save();
        layer.globalAlpha = hqPlace.blueprint * 0.52;
        layer.beginPath();
        layer.moveTo(cx, cy - half);
        layer.lineTo(cx + iso, cy);
        layer.lineTo(cx, cy + half);
        layer.lineTo(cx - iso, cy);
        layer.closePath();
        layer.fillStyle = "#7ED6FF";
        layer.fill();
        layer.strokeStyle = "#2B2320";
        layer.lineWidth = 2.5;
        layer.stroke();
        layer.strokeStyle = "rgba(43,35,32,0.20)";
        layer.lineWidth = 1;
        layer.beginPath();
        layer.moveTo(cx - iso*0.52, cy); layer.lineTo(cx + iso*0.52, cy);
        layer.moveTo(cx, cy - half*0.62); layer.lineTo(cx, cy + half*0.62);
        layer.stroke();
        layer.strokeStyle = "rgba(255,255,255,0.45)";
        layer.lineWidth = 1.5;
        layer.beginPath();
        layer.moveTo(cx - 6, cy); layer.lineTo(cx + 6, cy);
        layer.moveTo(cx, cy - 6); layer.lineTo(cx, cy + 6);
        layer.stroke();
        layer.restore();
      }
      if (hqPlace.dust > 0.01) {
        layer.save();
        layer.globalAlpha = hqPlace.dust;
        layer.strokeStyle = "#FFFBF0";
        layer.lineWidth = 3;
        layer.beginPath();
        layer.ellipse(cx, cy + half*0.2, iso * 0.72 * hqPlace.dustR, half * 0.44 * hqPlace.dustR, 0, 0, Math.PI*2);
        layer.stroke();
        layer.fillStyle = "rgba(255,255,255,0.16)";
        layer.beginPath();
        layer.ellipse(cx, cy + half*0.2, iso * 0.42 * hqPlace.dustR, half * 0.26 * hqPlace.dustR, 0, 0, Math.PI*2);
        layer.fill();
        layer.restore();
      }
      layer.save();
      layer.globalAlpha = hqPlace.alpha;
      layer.translate(cx, cy + half * 0.2);
      layer.scale(hqPlace.scale, hqPlace.scale);
      layer.translate(-cx, -(cy + half * 0.2));
    }

    // 1) loaf shadow + cable (chunky) — keep ground readable
    layer.beginPath();
    layer.ellipse(cx, cy + half * 0.22, iso * 1.02, half * 0.42, 0, 0, Math.PI * 2);
    layer.fillStyle = "rgba(0,0,0,0.18)";
    layer.fill();
    layer.beginPath();
    layer.moveTo(cx, cy + half);
    layer.quadraticCurveTo(cx + iso*0.38, cy + half + iso*0.52, cx + iso*0.98, cy + half + iso*0.58);
    layer.strokeStyle = HQ_EDGE;
    layer.lineWidth = 3.5;
    layer.lineCap = "round";
    layer.stroke();

    // ---- FIGMA CITY HQ: chunky two-tier — fits single tile, refined edges ----
    // modestly larger for readability (10% up) but still inside tile: base 0.99×, tower 0.60×
    // Scale building with iso so it stays proportionate (middle ground)
    var HQ_BASE_H = Math.max(8, Math.round(iso * 0.42));
    var HQ_TOWER_H = Math.max(14, Math.round(iso * 0.78));
    var bHalf = iso * 0.99;
    var tHalf = iso * 0.60;
    var baseTopY = cy - HQ_BASE_H;
    var towerTopY = baseTopY - HQ_TOWER_H;
    // refine edges: ensure canvas anti-aliasing and round joins for all HQ draws
    layer.lineJoin = "round"; layer.lineCap = "round"; layer.imageSmoothingEnabled = true; if (layer.imageSmoothingQuality) layer.imageSmoothingQuality = "high";

    // base top diamond
    var bn = {x:cx, y:baseTopY - bHalf/2};
    var be = {x:cx + bHalf, y:baseTopY};
    var bs = {x:cx, y:baseTopY + bHalf/2};
    var bw = {x:cx - bHalf, y:baseTopY};
    var bb = {x:cx, y:cy + half}; // bottom front
    var bwb = {x:cx - bHalf, y:cy + half - bHalf/2};
    var beb = {x:cx + bHalf, y:cy + half - bHalf/2};

    // base left wall
    layer.beginPath();
    layer.moveTo(bw.x, bw.y);
    layer.lineTo(bs.x, bs.y);
    layer.lineTo(bb.x, bb.y);
    layer.lineTo(bwb.x, bwb.y);
    layer.closePath();
    layer.fillStyle = HQ_LEFT;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // base right wall
    layer.beginPath();
    layer.moveTo(bs.x, bs.y);
    layer.lineTo(be.x, be.y);
    layer.lineTo(beb.x, beb.y);
    layer.lineTo(bb.x, bb.y);
    layer.closePath();
    layer.fillStyle = HQ_RIGHT;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // base roof — vivid blue
    layer.beginPath();
    layer.moveTo(bn.x, bn.y);
    layer.lineTo(be.x, be.y);
    layer.lineTo(bs.x, bs.y);
    layer.lineTo(bw.x, bw.y);
    layer.closePath();
    layer.fillStyle = HQ_TOP;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();

    // garages — simplified to door + single teal stripe (no separate awning band)
    var gW = 0.42, gH = 0.56;
    // left garage
    drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,u,v){ return leftWallPt(_cx, baseTopY, _is, _ha, HQ_BASE_H, u, v); }, cx, baseTopY, bHalf, bHalf/2, HQ_BASE_H, 0.34, 0.48, gW, gH, DOOR_TONE);
    drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,u,v){ return leftWallPt(_cx, baseTopY, _is, _ha, HQ_BASE_H, u, v); }, cx, baseTopY, bHalf, bHalf/2, HQ_BASE_H, 0.34, 0.50, gW, 0.14, DOOR_ORANGE);
    // right garage
    drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,u,v){ return rightWallPt(_cx, baseTopY, _is, _ha, HQ_BASE_H, u, v); }, cx, baseTopY, bHalf, bHalf/2, HQ_BASE_H, 0.34, 0.48, gW, gH, DOOR_TONE);
    drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,u,v){ return rightWallPt(_cx, baseTopY, _is, _ha, HQ_BASE_H, u, v); }, cx, baseTopY, bHalf, bHalf/2, HQ_BASE_H, 0.34, 0.50, gW, 0.14, DOOR_ORANGE);

    // AC — simplified to clean two-tone cube (no vent dot)
    (function(){
      var acU = 0.78, acV = 0.62, acS = 0.13;
      var acH = 11;
      var acBase = roofPt(cx, baseTopY, bHalf, bHalf/2, acU, acV);
      var acTop = {x:acBase.x, y:acBase.y - acH};
      var s = acS * bHalf;
      layer.beginPath();
      layer.moveTo(acTop.x, acTop.y - s/2);
      layer.lineTo(acTop.x + s, acTop.y);
      layer.lineTo(acTop.x, acTop.y + s/2);
      layer.lineTo(acTop.x - s, acTop.y);
      layer.closePath();
      layer.fillStyle = MOD_TOP; layer.fill();
      layer.strokeStyle = HQ_EDGE; layer.lineWidth = 2.5; layer.stroke();
      layer.beginPath();
      layer.moveTo(acTop.x - s, acTop.y);
      layer.lineTo(acTop.x, acTop.y + s/2);
      layer.lineTo(acTop.x, acBase.y + s/2);
      layer.lineTo(acTop.x - s, acBase.y);
      layer.closePath();
      layer.fillStyle = MOD_LEFT; layer.fill();
      layer.strokeStyle = HQ_EDGE; layer.lineWidth = 2.5; layer.stroke();
      layer.beginPath();
      layer.moveTo(acTop.x, acTop.y + s/2);
      layer.lineTo(acTop.x + s, acTop.y);
      layer.lineTo(acTop.x + s, acBase.y);
      layer.lineTo(acTop.x, acBase.y + s/2);
      layer.closePath();
      layer.fillStyle = MOD_RIGHT; layer.fill();
      layer.strokeStyle = HQ_EDGE; layer.lineWidth = 2.5; layer.stroke();
    })();

    // tower — centered on base roof
    var tn = {x:cx, y:towerTopY - tHalf/2};
    var te = {x:cx + tHalf, y:towerTopY};
    var ts = {x:cx, y:towerTopY + tHalf/2};
    var tw = {x:cx - tHalf, y:towerTopY};
    var twb = {x:cx - tHalf, y:baseTopY};
    var teb = {x:cx + tHalf, y:baseTopY};
    var tsb = {x:cx, y:baseTopY + tHalf/2};
    // left wall
    layer.beginPath();
    layer.moveTo(tw.x, tw.y);
    layer.lineTo(ts.x, ts.y);
    layer.lineTo(tsb.x, tsb.y);
    layer.lineTo(twb.x, twb.y);
    layer.closePath();
    layer.fillStyle = HQ_LEFT;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // right wall
    layer.beginPath();
    layer.moveTo(ts.x, ts.y);
    layer.lineTo(te.x, te.y);
    layer.lineTo(teb.x, teb.y);
    layer.lineTo(tsb.x, tsb.y);
    layer.closePath();
    layer.fillStyle = HQ_RIGHT;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // roof — blue
    layer.beginPath();
    layer.moveTo(tw.x, tw.y);
    layer.lineTo(tn.x, tn.y);
    layer.lineTo(te.x, te.y);
    layer.lineTo(ts.x, ts.y);
    layer.closePath();
    layer.fillStyle = HQ_TOP;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();

    // windows — simplified to ~half: 3 per face (was 6), slightly larger for read
    var winCols = [0.50], winRows = [0.24, 0.50, 0.76];
    // add second column for top/bottom only to keep 4 total? No — keep 3 clean.
    // To get 3 per face, use 1 col × 3 rows, larger 0.22×0.17
    for (var wj2=0; wj2<3; wj2++) {
      var u = 0.50, v = winRows[wj2];
      var litL = wj2 % 2 === 0;
      var litR = wj2 % 2 === 1;
      drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,uu,vv){ return leftWallPt(_cx, towerTopY, _is, _ha, HQ_TOWER_H, uu, vv); }, cx, towerTopY, tHalf, tHalf/2, HQ_TOWER_H, u, v, 0.22, 0.17, litL? WIN_LIT : WIN_LEFT);
      drawWallQuad(layer, function(_cx,_ty,_is,_ha,H,uu,vv){ return rightWallPt(_cx, towerTopY, _is, _ha, HQ_TOWER_H, uu, vv); }, cx, towerTopY, tHalf, tHalf/2, HQ_TOWER_H, u, v, 0.22, 0.17, litR? WIN_LIT : WIN_RIGHT);
    }
    // keep one extra pair at top for balance (total 4 per face, still ~half of 6? No — spec says roughly half, 3 is half of 6)
    // we keep the 3 as drawn above — clean, not cluttered

    // helipad — overhanging dark diamond on tower roof — scaled to tower, not fixed
    var hHalf = tHalf * 1.22;
    var hpCX = cx, hpCY = towerTopY;
    var hpThick = Math.max(5, Math.round(iso * 0.16));
    // top
    layer.beginPath();
    layer.moveTo(hpCX, hpCY - hHalf/2);
    layer.lineTo(hpCX + hHalf, hpCY);
    layer.lineTo(hpCX, hpCY + hHalf/2);
    layer.lineTo(hpCX - hHalf, hpCY);
    layer.closePath();
    layer.fillStyle = HELIPAD_TOP;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // thickness — left
    layer.beginPath();
    layer.moveTo(hpCX - hHalf, hpCY);
    layer.lineTo(hpCX, hpCY + hHalf/2);
    layer.lineTo(hpCX, hpCY + hHalf/2 + hpThick);
    layer.lineTo(hpCX - hHalf, hpCY + hpThick);
    layer.closePath();
    layer.fillStyle = HELIPAD_SIDE;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // thickness — right
    layer.beginPath();
    layer.moveTo(hpCX, hpCY + hHalf/2);
    layer.lineTo(hpCX + hHalf, hpCY);
    layer.lineTo(hpCX + hHalf, hpCY + hpThick);
    layer.lineTo(hpCX, hpCY + hHalf/2 + hpThick);
    layer.closePath();
    layer.fillStyle = "#1E293B";
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    // H — scaled flat 1,0.5
    layer.save();
    layer.translate(hpCX, hpCY);
    layer.scale(1, 0.5);
    var hFont = Math.max(12, Math.round(iso * 0.60));
    layer.font = "900 " + hFont + "px 'Baloo 2', sans-serif";
    layer.textAlign = "center";
    layer.textBaseline = "middle";
    layer.fillStyle = HELIPAD_H;
    layer.strokeStyle = HELIPAD_H;
    layer.lineWidth = 0.6;
    layer.fillText("H", 0, 5);
    layer.restore();

    // antenna — thick mast on helipad edge (left-back), red beacon with glow — evenly scaled with iso
    var antBase = {x: cx - hHalf*0.62, y: hpCY - hHalf*0.31};
    var antH = Math.max(12, Math.round(iso * 0.55));
    var antTop = {x: antBase.x, y: antBase.y - antH};
    var antW = Math.max(4, Math.round(iso * 0.12));
    var beaconR = Math.max(5, Math.round(iso * 0.15));
    var glowR = beaconR + Math.max(3, Math.round(iso * 0.09));
    // mast
    layer.fillStyle = HQ_EDGE;
    layer.beginPath();
    layer.rect(antBase.x - antW/2, antTop.y, antW, antBase.y - antTop.y);
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.strokeRect(antBase.x - antW/2, antTop.y, antW, antBase.y - antTop.y);
    // glow
    layer.beginPath();
    layer.arc(antTop.x, antTop.y, glowR, 0, Math.PI*2);
    layer.fillStyle = "rgba(239,68,68,0.22)";
    layer.fill();
    // beacon
    layer.beginPath();
    layer.arc(antTop.x, antTop.y, beaconR, 0, Math.PI*2);
    layer.fillStyle = BEACON;
    layer.fill();
    layer.strokeStyle = HQ_EDGE; layer.lineWidth = 3.5; layer.stroke();
    layer.beginPath();
    layer.arc(antTop.x - antW*0.33, antTop.y - beaconR*0.25, Math.max(1.5, beaconR*0.25), 0, Math.PI*2);
    layer.fillStyle = "#FFFBF0"; layer.fill();
    if (isNewHQ) layer.restore();
  }

  // mark the cached scene for rebuild — the actual redraw happens ONCE per
  // frame in tick(). Call this instead of redrawStatic() from per-event pan
  // handlers: redrawing the whole scene synchronously on every pointer-move
  // stalls the main thread and freezes every rAF-driven animation (dropping
  // frames while dragging is what made zone animations visibly glitch).
  api.invalidate = function () {
    api._dirty = true;
  };

  // rebuild the offscreen cache of the whole scene in correct depth order
  api.redrawStatic = function () {
    if (!api.staticLayer) return;
    var layer = api.staticLayer.getContext("2d");
    var g = api.grid;
    layer.setTransform(api._dpr, 0, 0, api._dpr, 0, 0);
    layer.clearRect(0, 0, g.canvasW, g.canvasH);
    // backdrop is transparent — the page's sky-to-ground gradient shows through

    // map each hill cluster to its front-most tile so the whole rock/boulder
    // formation is drawn at exactly that depth position (behind the tiles in
    // front of it)
    var clusters = api.terrain.rockClusters || [];
    var frontKey = {};
    for (var ci = 0; ci < clusters.length; ci++) {
      var cl = clusters[ci];
      var fk = null, fs = -Infinity;
      for (var ti = 0; ti < cl.tiles.length; ti++) {
        var tt = cl.tiles[ti];
        var s = tt.c + tt.r;
        if (s > fs) { fs = s; fk = tt.c + "," + tt.r; }
      }
      if (fk) frontKey[fk] = ci;
    }
    var drawnCluster = {};

    // draw the trench pit first (below the land surface), so that land blocks
    // painted later in the main loop naturally cover the pit at the boundary
    // where their side faces meet the pit floor — preventing the dark fill
    // from bleeding onto adjacent land tiles' side faces.
    drawTrenchPit(layer);

    for (var i = 0; i < ORDER.length; i++) {
      var t = ORDER[i];
      var k = t.c + "," + t.r;

      // ---- terrain block overlays (rock, HQ, other) -------------------
      var isHQ = api.terrain.isHQ(t.c, t.r);
      var isTrench = api.terrain.typeAt(t.c, t.r) === "trench";
      if (isTrench) {
        // trench tiles never draw a base block — the pit was drawn before the
        // main loop so land blocks paint over it at the boundary
        continue;
      }
      if (isHQ) {
        // keep green land under HQ so the tile never flashes a black void
        var isSelHQ = api.selected && api.selected.col === t.c && api.selected.row === t.r;
        drawBlock(layer, t.c, t.r, totalHeight(t.c, t.r), "#7EB24A", isSelHQ);
        drawHQBuilding(layer, t.c, t.r);
        continue;
      }
      var isRock = api.terrain.isRock(t.c, t.r);
      var isSel = api.selected && api.selected.col === t.c && api.selected.row === t.r;

      drawBlock(
        layer,
        t.c,
        t.r,
        totalHeight(t.c, t.r),
        isRock ? api.terrain.baseColorAt(t.c, t.r) : api.terrain.colorAt(t.c, t.r),
        isSel
      );

      // rock boulders are a visual overlay on the flat land, drawn once at the
      // cluster's front-most tile so depth occlusion stays correct
      if (isRock) {
        var ci = frontKey[k];
        if (ci !== undefined && drawnCluster[ci] !== true) {
          drawRocks(layer, clusters[ci]);
          drawnCluster[ci] = true;
        }
      }
    }
  };

  // river — simple flat water, no pattern. Base is solid RIVER_BASE at
  // 0.85 alpha (drawn in staticLayer). Overlay is a single subtle lighter
  // diamond per tile that gently pulses via anime, matching the chunky flat vibe.
  // river — ultra simple: solid base + one gentle global shimmer over the whole river
  // No per-tile strips/blocks/sparkles — just a calm, clean pulse that matches the flat vibe
  function drawShimmer(ctx) {
    var g = api.grid;
    if (!g || !g.isoSize) return;
    var iso = g.isoSize, half = iso / 2;
    var a = 0.14 + riverShimmer.v * 0.22; // 0.14-0.36 subtle but visible
    for (var i = 0; i < ORDER.length; i++) {
      var t = ORDER[i];
      if (!api.terrain.isRiver(t.c, t.r)) continue;
      var p = g.worldToScreen(t.c, t.r);
      var topY = p.y - totalHeight(t.c, t.r);
      var cx = p.x;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, topY - half);
      ctx.lineTo(cx + iso, topY);
      ctx.lineTo(cx, topY + half);
      ctx.lineTo(cx - iso, topY);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = a;
      ctx.fillStyle = RIVER_LIGHT;
      ctx.beginPath();
      ctx.moveTo(cx, topY - half + 2);
      ctx.lineTo(cx + iso - 2, topY);
      ctx.lineTo(cx, topY + half - 2);
      ctx.lineTo(cx - iso + 2, topY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // HQ beacon pulse — tiny, just a little (driven by beaconPulse.v)
  var beaconAnim = null;
  // ---- river shimmer / blocky ripple animation (driven by anime.js when available) -----
  var shimmerAnim = null;
  var rippleAnim = null;
  var glowAnim = null;
  var riverShimmerAnim = null;
  var riverGlow = 0.5; // 0..1 pulsing brightness, modulates highlight alpha

  function startBeaconPulse(){
    if(typeof anime!=="undefined" && anime && !beaconAnim){
      beaconAnim = anime({
        targets: beaconPulse, v:1, duration: 900, direction:"alternate", loop:true, easing:"easeInOutSine"
      });
    }
  }

  function startShimmerAnim() {
    if (typeof anime === "undefined" || !anime || shimmerAnim) return;

    // continuous flowing wave: the phase cycles 0 -> 1 on an infinite loop
    var phaseState = { phase: 0 };
    shimmerAnim = anime({
      targets: phaseState,
      phase: 1,
      duration: 1150,
      easing: "linear",
      loop: true,
      update: function () { api.shimmerPhase = phaseState.phase; },
    });

    // simple river shimmer — global gentle pulse
    if (typeof anime !== "undefined" && anime) {
      riverShimmerAnim = anime({
        targets: riverShimmer,
        v: 1,
        duration: 1600,
        direction: "alternate",
        loop: true,
        easing: "easeInOutSine"
      });
    }

    // blocky ripple phase — slow independent cycle for per-sub-block oscillation
    var rippleState = { phase: 0 };
    rippleAnim = anime({
      targets: rippleState,
      phase: 1,
      duration: 1600,
      easing: "linear",
      loop: true,
      update: function () { api.ripplePhase = rippleState.phase; },
    });

    // subtle brightness pulse overlaid on the flow so the water glints
    var glowState = { v: 0 };
    glowAnim = anime({
      targets: glowState,
      v: 1,
      duration: 1000,
      easing: "easeInOutSine",
      direction: "alternate",
      loop: true,
      update: function () { riverGlow = glowState.v; },
    });
  }

   // ---- services ----------------------------------------------------

   // per-frame update: rebuild cache only if dirty. The shimmer/ripple
  // phase is driven by anime.js; we fall back to manual advancement if missing.
  api.tick = function () {
    if (!shimmerAnim) {
      api.shimmerPhase += 0.015;
      if (api.shimmerPhase > 1) api.shimmerPhase -= 1;
    }
    if (!rippleAnim) {
      api.ripplePhase += 0.011;
      if (api.ripplePhase > 1) api.ripplePhase -= 1;
    }
    if (!riverShimmerAnim) {
      riverShimmer.v = (Math.sin(Date.now() * 0.002) + 1) * 0.5;
    }
    if (!beaconAnim) {
      beaconPulse.v = (Math.sin(Date.now() * 0.004) + 1) * 0.5; // ~0.8s cycle, just a little
    }
    if (api._dirty) {
      api.redrawStatic();
      api._dirty = false;
    }
  };

  // HQ beacon — tiny pulse drawn per-frame over the static HQ (so it animates just a little)
  function drawBeaconPulse(ctx){
    if(!window.GameState || !window.GameState.hqTile || !api.terrain || !api.terrain.isHQ) return;
    var hq = window.GameState.hqTile;
    if(!api.terrain.isHQ(hq.col, hq.row)) return;
    var g = api.grid; if(!g || !g.isoSize) return;
    var iso = g.isoSize;
    var HQ_BASE_H = Math.max(8, Math.round(iso * 0.42));
    var HQ_TOWER_H = Math.max(14, Math.round(iso * 0.78));
    // recompute antenna top exactly as in drawHQBuilding (proportional)
    var p = g.worldToScreen(hq.col, hq.row);
    var cx = p.x, cy = p.y;
    var baseTopY = cy - HQ_BASE_H;
    var tHalf = iso * 0.60;
    var towerTopY = baseTopY - HQ_TOWER_H;
    var hHalf = tHalf * 1.22;
    var hpCY = towerTopY;
    var antBaseX = cx - hHalf*0.62;
    var antBaseY = hpCY - hHalf*0.31;
    var antH = Math.max(12, Math.round(iso * 0.55));
    var antTopY = antBaseY - antH;
    var antW = Math.max(4, Math.round(iso * 0.12));
    var beaconR = Math.max(5, Math.round(iso * 0.15));
    var glowR = beaconR + Math.max(3, Math.round(iso * 0.09));
    var k = beaconPulse.v; // 0..1
    var pulse = 0.88 + 0.14 * k; // 0.88..1.02 scale — just a little
    var glowAlpha = 0.16 + 0.14 * k; // 0.16..0.30
    var beaconAlpha = 0.92 + 0.08 * k;
    // glow
    ctx.save();
    ctx.globalAlpha = glowAlpha;
    ctx.beginPath(); ctx.arc(antBaseX, antTopY, glowR * (0.96 + 0.18*k), 0, Math.PI*2);
    ctx.fillStyle = "rgba(239,68,68,1)"; ctx.fill();
    ctx.restore();
    // beacon body — subtle scale
    ctx.save();
    ctx.globalAlpha = beaconAlpha;
    ctx.translate(antBaseX, antTopY); ctx.scale(pulse, pulse); ctx.translate(-antBaseX, -antTopY);
    ctx.beginPath(); ctx.arc(antBaseX, antTopY, beaconR, 0, Math.PI*2);
    ctx.fillStyle = BEACON; ctx.fill();
    ctx.strokeStyle = HQ_EDGE; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(antBaseX - antW*0.33, antTopY - beaconR*0.25, Math.max(1.5, beaconR*0.25), 0, Math.PI*2);
    ctx.fillStyle = "#FFFBF0"; ctx.fill();
    ctx.restore();
  }

  // per-frame render: clear the whole canvas first (device-pixel exact under
  // the dpr transform), then draw the cached scene under 'copy' compositing so
  // every pixel is written unconditionally — the frame buffer can never retain
  // content from an earlier blit (which previously stacked duplicate copies of
  // the grid during camera panning). The river shimmer draws afterwards with
  // normal source-over blending.
  api.renderFrame = function (ctx) {
    if (!api.staticLayer) return;
    var gc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "copy";
    ctx.clearRect(0, 0, api.grid.canvasW, api.grid.canvasH);
    ctx.drawImage(api.staticLayer, 0, 0, api.grid.canvasW, api.grid.canvasH);
    ctx.globalCompositeOperation = "source-over";
    drawShimmer(ctx);
    drawBeaconPulse(ctx);
    // placement preview + deployed drone marker (drawn on top, per-frame so
    // the drop-in animation and the cursor-following preview stay smooth)
    if (window.DroneDeploy) window.DroneDeploy.renderMain(ctx, api.grid);
    if (window.GprDeploy) window.GprDeploy.renderMain(ctx, api.grid);
    if (window.CompactorTool) window.CompactorTool.render(ctx, api.grid);
    if (gc) ctx.globalCompositeOperation = gc;
  };

  function animateRise(c, r, targetRise) {
    var k = key(c, r);
    var state = { rise: rises[k] || 0 };
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: state,
        rise: targetRise,
        duration: POP_DUR,
        easing: "easeOutCubic",
        update: function () {
          rises[k] = state.rise;
          api._dirty = true;
        },
      });
    } else {
      rises[k] = targetRise;
      api._dirty = true;
    }
  }

  // select/deselect/swap logic for the pop-up animation
  // Rock, river and HQ have their own visuals — never do the generic block raise
  api.setSelected = function (c, r) {
    var terrain = api.terrain;
    var newType = terrain && terrain.typeAt ? terrain.typeAt(c, r) : null;
    var isSpecialNew = (newType === "rock" || newType === "river" || newType === "hq");
    var oldSel = api.selected;
    var oldType = null;
    if (oldSel && terrain && terrain.typeAt) {
      try { oldType = terrain.typeAt(oldSel.col, oldSel.row); } catch(e){}
    }
    var isSpecialOld = (oldType === "rock" || oldType === "river" || oldType === "hq");

    if (oldSel && oldSel.col === c && oldSel.row === r) {
      // toggle off: only animate if it wasn't a special tile
      if (!isSpecialNew) animateRise(c, r, 0);
      api.selected = null;
    } else {
      // swap (or fresh select): drop old if it was a normal tile
      if (oldSel && !isSpecialOld) animateRise(oldSel.col, oldSel.row, 0);
      api.selected = { col: c, row: r };
      // only pop new if it's a normal tile
      if (!isSpecialNew) animateRise(c, r, POP_RISE);
    }
    api._dirty = true;
  };

  return api;
})();
