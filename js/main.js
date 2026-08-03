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
    var dpr = window.devicePixelRatio || 1;
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

  api.updateHUD = function () {
    var el = document.getElementById("hud-cash");
    if (el) {
      el.textContent = "$" + window.GameState.cash.toLocaleString();
    }
    var btn = document.getElementById("hud-build-btn");
    if (btn) btn.disabled = window.GameState.hqBuilt;
    if (window.BuildMenu && window.BuildMenu.refresh) window.BuildMenu.refresh();
  };

  // click: pop the block up/down AND toggle the info panel (as before)
  function onTileClicked(col, row) {
    window.BlockRender.setSelected(col, row);
    window.TilePanel.toggle(col, row);
    render();
  }

  // panning moves the camera, so the cached scene must be rebuilt
  function onPan() {
    window.BlockRender.redrawStatic();
  }

  function loop() {
    window.BlockRender.tick();
    render();
    rafId = requestAnimationFrame(loop);
  }

  api.init = function () {
    api.canvas = document.getElementById("game-canvas");
    api.ctx = api.canvas.getContext("2d");
    api.grid = window.IsoGrid;

    window.BlockRender.init(api.ctx, api.grid, window.Terrain);

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

    window.addEventListener("resize", onResize);
    window.InputHandler.init(api.canvas, api.grid, onTileClicked, onPan, window.Terrain);
    window.TilePanel.init();
    window.HqPanel.init();
    window.BuildMenu.init();

    onResize();
    loop();
  };

  return api;
})();

window.addEventListener("load", function () {
  window.Main.init();
});
