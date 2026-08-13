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
        api.gprOwnedEl.style.color = "#9A4CFF";
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
    if (name === "data") {
      api.initDataMap();
      if (api.refreshDataMap) api.refreshDataMap();
    }
  };

  // ---- DATA tab: isometric survey map -------------------------------------
  api._dataMapInit = false;
  api._dataMapAnim = null;

  api.initDataMap = function () {
    if (api._dataMapInit) return;
    api._dataMapInit = true;

    var canvas = document.getElementById("hq-data-map");
    var select = document.getElementById("hq-data-layer");
    var legendEl = document.getElementById("hq-data-legend");
    var legendToggle = document.getElementById("hq-data-legend-toggle");
    var summaryEl = document.getElementById("hq-data-summary");

    if (!canvas || !window.LandData || !window.IsoGrid) return;

    var ctx = canvas.getContext("2d");
    var grid = window.IsoGrid;
    var iso = grid.isoSize;
    var half = iso / 2;

    // match the panel's internal scale (css pixels) — canvas is 600x600
    var cs = 600;
    canvas.width = cs;
    canvas.height = cs;
    canvas.style.width = cs + "px";
    canvas.style.height = cs + "px";

    var UNKNOWN = "#2a2038"; // gray for "no data yet" tiles
    var layers = [
      { id: "terrain", name: "Terrain", getColor: function (t) { return window.LandData.TERRAIN_COLORS[t.terrain] || "#333"; } },
      { id: "quality", name: "Soil Quality", getColor: function (t) { return t.quality != null ? window.LandData.getQualityColor(t.quality) : UNKNOWN; } },
      { id: "stability", name: "Stability", getColor: function (t) { return t.stability != null ? window.LandData.getStabilityColor(t.stability) : UNKNOWN; } },
      { id: "water", name: "Water Table", getColor: function (t) { return t.waterTable != null ? window.LandData.getWaterColor(t.waterTable) : UNKNOWN; } },
      { id: "mineral", name: "Minerals", getColor: function (t) { return t.mineral ? (window.LandData.MINERAL_COLORS[t.mineral] || UNKNOWN) : UNKNOWN; } },
      { id: "scanned", name: "Aerial Survey", getColor: function (t) { return t.scanned ? "#00cc66" : "#2a2038"; } },
      { id: "subsurface", name: "GPR Survey", getColor: function (t) { return t.subsurfaceScanned ? "#B14CFF" : "#2a2038"; } }
    ];

    var currentLayer = 0;

    function drawMap() {
      ctx.clearRect(0, 0, cs, cs);
      // center the 20x20 grid in the 600x600 canvas
      var originX = cs / 2;
      var originY = cs / 2 - (GRID_SIZE - 1) * half / 2;

      var tiles = window.LandData.getAllTiles();

      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var p = grid.worldToScreen(t.col, t.row);
        // convert grid screen coords to canvas coords
        var cx = originX + p.x;
        var cy = originY + p.y - t.elevation; // elevation raises the tile

        var layer = layers[currentLayer];
        var color = layer.getColor(t);

        // draw diamond (tile top face)
        ctx.beginPath();
        ctx.moveTo(cx, cy - half);
        ctx.lineTo(cx + iso, cy);
        ctx.lineTo(cx, cy + half);
        ctx.lineTo(cx - iso, cy);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // subtle grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // HQ marker
        if (t.isHQ) {
          ctx.fillStyle = "#ffcc00";
          ctx.beginPath();
          ctx.arc(cx, cy - half - 4, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function renderSummary() {
      if (!summaryEl) return;
      var s = window.LandData.getSummary();
      var tc = s.terrainCounts;
      summaryEl.innerHTML =
        '<div class="hq-data-summary-row"><span>Aerial Survey (Drone)</span><strong>' + s.scannedTiles + ' / ' + s.totalTiles + ' (' + s.scannedPct + '%)</strong></div>' +
        '<div class="hq-data-summary-row"><span>Subsurface (GPR)</span><strong>' + s.subsurfaceTiles + ' / ' + s.totalTiles + ' (' + s.subsurfacePct + '%)</strong></div>' +
        '<div class="hq-data-summary-row"><span>Avg Soil Quality</span><strong>' + s.avgQuality + '/100</strong></div>' +
        '<div class="hq-data-summary-row"><span>Avg Stability</span><strong>' + s.avgStability + '/100</strong></div>' +
        '<div class="hq-data-summary-row"><span>Avg Water Table</span><strong>' + s.avgWaterTable + 'm</strong></div>' +
        '<div class="hq-data-summary-row"><span>Land / Hill / River / Trench / HQ</span><strong>' + tc.land + ' / ' + tc.hill + ' / ' + tc.river + ' / ' + tc.trench + ' / ' + tc.hq + '</strong></div>' +
        '<div class="hq-data-summary-row"><span>Minerals Found</span><strong>Iron: ' + s.mineralCounts.iron + '  Copper: ' + s.mineralCounts.copper + '  Gold: ' + s.mineralCounts.gold + '</strong></div>';
    }

    function animateLayerSwitch() {
      if (api._dataMapAnim) api._dataMapAnim.pause();
      var layer = layers[currentLayer];
      // fade out canvas, swap, fade in
      api._dataMapAnim = anime({
        targets: canvas,
        opacity: [1, 0],
        duration: 150,
        easing: "easeOutQuad",
        complete: function () {
          drawMap();
          anime({
            targets: canvas,
            opacity: [0, 1],
            duration: 250,
            easing: "easeOutCubic"
          });
        }
      });
      // animate layer label
      var title = document.querySelector(".hq-data-map-title");
      if (title) {
        anime({
          targets: title,
          opacity: [1, 0, 1],
          translateY: [0, -8, 0],
          duration: 300,
          easing: "easeOutCubic"
        });
      }
    }

    function updateLegend() {
      if (!legendEl) return;
      var layer = layers[currentLayer];
      var html = '<div class="hq-data-legend-title">' + layer.name + '</div>';

      if (layer.id === "terrain") {
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#4a5a3a"></span>Land</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#7a6a4a"></span>Hill</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#1a5a8a"></span>River</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#2a1a3a"></span>Trench</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#ffcc00"></span>HQ</div>';
      } else if (layer.id === "mineral") {
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#a05030"></span>Iron</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#b87333"></span>Copper</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#ffd700"></span>Gold</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:repeating-linear-gradient(45deg,transparent,transparent 5px,#333 5px,#333 10px)"></span>None</div>';
      } else if (layer.id === "scanned") {
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#00cc66"></span>Aerial surveyed (Drone)</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#2a2038"></span>Not surveyed</div>';
      } else if (layer.id === "subsurface") {
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#B14CFF"></span>GPR surveyed (subsurface)</div>';
        html += '<div class="hq-data-legend-row"><span class="hq-data-legend-swatch" style="background:#2a2038"></span>Not GPR-scanned</div>';
      } else {
        // gradient bar for continuous values
        var stops = 5;
        var grad = 'linear-gradient(to right, ';
        if (layer.id === "quality") {
          grad += '#2a2038, #4a3068, #007b8f, #00b87c, #7fff4f';
        } else if (layer.id === "stability") {
          grad += '#381010, #8b2020, #cc7700, #007b40, #00cc66';
        } else if (layer.id === "water") {
          grad += '#081830, #0a3060, #0060a0, #00a0d0, #40d0ff';
        }
        grad += ')';
        html += '<div class="hq-data-legend-gradient" style="background:' + grad + '"></div>';
        html += '<div class="hq-data-legend-labels"><span>Low</span><span>High</span></div>';
      }
      legendEl.innerHTML = html;
    }

    // initial draw
    drawMap();
    renderSummary();
    updateLegend();

    // expose a lightweight redraw so re-opening the DATA tab (after a Drone or
    // GPR sweep has marked more tiles) refreshes the map + summary live.
    api.refreshDataMap = function () {
      drawMap();
      renderSummary();
      if (legendEl) updateLegend();
    };

    // layer select
    if (select) {
      select.addEventListener("change", function () {
        currentLayer = layers.findIndex(function (l) { return l.id === select.value; });
        animateLayerSwitch();
        updateLegend();
      });
    }

    // legend toggle
    if (legendToggle && legendEl) {
      legendToggle.addEventListener("click", function () {
        legendEl.classList.toggle("hidden");
        var open = !legendEl.classList.contains("hidden");
        anime({
          targets: legendEl,
          opacity: [open ? 0 : 1, open ? 1 : 0],
          height: open ? [0, "auto"] : ["auto", 0],
          duration: 200,
          easing: "easeOutCubic"
        });
      });
    }

    // initial entrance animation
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: canvas,
        opacity: [0, 1],
        scale: [0.95, 1],
        duration: 500,
        easing: "easeOutCubic"
      });
      anime({
        targets: ".hq-data-map-header, .hq-data-summary",
        opacity: [0, 1],
        translateY: [10, 0],
        delay: anime.stagger(80),
        duration: 400,
        easing: "easeOutCubic"
      });
    }
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
    api.inventorySection.appendChild(deployBox);
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
      var accent = type === "gpr" ? "#9A4CFF" : "#2D3561";
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
    // close the terminal so the map is interactive and the sweep is visible
    if (api.isOpen) api.close();
    if (!started) {
      api.showMsg("[DEPLOY] no Drone Systems available", false, api.inventoryDeployContainer);
    }
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
    if (!started) {
      api.showMsg("[DEPLOY] no GPR Systems available", false, api.inventoryDeployContainer);
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
