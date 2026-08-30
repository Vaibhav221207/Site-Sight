/* js/droneDeploy.js -- Drone System deployment: whole-map, no-click sweep.
 *
 * Clicking "Deploy" on a selected Drone System in the INVENTORY tab starts a
 * SINGLE deployment that covers the ENTIRE 20x20 grid automatically — there is
 * no placement mode, no cursor preview and no click targeting.
 *
 * The map is split into 8 fixed chunks of 5 cols x 10 rows (4 across x 2 down),
 * processed in a fixed order left-to-right, top-to-bottom (chunk index 0..7):
 *   cols [0-4]  [5-9] [10-14] [15-19]   (rows 0-9)
 *   cols [0-4]  [5-9] [10-14] [15-19]   (rows 10-19)
 *
 * The ordered chunk list runs through 2 CONCURRENT "zone slots": at most two
 * chunks scan at once, each as an independent effect instance. Chunk pairs
 * OVERLAP — a zone frees its slot the moment its HOLD phase ends (as its exit
 * begins), so the next chunk's drop-in starts BEFORE the outgoing pair's exit
 * fly-away fully completes. The outgoing drones are flying up/fading while the
 * incoming pair is already dropping in elsewhere on the map — a brief natural
 * overlap that reads as continuous, ongoing work instead of a stop-start hard
 * cut. The handoff is seamless in light too: each zone's cone fade-in runs
 * WHILE its drone climbs to hover (see _startScan), so the incoming pair's
 * cone appears just as the outgoing pair's cone finishes fading — never a dead
 * gap where nothing on the map is scanning. The overlap is bounded: at most
 * the outgoing pair + the incoming pair render at any instant (a scan/hold
 * zone count is always <= 2), so it never accumulates a pile of drones. Fully
 * scanned chunks (every tile already scanned:true) are skipped without
 * animating. A chunk that is only partially scanned still runs and marks ALL
 * of its tiles scanned.
 *
 * Per-chunk sequence: ONE drone drops into the CENTER of the chunk, makes one
 * eased hop up to its hover point (its cone + heatmap fade in DURING the
 * climb, so the light is on by the time it settles), holds with looping
 * pulse/sweep/bob, fades out, then flies upward and fades out. The cone's apex
 * is read from the drone's LIVE screen position every frame, so the beam
 * always connects directly to the body (never a fixed precomputed point).
 * Nothing remains on screen once the whole deployment completes — the last
 * scan's outline departs with its drone.
 *
 * CONSUMABLE: confirming a deployment immediately decrements
 * GameState.inventory.droneCount (the deployed Drone System leaves the fleet),
 * clears the INVENTORY selection, and refreshes the STORE owned-count readout.
 *
 * SCAN-ONCE: as each chunk's scan completes, every tile in that chunk is marked
 * permanently scanned (GameState.markAreaScanned); a later deployment skips
 * chunks whose tiles are all already scanned, so a tile is never scanned twice.
 *
 * Locked timing / geometry constants are shared with the previous single-area
 * implementation — each concurrent zone instance drives the exact same
  * per-chunk effect (drone / heatmap / cone / sweep / exit), just with its own
 * independent state.
 */

