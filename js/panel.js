/* js/panel.js — glassmorphism popup: content + Anime.js slide in/out.
 * The popup lives in the DOM (HTML/CSS), so all animation is scoped to the
 * popup element alone (CSS transform only) — the canvas is never moved.
 */

window.TilePanel = (function () {
  var SHOW_DUR = 220;
  var HIDE_DUR = 180;
  var MARGIN = 24; // right margin from the viewport edge (must match CSS)

  var api = {
    panel: null,
    coordsEl: null,
    placeholderEl: null,
    hqContent: null,
    closeBtn: null,
    orderBtn: null,
    isOpen: false,
    currentTile: null, // { col, row } | null
    isHQ: false,       // true when the tile shows a ConTech HQ
  };

  // animate translateX in pixels; fall back to instant set if Anime.js missing
  function slide(targetEl, toX, dur, easing, onComplete) {
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: targetEl,
        translateX: toX,
        duration: dur,
        easing: easing,
        complete: function () { if (typeof onComplete === "function") onComplete(); },
      });
    } else {
      targetEl.style.transform = "translateX(" + toX + "px)";
      if (typeof onComplete === "function") setTimeout(onComplete, 0);
    }
  }

  api.init = function () {
    api.panel = document.getElementById("tile-popup");
    api.coordsEl = document.getElementById("tile-coords");
    api.placeholderEl = document.getElementById("tile-placeholder");
    api.hqContent = document.getElementById("hq-content");
    api.closeBtn = api.panel.querySelector(".panel-close");
    api.orderBtn = document.getElementById("hq-order-drone");
    api.closeBtn.addEventListener("click", function () { api.toggle(); });
    if (api.orderBtn) {
      api.orderBtn.addEventListener("click", function () {
        console.log("[ConTech HQ] Order Drone requested");
        api.orderBtn.textContent = "Ordered!";
        api.orderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          api.orderBtn.textContent = "Order Drone";
          api.orderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      });
    }
    api._placeHidden(); // start off-screen right, invisible
  };

  api._offscreenX = function () {
    return (api.panel.offsetWidth || 320) + MARGIN;
  };

  // position off-screen to the right and hide (no animation)
  api._placeHidden = function () {
    api.panel.style.visibility = "hidden";
    api.panel.style.transform = "translateX(" + api._offscreenX() + "px)";
  };

  api.setContent = function (col, row, isHQ) {
    api.coordsEl.textContent = "Tile: " + col + ", " + row;
    api.currentTile = { col: col, row: row };
    api.isHQ = isHQ;
    var titleEl = api.panel.querySelector(".panel-title");
    if (isHQ) {
      if (titleEl) titleEl.textContent = "CONTECH HQ";
      api.placeholderEl.style.display = "none";
      api.hqContent.style.display = "";
    } else {
      if (titleEl) titleEl.textContent = "SITE INSPECTION";
      api.placeholderEl.textContent = "NO DATA AVAILABLE — CONTECH HQ NOT YET CONSTRUCTED";
      api.placeholderEl.style.display = "";
      api.hqContent.style.display = "none";
    }
  };

  api.isSameTile = function (col, row) {
    return api.currentTile && api.currentTile.col === col && api.currentTile.row === row && api.isHQ === (window.Terrain && window.Terrain.isHQ(col, row));
  };

  // animate the panel in to the right of the viewport
  api.show = function (col, row) {
    var isHQ = window.Terrain && window.Terrain.isHQ(col, row);
    api.setContent(col, row, isHQ);
    api.panel.style.visibility = "visible";
    api.panel.style.transform = "translateX(" + api._offscreenX() + "px)";
    slide(api.panel, 0, SHOW_DUR, "easeOutCubic");
    api.isOpen = true;
  };

  // animate the panel out to the right, then fully hide
  api.hide = function (onComplete) {
    slide(
      api.panel,
      api._offscreenX(),
      HIDE_DUR,
      "easeInCubic",
      function () {
        api.panel.style.visibility = "hidden";
        api.isOpen = false;
        api.currentTile = null;
        api.isHQ = false;
        if (typeof onComplete === "function") onComplete();
      }
    );
  };

  // toggle strategy:
  //   - not open        -> open for (col,row)
  //   - open, same tile -> close (toggle off)
  //   - open, other tile -> close then open for (col,row) (swap, not stack)
  //   - no args         -> explicit close (X button)
  api.toggle = function (col, row) {
    if (col == null) {
      if (api.isOpen) api.hide();
      return;
    }
    if (!api.isOpen) {
      api.show(col, row);
    } else if (api.isSameTile(col, row)) {
      api.hide();
    } else {
      api.hide(function () { api.show(col, row); });
    }
  };

  return api;
})();
