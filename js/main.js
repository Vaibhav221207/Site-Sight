/* js/main.js — app init, game loop, and wiring of all modules together.
 * The world renders as extruded 3D blocks (blockRender.js); isoGrid.js
 * supplies the tile <-> screen math. A continuous rAF loop drives the river
 * shimmer; the static scene is cached in an offscreen layer and only
 * rebuilt when the camera moves, the selection pops, or the window resizes.
 */

window.Main = (function () {
  var api = {
    canvas: null,
    ctx: null,
    grid: null,
  };
  var rafId = null;

  function render() {
    window.BlockRender.renderFrame(api.ctx);
  }

  function onResize() {
    // cap the backing resolution on high-DPR devices: full-screen fillrate
    // scales with dpr^2, so 3x canvas pixels is pure waste on small screens —
    // 2x stays crisp at a fraction of the pixel cost (biggest mobile win)
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth;
    var h = window.innerHeight;
    api.canvas.width = w * dpr;
    api.canvas.height = h * dpr;
    api.canvas.style.width = w + "px";
    api.canvas.style.height = h + "px";
    api.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    api.grid.resize(w, h);
    window.BlockRender.resize(w, h, dpr);
    render();
  }

  // exposed so the orientation/canvas-fit logic (or tests) can trigger a
  // re-fit directly; idempotent
  api.handleResize = onResize;

  api.updateHUD = function () {
    var cash = window.GameState.cash;
    var el = document.getElementById("hud-cash");
    var hq = document.getElementById("hq-cash");
    var last = (typeof api._lastCash === "number") ? api._lastCash : cash;
    api._lastCash = cash;
    function setCash(elm) {
      if (!elm) return;
      if (window.UI && window.UI.countUp && last !== cash) {
        // cash counts up so income/spend reads as motion, not a blink
        try { window.UI.countUp(elm, cash, { from: last, prefix: "$", group: true, duration: 400 }); return; }
        catch (e) {}
      }
      elm.textContent = "$" + cash.toLocaleString();
    }
    setCash(el);
    setCash(hq);
    // STORE affordability is cash-derived: keep red-when-broke live, even
    // mid-session while the panel sits open during income ticks
    if (window.HqPanel && window.HqPanel.refreshStoreAfford) {
      try { window.HqPanel.refreshStoreAfford(); } catch (e) {}
    }
    var btn = document.getElementById("hud-build-btn");
    if (btn) btn.disabled = false;
    if (window.BuildMenu && window.BuildMenu.refresh) window.BuildMenu.refresh();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
  };

  // click: pop the block up/down AND toggle the info panel.
  // HQ tiles never show the small tile popup — they open the full HQ terminal.
  function onTileClicked(col, row) {
    // unveiling tap eats the click: curtain (or HQ curtain) consumed, no
    // popup or panel on the reveal tap itself — celebration plays instead.
    if (window.Construction && window.Construction.reveal) {
      try {
        if (window.Construction.reveal(col, row)) { render(); return; }
      } catch (e) {}
    }
    var isHQ = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) ||
               (window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === col && window.GameState.hqTile.row === row);
    if (isHQ && window.HqPanel) {
      window.BlockRender.setSelected(col, row);
      if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
      window.HqPanel.open();
      render();
      return;
    }
    window.BlockRender.setSelected(col, row);
    window.TilePanel.toggle(col, row);
    render();
  }

  // panning moves the camera, so the cached scene must be rebuilt (once per
  // frame via tick() — never synchronously per pointer event, which would
  // stall the frame loop and make animations jank mid-drag)
  function onPan() {
    window.BlockRender.invalidate();
  }

  var _renderErrCount = 0;
  var _lastIncomeTick = 0;
  // economy clock: one income tick per TICK_MS of visible run time. rAF
  // already pauses in hidden tabs; on return the clock resets instead of
  // paying arrears (no windfall for being away — P3 save keeps it honest).
  function economyTick(now) {
    var TICK = (window.Economy && window.Economy.TICK_MS) || 10000;
    if (!_lastIncomeTick) { _lastIncomeTick = now; return; }
    if (now - _lastIncomeTick < TICK) return;
    _lastIncomeTick = now;
    if (!window.Economy || !window.GameState) return;
    var res = window.Economy.collectTick();
    if (res && res.earned > 0 && window.UI && window.UI.toast) {
      window.UI.toast("+$" + res.earned.toLocaleString() + " income", { icon: "\uD83D\uDCB0", duration: 1800 });
    }
    try { if (window.SaveSystem) window.SaveSystem.autosave(); } catch(e){}
  }
  function loop() {
    try {
      window.BlockRender.tick();
      try { if (window.Construction) window.Construction.update(); } catch (e) {}
      try { if (window.Hazards) window.Hazards.rollHazards(typeof performance !== "undefined" ? performance.now() : Date.now()); } catch (e) {}
      try { economyTick(typeof performance !== "undefined" ? performance.now() : Date.now()); } catch (e) {}
      render();
      if (_renderErrCount > 0) {
        // recovered — hide the transient bar after one clean frame
        var dbg2 = document.getElementById("debug-overlay");
        if (dbg2 && dbg2.textContent.indexOf("RENDER ERR:") === 0) {
          dbg2.style.display = "none";
          dbg2.textContent = "";
        }
        _renderErrCount = 0;
        loop._warned = false;
      }
    } catch (err) {
      _renderErrCount++;
      // Only surface the first persistent error; after that stay silent so
      // the console is never flooded (the loop keeps running regardless).
      if (_renderErrCount >= 2 && !loop._warned) {
        loop._warned = true;
        console.error("[Main] render frame error (suppressed to keep loop alive):", err);
        var dbg = document.getElementById("debug-overlay");
        if (dbg) {
          var full = err && err.message ? err.message : String(err);
          if (full.length > 90) full = full.slice(0, 87) + "...";
          dbg.style.display = "block"; dbg.style.background = "rgba(200,30,30,0.95)";
          dbg.textContent = "RENDER ERR: " + full + " | canvas " + (api.canvas ? api.canvas.width + "x" + api.canvas.height : "no-canvas");
        }
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  api.init = function () {
    try {
      api.canvas = document.getElementById("game-canvas");
      api.ctx = api.canvas.getContext("2d");
      if (!api.ctx) throw new Error("getContext 2d returned null");
      api.grid = window.IsoGrid;
      if (!api.grid) throw new Error("IsoGrid missing");
      if (!window.Terrain) throw new Error("Terrain missing");
      if (!window.BlockRender) throw new Error("BlockRender missing");

      window.BlockRender.init(api.ctx, api.grid, window.Terrain);
    } catch (err) {
      console.error("[Main.init] fatal:", err);
      var dbg = document.getElementById("debug-overlay");
      if (dbg) { dbg.style.display = "block"; dbg.style.background = "rgba(200,30,30,0.95)"; dbg.textContent = "INIT ERR: " + err.message; }
      throw err;
    }

    // GameState owns the startup budget. Do not reset cash here: doing so
    // makes re-initialization silently create money and breaks the ledger.
    window.Main.updateHUD();

    // wire up Build button: toggles the build palette (toggle bar). While a
    // building is being placed, clicking Build again cancels the placement.
    var buildBtn = document.getElementById("hud-build-btn");
    if (buildBtn) {
      buildBtn.addEventListener("click", function () {
        if (window.BuildMenu && window.BuildMenu.isPlacing()) {
          window.BuildMenu.cancel();
          return;
        }
        window.BuildMenu.toggle();
      });
    }

    // Stop button for compactor placement mode (zoning lives in the DATA
    // tab now — no placement mode, no Stop needed for it)
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        if (window.CompactorTool) window.CompactorTool.cancel();
      });
    }

    window.addEventListener("resize", onResize);
    // orientation flips change the viewport dimensions (esp. iPad/Android) —
    // re-fit the canvas so it re-fills and stays crisp under the new geometry
    window.addEventListener("orientationchange", onResize);
    // mobile browsers collapse/expand their chrome dynamically (URL bar).
    // The visual viewport reports the ACTUAL visible area, so any change there
    // re-fits the canvas too — never a stale layout height.
    if (window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
      window.visualViewport.addEventListener("resize", onResize);
    }
    // catch tab closures/switches for autosave
    document.addEventListener("visibilitychange", function() {
      if (document.hidden) {
        try { if (window.SaveSystem) window.SaveSystem.autosave(); } catch(e){}
      }
    });
    // each module init is isolated so one broken module cannot prevent canvas resize/loop
    function safeInit(name, fn) {
      try { fn(); } catch (err) {
        console.error("[Main.init] " + name + " failed:", err);
        window._siteSightErrors = window._siteSightErrors || [];
        window._siteSightErrors.push(name + ": " + (err.message || err));
        var dbg = document.getElementById("debug-overlay");
        if (dbg) { dbg.style.display = "block"; dbg.style.background = "rgba(200,30,30,0.95)"; dbg.textContent = "ERR: " + window._siteSightErrors.join(" | "); }
      }
    }
    safeInit("InputHandler", function () { window.InputHandler.init(api.canvas, api.grid, onTileClicked, onPan, window.Terrain); });
    safeInit("TilePanel", function () { window.TilePanel.init(); });
    safeInit("HqPanel", function () { window.HqPanel.init(); });
    safeInit("BuildMenu", function () { window.BuildMenu.init(); });
    safeInit("AudioManager", function () { if (window.AudioManager && window.AudioManager.init) window.AudioManager.init(); });
    safeInit("MobileUI", function () { if (window.MobileUI && window.MobileUI.init) window.MobileUI.init(); });

    try { onResize(); } catch (err) {
      console.error("[Main.init] onResize failed:", err);
      window._siteSightErrors = window._siteSightErrors || [];
      window._siteSightErrors.push("onResize: " + (err.message || err));
    }
    try { loop(); } catch (err) { console.error("[Main.init] loop failed:", err); }
    // surface diagnostics to debug-overlay (hidden unless broken, but logged)
    setTimeout(function () {
      try {
        var c = api.canvas;
        var info = "canvas " + c.width + "x" + c.height + " css " + c.clientWidth + "x" + c.clientHeight +
          " | iso " + Math.round(api.grid.isoSize) + " | layer " + (window.BlockRender.staticLayer ? window.BlockRender.staticLayer.width + "x" + window.BlockRender.staticLayer.height : "none") +
          " | dpr " + (window.devicePixelRatio || 1);
        console.log("[Main] post-init " + info);
        if (window._siteSightDebugShow) {
          var el = document.getElementById("debug-overlay");
          var bad = !c.width || !window.BlockRender.staticLayer || !window.BlockRender.staticLayer.width;
          if (bad || (window._siteSightErrors && window._siteSightErrors.length)) {
            window._siteSightDebugShow(info, !!bad);
          } else if (el) {
            el.textContent = info; el.dataset.info = info;
          }
        }
      } catch (e) { console.error("[Main] diag fail", e); }
    }, 600);
    // hazard demo for screenshots (#hazard or #shot=game_hazard) — plants 6 Kenney buildings with hazards
    (function(){
      try {
        if ((location.hash || "").indexOf("hazard") === -1) return;
        function plantHaz(){
          try {
            var gs = window.GameState; if (!gs || !window.Buildings) return;
            if (gs._hzPlanted) return;
            var hk = Object.keys(gs.tileData);
            for (var i=0;i<hk.length;i++) if (gs.tileData[hk[i]] && gs.tileData[hk[i]].hazard && gs.tileData[hk[i]].hazard.active) return;
            gs._hzPlanted = true;
            var ss = document.getElementById("start-screen"); if (ss) ss.classList.add("hidden");
            var tiles=[];
            for (var r=7;r<13;r++) for (var c=7;c<13;c++){
              if (window.Terrain && window.Terrain.typeAt(c,r)!=="land") continue;
              if (gs.tileData[c+","+r] && gs.tileData[c+","+r].zoneBuilding) continue;
              var ok=true;
              for (var k=0;k<tiles.length;k++){ if (Math.abs(tiles[k].c-c)+Math.abs(tiles[k].r-r) < 3) { ok=false; break; } }
              if (!ok) continue;
              tiles.push({c:c,r:r}); if (tiles.length>=6) break;
            }
            var ids=["shop","workshop","mall","mine","cottage","apartments"];
            var hazards=["Foundation Crack","Utility Fault","Sinkhole","Flood Risk","Contamination Leak","Structural Fatigue"];
            var kMap={shop:"buildingTiles_030.png",workshop:"buildingTiles_100.png",mall:"buildingTiles_090.png",mine:"buildingTiles_085.png",cottage:"buildingTiles_000.png",apartments:"buildingTiles_009.png"};
            for (var j=0;j<Math.min(tiles.length,ids.length);j++){
              var t=tiles[j], d=gs.getTileData(t.c,t.r);
              d.zoneType=(ids[j]==="workshop"||ids[j]==="factory")?"industrial":(ids[j]==="mine"||ids[j]==="quarry"?"mining":(ids[j]==="cottage"||ids[j]==="apartments"?"residential":"commercial"));
              d.zoneBuilding=ids[j]; d.buildingSprite=kMap[ids[j]]||null; d.pollution=(hazards[j]==="Contamination Leak"?70:0);
              d.surfaceStability="Poor"; d.zoneMismatched=true; d.hazard={active:true,type:hazards[j],triggeredAt:Date.now()};
              d.bestUse=d.zoneType.charAt(0).toUpperCase()+d.zoneType.slice(1);
            }
            if (window.BlockRender) window.BlockRender.invalidate();
            if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
            try{ if(window.HqPanel && window.HqPanel.close) window.HqPanel.close(); }catch(e){}
            try{ var ov=document.getElementById("hq-overlay"); if(ov) ov.style.display="none"; }catch(e){}
          } catch(e2){}
        }
        if (document.readyState==="complete") setTimeout(plantHaz,400);
        else window.addEventListener("load", function(){ setTimeout(plantHaz,800); });
        setTimeout(plantHaz,1500);
      } catch(e){}
    })();
  };

  return api;
})();

window.addEventListener("load", function () {
  window.Main.init();
});
