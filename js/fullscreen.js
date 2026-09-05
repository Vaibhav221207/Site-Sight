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
    if (!docEl) { note("no docEl"); return; }
    if (isFullscreen()) {
      if (exitFS) {
        try { exitFS.call(document); }
        catch (e) { note("exit threw: " + e.message); }
      } else {
        note("no exit API");
      }
    } else {
      if (!enterFS) { note("no enter API @" + location.protocol); return; }
      try {
        var p = enterFS.call(docEl);
        if (p && typeof p.then === "function") {
          p.then(function () { tryLockLandscape(); })
           .catch(function (err) {
             note("enter rejected: " + (err && err.name) + " @" + location.protocol);
           });
        } else {
          // older browsers return undefined — lock after a short delay
          setTimeout(tryLockLandscape, 300);
        }
      } catch (e) { note("enter threw: " + e.message); }
    }
  }

  // visible diagnostics: any fullscreen failure shows a transient message
  // (console-only would be invisible to players filing "it doesn't work")
  function note(msg) {
    try { console.warn("[Fullscreen] " + msg); } catch (e) {}
    try {
      var el = document.getElementById("debug-overlay");
      if (!el) return;
      el.style.display = "block";
      el.style.background = "rgba(200,30,30,0.95)";
      el.textContent = "FULLSCREEN: " + msg;
      setTimeout(function () {
        try {
          if (el.textContent.indexOf("FULLSCREEN:") === 0) el.style.display = "none";
        } catch (e2) {}
      }, 2600);
    } catch (e) {}
  }

  // pointerdown-first activation: if click synthesis ever breaks while the
  // press itself lands, the toggle still fires. Guarded against double-fire.
  var lastPointerToggle = 0;
  function onPointerDown() {
    lastPointerToggle = Date.now();
    toggle();
  }
  function onClick() {
    try {
      if (Date.now() - lastPointerToggle < 600) return;
    } catch (e) {}
    toggle();
  }
  function bindBtn(b) {
    b.addEventListener("click", onClick);
    b.addEventListener("pointerdown", onPointerDown);
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

    btns.forEach(bindBtn);

    // keep the icon in sync even if the user exits via a system gesture
    // (e.g. iOS swipe-down) rather than the button
    document.addEventListener("fullscreenchange", syncIcon);
    document.addEventListener("webkitfullscreenchange", syncIcon);
    document.addEventListener("MSFullscreenChange", syncIcon);

    syncIcon();
    // Ensure the universal button is present and visible
    api.ensureButton();
  };

  // Ensure the universal button stays in the DOM and visible
  api.ensureButton = function () {
    var btn = document.getElementById('fs-btn');
    if (!btn) {
      // Re-create the universal button if it was removed
      btn = document.createElement('button');
      btn.id = 'fs-btn';
      btn.className = 'fs-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Toggle fullscreen');
      btn.innerHTML = '<svg class="fs-icon-expand" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg><svg class="fs-icon-compress" viewBox="0 0 24 24" aria-hidden="true" style="display:none"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg><span class="fs-label">FULLSCREEN</span>';
      document.body.appendChild(btn);
      bindBtn(btn);
    }
    // Ensure it's visible and on top
    btn.style.display = 'flex';
    btn.style.opacity = '1';
    btn.style.visibility = 'visible';
    btn.style.zIndex = '20000';
    // Re-sync icon
    syncIcon();
  };

  // Watch for removal and auto-restore
  if (window.MutationObserver) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.removedNodes.forEach(function(node) {
          if (node.id === 'fs-btn' || (node.querySelector && node.querySelector('#fs-btn'))) {
            // Universal button was removed, restore it
            setTimeout(api.ensureButton, 0);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Also observe the title screen area
    var startScreen = document.getElementById('start-screen');
    if (startScreen) {
      observer.observe(startScreen, { childList: true, subtree: true });
    }
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
