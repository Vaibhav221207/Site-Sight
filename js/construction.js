/* js/construction.js — construction-site animation + unveiling ceremony.
 *
 * Flow per placed building: cash is spent up front (js/buildMenu.js), the
 * tile enters a ~2.6s BUILD phase (3D-printer gantry prints the ghost while
 * a mini robot paces the tile), then the build finishes UNDER A CURTAIN.
 * Tapping the curtained tile unveils it with a confetti celebration — only
 * then is zoneBuilding assigned and income starts. HQ goes through the same
 * ceremony (see beginHQ/reveal + js/hqBuild.js hook).
 *
 * State: d.construction = { id, sprite, zone, t0, dur } | null (building),
 * d.curtain = { id, sprite, zone, t0 } | null (ready to unveil),
 * api.hqCurtain = { col, row, t0 } | null, api.bursts = [{c,r,t0}].
 * Economy needs no changes: income/stain key off d.zoneBuilding, which only
 * exists after the tap. Placement guards treat constructing AND curtained
 * tiles as occupied (see isValid in js/buildMenu.js and js/roadTool.js).
 *
 * Motion craft (researched canvas-juice rules, all deterministic — render
 * must never Math.random): ease-out travel, anticipation drop-in, overshoot
 * settle (easeOutBack), evenly-spread burst angles with hash jitter, gravity
 * bias on debris. Time-driven pure functions of progress/clock.
 *
 * ART SLOT: the robot is procedural by default. To use external frames
 * (e.g. an Alpha3D turntable exported as PNGs), assign an array of loaded
 * Image elements to Construction.frames — drawTile uses frames[f % n]
 * instead of the procedural bot. No other change needed.
 */

