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
    _dpr: 1,
    _dirty: false,
  };

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
    var out = "rgb(" + Math.round(r * factor) + "," + Math.round(g * factor) +
              "," + Math.round(b * factor) + ")";
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

    // top face
    ctx.beginPath();
    ctx.moveTo(n.x, n.y);
    ctx.lineTo(e.x, e.y);
    ctx.lineTo(s.x, s.y);
    ctx.lineTo(w.x, w.y);
    ctx.closePath();
    ctx.fillStyle = topColor;
    ctx.fill();
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
  var FLOOR_TONE = "#3E2010";    // deep chocolate — pit floor (reference dark earth)
  var WALL_TONE = "#6E3A1F";    // warm chocolate wall (reference winding path)

  // deterministic per-rock jitter so every boulder is a different chunk
  function rockJit(cx, cy, size, k) {
    var h = Math.sin(cx * 12.9898 + cy * 78.233 + size * 91.7 + k * 7.13) * 43758.5453;
    return (h - Math.floor(h)) - 0.5; // -0.5 .. 0.5
  }

  function drawRock(layer, cluster, rk) {
    var g = api.grid;
    var iso = g.isoSize;
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

  // ---- ConTech HQ building -------------------------------------------
  // The HQ tile draws a detailed building instead of a base block: a main
  // block ten flat-block-heights tall (same footprint as drawBlock) with
  // flat-shaded faces, corner edge lines, a 3x3 window grid on each wall,
  // an entrance door with a badge on the east wall, a secondary module
  // offset toward the dish (west) corner, roof details (vent pipes,
  // satellite dish, antenna with guy-wires + beacon) and a ground shadow
  // + service cable. All details are flat-shaded shapes — no gradients.
  var HQ_H = BASE_H * 10;        // main block height (px)
  var HQ_TOP = "#8a97a0";        // main block roof tone
  var HQ_LEFT = "#86847c";       // west-facing wall
  var HQ_RIGHT = "#5e5c56";      // east-facing wall
  var HQ_EDGE = "#3a3a36";       // corner edge lines
  var WIN_LEFT = "#3f6f8f";      // windows on the west wall
  var WIN_RIGHT = "#2c4f66";     // windows on the east wall
  var DOOR_TONE = "#232321";     // entrance door
  var BADGE_OUTER = "#c9c9c2";   // entrance badge ring
  var BADGE_STROKE = "#4a4a45";
  var BADGE_INNER = "#2c5d82";
  var MOD_TOP = "#9fb0c4";       // secondary module roof
  var MOD_LEFT = "#6f8296";      // module west wall
  var MOD_RIGHT = "#4d5d6d";     // module east wall
  var VENT_A = "#6f6f68";        // vent pipes (two tones for variety)
  var VENT_B = "#5a5a54";
  var VENT_CAP_A = "#4a4a45";
  var VENT_CAP_B = "#3d3d3a";
  var DISH_TONE = "#c9c9c2";     // satellite dish
  var DISH_EDGE = "#8f8f89";
  var DISH_POST = "#4a4a45";
  var ANT_TONE = "#3d3d3a";      // antenna / guy-wires
  var BEACON = "#e0483a";        // antenna beacon

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

  function drawHQBuilding(layer, c, r) {
    var g = api.grid;
    var iso = g.isoSize, half = iso / 2;
    var p = g.worldToScreen(c, r);
    var cx = p.x, cy = p.y;
    var topY = cy - HQ_H;

    // 1) ground: soft shadow under the footprint, then the service cable
    layer.beginPath();
    layer.ellipse(cx, cy + half * 0.2, iso, half, 0, 0, Math.PI * 2);
    layer.fillStyle = "rgba(0, 0, 0, 0.15)";
    layer.fill();

    layer.beginPath();
    layer.moveTo(cx, cy + half);
    layer.quadraticCurveTo(
      cx + iso * 0.35, cy + half + iso * 0.5,
      cx + iso * 0.95, cy + half + iso * 0.55
    );
    layer.strokeStyle = HQ_EDGE;
    layer.lineWidth = 3;
    layer.lineCap = "round";
    layer.stroke();

    // 2) main block faces (flat shaded: top / west / east)
    var n = { x: cx, y: topY - half };
    var e = { x: cx + iso, y: topY };
    var s = { x: cx, y: topY + half };
    var w = { x: cx - iso, y: topY };
    var wb = { x: cx - iso, y: cy };
    var eb = { x: cx + iso, y: cy };
    var sb = { x: cx, y: cy + half };

    layer.beginPath();
    layer.moveTo(w.x, w.y);
    layer.lineTo(s.x, s.y);
    layer.lineTo(sb.x, sb.y);
    layer.lineTo(wb.x, wb.y);
    layer.closePath();
    layer.fillStyle = HQ_LEFT;
    layer.fill();

    layer.beginPath();
    layer.moveTo(s.x, s.y);
    layer.lineTo(e.x, e.y);
    layer.lineTo(eb.x, eb.y);
    layer.lineTo(sb.x, sb.y);
    layer.closePath();
    layer.fillStyle = HQ_RIGHT;
    layer.fill();

    layer.beginPath();
    layer.moveTo(n.x, n.y);
    layer.lineTo(e.x, e.y);
    layer.lineTo(s.x, s.y);
    layer.lineTo(w.x, w.y);
    layer.closePath();
    layer.fillStyle = HQ_TOP;
    layer.fill();

    // 3) corner edge lines: west, east and shared (south) vertical edges
    layer.strokeStyle = HQ_EDGE;
    layer.lineWidth = 1.5;
    layer.globalAlpha = 0.5;
    layer.beginPath();
    layer.moveTo(w.x, w.y); layer.lineTo(wb.x, wb.y);
    layer.moveTo(e.x, e.y); layer.lineTo(eb.x, eb.y);
    layer.moveTo(s.x, s.y); layer.lineTo(sb.x, sb.y);
    layer.stroke();
    layer.globalAlpha = 1;

    // 4) windows: 3x3 grid on each wall (~8% face width, 12% block height)
    //    so the slits stay visible at typical tile sizes
    var wus = [0.2, 0.45, 0.7];
    var wvs = [0.15, 0.35, 0.55];
    for (var wi = 0; wi < wus.length; wi++) {
      for (var wj = 0; wj < wvs.length; wj++) {
        drawWallQuad(layer, leftWallPt, cx, topY, iso, half, HQ_H, wus[wi], wvs[wj], 0.08, 0.12, WIN_LEFT);
        drawWallQuad(layer, rightWallPt, cx, topY, iso, half, HQ_H, wus[wi], wvs[wj], 0.08, 0.12, WIN_RIGHT);
      }
    }

    // 5) entrance door (east wall, upper half so the front tile never
    //    occludes it) + badge above it
    drawWallQuad(layer, rightWallPt, cx, topY, iso, half, HQ_H, 0.7, 0.65, 0.08, 0.2, DOOR_TONE);

    var bd = rightWallPt(cx, topY, iso, half, HQ_H, 0.7, 0.47);
    var br = iso * 0.045;
    layer.beginPath();
    layer.arc(bd.x, bd.y, br, 0, Math.PI * 2);
    layer.fillStyle = BADGE_OUTER;
    layer.fill();
    layer.strokeStyle = BADGE_STROKE;
    layer.lineWidth = 1.5;
    layer.stroke();
    layer.beginPath();
    layer.arc(bd.x, bd.y, br * 0.6, 0, Math.PI * 2);
    layer.fillStyle = BADGE_INNER;
    layer.fill();

    // 6) secondary module: ~35% footprint, ~20% height, offset toward the
    //    dish (west) corner; base follows the roof plane, top stays flat
    var mu = 0.2, mv = 0.5;
    var mhw = 0.175, mhh = 0.0875;
    var MH = HQ_H * 0.2;
    var mb = {
      n: roofPt(cx, topY, iso, half, mu, mv - mhh),
      e: roofPt(cx, topY, iso, half, mu + mhw, mv),
      s: roofPt(cx, topY, iso, half, mu, mv + mhh),
      w: roofPt(cx, topY, iso, half, mu - mhw, mv),
    };
    var mt = {
      n: { x: mb.n.x, y: mb.n.y - MH },
      e: { x: mb.e.x, y: mb.e.y - MH },
      s: { x: mb.s.x, y: mb.s.y - MH },
      w: { x: mb.w.x, y: mb.w.y - MH },
    };

    layer.beginPath();
    layer.moveTo(mt.w.x, mt.w.y);
    layer.lineTo(mt.s.x, mt.s.y);
    layer.lineTo(mb.s.x, mb.s.y);
    layer.lineTo(mb.w.x, mb.w.y);
    layer.closePath();
    layer.fillStyle = MOD_LEFT;
    layer.fill();

    layer.beginPath();
    layer.moveTo(mt.s.x, mt.s.y);
    layer.lineTo(mt.e.x, mt.e.y);
    layer.lineTo(mb.e.x, mb.e.y);
    layer.lineTo(mb.s.x, mb.s.y);
    layer.closePath();
    layer.fillStyle = MOD_RIGHT;
    layer.fill();

    layer.beginPath();
    layer.moveTo(mt.n.x, mt.n.y);
    layer.lineTo(mt.e.x, mt.e.y);
    layer.lineTo(mt.s.x, mt.s.y);
    layer.lineTo(mt.w.x, mt.w.y);
    layer.closePath();
    layer.fillStyle = MOD_TOP;
    layer.fill();

    // corner edge line on the module's shared (south) vertical edge
    layer.strokeStyle = HQ_EDGE;
    layer.lineWidth = 1.5;
    layer.globalAlpha = 0.5;
    layer.beginPath();
    layer.moveTo(mt.s.x, mt.s.y);
    layer.lineTo(mb.s.x, mb.s.y);
    layer.stroke();
    layer.globalAlpha = 1;

    // 7) roof details: two vent pipes (body + cap on the north end)
    drawRoofQuad(layer, cx, topY, iso, half, 0.405, 0.6, 0.05, 0.1, VENT_A);
    drawRoofQuad(layer, cx, topY, iso, half, 0.405, 0.565, 0.05, 0.03, VENT_CAP_A);
    drawRoofQuad(layer, cx, topY, iso, half, 0.455, 0.6, 0.05, 0.1, VENT_B);
    drawRoofQuad(layer, cx, topY, iso, half, 0.455, 0.565, 0.05, 0.03, VENT_CAP_B);

    // 8) satellite dish mounted on the module roof (post + dish ellipse)
    var dp = roofPt(cx, topY, iso, half, mu, mv);
    var dBase = { x: dp.x, y: dp.y - MH };
    var dTop = { x: dp.x, y: dBase.y - iso * 0.14 };
    layer.beginPath();
    layer.moveTo(dBase.x, dBase.y);
    layer.lineTo(dTop.x, dTop.y);
    layer.strokeStyle = DISH_POST;
    layer.lineWidth = 2;
    layer.stroke();
    layer.beginPath();
    layer.ellipse(dTop.x, dTop.y, iso * 0.1, iso * 0.05, 0, 0, Math.PI * 2);
    layer.fillStyle = DISH_TONE;
    layer.fill();
    layer.strokeStyle = DISH_EDGE;
    layer.lineWidth = 1;
    layer.stroke();

    // 9) central antenna + dashed guy-wires + red beacon
    var ap = roofPt(cx, topY, iso, half, 0.5, 0.35);
    var at = { x: ap.x, y: ap.y - iso * 0.22 };
    layer.beginPath();
    layer.moveTo(ap.x, ap.y);
    layer.lineTo(at.x, at.y);
    layer.strokeStyle = ANT_TONE;
    layer.lineWidth = 2;
    layer.stroke();

    layer.strokeStyle = ANT_TONE;
    layer.lineWidth = 1;
    layer.globalAlpha = 0.5;
    layer.setLineDash([4, 3]);
    layer.beginPath();
    layer.moveTo(at.x, at.y);
    layer.lineTo(cx, topY - half);
    layer.moveTo(at.x, at.y);
    layer.lineTo(cx + iso, topY);
    layer.stroke();
    layer.setLineDash([]);
    layer.globalAlpha = 1;

    layer.beginPath();
    layer.arc(at.x, at.y, iso * 0.045, 0, Math.PI * 2);
    layer.fillStyle = BEACON;
    layer.fill();
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
    var clusters = api.terrain.hillClusters || [];
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

      // ---- terrain block overlays (hills, HQ, other) -------------------
      var isHQ = api.terrain.isHQ(t.c, t.r);
      var isTrench = api.terrain.typeAt(t.c, t.r) === "trench";
      if (isTrench) {
        // trench tiles never draw a base block — the pit was drawn before the
        // main loop so land blocks paint over it at the boundary
        continue;
      }
      if (isHQ) {
        // HQ tiles skip the base block and draw the detailed building instead
        drawHQBuilding(layer, t.c, t.r);
        continue;
      }
      var isHill = api.terrain.isHill(t.c, t.r);
      var isSel = api.selected && api.selected.col === t.c && api.selected.row === t.r;

      drawBlock(
        layer,
        t.c,
        t.r,
        totalHeight(t.c, t.r),
        isHill ? api.terrain.baseColorAt(t.c, t.r) : api.terrain.colorAt(t.c, t.r),
        isSel
      );

      // hill boulders are a visual overlay on the flat land, drawn once at the
      // cluster's front-most tile so depth occlusion stays correct
      if (isHill) {
        var ci = frontKey[k];
        if (ci !== undefined && drawnCluster[ci] !== true) {
          drawRocks(layer, clusters[ci]);
          drawnCluster[ci] = true;
        }
      }
    }
  };

  // river shimmer: flowing highlight bands that travel along the river path
  // (south-bound along the east edge). Each tile keeps its own timing and
  // intensity variation; only river tiles are touched every frame.
  function drawShimmer(ctx) {
    var g = api.grid;
    var iso = g.isoSize, half = iso / 2;
    var phase = api.shimmerPhase;
    for (var i = 0; i < ORDER.length; i++) {
      var t = ORDER[i];
      if (!api.terrain.isRiver(t.c, t.r)) continue;
      var p = g.worldToScreen(t.c, t.r);
      var topY = p.y - totalHeight(t.c, t.r);
      var cx = p.x;

      // the river hugs the east edge and flows south, so row is a monotonic
      // "distance along the current" for each water tile
      var along = t.r;

      // travelling wave: the highlight slides toward increasing `along` over time
      var wave = (((along * 0.13 - phase * 2.2) % 1) + 1) % 1;

      // per-tile timing/intensity variation (stable hash of the tile coords)
      var h = Math.abs(Math.sin(t.c * 12.9898 + t.r * 78.233) * 43758.5453) % 1;
      var band = (((wave + (h - 0.5) * 0.16) % 1) + 1) % 1;

      var a = Math.max(0, band - 0.22);
      var cc = Math.min(1, band + 0.22);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, topY - half);
      ctx.lineTo(cx + iso, topY);
      ctx.lineTo(cx, topY + half);
      ctx.lineTo(cx - iso, topY);
      ctx.closePath();
      ctx.clip();

      var grad = ctx.createLinearGradient(cx - iso, topY, cx + iso, topY);
      var alpha = (0.25 + 0.32 * riverGlow).toFixed(3);
      grad.addColorStop(0, "rgba(140, 210, 255, 0)");
      grad.addColorStop(a, "rgba(140, 210, 255, 0)");
      grad.addColorStop(band, "rgba(175, 230, 255, " + alpha + ")");
      grad.addColorStop(cc, "rgba(140, 210, 255, 0)");
      grad.addColorStop(1, "rgba(140, 210, 255, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(cx - iso, topY - half, iso * 2, iso);
      ctx.restore();
    }
  }

  // ---- river shimmer animation (driven by anime.js when available) -----
  var shimmerAnim = null;
  var glowAnim = null;
  var riverGlow = 0.5; // 0..1 pulsing brightness, modulates highlight alpha

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

   // per-frame update: rebuild cache only if dirty. The shimmer phase is
  // driven by anime.js; we fall back to manual advancement if it is missing.
  api.tick = function () {
    if (!shimmerAnim) {
      api.shimmerPhase += 0.015;
      if (api.shimmerPhase > 1) api.shimmerPhase -= 1;
    }
    if (api._dirty) {
      api.redrawStatic();
      api._dirty = false;
    }
  };

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
    // placement preview + deployed drone marker (drawn on top, per-frame so
    // the drop-in animation and the cursor-following preview stay smooth)
    if (window.DroneDeploy) window.DroneDeploy.renderMain(ctx, api.grid);
    if (window.GprDeploy) window.GprDeploy.renderMain(ctx, api.grid);
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
  api.setSelected = function (c, r) {
    if (api.selected && api.selected.col === c && api.selected.row === r) {
      // toggle off: animate the same block back down
      animateRise(c, r, 0);
      api.selected = null;
    } else {
      // swap (or fresh select): old block drops while the new one pops
      if (api.selected) animateRise(api.selected.col, api.selected.row, 0);
      api.selected = { col: c, row: r };
      animateRise(c, r, POP_RISE);
    }
    api._dirty = true;
  };

  return api;
})();