window.DroneDeploy = (function () {
  "use strict";

  // -- timing / geometry --------------------------------------------------
  var DROP_DUR = 420;        // brief drop-in before the scan begins
  var SCAN_MOVE_DUR = 600;   // single eased hop up to the area hover points
  var SCAN_FADE_IN_DUR = 450;   // cone + heatmap fade in together
  var SCAN_HOLD_DUR = 2800;     // hold at full visibility (looping cone pulse + heatmap drift)
  var SCAN_FADE_OUT_DUR = 450;  // cone + heatmap fade out together
  var EXIT_DUR = 550;        // drone fly-away after the scan (up + fade-out)
  var EXIT_RISE = 300;       // px the departing drone rises before it is gone
  var FLY_LIFT = 14;         // px the drone hovers above the tile top during drop/settle
  var HOVER_RISE = 5.2;      // x isoSize: survey hover height above the formation ground tops
  var CONE_PULSE_LO = 0.25;  // cone-opacity pulse floor during the hold (clearly dim)
  var CONE_PULSE_HI = 0.85;  // cone-opacity pulse ceiling during the hold (clearly bright)
  var CONE_PULSE_DUR = 675;  // cone opacity pulse half-cycle (ms, alternate) — active scanning rhythm
  var HEAT_PULSE_LO = 0.3;   // heatmap overlay-opacity pulse floor during the hold
  var HEAT_PULSE_HI = 0.6;   // heatmap overlay-opacity pulse ceiling during the hold (bright ground glow)
  var HEAT_LOOP_DUR = 675;   // heatmap gradient-drift + scale-pulse loop length (ms, alternate), synced to the cone
  var BOB_AMP = 3;           // px of the idle-bob the drone adds during the hold

  // per-chunk footprint: 5 cols x 10 rows = 50 tiles. 8 such chunks tile the
  // 20x20 grid exactly (4 across x 2 down).
  var AREA_W = 5;
  var AREA_H = 10;

  var MAX_ZONES = 2;         // concurrent scan-zone slots (cap of 2 for perf)
  var CHUNK_COLS = 4;        // chunks across the grid
  var CHUNK_ROWS = 2;        // chunks down the grid

  // BRIGHT-theme palette (chosen to read clearly against the sky gradient /
  // green land / blue river, NOT the old dark theme):
  //   - committed scan outline -> solid opaque cyan
  var OUTLINE_COLOR = "#00E5FF";        // committed scan area outline

  // drone silhouette: dark quad-copter body + arms + rotors + cyan nav light
  var BODY_FILL = "#4A4A45";
  var BODY_STROKE = "#2E2E2B";
  var ARM_COLOR = "#3A3A36";
  var ROTOR_FILL = "#8A8A82";
  var NAV_LIGHT = "#00E5FF"; // matches OUTLINE_COLOR for visual consistency
  var DRONE_SHADOW = "rgba(0,0,0,0.22)";

  // base block height used by blockRender for the ground surface; kept here so
  // the marker sits flush on the tile top without coupling to blockRender's
  // private constant.
  var BASE_H = 4;

  var api = {
    deploying: false, // a whole-map deployment is currently in progress
    chunks: [],       // remaining ordered chunk queue (area descriptors), or []
    zones: [],        // in-flight zone instances (0..2) with independent state
    deployed: null,   // { wholeMap: true } once a full deployment completes, or null
    onDeployDone: null, // optional callback fired when the whole deployment completes
    onZoneStart: null,  // optional test hook: (chunkIndex, zonesRunning) when a zone launches
  };

  // -- HQ exclusion (scan grids must never cover HQ) ---------------------

  function isHqTile(col, row) {
    if (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) return true;
    var hq = window.GameState && window.GameState.hqTile;
    if (hq && hq.col === col && hq.row === row) return true;
    return false;
  }

  function hqInArea(area) {
    if (!area) return null;
    var hq = window.GameState && window.GameState.hqTile;
    if (hq && hq.col >= area.cMin && hq.col <= area.cMax && hq.row >= area.rMin && hq.row <= area.rMax) return hq;
    // future-proof: scan terrain for any HQ inside the area
    if (window.Terrain && window.Terrain.isHQ) {
      for (var r = area.rMin; r <= area.rMax; r++) for (var c = area.cMin; c <= area.cMax; c++) if (window.Terrain.isHQ(c, r)) return { col: c, row: r };
    }
    return null;
  }

  // -- grid helpers -------------------------------------------------------

  function flatTopY(c, r) {
    var g = window.IsoGrid;
    var p = g.worldToScreen(c, r);
    return p.y - BASE_H; // flat plane for scan quads so grid lines align on all viewports
  }

  function groundTopY(c, r) {
    var g = window.IsoGrid;
    var p = g.worldToScreen(c, r);
    // Terrain.elevationAt indexes map[row][col] and requires integer tile
    // coordinates; the scan interpolates fractional col/row, so floor for the
    // elevation lookup (worldToScreen is linear and fine with floats).
    var elev = window.Terrain ? window.Terrain.elevationAt(Math.floor(c), Math.floor(r)) : 0;
    return p.y - (BASE_H + elev);
  }

  function setCursor(v) {
    var ih = window.InputHandler;
    if (!ih) return;
    if (typeof ih.setCursor === "function") { ih.setCursor(v); }
    else if (ih.canvas) { ih.canvas.style.cursor = v; }
  }

  // world-space center of a tile, in floats, projected to screen
  function tileScreen(c, r) {
    return window.IsoGrid.worldToScreen(c, r);
  }

  // the single tile the drone occupies: the CENTER of the chunk footprint
  // (same center-of-area positioning used before the swarm change). buildChunk
  // already stores the exact center row and centerCol on the area descriptor.
  function centerTile(area) {
    return { col: area.centerCol, row: area.row };
  }

  // -- chunk layout -------------------------------------------------------

  // build the area descriptor for chunk index i (0..7): columns (i%4)*5..+4,
  // rows (floor(i/4))*10..+9. Every chunk is fully in-bounds on the 20x20 grid
  // by construction. THE single source of truth for that chunk's outline /
  // cone / heatmap geometry (same descriptor shape the single-area version
  // built via buildArea).
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

  // is every tile of this chunk already permanently scanned? (skip rule)
  // HQ tiles are never scanned and are ignored here so a chunk containing HQ
  // can still count as fully scanned once all non-HQ tiles are done.
  function chunkFullyScanned(area) {
    var gs = window.GameState;
    if (!gs || !gs.isTileScanned) return false;
    for (var i = 0; i < area.tiles.length; i++) {
      var t = area.tiles[i];
      if (isHqTile(t.col, t.row)) continue;
      if (!gs.isTileScanned(t.col, t.row)) return false;
    }
    return true;
  }

  // -- deployment scheduler ----------------------------------------------

  // Start a whole-map deployment. CONSUMES one Drone System immediately
  // (droneCount -= 1, selection cleared, STORE owned refresh), builds the
  // ordered 8-chunk queue (skipping chunks that are already fully scanned),
  // and begins running the queue 2 zones at a time. Returns true if a
  // deployment started, false if already deploying or nothing to deploy.
  api.startDeployment = function () {
    if (api.deploying) return false;
    var gs = window.GameState;
    if (!gs) return false;
    if (!gs.inventory || gs.inventory.droneCount <= 0) return false;

    // CONSUMABLE: the deployed Drone System leaves the fleet at the moment the
    // deployment is confirmed. Decrement the count, clear the INVENTORY
    // selection (the deployed unit is gone), and refresh the STORE owned
    // readout live.
    gs.inventory.droneCount -= 1;
    gs.inventory.selectedDroneId = null;
    if (window.HqPanel) {
      if (window.HqPanel.updateOwned) window.HqPanel.updateOwned();
      if (window.HqPanel.renderInventory) window.HqPanel.renderInventory();
    }
    setCursor("grab");

    // build the ordered chunk queue, skipping already-fully-scanned chunks
    var queue = [];
    for (var i = 0; i < CHUNK_COLS * CHUNK_ROWS; i++) {
      var area = buildChunk(i);
      if (chunkFullyScanned(area)) continue; // skip: every tile already scanned
      queue.push(area);
    }

    api.chunks = queue;
    api.zones = [];
    api.deploying = true;
    api.deployed = null;
    if (gs.inventory) gs.inventory.deployed = null;
    if (window.InputHandler && window.InputHandler.setMode) window.InputHandler.setMode('deploying-drone');
    api._fillSlots();
    // _fillSlots may have completed synchronously if queue was empty
    if (!api.deploying && window.InputHandler && window.InputHandler.setMode) window.InputHandler.setMode('idle');
    return true;
  };

  // number of zones still occupying a scan slot — zones that have NOT yet
  // released into their exit (a zone releases the moment its HOLD ends, so its
  // outgoing exit overlaps the next chunk's drop-in without ever letting more
  // than MAX_ZONES scan/hold effects run at once).
  function activeSlotCount() {
    var n = 0;
    for (var i = 0; i < api.zones.length; i++) {
      if (!api.zones[i].releasing) n++;
    }
    return n;
  }

  // fill up to 2 zone slots from the head of the queue. A slot is freed (and
  // the next chunk launched) as soon as a zone's HOLD ends — see the hold
  // timer in _startScan — so consecutive pairs overlap instead of cutting hard.
  // When no zones are running and the queue is empty, the deployment is
  // complete. A reentrancy guard keeps completion from firing more than once
  // when a zone completes synchronously (no-anime path) inside the fill loop.
  api._fillSlots = function () {
    if (api._filling) return; // re-entrant: the outer fill loop handles it
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
        window.GameState.inventory.deployed = { wholeMap: true };
      }
      if (typeof api.onDeployDone === "function") api.onDeployDone();
      if (window.InputHandler && window.InputHandler.setMode) window.InputHandler.setMode('idle');
    }
  };

  // spawn one zone instance for a chunk: drops its drone, then scans, then
  // exits; when the zone fully completes it frees its slot and fills again.
  // `releasing` flips true the moment the zone's HOLD ends — it no longer
  // occupies a scan slot, but it still renders its exit fly-away, which is how
  // the outgoing pair overlaps the incoming pair's drop-in.
  api._launchZone = function (area) {
    var zone = { area: area, status: "dropping", releasing: false, drop: null, scan: null, exit: null };
    api.zones.push(zone);
    if (typeof api.onZoneStart === "function") api.onZoneStart(area.idx, api.zones.length);
    api._startDrop(zone, area, function () {
      api._startScan(zone, area);
    });
  };

  // a zone's exit fly-away fully finished: remove it from rendering entirely.
  // Its scan slot was already freed at HOLD-end (see _startScan), when the next
  // chunk was launched, so _fillSlots only needs to pick up the slack for any
  // remaining queue (and to detect full-deployment completion).
  api._zoneDone = function (zone) {
    zone.status = "done";
    zone.drop = null;
    zone.scan = null;
    zone.exit = null;
    var ix = api.zones.indexOf(zone);
    if (ix !== -1) api.zones.splice(ix, 1);
    api._fillSlots();
  };

  // abort any in-flight deployment: pause every zone tween and reset state.
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

  // compatibility stubs: there is no placement / click-to-target mode anymore.
  api.isValid = function () { return false; };
  api.attempt = function () { return false; };
  api.setHover = function () {};
  api.clearHover = function () {};

  // test introspection: the 8 chunk descriptors in fixed processing order
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
      if (zone.scan.heatTween) { try { zone.scan.heatTween.pause(); } catch (e) {} }
    }
    if (zone) zone.scan = null;
  };
  api._stopExit = function (zone) {
    if (zone && zone.exit && zone.exit.tween) {
      try { zone.exit.tween.pause(); } catch (e) {}
    }
    if (zone) zone.exit = null;
  };

  // -- cone scan (one independent instance per zone) ---------------------
  // UNIFIED CONE SCAN. After the drop-in the single drone makes ONE eased hop
  // (anime, ~SCAN_MOVE_DUR) up to its hover point at the chunk's center tile
  // (fixed height isoSize*HOVER_RISE). The cone of light + ground heatmap (both
  // built from the SAME clamped 4-corner tile projection used by the chunk
  // outline) fade in WHILE the drone climbs (the fade-in overlaps the hop), so
  // a zone's light appears as soon as its drone starts moving into survey
  // position — this is what bridges chunk pairs with no dead gap: the incoming
  // pair's cone fades in as the outgoing pair's cone fades out. Then HOLD for
  // SCAN_HOLD_DUR while looping anime tweens pulse the cone's opacity
  // (CONE_PULSE_LO<->CONE_PULSE_HI, alternate), brighten/dim the heatmap
  // (HEAT_PULSE_LO<->HI), sweep a scan line, drift the heatmap gradient and bob
  // the drone, then fade out together (SCAN_FADE_OUT_DUR). The cone's apex is
  // NOT precomputed here — renderZone reads the drone's LIVE x/y every frame
  // so the beam always connects exactly to the body. On completion the zone's
  // scan state is cleared, the chunk's tiles are marked permanently scanned
  // (scan-once), and the exit fly-away takes over from the hover point.
  // Every phase is a literal anime({...}) tween; the hold's motion is driven
  // by looping anime tweens (direction:'alternate', loop:true), never manual
  // frame-stepping.
  api._startScan = function (zone, area) {
    api._stopScan(zone);
    if (typeof anime === "undefined" || !anime || !window.IsoGrid) { api._startExit(zone, area); return; }

    var g = window.IsoGrid;
    var iso = g.isoSize;

    // ground corners — THE single source for the outline, cone and heatmap
    var corners = areaCorners(area);

    // the drone's hover target: the chunk's center tile, at fixed height above
    // its ground top. The cone apex is NOT stored here — renderZone derives it
    // from the drone's live position every frame (cone-alignment fix).
    var t = centerTile(area);
    var tp = tileScreen(t.col, t.row);
    var hoverX = tp.x;
    var hoverY = groundTopY(t.col, t.row) - iso * HOVER_RISE;

    // start position: the ground point where the drop-in left the drone.
    // The renderer reads this object's x/y live every frame, so the cone apex
    // and the drone body always share the exact same screen coordinates.
    var drones = [{ x: tp.x, y: groundTopY(t.col, t.row) - FLY_LIFT, hx: 0, hy: -1 }];

    var TOTAL = SCAN_MOVE_DUR + SCAN_FADE_IN_DUR + SCAN_HOLD_DUR + SCAN_FADE_OUT_DUR;
    var scan = {
      drones: drones,
      corners: corners,
      // camera + iso frame these cached screen coords were built in — renderZone
      // re-projects them into the current frame per draw (panning AND
      // fullscreen-triggered viewport resizes stay glued to the map)
      camStart: { x: g.camera.x, y: g.camera.y, iso: g.isoSize },
      alpha: 0,       // overall cone+heatmap visibility (fade in/hold/fade out)
      pulse: CONE_PULSE_LO, // cone-opacity pulse multiplier during the hold
      heat: 0,        // heatmap gradient-drift phase during the hold
      heatPulse: HEAT_PULSE_LO, // heatmap overlay-opacity scale during the hold (brighten/dim)
      sweep: 0,       // scan-line sweep phase 0..1 across the heatmap area (per pulse cycle)
      bob: 0,         // shared idle-bob (0..1) applied to every drone during the hold
      fadeInStarted: false, // the cone fade-in kicks off with the hop (once)
      progress: 0,
      t0: Date.now(),
      tween: null,
      pulseTween: null,
      heatTween: null,
    };
    zone.scan = scan;

    function scanProgress() {
      var s = zone.scan;
      if (!s) return;
      s.progress = Math.max(0, Math.min(1, (Date.now() - s.t0) / TOTAL));
    }

    // phase 0 — ONE eased hop up to the drone's hover point (single tween).
    // The tween targets the drone in zone.scan.drones — the shared
    // render-state object — so every frame anime writes the live interpolated
    // x/y straight into the object the renderer draws (and the cone apex is
    // derived from): continuous motion, never an instant jump. The cone's
    // fade-in starts on the hop's first frame (NOT after it completes), so the
    // zone lights up while the drone climbs — the incoming pair's cone
    // crosses over with the outgoing pair's fade-out instead of leaving a
    // dead gap where nothing is scanning.
    var t0 = anime({
      targets: drones,
      x: hoverX,
      y: hoverY,
      duration: SCAN_MOVE_DUR,
      easing: "easeInOutQuad",
      update: function () {
        var s = zone.scan;
        if (!s) return;
        scanProgress();
        if (!s.fadeInStarted) {
          s.fadeInStarted = true;
          fadeIn();
        }
      },
      complete: function (anim) {
        if (anim.completed === false || !zone.scan) return;
        // hop done; the fade-in (and its hold) is already running on its own
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
        update: function () {
          var st = zone.scan;
          if (!st) return;
          scanProgress();
        },
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
      // looping cone-opacity pulse + heatmap scale pulse + scan-line sweep +
      // idle-bob (alternate, active for the whole hold). The tween targets
      // zone.scan DIRECTLY (its `pulse`, `heatPulse`, `sweep` and `bob`
      // properties), so anime writes the live interpolated values straight
      // into the exact state object+properties the render loop reads every
      // frame. The cone swings a wide dim->bright range (CONE_PULSE_LO<->HI)
      // at a fast half-cycle (CONE_PULSE_DUR), the heatmap brightens/dims in
      // the same rhythm (HEAT_PULSE_LO<->HI), the sweep line travels across the
      // heatmap area once per half-cycle, and the drone adds a small vertical
      // bob (0..1 * BOB_AMP).
      s.pulse = CONE_PULSE_LO;
      s.heatPulse = HEAT_PULSE_LO;
      s.sweep = 0;
      s.bob = 0;
      s.pulseTween = anime({
        targets: s,
        pulse: [CONE_PULSE_LO, CONE_PULSE_HI],
        heatPulse: [HEAT_PULSE_LO, HEAT_PULSE_HI],
        sweep: [0, 1],
        bob: [0, 1],
        duration: CONE_PULSE_DUR,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
        update: function () {
          if (!zone.scan) return;
          scanProgress();
        },
      });
      // looping heatmap-gradient drift (alternate, active for the whole hold).
      s.heat = 0;
      s.heatTween = anime({
        targets: s,
        heat: [0, 1],
        duration: HEAT_LOOP_DUR,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
        update: function () {
          if (!zone.scan) return;
          scanProgress();
        },
      });
      // hold timer, then fade out (anime-driven so _stopScan can pause it).
      // The moment the HOLD ends the zone is considered "exiting": it releases
      // its scan slot so the next chunk's drop-in can begin NOW, while this
      // zone's own fade-out + exit fly-away still play out. The outgoing pair
      // therefore overlaps the incoming pair (no hard cut / no dead moment),
      // yet a scan/hold zone count never exceeds MAX_ZONES because the freed
      // slot is filled by exactly one new zone.
      var holdState = { v: 0 };
      var t2 = anime({
        targets: holdState,
        v: 1,
        duration: SCAN_HOLD_DUR,
        easing: "linear",
        update: function () {
          var st = zone.scan;
          if (!st) return;
          scanProgress();
        },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          zone.releasing = true; // exit begins: free this zone's slot now
          api._fillSlots();      // start the next chunk's drop-in immediately
          fadeOut();
        },
      });
      s.tween = t2;
    }

    function fadeOut() {
      var s = zone.scan;
      if (!s) return;
      // explicitly stop AND remove the looping pulse + heat tweens so they can
      // never keep running once the fade-out begins
      if (s.pulseTween) { try { s.pulseTween.pause(); } catch (e) {} }
      if (s.heatTween) { try { s.heatTween.pause(); } catch (e) {} }
      if (typeof anime !== "undefined" && anime && typeof anime.remove === "function") {
        try { anime.remove(s); } catch (e) {}
      }
      s.pulseTween = null;
      s.heatTween = null;
      s.pulse = CONE_PULSE_LO;   // freeze the pulse at the floor; heat keeps last phase
      s.heatPulse = HEAT_PULSE_LO; // freeze the heatmap at its dim floor too
      s.sweep = 0;               // sweep line parked at the top edge
      s.bob = 0;                 // drone stops bobbing as the light fades
      var t3 = anime({
        targets: s,
        alpha: 0,
        duration: SCAN_FADE_OUT_DUR,
        easing: "easeInQuad",
        update: function () {
          var st = zone.scan;
          if (!st) return;
          scanProgress();
        },
        complete: function (anim) {
          if (anim.completed === false || !zone.scan) return;
          // capture the drone's hover position for the exit, then clear the
          // scan. The chunk's tiles are marked scanned in _startExit (scan-once),
          // which runs on both the anime and no-anime completion paths.
          var s2 = zone.scan;
          var exitDrones = s2.drones.map(function (d) { return { x: d.x, y: d.y }; });
          zone.scan = null;
          api._startExit(zone, area, exitDrones);
        },
      });
      s.tween = t3;
    }
  };

  // after the chunk's cone scan fade-out: the drone flies upward and fades out
  // (a single anime tween, EXIT_DUR / easeInQuad), then is fully removed from
  // rendering. The chunk's outline departs with the drone, so nothing remains
  // once the zone completes. The chunk's tiles are marked scanned here
  // (scan-once) as the chunk's scan completes.
  api._startExit = function (zone, area, startDrones) {
    var positions;
    if (startDrones && startDrones.length) {
      positions = startDrones;
    } else if (zone.scan && zone.scan.drones) {
      positions = zone.scan.drones;
    } else {
      var ct = centerTile(area);
      var cp = tileScreen(ct.col, ct.row);
      positions = [{ x: cp.x, y: groundTopY(ct.col, ct.row) - FLY_LIFT }];
    }
    api._stopExit(zone);

    // camera + iso anchor for the fly-away: the frame its cached screen
    // positions were computed in (the scan-start frame when inheriting the
    // scan's drones; the current frame when the fallback positions were
    // built fresh just above), so panning AND viewport rescales keep the
    // departing drone glued to the map
    var exitCam = window.IsoGrid ? window.IsoGrid.camera : null;
    var exitIso = window.IsoGrid ? window.IsoGrid.isoSize : 1;
    zone.camStart = (zone.scan && zone.scan.camStart) ||
      (exitCam ? { x: exitCam.x, y: exitCam.y, iso: exitIso } : null);

    zone.scan = null;
    zone.status = "exiting";

    // SCAN-ONCE: as the chunk's scan completes, mark every tile in the chunk
    // permanently scanned. Runs on both the anime and no-anime completion
    // paths, so a later deployment skips fully-scanned chunks.
    if (window.GameState && window.GameState.markAreaScanned) {
      window.GameState.markAreaScanned(area.tiles);
    }
    // DATA GENERATION: the completed aerial scan also writes per-tile survey
    // data (surface stability) into the tile data model. Runs on both the
    // anime and no-anime completion paths (same as markAreaScanned above).
    if (window.GameState && window.GameState.markAreaDroneData) {
      window.GameState.markAreaDroneData(area.tiles);
    }

    if (typeof anime === "undefined" || !anime) { api._zoneDone(zone); return; }

    // one state object for the departing drone (rise + fade over EXIT_DUR)
    var drones = positions.map(function (p) {
      return { x: p.x, y: p.y, alpha: 1, hx: 0, hy: -1 };
    });
    var tween = anime({
      targets: drones,
      y: drones.map(function (d) { return d.y - EXIT_RISE; }),
      alpha: 0,
      duration: EXIT_DUR,
      easing: "easeInQuad",
      update: function () {
        zone.exit = { drones: drones, tween: tween };
      },
      complete: function (anim) {
        if (anim.completed === false) return;
        zone.exit = null;
        api._zoneDone(zone);
      },
    });
    zone.exit = { drones: drones, tween: tween };
  };

  // -- drop-in (one independent instance per zone) -----------------------

  api._startDrop = function (zone, area, onComplete) {
    var iso = window.IsoGrid ? window.IsoGrid.isoSize : 32;
    var startRise = iso * 2.2; // start above the tiles
    var ct = centerTile(area);
    var drones = [{ col: ct.col, row: ct.row, rise: startRise, alpha: 0 }];
    var tween;
    if (typeof anime !== "undefined" && anime) {
      // entrance: the single drone eases down onto the chunk's center tile
      tween = anime({
        targets: drones,
        rise: 0,
        alpha: 1,
        duration: DROP_DUR,
        easing: "easeOutBack",
        update: function () {
          zone.drop = { drones: drones, tween: tween };
        },
      });
      zone.drop = { drones: drones, tween: tween };
      tween.finished.then(function () {
        zone.drop = null;
        zone.status = "scanning";
        if (typeof onComplete === "function") onComplete();
      });
    } else {
      // no anime: settle immediately and start the scan
      zone.drop = null;
      zone.status = "scanning";
      if (typeof onComplete === "function") onComplete();
    }
  };

  // -- rendering ----------------------------------------------------------

  // draw a single drone marker at screen position (cx, topY) at opacity alpha.
  function drawMarkerAt(ctx, cx, topY, alpha, heading) {
    var iso = window.IsoGrid ? window.IsoGrid.isoSize : 32;
    var u = iso * 1.3;
    var half = u / 2;
    var armD = u * 0.34;   // rotor center distance from the body center
    var rotorR = u * 0.16; // rotor disc radius
    var bodyR = u * 0.21;  // central body hexagon radius
    var cy = topY;
    var ySquash = 0.82;

    ctx.save();
    if (alpha !== 1 && alpha !== undefined && alpha != null) ctx.globalAlpha = alpha;

    // soft ground shadow
    ctx.fillStyle = DRONE_SHADOW;
    ctx.beginPath();
    ctx.arc(cx, cy + half * 0.7, u * 0.13, 0, Math.PI * 2);
    ctx.fill();

    // four arm directions (NW, NE, SW, SE)
    var dirs = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ];

    // rotor discs (under the arms), slightly transparent to suggest spinning
    ctx.fillStyle = ROTOR_FILL;
    ctx.globalAlpha = (alpha != null ? alpha : 1) * 0.55;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cx + dirs[i].x * armD, cy + dirs[i].y * armD * ySquash, rotorR, 0, Math.PI * 2);
      ctx.fill();
    }

    // arms: thin lines from the body corners to each rotor center
    ctx.strokeStyle = ARM_COLOR;
    ctx.lineWidth = Math.max(1.5, u * 0.05);
    ctx.globalAlpha = (alpha != null ? alpha : 1);
    ctx.beginPath();
    for (var a = 0; a < 4; a++) {
      ctx.moveTo(cx + dirs[a].x * bodyR, cy + dirs[a].y * bodyR * ySquash);
      ctx.lineTo(cx + dirs[a].x * armD, cy + dirs[a].y * armD * ySquash);
    }
    ctx.stroke();

    // central body: flat-shaded dark hexagon
    ctx.fillStyle = BODY_FILL;
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var ang = -Math.PI / 2 + k * (Math.PI / 3);
      var bx = cx + Math.cos(ang) * bodyR;
      var by = cy + Math.sin(ang) * bodyR * ySquash;
      if (k === 0) ctx.moveTo(bx, by);
      else ctx.lineTo(bx, by);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = BODY_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // nose indicator light in the direction of travel
    var hx = (heading && heading.x != null) ? heading.x : 0;
    var hy = (heading && heading.y != null) ? heading.y : -1;
    var hlen = Math.sqrt(hx * hx + hy * hy) || 1;
    hx /= hlen; hy /= hlen;
    ctx.fillStyle = NAV_LIGHT;
    ctx.shadowColor = NAV_LIGHT;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx + hx * bodyR * 0.78, cy + hy * bodyR * 0.78 * ySquash, bodyR * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  // draw a full drone marker on a specific tile, at a vertical offset `rise`
  // above the tile top, at opacity `alpha`, with a `heading` nav light.
  function drawMarker(ctx, c, r, rise, alpha, heading) {
    var p = tileScreen(c, r);
    drawMarkerAt(ctx, p.x, groundTopY(c, r) - (rise || 0), alpha, heading);
  }

  // the four SCREEN-space corner vertices of the chunk's footprint, on the top
  // plane of their corner tiles. This is the ONE projection every piece of
  // chunk geometry uses (outline, cone, heatmap) — the outermost diamond vertex
  // of each corner tile:
  //   TL (cMin,rMin) -> north vertex  (0, -iso/2 from its center)
  //   TR (cMax,rMin) -> east vertex   (+iso, 0)
  //   BR (cMax,rMax) -> south vertex  (0, +iso/2)
  //   BL (cMin,rMax) -> west vertex   (-iso, 0)
  function areaCorners(area) {
    var g = window.IsoGrid;
    var iso = g.isoSize;
    var half = iso / 2;
    var cTL = g.worldToScreen(area.cMin, area.rMin);
    var cTR = g.worldToScreen(area.cMax, area.rMin);
    var cBR = g.worldToScreen(area.cMax, area.rMax);
    var cBL = g.worldToScreen(area.cMin, area.rMax);
    return {
      TL: { x: cTL.x, y: flatTopY(area.cMin, area.rMin) - half }, // north
      TR: { x: cTR.x + iso, y: flatTopY(area.cMax, area.rMin) },  // east
      BR: { x: cBR.x, y: flatTopY(area.cMax, area.rMax) + half }, // south
      BL: { x: cBL.x - iso, y: flatTopY(area.cMin, area.rMax) },  // west
    };
  }

  // draw the chunk footprint outline in screen space (see areaCorners).
  // A falsy/empty `dashLen` draws a solid line (committed scan); `glow` adds a
  // shadow blur and `lw` overrides the default stroke width (px).
  function drawAreaOutline(ctx, area, dashLen, color, alpha, glow, lw) {
    if (!area || !window.IsoGrid) return;
    var g = window.IsoGrid;
    var c = areaCorners(area);

    ctx.save();
    if (alpha != null && alpha !== 1) ctx.globalAlpha = alpha;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.strokeStyle = color;
    ctx.lineWidth = lw || Math.min(3, Math.max(2, g.isoSize * 0.05));
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

  // ground HEATMAP overlay: fills the exact same 4-corner quad used for the
  // outline with a heatmap-style gradient (green -> yellow-green -> yellow ->
  // warm orange across the footprint, semi-transparent so the terrain still
  // shows through). `heat` (0..1, driven by the hold loop) drifts the gradient
  // endpoints along the area diagonal so the color bands slowly sweep across
  // the ground. `scale` (0..1) multiplies the overlay's opacity so the whole
  // ground glow brightens and dims in a clear rhythm, in sync with the cone.
  function drawHeatmap(ctx, area, corners, alpha, heat, scale) {
    if (!area || !corners || alpha <= 0.01) return;
    var h = (heat == null) ? 0 : heat;
    var s = (scale == null) ? 1 : scale;
    var ddx = (corners.BR.x - corners.TL.x) * 0.35;
    var ddy = (corners.BR.y - corners.TL.y) * 0.35;
    var ox = ddx * (h - 0.5);
    var oy = ddy * (h - 0.5);
    var a = alpha * s;

    var grad = ctx.createLinearGradient(
      corners.BL.x + ox, corners.BL.y + oy,
      corners.TR.x + ox, corners.TR.y + oy
    );
    grad.addColorStop(0, "rgba(124, 224, 34, " + (0.5 * a) + ")");   // green
    grad.addColorStop(0.35, "rgba(164, 214, 30, " + (0.5 * a) + ")"); // yellow-green
    grad.addColorStop(0.65, "rgba(250, 205, 40, " + (0.5 * a) + ")"); // yellow
    grad.addColorStop(1, "rgba(255, 150, 40, " + (0.55 * a) + ")");   // warm orange

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

  // SCAN SWEEP LINE: a thin bright line that travels once across the heatmap
  // area during each pulse half-cycle (driven by `sweep` 0..1 on the shared
  // scan state). It clips to the exact same 4-corner projected quad used by
  // the outline / cone / heatmap, so the sweep always stays inside the chunk.
  function drawSweep(ctx, corners, alpha, sweep) {
    if (!corners || alpha <= 0.01) return;
    var sw = (sweep == null) ? 0 : sweep;
    var xs = [corners.TL.x, corners.TR.x, corners.BL.x, corners.BR.x];
    var ys = [corners.TL.y, corners.TR.y, corners.BL.y, corners.BR.y];
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var sy = y0 + (y1 - y0) * sw;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = "rgba(255, 245, 200, " + (0.85 * alpha) + ")";
    ctx.lineWidth = Math.max(2, Math.min(3, (x1 - x0) * 0.004));
    ctx.shadowColor = "#FFF6C8";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x0 - 4, sy);
    ctx.lineTo(x1 + 4, sy);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // CONE OF LIGHT: a semi-transparent pyramid silhouette from the formation's
  // unified apex (the chunk-center hover point) down to the chunk's four ground
  // corners (the SAME areaCorners used by the outline and heatmap). Filled
  // with a radial gradient that is bright warm yellow near the apex (top) and
  // fades to a soft transparent green near the ground (bottom). `alpha` is the
  // overall scan visibility; `pulse` (0..1) modulates the cone's opacity for
  // the hold loop.
  function drawCone(ctx, area, corners, apex, alpha, pulse) {
    if (!area || !corners || !apex) return;
    var a = alpha * (pulse != null ? pulse : 1);
    if (a <= 0.01) return;
    var cs = [corners.TL, corners.TR, corners.BR, corners.BL];

    var maxR = 0;
    for (var i = 0; i < 4; i++) {
      var dx = cs[i].x - apex.x, dy = cs[i].y - apex.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxR) maxR = d;
    }

    ctx.save();
    var grad = ctx.createRadialGradient(apex.x, apex.y, 1, apex.x, apex.y, maxR);
    grad.addColorStop(0, "rgba(255, 232, 80, " + (0.55 * a) + ")");   // warm yellow core
    grad.addColorStop(0.45, "rgba(232, 224, 90, " + (0.32 * a) + ")");
    grad.addColorStop(0.8, "rgba(150, 214, 96, " + (0.12 * a) + ")");
    grad.addColorStop(1, "rgba(90, 190, 96, " + (0.02 * a) + ")");    // soft transparent green
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    ctx.lineTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.fill();

    // faint cone-edge silhouette lines from the apex to each ground corner
    ctx.strokeStyle = "rgba(255, 235, 90, " + (0.22 * a) + ")";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(apex.x, apex.y);
    for (i = 0; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // render entrypoint called from BlockRender.renderFrame (main ctx, grid).
  // Draws every in-flight zone instance (drop / scan / exit). When a zone has
  // no active animation state, nothing is drawn for it. There is no placement
  // preview: deployment is no-click and starts immediately.
  api.renderMain = function (ctx, grid) {
    for (var i = 0; i < api.zones.length; i++) {
      renderZone(ctx, grid, api.zones[i]);
    }
  };

  // viewed from: the screen point is projected back to world space using the
  // cached anchor (camera offset + iso scale captured when the phase started),
  // then forward to the CURRENT frame. This re-glues the point to the map both
  // while panning (camera translation) AND when the viewport rescales mid-
  // animation (fullscreen toggles re-fit isoSize and recenter the camera).
  // Fast path: same anchor & camera -> the point is already current.
  function projectFrom(anchor, p) {
    var g = window.IsoGrid;
    if (!anchor || !g || !p || anchor.iso == null) return p;
    if (!g.camera || g.isoSize == null) return p;
    if (anchor.iso === g.isoSize && anchor.x === g.camera.x && anchor.y === g.camera.y) {
      return p;
    }
    var u = p.x - anchor.x;
    var v = p.y - anchor.y;
    var col = (u + 2 * v) / (2 * anchor.iso);
    var row = (2 * v - u) / (2 * anchor.iso);
    return g.worldToScreen(col, row);
  }

  // same re-projection for the cached areaCorners object (TL/TR/BR/BL)
  function projectCorners(anchor, corners) {
    if (!corners) return corners;
    if (!anchor) return corners;
    return {
      TL: projectFrom(anchor, corners.TL),
      TR: projectFrom(anchor, corners.TR),
      BR: projectFrom(anchor, corners.BR),
      BL: projectFrom(anchor, corners.BL),
    };
  }

  function renderZone(ctx, grid, zone) {
    var area = zone.area;

    // camera/viewport correction: the drone and corner screen coordinates
    // cached in the scan/exit states live in the frame captured by their
    // camStart anchor (camera offset AND iso scale at phase start).
    // Re-projecting them into the current frame keeps the beam and drones
    // glued to the map while panning and while the viewport rescales
    // mid-animation (e.g. toggling fullscreen re-fits isoSize). World-space
    // geometry like the outline is drawn from tile positions every frame
    // and needs no correction.
    var anchor = (zone.scan && zone.scan.camStart) || zone.camStart;
    // 1) in-progress drop-in (the drone settling before the scan). The scan is
    //    already committed, so show the solid cyan outline (not a blueprint).
    if (zone.drop && zone.drop.drones && zone.drop.drones.length) {
      var dd = zone.drop;
      for (var di = 0; di < dd.drones.length; di++) {
        drawMarker(ctx, dd.drones[di].col, dd.drones[di].row, dd.drones[di].rise, dd.drones[di].alpha);
      }
      if (area) drawAreaOutline(ctx, area, [], OUTLINE_COLOR, 1, 0, 2.5);
      return;
    }

    // 2) in-progress cone scan: committed outline + ground heatmap + cone of
    //    light + the hovering drone (drawn on top so it stays crisp in the
    //    cone's glow). Everything derives from the same clamped corners. The
    //    cone apex is the drone's LIVE screen position each frame (the exact
    //    same x/y — including the bob offset — used to draw the body), so the
    //    beam always connects directly to the body, never a fixed precomputed
    //    point.
    if (zone.scan) {
      var s = zone.scan;
      if (area) {
        var c = projectCorners(anchor, s.corners);
        var hq = hqInArea(area);
        if (hq) {
          // punch an HQ-shaped hole so the heatmap / cone / sweep never
          // paint over the HQ building (future-proof for any HQ tile)
          var isoH = (window.IsoGrid && window.IsoGrid.isoSize) || 32;
          var halfH = isoH / 2;
          var hpH = tileScreen(hq.col, hq.row);
          var hyH = groundTopY(hq.col, hq.row);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(c.TL.x, c.TL.y); ctx.lineTo(c.TR.x, c.TR.y); ctx.lineTo(c.BR.x, c.BR.y); ctx.lineTo(c.BL.x, c.BL.y); ctx.closePath();
          ctx.moveTo(hpH.x, hyH - halfH); ctx.lineTo(hpH.x + isoH, hyH); ctx.lineTo(hpH.x, hyH + halfH); ctx.lineTo(hpH.x - isoH, hyH); ctx.closePath();
          try { ctx.clip('evenodd'); } catch (e) { try { ctx.clip(); } catch (e2) {} }
          drawHeatmap(ctx, area, c, s.alpha, s.heat, s.heatPulse);
          if (s.drones && s.drones.length) {
            var apexDrone = s.drones[0];
            var apex = projectFrom(anchor, apexDrone);
            drawCone(ctx, area, c, { x: apex.x, y: apex.y - (s.bob || 0) * BOB_AMP }, s.alpha, s.pulse);
          }
          drawSweep(ctx, c, s.alpha, s.sweep);
          ctx.restore();
        } else {
          drawHeatmap(ctx, area, c, s.alpha, s.heat, s.heatPulse);
          if (s.drones && s.drones.length) {
            var apexDrone = s.drones[0];
            var apex = projectFrom(anchor, apexDrone);
            drawCone(ctx, area, c, { x: apex.x, y: apex.y - (s.bob || 0) * BOB_AMP }, s.alpha, s.pulse);
          }
          drawSweep(ctx, c, s.alpha, s.sweep);
        }
        drawAreaOutline(ctx, area, [], OUTLINE_COLOR, 1, 6, 2.5);
      }
      for (var si = 0; si < s.drones.length; si++) {
        var sd = s.drones[si];
        // idle-bob: the drone lifts the same small offset during hold
        var dp = projectFrom(anchor, sd);
        drawMarkerAt(ctx, dp.x, dp.y - (s.bob || 0) * BOB_AMP, 1, { x: sd.hx, y: sd.hy });
      }
      return;
    }

    // 3) post-scan drone fly-away: the outline fades out in sync with the
    //    departing drone (its alpha tracks the drone's alpha) and is
    //    removed when the exit completes — nothing remains for this chunk once
    //    the zone is done.
    if (zone.exit && zone.exit.drones && zone.exit.drones.length) {
      var eAlpha = zone.exit.drones.length ? zone.exit.drones[0].alpha : 1;
      if (area) drawAreaOutline(ctx, area, [], OUTLINE_COLOR, eAlpha, 8, 2.5);
      for (var ei = 0; ei < zone.exit.drones.length; ei++) {
        var ed = zone.exit.drones[ei];
        var ep = projectFrom(anchor, ed);
        drawMarkerAt(ctx, ep.x, ep.y, ed.alpha, { x: ed.hx, y: ed.hy });
      }
      return;
    }
  }

  return api;
})();
