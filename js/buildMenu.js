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
        '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">' +
        '<path d="M20 2 L38 12.5 L20 23 L2 12.5 Z" fill="#8a97a0"/>' +
        '<path d="M2 12.5 L20 23 L20 35 L2 24.5 Z" fill="#86847c"/>' +
        '<path d="M38 12.5 L20 23 L20 35 L38 24.5 Z" fill="#5e5c56"/>' +
        '<rect x="15.2" y="15.5" width="2.6" height="2.6" fill="#3f6f8f"/>' +
        '<rect x="19.8" y="15.5" width="2.6" height="2.6" fill="#3f6f8f"/>' +
        '<rect x="15.2" y="20.1" width="2.6" height="2.6" fill="#3f6f8f"/>' +
        '<rect x="19.8" y="20.1" width="2.6" height="2.6" fill="#3f6f8f"/>' +
        '<rect x="22.2" y="26" width="5.4" height="7.2" fill="#232321"/>' +
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
    api.close();
    api.refresh();
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
          anime.set(barEl, { translateY: 0, opacity: 1 });
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