window.Construction = (function () {
  var DURATION = 3400; // visible build time per tile (ms of run time; rAF pauses hide it)
  var BURST_MS = 1400; // confetti lifetime
  var CONFETTI = ["#C7432B", "#FFB300", "#22C55E", "#42A5F5", "#FFFBF0"];

  var api = {
    DURATION_MS: DURATION,
    frames: null, // optional Image[] robot frames (see ART SLOT above)
    hqBuild: null, // { col, row, t0 } — build phase before curtain
    hqCurtain: null,
    bursts: [],
  };

  api.now = function () {
    try {
      if (typeof performance !== "undefined" && performance.now) return performance.now();
    } catch (e) {}
    return Date.now();
  };

  api.reducedMotion = function () {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  };

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function easeOutCubic(p) { p = clamp01(p); return 1 - Math.pow(1 - p, 3); }
  function easeInOut(p) { p = clamp01(p); return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function easeOutBack(p) { p = clamp01(p); var s = 1.70158; return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2); }

  // deterministic 0..1 from tile + frame (render must never Math.random)
  function hash(c, r, f) {
    var h = ((c * 374761393 + r * 668265263 + f * 2246822519) & 0x7fffffff) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) & 0x7fffffff;
    return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
  }

  function tileData(c, r) {
    if (!window.GameState || !window.GameState.getTileData) return null;
    try { return window.GameState.getTileData(c, r); } catch (e) { return null; }
  }

  // NOTE: this module deliberately fires NO toast popups. Every construction
  // state already reads in the 3D scene itself — printer + robot + progress
  // bar while printing, gift box + pulsing ring + TAP! tag when ready,
  // confetti burst + rising building on reveal. Stacked text popups narrating
  // what the scene already shows is what made the flow feel generic.

  // called by BuildMenu.attempt after cash is spent. Stores everything the
  // tile needs; zoneBuilding stays null until the tap unveils it.
  api.begin = function (col, row, item) {
    var d = tileData(col, row);
    if (!d || !item) return false;
    d.construction = {
      id: item.id,
      sprite: item.sprite || null,
      zone: item.zone || (d.zoneType || null),
      t0: api.now(),
      dur: DURATION,
    };
    try { if (window.SaveSystem) window.SaveSystem.markDirty(); } catch(e){}
    return true;
  };

  // called by HQBuild.attempt instead of the instant pop: the HQ goes through
  // a build phase (printer + robot), then waits under a curtain for tap-to-reveal.
  api.beginHQ = function (col, row) {
    api.hqBuild = { col: col, row: row, t0: api.now() };
    try { if (window.SaveSystem) window.SaveSystem.markDirty(); } catch(e){}
    if (window.BlockRender && window.BlockRender.invalidate) {
      try { window.BlockRender.invalidate(); } catch (e) {}
    }
  };

  api.progressOf = function (d, now) {
    if (!d || !d.construction) return -1;
    var t = (now == null ? api.now() : now);
    return clamp01((t - d.construction.t0) / (d.construction.dur || DURATION));
  };

  // Tap-to-unveil. Returns true when a curtain was consumed (caller should
  // skip its normal click handling — no popup/panel on the reveal tap).
  api.reveal = function (col, row) {
    var now = api.now();
    // HQ curtain first (HQ tiles carry no tileData record of their own).
    if (api.hqCurtain && window.GameState && window.GameState.hqTile &&
        window.GameState.hqTile.col === col && window.GameState.hqTile.row === row &&
        api.hqCurtain.col === col && api.hqCurtain.row === row) {
      api.hqCurtain = null;
      api.bursts.push({ c: col, r: row, t0: now });
      if (window.BlockRender && window.BlockRender.triggerHQPlace) {
        try { window.BlockRender.triggerHQPlace(col, row); } catch (e) {}
      }
      if (window.Main && window.Main.updateHUD) {
        try { window.Main.updateHUD(); } catch (e2) {}
      }
      if (window.BlockRender && window.BlockRender.invalidate) {
        try { window.BlockRender.invalidate(); } catch (e3) {}
      }
      return true;
    }
    var d = tileData(col, row);
    if (!d || !d.curtain) return false;
    var cu = d.curtain;
    var zone = d.zoneType || cu.zone;
    d.zoneBuilding = cu.id;
    d.buildingSprite = cu.sprite;
    // Clear any hazard when building becomes operational
    d.hazard = null;
    if (zone && window.Buildings && window.Buildings.verdictFor) {
      d.zoneType = zone;
      d.zoneVerdict = window.Buildings.verdictFor(zone, d.bestUse);
      d.zoneMismatched = d.zoneVerdict !== "ok";
    }
    d.curtain = null;
    api.bursts.push({ c: col, r: row, t0: now });
    try { if (window.SaveSystem) window.SaveSystem.markDirty(); } catch(e){}
    if (window.Main && window.Main.updateHUD) {
      try { window.Main.updateHUD(); } catch (e4) {}
    }
    if (window.BlockRender && window.BlockRender.invalidate) {
      try { window.BlockRender.invalidate(); } catch (e5) {}
    }
    return true;
  };

  function anyFx(t) {
    if (api.hqBuild || api.hqCurtain) return true;
    for (var i = 0; i < api.bursts.length; i++) {
      if (t - api.bursts[i].t0 < BURST_MS) return true;
    }
    if (window.GameState && window.GameState.tileData) {
      var keys = Object.keys(window.GameState.tileData);
      for (var k = 0; k < keys.length; k++) {
        var d = window.GameState.tileData[keys[k]];
        if (d && (d.construction || d.curtain)) return true;
      }
    }
    return false;
  }

  // complete finished builds UNDER a curtain + expire confetti. Called once
  // per frame from Main.loop (guarded there). A mid-build rezone still
  // verdicts honestly because reveal() reads the CURRENT zone.
  api.update = function (now) {
    var gs = window.GameState;
    if (!gs || !gs.tileData) return 0;
    var t = (now == null ? api.now() : now);
    var done = 0;

    // HQ build phase: after DURATION, transition to curtain
    if (api.hqBuild && t - api.hqBuild.t0 >= DURATION) {
      api.hqCurtain = { col: api.hqBuild.col, row: api.hqBuild.row, t0: t };
      api.hqBuild = null;
      done++;
    }

    var keys = Object.keys(gs.tileData);
    for (var i = 0; i < keys.length; i++) {
      var d = gs.tileData[keys[i]];
      if (!d || !d.construction) continue;
      if (t - d.construction.t0 < (d.construction.dur || DURATION)) continue;
      var con = d.construction;
      d.curtain = { id: con.id, sprite: con.sprite, zone: con.zone, t0: t };
      d.construction = null;
      done++;
    }
    // sweep expired bursts
    var alive = [];
    for (var b = 0; b < api.bursts.length; b++) {
      if (t - api.bursts[b].t0 < BURST_MS) alive.push(api.bursts[b]);
    }
    api.bursts = alive;
    if (done > 0 || anyFx(t)) {
      if (window.BlockRender && window.BlockRender.invalidate) {
        try { window.BlockRender.invalidate(); } catch (e) {}
      }
    }
    return done;
  };

  function ink(ctx, w) {
    ctx.strokeStyle = "#2B2320";
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
  }

  // procedural mini robot, 1.35x presence: treads, amber body, blinking eye,
  // antenna light. Faces travel direction; bobs while pacing. u scales off
  // iso size; dir is +1/-1.
  function drawRobot(ctx, x, y, u, now, dir) {
    var s = 1.35;
    var bw = 30 * u * s, bh = 17 * u * s;
    var bob = Math.abs(Math.sin(now / 130)) * 2 * u;
    ctx.save();
    ctx.translate(x, y - bob);
    ctx.scale(dir >= 0 ? 1 : -1, 1);
    // treads
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    ctx.roundRect(-bw * 0.55, -bh * 0.1, bw * 1.1, bh * 0.42, bh * 0.2);
    ctx.fill();
    ctx.fillStyle = "#6B7280";
    for (var wI = -2; wI <= 2; wI++) {
      ctx.fillRect(wI * bw * 0.19 - u, -bh * 0.02, u * 2, bh * 0.26);
    }
    // body
    ctx.fillStyle = "#FFB300";
    ctx.beginPath();
    ctx.roundRect(-bw * 0.5, -bh * 0.85, bw, bh * 0.8, bh * 0.22);
    ctx.fill();
    ink(ctx, Math.max(1.5, 2.5 * u));
    ctx.stroke();
    // eye (blinks on a deterministic clock)
    var blink = (Math.floor(now / 450) % 5 === 4);
    ctx.fillStyle = blink ? "#2B2320" : "#22D3EE";
    ctx.beginPath();
    if (blink) ctx.fillRect(-bw * 0.28, -bh * 0.62, bw * 0.56, Math.max(1.5, 2.5 * u));
    else ctx.arc(bw * 0.12, -bh * 0.45, Math.max(1.5, 3.4 * u), 0, Math.PI * 2);
    if (!blink) ctx.fill();
    // antenna + tip light
    ink(ctx, Math.max(1, 1.6 * u));
    ctx.beginPath();
    ctx.moveTo(bw * 0.3, -bh * 0.85);
    ctx.lineTo(bw * 0.3, -bh * 1.15);
    ctx.stroke();
    ctx.fillStyle = (Math.floor(now / 300) % 2) ? "#C7432B" : "#FDE68A";
    ctx.beginPath();
    ctx.arc(bw * 0.3, -bh * 1.2, Math.max(1.2, 2.4 * u), 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, Math.max(1, 1.4 * u));
    ctx.stroke();
    ctx.restore();
  }

  // printer gantry with anticipation drop-in, eased head travel, laser,
  // rising ghost with overshoot settle, spark bursts, progress bar.
  // noGhost=true skips the rising sprite (used for HQ builds where the
  // building is drawn separately by blockRender, not as a tile sprite).
  function drawPrinter(ctx, cx, topY, iso, u, p, now, c, r, noGhost) {
    var half = iso / 2;
    var lx = cx - iso * 0.72, rx = cx + iso * 0.72;
    // feet stand ON the top face: at |dx| = 0.72*iso the diamond's lower
    // edge sits at topY + half*(1-0.72) ~= topY + half*0.3. Anything lower
    // sinks under the ground; anything higher floats above it.
    var baseY = topY + half * 0.3;
    var beamY = topY - iso * 1.05;
    // anticipation: whole gantry drops in over the first 12%
    var dropY = (1 - easeOutCubic(p / 0.12)) * iso * 0.9;
    ctx.save();
    ctx.translate(0, dropY);
    ctx.lineCap = "round";
    // posts
    ctx.fillStyle = "#FFB300";
    ink(ctx, Math.max(1.5, 2.5 * u));
    ctx.beginPath();
    ctx.roundRect(lx - 3 * u, beamY, 6 * u, baseY - beamY, 3 * u);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(rx - 3 * u, beamY, 6 * u, baseY - beamY, 3 * u);
    ctx.fill(); ctx.stroke();
    // beam
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    ctx.roundRect(lx - 5 * u, beamY - 4 * u, (rx - lx) + 10 * u, 8 * u, 4 * u);
    ctx.fill();
    // hazard ticks on the beam
    ctx.fillStyle = "#FFB300";
    for (var i = 0; i < 7; i++) {
      var tx = lx + ((rx - lx) * i) / 6;
      ctx.fillRect(tx - 1.5 * u, beamY - 4 * u, 3 * u, 8 * u);
    }
    // print head rides an eased path so it brakes into the finish
    var he = easeInOut(p);
    var hx = lx + (rx - lx) * he;
    var headBob = Math.sin(now / 90) * 1.5 * u;
    ctx.fillStyle = "#C7432B";
    ctx.beginPath();
    ctx.roundRect(hx - 6 * u, beamY - 2 * u + headBob, 12 * u, 12 * u, 3 * u);
    ctx.fill();
    ink(ctx, Math.max(1.5, 2 * u));
    ctx.stroke();
    // laser thread head -> print surface
    var surfY = topY - half * 0.2;
    ctx.strokeStyle = "rgba(34, 211, 238, 0.85)";
    ctx.lineWidth = Math.max(1, 1.8 * u);
    ctx.setLineDash([Math.max(2, 4 * u), Math.max(2, 3 * u)]);
    ctx.beginPath();
    ctx.moveTo(hx, beamY + 10 * u + headBob);
    ctx.lineTo(hx, surfY);
    ctx.stroke();
    ctx.setLineDash([]);
    // rising ghost of the real sprite; last stretch overshoots and settles
    // (skipped when noGhost=true — HQ is drawn separately by blockRender)
    if (!noGhost && window.BuildingSprites) {
      try {
        var d = tileData(c, r);
        var spr = d && d.construction ? d.construction.sprite : null;
        if (spr) {
          var sc = 1;
          if (p > 0.82) sc = 1 + 0.14 * (easeOutBack((p - 0.82) / 0.18) - ((p - 0.82) / 0.18));
          var gy = topY + iso * 0.42 + (1 - p) * iso * 0.45;
          window.BuildingSprites.draw(ctx, spr, cx, gy, iso * 1.15 * sc, 0.25 + 0.6 * p);
        }
      } catch (e) {}
    }
    // weld sparks around the laser point (deterministic per 100ms frame)
    var frame = Math.floor(now / 100);
    for (var s = 0; s < 10; s++) {
      var life = ((frame + s * 2) % 5) / 5; // 0 fresh -> 1 spent
      var h1 = hash(c + s * 7, r - s * 3, frame);
      var sx = hx + (h1 - 0.5) * iso * 0.7;
      var sy = surfY - (1 - life) * hash(c - s, r + s, frame + 9) * iso * 0.4 + life * life * 12 * u;
      ctx.globalAlpha = 1 - life;
      ctx.fillStyle = s % 2 ? "#FDE68A" : "#FFFFFF";
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, 3 * u * (1 - life * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // progress bar floating above the beam
    var bw2 = iso * 1.1, bx = cx - bw2 / 2, by = beamY - 14 * u;
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    ctx.roundRect(bx - 2 * u, by - 2 * u, bw2 + 4 * u, 8 * u, 4 * u);
    ctx.fill();
    ctx.fillStyle = "#22C55E";
    ctx.fillRect(bx, by, Math.max(0, bw2 * p), 4 * u);
    ctx.restore();
  }

  // unveiling curtain: a real 3D gift box sitting ON the tile (not the tile
  // painted yellow) — drop shadow, ground ring, left/right walls, lid with
  // overhang, wrap ribbon on every face, bow with loops/knot/tails, TAP! tag.
  // Light follows the game convention (blockRender LEFT_SHADE 0.62 vs
  // RIGHT_SHADE 0.42): top lightest, left medium, right darkest — and the
  // ribbon shades per face the same way. Pops in with overshoot, anchored at
  // the ground contact so it grows upward.
  function drawCurtain(ctx, cx, topY, iso, u, now, age) {
    var half = iso / 2;
    // ---- gift-box geometry (fractions of iso) ----
    var bw = iso * 0.60;          // box half-width (box is narrower than the tile)
    var wallH = iso * 0.44;       // wall height
    var gy = topY + half * 0.55;  // front-bottom corner: sits on the tile
    var cy = gy - wallH - bw / 2; // body top-face center
    var lh = bw / 2;              // body top rhombus vertical half
    var lt = Math.max(3, iso * 0.10); // lid thickness
    var cyL = cy - lt;            // lid top-face center
    var lw = bw * 1.08, lhL = lw / 2; // lid rhombus (overhangs the body)
    var wr = Math.max(2, iso * 0.085); // ribbon half-width on the lid top
    var wf = 0.16;                // ribbon fraction across each wall face
    var loopW = iso * 0.20, loopH = iso * 0.16; // bow loop size
    var bx = cx, by = cyL - loopH * 0.55; // bow knot center

    function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    function poly(pts, fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function rhomb(cx0, cy0, hw, hh) {
      ctx.beginPath();
      ctx.moveTo(cx0, cy0 - hh);
      ctx.lineTo(cx0 + hw, cy0);
      ctx.lineTo(cx0, cy0 + hh);
      ctx.lineTo(cx0 - hw, cy0);
      ctx.closePath();
    }

    var N = { x: cx, y: cy - lh }, E = { x: cx + bw, y: cy },
        S = { x: cx, y: cy + lh }, W = { x: cx - bw, y: cy };
    var SB = { x: cx, y: cy + lh + wallH },
        WB = { x: cx - bw, y: cy + wallH }, EB = { x: cx + bw, y: cy + wallH };
    var LS = { x: cx, y: cyL + lhL }, LW = { x: cx - lw, y: cyL }, LE = { x: cx + lw, y: cyL };

    // ---- ground ring FIRST (under the box — never crosses it) ----
    var pulse = 1;
    try {
      pulse = api.reducedMotion() ? 1 : 1 + 0.07 * Math.sin(now / 280);
    } catch (e) {}
    ctx.save();
    ctx.strokeStyle = "#C7432B";
    ctx.lineWidth = Math.max(2, 3 * u);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    // hug the box: the old 0.92 sprawled onto roads + neighbor tiles and
    // read as clutter where the curtain stands next to buildings.
    ctx.ellipse(cx, gy, iso * 0.74 * pulse, half * 0.74 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ---- pop-in scale, anchored at the ground contact ----
    var s = 0.5 + 0.5 * easeOutBack(age / 350);
    ctx.save();
    ctx.translate(cx, gy);
    ctx.scale(Math.max(0.01, s), Math.max(0.01, s));
    ctx.translate(-cx, -gy);

    // drop shadow on the tile
    ctx.save();
    ctx.fillStyle = "rgba(20, 16, 12, 0.28)";
    ctx.beginPath();
    ctx.ellipse(cx, gy + u, bw * 1.02, bw * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // walls: left MEDIUM, right DARKEST (game light convention)
    poly([W, S, SB, WB], "#E69E00");
    ink(ctx, Math.max(2, 2.5 * u));
    ctx.stroke();
    poly([E, S, SB, EB], "#B97A00");
    ink(ctx, Math.max(2, 2.5 * u));
    ctx.stroke();
    // wall ribbon bands (vertical center of each face, shaded per face)
    var la = lerp(W, S, 0.5 - wf), lb = lerp(W, S, 0.5 + wf);
    poly([la, lb, { x: lb.x, y: lb.y + wallH }, { x: la.x, y: la.y + wallH }], "#A83522");
    var ra = lerp(E, S, 0.5 - wf), rb = lerp(E, S, 0.5 + wf);
    poly([ra, rb, { x: rb.x, y: rb.y + wallH }, { x: ra.x, y: ra.y + wallH }], "#862815");
    // body top face (lightest)
    rhomb(cx, cy, bw, lh);
    ctx.fillStyle = "#FFB300";
    ctx.fill();
    ink(ctx, Math.max(2, 2.5 * u));
    ctx.stroke();

    // lid bands + lid top (lighter than the body so the lid reads separate)
    var lla = lerp(LW, LS, 0.5 - wf), llb = lerp(LW, LS, 0.5 + wf);
    poly([lla, llb, { x: llb.x, y: llb.y + lt }, { x: lla.x, y: lla.y + lt }], "#A83522");
    var lra = lerp(LE, LS, 0.5 - wf), lrb = lerp(LE, LS, 0.5 + wf);
    poly([lra, lrb, { x: lrb.x, y: lrb.y + lt }, { x: lra.x, y: lra.y + lt }], "#862815");
    poly([LW, LS, { x: LS.x, y: LS.y + lt }, { x: LW.x, y: LW.y + lt }], "#F2AC00");
    ink(ctx, Math.max(1.5, 2 * u));
    ctx.stroke();
    poly([LE, LS, { x: LS.x, y: LS.y + lt }, { x: LE.x, y: LE.y + lt }], "#C68400");
    ink(ctx, Math.max(1.5, 2 * u));
    ctx.stroke();
    // lid top with ribbon cross clipped to the rhombus (2:1 iso diagonals
    // are axis-aligned, so two plain rects make the wrap cross)
    ctx.save();
    rhomb(cx, cyL, lw, lhL);
    ctx.clip();
    ctx.fillStyle = "#FFC53D";
    ctx.fillRect(cx - lw - 2, cyL - lhL - 2, (lw + 2) * 2, (lhL + 2) * 2);
    ctx.fillStyle = "#C7432B";
    ctx.fillRect(cx - wr, cyL - lhL - 2, wr * 2, (lhL + 2) * 2);
    ctx.fillRect(cx - lw - 2, cyL - wr, (lw + 2) * 2, wr * 2);
    ctx.restore();
    rhomb(cx, cyL, lw, lhL);
    ink(ctx, Math.max(2, 2.5 * u));
    ctx.stroke();

    // ---- bow: tails, loops with shaded roots, knot, highlight ----
    ink(ctx, Math.max(1, 1.5 * u));
    // tails hanging from the knot
    ctx.fillStyle = "#C7432B";
    ctx.beginPath();
    ctx.moveTo(bx - 2 * u, by + 2 * u);
    ctx.lineTo(bx - 11 * u, by + 15 * u);
    ctx.lineTo(bx - 6 * u, by + 16 * u);
    ctx.lineTo(bx - u, by + 6 * u);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx + 2 * u, by + 2 * u);
    ctx.lineTo(bx + 11 * u, by + 15 * u);
    ctx.lineTo(bx + 6 * u, by + 16 * u);
    ctx.lineTo(bx + u, by + 6 * u);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // loops (pointed petals)
    function loop(dir) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + dir * loopW, by - loopH * 1.2,
        bx + dir * loopW * 1.15, by - loopH * 0.35);
      ctx.quadraticCurveTo(bx + dir * loopW * 0.4, by + loopH * 0.25, bx, by);
      ctx.closePath();
      ctx.fillStyle = "#C7432B";
      ctx.fill();
      ctx.stroke();
      // shaded root so the loop has depth instead of reading as a flat blob
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dir * loopW * 0.5, by - loopH * 0.15);
      ctx.lineTo(bx + dir * loopW * 0.35, by + loopH * 0.2);
      ctx.closePath();
      ctx.fillStyle = "#8E2A1B";
      ctx.fill();
    }
    loop(-1);
    loop(1);
    // knot + highlight
    ctx.fillStyle = "#D64A33";
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(3.5, 6.5 * u), 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, Math.max(1.5, 2 * u));
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#FFFBF0";
    ctx.beginPath();
    ctx.arc(bx - 2 * u, by - 2 * u, Math.max(1, 2 * u), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore(); // end pop-in scale

    // TAP! tag floating above the bow
    ctx.save();
    ctx.font = "700 " + Math.max(9, Math.round(11 * u)) + "px 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var tag = "TAP!";
    var tw = ctx.measureText ? ctx.measureText(tag).width : 30 * u;
    var tgw = tw + 14 * u, tgh = 18 * u;
    var txx = cx, tyy = (by - loopH) - 9 * u - tgh / 2;
    ctx.fillStyle = "#FFFBF0";
    ctx.beginPath();
    ctx.roundRect(txx - tgw / 2, tyy - tgh / 2, tgw, tgh, tgh / 2);
    ctx.fill();
    ink(ctx, Math.max(1.5, 2 * u));
    ctx.stroke();
    ctx.fillStyle = "#C7432B";
    ctx.fillText(tag, txx, tyy + u);
    ctx.restore();
  }

  // confetti burst at a tile: evenly fanned angles + hash jitter (never
  // clumps), gravity bias on the fall, batched by color. Returns false when
  // spent so update() can sweep it.
  function drawBurst(ctx, cx, topY, iso, u, age, c, r) {
    var t = age / BURST_MS;
    if (t < 0 || t >= 1) return false;
    var n = 24;
    var oy = topY - iso * 0.4;
    for (var ci = 0; ci < CONFETTI.length; ci++) {
      ctx.fillStyle = CONFETTI[ci];
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      for (var i = ci; i < n; i += CONFETTI.length) {
        var h1 = hash(c + i * 3, r - i, 7);
        var h2 = hash(c - i, r + i * 5, 21);
        var ang = (Math.PI * 2 * i) / n + (h1 - 0.5) * 0.9;
        var dist = (26 + h2 * 78) * u * easeOutCubic(t * 1.15 > 1 ? 1 : t * 1.15);
        var px = cx + Math.cos(ang) * dist;
        var py = oy + Math.sin(ang) * dist * 0.62 + t * t * 54 * u;
        var sz = Math.max(1, (2.5 + h1 * 3.5) * u * (1 - t * 0.4));
        ctx.moveTo(px + sz, py);
        ctx.arc(px, py, sz, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return true;
  }

  // frame entry called from BlockRender.drawBlock after drawBuilding.
  // cx/topY/iso use the same tile-top convention as drawBlock.
  api.drawTile = function (ctx, c, r, cx, topY, iso) {
    var now = api.now();
    var u = iso / 32;
    var drew = false;
    // celebration confetti first (under everything else on the tile)
    if (!api.reducedMotion()) {
      for (var b = 0; b < api.bursts.length; b++) {
        var bu = api.bursts[b];
        if (bu.c === c && bu.r === r) {
          ctx.save();
          try { drawBurst(ctx, cx, topY, iso, u, now - bu.t0, c, r); } catch (e) {}
          ctx.restore();
          drew = true;
        }
      }
    }
    // HQ build phase: printer + robot (no rising ghost — HQ is drawn
    // separately by blockRender, not as a tile sprite)
    if (api.hqBuild && window.GameState && window.GameState.hqTile &&
        window.GameState.hqTile.col === c && window.GameState.hqTile.row === r &&
        api.hqBuild.col === c && api.hqBuild.row === r) {
      var p = api.progressOf({ construction: { t0: api.hqBuild.t0, dur: DURATION } }, now);
      if (p >= 0) {
        ctx.save();
        try {
          drawPrinter(ctx, cx, topY, iso, u, p, now, c, r, true);
          var half = iso / 2;
          var span = iso * 0.6;
          var cyc = (now / 1000 + (c + r) * 0.37) % 2;
          var fwd = cyc < 1;
          var tri = fwd ? cyc : 2 - cyc;
          var rx = cx - span + tri * span * 2;
          var ry = topY + half * 0.72;
          drawRobot(ctx, rx, ry, u, now, fwd ? 1 : -1);
        } catch (e) {}
        ctx.restore();
        drew = true;
      }
    // HQ curtain (HQ tiles carry no tileData record of their own)
    } else if (api.hqCurtain && window.GameState && window.GameState.hqTile &&
        window.GameState.hqTile.col === c && window.GameState.hqTile.row === r &&
        api.hqCurtain.col === c && api.hqCurtain.row === r) {
      ctx.save();
      try { drawCurtain(ctx, cx, topY, iso, u, now, now - api.hqCurtain.t0); } catch (e2) {}
      ctx.restore();
      drew = true;
    } else {
      var d = tileData(c, r);
      if (d && d.construction) {
        var p = api.progressOf(d, now);
        if (p >= 0) {
          ctx.save();
          try {
            drawPrinter(ctx, cx, topY, iso, u, p, now, c, r);
            // robot paces the front edge: faster cycle, wider span, faces travel
            var half = iso / 2;
            var span = iso * 0.6;
            var cyc = (now / 1000 + (c + r) * 0.37) % 2;
            var fwd = cyc < 1;
            var tri = fwd ? cyc : 2 - cyc;
            var rx = cx - span + tri * span * 2;
            var ry = topY + half * 0.72;
            if (api.frames && api.frames.length) {
              var img = api.frames[Math.floor(now / 180) % api.frames.length];
              try {
                var iw = 30 * u, ih = (img.height && img.width) ? (img.height / img.width) * iw : iw;
                ctx.drawImage(img, rx - iw / 2, ry - ih, iw, ih);
              } catch (e3) { drawRobot(ctx, rx, ry, u, now, fwd ? 1 : -1); }
            } else {
              drawRobot(ctx, rx, ry, u, now, fwd ? 1 : -1);
            }
          } catch (e4) {}
          ctx.restore();
          drew = true;
        }
      } else if (d && d.curtain) {
        ctx.save();
        try { drawCurtain(ctx, cx, topY, iso, u, now, now - d.curtain.t0); } catch (e5) {}
        ctx.restore();
        drew = true;
      }
    }
    if (drew && window.BlockRender && window.BlockRender.invalidate) {
      try { window.BlockRender.invalidate(); } catch (e6) {}
    }
  };

  return api;
})();
