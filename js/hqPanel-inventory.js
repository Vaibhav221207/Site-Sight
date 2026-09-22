(function(){
var api = window.HqPanel; if(!api) return;
// js/hqPanel-inventory.js — split from hqPanel.js (inventory grid)
  api.renderInventory = function () {
    if (!api.inventorySection) return;
    api.inventorySection.innerHTML = "";
    api.inventoryListEl = null;
    api.inventoryDeployContainer = null;

    var gs = window.GameState;
    var droneN = gs.inventory.droneCount;
    var gprN = gs.inventory.gprCount;
    var compactorOwned = !!(gs.compactorSystemPurchased);
    var repairOwned = !!(gs.repairRigPurchased);

    if ((!droneN || droneN <= 0) && (!gprN || gprN <= 0) && !compactorOwned && !repairOwned) {
      var empty = document.createElement("div");
      empty.className = "hq-fs-placeholder hq-empty-inventory";
      var emptyText = document.createElement("p");
      emptyText.className = "hq-empty-text";
      emptyText.textContent = "No survey equipment yet — nothing to deploy.";
      empty.appendChild(emptyText);
      var emptyCta = document.createElement("button");
      emptyCta.type = "button";
      emptyCta.className = "hq-order-btn";
      emptyCta.textContent = "Go to STORE";
      emptyCta.addEventListener("click", function () { api.switchSection("store"); });
      empty.appendChild(emptyCta);
      api.inventorySection.appendChild(empty);
    } else {
      // one shared product grid (same catalogue pattern as STORE): no
      // repeated per-type headers, cards sit side by side
      var grid = document.createElement("div");
      grid.className = "hq-inv-grid";
      api.inventorySection.appendChild(grid);
      api.inventoryListEl = grid;
      if (droneN > 0) api._buildFleet(grid, "drone", "Drone System", droneN);
      if (gprN > 0) api._buildFleet(grid, "gpr", "GPR System", gprN);
      if (compactorOwned) api._buildCompactorEntry(grid);
      if (repairOwned) api._buildRepairEntry(grid);
    }

    api.inventoryDeployContainer = null;
    api.refreshDeployVisibility();
  };

  // Build selectable product cards for one equipment type ("drone" | "gpr")
  // into the shared grid. DOM shape, classes and data attrs are unchanged
  // (selection + deploy wiring depends on them) — only the layout changed
  // from full-width rows to catalogue cards.
  api._buildFleet = function (grid, type, name, count) {
    var gs = window.GameState;
    var selectedId = type === "drone" ? gs.inventory.selectedDroneId : gs.inventory.selectedGprId;
    for (var i = 1; i <= count; i++) {
      var id = type + "-" + i;
      var wrap = document.createElement("div");
      wrap.className = "hq-fs-inventory-item-wrap";
      wrap.style.marginBottom = "0";
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
        "display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;" +
        "padding:16px 14px 14px;background:#FFFBF0;" +
        "border:3px solid #2B2320;border-radius:16px;cursor:pointer;" +
        "box-shadow:3px 3px 0 #000;" +
        "transition:border-color 0.15s ease,background 0.15s ease;";
      var accent = type === "gpr" ? "#E0962A" : "#C7432B";
      var icon = (window.Icons && window.Icons.get) ? window.Icons.get(type === "gpr" ? "gpr" : "drone") : "";
      entry.innerHTML =
        '<span class="hq-inv-ico hq-inv-ico--lg" aria-hidden="true">' + icon + '</span>' +
        '<span class="hq-fs-inventory-item-name" style="font-size:15px;font-weight:700;color:' + accent + '">' + name + '</span>' +
        '<span class="hq-inv-status" data-status>READY</span>';
      entry.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var w = this.closest(".hq-fs-inventory-item-wrap");
        if (w) api.selectItem(w); else api.selectItem(this);
      });
      api._makeSelectable(entry, name + " " + id);
      if (selectedId === id) api.markSelected(entry, true);
      var deployBtn = document.createElement("button");
      deployBtn.type = "button";
      deployBtn.className = "hq-order-btn";
      deployBtn.textContent = "Deploy";
      deployBtn.style.alignSelf = "stretch";
      deployBtn.style.width = "100%";
      deployBtn.style.padding = "8px 14px";
      deployBtn.style.fontSize = "12px";
      deployBtn.style.marginTop = "4px"; deployBtn.style.minHeight = "44px";
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
      grid.appendChild(wrap);
    }
  };

  // Build the Dynamic Compactor inventory entry (single reusable tool).
  api._buildCompactorEntry = function (grid) {
    var wrap = document.createElement("div");
    wrap.className = "hq-fs-inventory-item-wrap";
    wrap.style.marginBottom = "0";
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
      "display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;" +
      "padding:16px 14px 14px;background:#FFFBF0;" +
      "border:3px solid #2B2320;border-radius:16px;cursor:pointer;" +
      "box-shadow:3px 3px 0 #000;" +
      "transition:border-color 0.15s ease,background 0.15s ease;";
    var iconC = (window.Icons && window.Icons.get) ? window.Icons.get("compactor") : "";
    entry.innerHTML =
      '<span class="hq-inv-ico hq-inv-ico--lg" aria-hidden="true">' + iconC + '</span>' +
      '<span class="hq-fs-inventory-item-name" style="font-size:15px;font-weight:700;color:#7C7C74">Dynamic Compactor</span>' +
      '<span class="hq-inv-status" data-status>READY</span>';
    entry.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var w = this.closest(".hq-fs-inventory-item-wrap");
      if (w) api.selectItem(w); else api.selectItem(this);
    });
    api._makeSelectable(entry, "Dynamic Compactor compactor-1");
    // only show selected if this compactor is actually the selected item
    var compactorSelected = !!(window.GameState && window.GameState.inventory.selectedCompactorId === "compactor-1");
    api.markSelected(entry, compactorSelected);

    var deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "hq-order-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.style.alignSelf = "stretch";
    deployBtn.style.width = "100%";
    deployBtn.style.padding = "8px 14px";
    deployBtn.style.fontSize = "12px";
    deployBtn.style.marginTop = "4px"; deployBtn.style.minHeight = "44px";
    deployBtn.style.display = compactorSelected ? "" : "none";
    deployBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      api.deploySelected();
    });
    wrap.appendChild(entry);
    wrap.appendChild(deployBtn);
    grid.appendChild(wrap);
  };

  // Build the Repair Rig inventory entry (reusable swarm — same pattern as compactor)
  api._buildRepairEntry = function (grid) {
    var wrap = document.createElement("div");
    wrap.className = "hq-fs-inventory-item-wrap";
    wrap.style.marginBottom = "0";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "stretch";
    wrap.dataset.itemType = "repair";
    wrap.dataset.itemId = "repair-1";

    var entry = document.createElement("div");
    entry.className = "hq-fs-inventory-item";
    entry.dataset.itemType = "repair";
    entry.dataset.itemId = "repair-1";
    entry.style.cssText =
      "display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;" +
      "padding:16px 14px 14px;background:#FFFBF0;" +
      "border:3px solid #2B2320;border-radius:16px;cursor:pointer;" +
      "box-shadow:3px 3px 0 #000;" +
      "transition:border-color 0.15s ease,background 0.15s ease;";
    var iconR = (window.Icons && window.Icons.get) ? window.Icons.get("repair") : "";
    entry.innerHTML =
      '<span class="hq-inv-ico hq-inv-ico--lg" aria-hidden="true">' + iconR + '</span>' +
      '<span class="hq-fs-inventory-item-name" style="font-size:15px;font-weight:700;color:#C62828">Repair Rig</span>' +
      '<span class="hq-inv-status" data-status>READY</span>';
    entry.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var w = this.closest(".hq-fs-inventory-item-wrap");
      if (w) api.selectItem(w); else api.selectItem(this);
    });
    api._makeSelectable(entry, "Repair Rig repair-1");
    var repairSelected = !!(window.GameState && window.GameState.inventory.selectedRepairId === "repair-1");
    api.markSelected(entry, repairSelected);

    var deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "hq-order-btn";
    deployBtn.textContent = "Deploy";
    deployBtn.style.alignSelf = "stretch";
    deployBtn.style.width = "100%";
    deployBtn.style.padding = "8px 14px";
    deployBtn.style.fontSize = "12px";
    deployBtn.style.marginTop = "4px"; deployBtn.style.minHeight = "44px";
    deployBtn.style.display = repairSelected ? "" : "none";
    deployBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      api.deploySelected();
    });
    wrap.appendChild(entry);
    wrap.appendChild(deployBtn);
    grid.appendChild(wrap);
  };

  // Make a fleet entry operable without a mouse: toggle-button semantics
  // (Enter/Space activate, like the click path).
  api._makeSelectable = function (entry, name) {
    entry.setAttribute("role", "button");
    entry.setAttribute("tabindex", "0");
    entry.setAttribute("aria-label", name + " — activate to select");
    entry.setAttribute("aria-pressed", "false");
    entry.addEventListener("keydown", function (ev) {
      if (!ev) return;
      if (ev.key === "Enter" || ev.key === " ") {
        if (ev.preventDefault) ev.preventDefault();
        if (ev.stopPropagation) ev.stopPropagation();
        var w = this.closest ? this.closest(".hq-fs-inventory-item-wrap") : null;
        api.selectItem(w || this);
      }
    });
  };

  // Toggle the selected state of an inventory entry element.
  api.markSelected = function (entry, selected) {
    entry.style.borderColor = selected ? "#C7432B" : "#2B2320";
    entry.style.background = selected ? "#E4F5F6" : "#FFFBF0";
    entry.setAttribute("aria-pressed", selected ? "true" : "false");
    try {
      var st = entry.querySelector ? entry.querySelector("[data-status]") : null;
      if (st) {
        st.textContent = selected ? "SELECTED" : "READY";
        if (st.classList) st.classList.toggle("hq-inv-status--on", !!selected);
      }
    } catch (e) {}
  };

  // Select (or deselect) a survey-unit entry. Single-select across ALL fleets:
  // picking a unit of one type clears any selection of the other types; clicking
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
    else if (type === "repair") wasSelected = gs.inventory.selectedRepairId === id;

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
    gs.inventory.selectedRepairId = null;
    if (!wasSelected) {
      if (type === "drone") gs.inventory.selectedDroneId = id;
      else if (type === "gpr") gs.inventory.selectedGprId = id;
      else if (type === "compactor") gs.inventory.selectedCompactorId = id;
      else if (type === "repair") gs.inventory.selectedRepairId = id;
      var card = entry.querySelector ? entry.querySelector(".hq-fs-inventory-item") : entry;
      if (card) api.markSelected(card, true); else api.markSelected(entry, true);
      if (window.AudioManager) window.AudioManager.play("uiSelect");
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
                    (type === "compactor" && gs.selectedCompactorId === id) ||
                    (type === "repair" && gs.selectedRepairId === id);
        btn.style.display = isSel ? "" : "none";
      }
    }
    if (api.inventoryDeployContainer) {
      var hasSel = !!(gs.selectedDroneId || gs.selectedGprId || gs.selectedCompactorId || gs.selectedRepairId);
      api.inventoryDeployContainer.style.display = hasSel ? "" : "none";
    }
  };

  // Deploy whichever unit type is currently selected (drone, GPR, compactor, repair).
  api.deploySelected = function () {
    var gs = window.GameState.inventory;
    if (gs.selectedRepairId) api.deployRepair();
    else if (gs.selectedCompactorId) api.deployCompactor();
    else if (gs.selectedGprId) api.deployGpr();
    else if (gs.selectedDroneId) api.deployDrone();
  };

  // A scan already running blocks every other deploy: the input mode can
  // only represent one owner, so a second scan (or compactor) would desync
  // it. Reported on the panel's own message line — never a popup.
  function scanBusy() {
    try {
      return !!(window.InputHandler && window.InputHandler.isScanBusy && window.InputHandler.isScanBusy());
    } catch (e) { return false; }
  }

  // Wire the Deploy button to whole-map, no-click drone deployment. Closes the
  // terminal and immediately starts a full-map sweep (no placement mode, no
  // cursor preview, no click targeting). DroneDeploy.startDeployment handles
  // consuming the unit, clearing the selection and refreshing the STORE owned
  // count; the 8-chunk / 2-concurrent sweep runs on the map.
  api.deployDrone = function () {
    var id = window.GameState.inventory.selectedDroneId;
    if (!id) return;
    if (scanBusy()) { api.showMsg("A survey is already running — wait for it to finish", false, api.inventoryDeployContainer); return; }
    var started = !!(window.DroneDeploy && window.DroneDeploy.startDeployment());
    console.log("[HQ] Deploy: selected " + id + " -> " + (started ? "whole-map drone sweep started" : "deploy failed (no Drone Systems available)"));
    api._silentClose = true;
    if (api.isOpen) api.close();
    if (!started) api.showMsg("[DEPLOY] no Drone Systems available", false, api.inventoryDeployContainer);
  };

  // Wire the Deploy button to whole-map, no-click GPR deployment. Mirrors the
  // Drone deploy: consumes one GPR unit, marks tiles subsurface-scanned, runs a
  // ground radar sweep on the map.
  api.deployGpr = function () {
    var id = window.GameState.inventory.selectedGprId;
    if (!id) return;
    if (scanBusy()) { api.showMsg("A survey is already running — wait for it to finish", false, api.inventoryDeployContainer); return; }
    var started = !!(window.GprDeploy && window.GprDeploy.startDeployment());
    console.log("[HQ] Deploy GPR: selected " + id + " -> " + (started ? "whole-map GPR sweep started" : "deploy failed (no GPR Systems available)"));
    api._silentClose = true;
    if (api.isOpen) api.close();
    if (!started) api.showMsg("[DEPLOY] no GPR Systems available", false, api.inventoryDeployContainer);
  };

  // Deploy the Dynamic Compactor — triggers the CompactorTool placement mode.
  // The CompactorTool handles the animation sequence and stability update.
  api.deployCompactor = function () {
    var id = window.GameState.inventory.selectedCompactorId;
    if (!id) return;
    if (scanBusy()) { api.showMsg("A survey is already running — wait for it to finish", false, api.inventoryDeployContainer); return; }
    console.log("[HQ] Deploy Compactor: selected " + id + " -> entering placement mode");
    if (window.AudioManager) window.AudioManager.play("uiClick");
    if (window.CompactorTool) window.CompactorTool.startPlacement();
    api._silentClose = true;
    if (api.isOpen) api.close();
  };

  // Deploy the Repair Rig — triggers the RepairTool placement mode (hazard fixer).
  api.deployRepair = function () {
    var id = window.GameState.inventory.selectedRepairId;
    if (!id) return;
    if (scanBusy()) { api.showMsg("A survey is already running — wait for it to finish", false, api.inventoryDeployContainer); return; }
    console.log("[HQ] Deploy Repair Rig: selected " + id + " -> entering placement mode");
    if (window.RepairTool) window.RepairTool.startPlacement();
    api._silentClose = true;
    if (api.isOpen) api.close();
  };

  // (Zoning lives in the DATA tab mini-map now — no standalone tab, no
  // placement mode. See DESIGNATE ZONE in js/dataMap.js + js/zoningTool.js.)

  api.showMsg = function (text, success, container) {
    var holder = container || null;
    if (!api.msgEl) {
      api.msgEl = document.createElement("div");
      api.msgEl.setAttribute("role", "status");
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
    api.msgEl.style.color = success ? "#C7432B" : "#FFA000";
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

})();