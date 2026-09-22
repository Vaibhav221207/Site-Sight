(function(){
var api = window.HqPanel; if(!api) return;
// js/hqPanel-store.js — split from hqPanel.js (STORE buy)
  api.buyDrone = function () {
    var gs = window.GameState;
    if (!gs) return;
    // ONE-TIME PURCHASE: once bought (even if later deployed/consumed), the
    // button stays disabled for the rest of the session — no second purchase.
    if (gs.droneSystemPurchased) return;
    if (gs.cash >= gs.droneCost) {
      if (!gs.spend(gs.droneCost, "Drone System")) return;
      if (window.AudioManager) window.AudioManager.play("buy");
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
            api.orderBtn.textContent = stillPurchased ? "OWNED" : "BUY";
            api.orderBtn.classList.remove("hq-order-btn--flash");
          }, 900);
      }
    } else {
      if (window.AudioManager) window.AudioManager.play("error");
      api.showMsg("Insufficient funds", false);
    }
  };

  // Buy a GPR System — mirrors buyDrone exactly (one-time unlock + one unit).
  api.buyGpr = function () {
    var gs = window.GameState;
    if (!gs) return;
    if (gs.gprSystemPurchased) return;
    if (gs.cash >= gs.gprCost) {
      if (!gs.spend(gs.gprCost, "GPR System")) return;
      if (window.AudioManager) window.AudioManager.play("buy");
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
          api.gprOrderBtn.textContent = stillPurchased ? "OWNED" : "BUY";
          api.gprOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      if (window.AudioManager) window.AudioManager.play("error");
      api.showMsg("Insufficient funds", false);
    }
  };

  // Buy a Dynamic Compactor — one-time unlock, REUSABLE (not consumed on use).
  api.buyCompactor = function () {
    var gs = window.GameState;
    if (!gs) return;
    if (gs.compactorSystemPurchased) return;
    if (gs.cash >= gs.compactorCost) {
      if (!gs.spend(gs.compactorCost, "Dynamic Compactor")) return;
      if (window.AudioManager) window.AudioManager.play("buy");
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
          api.compactorOrderBtn.textContent = stillPurchased ? "OWNED" : "BUY";
          api.compactorOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      if (window.AudioManager) window.AudioManager.play("error");
      api.showMsg("Insufficient funds", false);
    }
  };

  // Buy a Repair Rig — one-time unlock, REUSABLE swarm fixer (same as compactor)
  api.buyRepair = function () {
    var gs = window.GameState;
    if (!gs) return;
    if (gs.repairRigPurchased) return;
    if (gs.cash >= gs.repairCost) {
      if (!gs.spend(gs.repairCost, "Repair Rig")) return;
      if (window.AudioManager) window.AudioManager.play("buy");
      gs.repairRigPurchased = true;
      if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
      api.updateOwned();
      api.refreshRepairPurchaseState();
      if (api.repairOrderBtn) {
        api.repairOrderBtn.textContent = "Ordered!";
        api.repairOrderBtn.classList.add("hq-order-btn--flash");
        setTimeout(function () {
          if (!api.repairOrderBtn) return;
          var stillPurchased = !!(window.GameState && window.GameState.repairRigPurchased);
          api.repairOrderBtn.textContent = stillPurchased ? "OWNED" : "BUY";
          api.repairOrderBtn.classList.remove("hq-order-btn--flash");
        }, 900);
      }
    } else {
      if (window.AudioManager) window.AudioManager.play("error");
      api.showMsg("Insufficient funds", false);
    }
  };

  // ---- modal keyboard contract (WAI-APG): trap Tab inside, Escape closes
  function focusables() {
    if (!api.panelEl || !api.panelEl.querySelectorAll) return [];
    var list = api.panelEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.disabled) continue;
      // visible check that survives stub DOMs (offsetParent may be undefined)
      if (el.offsetParent === null && el !== document.activeElement) continue;
      out.push(el);
    }
    return out;
  }

  api._onKey = function (e) {
    if (!api.isOpen || !e) return;
    var key = e.key || "";
    if (key === "Escape") {
      if (e.stopPropagation) e.stopPropagation();
      api.close();
      return;
    }
    if (key !== "Tab") return;
    var f = focusables();
    if (!f.length) {
      if (e.preventDefault) e.preventDefault();
      return;
    }
    var first = f[0], last = f[f.length - 1];
    var active = null;
    try { active = document.activeElement; } catch (err) { active = null; }
    if (e.shiftKey) {
      if (active === first || !active || f.indexOf(active) < 0) {
        if (e.preventDefault) e.preventDefault();
        if (last.focus) last.focus();
      }
    } else {
      if (active === last) {
        if (e.preventDefault) e.preventDefault();
        if (first.focus) first.focus();
      }
    }
  };

})();