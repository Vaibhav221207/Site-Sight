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
        '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" style="display:block">' +
        '<rect x="2" y="2" width="36" height="36" rx="9" fill="#1E293B" stroke="#0F172A" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<g stroke="#0F172A" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M20 24.5 L30 30.2 L30 34.8 L20 29.1 Z" fill="#E2E8F0"/><path d="M10 30.2 L20 24.5 L20 29.1 L10 34.8 Z" fill="#F8FAFC"/>' +
        '<path d="M10 30.2 L20 24.5 L30 30.2 L20 35.9 Z" fill="#2A3647" stroke="#0F172A" stroke-width="1.2"/>' +
        '<path d="M10 30.2 L20 24.5 L20 29.1 L10 34.8 Z" fill="none"/><path d="M30 30.2 L30 34.8 L20 29.1 L20 24.5 Z" fill="none"/>' +
        '<path d="M20 19.8 L30 25.5 L30 30.2 L20 24.5 Z" fill="#E2E8F0"/><path d="M10 25.5 L20 19.8 L20 24.5 L10 30.2 Z" fill="#F8FAFC"/>' +
        '<path d="M10 25.5 L20 19.8 L30 25.5 L20 31.2 Z" fill="#2563EB" stroke="#0F172A" stroke-width="1.3"/>' +
        '<rect x="12.2" y="26.8" width="5.8" height="4.2" rx="0.6" fill="#1E293B" stroke="#0F172A" stroke-width="0.9"/><rect x="22" y="26.8" width="5.8" height="4.2" rx="0.6" fill="#1E293B" stroke="#0F172A" stroke-width="0.9"/>' +
        '<rect x="12.2" y="28.4" width="5.8" height="1.3" fill="#F97316" rx="0.3"/><rect x="22" y="28.4" width="5.8" height="1.3" fill="#F97316" rx="0.3"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M20 9.2 L27.2 13.3 L27.2 22.5 L20 26.6 L12.8 22.5 L12.8 13.3 Z" fill="#F8FAFC"/>' +
        '<path d="M27.2 13.3 L27.2 22.5 L20 26.6 L20 17.4 Z" fill="#E2E8F0"/>' +
        '<path d="M12.8 22.5 L20 26.6 L20 17.4 L12.8 13.3 Z" fill="#F8FAFC"/>' +
        '<path d="M12.8 13.3 L20 9.2 L27.2 13.3 L20 17.4 Z" fill="#2563EB"/>' +
        '<rect x="14.4" y="15.1" width="3.4" height="4.2" rx="0.6" fill="#FDE68A" stroke="#0F172A" stroke-width="0.8"/><rect x="22.4" y="15.1" width="3.4" height="4.2" rx="0.6" fill="#BAE6FD" stroke="#0F172A" stroke-width="0.8"/>' +
        '<rect x="14.4" y="19.8" width="3.4" height="4.2" rx="0.6" fill="#BAE6FD" stroke="#0F172A" stroke-width="0.8"/><rect x="22.4" y="19.8" width="3.4" height="4.2" rx="0.6" fill="#FDE68A" stroke="#0F172A" stroke-width="0.8"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M15.2 6.8 L20 4 L24.8 6.8 L20 9.6 Z" fill="#1E293B"/><path d="M15.2 6.8 L20 9.6 L20 10.8 L15.2 8 Z" fill="#0F172A"/><path d="M20 9.6 L24.8 6.8 L24.8 8 L20 10.8 Z" fill="#1E293B"/>' +
        '<g transform="translate(20,7.4) scale(1,0.48)"><text x="0" y="1.1" text-anchor="middle" font-family=&apos;Baloo 2&apos;,sans-serif font-size="5.2" font-weight="900" fill="#FDE68A">H</text></g>' +
        '<rect x="17.6" y="1.6" width="1.7" height="4.2" rx="0.4" fill="#0F172A"/><circle cx="18.45" cy="1.5" r="1.9" fill="#EF4444" stroke="#0F172A" stroke-width="0.9"/><circle cx="17.7" cy="0.9" r="0.6" fill="white" opacity="0.92"/>' +
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
