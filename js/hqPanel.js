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
    footerEl: null,     // mobile fixed footer action bar (.hq-fs-footer)
    storeRow1: null,    // STORE Drone row (order button's desktop home)
    storeRow2: null,    // STORE GPR row (order button's desktop home)
    mobileMedia: null,  // matchMedia for the small-viewport breakpoint
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
        api.ownedEl.className = "hq-fs-drone-owned";
        api.ownedEl.style.fontSize = "13px";
        api.ownedEl.style.fontWeight = "700";
        api.ownedEl.style.color = "#00838F";
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
        api.gprOwnedEl.className = "hq-fs-drone-owned";
        api.gprOwnedEl.style.fontSize = "13px";
        api.gprOwnedEl.style.fontWeight = "700";
        api.gprOwnedEl.style.color = "#E0962A";
        gprInfoEl.appendChild(api.gprOwnedEl);
      }
      api.gprOrderBtn.addEventListener("click", function () { api.buyGpr(); });
    }

    // ONE-TIME PURCHASE: reflect the permanent purchase state on the button
    // (disabled once the Drone System has been bought, even after deployment).
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();

    SECTIONS.forEach(function (name) {
      if (api.navItems[name]) {
        api.navItems[name].addEventListener("click", function () {
          api.switchSection(name);
        });
      }
    });

    // mobile modal pattern: footer action bar + store-button relocation
    api.footerEl = document.getElementById("hq-fs-footer");
    api.storeRow1 = api.orderBtn ? api.orderBtn.closest(".hq-fs-drone-row") : null;
    api.storeRow2 = api.gprOrderBtn ? api.gprOrderBtn.closest(".hq-fs-drone-row") : null;
    api.mobileMedia = window.matchMedia("(max-width: 640px), (max-height: 500px)");
    if (api.mobileMedia && api.mobileMedia.addEventListener) {
      api.mobileMedia.addEventListener("change", function () { api.syncMobileLayout(); });
    }
    api.syncMobileLayout();
  };

  // ---- mobile fixed-footer layout -----------------------------------------
  // Mobile breakpoint only: the STORE order buttons and the INVENTORY Deploy
  // button live in a fixed footer below the scrollable content (desktop keeps
  // them inside their content rows — this code only ever moves DOM nodes when
  // the small-viewport media query matches).

  api.isMobile = function () {
    return !!(api.mobileMedia && api.mobileMedia.matches);
  };

  // Rebuild the footer for the ACTIVE tab: STORE order buttons on STORE,
  // nothing on DATA; the INVENTORY Deploy button is appended by
  // renderInventory() right after this runs.
  api.refreshFooter = function () {
    if (!api.footerEl) return;
    if (!api.isMobile()) {
      // desktop: footer hidden; make sure order buttons sit back in their rows
      if (api.orderBtn && api.storeRow1 && api.orderBtn.parentNode !== api.storeRow1) api.storeRow1.appendChild(api.orderBtn);
      if (api.gprOrderBtn && api.storeRow2 && api.gprOrderBtn.parentNode !== api.storeRow2) api.storeRow2.appendChild(api.gprOrderBtn);
      return;
    }
    api.footerEl.innerHTML = "";
    api.inventoryDeployContainer = null;
    if (api.currentSection === "store") {
      if (api.orderBtn && api.orderBtn.parentNode !== api.footerEl) api.footerEl.appendChild(api.orderBtn);
      if (api.gprOrderBtn && api.gprOrderBtn.parentNode !== api.footerEl) api.footerEl.appendChild(api.gprOrderBtn);
    } else {
      if (api.orderBtn && api.storeRow1 && api.orderBtn.parentNode !== api.storeRow1) api.storeRow1.appendChild(api.orderBtn);
      if (api.gprOrderBtn && api.storeRow2 && api.gprOrderBtn.parentNode !== api.storeRow2) api.storeRow2.appendChild(api.gprOrderBtn);
    }
  };

  // Breakpoint crossing (resize/orientation): re-sync footer + relayout.
  api.syncMobileLayout = function () {
    api.refreshFooter();
    if (api.isMobile() && api.currentSection === "inventory") api.renderInventory();
  };

  api.switchSection = function (name) {
    if (api.currentSection === name) return;
    SECTIONS.forEach(function (s) {
      if (api.navItems[s]) api.navItems[s].classList.toggle("hq-fs-nav-item--active", s === name);
      if (api.sections[s]) api.sections[s].style.display = s === name ? "" : "none";
    });
    api.currentSection = name;
    api.refreshFooter();
    if (name === "inventory") {
      api.renderInventory();
    }
    if (name === "data") {
      api.initDataMap();
      if (api.refreshDataMap) api.refreshDataMap();
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
  };

  api.updateOwned = function () {
    if (api.ownedEl) {
      var n = window.GameState.inventory.droneCount;
      api.ownedEl.textContent = "(Owned: " + n + ")";
    }
    if (api.gprOwnedEl) {
      var g = window.GameState.inventory.gprCount;
      api.gprOwnedEl.textContent = "(Owned: " + g + ")";
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
  };

  // ONE-TIME PURCHASE state for the GPR System — mirrors the Drone System.
  api.refreshGprPurchaseState = function () {
    if (!api.gprOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.gprSystemPurchased);
    api.gprOrderBtn.disabled = purchased;
  };

  // (Re)builds the INVENTORY tab contents from GameState.inventory:
  // - owned drones listed individually (selectable)
  // - empty state when none are owned
  // - Deploy button container toggled by selection state
  api.renderInventory = function () {
    if (!api.inventorySection) return;
    api.inventorySection.innerHTML = "";
    api.inventoryListEl = null;
    api.inventoryDeployContainer = null;

    var gs = window.GameState;
    var droneN = gs.inventory.droneCount;
    var gprN = gs.inventory.gprCount;

    if ((!droneN || droneN <= 0) && (!gprN || gprN <= 0)) {
      var empty = document.createElement("div");
      empty.className = "hq-fs-placeholder";
      empty.textContent = "No survey equipment in inventory. Order a Drone or GPR System from the STORE tab.";
      api.inventorySection.appendChild(empty);
    } else {
      if (droneN > 0) api._buildFleet("drone", "DRONE FLEET", "Drone System", droneN);
      if (gprN > 0) api._buildFleet("gpr", "GPR FLEET", "GPR System", gprN);
    }

    // Deploy button — deploys whichever unit type is currently selected.
    var deployBox = document.createElement("div");
    deployBox.className = "hq-fs-inventory-deploy";
    deployBox.style.marginTop = "16px";
    deployBox.style.display = "none";
    deployBox.style.display = "flex";
    deployBox.style.justifyContent = "flex-end";
    var deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "hq-order-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      api.deploySelected();
    });
    deployBox.appendChild(deployBtn);
    // mobile modal pattern: Deploy pins to the fixed footer (always visible
    // without scrolling); desktop keeps it at the end of the section content.
    if (api.isMobile() && api.footerEl) {
      api.footerEl.appendChild(deployBox);
    } else {
      api.inventorySection.appendChild(deployBox);
    }
    api.inventoryDeployContainer = deployBox;

    api.refreshDeployVisibility();
  };

  // Build a selectable fleet block for one equipment type ("drone" | "gpr").
  api._buildFleet = function (type, headerText, name, count) {
    var gs = window.GameState;
    var header = document.createElement("div");
    header.className = "hq-fs-section-header";
    header.textContent = headerText;
    api.inventorySection.appendChild(header);

    var list = document.createElement("div");
    list.className = "hq-fs-inventory-list";
    api.inventorySection.appendChild(list);

    var selectedId = type === "drone" ? gs.inventory.selectedDroneId : gs.inventory.selectedGprId;
    for (var i = 1; i <= count; i++) {
      var id = type + "-" + i;
      var entry = document.createElement("div");
      entry.className = "hq-fs-inventory-item";
      entry.dataset.itemType = type;
      entry.dataset.itemId = id;
      entry.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "padding:14px 18px;margin-bottom:8px;background:#F5F9FB;" +
        "border:2px solid transparent;border-radius:16px;cursor:pointer;" +
        "transition:border-color 0.15s ease,background 0.15s ease;";
      var accent = type === "gpr" ? "#E0962A" : "#2D3561";
      entry.innerHTML =
        '<span class="hq-fs-inventory-item-name" style="font-size:17px;font-weight:700;color:' + accent + '">' + name + '</span>';
      entry.addEventListener("click", function (ev) {
        ev.stopPropagation();
        api.selectItem(this);
      });
      if (selectedId === id) api.markSelected(entry, true);
      list.appendChild(entry);
    }
  };

  // Toggle the selected state of an inventory entry element.
  api.markSelected = function (entry, selected) {
    entry.style.borderColor = selected ? "#00ACC1" : "transparent";
    entry.style.background = selected ? "#E0F7FA" : "#F5F9FB";
  };

  // Select (or deselect) a survey-unit entry. Single-select across BOTH fleets:
  // picking a unit of one type clears any selection of the other type; clicking
  // the active one deselects it.
  api.selectItem = function (entry) {
    var type = entry.dataset.itemType;
    var id = entry.dataset.itemId;
    var gs = window.GameState;
    if (!gs) return;
    var wasSelected = (type === "drone" ? gs.inventory.selectedDroneId : gs.inventory.selectedGprId) === id;

    // clear any active entry visually (across both fleets)
    if (api.inventorySection) {
      var items = api.inventorySection.querySelectorAll(".hq-fs-inventory-item");
      for (var i = 0; i < items.length; i++) {
        api.markSelected(items[i], false);
      }
    }

    // clear both selection ids, then set the chosen one (or none if toggling off)
    gs.inventory.selectedDroneId = null;
    gs.inventory.selectedGprId = null;
    if (!wasSelected) {
      if (type === "drone") gs.inventory.selectedDroneId = id;
      else gs.inventory.selectedGprId = id;
      api.markSelected(entry, true);
    }
    api.refreshDeployVisibility();
  };

  // Show the Deploy button only while a drone OR a GPR unit is selected.
  api.refreshDeployVisibility = function () {
    var gs = window.GameState.inventory;
    var hasSelection = !!(gs.selectedDroneId || gs.selectedGprId);
    if (api.inventoryDeployContainer) {
      api.inventoryDeployContainer.style.display = hasSelection ? "" : "none";
    }
    // mobile: hide the whole footer strip while it holds only a hidden Deploy
    if (api.footerEl) {
      var mobileInventory = api.isMobile() && api.currentSection === "inventory";
      api.footerEl.classList.toggle("hq-fs-footer--hidden", mobileInventory && !hasSelection);
    }
  };

  // Deploy whichever unit type is currently selected (drone or GPR).
  api.deploySelected = function () {
    var gs = window.GameState.inventory;
    if (gs.selectedGprId) api.deployGpr();
    else if (gs.selectedDroneId) api.deployDrone();
  };

  // Wire the Deploy button to whole-map, no-click drone deployment. Closes the
  // terminal and immediately starts a full-map sweep (no placement mode, no
  // cursor preview, no click targeting). DroneDeploy.startDeployment handles
  // consuming the unit, clearing the selection and refreshing the STORE owned
  // count; the 8-chunk / 2-concurrent sweep runs on the map.
  api.deployDrone = function () {
    var id = window.GameState.inventory.selectedDroneId;
    if (!id) return;
    var started = !!(window.DroneDeploy && window.DroneDeploy.startDeployment());
    console.log("[HQ] Deploy: selected " + id + " -> " + (started ? "whole-map drone sweep started" : "deploy failed (no Drone Systems available)"));
    if (api.isOpen) api.close();
    if (!started) api.showMsg("[DEPLOY] no Drone Systems available", false, api.inventoryDeployContainer);
  };

  // Wire the Deploy button to whole-map, no-click GPR deployment. Mirrors the
  // Drone deploy: consumes one GPR unit, marks tiles subsurface-scanned, runs a
  // ground radar sweep on the map.
  api.deployGpr = function () {
    var id = window.GameState.inventory.selectedGprId;
    if (!id) return;
    var started = !!(window.GprDeploy && window.GprDeploy.startDeployment());
    console.log("[HQ] Deploy GPR: selected " + id + " -> " + (started ? "whole-map GPR sweep started" : "deploy failed (no GPR Systems available)"));
    if (api.isOpen) api.close();
    if (!started) api.showMsg("[DEPLOY] no GPR Systems available", false, api.inventoryDeployContainer);
  };

  api.showMsg = function (text, success, container) {
    var holder = container || null;
    if (!api.msgEl) {
      api.msgEl = document.createElement("div");
      api.msgEl.style.textAlign = "right";
      api.msgEl.style.fontSize = "12px";
      api.msgEl.style.fontWeight = "700";
      api.msgEl.style.minHeight = "16px";
      api.msgEl.style.transition = "opacity 0.3s ease";
      if (holder) {
        api.msgEl.style.marginTop = "8px";
        holder.appendChild(api.msgEl);
      } else if (api.orderBtn) {
        api.msgEl.style.marginTop = "8px";
        var row = api.orderBtn.closest(".hq-fs-drone-row");
        var parent = row && row.parentNode ? row.parentNode : api.orderBtn.parentNode;
        parent.appendChild(api.msgEl);
      } else {
        // fall back to the active section if no explicit holder was given
        var sec = api.sections && api.sections[api.currentSection];
        if (sec) sec.appendChild(api.msgEl);
      }
    } else if (holder && api.msgEl.parentNode !== holder) {
      // move the existing message element into the requested container
      holder.appendChild(api.msgEl);
    }
    api.msgEl.textContent = text;
    // amber is reserved for warning moments; teal for positive confirmations
    api.msgEl.style.color = success ? "#00ACC1" : "#FFA000";
    api.msgEl.style.opacity = "1";
    clearTimeout(api._msgTimer);
    api._msgTimer = setTimeout(function () {
      if (api.msgEl) api.msgEl.style.opacity = "0";
    }, success ? 1200 : 1800);
  };

  api.buyDrone = function () {
    var gs = window.GameState;
    if (!gs) return;
    // ONE-TIME PURCHASE: once bought (even if later deployed/consumed), the
    // button stays disabled for the rest of the session — no second purchase.
    if (gs.droneSystemPurchased) return;
    if (gs.cash >= gs.droneCost) {
      gs.cash -= gs.droneCost;
      gs.inventory.droneCount += 1;
      gs.droneSystemPurchased = true;
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      api.updateOwned();
      api.refreshDronePurchaseState();
      if (api.orderBtn) {
          api.orderBtn.textContent = "Ordered!";
          api.orderBtn.classList.add("hq-order-btn--flash");
          setTimeout(function () {
            if (!api.orderBtn) return;
            api.orderBtn.textContent = "Order Drone";
            api.orderBtn.classList.remove("hq-order-btn--flash");
          }, 900);
      }
    } else {
      api.showMsg("Insufficient funds", false);
    }
  };

  // Buy a GPR System — mirrors buyDrone exactly (one-time unlock + one unit).
  api.buyGpr = function () {
    var gs = window.GameState;
    if (!gs) return;
    if (gs.gprSystemPurchased) return;
    if (gs.cash >= gs.gprCost) {
      gs.cash -= gs.gprCost;
      gs.inventory.gprCount += 1;
      gs.gprSystemPurchased = true;
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      api.updateOwned();
      api.refreshGprPurchaseState();
      if (api.gprOrderBtn) {
        api.gprOrderBtn.textContent = "Ordered!";
        api.gprOrderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          if (!api.gprOrderBtn) return;
          api.gprOrderBtn.textContent = "Order GPR";
          api.gprOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      api.showMsg("Insufficient funds", false);
    }
  };

   api.open = function () {
    if (api.isOpen) return;
    api.isOpen = true;
    api.overlayEl.style.visibility = "visible";
    api.overlayEl.style.pointerEvents = "auto";
    api.syncMobileLayout();
    api.switchSection("store");
    api.updateOwned();
    api.renderInventory();
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();

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
        backgroundColor: "rgba(45, 53, 97, 0.45)",
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
        backgroundColor: "rgba(45, 53, 97, 0)",
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
