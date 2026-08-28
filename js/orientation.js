/* js/orientation.js — mobile shell for Site Sight: landscape lock attempt +
 * portrait fallback overlay. Pure page-shell code: does not touch game
 * logic, input, terrain, HQ or drone systems.
 *
 * Goal: a touch/mobile device in portrait shows a full-screen "rotate your
 * device" overlay that blocks interaction with the game underneath. Desktop
 * (non-touch) devices NEVER see the overlay, no matter how tall the window.
 *
 * The screen.orientation.lock('landscape') call is a BEST-EFFORT attempt
 * only — it is not supported everywhere (notably iOS Safari, and it requires
 * the page to be fullscreen). Both the call itself and its returned Promise
 * rejection are swallowed silently; the overlay (keyed off matchMedia
 * orientation + coarse-pointer/touch detection) is the real guarantee.
 */

window.Orientation = (function () {
  var api = {
    overlay: null,
    shown: false,
    isTouch: false,
  };

  // strict device gating: only real touch/coarse-pointer devices qualify —
  // a narrow desktop window must never trigger the overlay.
  function isTouchDevice() {
    if (typeof navigator === "undefined") return false;
    if (navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia) {
      if (window.matchMedia("(pointer: coarse)").matches) return true;
      if (window.matchMedia("(any-pointer: coarse)").matches) return true;
    }
    return false;
  }

  function isPortrait() {
    if (window.matchMedia) {
      if (window.matchMedia("(orientation: portrait)").matches) return true;
    }
    return (window.innerHeight || 0) > (window.innerWidth || 0);
  }

  // should the rotate overlay be visible right now?
  api.shouldShow = function () {
    return api.isTouch && isPortrait();
  };

  // reflect the current orientation state on the overlay (idempotent).
  api.refresh = function () {
    if (!api.overlay) return;
    var show = api.shouldShow();
    api.overlay.style.display = show ? "flex" : "none";
    api.shown = show;
  };

  api.init = function () {
    api.overlay = document.getElementById("rotate-overlay");
    if (!api.overlay) return;
    api.isTouch = isTouchDevice();

    // touch-only "Enter Site Sight" button: best-effort landscape lock.
    // Unsupported browsers (iOS Safari / non-fullscreen pages) just see the
    // button switch to a "Rotate manually" hint; never an uncaught error.
    // file:// is not a secure context — orientation lock is unavailable there
    // and would log an 'Unsafe attempt' error in the console.
    var isFile = (location.protocol === 'file:');
    var enterBtn = document.getElementById("rotate-enter-btn");
    if (enterBtn) {
      enterBtn.addEventListener("click", function () {
        if (isFile) { enterBtn.textContent = "Rotate manually"; return; }
        if (window.screen && window.screen.orientation &&
            typeof window.screen.orientation.lock === "function") {
          try {
            var p = window.screen.orientation.lock("landscape");
            if (p && typeof p.catch === "function") {
              p.catch(function () { enterBtn.textContent = "Rotate manually"; });
            }
          } catch (e) {
            enterBtn.textContent = "Rotate manually";
          }
        } else {
          enterBtn.textContent = "Rotate manually";
        }
      });
    }

    // best-effort landscape lock. Must fail silently on browsers that do not
    // support it (iOS Safari / non-fullscreen pages) — never an uncaught
    // error, never a broken page.
    if (!isFile && window.screen && window.screen.orientation &&
        typeof window.screen.orientation.lock === "function") {
      try {
        var p = window.screen.orientation.lock("landscape");
        if (p && typeof p.catch === "function") {
          p.catch(function () { /* unsupported: the fallback overlay handles it */ });
        }
      } catch (e) { /* ignore: lock is best-effort only */ }
    }

    // react to rotations through every channel browsers offer:
    // 1) the legacy 'orientationchange' event (with a short settle delay,
    //    since some mobile browsers resize the layout asynchronously)
    window.addEventListener("orientationchange", function () {
      setTimeout(api.refresh, 100);
    });

    // 2) a matchMedia '(orientation: portrait)' listener as a fallback where
    //    orientationchange is not reliable (per-modern-API guidance)
    if (window.matchMedia) {
      var mq = window.matchMedia("(orientation: portrait)");
      var onChange = function () { api.refresh(); };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(onChange); // legacy Safari / older engines
      }
    }

    api.refresh();
  };

  return api;
})();

// self-init once the DOM exists (script is loaded at the end of <body>, so
// this is usually immediate)
(function () {
  function boot() {
    window.Orientation.init();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();