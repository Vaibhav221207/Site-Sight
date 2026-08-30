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
        api.ownedEl.className = "hq-fs-drone-owned";
        api.ownedEl.style.fontSize = "13px";
        api.ownedEl.style.fontWeight = "700";
        api.ownedEl.style.color = "#E8604A";
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

    // Dynamic Compactor STORE row
    api.compactorOrderBtn = document.getElementById("hq-order-compactor-fs");
    if (api.compactorOrderBtn) {
      var compactorInfoBlock = api.compactorOrderBtn.closest(".hq-fs-drone-row");
      var compactorInfoEl = compactorInfoBlock ? compactorInfoBlock.querySelector(".hq-fs-drone-info") : null;
      if (compactorInfoEl) {
        api.compactorOwnedEl = document.createElement("span");
        api.compactorOwnedEl.className = "hq-fs-drone-owned";
        api.compactorOwnedEl.style.fontSize = "13px";
        api.compactorOwnedEl.style.fontWeight = "700";
        api.compactorOwnedEl.style.color = "#7C7C74";
        compactorInfoEl.appendChild(api.compactorOwnedEl);
      }
      api.compactorOrderBtn.addEventListener("click", function () { api.buyCompactor(); });
    }

    // ONE-TIME PURCHASE: reflect the permanent purchase state on the button
    // (disabled once the Drone System has been bought, even after deployment).
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();
    api.refreshCompactorPurchaseState();

    SECTIONS.forEach(function (name) {
      if (api.navItems[name]) {
        api.navItems[name].addEventListener("click", function () {
          api.switchSection(name);
        });
      }
    });

    // pinned footer action bar + STORE-button relocation (all breakpoints)
    api.footerEl = document.getElementById("hq-fs-footer");
    api.storeRow1 = api.orderBtn ? api.orderBtn.closest(".hq-fs-drone-row") : null;
    api.storeRow2 = api.gprOrderBtn ? api.gprOrderBtn.closest(".hq-fs-drone-row") : null;
    api.refreshFooter();
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
  function animateSectionEnter(section) {
    if (!section || typeof anime === "undefined") return;
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
    var sec = api.sections[name];
    if (sec) {
      // ensure it is visible before animating (display was just set)
      requestAnimationFrame(function () { animateSectionEnter(sec); });
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
    api.orderBtn.textContent = purchased ? "ORDERED" : "ORDER DRONE";
  };

  // ONE-TIME PURCHASE state for the GPR System — mirrors the Drone System.
  api.refreshGprPurchaseState = function () {
    if (!api.gprOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.gprSystemPurchased);
    api.gprOrderBtn.disabled = purchased;
    api.gprOrderBtn.textContent = purchased ? "ORDERED" : "ORDER GPR";
  };

  // ONE-TIME PURCHASE state for the Dynamic Compactor — mirrors the Drone/GPR System.
  // Reusable (not consumed), but only one needed per session.
  api.refreshCompactorPurchaseState = function () {
    if (!api.compactorOrderBtn) return;
    var purchased = !!(window.GameState && window.GameState.compactorSystemPurchased);
    api.compactorOrderBtn.disabled = purchased;
    api.compactorOrderBtn.textContent = purchased ? "ORDERED" : "ORDER COMPACTOR";
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
    var compactorOwned = !!(gs.compactorSystemPurchased);

    if ((!droneN || droneN <= 0) && (!gprN || gprN <= 0) && !compactorOwned) {
      var empty = document.createElement("div");
      empty.className = "hq-fs-placeholder";
      empty.textContent = "No survey equipment in inventory. Order a Drone, GPR System, or Dynamic Compactor from the STORE tab.";
      api.inventorySection.appendChild(empty);
    } else {
      if (droneN > 0) api._buildFleet("drone", "DRONE FLEET", "Drone System", droneN);
      if (gprN > 0) api._buildFleet("gpr", "GPR FLEET", "GPR System", gprN);
      if (compactorOwned) api._buildCompactorEntry();
    }

    api.inventoryDeployContainer = null;
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
      var wrap = document.createElement("div");
      wrap.className = "hq-fs-inventory-item-wrap";
      wrap.style.marginBottom = "14px";
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "stretch";
      wrap.dataset.itemType = type;
      wrap.dataset.itemId = id;
      var entry = document.createElement("div");
      entry.className = "hq-fs-inventory-item";
      entry.dataset.itemType = type;
      entry.dataset.itemId = id;
      entry.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "padding:14px 18px;background:#FFFBF0;" +
        "border:3px solid #2B2320;border-radius:16px;cursor:pointer;" +
        "box-shadow:4px 4px 0 #000;" +
        "transition:border-color 0.15s ease,background 0.15s ease;";
      var accent = type === "gpr" ? "#E0962A" : "#E8604A";
      entry.innerHTML =
        '<span class="hq-fs-inventory-item-name" style="font-size:17px;font-weight:700;color:' + accent + '">' + name + '</span>';
      entry.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var w = this.closest(".hq-fs-inventory-item-wrap");
        if (w) api.selectItem(w); else api.selectItem(this);
      });
      if (selectedId === id) api.markSelected(entry, true);
      var deployBtn = document.createElement("button");
      deployBtn.type = "button";
      deployBtn.className = "hq-order-btn";
      deployBtn.textContent = "Deploy";
      deployBtn.style.alignSelf = "flex-end";
      deployBtn.style.width = "auto";
      deployBtn.style.padding = "7px 14px";
      deployBtn.style.fontSize = "12px";
      deployBtn.style.marginTop = "8px";
      deployBtn.style.display = selectedId === id ? "" : "none";
      deployBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var w = this.closest(".hq-fs-inventory-item-wrap");
        if (w) {
          var type = w.dataset.itemType, id = w.dataset.itemId;
          var gs = window.GameState;
          if (gs) {
            // force-select this item (don't toggle off if already selected)
            if (type === "drone") { gs.inventory.selectedDroneId = id; gs.inventory.selectedGprId = null; }
            else { gs.inventory.selectedGprId = id; gs.inventory.selectedDroneId = null; }
            var items = api.inventorySection.querySelectorAll(".hq-fs-inventory-item");
            for (var i = 0; i < items.length; i++) api.markSelected(items[i], false);
            var card = w.querySelector(".hq-fs-inventory-item");
            if (card) api.markSelected(card, true);
          }
        }
        api.deploySelected();
      });
      wrap.appendChild(entry);
      wrap.appendChild(deployBtn);
      list.appendChild(wrap);
    }
  };

  // Build the Dynamic Compactor inventory entry (single reusable tool).
  api._buildCompactorEntry = function () {
    var gs = window.GameState;
    var header = document.createElement("div");
    header.className = "hq-fs-section-header";
    header.textContent = "STABILIZATION";
    api.inventorySection.appendChild(header);

    var list = document.createElement("div");
    list.className = "hq-fs-inventory-list";
    api.inventorySection.appendChild(list);

    var wrap = document.createElement("div");
    wrap.className = "hq-fs-inventory-item-wrap";
    wrap.style.marginBottom = "14px";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "stretch";
    wrap.dataset.itemType = "compactor";
    wrap.dataset.itemId = "compactor-1";

    var entry = document.createElement("div");
    entry.className = "hq-fs-inventory-item";
    entry.dataset.itemType = "compactor";
    entry.dataset.itemId = "compactor-1";
    entry.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:14px 18px;background:#FFFBF0;" +
      "border:3px solid #2B2320;border-radius:16px;cursor:pointer;" +
      "box-shadow:4px 4px 0 #000;" +
      "transition:border-color 0.15s ease,background 0.15s ease;";
    entry.innerHTML =
      '<span class="hq-fs-inventory-item-name" style="font-size:17px;font-weight:700;color:#7C7C74">Dynamic Compactor</span>';
    entry.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var w = this.closest(".hq-fs-inventory-item-wrap");
      if (w) api.selectItem(w); else api.selectItem(this);
    });
    // only show selected if this compactor is actually the selected item
    var compactorSelected = !!(window.GameState && window.GameState.inventory.selectedCompactorId === "compactor-1");
    api.markSelected(entry, compactorSelected);

    var deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "hq-order-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.style.alignSelf = "flex-end";
    deployBtn.style.width = "auto";
    deployBtn.style.padding = "7px 14px";
    deployBtn.style.fontSize = "12px";
    deployBtn.style.marginTop = "8px";
    deployBtn.style.display = compactorSelected ? "" : "none";
    deployBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      api.deploySelected();
    });
    wrap.appendChild(entry);
    wrap.appendChild(deployBtn);
    list.appendChild(wrap);
  };

  // Toggle the selected state of an inventory entry element.
  api.markSelected = function (entry, selected) {
    entry.style.borderColor = selected ? "#E8604A" : "#2B2320";
    entry.style.background = selected ? "#E4F5F6" : "#FFFBF0";
  };

  // Select (or deselect) a survey-unit entry. Single-select across BOTH fleets:
  // picking a unit of one type clears any selection of the other type; clicking
  // the active one deselects it.
  api.selectItem = function (entry) {
    var wrap = entry.closest ? entry.closest(".hq-fs-inventory-item-wrap") : null;
    if (wrap) entry = wrap;
    var type = entry.dataset.itemType;
    var id = entry.dataset.itemId;
    var gs = window.GameState;
    if (!gs) return;
    var wasSelected = false;
    if (type === "drone") wasSelected = gs.inventory.selectedDroneId === id;
    else if (type === "gpr") wasSelected = gs.inventory.selectedGprId === id;
    else if (type === "compactor") wasSelected = gs.inventory.selectedCompactorId === id;

    // clear any active entry visually (across both fleets)
    if (api.inventorySection) {
      var items = api.inventorySection.querySelectorAll(".hq-fs-inventory-item");
      for (var i = 0; i < items.length; i++) {
        api.markSelected(items[i], false);
      }
    }

    // clear all selection ids, then set the chosen one (or none if toggling off)
    gs.inventory.selectedDroneId = null;
    gs.inventory.selectedGprId = null;
    gs.inventory.selectedCompactorId = null;
    if (!wasSelected) {
      if (type === "drone") gs.inventory.selectedDroneId = id;
      else if (type === "gpr") gs.inventory.selectedGprId = id;
      else if (type === "compactor") gs.inventory.selectedCompactorId = id;
      var card = entry.querySelector ? entry.querySelector(".hq-fs-inventory-item") : entry;
      if (card) api.markSelected(card, true); else api.markSelected(entry, true);
    }
    api.refreshDeployVisibility();
  };

  // Show per-item Deploy buttons below each inventory card only while that item is selected
  api.refreshDeployVisibility = function () {
    var gs = window.GameState.inventory;
    if (api.inventorySection) {
      var wraps = api.inventorySection.querySelectorAll(".hq-fs-inventory-item-wrap");
      for (var i = 0; i < wraps.length; i++) {
        var w = wraps[i];
        var btn = w.querySelector(".hq-order-btn");
        if (!btn) continue;
        var type = w.dataset.itemType, id = w.dataset.itemId;
        var isSel = (type === "drone" && gs.selectedDroneId === id) ||
                    (type === "gpr" && gs.selectedGprId === id) ||
                    (type === "compactor" && gs.selectedCompactorId === id);
        btn.style.display = isSel ? "" : "none";
      }
    }
    if (api.inventoryDeployContainer) {
      var hasSel = !!(gs.selectedDroneId || gs.selectedGprId || gs.selectedCompactorId);
      api.inventoryDeployContainer.style.display = hasSel ? "" : "none";
    }
  };

  // Deploy whichever unit type is currently selected (drone, GPR, or compactor).
  api.deploySelected = function () {
    var gs = window.GameState.inventory;
    if (gs.selectedCompactorId) api.deployCompactor();
    else if (gs.selectedGprId) api.deployGpr();
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

  // Deploy the Dynamic Compactor — triggers the CompactorTool placement mode.
  // The CompactorTool handles the animation sequence and stability update.
  api.deployCompactor = function () {
    var id = window.GameState.inventory.selectedCompactorId;
    if (!id) return;
    console.log("[HQ] Deploy Compactor: selected " + id + " -> entering placement mode");
    if (window.CompactorTool) window.CompactorTool.startPlacement();
    if (api.isOpen) api.close();
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
    // amber is reserved for warning moments; coral for positive confirmations
    api.msgEl.style.color = success ? "#E8604A" : "#FFA000";
    api.msgEl.style.opacity = "1";
    clearTimeout(api._msgTimer);
    api._msgTimer = setTimeout(function () {
      if (api.msgEl) api.msgEl.style.opacity = "0";
    }, success ? 1200 : 1800);
  };

  // now direct — no native window.confirm (chunky toast in input.js instead)
  api.showCompactorConfirm = function (tileCount, callback) {
    if (callback) callback(true);
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
            var stillPurchased = !!(window.GameState && window.GameState.droneSystemPurchased);
            api.orderBtn.textContent = stillPurchased ? "ORDERED" : "ORDER DRONE";
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
          var stillPurchased = !!(window.GameState && window.GameState.gprSystemPurchased);
          api.gprOrderBtn.textContent = stillPurchased ? "ORDERED" : "ORDER GPR";
          api.gprOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      api.showMsg("Insufficient funds", false);
    }
  };

  // Buy a Dynamic Compactor — one-time unlock, REUSABLE (not consumed on use).
  api.buyCompactor = function () {
    var gs = window.GameState;
    if (!gs) return;
    if (gs.compactorSystemPurchased) return;
    if (gs.cash >= gs.compactorCost) {
      gs.cash -= gs.compactorCost;
      gs.compactorSystemPurchased = true;
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      api.updateOwned();
      api.refreshCompactorPurchaseState();
      if (api.compactorOrderBtn) {
        api.compactorOrderBtn.textContent = "Ordered!";
        api.compactorOrderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          if (!api.compactorOrderBtn) return;
          var stillPurchased = !!(window.GameState && window.GameState.compactorSystemPurchased);
          api.compactorOrderBtn.textContent = stillPurchased ? "ORDERED" : "ORDER COMPACTOR";
          api.compactorOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      api.showMsg("Insufficient funds", false);
    }
  };

   api.open = function () {
    if (api.isOpen) return;
    if (window.TilePanel && window.TilePanel.isOpen) window.TilePanel.hide();
    var fsBtn = document.getElementById('fs-btn');
    if (fsBtn) fsBtn.style.display = 'none';
    api.isOpen = true;
    api.overlayEl.style.visibility = "visible";
    api.overlayEl.style.pointerEvents = "auto";
    api.switchSection("store");
    api.updateOwned();
    api.renderInventory();
    api.refreshDronePurchaseState();
    api.refreshGprPurchaseState();
    api.refreshCompactorPurchaseState();

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
        backgroundColor: "rgba(43, 35, 32, 0.6)",
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
    var fsBtn2 = document.getElementById('fs-btn');
    if (fsBtn2) fsBtn2.style.display = '';
    api.isOpen = false;

    function finish() {
      api.overlayEl.style.visibility = "hidden";
      api.overlayEl.style.pointerEvents = "none";
      api.panelEl.style.transform = "";
      api.panelEl.style.opacity = "";
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
