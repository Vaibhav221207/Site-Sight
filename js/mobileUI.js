/* js/mobileUI.js — touch interaction layer for Site Sight.
 *
 * Activates ONLY on real touch devices (coarse pointer or multi-touch):
 *   - replaces the bottom HUD bar with a compact right-edge sidebar rail
 *     (CASH chip, Build button, DRONES chip)
 *   - adds a hold-to-pan D-pad for camera control
 *   - wiring is class-gated (body.touch-ui) so desktop is completely
 *     untouched; the rail/dpad sit under every popup/modal in z-order and
 *     become inert while an overlay is open.
 */

window.MobileUI = (function () {
  var api = {
    enabled: false,
  };

  var PAN_SPEED = 8; // px per tick
  var TICK_MS = 16;

  function isTouchDevice() {
    if (typeof navigator === "undefined") return false;
    if (navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia) {
      if (window.matchMedia("(pointer: coarse)").matches) return true;
      if (window.matchMedia("(any-pointer: coarse)").matches) return true;
    }
    return false;
  }

  // ---- hold-to-pan D-pad -------------------------------------------------
  var panTimer = null;
  var panVec = { x: 0, y: 0 };

  function startPan(dir) {
    panVec.x = 0;
    panVec.y = 0;
    if (dir === "up") panVec.y = -1;
    else if (dir === "down") panVec.y = 1;
    else if (dir === "left") panVec.x = -1;
    else if (dir === "right") panVec.x = 1;
    if (panTimer != null) return; // already panning
    panTimer = setInterval(function () {
      window.IsoGrid.camera.x += panVec.x * PAN_SPEED;
      window.IsoGrid.camera.y += panVec.y * PAN_SPEED;
      // same redraw path the drag-pan uses (rebuilds the cached scene)
      if (window.InputHandler && typeof window.InputHandler.onPan === "function") {
        window.InputHandler.onPan();
      }
    }, TICK_MS);
  }

  function stopPan() {
    if (panTimer != null) {
      clearInterval(panTimer);
      panTimer = null;
    }
    panVec.x = 0;
    panVec.y = 0;
  }

  // ---- construction ------------------------------------------------------
  function buildTouchUI() {
    var ui = document.createElement("div");
    ui.id = "mobile-ui";

    var rail = document.createElement("aside");
    rail.className = "mu-sidebar";
    rail.setAttribute("aria-label", "Site controls");

    var cash = document.createElement("div");
    cash.className = "mu-chip";
    var cashLabel = document.createElement("span");
    cashLabel.className = "mu-label";
    cashLabel.textContent = "CASH";
    var cashVal = document.createElement("span");
    cashVal.id = "mu-cash";
    cashVal.className = "mu-value";
    cash.appendChild(cashLabel);
    cash.appendChild(cashVal);
    rail.appendChild(cash);

    var build = document.createElement("button");
    build.type = "button";
    build.id = "mu-build";
    build.className = "mu-btn";
    build.textContent = "Build";
    rail.appendChild(build);

    var drones = document.createElement("div");
    drones.className = "mu-chip";
    var droneLabel = document.createElement("span");
    droneLabel.className = "mu-label";
    droneLabel.textContent = "DRONES";
    var droneVal = document.createElement("span");
    droneVal.id = "mu-drones";
    droneVal.className = "mu-value";
    drones.appendChild(droneLabel);
    drones.appendChild(droneVal);
    rail.appendChild(drones);

    var dpad = document.createElement("div");
    dpad.className = "mu-dpad";
    dpad.setAttribute("aria-label", "Pan controls");
    var dirs = [
      { dir: "up", glyph: "\u25B2" },
      { dir: "left", glyph: "\u25C0" },
      { dir: "right", glyph: "\u25B6" },
      { dir: "down", glyph: "\u25BC" },
    ];
    for (var i = 0; i < dirs.length; i++) {
      (function (d) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mu-dpad-btn";
        btn.dataset.dir = d.dir;
        btn.textContent = d.glyph;
        btn.setAttribute("aria-label", "Pan " + d.dir);
        btn.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          startPan(d.dir);
        });
        btn.addEventListener("pointerup", stopPan);
        btn.addEventListener("pointerleave", stopPan);
        btn.addEventListener("pointercancel", stopPan);
        // non-PointerEvent fallback: touch events with the synthetic
        // click suppressed so the press is held, not a tap
        btn.addEventListener("touchstart", function (e) {
          e.preventDefault();
          startPan(d.dir);
        }, { passive: false });
        btn.addEventListener("touchend", stopPan);
        btn.addEventListener("touchcancel", stopPan);
        dpad.appendChild(btn);
      })(dirs[i]);
    }

    ui.appendChild(rail);
    ui.appendChild(dpad);
    document.body.appendChild(ui);

    // the Build button reuses the desktop toggle wiring (including the
    // placement-cancel path) with a plain programmatic click
    build.addEventListener("click", function () {
      var btn = document.getElementById("hud-build-btn");
      if (btn) btn.click();
    });
  }

  // ---- public API --------------------------------------------------------
  api.update = function () {
    if (!api.enabled) return;
    var cash = document.getElementById("mu-cash");
    if (cash) cash.textContent = "$" + (window.GameState.cash || 0).toLocaleString();
    var drones = document.getElementById("mu-drones");
    if (drones) drones.textContent = String(window.GameState.droneCount || 0);
    var build = document.getElementById("mu-build");
    if (build) build.disabled = !!(window.GameState.hqBuilt);
  };

  api.init = function () {
    if (api.enabled) return; // idempotent
    api.enabled = isTouchDevice();
    if (!api.enabled) return;
    document.body.classList.add("touch-ui");
    if (document.getElementById("mobile-ui")) return; // already built
    buildTouchUI();
    api.update();
  };

  // keep the D-pad from panning forever if the page dies mid-hold
  window.addEventListener("pagehide", stopPan);

  return api;
})();

// self-init once the DOM is ready
(function () {
  function boot() {
    window.MobileUI.init();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();