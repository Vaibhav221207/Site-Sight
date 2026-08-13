/* js/gprDeploy.js -- GPR (Ground Penetrating Radar) System deployment.
 *
 * A SECOND survey tier that runs AFTER the aerial Drone scan. Where the Drone
 * System is an aerial/visual sweep (cone of light from a hovering quadcopter),
 * the GPR System is a GROUND-based subsurface survey: a rover crawls each chunk
 * and emits expanding RADAR RINGS across the ground plane (no aerial cone),
 * tinted violet to read as "penetrating the earth" rather than "looking from
 * the sky". The whole sweep is whole-map and no-click, exactly like the drone.
 *
 * The map is split into the SAME 8 fixed chunks of 5 cols x 10 rows (4 across x
 * 2 down) used by DroneDeploy, processed in the same fixed left-to-right,
 * top-to-bottom order, with the same 2-concurrent "zone slot" overlap so the
 * handoff between chunks is seamless. Fully subsurface-scanned chunks are
 * skipped without animating. A chunk that is only partially subsurface-scanned
 * still runs and marks ALL of its tiles subsurface-scanned.
 *
 * CONSUMABLE: confirming a deployment immediately decrements
 * GameState.inventory.gprCount (the deployed GPR unit leaves the fleet), clears
 * the INVENTORY selection, and refreshes the STORE owned-count readout.
 *
 * SCAN-ONCE (per tier): as each chunk's survey completes, every tile in that
 * chunk is marked permanently subsurface-scanned (GameState.markAreaSubsurfaceScanned).
 *
 * The GPR only reveals SUBSurface data (minerals, water table, stability) — the
 * aerial Drone scan remains the source of surface data (terrain, elevation,
 * vegetation, soil). LandData.getTileData gates the two tiers accordingly.
 */

