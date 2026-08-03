/* js/hqPanel.js — full-screen HQ management overlay (terminal layout).
 * Completely separate from the small tile-info popup (panel.js).
 * Opened when the HQ tile is clicked; shows a terminal-style dashboard
 * with navigation sections (DATA / INVENTORY / STORE). Modal — blocks
 * all map interaction while open.
 */

window.HqPanel = (function () {
  var OPEN_DUR = 350;
  var CLOSE_DUR = 280;

  var api = {
    overlayEl: null,
    panelEl: null,
    closeBtn: null,
    orderBtn: null,
    navItems: null,
    sections: null,
    currentSection: "store",
    isOpen: false,
  };

  var SECTIONS = ["data", "inventory", "store"];

  api.init = function () {
    api.overlayEl = document.getElementById("hq-overlay");
    api.panelEl = document.getElementById("hq-panel");
    api.closeBtn = document.getElementById("hq-close-btn");
    api.orderBtn = document.getElementById("hq-order-drone-fs");

    api.navItems = {};
    api.sections = {};
    SECTIONS.forEach(function (name) {
      api.navItems[name] = document.getElementById("hq-nav-" + name);
      api.sections[name] = document.getElementById("hq-section-" + name);
    });

    if (api.closeBtn) {
      api.closeBtn.addEventListener("click", function () { api.close(); });
    }
    if (api.orderBtn) {
      api.orderBtn.addEventListener("click", function () {
        console.log("[ConTech HQ] Order Drone requested");
        api.orderBtn.textContent = "Ordered!";
        api.orderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          api.orderBtn.textContent = "Order Drone";
          api.orderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      });
    }

    SECTIONS.forEach(function (name) {
      if (api.navItems[name]) {
        api.navItems[name].addEventListener("click", function () {
          api.switchSection(name);
        });
      }
    });
  };

  api.switchSection = function (name) {
    if (api.currentSection === name) return;
    SECTIONS.forEach(function (s) {
      if (api.navItems[s]) api.navItems[s].classList.toggle("hq-fs-nav-item--active", s === name);
      if (api.sections[s]) api.sections[s].style.display = s === name ? "" : "none";
    });
    api.currentSection = name;
  };

  api.open = function () {
    if (api.isOpen) return;
    api.isOpen = true;
    api.overlayEl.style.visibility = "visible";
    api.overlayEl.style.pointerEvents = "auto";
    api.switchSection("store");

    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: api.panelEl,
        scale: [0.85, 1],
        opacity: [0, 1],
        duration: OPEN_DUR,
        easing: "easeOutCubic",
      });
      anime({
        targets: api.overlayEl,
        backgroundColor: "rgba(0,0,0,0.65)",
        duration: OPEN_DUR,
        easing: "easeOutCubic",
      });
    } else {
      api.panelEl.style.transform = "scale(1)";
      api.panelEl.style.opacity = "1";
    }
  };

  api.close = function () {
    if (!api.isOpen) return;

    function finish() {
      api.overlayEl.style.visibility = "hidden";
      api.overlayEl.style.pointerEvents = "none";
      api.panelEl.style.transform = "";
      api.panelEl.style.opacity = "";
      api.isOpen = false;
    }

    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: api.panelEl,
        scale: [1, 0.85],
        opacity: [1, 0],
        duration: CLOSE_DUR,
        easing: "easeInCubic",
      });
      anime({
        targets: api.overlayEl,
        backgroundColor: "rgba(0,0,0,0)",
        duration: CLOSE_DUR,
        easing: "easeInCubic",
        complete: finish,
      });
    } else {
      finish();
    }
  };

  api.toggle = function () {
    if (api.isOpen) {
      api.close();
    } else {
      api.open();
    }
  };

  return api;
})();
