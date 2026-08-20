/* js/ui.js — small anime.js-driven UI/UX helper layer (toasts + count-up).
 * Shared by the HQ panel, tile popup and DATA map so every surface animation
 * funnels through one modern anime.js-driven API.
 */

window.UI = (function () {
  "use strict";

  var TOAST_STACK_ID = "ui-toast-stack";

  function stack() {
    var el = document.getElementById(TOAST_STACK_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_STACK_ID;
      el.style.position = "fixed";
      el.style.top = "14px";
      el.style.left = "50%";
      el.style.transform = "translateX(-50%)";
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.alignItems = "center";
      el.style.gap = "8px";
      el.style.zIndex = "9999";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
    }
    return el;
  }

  // Animated toast. opts: { color: "#hex", icon: "emoji", duration: ms }
  function toast(message, opts) {
    opts = opts || {};
    var s = stack();
    var t = document.createElement("div");
    var color = opts.color || "#0E9AA6";
    t.style.cssText =
      "pointer-events:none;max-width:80vw;padding:10px 18px;border-radius:16px;" +
      "background:#2B2320;color:#fff;font-family:'Baloo 2',sans-serif;" +
      "font-size:14px;font-weight:700;letter-spacing:0.02em;" +
      "box-shadow:4px 4px 0 rgba(43,35,32,0.35);" +
      "border:3px solid " + color + ";";
    t.textContent = (opts.icon ? opts.icon + "  " : "") + message;
    s.appendChild(t);

    var dur = opts.duration || 2200;
    if (typeof anime !== "undefined" && anime) {
      anime.set(t, { opacity: 0, translateY: -16 });
      anime({
        targets: t,
        opacity: [0, 1],
        translateY: [-16, 0],
        duration: 240,
        easing: "easeOutCubic",
        complete: function () {
          anime({
            targets: t,
            opacity: [1, 0],
            translateY: [0, -10],
            delay: dur,
            duration: 320,
            easing: "easeInCubic",
            complete: function () {
              if (t.parentNode) t.parentNode.removeChild(t);
            },
          });
        },
      });
    } else {
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, dur);
    }
  }

  // Animated integer count-up. Writes into el.textContent.
  function countUp(el, to, opts) {
    if (!el) return;
    opts = opts || {};
    var from = typeof opts.from === "number" ? opts.from : 0;
    var suffix = opts.suffix || "";
    var obj = { v: from };
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: obj,
        v: to,
        duration: opts.duration || 600,
        easing: opts.easing || "easeOutCubic",
        update: function () {
          el.textContent = Math.round(obj.v) + suffix;
        },
      });
    } else {
      el.textContent = to + suffix;
    }
  }

  return {
    toast: toast,
    countUp: countUp,
  };
})();
