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
      var refreshPanelBtn = function () {
        var purchased = !!(window.GameState && window.GameState.droneSystemPurchased);
        api.orderBtn.disabled = purchased;
        api.orderBtn.textContent = purchased ? "ORDERED" : "Order Drone";
      };
      refreshPanelBtn();
      // keep in sync if HQ purchase happens elsewhere
      setInterval(refreshPanelBtn, 400);
      api.orderBtn.addEventListener("click", function () {
        console.log("[ConTech HQ] Order Drone requested");
        var wasPurchased = !!(window.GameState && window.GameState.droneSystemPurchased);
        api.orderBtn.textContent = "Ordered!";
        api.orderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          var stillPurchased = !!(window.GameState && window.GameState.droneSystemPurchased);
          api.orderBtn.textContent = stillPurchased || wasPurchased ? "ORDERED" : "Order Drone";
          if (stillPurchased || wasPurchased) api.orderBtn.disabled = true;
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
    var bodyEl = api.panel.querySelector(".panel-body");

    if (isHQ) {
      if (titleEl) titleEl.textContent = "CONTECH HQ";
      api.placeholderEl.style.display = "none";
      api.hqContent.style.display = "";
      if (bodyEl) bodyEl.style.display = "";
      return;
    }

    if (titleEl) titleEl.textContent = "SITE INSPECTION";
    api.hqContent.style.display = "none";
    api.placeholderEl.style.display = "none";

    // real survey data from GameState.tileData (same model the HQ DATA tab
    // reads). Surface fields require an aerial Drone survey; subsurface
    // fields require a GPR pass — unscanned fields fall back to a prompt.
    var d = (window.GameState && window.GameState.getTileData)
      ? window.GameState.getTileData(col, row)
      : null;
    var ND = "Not yet scanned";
    var catLabel = "Unscanned";
    var catColor = "#E0E0DA";
    if (d) {
      var catMap = {
        "Partial Data": ["Partial Data", "#FFE082"],
        "Unsuitable": ["Unsuitable", "#EF5350"],
        "Commercial": ["Commercial", "#42A5F5"],
        "Residential": ["Residential", "#66BB6A"],
        "Industrial": ["Industrial", "#8D6E63"],
        "Mining": ["Mining", "#FFB300"]
      };
      var mapped = catMap[d.bestUse] || null;
      if (mapped) { catLabel = mapped[0]; catColor = mapped[1]; }
    }

    var rows = [
      { label: "SURFACE STABILITY", value: (d && d.droneScanned) ? d.surfaceStability : ND },
      { label: "SOIL TYPE", value: (d && d.gprScanned) ? d.soilType : ND },
      { label: "MINERAL DEPOSITS", value: (d && d.gprScanned) ? d.mineralDeposits : ND },
      { label: "BEDROCK DEPTH", value: (d && d.gprScanned) ? d.bedrockDepth : ND },
      { label: "BEST USE", value: catLabel, badge: catColor }
    ];

    if (bodyEl) {
      bodyEl.style.display = "";
      bodyEl.innerHTML = rows.map(function (r) {
        var valueHtml = r.badge
          ? '<span class="panel-data-value panel-data-badge" style="background:' + r.badge + '">' + r.value + '</span>'
          : '<span class="panel-data-value">' + r.value + '</span>';
        return '<div class="panel-data-row">' +
          '<span class="panel-data-label">' + r.label + '</span>' + valueHtml +
        '</div>';
      }).join("");
      if (typeof anime !== "undefined" && anime) {
        anime.set(bodyEl.querySelectorAll(".panel-data-row"), { opacity: 0, translateX: -10 });
        anime({
          targets: bodyEl.querySelectorAll(".panel-data-row"),
          opacity: [0, 1],
          translateX: [-10, 0],
          delay: anime.stagger(45),
          duration: 320,
          easing: "easeOutCubic",
        });
      } else {
        var _rows = bodyEl.querySelectorAll(".panel-data-row");
        for (var i = 0; i < _rows.length; i++) { _rows[i].style.opacity = "1"; _rows[i].style.transform = "translateX(0)"; }
      }
    }
  };

  api.isSameTile = function (col, row) {
    var hqNow = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) ||
                (window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === col && window.GameState.hqTile.row === row);
    return api.currentTile && api.currentTile.col === col && api.currentTile.row === row && api.isHQ === hqNow;
  };

  api.show = function (col, row) {
    if (!api.panel) return;
    // HQ tiles have their own full-screen terminal — never show the small tile popup for them.
    var isHQ = (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(col, row)) ||
               (window.GameState && window.GameState.hqTile && window.GameState.hqTile.col === col && window.GameState.hqTile.row === row);
    if (isHQ) {
      if (window.HqPanel) {
        if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
        window.BlockRender && window.BlockRender.setSelected && window.BlockRender.setSelected(col, row);
        window.HqPanel.open();
      }
      return;
    }
    api._clearHideEnd();
    clearTimeout(api._autoCloseTimer);
    api.setContent(col, row, false);

    if (window.MobileUI && window.MobileUI.enabled) {
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
      api._setPos(api._offscreenX(), false);
      api.panel.style.visibility = "visible";
      api.panel.style.opacity = "1";
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
