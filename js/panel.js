/* js/panel.js — glassmorphism popup: content + CSS-transition slide in/out.
 * The popup lives in the DOM (HTML/CSS), so all animation is scoped to the
 * popup element alone (CSS transform only) — the canvas is never moved.
 * Sliding is a GPU-composited CSS transition (no Anime.js per-frame
 * tweening), which stays snappy even on slow mobile devices.
 */

window.TilePanel = (function () {
  var SHOW_DUR = "0.16s";
  var HIDE_DUR = "0.14s";
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

  // position the panel:                  animate      -> CSS transition slide
  //                                      jump         -> instant (no transition)
  api._setPos = function (x, animate, dur, easing) {
    if (animate) {
      api.panel.style.transition = "transform " + dur + " " + easing;
    } else {
      api.panel.style.transition = "none";
    }
    api.panel.style.transform = "translateX(" + x + "px)";
  };

  // cancel a pending hide completion (transitionend + safety timeout)
  api._clearHideEnd = function () {
    if (api._animEnded) {
      api.panel.removeEventListener("transitionend", api._animEnded);
      api._animEnded = null;
    }
    if (api._hideTimer) {
      clearTimeout(api._hideTimer);
      api._hideTimer = null;
    }
  };

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
    api._setPos(api._offscreenX(), false);
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
      var isMobile = window.MobileUI && window.MobileUI.enabled;
      api.placeholderEl.textContent = isMobile
        ? "NO DATA — BUILD HQ"
        : "NO DATA AVAILABLE — CONTECH HQ NOT YET CONSTRUCTED";
      api.placeholderEl.style.display = "";
      api.hqContent.style.display = "none";
    }
  };

  api.isSameTile = function (col, row) {
    return api.currentTile && api.currentTile.col === col && api.currentTile.row === row && api.isHQ === (window.Terrain && window.Terrain.isHQ(col, row));
  };

// slide the panel in to the right of the viewport (CSS transition)
  // On mobile: fade in at bottom-left (no slide across the map).
  api.show = function (col, row) {
    if (!api.panel) return;
    api._clearHideEnd();
    clearTimeout(api._autoCloseTimer);
    var isHQ = window.Terrain && window.Terrain.isHQ(col, row);
    api.setContent(col, row, isHQ);

    if (window.MobileUI && window.MobileUI.enabled) {
      // mobile: fade in at bottom-left, no slide
      api.panel.style.transition = "opacity 0.1s ease-out";
      api.panel.style.opacity = "0";
      api.panel.style.visibility = "visible";
      void api.panel.offsetWidth;
      api.panel.style.opacity = "1";
      api.isOpen = true;
      api._autoCloseTimer = setTimeout(function () {
        if (api.isOpen) api.hide();
      }, 3000);
    } else {
      // desktop: slide in from right
      api._setPos(api._offscreenX(), false);
      api.panel.style.visibility = "visible";
      void api.panel.offsetWidth;
      api._setPos(0, true, SHOW_DUR, "ease-out");
      api.isOpen = true;
    }
  };

// slide the panel out to the right, then fully hide (CSS transition)
  // On mobile: fade out (no slide).
  api.hide = function (onComplete) {
    if (!api.panel) return;
    clearTimeout(api._autoCloseTimer);
    api._clearHideEnd();

    if (window.MobileUI && window.MobileUI.enabled) {
      // mobile: quick fade out
      var done = false;
      api.panel.style.transition = "opacity 0.1s ease-in";
      api.panel.style.opacity = "0";
      setTimeout(function () {
        if (done) return;
        done = true;
        api.panel.style.visibility = "hidden";
        api.panel.style.opacity = "1";
        api.isOpen = false;
        api.currentTile = null;
        api.isHQ = false;
        if (typeof onComplete === "function") onComplete();
      }, 120);
    } else {
      // desktop: slide out to right
      var ended = false;
      api._animEnded = function () {
        if (ended) return;
        ended = true;
        api._clearHideEnd();
        api._setPos(api._offscreenX(), false);
        api.panel.style.visibility = "hidden";
        api.isOpen = false;
        api.currentTile = null;
        api.isHQ = false;
        if (typeof onComplete === "function") onComplete();
      };
      api.panel.addEventListener("transitionend", api._animEnded);
      api._hideTimer = setTimeout(api._animEnded, parseFloat(HIDE_DUR) * 1000 + 120);
      api._setPos(api._offscreenX(), true, HIDE_DUR, "ease-in");
    }
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
