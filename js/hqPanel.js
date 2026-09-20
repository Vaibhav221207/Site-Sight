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
    currentSection: "data",
    isOpen: false,
    _opener: null, // element focused before open; focus returns here on close
    footerEl: null,     // fixed footer action bar (.hq-fs-footer)
    storeRow1: null,    // STORE Drone row (order button's home when not in footer)
    storeRow2: null,    // STORE GPR row (order button's home when not in footer)
  };

   var SECTIONS = ["data", "inventory", "store"];

  api.init = function () {
    api.overlayEl = document.getElementById("hq-overlay");
    api.panelEl = document.getElementById("hq-panel");
    api.closeBtn = document.getElementById("hq-close-btn");
    api.orderBtn = document.getElementById("hq-order-drone-fs");
    api.ownedEl = null;
    api.msgEl = null;

    // INVENTORY tab elements (built from JS so the list is dynamic)
    api.inventorySection = null;
    api.inventoryListEl = null;
    api.inventoryDeployContainer = null;

    api.navItems = {};
    api.sections = {};
    SECTIONS.forEach(function (name) {
      api.navItems[name] = document.getElementById("hq-nav-" + name);
      api.sections[name] = document.getElementById("hq-section-" + name);
      if (name === "inventory") {
        api.inventorySection = api.sections[name];
      }
    });

    if (api.closeBtn) {
      api.closeBtn.addEventListener("click", function () { api.close(); });
    }

    // owned-count readout, appended to the STORE listing next to the cost
    if (api.orderBtn) {
      var infoBlock = api.orderBtn.closest(".hq-fs-drone-row");
      var infoEl = infoBlock ? infoBlock.querySelector(".hq-fs-drone-info") : null;
      if (infoEl) {
        api.ownedEl = document.createElement("span");
        api.ownedEl.className = "hq-fs-drone-owned hq-owned--drone";
        infoEl.appendChild(api.ownedEl);
      }
      api.orderBtn.addEventListener("click", function () { api.buyDrone(); });
    }

    // GPR (Ground Penetrating Radar) STORE row — mirrors the Drone System.
    api.gprOrderBtn = document.getElementById("hq-order-gpr-fs");
    if (api.gprOrderBtn) {
      var gprInfoBlock = api.gprOrderBtn.closest(".hq-fs-drone-row");
      var gprInfoEl = gprInfoBlock ? gprInfoBlock.querySelector(".hq-fs-drone-info") : null;
      if (gprInfoEl) {
        api.gprOwnedEl = document.createElement("span");
        api.gprOwnedEl.className = "hq-fs-drone-owned hq-owned--gpr";
        gprInfoEl.appendChild(api.gprOwnedEl);
      }
      api.gprOrderBtn.addEventListener("click", function () { api.buyGpr(); });
    }

    // Dynamic Compactor STORE row
    api.compactorOrderBtn = document.getElementById("hq-order-compactor-fs");
    api.storeRow3 = null;
    if (api.compactorOrderBtn) {
      var compactorInfoBlock = api.compactorOrderBtn.closest(".hq-fs-drone-row");
      var compactorInfoEl = compactorInfoBlock ? compactorInfoBlock.querySelector(".hq-fs-drone-info") : null;
      if (compactorInfoEl) {
        api.compactorOwnedEl = document.createElement("span");
        api.compactorOwnedEl.className = "hq-fs-drone-owned hq-owned--compactor";
        compactorInfoEl.appendChild(api.compactorOwnedEl);
      }
      api.compactorOrderBtn.addEventListener("click", function () { api.buyCompactor(); });
      if (compactorInfoBlock && compactorInfoBlock.classList) api.storeRow3 = compactorInfoBlock;
    }

    // Repair Rig STORE row — reusable swarm fixer for hazard tiles
    api.repairOrderBtn = document.getElementById("hq-order-repair-fs");
    api.storeRow4 = null;
    if (api.repairOrderBtn) {
      var repairInfoBlock = api.repairOrderBtn.closest(".hq-fs-drone-row");
      var repairInfoEl = repairInfoBlock ? repairInfoBlock.querySelector(".hq-fs-drone-info") : null;
      if (repairInfoEl) {
        api.repairOwnedEl = document.createElement("span");
        api.repairOwnedEl.className = "hq-fs-drone-owned hq-owned--repair";
        repairInfoEl.appendChild(api.repairOwnedEl);
      }
      api.repairOrderBtn.addEventListener("click", function () { api.buyRepair(); });
      if (repairInfoBlock && repairInfoBlock.classList) api.storeRow4 = repairInfoBlock;
    }

    // paint the STORE system icons (procedural glyphs, no image assets)
    try {
      if (api.panelEl && api.panelEl.querySelectorAll && window.Icons) {
        var icons = api.panelEl.querySelectorAll("[data-icon]");
        for (var gi = 0; gi < icons.length; gi++) {
          var g = icons[gi].getAttribute ? icons[gi].getAttribute("data-icon") : null;
          if (g) icons[gi].innerHTML = window.Icons.get(g);
        }
      }
    } catch (e) {}
    api.refreshStoreAfford();
    api.initStoreCategories();
    api.refreshNavCount();

    // ONE-TIME PURCHASE: reflect the permanent purchase state on the button
    // (disabled once the Drone System has been bought, even after deployment).
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();
    api.refreshCompactorPurchaseState();
    api.refreshRepairPurchaseState();

    SECTIONS.forEach(function (name) {
      if (api.navItems[name]) {
        api.navItems[name].addEventListener("click", function () {
          api.switchSection(name);
        });
      }
    });

    // modal keyboard contract (WAI-APG dialog pattern): Tab cycles inside,
    // Escape closes. Bound once; handlers no-op while closed.
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("keydown", api._onKey);
    }

    // pinned footer action bar + STORE-button relocation (all breakpoints)
    api.footerEl = document.getElementById("hq-fs-footer");
    api.storeRow1 = api.orderBtn ? api.orderBtn.closest(".hq-fs-drone-row") : null;
    api.storeRow2 = api.gprOrderBtn ? api.gprOrderBtn.closest(".hq-fs-drone-row") : null;
    api.refreshFooter();
  };

  api.initStoreCategories = function () {
    var store = api.sections && api.sections.store;
    if (!store || store.querySelector(".hq-store-categories")) return;
    var tabs = document.createElement("div");
    tabs.className = "hq-store-categories";
    tabs.innerHTML = '<button type="button" class="hq-store-filter is-active" data-store-filter="all">ALL</button>' +
      '<button type="button" class="hq-store-filter" data-store-filter="survey">SURVEY</button>' +
      '<button type="button" class="hq-store-filter" data-store-filter="stabilize">STABILIZE</button>';
    store.insertBefore(tabs, store.firstChild);
    tabs.addEventListener("click", function (event) {
      var button = event.target.closest(".hq-store-filter");
      if (!button) return;
      var filter = button.dataset.storeFilter || "all";
      var buttons = tabs.querySelectorAll(".hq-store-filter");
      for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle("is-active", buttons[i] === button);
      var groups = store.querySelectorAll(".hq-store-group");
      for (var g = 0; g < groups.length; g++) groups[g].hidden = filter !== "all" && groups[g].dataset.storeCategory !== filter;
    });
  };

  // ---- fixed-footer layout (all breakpoints) ------------------------------
  // The STORE order buttons and the INVENTORY Deploy button live in a fixed
  // footer below the scrollable content, pinned to the bottom of the modal at
  // every viewport size — the sidebar layout is shared across breakpoints.

  // Footer now only holds the INVENTORY Deploy button; STORE buy buttons
  // stay below each item inside their own cards (column layout), not in a
  // shared footer — matches the requested "below each item" placement.
  api.refreshFooter = function () {
    if (!api.footerEl) return;
    api.footerEl.innerHTML = "";
    api.inventoryDeployContainer = null;
    api.footerEl.classList.remove("hq-fs-footer--hidden");
    // always keep STORE buttons in their cards, never in the footer
    if (api.orderBtn && api.storeRow1 && api.orderBtn.parentNode !== api.storeRow1) api.storeRow1.appendChild(api.orderBtn);
    if (api.gprOrderBtn && api.storeRow2 && api.gprOrderBtn.parentNode !== api.storeRow2) api.storeRow2.appendChild(api.gprOrderBtn);
    if (api.compactorOrderBtn && api.storeRow3 && api.compactorOrderBtn.parentNode !== api.storeRow3) api.storeRow3.appendChild(api.compactorOrderBtn);
    if (api.repairOrderBtn && api.storeRow4 && api.repairOrderBtn.parentNode !== api.storeRow4) api.storeRow4.appendChild(api.repairOrderBtn);
  };

  // modern micro-interaction for nav buttons
  function animateNavPress(btn) {
    if (!btn || typeof anime === "undefined") return;
    anime.remove(btn);
    anime({
      targets: btn,
      scale: [0.96, 1],
      duration: 220,
      easing: "spring(1, 80, 10, 0)"
    });
  }
  function isShot() {
    try {
      if (window.__SHOT) return true;
      var h = (window.location && window.location.hash) || "";
      return h.indexOf("#shot") === 0;
    } catch (e) { return false; }
  }

  function animateSectionEnter(section) {
    if (!section) return;
    if (isShot()) {
      // captures: final state, no tween (see shotEnter in startScreen.js)
      try {
        section.style.opacity = "1";
        section.style.transform = "";
        section.style.animation = "none";
      } catch (e) {}
      return;
    }
    if (typeof anime === "undefined") return;
    var cards = section.querySelectorAll(".hq-fs-drone-row, .hq-fs-inventory-item-wrap, .hq-data-layout > div, .hq-fs-status");
    anime.set(section, { opacity: 0, translateY: 10 });
    if (cards.length) anime.set(cards, { opacity: 0, translateY: 8 });
    anime({
      targets: section,
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 220,
      easing: "easeOutCubic"
    });
    if (cards.length) {
      anime({
        targets: cards,
        opacity: [0, 1],
        translateY: [8, 0],
        delay: anime.stagger(45, { start: 80 }),
        duration: 280,
        easing: "easeOutCubic"
      });
    }
  }

  api.switchSection = function (name) {
    if (api.currentSection === name) return;
    var prev = api.currentSection;
    var prevBtn = api.navItems[name];
    if (prevBtn) animateNavPress(prevBtn);
    SECTIONS.forEach(function (s) {
      if (api.navItems[s]) {
        api.navItems[s].classList.toggle("hq-fs-nav-item--active", s === name);
        if (s === name) api.navItems[s].setAttribute("aria-current", "true");
        else if (api.navItems[s].removeAttribute) api.navItems[s].removeAttribute("aria-current");
      }
      if (api.sections[s]) api.sections[s].style.display = s === name ? "" : "none";
    });
    api.currentSection = name;
    // DATA tab gets a wider sheet (map + full details side by side); other
    // tabs keep the standard width
    if (api.panelEl && api.panelEl.classList) {
      api.panelEl.classList.toggle("hq-panel--data", name === "data");
    }
    api.refreshFooter();
    if (name === "inventory") {
      api.renderInventory();
    }
    if (name === "data") {
      api.initDataMap();
      if (api.refreshDataMap) api.refreshDataMap();
    }
    var sec = api.sections[name];
    if (sec) {
      // shot captures: apply synchronously — headless rAF may never fire,
      // which used to freeze the CSS section fade at opacity 0 forever
      if (isShot()) animateSectionEnter(sec);
      else requestAnimationFrame(function () { animateSectionEnter(sec); });
    }
    // also animate the outgoing section out subtly if needed (already hidden)
    if (prev && api.sections[prev]) {
      // no-op, kept for future directional slide
    }
  };

  // ---- DATA tab: flat top-down mini-map (see js/dataMap.js) --------------
  // The mini-map + category summary are driven entirely by GameState.tileData
  // (populated by Drone/GPR scans). switchSection() calls initDataMap() once
  // and refreshDataMap() every time the tab is opened so fresh scan data
  // shows up live.
  api.initDataMap = function () {
    if (window.DataMap) window.DataMap.init();
  };

  api.refreshDataMap = function () {
    if (window.DataMap) window.DataMap.refresh();
    var data = window.GameState && window.GameState.tileData || {};
    var total = window.IsoGrid && window.IsoGrid.gridSize ? window.IsoGrid.gridSize * window.IsoGrid.gridSize : 0;
    var scanned = 0, zoned = 0, built = 0;
    for (var key in data) {
      if (data[key].bestUse || data[key].surfaceStability) scanned++;
      if (data[key].zoneType) zoned++;
      if (data[key].zoneBuilding) built++;
    }
    var scanEl = document.getElementById("data-overview-scanned");
    var zoneEl = document.getElementById("data-overview-zoned");
    var builtEl = document.getElementById("data-overview-built");
    if (scanEl) scanEl.textContent = (total ? Math.round(scanned / total * 100) : 0) + "%";
    if (zoneEl) zoneEl.textContent = String(zoned);
    if (builtEl) builtEl.textContent = String(built);
  };

  api.updateOwned = function () {
    if (api.ownedEl) {
      var n = window.GameState.inventory.droneCount;
      api.ownedEl.textContent = "Owned: " + n;
    }
    if (api.gprOwnedEl) {
      var g = window.GameState.inventory.gprCount;
      api.gprOwnedEl.textContent = "Owned: " + g;
    }
    if (api.compactorOwnedEl) {
      var hasC = !!(window.GameState && window.GameState.compactorSystemPurchased);
      api.compactorOwnedEl.textContent = hasC ? "Owned" : "Not owned";
    }
    if (api.repairOwnedEl) {
      var hasR = !!(window.GameState && window.GameState.repairRigPurchased);
      api.repairOwnedEl.textContent = hasR ? "Owned" : "Not owned";
    }
    api.refreshStoreAfford();
    api.refreshNavCount();
  };

  // INVENTORY tab badge: live fleet count on the nav key (hidden when empty)
  api.refreshNavCount = function () {
    var el = null;
    try { el = document.getElementById("hq-nav-inv-count"); } catch (e) { el = null; }
    if (!el) return;
    var gs = window.GameState;
    var n = gs ? ((gs.inventory.droneCount || 0) + (gs.inventory.gprCount || 0) +
      (gs.compactorSystemPurchased ? 1 : 0) + (gs.repairRigPurchased ? 1 : 0)) : 0;
    el.hidden = !(n > 0);
    el.textContent = n > 0 ? String(n) : "";
  };

  // red-when-broke prices: unaffordable STORE rows read as unaffordable
  // before the click, not after (no mental arithmetic, no dead taps)
  api.refreshStoreAfford = function () {
    if (!api.panelEl || !api.panelEl.querySelectorAll) return;
    var gs = window.GameState;
    var cash = gs ? gs.cash : 0;
    var prices = api.panelEl.querySelectorAll("[data-price]");
    for (var i = 0; i < prices.length; i++) {
      var cost = parseFloat(prices[i].getAttribute ? prices[i].getAttribute("data-price") : 0) || 0;
      if (prices[i].classList) prices[i].classList.toggle("cant-afford", cash < cost);
    }
  };

  // ONE-TIME PURCHASE state: the STORE Order Drone button is permanently
  // disabled once the Drone System has been purchased — the same permanent
  // pattern as the Build HQ button. The flag survives deployment/consumption
  // (droneCount can return to 0), so the button NEVER re-enables.
  api.refreshDronePurchaseState = function () {
    if (!api.orderBtn) return;
    var purchased = !!(window.GameState && window.GameState.droneSystemPurchased);
    api.orderBtn.disabled = purchased;
    api.orderBtn.textContent = purchased ? "OWNED" : "BUY";
    // owned rows collapse their teaching blurb: you know what it does now
    if (api.storeRow1 && api.storeRow1.classList) api.storeRow1.classList.toggle("is-bought", purchased);
  };

  // ONE-TIME PURCHASE state for the GPR System — mirrors the Drone System.
  api.refreshGprPurchaseState = function () {
    if (!api.gprOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.gprSystemPurchased);
    api.gprOrderBtn.disabled = purchased;
    api.gprOrderBtn.textContent = purchased ? "OWNED" : "BUY";
    if (api.storeRow2 && api.storeRow2.classList) api.storeRow2.classList.toggle("is-bought", purchased);
  };

  // ONE-TIME PURCHASE state for the Dynamic Compactor — mirrors the Drone/GPR System.
  // Reusable (not consumed), but only one needed per session.
  api.refreshCompactorPurchaseState = function () {
    if (!api.compactorOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.compactorSystemPurchased);
    api.compactorOrderBtn.disabled = purchased;
    api.compactorOrderBtn.textContent = purchased ? "OWNED" : "BUY";
    if (api.storeRow3 && api.storeRow3.classList) api.storeRow3.classList.toggle("is-bought", purchased);
  };

  // ONE-TIME PURCHASE state for the Repair Rig — reusable swarm fixer
  api.refreshRepairPurchaseState = function () {
    if (!api.repairOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.repairRigPurchased);
    api.repairOrderBtn.disabled = purchased;
    api.repairOrderBtn.textContent = purchased ? "OWNED" : "BUY";
    if (api.storeRow4 && api.storeRow4.classList) api.storeRow4.classList.toggle("is-bought", purchased);
  };

  // (Re)builds the INVENTORY tab contents from GameState.inventory:
  // - owned drones listed individually (selectable)
  // - empty state when none are owned
  // - Deploy button container toggled by selection state
   api.open = function () {
    if (api.isOpen) return;
    if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
    var fsBtn = document.getElementById('fs-btn');
    if (fsBtn) fsBtn.style.display = 'none';
    try { api._opener = document.activeElement || null; } catch (e) { api._opener = null; }
    api.isOpen = true;
    api.overlayEl.style.visibility = "visible";
    api.overlayEl.style.pointerEvents = "auto";
    // lock the page behind the modal so touch scroll can't escape under it
    try { document.body.style.overflow = "hidden"; } catch (e) {}
    // reopen where the player left off (DATA on first open)
    var target = api.currentSection || "data";
    api.currentSection = "";
    api.switchSection(target);
    api.updateOwned();
    api.renderInventory();
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();
    api.refreshCompactorPurchaseState();
    api.refreshRepairPurchaseState();
    // initial focus lands on the close control (visible, first in tab order)
    try { if (api.closeBtn && api.closeBtn.focus) api.closeBtn.focus(); } catch (e) {}

    if (!isShot() && typeof anime !== "undefined" && anime) {
      anime({
        targets: api.panelEl,
        scale: [0.85, 1],
        opacity: [0, 1],
        duration: OPEN_DUR,
        easing: "easeOutCubic",
      });
      anime({
        targets: api.overlayEl,
        backgroundColor: "rgba(43, 35, 32, 0.6)",
        duration: OPEN_DUR,
        easing: "easeOutCubic",
      });
    } else {
      // captures run headless under virtual time, where the CSS fade can
      // freeze mid-transition even with the tween engine skipped
      api.panelEl.style.transition = "none";
      if (api.overlayEl) api.overlayEl.style.transition = "none";
      api.panelEl.style.transform = "scale(1)";
      api.panelEl.style.opacity = "1";
    }
  };

  api.close = function () {
    if (!api.isOpen) return;
    if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
    var fsBtn2 = document.getElementById('fs-btn');
    if (fsBtn2) fsBtn2.style.display = '';
    api.isOpen = false;

    function finish() {
      api.overlayEl.style.visibility = "hidden";
      api.overlayEl.style.pointerEvents = "none";
      api.panelEl.style.transform = "";
      api.panelEl.style.opacity = "";
      api.panelEl.style.transition = "";
      if (api.overlayEl) api.overlayEl.style.transition = "";
      try { document.body.style.overflow = ""; } catch (e) {}
      // return focus to whatever opened the panel (APG close contract)
      try { if (api._opener && api._opener.focus) api._opener.focus(); } catch (e2) {}
      api._opener = null;
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
        backgroundColor: "rgba(43, 35, 32, 0)",
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