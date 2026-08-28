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
        '<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" style="display:block;background:transparent">' +
        '<g stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M8 44 L24 36 L40 44 L24 48 Z" fill="#F8FAFC"/>' +
        '<path d="M8 44 L24 48 L24 36 Z" fill="#E2E8F0"/>' +
        '<path d="M40 44 L24 48 L24 36 Z" fill="#CBD5E1"/>' +
        '<path d="M8 44 L24 36 L40 44 L24 48 Z" fill="none" stroke="#0F172A" stroke-width="2.4"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M24 26 L34 31 L34 38 L24 33 Z" fill="#E2E8F0"/>' +
        '<path d="M14 31 L24 26 L24 33 L14 38 Z" fill="#F8FAFC"/>' +
        '<path d="M14 31 L24 26 L34 31 L24 36 Z" fill="#2563EB" stroke="#0F172A" stroke-width="1.6"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M24 20 L32 24 L32 30 L24 26 L16 30 L16 24 Z" fill="#F8FAFC"/>' +
        '<path d="M32 24 L32 30 L24 26 L24 20 Z" fill="#E2E8F0"/>' +
        '<path d="M16 30 L24 26 L24 20 L16 24 Z" fill="#F8FAFC"/>' +
        '<path d="M16 24 L24 20 L32 24 L24 28 Z" fill="#2563EB" stroke="#0F172A" stroke-width="1.6"/>' +
        '<rect x="18" y="22.8" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="21" y="22.8" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="24" y="22.8" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="27" y="22.8" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="18" y="26.4" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="21" y="26.4" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="24" y="26.4" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="27" y="26.4" width="2.4" height="3.2" rx="0.4" fill="#FDE68A" stroke="#0F172A" stroke-width="0.9"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M18 17 L24 14 L30 17 L24 20 Z" fill="#1E293B"/>' +
        '<path d="M18 17 L24 20 L24 21.5 L18 18.5 Z" fill="#0F172A"/>' +
        '<path d="M24 20 L30 17 L30 18.5 L24 21.5 Z" fill="#1E293B"/>' +
        '<text x="24" y="18.8" text-anchor="middle" font-family=&apos;Baloo 2&apos;,sans-serif font-size="4.5" font-weight="900" fill="#FDE68A">H</text>' +
        '<rect x="21.6" y="9.5" width="2" height="5.8" rx="0.5" fill="#0F172A"/>' +
        '<circle cx="22.6" cy="8.5" r="3" fill="#1E293B" stroke="#0F172A" stroke-width="1.2"/>' +
        '<path d="M23.8 7 A3 3 0 0 0 21 7 A2.2 2.2 0 0 1 23.8 7" fill="#EF4444" stroke="none"/>' +
        '<circle cx="22" cy="7.8" r="0.8" fill="white" opacity="0.9"/>' +
        '</g>' +
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
