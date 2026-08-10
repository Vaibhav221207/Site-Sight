/* js/mobileUI.js — touch interaction layer for Site Sight.
 *
 * Activates ONLY on real touch devices (coarse pointer or multi-touch):
 *   - replaces the bottom HUD bar with a compact right-edge sidebar rail
 *     (CASH chip and Build button)
 *   - panning is direct touch-drag on the canvas (Pointer Events in
 *     input.js); no button-based controls exist anymore
 *   - wiring is class-gated (body.touch-ui) so desktop is completely
 *     untouched; the rail sits under every popup/modal in z-order and
 *     becomes inert while an overlay is open.
 */

window.MobileUI = (function () {
  var api = {
    enabled: false,
  };

  function isTouchDevice() {
    if (typeof navigator === "undefined") return false;
    if (navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia) {
      if (window.matchMedia("(pointer: coarse)").matches) return true;
      if (window.matchMedia("(any-pointer: coarse)").matches) return true;
    }
    return false;
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

    ui.appendChild(rail);
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