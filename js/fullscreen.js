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

  var btns = [];

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
    btns.forEach(function (b) {
      var ex = b.querySelector(".fs-icon-expand");
      var co = b.querySelector(".fs-icon-compress");
      if (ex) ex.style.display = api.active ? "none" : "";
      if (co) co.style.display = api.active ? "" : "none";
    });
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
    // both toggles: the in-game corner button and the one inside the title
    // screen (whichever is visible; both stay in sync)
    btns = Array.prototype.slice.call(
      document.querySelectorAll("#fs-btn, #site-fs-btn"));
    if (!btns.length) return;
    docEl = document.documentElement;

    // resolve vendor-prefixed API
    enterFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen ||
              docEl.msRequestFullscreen || null;
    exitFS = document.exitFullscreen || document.webkitExitFullscreen ||
             document.msExitFullscreen || null;

    // hide the buttons entirely if fullscreen is completely unsupported
    // (e.g. iPhone Safari) — neither context gets a dead control
    if (!enterFS) {
      btns.forEach(function (b) { b.style.display = "none"; });
      return;
    }

    btns.forEach(function (b) { b.addEventListener("click", toggle); });

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
