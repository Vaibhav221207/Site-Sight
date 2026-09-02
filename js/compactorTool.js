/* js/compactorTool.js — Dynamic Compactor: tile surface stability upgrade
 *  Crane/tamper rig with 3-drop compaction cycle, camera shake, particles,
 *  flash ring, stability upgrade, payoff label. All via anime.js shared state.
 */

window.CompactorTool = (function () {
  var api = {
    isActive: false,
    _target: null,      // { col, row } - legacy single target
    _selection: null,   // { startCol, startRow, endCol, endRow } for drag-select
    _selectionStart: null, // screen position { x, y } for drag preview
    _selectionEnd: null,   // screen position { x, y } for drag preview
    _selectionConfirmed: false, // whether selection is confirmed
    _anim: null,
    _state: {
      rig: { scale: 0, alpha: 0, y: 0 },
      tamper: { y: 0, alpha: 1 },
      camera: { x: 0, y: 0 },
      particles: [],
      flash: { radius: 0, alpha: 0 },
      payoff: { alpha: 0, y: 0, oldVal: "", newVal: "" },
      cycle: 0,
    },
  };

  var COMPACTOR_COST = 6000;

  // ---- entry point from BuildMenu ----
  api.startPlacement = function () {
    api.isActive = true;
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    api._selectionConfirmed = false;
    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode('compacting');
      window.InputHandler.setCursor("crosshair");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(true);
      window.InputHandler.setCursor("crosshair");
    }
    // Show stop button in HUD (desktop + mobile rail)
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "inline-flex";
    var muStop = document.getElementById("mu-stop");
    if (muStop) muStop.style.display = "inline-flex";
    if (window.HqPanel) window.HqPanel.showMsg("Drag to select trench / rock area for compaction (scanned hazard, not Excellent)", false);
    console.log("[Compactor] Placement mode entered — drag to select rectangular area");
  };

  api.setPreview = function (startScreen, endScreen) {
    api._selectionStart = startScreen ? { x: startScreen.x, y: startScreen.y } : null;
    api._selectionEnd = endScreen ? { x: endScreen.x, y: endScreen.y } : null;
  };
  api.clearPreview = function () {
    api._selectionStart = null;
    api._selectionEnd = null;
  };

  api.cancel = function () {
    api.isActive = false;
    api._target = null;
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    api._selectionConfirmed = false;
    if (window.InputHandler && window.InputHandler.setMode) {
      if (window.InputHandler.getMode() === 'compacting') window.InputHandler.setMode('idle');
      window.InputHandler.setCursor("grab");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "none";
    var muStop2 = document.getElementById("mu-stop");
    if (muStop2) muStop2.style.display = "none";
    if (api._anim) { api._anim.pause(); api._anim = null; }
  };

  // validation: trench OR rock — scanned hazard tiles that are not Excellent
  api.isValidTile = function (col, row) {
    if (!window.Terrain) return false;
    var isHaz = (window.Terrain.isTrench && window.Terrain.isTrench(col, row)) ||
                (window.Terrain.isRock && window.Terrain.isRock(col, row));
    if (!isHaz) return false;
    var data = window.GameState && window.GameState.getTileData
      ? window.GameState.getTileData(col, row) : null;
    if (!data || !data.droneScanned) return false;
    if (data.surfaceStability === "Excellent") return false;
    return true;
  };

  // validation for entire selection rectangle
  api.isValidSelection = function (selection) {
    if (!selection) return false;
    var count = 0;
    for (var c = selection.startCol; c <= selection.endCol; c++) {
      for (var r = selection.startRow; r <= selection.endRow; r++) {
        if (api.isValidTile(c, r)) count++;
      }
    }
    return count > 0;
  };

  api.getValidTilesInSelection = function (selection) {
    var tiles = [];
    for (var c = selection.startCol; c <= selection.endCol; c++) {
      for (var r = selection.startRow; r <= selection.endRow; r++) {
        if (api.isValidTile(c, r)) {
          tiles.push({ col: c, row: r });
        }
      }
    }
    return tiles;
  };

  api.attempt = function (col, row, onSuccess) {
    if (!api.isValidTile(col, row)) {
      var data = window.GameState && window.GameState.getTileData
        ? window.GameState.getTileData(col, row) : null;
      var reason = "Invalid target";
      if (window.Terrain && !(window.Terrain.isTrench(col, row) || window.Terrain.isRock(col, row))) reason = "Only trench / rock tiles can be compacted";
      else if (!data || !data.droneScanned) reason = "Trench not scanned — scan with Drone first";
      else if (data.surfaceStability === "Excellent") reason = "Trench already Excellent";
      if (window.HqPanel) window.HqPanel.showMsg(reason, false);
      console.log("[Compactor] Invalid trench target (" + col + "," + row + "): " + reason, data);
      return false;
    }

    api._target = { col: col, row: row };
    api.isActive = false;
    if (window.InputHandler && window.InputHandler.setMode) {
      if (window.InputHandler.getMode() === 'compacting') window.InputHandler.setMode('idle');
      window.InputHandler.setCursor("grab");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    if (window.BuildMenu && window.BuildMenu.onBuildSuccess) window.BuildMenu.onBuildSuccess();

    console.log("[Compactor] Deploying on (" + col + "," + row + ")");
    api._runSequence(onSuccess);
    return true;
  };

  // New drag-select attempt - called when user confirms selection
  api.confirmSelection = function (selection, onSuccess) {
    if (!api.isValidSelection(selection)) {
      if (window.HqPanel) window.HqPanel.showMsg("No trench / rock tiles in selection", false);
      return false;
    }
    var validTiles = api.getValidTilesInSelection(selection);
    if (validTiles.length === 0) {
      if (window.HqPanel) window.HqPanel.showMsg("No trench / rock tiles in selection", false);
      return false;
    }

    api._selection = selection;
    // rig appears over the valid trench centroid, not the big scanned-rect centre
    var _sumC = 0, _sumR = 0;
    for (var _i = 0; _i < validTiles.length; _i++) { _sumC += validTiles[_i].col; _sumR += validTiles[_i].row; }
    api._target = {
      col: Math.round(_sumC / validTiles.length),
      row: Math.round(_sumR / validTiles.length)
    };
    api.isActive = false;
    api._selectionConfirmed = true;

    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode('idle');
      window.InputHandler.setCursor("grab");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    if (window.BuildMenu && window.BuildMenu.onBuildSuccess) window.BuildMenu.onBuildSuccess();

    console.log("[Compactor] Deploying on " + validTiles.length + " tiles");
    api._runSequence(validTiles, onSuccess);
    return true;
  };

  // ---------- MAIN ANIMATION SEQUENCE ----------
  // validTiles is an array of {col, row} for all tiles to compact
  api._runSequence = function (validTiles, onComplete) {
    var st = api._state;
    var target = api._target;
    if (!target || !window.BlockRender || !window.IsoGrid) {
      if (onComplete) onComplete(false);
      return;
    }

    var grid = window.IsoGrid;
    var p = grid.worldToScreen(target.col, target.row);
    var cx = p.x, cy = p.y;
    var iso = grid.isoSize, half = iso / 2;

    // reset state
    st.rig = { scale: 0.3, alpha: 0, y: 0 };
    st.tamper = { y: -80, alpha: 1 };  // starts high above
    st.camera = { x: 0, y: 0 };
    st.particles = [];
    st.flash = { radius: 0, alpha: 0 };
    st.payoff = { alpha: 0, y: 0, oldVal: "", newVal: "" };
    st.cycle = 0;

    // get current stability for payoff (use first tile as reference)
    var data = window.GameState.getTileData
      ? window.GameState.getTileData(target.col, target.row) : null;
    var oldStab = data ? data.surfaceStability : "Poor";
    var tiers = ["Poor", "Fair", "Good", "Excellent"];
    var idx = tiers.indexOf(oldStab);
    var newStab = (idx >= 0 && idx < 3) ? tiers[idx + 1] : oldStab;
    st.payoff.oldVal = oldStab;
    st.payoff.newVal = newStab;
    st.payoff.count = 1; // will be updated in showPayoffAndExit

    // ---------- ENTRANCE ----------
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: st.rig,
        scale: 1,
        alpha: 1,
        duration: 420,
        easing: "spring(1, 70, 10, 0)",
        complete: startCompaction,
      });
    } else {
      st.rig.scale = 1; st.rig.alpha = 1;
      startCompaction();
    }

    // ---------- COMPACTION LOOP (3 cycles) ----------
    function startCompaction() {
      runCycle(0);
    }

    function runCycle(i) {
      if (i >= 3) {
        // after 3 cycles -> payoff & exit
        setTimeout(function () {
          showPayoffAndExit();
        }, 300);
        return;
      }
      st.cycle = i + 1;

      // TAMPER UP
      anime({
        targets: st.tamper,
        y: -80,
        duration: 320,
        easing: "easeOutCubic",
        complete: function () {
          // TAMPER DROP
          anime({
            targets: st.tamper,
            y: 0,
            duration: 160,
            easing: "easeInQuad",
            complete: function () {
              onImpact();
              // small pause then next cycle
              setTimeout(function () { runCycle(i + 1); }, 220);
            },
          });
        },
      });
    }

    function onImpact() {
      // CAMERA SHAKE
      anime({
        targets: st.camera,
        x: [0, 6, -5, 4, -3, 2, -1, 0],
        y: [0, -4, 3, -2, 1, 0, 0, 0],
        duration: 180,
        easing: "linear",
      });

      // DUST PARTICLES
      spawnParticles();

      // FLASH RING
      anime({
        targets: st.flash,
        radius: [0, iso * 1.2],
        alpha: [0.6, 0],
        duration: 220,
        easing: "easeOutQuad",
      });
    }

    function showPayoffAndExit() {
      var gs = window.GameState;
      var validTiles = api.getValidTilesInSelection(api._selection);
      // every selected valid tile is a hazard (trench or rock) to be compacted
      var updatedCount = 0;
      if (gs && gs.tileData) {
        var tiers2 = ["Poor", "Fair", "Good", "Excellent"];
        for (var t = 0; t < validTiles.length; t++) {
          var key = validTiles[t].col + "," + validTiles[t].row;
          var td = gs.tileData[key];
          if (td) {
            var idx2 = tiers2.indexOf(td.surfaceStability);
            if (idx2 >= 0 && idx2 < 3) {
              td.surfaceStability = tiers2[idx2 + 1];
              if (window.GameState.recalcBestUse) window.GameState.recalcBestUse(validTiles[t].col, validTiles[t].row);
              updatedCount++;
            }
          }
        }
      }
      // turn any hazard tiles that were compacted into normal flat land
      var trenchConverted = 0;
      if (validTiles.length && window.Terrain && window.Terrain.fillTrenchArea) {
        trenchConverted = window.Terrain.fillTrenchArea(validTiles);
        if (trenchConverted > 0 && window.BlockRender) {
          window.BlockRender.invalidate();
          // pop each newly-filled tile so the replacement reads instantly
          if (window.BlockRender.popTiles) window.BlockRender.popTiles(validTiles);
        }
      }

      // PAYOFF LABEL - show count if multiple tiles
      st.payoff.count = updatedCount;
      if (updatedCount > 1) {
        st.payoff.oldVal = updatedCount + " tiles";
        st.payoff.newVal = "improved";
      }
      st.payoff = { alpha: 1, y: 0, oldVal: st.payoff.oldVal, newVal: st.payoff.newVal, count: updatedCount };
      anime({
        targets: st.payoff,
        y: [0, -30],
        alpha: [1, 1, 0],
        duration: 1800,
        easing: "easeOutQuad",
      });

      // RIG EXIT — re-arm instead of fully cancelling: keep the tool in placement
      // mode so the player can keep compacting until the site is clear. Only the
      // "Stop" button (api.cancel) fully exits. A small side hint reminds them.
      anime({
        targets: st.rig,
        scale: 0.2,
        alpha: 0,
        duration: 420,
        easing: "easeInCubic",
        complete: function () {
          var S = api._state;
          S.rig = { scale: 0, alpha: 0, y: 0 };
          S.tamper = { y: 0, alpha: 1 };
          S.camera = { x: 0, y: 0 };
          S.particles = [];
          S.flash = { radius: 0, alpha: 0 };
          S.payoff = { alpha: 0, y: 0, oldVal: "", newVal: "" };
          S.cycle = 0;
          api.isActive = true;
          api._target = null;
          api._selection = null;
          api._selectionConfirmed = false;
          api._selectionStart = null;
          api._selectionEnd = null;
          if (window.InputHandler && window.InputHandler.setMode) {
            window.InputHandler.setMode('compacting');
            window.InputHandler.setCursor("crosshair");
          } else if (window.InputHandler) {
            window.InputHandler.setPlacementMode(true);
            window.InputHandler.setCursor("crosshair");
          }
          var stopBtn = document.getElementById("hud-stop-btn");
          if (stopBtn) stopBtn.style.display = "inline-flex";
          if (window.HqPanel) window.HqPanel.showMsg(
            "Compacted " + trenchConverted + " tile(s) — drag another area or press Stop to finish", false);
          if (typeof onComplete === "function") onComplete(true);
        },
      });
    }
  };

  // ---------- PARTICLE SPAWN ----------
  function spawnParticles() {
    var st = api._state;
    var target = api._target;
    if (!target || !window.BlockRender || !window.IsoGrid) return;
    var grid = window.IsoGrid;
    var tp = grid.worldToScreen(target.col, target.row);
    var baseX = tp.x, baseY = tp.y - grid.isoSize / 2;

    var parts = [];
    for (var i = 0; i < 10; i++) {
      var ang = Math.random() * Math.PI * 2;
      var dist = 10 + Math.random() * 24;
      var size = 2 + Math.random() * 3;
      var color = Math.random() < 0.5 ? "#9a8c7a" : "#7a6d5a";
      parts.push({
        x: baseX,
        y: baseY,
        vx: Math.cos(ang) * dist,
        vy: Math.sin(ang) * dist - (8 + Math.random() * 8),
        size: size,
        color: color,
        alpha: 1,
        life: 1,
      });
    }
    st.particles = parts;
    anime({
      targets: parts,
      life: 0,
      duration: 450,
      easing: "easeOutQuad",
      update: function () {
        for (var j = 0; j < st.particles.length; j++) {
          var pt = st.particles[j];
          pt.x += pt.vx * 0.16;
          pt.y += pt.vy * 0.16;
          pt.vy += 0.35;
          pt.alpha = Math.max(0, pt.life);
        }
      },
      complete: function () { st.particles = []; },
    });
  }

  function drawBlueprintPreview(ctx, grid) {
    if (!api.isActive || !api._selectionStart || !api._selectionEnd || api._selectionConfirmed) return false;
    var gs = grid;
    if (!gs || !gs.isoSize) return false;
    var iso = gs.isoSize, half = iso / 2;
    var sTile = gs.screenToTile(api._selectionStart.x, api._selectionStart.y);
    var eTile = gs.screenToTile(api._selectionEnd.x, api._selectionEnd.y);
    // if drag started/ended outside grid, clamp to nearest inside by using worldToScreen fallback:
    // when screenToTile returns null, we still want a visible rect — fall back to screen rect outline
    if (!sTile || !eTile) {
      var p1 = api._selectionStart, p2 = api._selectionEnd;
      var x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
      var w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#4FC3F7";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "rgba(79,195,247,0.10)";
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.restore();
      return true;
    }
    var sc = Math.min(sTile.col, eTile.col), ec = Math.max(sTile.col, eTile.col);
    var sr = Math.min(sTile.row, eTile.row), er = Math.max(sTile.row, eTile.row);
    // clamp to grid bounds
    sc = Math.max(0, sc); sr = Math.max(0, sr);
    ec = Math.min(gs.gridSize - 1, ec); er = Math.min(gs.gridSize - 1, er);
    var total = (ec - sc + 1) * (er - sr + 1);
    var validCount = 0;
    var cxSum = 0, cySum = 0, nTiles = 0;
    // pre-count valid for badge
    for (var c = sc; c <= ec; c++) {
      for (var r = sr; r <= er; r++) {
        if (api.isValidTile(c, r)) validCount++;
      }
    }
    // draw per-tile ghost diamonds (back-to-front so overlap is correct)
    var tiles = [];
    for (var c2 = sc; c2 <= ec; c2++) for (var r2 = sr; r2 <= er; r2++) tiles.push({c:c2,r:r2});
    tiles.sort(function(a,b){ return (a.c+a.r)-(b.c+b.r); });
    ctx.save();
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var p = gs.worldToScreen(t.c, t.r);
      var x0 = p.x, y0 = p.y;
      // lift slightly so it sits on top of the block's top face
      var topY = y0 - 4;
      var isValid = api.isValidTile(t.c, t.r);
      // track center for badge
      cxSum += x0; cySum += topY; nTiles++;
      ctx.beginPath();
      ctx.moveTo(x0, topY - half);
      ctx.lineTo(x0 + iso, topY);
      ctx.lineTo(x0, topY + half);
      ctx.lineTo(x0 - iso, topY);
      ctx.closePath();
      if (isValid) {
        ctx.fillStyle = "rgba(79,195,247,0.22)";
        ctx.fill();
        ctx.strokeStyle = "rgba(79,195,247,0.95)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // inner blueprint cross (subtle)
        ctx.beginPath();
        ctx.moveTo(x0, topY - half*0.55);
        ctx.lineTo(x0 + iso*0.55, topY);
        ctx.lineTo(x0, topY + half*0.55);
        ctx.lineTo(x0 - iso*0.55, topY);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.09)";
        ctx.fill();
        ctx.strokeStyle = "rgba(43,35,32,0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4,3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // diagonal hatch for invalid
        ctx.beginPath();
        ctx.moveTo(x0 - iso*0.6, topY);
        ctx.lineTo(x0 + iso*0.6, topY);
        ctx.moveTo(x0, topY - half*0.6);
        ctx.lineTo(x0, topY + half*0.6);
        ctx.strokeStyle = "rgba(43,35,32,0.10)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
    if (nTiles > 0) {
      var bx = cxSum / nTiles;
      var by = (cySum / nTiles) - iso - 18;
      var label = validCount + " hazard";
      if (total !== validCount) label += " / " + total + " tiles";
      else label = total + (total===1?" hazard tile":" hazard tiles");
      // selection dimensions e.g. "3×4"
      var dims = (ec - sc + 1) + "\u00D7" + (er - sr + 1);
      ctx.save();
      ctx.font = "700 13px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var padX = 10, padY = 6;
      var tw = ctx.measureText(label).width;
      var tw2 = ctx.measureText(dims).width;
      var bw = Math.max(tw, tw2) + padX*2;
      var bh = 32;
      // bg
      ctx.fillStyle = "#FFFBF0";
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx - bw/2, by - bh/2, bw, bh, 10); }
      else { ctx.rect(bx - bw/2, by - bh/2, bw, bh); }
      ctx.fill();
      ctx.stroke();
      // hard offset shadow (chunky)
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(bx - bw/2 + 2, by - bh/2 + 2, bw, bh, 10); }
      ctx.fill();
      // text — two lines: dims (small) + label
      ctx.fillStyle = "#2B2320";
      ctx.font = "700 10px 'Baloo 2', sans-serif";
      ctx.fillText(dims, bx, by - 7);
      ctx.font = "700 11px 'Baloo 2', sans-serif";
      ctx.fillStyle = validCount > 0 ? "#0E8A5A" : "#C0392B";
      ctx.fillText(label, bx, by + 7);
      ctx.restore();
    }
    return true;
  }

  // ---------- RENDER HOOK ----------
  // called from BlockRender.renderFrame each frame
  api.render = function (ctx, grid) {
    var st = api._state;

    // ---- blueprint ghost preview (drag-select) — always on top when placing ----
    var drewBlueprint = false;
    if (api.isActive) {
      drewBlueprint = drawBlueprintPreview(ctx, grid);
    }

    var target = api._target;
    if (!target || !st.rig.alpha) {
      // no rig animating — preview (if any) is the only thing to draw this frame
      return;
    }

    var p = window.IsoGrid.worldToScreen(target.col, target.row);
    var cx = p.x, cy = p.y;
    var iso = grid.isoSize, half = iso / 2;

    ctx.save();

    // camera shake translation
    if (st.camera.x || st.camera.y) ctx.translate(st.camera.x, st.camera.y);

    ctx.save();

    // camera shake translation
    if (st.camera.x || st.camera.y) ctx.translate(st.camera.x, st.camera.y);

    // ---- RIG ----
    var rig = st.rig;
    if (rig.alpha > 0) {
      ctx.globalAlpha = rig.alpha;
      drawRig(ctx, cx, cy, iso, half, rig.scale);
      ctx.globalAlpha = 1;
    }

    // ---- PARTICLES ----
    if (st.particles.length) {
      for (var i = 0; i < st.particles.length; i++) {
        var p = st.particles[i];
        if (p.life <= 0) continue;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---- FLASH RING ----
    if (st.flash.alpha > 0) {
      ctx.globalAlpha = st.flash.alpha;
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, st.flash.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- PAYOFF LABEL ----
    if (st.payoff.alpha > 0) {
      ctx.globalAlpha = st.payoff.alpha;
      ctx.font = "bold 14px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      var text;
      if (st.payoff.count && st.payoff.count > 1) {
        text = st.payoff.count + " tiles improved";
      } else {
        text = st.payoff.oldVal + " \u2192 " + st.payoff.newVal;
      }
      var x = p.x, y = p.y - grid.isoSize - st.payoff.y;
      // outline
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y);
      // fill
      ctx.fillStyle = "#E8604A";
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.restore(); // restore the outer save from selection preview
  };

  // ---------- RIG — toy chunky compactor (cream/coral, hard ink, matches site vibe) ----------
  function drawRig(ctx, cx, cy, iso, half, scale) {
    var st = api._state;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale * 1.55, scale * 1.55);

    // flat ground loaf shadow
    ctx.beginPath();
    ctx.ellipse(0, half * 0.38, iso * 0.92, half * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fill();

    var baseW = iso * 1.42, baseY = iso * 0.10;

    // chunky base — cream block with coral bottom + 3px ink + hard offset dot
    var hullH = 16, hullY = baseY - hullH;
    ctx.fillStyle = "#FFFBF0";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-baseW/2, hullY, baseW, hullH, 10);
    else ctx.rect(-baseW/2, hullY, baseW, hullH);
    ctx.fill(); ctx.stroke();
    // coral bottom lip
    ctx.fillStyle = "#E8604A";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-baseW/2 + 3, hullY + hullH - 7, baseW - 6, 7, 4);
    else ctx.rect(-baseW/2 + 3, hullY + hullH - 7, baseW - 6, 7);
    ctx.fill();
    // tiny tracks — just two black pills under the hull (toy)
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-baseW/2 - 4, baseY + 2, baseW + 8, 7, 3);
    else ctx.rect(-baseW/2 - 4, baseY + 2, baseW + 8, 7);
    ctx.fill();
    // track treads (3 little ticks)
    ctx.fillStyle = "#FFFBF0"; ctx.globalAlpha = 0.9;
    for (var ti = -1; ti <= 1; ti++) {
      ctx.fillRect(ti * (baseW/3), baseY + 4, 6, 2);
    }
    ctx.globalAlpha = 1;

    // cute cab — little square with big round window + coral roof
    var cabW = 28, cabH = 18, cabX = -baseW/2 + 10, cabY = hullY - cabH + 5;
    ctx.fillStyle = "#FFFBF0";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cabX, cabY, cabW, cabH, 7);
    else ctx.rect(cabX, cabY, cabW, cabH);
    ctx.fill(); ctx.stroke();
    // round window
    ctx.fillStyle = "#7ED6FF";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cabX + cabW/2, cabY + 9, 7, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    // little highlight
    ctx.fillStyle = "#FFFBF0";
    ctx.beginPath(); ctx.arc(cabX + cabW/2 - 2.5, cabY + 7, 2, 0, Math.PI*2); ctx.fill();
    // coral roof cap
    ctx.fillStyle = "#E8604A"; ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cabX - 2, cabY - 4, cabW + 4, 6, 3);
    else ctx.rect(cabX - 2, cabY - 4, cabW + 4, 6);
    ctx.fill(); ctx.stroke();

    // stubby mast — single thick cream post with two bolts, no A-frame (toy)
    var mastH = iso * 1.45, mastTop = hullY - mastH;
    var postW = 12;
    ctx.fillStyle = "#FFFBF0";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-postW/2, mastTop, postW, mastH, 4);
    else ctx.rect(-postW/2, mastTop, postW, mastH);
    ctx.fill(); ctx.stroke();
    // bolts
    ctx.fillStyle = "#2B2320";
    ctx.beginPath(); ctx.arc(0, mastTop + 8, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, mastTop + mastH - 10, 2, 0, Math.PI*2); ctx.fill();
    // top cap + tiny beacon
    ctx.fillStyle = "#E8604A";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-postW/2 - 3, mastTop - 3, postW + 6, 6, 3);
    else ctx.rect(-postW/2 - 3, mastTop - 3, postW + 6, 6);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, mastTop - 6, 4, 0, Math.PI*2);
    ctx.fillStyle = "#E0483A"; ctx.fill();
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2; ctx.stroke();

    // short toy boom — chunky coral arm, no hydraulics
    var boomL = iso * 1.15, boomAng = -0.30;
    var bx0 = 0, by0 = mastTop + 14;
    ctx.save();
    ctx.translate(bx0, by0);
    ctx.rotate(boomAng);
    ctx.fillStyle = "#E8604A";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, -7, boomL, 14, 7);
    else ctx.rect(0, -7, boomL, 14);
    ctx.fill(); ctx.stroke();
    // little rivets
    ctx.fillStyle = "#2B2320";
    ctx.beginPath(); ctx.arc(boomL*0.32, 0, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(boomL*0.68, 0, 2, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // chunky hanging gear — thick cable + sheave + shackle (reads as one piece)
    var cableX = Math.cos(boomAng) * boomL * 0.92;
    var cableY = by0 + Math.sin(boomAng) * boomL * 0.92;
    // sheave block at boom tip (chunky)
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cableX - 9, cableY - 7, 18, 14, 4);
    else ctx.rect(cableX - 9, cableY - 7, 18, 14);
    ctx.fill();
    ctx.fillStyle = "#FFFBF0";
    ctx.beginPath(); ctx.arc(cableX, cableY, 4.5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2; ctx.stroke();
    // tamper position (driven by animation)
    var tamperY = cableY + 52 + st.tamper.y;
    var tw = iso * 1.05, th = iso * 0.58;
    // cable — now visibly connects boom → shackle → tamper (length follows drop)
    var topY = cableY + 6;
    var botY = tamperY - th/2 + 2;
    // ink casing
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(cableX, topY); ctx.lineTo(cableX, botY); ctx.stroke();
    // cream core
    ctx.strokeStyle = "#FFFBF0"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(cableX, topY); ctx.lineTo(cableX, botY); ctx.stroke();
    // chain ticks along the visible cable
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 1.5;
    var segs = Math.max(1, Math.floor((botY - topY) / 11));
    for (var ci = 0; ci < segs && ci < 8; ci++) {
      var cy = topY + 10 + ci * 11;
      if (cy >= botY - 4) break;
      ctx.beginPath(); ctx.moveTo(cableX - 4.5, cy); ctx.lineTo(cableX + 4.5, cy); ctx.stroke();
    }
    // shackle — chunky, now fused to tamper top (reads as one piece)
    var shackY = botY;
    ctx.fillStyle = "#2B2320";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cableX - 8, shackY - 5, 16, 10, 3);
    else ctx.rect(cableX - 8, shackY - 5, 16, 10);
    ctx.fill();
    ctx.fillStyle = "#F2B705";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cableX - 6, shackY - 3, 12, 5, 2);
    else ctx.rect(cableX - 6, shackY - 3, 12, 5);
    ctx.fill(); ctx.stroke();

    // BIG toy tamper — uses tamperY/tw/th from above (already follows drop)
    // drop shadow
    if (st.tamper.y > -18) {
      ctx.beginPath();
      ctx.ellipse(cableX, tamperY + th/2 + 7, tw*0.52, th*0.30, 0, 0, Math.PI*2);
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fill();
    }
    // side depth — simple extruded block (one color, chunky)
    ctx.fillStyle = "#E9DDC8";
    ctx.beginPath();
    ctx.moveTo(cableX - tw/2, tamperY - th/2 + 3);
    ctx.lineTo(cableX - tw/2 + 8, tamperY - th/2 - 5);
    ctx.lineTo(cableX + tw/2 + 8, tamperY - th/2 - 5);
    ctx.lineTo(cableX + tw/2, tamperY - th/2 + 3);
    ctx.lineTo(cableX + tw/2, tamperY + th/2 + 3);
    ctx.lineTo(cableX + tw/2 + 8, tamperY + th/2 - 5);
    ctx.lineTo(cableX - tw/2 + 8, tamperY + th/2 - 5);
    ctx.lineTo(cableX - tw/2, tamperY + th/2 + 3);
    ctx.closePath();
    ctx.fill();
    // top face — cream with thick ink
    ctx.fillStyle = "#FFFBF0";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cableX - tw/2, tamperY - th/2, tw, th, 8);
    else ctx.rect(cableX - tw/2, tamperY - th/2, tw, th);
    ctx.fill(); ctx.stroke();
    // hazard band — wide, bold, with ink outline
    ctx.fillStyle = "#F2B705";
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cableX - tw/2 + 4, tamperY - 4, tw - 8, 10, 3);
    else ctx.rect(cableX - tw/2 + 4, tamperY - 4, tw - 8, 10);
    ctx.fill(); ctx.stroke();
    // diagonal hazard ticks
    ctx.strokeStyle = "#2B2320"; ctx.lineWidth = 2; ctx.lineCap = "butt";
    for (var hk = -2; hk <= 2; hk++) {
      var hx2 = cableX + hk * (tw/5);
      ctx.beginPath();
      ctx.moveTo(hx2 - 5, tamperY - 4);
      ctx.lineTo(hx2 + 5, tamperY + 6);
      ctx.stroke();
    }

    ctx.restore();
  }

  return api;
})();