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
    if (window.InputHandler) {
      window.InputHandler.setPlacementMode(true);
      window.InputHandler.setCursor("crosshair");
    }
    // Show stop button in HUD
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "inline-flex";
    if (window.HqPanel) window.HqPanel.showMsg("Drag to select area for compaction (scanned tiles, not Excellent)", false);
    console.log("[Compactor] Placement mode entered — drag to select rectangular area");
  };

  api.cancel = function () {
    api.isActive = false;
    api._target = null;
    api._selection = null;
    api._selectionStart = null;
    api._selectionEnd = null;
    api._selectionConfirmed = false;
    if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    // Hide stop button
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) stopBtn.style.display = "none";
    if (api._anim) { api._anim.pause(); api._anim = null; }
  };

  // validation: scanned, not Excellent (trench now allowed — this is the fix for it)
  api.isValidTile = function (col, row) {
    if (!window.Terrain) return false;
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
    // For backward compatibility with single-tile clicks, but now we expect drag-select
    // This should not be called directly anymore - drag selection is handled via input.js
    if (!api.isValidTile(col, row)) {
      var data = window.GameState && window.GameState.getTileData
        ? window.GameState.getTileData(col, row) : null;
      var reason = "Invalid target";
      if (!data || !data.droneScanned) reason = "Tile not scanned — scan with Drone first";
      else if (data.surfaceStability === "Excellent") reason = "Tile already Excellent";
      if (window.HqPanel) window.HqPanel.showMsg(reason, false);
      console.log("[Compactor] Invalid target (" + col + "," + row + "): " + reason, data);
      return false;
    }

    api._target = { col: col, row: row };
    api.isActive = false;
    if (window.InputHandler) {
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
      if (window.HqPanel) window.HqPanel.showMsg("No valid tiles in selection", false);
      return false;
    }

    var validTiles = api.getValidTilesInSelection(selection);
    if (validTiles.length === 0) {
      if (window.HqPanel) window.HqPanel.showMsg("No valid tiles in selection", false);
      return false;
    }

    api._selection = selection;
    api._target = { 
      col: Math.floor((selection.startCol + selection.endCol) / 2), 
      row: Math.floor((selection.startRow + selection.endRow) / 2) 
    };
    api.isActive = false;
    api._selectionConfirmed = true;

    if (window.InputHandler) {
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
      // update stability in game state for ALL valid tiles
      var gs = window.GameState;
      var validTiles = api.getValidTilesInSelection(api._selection);
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

      // RIG EXIT
      anime({
        targets: st.rig,
        scale: 0.2,
        alpha: 0,
        duration: 420,
        easing: "easeInCubic",
        complete: function () {
          api.cancel();
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

  // ---------- RENDER HOOK ----------
  // called from BlockRender.renderFrame each frame
  api.render = function (ctx, grid) {
    var st = api._state;
    var target = api._target;
    if (!target || !st.rig.alpha) return;

    var p = window.IsoGrid.worldToScreen(target.col, target.row);
    var cx = p.x, cy = p.y;
    var iso = grid.isoSize, half = iso / 2;

    ctx.save();

    // camera shake translation
    if (st.camera.x || st.camera.y) ctx.translate(st.camera.x, st.camera.y);

    // ---- SELECTION PREVIEW (drag rectangle) ----
    if (api._selectionStart && api._selectionEnd && !api._selectionConfirmed) {
      var p1 = api._selectionStart;
      var p2 = api._selectionEnd;
      var x = Math.min(p1.x, p2.x);
      var y = Math.min(p1.y, p2.y);
      var w = Math.abs(p2.x - p1.x);
      var h = Math.abs(p2.y - p1.y);
      
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "#E8604A";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x, y, w, h);
      // fill with very subtle color
      ctx.fillStyle = "rgba(232, 96, 74, 0.08)";
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

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

  // ---------- RIG DRAWING (concept shapes) ----------
  function drawRig(ctx, cx, cy, iso, half, scale) {
    var st = api._state;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // base: tracked with hazard chevrons
    var baseW = iso * 1.4, baseH = iso * 0.35;
    var baseY = iso * 0.15;
    ctx.fillStyle = "#2B2320";
    ctx.fillRect(-baseW / 2, baseY, baseW, baseH);
    // hazard chevrons
    ctx.fillStyle = "#F2B705";
    for (var i = -2; i <= 2; i++) {
      var cx_ = i * (baseW / 4);
      ctx.beginPath();
      ctx.moveTo(cx_ - 6, baseY);
      ctx.lineTo(cx_ + 6, baseY);
      ctx.lineTo(cx_ + 2, baseY - 10);
      ctx.lineTo(cx_ - 2, baseY - 10);
      ctx.closePath();
      ctx.fill();
    }

    // mast
    var mastH = iso * 2.2, mastW = 6;
    ctx.fillStyle = "#7C7C74";
    ctx.fillRect(-mastW / 2, -iso * 2.4, mastW, mastH);
    ctx.strokeStyle = "#2B2320";
    ctx.lineWidth = 2;
    ctx.strokeRect(-mastW / 2, -iso * 2.4, mastW, mastH);

    // beacon at mast top
    ctx.beginPath();
    ctx.arc(0, -iso * 2.4 - 4, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#E0483A";
    ctx.fill();

    // boom
    var boomL = iso * 1.8, boomH = 8;
    ctx.save();
    ctx.rotate(-0.35);
    ctx.fillStyle = "#7C7C74";
    ctx.fillRect(0, -boomH / 2, boomL, boomH);
    ctx.strokeStyle = "#2B2320";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, -boomH / 2, boomL, boomH);
    ctx.restore();

    // cable line
    var cableX = Math.cos(-0.35) * boomL * 0.95;
    var cableY = -iso * 2.4 + Math.sin(-0.35) * boomL * 0.95;
    ctx.strokeStyle = "#4A4A45";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cableX, cableY);
    ctx.lineTo(cableX, cableY + 60); // cable down to tamper
    ctx.stroke();

    // tamper weight
    var tamperY = cableY + 60 + st.tamper.y;
    var tw = iso * 0.9, th = iso * 0.5;
    ctx.fillStyle = "#8A97A0"; // top
    ctx.fillRect(cableX - tw / 2, tamperY - th / 2, tw, th);
    // sides shaded
    ctx.fillStyle = "#6F8296"; // left
    ctx.beginPath();
    ctx.moveTo(cableX - tw / 2, tamperY - th / 2);
    ctx.lineTo(cableX - tw / 2 + 8, tamperY - th / 2 - 8);
    ctx.lineTo(cableX - tw / 2 + 8, tamperY + th / 2 - 8);
    ctx.lineTo(cableX - tw / 2, tamperY + th / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#4D5D6D"; // right
    ctx.beginPath();
    ctx.moveTo(cableX + tw / 2, tamperY - th / 2);
    ctx.lineTo(cableX + tw / 2 - 8, tamperY - th / 2 - 8);
    ctx.lineTo(cableX + tw / 2 - 8, tamperY + th / 2 - 8);
    ctx.lineTo(cableX + tw / 2, tamperY + th / 2);
    ctx.closePath();
    ctx.fill();

    // tamper hazard chevron band
    ctx.fillStyle = "#F2B705";
    for (var i = -1; i <= 1; i++) {
      var tx_ = cableX + i * (tw / 3);
      ctx.beginPath();
      ctx.moveTo(tx_ - 5, tamperY - th / 2);
      ctx.lineTo(tx_ + 5, tamperY - th / 2);
      ctx.lineTo(tx_ + 1, tamperY - th / 2 - 8);
      ctx.lineTo(tx_ - 1, tamperY - th / 2 - 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  return api;
})();