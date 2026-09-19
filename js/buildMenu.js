/* js/buildMenu.js — build palette (toggle bar): opens when the player
 * clicks "Build" and lists every placeable building as a card
 * (icon + name + cost). Clicking a card selects it and enters placement
 * mode through that building's module. The ITEMS registry is the
 * framework: future buildings only need to add an entry here — the bar
 * renders whatever the registry contains.
 */

window.BuildMenu = (function () {
  var api = {
    isOpen: false,
    selected: null, // id of the building currently in placement mode
    hoverTile: null,
  };

  // ---- building registry (framework) ----------------------------------
  // Each entry: id, name, desc, cost, icon (inline SVG), module() -> the
  // builder module that owns placement/validation/cash. Modules must
  // expose startPlacement()/cancel()/isValid()/attempt() like HQBuild.
var ITEMS = [
    {
      id: "hq",
      name: "ConTech HQ",
      desc: "Site command center — unlocks site data.",
      cost: (window.GameState && window.GameState.hqCost) || 10000,
      icon:
        '<svg viewBox="0 0 100 100" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">' +
        '<path d="M 18 70 L 50 86 L 50 66 L 18 50 Z" fill="#F1F5F9" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 50 86 L 82 70 L 82 50 L 50 66 Z" fill="#FFFFFF" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 50 34 L 82 50 L 50 66 L 18 50 Z" fill="#3B82F6" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 32 50 L 50 59 L 50 29 L 32 20 Z" fill="#E2E8F0" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 50 59 L 68 50 L 68 20 L 50 29 Z" fill="#F8FAFC" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 37 48.5 L 45 52.5 L 45 40.5 L 37 36.5 Z" fill="#FDE047"/>' +
        '<path d="M 55 52.5 L 63 48.5 L 63 36.5 L 55 40.5 Z" fill="#FDE047"/>' +
        '<path d="M 50 11 L 68 20 L 50 29 L 32 20 Z" fill="#2563EB" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M 50 13 L 60 18 L 50 23 L 40 18 Z" fill="#334155" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<text x="50" y="21.5" font-size="9" font-family="sans-serif" font-weight="900" text-anchor="middle" fill="#FDE047" style="transform:scale(1,0.5);transform-origin:50px 21px">H</text>' +
        '<path d="M 35 22 L 35 12" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="35" cy="12" r="2.5" fill="#EF4444" stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
        '</svg>',
      module: function () { return window.HQBuild; },
    },
    { id: "road", name: "Road", desc: "Connects zoned land to the city network.", cost: 75,
      icon: '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><clipPath id="bb-road-clip"><path d="M20 4 L36 20 L20 36 L4 20 Z"/></clipPath></defs><path d="M20 4 L36 20 L20 36 L4 20 Z" fill="#DCE1E6"/><g clip-path="url(#bb-road-clip)"><rect x="2" y="14" width="36" height="12" fill="#565F6B"/><path d="M6 20 L34 20" stroke="#FDE68A" stroke-width="3" stroke-dasharray="6 4" stroke-linecap="round"/></g><path d="M20 4 L36 20 L20 36 L4 20 Z" fill="none" stroke="#2B2320" stroke-width="2" stroke-linejoin="round"/></svg>',
      road: true, module: function () { return window.RoadTool; } },
    { id: "small-house", name: "Small House", zone: "residential", cost: 150, sprite: "buildingTiles_000.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_000.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "townhouse", name: "Townhouse", zone: "residential", cost: 250, sprite: "buildingTiles_008.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_008.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "apartment-block", name: "Apartment Block", zone: "residential", cost: 450, sprite: "buildingTiles_009.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_009.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "corner-shop", name: "Corner Shop", zone: "commercial", cost: 200, sprite: "buildingTiles_030.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_030.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "market", name: "Market", zone: "commercial", cost: 350, sprite: "buildingTiles_080.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_080.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "retail-center", name: "Retail Center", zone: "commercial", cost: 600, sprite: "buildingTiles_090.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_090.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "workshop", name: "Workshop", zone: "industrial", cost: 250, sprite: "buildingTiles_100.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_100.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "factory", name: "Factory", zone: "industrial", cost: 500, sprite: "buildingTiles_110.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_110.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "industrial-plant", name: "Industrial Plant", zone: "industrial", cost: 750, sprite: "buildingTiles_120.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_120.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "mine-shaft", name: "Mine Shaft", zone: "mining", cost: 300, sprite: "buildingTiles_085.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_085.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "open-pit-mine", name: "Open Pit Mine", zone: "mining", cost: 500, sprite: "buildingTiles_092.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_092.png" alt="">', module: function () { return window.BuildMenu; } },
    { id: "quarry", name: "Quarry", zone: "mining", cost: 700, sprite: "buildingTiles_106.png", icon: '<img src="assets/kenney-buildings/PNG/buildingTiles_106.png" alt="">', module: function () { return window.BuildMenu; } },
  ];

  var barEl = null;
  var itemsEl = null;
  var cancelEl = null;
  var hudCancelEl = null;
  var categoryEl = null;
  var prevEl = null;
  var nextEl = null;
  var activeCategory = "all";

  // Desktop centers the bar with left:50% + translateX(-50%) (see the final
  // .build-bar override in css/style.css); every other layout pins explicit
  // left/right with transform:none. Anime rewrites the inline transform, so
  // the open/close tweens must carry the -50% themselves on desktop — without
  // it the open bar sits at left:50% unshifted, half off-screen to the right.

  function needsCenterX() {
    try {
      if (document.body && document.body.classList.contains("touch-ui")) return false;
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) return false;
    } catch (e) {}
    return true;
  }

  function updateArrows() {
    if (!itemsEl) return;
    var max = itemsEl.scrollWidth - itemsEl.clientWidth;
    if (prevEl) prevEl.disabled = itemsEl.scrollLeft <= 1;
    if (nextEl) nextEl.disabled = itemsEl.scrollLeft >= max - 1;
  }

  function stepStrip(dir) {
    if (!itemsEl) return;
    var card = itemsEl.querySelector(".build-item");
    var step = card ? card.getBoundingClientRect().width + 8 : 240;
    try { itemsEl.scrollBy({ left: dir * step * 2, behavior: "smooth" }); }
    catch (e) { itemsEl.scrollLeft += dir * step * 2; }
  }

  function categoryFor(item) {
    if (item.road) return "transport";
    if (item.zone) return item.zone;
    return "essentials";
  }

  function itemById(id) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].id === id) return ITEMS[i];
    }
    return null;
  }

  function sameZone(left, right) {
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function buildCard(item) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "build-item";
    card.dataset.id = item.id;
    if (item.zone) card.dataset.zone = item.zone;

    var icon = document.createElement("span");
    icon.className = "build-item-icon";
    icon.innerHTML = item.icon || "";

    var info = document.createElement("span");
    info.className = "build-item-info";
    var name = document.createElement("span");
    name.className = "build-item-name";
    name.textContent = item.name;
    var cost = document.createElement("span");
    cost.className = "build-item-cost";
    cost.textContent = "$" + Number(item.cost).toLocaleString();
    info.appendChild(name);
    info.appendChild(cost);

    card.appendChild(icon);
    card.appendChild(info);
    card.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      api.select(item.id);
    });
    return card;
  }

  api.init = function () {
    barEl = document.getElementById("build-bar");
    itemsEl = document.getElementById("build-items");
    cancelEl = document.getElementById("build-cancel-btn");
    hudCancelEl = document.getElementById("hud-cancel-btn");
    categoryEl = document.getElementById("build-categories");
    prevEl = document.getElementById("build-prev");
    nextEl = document.getElementById("build-next");
    if (!barEl || !itemsEl) return;
    if (cancelEl) cancelEl.addEventListener("click", function () { api.cancel(); });
    if (hudCancelEl) hudCancelEl.addEventListener("click", function () { api.cancel(); });
    if (prevEl) prevEl.addEventListener("click", function () { stepStrip(-1); });
    if (nextEl) nextEl.addEventListener("click", function () { stepStrip(1); });
    if (itemsEl) itemsEl.addEventListener("scroll", updateArrows);
    if (categoryEl) {
      categoryEl.addEventListener("click", function (event) {
        var button = event.target.closest(".build-category");
        if (!button) return;
        activeCategory = button.dataset.category || "all";
        var tabs = categoryEl.querySelectorAll(".build-category");
        for (var t = 0; t < tabs.length; t++) {
          var selected = tabs[t] === button;
          tabs[t].classList.toggle("is-active", selected);
          tabs[t].setAttribute("aria-selected", selected ? "true" : "false");
        }
        api.refresh();
      });
    }
    itemsEl.innerHTML = "";
    for (var i = 0; i < ITEMS.length; i++) itemsEl.appendChild(buildCard(ITEMS[i]));
    api.refresh();
  };

  // select a building: close the bar and start placement mode through the
  // building's module (keeps the framework open for future buildings).
  // Refused while a drone/GPR scan is running: stealing the deploying-drone
  // mode mid-scan desyncs it (scan finish would orphan this placement into
  // a stuck CANCEL). Browsing the bar stays allowed — only picking is gated.
  api.select = function (id) {
    // silent safety net: the cards render disabled + titled while a scan
    // runs (see refresh), so this is unreachable by click — no popup needed.
    try {
      if (window.InputHandler && window.InputHandler.isScanBusy && window.InputHandler.isScanBusy()) return;
    } catch (e) {}
    var item = itemById(id);
    if (!item) return;
    var module = item.module && item.module();
    if (!module || typeof module.startPlacement !== "function") return;
    api.selected = id;
    api.close();
    module.startPlacement();
    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode(item.road ? 'placing-road' : (item.zone ? 'placing-building' : 'placing-hq'));
    }
    else if (window.InputHandler) window.InputHandler.setPlacementMode(true);
    api.refresh();
  };

  // cancel any in-progress placement and close the bar
  api.cancel = function () {
    var item = api.selected ? itemById(api.selected) : null;
    if (item) {
      var module = item.module && item.module();
      if (module && module !== api && typeof module.cancel === "function") module.cancel();
    }
    var wasPlacingRoad = !!(item && item.road);
    api.selected = null;
    api.hoverTile = null;
    if (window.InputHandler && window.InputHandler.setMode) window.InputHandler.setMode('idle');
    else if (window.InputHandler) window.InputHandler.setPlacementMode(false);
    // Road cancel flicker: bar is already closed (isOpen=false) during placement, so
    // animating close again flashes it visible for 180ms. Skip animation when already closed.
    if (wasPlacingRoad && !api.isOpen) {
      if (barEl) {
        if (typeof anime !== "undefined" && anime) anime.remove(barEl);
        barEl.classList.add("hidden");
        barEl.style.opacity = "";
        barEl.style.transform = "";
        barEl.style.transition = "";
      }
    } else {
      api.close();
    }
    api.refresh();
  };

  // called after a building is successfully placed
  api.onBuildSuccess = function () {
    api.selected = null;
    api.hoverTile = null;
    api.isOpen = false;
    if (barEl) {
      if (typeof anime !== "undefined" && anime) anime.remove(barEl);
      barEl.classList.add("hidden");
      // reset inline styles so next open animates from correct start
      barEl.style.opacity = "";
      barEl.style.transform = "";
    }
    api.refresh();
    if (window.InputHandler && window.InputHandler.setMode) window.InputHandler.setMode('idle');
    else if (window.InputHandler) window.InputHandler.setPlacementMode(false);
  };

  api.isPlacing = function () { return api.selected !== null; };
  api.setHover = function (tile) {
    api.hoverTile = tile || null;
    if (window.BlockRender) window.BlockRender.invalidate();
  };
  api.startPlacement = function () {};
  api.items = function () { return ITEMS.slice(); };
  api.hasAvailableTiles = function () {
    for (var k in (window.GameState && window.GameState.tileData || {})) {
      if (window.GameState.tileData[k].zoneType && !window.GameState.tileData[k].zoneBuilding) return true;
    }
    return false;
  };
  api.isValid = function (c, r) {
    var item = itemById(api.selected), d = window.GameState && window.GameState.getTileData(c, r);
    var connected = !window.ZoningTool || !window.ZoningTool.hasRoadAccess ||
      window.ZoningTool.hasRoadAccess(c, r);
    return !!(item && item.zone && d && sameZone(d.zoneType, item.zone) && !d.zoneBuilding &&
      !d.construction && !d.curtain &&
      !(window.GameState.roads && window.GameState.roads[c + "," + r]) && connected);
  };
  api.attempt = function (c, r) {
    var item = itemById(api.selected);
    if (item && item.road) return window.RoadTool && window.RoadTool.attempt(c, r);
    if (!item || !api.isValid(c, r) || !window.GameState || window.GameState.cash < item.cost) return false;
    if (!window.GameState.spend(item.cost, item.name)) return false;
    // cash is gone now, but the building is NOT instant: the tile enters the
    // construction phase (robot + printer animation) and zoneBuilding lands
    // when Construction.update() completes it a few seconds later.
    if (window.Construction) window.Construction.begin(c, r, item);
    else {
      window.GameState.getTileData(c, r).zoneBuilding = item.id;
      window.GameState.getTileData(c, r).buildingSprite = item.sprite;
    }
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.BlockRender) window.BlockRender.invalidate();
    api.onBuildSuccess();
    return true;
  };

  // Headless captures (index.html#shot=*) run under virtual time, where tween
  // engines stall mid-fade. Like the HQ panels, the bar applies its final
  // state synchronously in shot mode. Zero effect on the real flow.
  function isShot() {
    try {
      if (window.__SHOT) return true;
      var h = (window.location && window.location.hash) || "";
      return h.indexOf("#shot") === 0;
    } catch (e) { return false; }
  }

  api.open = function () {
    if (!barEl) return;
    api.isOpen = true;
    barEl.classList.remove("hidden");
    api.refresh();
    if (isShot()) {
      try {
        // kill the CSS fade/slide too: under virtual time it can freeze
        // mid-transition even with the tween engine skipped
        barEl.style.transition = "none";
        barEl.style.opacity = "1";
        barEl.style.transform = needsCenterX() ? "translateX(-50%)" : "";
        var scards = barEl.querySelectorAll(".build-item");
        for (var si = 0; si < scards.length; si++) {
          scards[si].style.opacity = "1";
          scards[si].style.transform = "";
        }
      } catch (e) {}
      return;
    }
    if (typeof anime !== "undefined" && anime) {
      anime.remove(barEl);
      anime.set(barEl, { translateX: needsCenterX() ? "-50%" : "0%", translateY: 16, opacity: 0 });
      anime({
        targets: barEl,
        translateY: [16, 0],
        opacity: [0, 1],
        duration: 280,
        easing: "easeOutCubic"
      });
      var cards = barEl.querySelectorAll(".build-item");
      if (cards.length) {
        anime.set(cards, { translateY: 8, opacity: 0 });
        anime({
          targets: cards,
          translateY: [8, 0],
          opacity: [0, 1],
          delay: anime.stagger(60),
          duration: 260,
          easing: "easeOutCubic"
        });
      }
    }
  };

  api.close = function () {
    if (!barEl) return;
    api.isOpen = false;
    if (isShot()) {
      try {
        if (typeof anime !== "undefined" && anime) anime.remove(barEl);
      } catch (e) {}
      barEl.classList.add("hidden");
      barEl.style.opacity = "";
      barEl.style.transform = "";
      barEl.style.transition = "";
      return;
    }
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: barEl,
        translateX: needsCenterX() ? "-50%" : "0%",
        translateY: [0, 12],
        opacity: [1, 0],
        duration: 180,
        easing: "easeInCubic",
        complete: function () {
          barEl.classList.add("hidden");
          barEl.style.opacity = "";
          barEl.style.transform = "";
        }
      });
      return;
    }
    barEl.classList.add("hidden");
  };

  api.toggle = function () {
    if (api.isOpen) api.close();
    else api.open();
  };

  // reflect current state on the cards: selection highlight + disabled
  // once the HQ is built (future buildings will add their own rules)
  api.refresh = function () {
    if (!itemsEl) return;
    if (cancelEl) cancelEl.hidden = !api.isPlacing();
    if (hudCancelEl) hudCancelEl.style.display = api.isPlacing() ? "" : "none";
    // while a drone/GPR scan runs, every card shows locked with the reason —
    // the menu's own language for "not now", no popup required.
    var scanBusy = false;
    try {
      scanBusy = !!(window.InputHandler && window.InputHandler.isScanBusy && window.InputHandler.isScanBusy());
    } catch (e) {}
    var cards = itemsEl.querySelectorAll(".build-item");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var item = itemById(card.dataset.id);
      var categoryVisible = activeCategory === "all" || categoryFor(item) === activeCategory;
      var hasZone = false;
      if (item.zone && window.GameState && window.GameState.tileData) {
        for (var k in window.GameState.tileData) {
          var d = window.GameState.tileData[k];
          if (sameZone(d.zoneType, item.zone) && !d.zoneBuilding && !d.construction && !d.curtain) { hasZone = true; break; }
        }
      }
      // Reference look (city-builder toolbar): the strip always shows the full
      // roster — locked tools stay visible but disabled, never hidden, so the
      // rail reads dense instead of empty. Placement gating is untouched
      // (isValid/attempt still enforce zone + road rules).
      card.hidden = !categoryVisible;
      card.disabled = scanBusy || (item.zone ? !hasZone : (!!(window.GameState && window.GameState.hqBuilt) && !item.road));
      if (scanBusy) {
        card.title = "Survey in progress — wait for the scan to finish";
        card.setAttribute("aria-label", item.name + ", " + Number(item.cost).toLocaleString() + " dollars, disabled while surveying");
      } else if (item.zone && !hasZone) {
        card.title = "Zone land first to unlock " + item.name;
        card.setAttribute("aria-label", item.name + ", " + Number(item.cost).toLocaleString() + " dollars, zone land required");
      } else {
        card.removeAttribute("title");
        card.setAttribute("aria-label", item.name + ", " + Number(item.cost).toLocaleString() + " dollars");
      }
      card.classList.toggle("selected", api.selected === card.dataset.id);
    }
    updateArrows();
  };

  return api;
})();
