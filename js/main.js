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
    var el = document.getElementById("hud-cash");
    if (el) {
      el.textContent = "$" + window.GameState.cash.toLocaleString();
    }
    var btn = document.getElementById("hud-build-btn");
    if (btn) btn.disabled = window.GameState.hqBuilt;
    if (window.BuildMenu && window.BuildMenu.refresh) window.BuildMenu.refresh();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
  };

  // click: pop the block up/down AND toggle the info panel.
  // HQ tiles never show the small tile popup — they open the full HQ terminal.
  function onTileClicked(col, row) {
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
  function loop() {
    try {
      window.BlockRender.tick();
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

    // initialize gameState cash display
    window.GameState.cash = 50000;
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
        if (!window.GameState.hqBuilt) {
          window.BuildMenu.toggle();
        }
      });
    }

    // Stop button for compactor/zoning placement mode
    var stopBtn = document.getElementById("hud-stop-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        if (window.CompactorTool) window.CompactorTool.cancel();
        if (window.ZoningTool) window.ZoningTool.cancel();
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
  };

  return api;
})();

window.addEventListener("load", function () {
  window.Main.init();
});
