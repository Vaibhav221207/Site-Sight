/* js/blockRender.js — renders the world in isometric depth order:
 *   - land/trench/river tiles draw as extruded 3D blocks (top diamond + two
 *     shaded side faces), respecting elevation and the pop-up animation
 *   - hill tiles never draw as blocks; each hill cluster renders as a
 *     scattered rock/boulder formation at its correct depth position
 *   - the trench is one connected depression: a single flat floor polygon
 *     (darkest tone) sunk below the surrounding land, with light/dark
 *     flat-shaded wall quads only along its outer boundary (where the trench
 *     meets flat land); internal trench-trench edges share the floor, so the
 *     pit reads as one continuous carved hollow with no internal seams
 *   - a flowing shimmer highlights the river (moving bands along the current)
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
  var SELECT_STROKE = "rgba(0, 220, 255, 0.95)";
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

  var ROCK_TOP = "#a9a49b";    // lighter flat stone — the top facet
  var ROCK_LEFT = "#7d786f";   // medium gray — left-facing side
  var ROCK_RIGHT = "#615d56";  // darker gray — right-facing side
  var ROCK_TAPER = 0.55;       // top-face inset vs base width (chunky taper)
  var ROCK_JIT = 0.12;         // per-rock vertex irregularity (fraction of width)
  // ---- trench (one connected recessed pit) ---------------------------
  // The trench is NOT drawn per-tile as flat blocks: it is a single hollow
  // carved into the land. After the main loop we build the union of all
  // trench-tile diamonds and draw:
  //   - ONE flat floor polygon (darkest tone, sunk below the land surface)
  //   - flat-shaded wall quads ONLY along the outer boundary edges where a
  //     trench tile meets flat land (light west-facing wall + darker
  //     east-facing wall, matching the existing block-face shading style)
  // Internal trench-trench edges are interior to the floor polygon, so the
  // pit reads as one continuous depression with no internal seams.
  var TRENCH_DEPTH = 6;          // px the pit drops below the land surface
  var WALL_SHADE = 0.64;         // lit west-facing wall (matches LEFT_SHADE)
  var WALL_SHADOW = 0.40;        // shadowed east-facing wall (matches RIGHT_SHADE)

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

  // outer boundary of the trench union: ordered screen-space points of the
  // ground-level diamond corners. Internal edges shared by two trench tiles
  // cancel out, leaving only the perimeter.
  function trenchContour(tiles) {
    var g = api.grid, iso = g.isoSize, half = iso / 2;
    function corners(c, r) {
      var p = g.worldToScreen(c, r);
      return [
        { x: p.x, y: p.y - half },            // N
        { x: p.x + iso, y: p.y },             // E
        { x: p.x, y: p.y + half },            // S
        { x: p.x - iso, y: p.y },            // W
      ];
    }
    // directed edge -> remaining count; store geometry for each
    var cnt = {}, pts = {};
    function key(ax, ay, bx, by) { return ax + "," + ay + "->" + bx + "," + by; }
    for (var i = 0; i < tiles.length; i++) {
      var c = tiles[i].c, r = ti.r === undefined ? tiles[i].r : tiles[i].r;
      var cr = corners(c, r);
      // clockwise diamond: N->E, E->S, S->W, W->N
      var seq = [[0, 1], [1, 2], [2, 3], [3, 0]];
      for (var s = 0; s < seq.length; s++) {
        var a = cr[seq[s][0]], b = cr[seq[s][1]];
        var k = key(a.x, a.y, b.x, b.y);
        var rk = key(b.x, b.y, a.x, a.y);
        if (cnt[rk]) { cnt[rk]--; }             // reversed edge cancels
        else { cnt[k] = 1; pts[k] = { fx: a.x, fy: a.y, tx: b.x, ty: b.y }; }
      }
    }
    // chain the surviving (boundary) edges into an ordered polygon
    var order = [];
    for (var k in cnt) {
      if (cnt[k] > 0) {
        var p = pts[k];
        order.push({ x1: p.fx, y1: p.fy, x2: p.tx, y2: p.ty });
      }
    }
    if (!order.length) return [];
    // start at the topmost vertex, then walk the loop
    var best = 0;
    for (var j = 1; j < order.length; j++)
      if (order[j].y1 < order[best].y1 || (order[j].y1 === order[best].y1 && order[j].x1 < order[best].x1)) best = j;
    var polygon = [{ x: order[best].x1, y: order[best].y1 }];
    var cur = { x: order[best].x2, y: order[best].y2 };
    var used = [];
    used.push(best);
    polygon.push({ x: cur.x, y: cur.y });
    for (var step = 0; step < order.length - 1; step++) {
      var nxt = -1;
      for (var m = 0; m < order.length; m++) {
        if (used.indexOf(m) !== -1) continue;
        if (dist2(order[m].x1, order[m].y1, cur.x, cur.y) < 0.5) { nxt = m; break; }
      }
      if (nxt === -1) break;                       // safety: stop if no link
      used.push(nxt);
      cur = { x: order[nxt].x2, y: order[nxt].y2 };
      polygon.push({ x: cur.x, y: cur.y });
    }
    return polygon;
  }
  function dist2(a, b, c, d) { var dx = a - c, dy = b - d; return dx * dx + dy * dy; }

  // rebuild the offscreen cache of the whole scene in correct depth order
  api.redrawStatic = function () {
    if (!api.staticLayer) return;
    var layer = api.staticLayer.getContext("2d");
    var g = api.grid;
    layer.setTransform(api._dpr, 0, 0, api._dpr, 0, 0);
    layer.clearRect(0, 0, g.canvasW, g.canvasH);
    layer.fillStyle = "#0a0a14";
    layer.fillRect(0, 0, g.canvasW, g.canvasH);

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

    for (var i = 0; i < ORDER.length; i++) {
      var t = ORDER[i];
      var k = t.c + "," + t.r;

      // ---- terrain block overlays (hills, HQ, other) -------------------
      var isHQ = api.terrain.isHQ(t.c, t.r);
      if (isHQ) {
        // skip base block for HQ tiles (drawn later as distinct building)
        continue;
      }

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

      // render the HQ building if this tile hosts it (after all other terrain)
      if (isHQ) {
        api.hqBuild.render(layer, g, t.c, t.r);
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
  api.hqBuild = window.HQBuild;

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

  // per-frame render: blit the cached scene, then draw the river shimmer
  api.renderFrame = function (ctx) {
    if (!api.staticLayer) return;
    ctx.drawImage(api.staticLayer, 0, 0, api.grid.canvasW, api.grid.canvasH);
    drawShimmer(ctx);
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