window.GprDeploy = (function () {
  "use strict";

  // -- timing / geometry (mirrors DroneDeploy chunk scheduler) --------------
  var DROP_DUR = 420;          // rover drives in
  var SCAN_MOVE_DUR = 600;     // rover settles to its survey position
  var SCAN_FADE_IN_DUR = 450;  // radar rings + ground pulse fade in
  var SCAN_HOLD_DUR = 4000;    // hold ~ one full down+up sweep, then release (fewer laps)
  var SCAN_FADE_OUT_DUR = 450; // radar rings + ground pulse fade out
  var EXIT_DUR = 550;          // rover drives away + fades
  var EXIT_RISE = 60;          // px the departing rover slides (it drives off)
  var HOVER_RISE = 0;          // ground-based: rover sits ON the surface
  var RING_PULSE_LO = 0.2;     // ring-opacity pulse floor during the hold
  var RING_PULSE_HI = 0.85;    // ring-opacity pulse ceiling during the hold
  var RING_PULSE_DUR = 1500;   // glow/scanline brightness pulse half-cycle (ms)
  var GROUND_PULSE_LO = 0.18;  // ground glow pulse floor
  var GROUND_PULSE_HI = 0.5;   // ground glow pulse ceiling
  var GROUND_LOOP_DUR = 2000;  // one-way scan-line pass (ms) — slow, calm sweep

  var AREA_W = 20;          // full grid width per GPR section (wide sweep band)
  var AREA_H = 10;
  var MAX_ZONES = 2;
  var CHUNK_COLS = 1;        // 1 column x 2 rows = two horizontal GPR sections
  var CHUNK_ROWS = 2;

  // GPR palette — warm radar-AMBER. Subsurface/radar imagery is classically
  // shown in amber/earth tones (radar-phosphor + Crameri "GrayC" radar ramp),
  // which also harmonises with the game's existing gold HQ accent and the orange
  // in the soil-quality heatmap — so GPR reads as part of the same world, not a
  // random violet. Clearly distinct from the Drone's cyan aerial cone.
  var RING_COLOR = "#FFB02E";        // radar ring outline (amber)
  var GROUND_FILL = "#C8761A";       // ground radar glow (burnt amber)
  var ROVER_BODY = "#5A4632";        // rover chassis (earthy)
  var ROVER_ACCENT = "#FFB02E";      // rover nav light (amber)
  var ROVER_SHADOW = "rgba(0,0,0,0.22)";
  var OUTLINE_COLOR = "#FFC04D";     // committed GPR survey area outline (amber)

  var BASE_H = 4;

  var api = {
    deploying: false,
    chunks: [],
    zones: [],
    deployed: null,
    onDeployDone: null,
    onZoneStart: null,
  };

  // -- grid helpers -------------------------------------------------------

  function groundTopY(c, r) {
    var g = window.IsoGrid;
    var p = g.worldToScreen(c, r);
    var elev = window.Terrain ? window.Terrain.elevationAt(Math.floor(c), Math.floor(r)) : 0;
    return p.y - (BASE_H + elev);
  }

  function setCursor(v) {
    var ih = window.InputHandler;
    if (!ih) return;
    if (typeof ih.setCursor === "function") { ih.setCursor(v); }
    else if (ih.canvas) { ih.canvas.style.cursor = v; }
  }

  function tileScreen(c, r) {
    return window.IsoGrid.worldToScreen(c, r);
  }

  function centerTile(area) {
    return { col: area.centerCol, row: area.row };
  }

  // -- chunk layout (identical footprint to DroneDeploy) -------------------

  function buildChunk(i) {
    var g = window.IsoGrid;
    var max = g ? g.gridSize : 20;
    var col0 = (i % CHUNK_COLS) * AREA_W;
    var row0 = Math.floor(i / CHUNK_COLS) * AREA_H;
    var cMin = col0, cMax = Math.min(col0 + AREA_W - 1, max - 1);
    var rMin = row0, rMax = Math.min(row0 + AREA_H - 1, max - 1);
    var centerCol = Math.round((cMin + cMax) / 2);
    var tiles = [];
    for (var ry = rMin; ry <= rMax; ry++) {
      for (var cx = cMin; cx <= cMax; cx++) {
        tiles.push({ col: cx, row: ry });
      }
    }
    return { idx: i, col: centerCol, row: Math.round((rMin + rMax) / 2), centerCol: centerCol, w: AREA_W, h: AREA_H, rMin: rMin, rMax: rMax, cMin: cMin, cMax: cMax, tiles: tiles };
  }

  function chunkFullyScanned(area) {
    var gs = window.GameState;
    if (!gs || !gs.isTileSubsurfaceScanned) return false;
    for (var i = 0; i < area.tiles.length; i++) {
      var t = area.tiles[i];
      if (!gs.isTileSubsurfaceScanned(t.col, t.row)) return false;
    }
    return true;
  }

  // -- deployment scheduler ----------------------------------------------

  api.startDeployment = function () {
    if (api.deploying) return false;
    var gs = window.GameState;
    if (!gs) return false;
    if (!gs.inventory || gs.inventory.gprCount <= 0) return false;

    gs.inventory.gprCount -= 1;
    gs.inventory.selectedGprId = null;
    if (window.HqPanel) {
      if (window.HqPanel.updateOwned) window.HqPanel.updateOwned();
      if (window.HqPanel.renderInventory) window.HqPanel.renderInventory();
    }
    setCursor("grab");

    var queue = [];
    for (var i = 0; i < CHUNK_COLS * CHUNK_ROWS; i++) {
      var area = buildChunk(i);
      if (chunkFullyScanned(area)) continue;
      queue.push(area);
    }

    api.chunks = queue;
    api.zones = [];
    api.deploying = true;
    api.deployed = null;
    if (gs.inventory) gs.inventory.gprDeployed = null;
    api._fillSlots();
    return true;
  };

  function activeSlotCount() {
    var n = 0;
    for (var i = 0; i < api.zones.length; i++) {
      if (!api.zones[i].releasing) n++;
    }
    return n;
  }

  api._fillSlots = function () {
    if (api._filling) return;
    api._filling = true;
    while (activeSlotCount() < MAX_ZONES && api.chunks.length > 0) {
      api._launchZone(api.chunks.shift());
    }
    api._filling = false;
    if (api.zones.length === 0) {
      api.deploying = false;
      api.chunks = [];
      api.deployed = { wholeMap: true };
      if (window.GameState && window.GameState.inventory) {
        window.GameState.inventory.gprDeployed = { wholeMap: true };
      }
      if (typeof api.onDeployDone === "function") api.onDeployDone();
    }
  };

  api._launchZone = function (area) {
    var zone = { area: area, status: "dropping", releasing: false, drop: null, scan: null, exit: null };
    api.zones.push(zone);
    if (typeof api.onZoneStart === "function") api.onZoneStart(area.idx, api.zones.length);
    api._startDrop(zone, area, function () {
      api._startScan(zone, area);
    });
  };

  api._zoneDone = function (zone) {
    zone.status = "done";
    zone.drop = null;
    zone.scan = null;
    zone.exit = null;
    var ix = api.zones.indexOf(zone);
    if (ix !== -1) api.zones.splice(ix, 1);
    api._fillSlots();
  };

  api.cancel = function () {
    for (var i = 0; i < api.zones.length; i++) {
      var z = api.zones[i];
      api._stopDrop(z);
      api._stopScan(z);
      api._stopExit(z);
    }
    api.zones = [];
    api.chunks = [];
    api.deploying = false;
    api.deployed = null;
    setCursor("grab");
  };

  api.isValid = function () { return false; };
  api.attempt = function () { return false; };
  api.setHover = function () {};
  api.clearHover = function () {};

  api._buildChunk = buildChunk;

  // -- animation state teardown (per zone) -------------------------------

  api._stopDrop = function (zone) {
    if (zone && zone.drop && zone.drop.tween) {
      try { zone.drop.tween.pause(); } catch (e) {}
    }
    if (zone) zone.drop = null;
  };
  api._stopScan = function (zone) {
    if (zone && zone.scan) {
      if (zone.scan.tween) { try { zone.scan.tween.pause(); } catch (e) {} }
      if (zone.scan.pulseTween) { try { zone.scan.pulseTween.pause(); } catch (e) {} }
      if (zone.scan.groundTween) { try { zone.scan.groundTween.pause(); } catch (e) {} }
      if (zone.scan.sweepTween) { try { zone.scan.sweepTween.pause(); } catch (e) {} }
    }
    if (zone) zone.scan = null;
  };
  api._stopExit = function (zone) {
    if (zone && zone.exit && zone.exit.tween) {
      try { zone.exit.tween.pause(); } catch (e) {}
    }
    if (zone) zone.exit = null;
  };

  // -- ground radar scan (one independent instance per zone) -------------
  // UNIFIED GROUND RADAR SCAN. After the rover drives in, it settles at the
  // chunk's center tile and emits expanding RADAR RINGS across the ground plane
  // (no aerial cone). The rings + ground glow fade in while the rover settles,
  // hold while looping anime tweens pulse the ring opacity and drift the ground
  // glow, then fade out. SCAN-ONCE marks the chunk's tiles subsurface-scanned.
  api._startScan = function (zone, area) {
    api._stopScan(zone);
    if (typeof anime === "undefined" || !anime || !window.IsoGrid) { api._startExit(zone, area); return; }

    var g = window.IsoGrid;
    var iso = g.isoSize;
    var corners = areaCorners(area);

    var t = centerTile(area);
    var tp = tileScreen(t.col, t.row);
    var roverX = tp.x;
    var roverY = groundTopY(t.col, t.row);

    var rovers = [{ x: roverX, y: roverY, alpha: 1 }];

    var TOTAL = SCAN_MOVE_DUR + SCAN_FADE_IN_DUR + SCAN_HOLD_DUR + SCAN_FADE_OUT_DUR;
    var scan = {
      rovers: rovers,
      corners: corners,
      camStart: { x: g.camera.x, y: g.camera.y, iso: g.isoSize },
      alpha: 0,
      pulse: RING_PULSE_LO,
      ground: GROUND_PULSE_LO,
      ringPhase: 0,
      sweep: 0,
      maxSweep: 0,
      progress: 0,
      t0: Date.now(),
      tween: null,
      pulseTween: null,
      groundTween: null,
      sweepTween: null,
    };
    zone.scan = scan;

    function scanProgress() {
      var s = zone.scan;
      if (!s) return;
      s.progress = Math.max(0, Math.min(1, (Date.now() - s.t0) / TOTAL));
    }

    var t0 = anime({
      targets: rovers,
      y: roverY,
      alpha: 1,
      duration: SCAN_MOVE_DUR,
      easing: "easeInOutQuad",
      update: function () { if (zone.scan) scanProgress(); },
      complete: function (anim) {
        if (anim.completed === false || !zone.scan) return;
        fadeIn();
      },
    });
    scan.tween = t0;

    function fadeIn() {
      var s = zone.scan;
      if (!s) return;
      s.alpha = 0;
      var t1 = anime({
        targets: s,
        alpha: 1,
        duration: SCAN_FADE_IN_DUR,
        easing: "easeOutQuad",
        update: function () { if (zone.scan) scanProgress(); },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          hold();
        },
      });
      s.tween = t1;
    }

    function hold() {
      var s = zone.scan;
      if (!s) return;
      s.pulse = RING_PULSE_LO;
      s.ground = GROUND_PULSE_LO;
      s.ringPhase = 0;
      s.pulseTween = anime({
        targets: s,
        pulse: [RING_PULSE_LO, RING_PULSE_HI],
        ringPhase: [0, 1],
        duration: RING_PULSE_DUR,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
        update: function () { if (zone.scan) scanProgress(); },
      });
      s.groundTween = anime({
        targets: s,
        ground: [GROUND_PULSE_LO, GROUND_PULSE_HI],
        duration: GROUND_LOOP_DUR,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
        update: function () { if (zone.scan) scanProgress(); },
      });
      s.sweep = 0;
      s.maxSweep = 0;
      s.sweepTween = anime({
        targets: s,
        sweep: [0, 1],
        duration: GROUND_LOOP_DUR,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
        update: function () { if (zone.scan) scanProgress(); },
      });
      var holdState = { v: 0 };
      var t2 = anime({
        targets: holdState,
        v: 1,
        duration: SCAN_HOLD_DUR,
        easing: "linear",
        update: function () { if (zone.scan) scanProgress(); },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          zone.releasing = true;
          api._fillSlots();
          fadeOut();
        },
      });
      s.tween = t2;
    }

    function fadeOut() {
      var s = zone.scan;
      if (!s) return;
      if (s.pulseTween) { try { s.pulseTween.pause(); } catch (e) {} }
      if (s.groundTween) { try { s.groundTween.pause(); } catch (e) {} }
      if (s.sweepTween) { try { s.sweepTween.pause(); } catch (e) {} }
      if (typeof anime !== "undefined" && anime && typeof anime.remove === "function") {
        try { anime.remove(s); } catch (e) {}
      }
      s.pulseTween = null;
      s.groundTween = null;
      s.sweepTween = null;
      s.pulse = RING_PULSE_LO;
      s.ground = GROUND_PULSE_LO;
      s.ringPhase = 0;
      var t3 = anime({
        targets: s,
        alpha: 0,
        duration: SCAN_FADE_OUT_DUR,
        easing: "easeInQuad",
        update: function () { if (zone.scan) scanProgress(); },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          var s2 = zone.scan;
          // exit from the rover's REAL last scan position (where the line ended),
          // not the chunk-center drop-in spot — otherwise it teleports to center
          // and vanishes. sweep is frozen (tween paused) so it stays put here.
          var col = area.cMin + s2.sweep * (area.cMax - area.cMin);
          var exitRovers = [{ x: tileScreen(col, area.row).x, y: groundTopY(col, area.row), alpha: 1 }];
          zone.scan = null;
          api._startExit(zone, area, exitRovers);
        },
      });
      s.tween = t3;
    }
  };

  api._startExit = function (zone, area, startRovers) {
    var positions;
    if (startRovers && startRovers.length) {
      positions = startRovers;
    } else if (zone.scan && zone.scan.rovers) {
      positions = zone.scan.rovers;
    } else {
      var ct = centerTile(area);
      var cp = tileScreen(ct.col, ct.row);
      positions = [{ x: cp.x, y: groundTopY(ct.col, ct.row) }];
    }
    api._stopExit(zone);

    var exitCam = window.IsoGrid ? window.IsoGrid.camera : null;
    var exitIso = window.IsoGrid ? window.IsoGrid.isoSize : 1;
    zone.camStart = (zone.scan && zone.scan.camStart) ||
      (exitCam ? { x: exitCam.x, y: exitCam.y, iso: exitIso } : null);

    zone.scan = null;
    zone.status = "exiting";

    // SCAN-ONCE (subsurface tier): mark every tile in the chunk subsurface-scanned.
    if (window.GameState && window.GameState.markAreaSubsurfaceScanned) {
      window.GameState.markAreaSubsurfaceScanned(area.tiles);
    }

    if (typeof anime === "undefined" || !anime) { api._zoneDone(zone); return; }

    var rovers = positions.map(function (p) {
      return { x: p.x, y: p.y, alpha: 1 };
    });
    var tween = anime({
      targets: rovers,
      y: rovers.map(function (d) { return d.y + EXIT_RISE; }),
      alpha: 0,
      duration: EXIT_DUR,
      easing: "easeInQuad",
      update: function () {
        zone.exit = { rovers: rovers, tween: tween };
      },
      complete: function (anim) {
        if (anim.completed === false) return;
        zone.exit = null;
        api._zoneDone(zone);
      },
    });
    zone.exit = { rovers: rovers, tween: tween };
  };

  api._startDrop = function (zone, area, onComplete) {
    var iso = window.IsoGrid ? window.IsoGrid.isoSize : 32;
    var startOffset = iso * 1.6;
    var ct = centerTile(area);
    // rover drives in from the south-east edge of the chunk
    var rovers = [{ x: tileScreen(ct.col, ct.row).x + startOffset, y: groundTopY(ct.col, ct.row) + startOffset, alpha: 0 }];
    var tween;
    if (typeof anime !== "undefined" && anime) {
      tween = anime({
        targets: rovers,
        x: tileScreen(ct.col, ct.row).x,
        y: groundTopY(ct.col, ct.row),
        alpha: 1,
        duration: DROP_DUR,
        easing: "easeOutCubic",
        update: function () {
          zone.drop = { rovers: rovers, tween: tween };
        },
      });
      zone.drop = { rovers: rovers, tween: tween };
      tween.finished.then(function () {
        zone.drop = null;
        zone.status = "scanning";
        if (typeof onComplete === "function") onComplete();
      });
    } else {
      zone.drop = null;
      zone.status = "scanning";
      if (typeof onComplete === "function") onComplete();
    }
  };

  // -- rendering ----------------------------------------------------------

  // isometric box helper: draws a 3D block (top + two front faces) centered at
  // screen (cx, baseY) with half-width hw, half-depth hd and height H.
  function isoBox(ctx, cx, baseY, hw, hd, H, colTop, colL, colR) {
    var bk = { x: cx, y: baseY - hd }, rt = { x: cx + hw, y: baseY },
        fr = { x: cx, y: baseY + hd }, lf = { x: cx - hw, y: baseY };
    var bkT = { x: cx, y: baseY - hd - H }, rtT = { x: cx + hw, y: baseY - H },
        frT = { x: cx, y: baseY + hd - H }, lfT = { x: cx - hw, y: baseY - H };
    ctx.fillStyle = colL;
    ctx.beginPath();
    ctx.moveTo(lf.x, lf.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(frT.x, frT.y); ctx.lineTo(lfT.x, lfT.y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = colR;
    ctx.beginPath();
    ctx.moveTo(fr.x, fr.y); ctx.lineTo(rt.x, rt.y); ctx.lineTo(rtT.x, rtT.y); ctx.lineTo(frT.x, frT.y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = colTop;
    ctx.beginPath();
    ctx.moveTo(bkT.x, bkT.y); ctx.lineTo(rtT.x, rtT.y); ctx.lineTo(frT.x, frT.y); ctx.lineTo(lfT.x, lfT.y);
    ctx.closePath(); ctx.fill();
    return { bk: bk, rt: rt, fr: fr, lf: lf, bkT: bkT, rtT: rtT, frT: frT, lfT: lfT };
  }

  // a wheel / idler roller drawn as a small iso disc
  function drawWheel(ctx, x, baseY, u) {
    var ww = u * 0.15, wh = u * 0.2;
    ctx.fillStyle = "#1F1810";
    ctx.beginPath(); ctx.ellipse(x, baseY, ww, wh, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3A2C20";
    ctx.beginPath(); ctx.ellipse(x, baseY, ww * 0.48, wh * 0.48, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawRoverAt(ctx, cx, topY, alpha) {
    var iso = window.IsoGrid ? window.IsoGrid.isoSize : 32;
    var u = iso * 1.18;
    var hw = u * 0.40, hd = u * 0.27, H = u * 0.24;
    var baseY = topY + u * 0.10;

    ctx.save();
    if (alpha != null && alpha !== 1) ctx.globalAlpha = alpha;

    // ground shadow
    ctx.fillStyle = ROVER_SHADOW;
    ctx.beginPath();
    ctx.ellipse(cx, baseY + hd * 0.55, u * 0.46, u * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // tracks / wheels on each side
    drawWheel(ctx, cx - hw * 0.95, baseY + u * 0.02, u);
    drawWheel(ctx, cx + hw * 0.95, baseY + u * 0.02, u);

    // chassis (iso box)
    var c = isoBox(ctx, cx, baseY, hw, hd, H, ROVER_BODY, "#3A2C20", "#4A3829");
    ctx.strokeStyle = "rgba(255,200,120,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.bkT.x, c.bkT.y); ctx.lineTo(c.rtT.x, c.rtT.y);
    ctx.lineTo(c.frT.x, c.frT.y); ctx.lineTo(c.lfT.x, c.lfT.y); ctx.closePath();
    ctx.stroke();

    // GPR antenna panel on top of the chassis
    var ay = baseY - H;
    var ah = u * 0.12, aw = hw * 0.72, ad = hd * 0.6;
    var a = isoBox(ctx, cx, ay, aw, ad, ah, "#26201A", "#1A150F", "#221B14");
    ctx.strokeStyle = ROVER_ACCENT;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = ROVER_ACCENT;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(a.bkT.x, a.bkT.y); ctx.lineTo(a.rtT.x, a.rtT.y);
    ctx.lineTo(a.frT.x, a.frT.y); ctx.lineTo(a.lfT.x, a.lfT.y); ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // antenna scan lines across the top face
    ctx.strokeStyle = "rgba(255,176,46,0.7)";
    ctx.lineWidth = 1;
    for (var k = 1; k <= 2; k++) {
      var f = k / 3;
      var p1x = a.lfT.x + (a.bkT.x - a.lfT.x) * f, p1y = a.lfT.y + (a.bkT.y - a.lfT.y) * f;
      var p2x = a.frT.x + (a.rtT.x - a.frT.x) * f, p2y = a.frT.y + (a.rtT.y - a.frT.y) * f;
      ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
    }

    // push handle / pole at the back (north corner)
    ctx.strokeStyle = "#6E5638";
    ctx.lineWidth = Math.max(1.5, u * 0.04);
    ctx.beginPath();
    ctx.moveTo(c.bkT.x, c.bkT.y);
    ctx.lineTo(c.bkT.x, c.bkT.y - u * 0.30);
    ctx.stroke();
    ctx.fillStyle = "#6E5638";
    ctx.beginPath();
    ctx.ellipse(c.bkT.x, c.bkT.y - u * 0.30, u * 0.06, u * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();

    // status LED on the front face (amber glow)
    var ledx = c.fr.x, ledy = c.fr.y - H * 0.5;
    ctx.fillStyle = ROVER_ACCENT;
    ctx.shadowColor = ROVER_ACCENT;
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(ledx, ledy, u * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  function drawRover(ctx, c, r, alpha) {
    var p = tileScreen(c, r);
    drawRoverAt(ctx, p.x, groundTopY(c, r), alpha);
  }

  function areaCorners(area) {
    var g = window.IsoGrid;
    var iso = g.isoSize;
    var half = iso / 2;
    var cTL = g.worldToScreen(area.cMin, area.rMin);
    var cTR = g.worldToScreen(area.cMax, area.rMin);
    var cBR = g.worldToScreen(area.cMax, area.rMax);
    var cBL = g.worldToScreen(area.cMin, area.rMax);
    return {
      TL: { x: cTL.x, y: groundTopY(area.cMin, area.rMin) - half },
      TR: { x: cTR.x + iso, y: groundTopY(area.cMax, area.rMin) },
      BR: { x: cBR.x, y: groundTopY(area.cMax, area.rMax) + half },
      BL: { x: cBL.x - iso, y: groundTopY(area.cMin, area.rMax) },
    };
  }

  function drawAreaOutline(ctx, area, dashLen, color, alpha, glow, lw) {
    if (!area || !window.IsoGrid) return;
    var c = areaCorners(area);
    ctx.save();
    if (alpha != null && alpha !== 1) ctx.globalAlpha = alpha;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || Math.min(3, Math.max(2, window.IsoGrid.isoSize * 0.05));
    ctx.setLineDash(dashLen || []);
    ctx.beginPath();
    ctx.moveTo(c.TL.x, c.TL.y);
    ctx.lineTo(c.TR.x, c.TR.y);
    ctx.lineTo(c.BR.x, c.BR.y);
    ctx.lineTo(c.BL.x, c.BL.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ground radar glow: a soft amber wash confined to the chunk footprint,
  // pulsing with `ground`. Centered on the footprint centroid (never the rover),
  // so it never spills outside the surveyed land.
  function drawGroundGlow(ctx, area, corners, alpha, ground) {
    if (!area || !corners || alpha <= 0.01) return;
    var a = alpha * (0.18 + 0.22 * ground);
    var cx = (corners.TL.x + corners.TR.x + corners.BR.x + corners.BL.x) / 4;
    var cy = (corners.TL.y + corners.TR.y + corners.BR.y + corners.BL.y) / 4;
    var xs = [corners.TL.x, corners.TR.x, corners.BL.x, corners.BR.x];
    var ys = [corners.TL.y, corners.TR.y, corners.BL.y, corners.BR.y];
    var maxX = Math.max.apply(null, xs), minX = Math.min.apply(null, xs);
    var maxY = Math.max.apply(null, ys), minY = Math.min.apply(null, ys);
    var rr = Math.max(maxX - minX, maxY - minY) * 0.6;
    var grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rr);
    grad.addColorStop(0, "rgba(255, 200, 110, " + (0.5 * a) + ")");
    grad.addColorStop(0.5, "rgba(255, 176, 46, " + (0.28 * a) + ")");
    grad.addColorStop(1, "rgba(120, 60, 10, " + (0.02 * a) + ")");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // GPR ground read: every tile in the chunk footprint draws as an isometric
  // diamond. A tile stays "read" once the scan-line has ever reached it
  // (coverage = litSweep, which only grows), so the survey doesn't un-record
  // data when the line reverses. Brightness follows the CURRENT line position
  // (sweep), so a glow travels with the sensor both down and back up. Tiles not
  // yet reached show only a faint outline. Everything is drawn at real tile
  // positions, so the effect is strictly confined to the land.
  function drawGprTileRead(ctx, area, anchor, alpha, litSweep, sweep) {
    if (!area || !area.tiles || !area.tiles.length || alpha <= 0.01) return;
    var g = window.IsoGrid;
    if (!g) return;
    var iso = g.isoSize, half = iso / 2;
    var cspan = (area.cMax - area.cMin) || 1;
    ctx.save();
    for (var i = 0; i < area.tiles.length; i++) {
      var t = area.tiles[i];
      var colFrac = (t.col - area.cMin) / cspan;
      var p = projectFrom(anchor, { x: tileScreen(t.col, t.row).x, y: groundTopY(t.col, t.row) });
      var cx = p.x, cy = p.y;
      if (colFrac <= litSweep + 0.015) {
        // distance from the current scan-line -> glow follows the sensor
        var dist = Math.abs(sweep - colFrac);
        var a2 = alpha * (0.2 + 0.62 * Math.max(0, 1 - dist * 1.6));
        ctx.globalAlpha = a2;
        ctx.fillStyle = RING_COLOR;
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + iso, cy);
        ctx.lineTo(cx, cy + half);
        ctx.lineTo(cx - iso, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.globalAlpha = alpha * 0.08;
        ctx.strokeStyle = RING_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + iso, cy);
        ctx.lineTo(cx, cy + half);
        ctx.lineTo(cx - iso, cy);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // GPR scan-line: a single bright amber line (running north<->south across the
  // footprint) that sweeps west->east across the surface, clipped to the exact
  // chunk quad so it never crosses the land boundary.
  function drawGprScanline(ctx, corners, alpha, sweep) {
    if (!corners || alpha <= 0.01) return;
    var g = window.IsoGrid;
    var iso = g ? g.isoSize : 48;
    var topPt = {
      x: corners.TL.x + (corners.TR.x - corners.TL.x) * sweep,
      y: corners.TL.y + (corners.TR.y - corners.TL.y) * sweep
    };
    var botPt = {
      x: corners.BL.x + (corners.BR.x - corners.BL.x) * sweep,
      y: corners.BL.y + (corners.BR.y - corners.BL.y) * sweep
    };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 226, 160, " + (0.95 * alpha) + ")";
    ctx.lineWidth = Math.max(2.5, iso * 0.05);
    ctx.shadowColor = RING_COLOR;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(topPt.x, topPt.y);
    ctx.lineTo(botPt.x, botPt.y);
    ctx.stroke();
    // small bright leading node on the scan-line
    var mid = { x: (topPt.x + botPt.x) / 2, y: (topPt.y + botPt.y) / 2 };
    ctx.fillStyle = "rgba(255, 240, 200, " + (0.9 * alpha) + ")";
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, Math.max(2, iso * 0.04), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Depth ticks: short amber strokes dropping below the scan-line to suggest the
  // radar wave penetrating into the ground (the "subsurface" part of GPR) rather
  // than radiating outward. They hang straight down from the line, so they stay
  // within the survey strip.
  function drawGprDepthTicks(ctx, corners, alpha, sweep) {
    if (!corners || alpha <= 0.01) return;
    var g = window.IsoGrid;
    var iso = g ? g.isoSize : 48;
    var topPt = {
      x: corners.TL.x + (corners.TR.x - corners.TL.x) * sweep,
      y: corners.TL.y + (corners.TR.y - corners.TL.y) * sweep
    };
    var botPt = {
      x: corners.BL.x + (corners.BR.x - corners.BL.x) * sweep,
      y: corners.BL.y + (corners.BR.y - corners.BL.y) * sweep
    };
    ctx.save();
    ctx.strokeStyle = "rgba(255, 196, 96, " + (0.5 * alpha) + ")";
    ctx.lineWidth = 2;
    ctx.shadowColor = RING_COLOR;
    ctx.shadowBlur = 6;
    var N = 5;
    for (var k = 0; k <= N; k++) {
      var f = k / N;
      var px = topPt.x + (botPt.x - topPt.x) * f;
      var py = topPt.y + (botPt.y - topPt.y) * f;
      var len = (10 + 12 * Math.sin(f * Math.PI)) * (iso / 48);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  api.renderMain = function (ctx, grid) {
    for (var i = 0; i < api.zones.length; i++) {
      renderZone(ctx, grid, api.zones[i]);
    }
  };

  function projectFrom(anchor, p) {
    var g = window.IsoGrid;
    if (anchor.iso === g.isoSize && anchor.x === g.camera.x && anchor.y === g.camera.y) {
      return p;
    }
    var u = p.x - anchor.x;
    var v = p.y - anchor.y;
    var col = (u + 2 * v) / (2 * anchor.iso);
    var row = (2 * v - u) / (2 * anchor.iso);
    return g.worldToScreen(col, row);
  }

  function projectCorners(anchor, corners) {
    return {
      TL: projectFrom(anchor, corners.TL),
      TR: projectFrom(anchor, corners.TR),
      BR: projectFrom(anchor, corners.BR),
      BL: projectFrom(anchor, corners.BL),
    };
  }

  function renderZone(ctx, grid, zone) {
    var area = zone.area;
    var anchor = (zone.scan && zone.scan.camStart) || zone.camStart;

    if (zone.drop && zone.drop.rovers && zone.drop.rovers.length) {
      var dd = zone.drop;
      for (var di = 0; di < dd.rovers.length; di++) {
        var dp = projectFrom(anchor, dd.rovers[di]);
        drawRoverAt(ctx, dp.x, dp.y, dd.rovers[di].alpha);
      }
      if (area) drawAreaOutline(ctx, area, [], OUTLINE_COLOR, 1, 0, 2.5);
      return;
    }

    if (zone.scan) {
      var s = zone.scan;
      s.maxSweep = Math.max(s.maxSweep || 0, s.sweep);
      if (area) {
        var c = projectCorners(anchor, s.corners);
        // footprint-confined ground scan (no expanding rings off the land)
        drawGroundGlow(ctx, area, c, s.alpha, s.ground);
        drawGprTileRead(ctx, area, anchor, s.alpha, s.maxSweep, s.sweep);
        drawGprScanline(ctx, c, s.alpha, s.sweep);
        drawGprDepthTicks(ctx, c, s.alpha, s.sweep);
        drawAreaOutline(ctx, area, [], OUTLINE_COLOR, 1, 6, 2.5);
      }
      // the rover drives the scan-line, moving west->east along a fixed row
      var roverScreen = area
        ? projectFrom(anchor, {
            x: tileScreen(area.cMin + s.sweep * (area.cMax - area.cMin), area.row).x,
            y: groundTopY(area.cMin + s.sweep * (area.cMax - area.cMin), area.row)
          })
        : (s.rovers && s.rovers.length ? projectFrom(anchor, s.rovers[0]) : null);
      if (roverScreen) drawRoverAt(ctx, roverScreen.x, roverScreen.y, 1);
      return;
    }

    if (zone.exit && zone.exit.rovers && zone.exit.rovers.length) {
      var eAlpha = zone.exit.rovers.length ? zone.exit.rovers[0].alpha : 1;
      if (area) drawAreaOutline(ctx, area, [], OUTLINE_COLOR, eAlpha, 8, 2.5);
      for (var ei = 0; ei < zone.exit.rovers.length; ei++) {
        var ed = projectFrom(anchor, zone.exit.rovers[ei]);
        drawRoverAt(ctx, ed.x, ed.y, zone.exit.rovers[ei].alpha);
      }
      return;
    }
  }

  return api;
})();
