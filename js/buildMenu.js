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
        '<g stroke="#0F172A" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M24 35 L36 41 L36 46 L24 40 Z" fill="#E2E8F0"/>' +
        '<path d="M12 41 L24 35 L24 40 L12 46 Z" fill="#F8FAFC"/>' +
        '<path d="M12 41 L24 35 L36 41 L24 47 Z" fill="#CBD5E1" stroke="#0F172A" stroke-width="2"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M24 35 L36 41 L36 43 L24 37 Z" fill="#2563EB"/>' +
        '<path d="M12 41 L24 35 L24 37 L12 43 Z" fill="#2563EB"/>' +
        '<path d="M12 41 L24 35 L36 41 L24 47 Z" fill="none" stroke="#0F172A" stroke-width="2"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M24 20.5 L33 25 L33 34 L24 29.5 L15 34 L15 25 Z" fill="#F8FAFC"/>' +
        '<path d="M33 25 L33 34 L24 29.5 L24 20.5 Z" fill="#E2E8F0"/>' +
        '<path d="M15 34 L24 29.5 L24 20.5 L15 25 Z" fill="#F8FAFC"/>' +
        '<path d="M15 25 L24 20.5 L33 25 L24 29.5 Z" fill="#2563EB" stroke="#0F172A" stroke-width="1.8"/>' +
        '<rect x="17.2" y="26" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '<rect x="21.5" y="26" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '<rect x="25.8" y="26" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '<rect x="17.2" y="30.8" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '<rect x="21.5" y="30.8" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '<rect x="25.8" y="30.8" width="3.5" height="4.5" rx="0.5" fill="#FDE68A" stroke="#0F172A" stroke-width="1"/>' +
        '</g>' +
        '<g stroke="#0F172A" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' +
        '<path d="M18 17 L24 13.5 L30 17 L24 20.5 Z" fill="#1E293B"/>' +
        '<path d="M18 17 L24 20.5 L24 22 L18 18.5 Z" fill="#0F172A"/>' +
        '<path d="M24 20.5 L30 17 L30 18.5 L24 22 Z" fill="#1E293B"/>' +
        '<text x="24" y="18.5" text-anchor="middle" font-family=&apos;Baloo 2&apos;,sans-serif font-size="4.5" font-weight="900" fill="#FDE68A">H</text>' +
        '<rect x="21.5" y="8.5" width="2.2" height="6" rx="0.5" fill="#0F172A"/>' +
        '<circle cx="22.6" cy="7.5" r="3" fill="#1E293B" stroke="#0F172A" stroke-width="1.2"/>' +
        '<circle cx="22.6" cy="7.5" r="1.5" fill="#EF4444" stroke="none"/>' +
        '<circle cx="21.9" cy="6.9" r="0.7" fill="white" opacity="0.85"/>' +
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
