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
  ];

  var barEl = null;
  var itemsEl = null;

  function itemById(id) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].id === id) return ITEMS[i];
    }
    return null;
  }

  function buildCard(item) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "build-item";
    card.dataset.id = item.id;

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
    card.addEventListener("click", function () { api.select(item.id); });
    return card;
  }

  api.init = function () {
    barEl = document.getElementById("build-bar");
    itemsEl = document.getElementById("build-items");
    if (!barEl || !itemsEl) return;
    itemsEl.innerHTML = "";
    for (var i = 0; i < ITEMS.length; i++) itemsEl.appendChild(buildCard(ITEMS[i]));
    api.refresh();
  };

  // select a building: close the bar and start placement mode through the
  // building's module (keeps the framework open for future buildings)
  api.select = function (id) {
    var item = itemById(id);
    if (!item) return;
    var module = item.module && item.module();
    if (!module || typeof module.startPlacement !== "function") return;
    api.selected = id;
    api.close();
    module.startPlacement();
    if (window.InputHandler) window.InputHandler.setPlacementMode(true);
    api.refresh();
  };

  // cancel any in-progress placement and close the bar
  api.cancel = function () {
    var item = api.selected ? itemById(api.selected) : null;
    if (item) {
      var module = item.module && item.module();
      if (module && typeof module.cancel === "function") module.cancel();
    }
    api.selected = null;
    if (window.InputHandler) window.InputHandler.setPlacementMode(false);
    api.close();
  };

  // called after a building is successfully placed
  api.onBuildSuccess = function () {
    api.selected = null;
    api.isOpen = false;
    if (barEl) {
      if (typeof anime !== "undefined" && anime) anime.remove(barEl);
      barEl.classList.add("hidden");
      // reset inline styles so next open animates from correct start
      barEl.style.opacity = "";
      barEl.style.transform = "";
    }
    api.refresh();
    if (window.InputHandler) window.InputHandler.setPlacementMode(false);
  };

  api.isPlacing = function () { return api.selected !== null; };

  api.open = function () {
    if (!barEl) return;
    api.isOpen = true;
    barEl.classList.remove("hidden");
    api.refresh();
    if (typeof anime !== "undefined" && anime) {
      anime.remove(barEl);
      anime.set(barEl, { translateY: 16, opacity: 0 });
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
    if (typeof anime !== "undefined" && anime) {
      anime({
        targets: barEl,
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
    var hqBuilt = !!(window.GameState && window.GameState.hqBuilt);
    var cards = itemsEl.querySelectorAll(".build-item");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      card.disabled = !!hqBuilt;
      card.classList.toggle("selected", api.selected === card.dataset.id);
    }
  };

  return api;
})();
