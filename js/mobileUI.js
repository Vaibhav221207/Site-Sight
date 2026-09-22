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

    var stop = document.createElement("button");
    stop.type = "button";
    stop.id = "mu-stop";
    stop.className = "mu-btn mu-btn--stop";
    stop.textContent = "Stop";
    stop.style.display = "none";
    rail.appendChild(stop);

    // mute toggle (same registry as the desktop HUD button via data-mute-btn)
    var mute = document.createElement("button");
    mute.type = "button";
    mute.className = "mu-btn";
    mute.setAttribute("data-mute-btn", "");
    mute.setAttribute("aria-label", "Mute sound");
    mute.setAttribute("aria-pressed", "false");
    mute.innerHTML = '<svg data-mute-on viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8a5 5 0 010 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 5.5a9 9 0 010 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<svg data-mute-off viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" hidden><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    mute.addEventListener("click", function () {
      if (window.AudioManager && window.AudioManager.toggleMute) window.AudioManager.toggleMute();
    });
    rail.appendChild(mute);

    ui.appendChild(rail);
    document.body.appendChild(ui);

    // the Build button reuses the desktop toggle wiring (including the
    // placement-cancel path) with a plain programmatic click
    build.addEventListener("click", function () {
      var mode = window.InputHandler && window.InputHandler.getMode
        ? window.InputHandler.getMode()
        : "idle";
      if (mode !== "idle") {
        if (mode === "compacting" && window.CompactorTool && window.CompactorTool.cancel) {
          window.CompactorTool.cancel();
        } else if (mode === "fixing-hazard" && window.RepairTool && window.RepairTool.cancel) {
          window.RepairTool.cancel();
        } else if (window.BuildMenu && window.BuildMenu.cancel) {
          window.BuildMenu.cancel();
        }
        api.update();
        return;
      }
      var btn = document.getElementById("hud-build-btn");
      if (btn) btn.click();
    });
    stop.addEventListener("click", function () {
      if (window.CompactorTool) window.CompactorTool.cancel();
      if (window.RepairTool) window.RepairTool.cancel();
    });
  }

  // ---- public API --------------------------------------------------------
  api.update = function () {
    if (!api.enabled) return;
    var cash = document.getElementById("mu-cash");
    if (cash) cash.textContent = "$" + (window.GameState.cash || 0).toLocaleString();
    var build = document.getElementById("mu-build");
    // Keep a one-tap escape hatch visible while a placement mode is active.
    if (build) {
      var mode = window.InputHandler && window.InputHandler.getMode
        ? window.InputHandler.getMode()
        : "idle";
      build.textContent = mode === "idle" ? "Build" : "Cancel";
      build.classList.toggle("mu-btn--stop", mode !== "idle");
      build.disabled = false;
      build.setAttribute("aria-label", mode === "idle" ? "Open build menu" : "Cancel placement");
    }
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