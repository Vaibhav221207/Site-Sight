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

    // ONE-TIME PURCHASE: reflect the permanent purchase state on the button
    // (disabled once the Drone System has been bought, even after deployment).
    api.refreshDronePurchaseState();

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
    if (name === "inventory") {
      api.renderInventory();
    }
  };

  api.updateOwned = function () {
    if (api.ownedEl) {
      var n = window.GameState.inventory.droneCount;
      api.ownedEl.textContent = "(Owned: " + n + ")";
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

  // (Re)builds the INVENTORY tab contents from GameState.inventory:
  // - owned drones listed individually (selectable)
  // - empty state when none are owned
  // - Deploy button container toggled by selection state
  api.renderInventory = function () {
    if (!api.inventorySection) return;
    api.inventorySection.innerHTML = "";
    api.inventoryListEl = null;
    api.inventoryDeployContainer = null;

    var header = document.createElement("div");
    header.className = "hq-fs-section-header";
    header.textContent = "DRONE FLEET";
    api.inventorySection.appendChild(header);

    var list = document.createElement("div");
    list.className = "hq-fs-inventory-list";
    api.inventorySection.appendChild(list);
    api.inventoryListEl = list;

    var n = window.GameState.inventory.droneCount;
    if (!n || n <= 0) {
      var empty = document.createElement("div");
      empty.className = "hq-fs-placeholder";
      empty.textContent = "No Drone Systems in inventory. Order one from the STORE tab.";
      api.inventorySection.appendChild(empty);
      return;
    }

    // Each owned drone is its own selectable entry. The Drone System is a
    // ONE-TIME purchase, so the fleet can only ever hold a single unit — the
    // row is labeled plainly (no #1 numbering).
    for (var i = 1; i <= n; i++) {
      var id = "drone-" + i;
      var entry = document.createElement("div");
      entry.className = "hq-fs-inventory-item";
      entry.dataset.droneId = id;
      entry.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "padding:14px 18px;margin-bottom:8px;background:#F5F9FB;" +
        "border:2px solid transparent;border-radius:16px;cursor:pointer;" +
        "transition:border-color 0.15s ease,background 0.15s ease;";
      entry.innerHTML =
        '<span class="hq-fs-inventory-item-name" style="font-size:17px;font-weight:700;color:#2D3561">Drone System</span>';
      entry.addEventListener("click", function (ev) {
        ev.stopPropagation();
        api.selectDrone(this);
      });
      // keep selection in GameState in sync with the visual state
      if (window.GameState.inventory.selectedDroneId === id) {
        api.markSelected(entry, true);
      }
      list.appendChild(entry);
    }

    // Deploy button (placeholder acknowledgement for now)
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
      api.deployDrone();
    });
    deployBox.appendChild(deployBtn);
    api.inventorySection.appendChild(deployBox);
    api.inventoryDeployContainer = deployBox;

    api.refreshDeployVisibility();
  };

  // Toggle the selected state of an inventory entry element.
  api.markSelected = function (entry, selected) {
    entry.style.borderColor = selected ? "#00ACC1" : "transparent";
    entry.style.background = selected ? "#E0F7FA" : "#F5F9FB";
  };

  // Select (or deselect) a drone entry. Single-select: picking a new one
  // deselects the previous; clicking the active one deselects it.
  api.selectDrone = function (entry) {
    var id = entry.dataset.droneId;
    var gs = window.GameState;
    if (!gs) return;
    var wasSelected = gs.inventory.selectedDroneId === id;

    // clear any active entry visually
    if (api.inventoryListEl) {
      var items = api.inventoryListEl.querySelectorAll(".hq-fs-inventory-item");
      for (var i = 0; i < items.length; i++) {
        api.markSelected(items[i], false);
      }
    }

    if (wasSelected) {
      gs.inventory.selectedDroneId = null;
    } else {
      gs.inventory.selectedDroneId = id;
      api.markSelected(entry, true);
    }
    api.refreshDeployVisibility();
  };

  // Show the Deploy button only while a drone is selected.
  api.refreshDeployVisibility = function () {
    var hasSelection = !!window.GameState.inventory.selectedDroneId;
    if (api.inventoryDeployContainer) {
      api.inventoryDeployContainer.style.display = hasSelection ? "" : "none";
    }
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
    // close the terminal so the map is interactive and the sweep is visible
    if (api.isOpen) api.close();
    if (!started) {
      api.showMsg("[DEPLOY] no Drone Systems available", false, api.inventoryDeployContainer);
    }
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

   api.open = function () {
    if (api.isOpen) return;
    api.isOpen = true;
    api.overlayEl.style.visibility = "visible";
    api.overlayEl.style.pointerEvents = "auto";
    api.switchSection("store");
    api.updateOwned();
    api.renderInventory();
    api.refreshDronePurchaseState();

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
