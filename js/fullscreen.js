/* js/fullscreen.js — fullscreen toggle for Site Sight.
 *
 * A small icon button (top-left corner) lets the user enter/exit
 * fullscreen on both desktop and mobile. After entering fullscreen,
 * a best-effort landscape orientation lock is attempted (fullscreen
 * is often a prerequisite for orientation lock on iOS/Android).
 *
 * The button icon flips between expand/compress in sync with the
 * actual fullscreen state, including system-gesture exits.
 */

window.Fullscreen = (function () {
  var api = { active: false };

  var btn = null;
  var iconExpand = null;
  var iconCompress = null;

  // vendor-prefixed API surfaces
  var docEl = null;
  var enterFS = null;
  var exitFS = null;

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement ||
              document.msFullscreenElement);
  }

  function syncIcon() {
    api.active = isFullscreen();
    if (iconExpand) iconExpand.style.display = api.active ? "none" : "";
    if (iconCompress) iconCompress.style.display = api.active ? "" : "none";
  }

  function tryLockLandscape() {
    if (location.protocol === 'file:') return; // not a secure context on file://
    if (window.screen && window.screen.orientation &&
        typeof window.screen.orientation.lock === "function") {
      try {
        var p = window.screen.orientation.lock("landscape");
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) { /* best-effort only */ }
    }
  }

  function toggle() {
    if (!docEl) return;
    if (isFullscreen()) {
      if (exitFS) {
        try { exitFS.call(document); } catch (e) { /* ignore */ }
      }
    } else {
      if (enterFS) {
        try {
          var p = enterFS.call(docEl);
          if (p && typeof p.then === "function") {
            p.then(function () { tryLockLandscape(); }).catch(function () {});
          } else {
            // older browsers return undefined — lock after a short delay
            setTimeout(tryLockLandscape, 300);
          }
        } catch (e) { /* ignore: unsupported context */ }
      }
    }
  }

  api.init = function () {
    btn = document.getElementById("fs-btn");
    if (!btn) return;
    docEl = document.documentElement;
    iconExpand = btn.querySelector(".fs-icon-expand");
    iconCompress = btn.querySelector(".fs-icon-compress");

    // resolve vendor-prefixed API
    enterFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen ||
              docEl.msRequestFullscreen || null;
    exitFS = document.exitFullscreen || document.webkitExitFullscreen ||
             document.msExitFullscreen || null;

    // hide the button entirely if fullscreen is completely unsupported
    if (!enterFS) {
      btn.style.display = "none";
      return;
    }

    btn.addEventListener("click", toggle);

    // keep the icon in sync even if the user exits via a system gesture
    // (e.g. iOS swipe-down) rather than the button
    document.addEventListener("fullscreenchange", syncIcon);
    document.addEventListener("webkitfullscreenchange", syncIcon);
    document.addEventListener("MSFullscreenChange", syncIcon);

    syncIcon();
  };

  return api;
})();

// self-init
(function () {
  function boot() { window.Fullscreen.init(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
