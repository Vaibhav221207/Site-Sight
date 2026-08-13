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
  var SCAN_HOLD_DUR = 2800;    // hold at full visibility (looping radar pulse)
  var SCAN_FADE_OUT_DUR = 450; // radar rings + ground pulse fade out
  var EXIT_DUR = 550;          // rover drives away + fades
  var EXIT_RISE = 60;          // px the departing rover slides (it drives off)
  var HOVER_RISE = 0;          // ground-based: rover sits ON the surface
  var RING_PULSE_LO = 0.2;     // ring-opacity pulse floor during the hold
  var RING_PULSE_HI = 0.85;    // ring-opacity pulse ceiling during the hold
  var RING_PULSE_DUR = 675;    // ring pulse half-cycle (ms, alternate)
  var GROUND_PULSE_LO = 0.18;  // ground glow pulse floor
  var GROUND_PULSE_HI = 0.5;   // ground glow pulse ceiling
  var GROUND_LOOP_DUR = 675;   // ground glow drift loop (ms, alternate)

  var AREA_W = 5;
  var AREA_H = 10;
  var MAX_ZONES = 2;
  var CHUNK_COLS = 4;
  var CHUNK_ROWS = 2;

  // GPR palette — violet/magenta so it reads as "subsurface / penetrating",
  // clearly distinct from the Drone System's cyan aerial cone.
  var RING_COLOR = "#B14CFF";        // radar ring outline
  var GROUND_FILL = "#7A1FB8";       // ground radar glow
  var ROVER_BODY = "#5A3A78";        // rover chassis
  var ROVER_ACCENT = "#B14CFF";      // rover nav light
  var ROVER_SHADOW = "rgba(0,0,0,0.22)";
  var OUTLINE_COLOR = "#C77DFF";     // committed GPR survey area outline

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
      s.sweep = 0;
      var t3 = anime({
        targets: s,
        alpha: 0,
        duration: SCAN_FADE_OUT_DUR,
        easing: "easeInQuad",
        update: function () { if (zone.scan) scanProgress(); },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          var s2 = zone.scan;
          var exitRovers = s2.rovers.map(function (d) { return { x: d.x, y: d.y, alpha: d.alpha }; });
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

  function drawRoverAt(ctx, cx, topY, alpha) {
    var iso = window.IsoGrid ? window.IsoGrid.isoSize : 32;
    var u = iso * 1.1;
    var half = u / 2;
    var ySquash = 0.82;

    ctx.save();
    if (alpha !== 1 && alpha !== undefined && alpha != null) ctx.globalAlpha = alpha;

    // soft ground shadow
    ctx.fillStyle = ROVER_SHADOW;
    ctx.beginPath();
    ctx.ellipse(cx, topY + half * 0.7, u * 0.42, u * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    // chassis (rounded rect, isometric squash)
    var bw = u * 0.7, bh = u * 0.34;
    ctx.fillStyle = ROVER_BODY;
    ctx.strokeStyle = "#3A2450";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, topY, bw / 2, bh / 2 * ySquash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // mast + radar dish (accent)
    ctx.strokeStyle = ROVER_ACCENT;
    ctx.lineWidth = Math.max(1.5, u * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx, topY - bh / 2 * ySquash);
    ctx.lineTo(cx, topY - bh / 2 * ySquash - u * 0.22);
    ctx.stroke();
    ctx.fillStyle = ROVER_ACCENT;
    ctx.shadowColor = ROVER_ACCENT;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx, topY - bh / 2 * ySquash - u * 0.22, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
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

  // ground radar glow: fills the chunk footprint with a violet radial gradient
  // from the rover position outward, pulsing with `ground`.
  function drawGroundGlow(ctx, area, corners, rover, alpha, ground) {
    if (!area || !corners || !rover || alpha <= 0.01) return;
    var a = alpha * (0.4 + 0.6 * ground);
    var grad = ctx.createRadialGradient(rover.x, rover.y, 1, rover.x, rover.y, (corners.BR.x - corners.TL.x) * 0.75);
    grad.addColorStop(0, "rgba(193, 124, 255, " + (0.45 * a) + ")");
    grad.addColorStop(0.5, "rgba(150, 60, 200, " + (0.28 * a) + ")");
    grad.addColorStop(1, "rgba(90, 30, 150, " + (0.04 * a) + ")");
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

  // expanding radar rings centered on the rover, on the ground plane (isometric
  // ellipses). `ringPhase` 0..1 drives the leading ring; a trailing set of rings
  // lags behind for a continuous pulse. Brighter + more rings than the prototype
  // so the GPR sweep clearly reads as "scanning the earth".
  function drawRadarRings(ctx, corners, rover, alpha, pulse, ringPhase) {
    if (!corners || !rover || alpha <= 0.01) return;
    var a = alpha * (pulse != null ? pulse : 1);
    if (a <= 0.01) return;
    var maxR = (corners.BR.x - corners.TL.x) * 0.95;
    var ySquash = 0.5;
    var RING_COUNT = 5;
    ctx.save();
    ctx.strokeStyle = RING_COLOR;
    ctx.shadowColor = RING_COLOR;
    ctx.shadowBlur = 12;
    for (var k = 0; k < RING_COUNT; k++) {
      var ph = (ringPhase + k / RING_COUNT) % 1;
      var r = ph * maxR;
      var ringAlpha = a * (1 - ph) * 1.0;
      ctx.globalAlpha = ringAlpha;
      ctx.lineWidth = Math.max(1.5, (1 - ph) * 4);
      ctx.beginPath();
      ctx.ellipse(rover.x, rover.y, r, r * ySquash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // bright pulsing center marker on the rover
    ctx.globalAlpha = a;
    ctx.fillStyle = RING_COLOR;
    ctx.shadowColor = RING_COLOR;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(rover.x, rover.y, 3 + 2 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // moving ground scan-line that sweeps across the chunk footprint during the
  // hold (driven by `sweepPhase` 0..1), clipped to the exact quad so it stays
  // inside the surveyed area — mirrors the Drone's aerial sweep line but on the
  // ground plane (violet, not warm white).
  function drawGroundSweep(ctx, corners, alpha, sweepPhase) {
    if (!corners || alpha <= 0.01) return;
    var xs = [corners.TL.x, corners.TR.x, corners.BL.x, corners.BR.x];
    var ys = [corners.TL.y, corners.TR.y, corners.BL.y, corners.BR.y];
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var sy = y0 + (y1 - y0) * sweepPhase;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = "rgba(220, 170, 255, " + (0.9 * alpha) + ")";
    ctx.lineWidth = Math.max(2, Math.min(4, (x1 - x0) * 0.006));
    ctx.shadowColor = RING_COLOR;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x0 - 4, sy);
    ctx.lineTo(x1 + 4, sy);
    ctx.stroke();
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
      if (area) {
        var c = projectCorners(anchor, s.corners);
        var rover = s.rovers && s.rovers.length ? projectFrom(anchor, s.rovers[0]) : null;
        drawGroundGlow(ctx, area, c, rover, s.alpha, s.ground);
        drawRadarRings(ctx, c, rover, s.alpha, s.pulse, s.ringPhase);
        drawGroundSweep(ctx, c, s.alpha, s.sweep);
        drawAreaOutline(ctx, area, [], OUTLINE_COLOR, 1, 6, 2.5);
      }
      for (var si = 0; si < s.rovers.length; si++) {
        var sd = projectFrom(anchor, s.rovers[si]);
        drawRoverAt(ctx, sd.x, sd.y, 1);
      }
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
