/* js/audioManager.js — Howler-driven SFX for Site Sight (additive only).
 * Assets: Kenney.nl CC0 packs (same trusted source as the Kenney building
 * sprites): Interface Sounds (UI/confirm/error) + Sci-Fi Sounds (tools).
 * Only the ~19 mapped files ship in assets/kenney-audio/ (~300KB total).
 *
 * Design decisions:
 * - Individual Howl instances (not sprites): each file is a 4-120KB blip,
 *   so sprites buy nothing and per-file Howls stay readable + cacheable.
 * - html5:true on every Howl: file:// pages block WebAudio XHR decode, but
 *   <audio> elements play local files fine — this keeps SFX working both on
 *   file:// (dev) and https (Pages). Slightly higher latency, inaudible here.
 * - Autoplay lock: play() no-ops until the first pointerdown/keydown unlocks
 *   audio. The first real trigger is the Enter Game click by construction.
 * - Mute persists in localStorage (siteSight_muted), independent of saves.
 * - Per-id throttle (80ms) so rapid chains (roads) can't machine-gun.
 */

window.AudioManager = (function () {
  "use strict";

  var MUTE_KEY = "siteSight_muted";
  var THROTTLE_MS = 80;
  // SimCity-level feel: identical samples sound robotic, so every play gets
  // a small random pitch shift (±5%). Same file, never quite the same hit.
  var PITCH_JITTER = 0.05;

  // id -> { file | files[], dir, volume }. SimCity/Cities-style direction:
  // everything sub-0.3s except rare moments; soft musical tones (plucks,
  // glass, bells) instead of arcade lasers; UI sits quiet underneath.
  // `files` arrays rotate randomly per play so frequent taps never drone.
  var SOUNDS = {
    uiClick:   { files: ["pluck_001.ogg", "pluck_002.ogg"], dir: "interface", volume: 0.35 },
    uiTab:     { file: "toggle_002.ogg",       dir: "interface", volume: 0.4 },
    uiOpen:    { file: "open_002.ogg",         dir: "interface", volume: 0.45 },
    uiClose:   { file: "close_001.ogg",        dir: "interface", volume: 0.45 },
    uiSelect:  { file: "select_001.ogg",       dir: "interface", volume: 0.45 },
    uiToggle:  { file: "toggle_001.ogg",       dir: "interface", volume: 0.45 },
    buy:       { file: "confirmation_001.ogg", dir: "interface", volume: 0.65 },
    error:     { file: "error_001.ogg",        dir: "interface", volume: 0.65 },
    tick:      { file: "tick_001.ogg",         dir: "interface", volume: 0.3 },
    buildDrop: { file: "drop_002.ogg",         dir: "interface", volume: 0.6 },
    reveal:    { file: "maximize_002.ogg",     dir: "interface", volume: 0.65 },
    droneGo:   { file: "maximize_001.ogg",     dir: "interface", volume: 0.6 },
    droneDone: { file: "confirmation_002.ogg", dir: "interface", volume: 0.65 },
    gprGo:     { file: "doorOpen_002.ogg",     dir: "scifi",     volume: 0.55 },
    gprDone:   { file: "confirmation_003.ogg", dir: "interface", volume: 0.65 },
    compactor: { file: "impactMetal_002.ogg",  dir: "scifi",     volume: 0.6 },
    repairGo:  { file: "maximize_003.ogg",     dir: "interface", volume: 0.6 },
    hazardAlert: { file: "bong_001.ogg",       dir: "interface", volume: 0.75 },
    hazardFixed: { file: "glass_003.ogg",      dir: "interface", volume: 0.65 },
  };

  var howls = {};
  var lastPlay = {};
  var unlocked = false;
  var muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}

  function base() {
    // Relative to index.html at the project root (works file:// + Pages).
    return "assets/kenney-audio/";
  }

  // Resolve one playable file per call (rotation for `files` entries).
  function resolveFile(s) {
    if (s.files && s.files.length) {
      return s.files[(Math.random() * s.files.length) | 0];
    }
    return s.file;
  }

  function ensure(id, file) {
    var key = id + "::" + file;
    if (howls[key] || typeof Howl === "undefined") return howls[key] || null;
    var s = SOUNDS[id];
    if (!s) return null;
    try {
      howls[key] = new Howl({
        src: [base() + s.dir + "/" + file],
        format: ["ogg"],
        html5: true,
        preload: true,
        volume: s.volume,
      });
    } catch (e) {
      return null;
    }
    return howls[key];
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      if (typeof Howler !== "undefined" && Howler.ctx && Howler.ctx.state === "suspended") {
        Howler.ctx.resume();
      }
    } catch (e) {}
  }

  var api = {
    SOUNDS: SOUNDS,
  };

  api.init = function () {
    if (typeof Howler !== "undefined") {
      try { Howler.mute(muted); } catch (e) {}
    }
    // desktop HUD mute key (mobile rail wires itself in mobileUI.js)
    try {
      var hudBtn = document.getElementById("hud-mute-btn");
      if (hudBtn && !hudBtn._muteWired) {
        hudBtn._muteWired = true;
        hudBtn.addEventListener("click", function () { api.toggleMute(); });
      }
    } catch (e2) {}
    // First user gesture unlocks audio (Enter Game click is the first
    // trigger by construction, so no autoplay violation is possible).
    function onGesture() { unlock(); }
    try {
      document.addEventListener("pointerdown", onGesture);
      document.addEventListener("keydown", onGesture);
    } catch (e) {}
    api.refreshButtons();
  };

  api.isMuted = function () { return muted; };
  api.isUnlocked = function () { return unlocked; };

  api.play = function (id) {
    if (!unlocked || muted) return false;
    if (typeof Howl === "undefined") return false;
    var s = SOUNDS[id];
    if (!s) return false;
    var now = Date.now();
    if (now - (lastPlay[id] || 0) < THROTTLE_MS) return false;
    lastPlay[id] = now;
    var h = ensure(id, resolveFile(s));
    if (!h) return false;
    try {
      var soundId = h.play();
      try { h.rate(1 + (Math.random() * 2 - 1) * PITCH_JITTER, soundId); } catch (e2) {}
    } catch (e) { return false; }
    return true;
  };

  api.toggleMute = function () {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
    try { if (typeof Howler !== "undefined") Howler.mute(muted); } catch (e2) {}
    api.refreshButtons();
    if (!muted) api.play("uiToggle"); // audible confirmation on unmute only
    return muted;
  };

  // Sync every mute button (HUD + mobile rail share data-mute-btn).
  api.refreshButtons = function () {
    try {
      var btns = document.querySelectorAll("[data-mute-btn]");
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].querySelector("[data-mute-on]");
        var off = btns[i].querySelector("[data-mute-off]");
        if (on) on.hidden = muted;
        if (off) off.hidden = !muted;
        btns[i].setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
        btns[i].setAttribute("aria-pressed", muted ? "true" : "false");
      }
    } catch (e) {}
  };

  return api;
})();
