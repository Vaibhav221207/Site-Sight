/* js/saveSystem.js — Robust localStorage SaveSystem for Site Sight
 * Handles serialization/deserialization, autosave cadence, quota,
 * corruption recovery, and schema migrations.
 */

window.SaveSystem = (function () {
  "use strict";

  var SAVE_KEY = "siteSight_save";
  var CURRENT_VERSION = 2;
  var isDirty = false;

  var api = {
    SAVE_KEY: SAVE_KEY
  };

  // ---- Public API --------------------------------------------------------

  api.hasSave = function () {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  };

  api.clearSave = function () {
    try {
      localStorage.removeItem(SAVE_KEY);
      isDirty = false;
    } catch (e) {}
  };

  api.markDirty = function () {
    isDirty = true;
  };

  // Called manually by the economy tick
  api.autosave = function () {
    if (!isDirty) return;
    api.save();
    isDirty = false;
  };

  // ---- Core Logic --------------------------------------------------------

  // Re-encode a construction block (building or curtain) to store remainingMs
  // instead of t0 so it resumes seamlessly regardless of elapsed real time.
  function encodePhase(c) {
    if (!c) return null;
    var now = window.Construction && window.Construction.now ? window.Construction.now() : Date.now();
    var age = now - (c.t0 || now);
    var dur = c.dur || (window.Construction && window.Construction.DURATION_MS) || 3400;
    var rem = Math.max(0, dur - age);
    return {
      id: c.id,
      sprite: c.sprite,
      zone: c.zone,
      remainingMs: rem,
      dur: dur
    };
  }

  function decodePhase(c) {
    if (!c) return null;
    var now = window.Construction && window.Construction.now ? window.Construction.now() : Date.now();
    var dur = c.dur || (window.Construction && window.Construction.DURATION_MS) || 3400;
    var rem = (c.remainingMs != null ? c.remainingMs : 0);
    var t0 = now - (dur - rem);
    return {
      id: c.id,
      sprite: c.sprite,
      zone: c.zone,
      t0: t0,
      dur: dur
    };
  }

  // Same for HQ
  function encodeHQ(c) {
    if (!c) return null;
    var now = window.Construction && window.Construction.now ? window.Construction.now() : Date.now();
    var age = now - (c.t0 || now);
    var dur = 3400;
    var rem = Math.max(0, dur - age);
    return { col: c.col, row: c.row, remainingMs: rem };
  }

  function decodeHQ(c) {
    if (!c) return null;
    var now = window.Construction && window.Construction.now ? window.Construction.now() : Date.now();
    var dur = 3400;
    var rem = c.remainingMs || 0;
    var t0 = now - (dur - rem);
    return { col: c.col, row: c.row, t0: t0 };
  }

  api.serialize = function () {
    var gs = window.GameState;
    var t = window.Terrain;
    var c = window.Construction;
    
    if (!gs || !t) return null;

    var dur = (c && c.DURATION_MS) || 3400;
    var save = {
      v: CURRENT_VERSION,
      savedAt: Date.now(),
      seed: t.seed,
      terrainSeed: t.seed, // alias for startScreen modal (backward compat)
      cash: gs.cash,
      cashLedger: Array.isArray(gs.cashLedger) ? gs.cashLedger.slice() : [],
      hqBuilt: gs.hqBuilt,
      hqTile: gs.hqTile ? { col: gs.hqTile.col, row: gs.hqTile.row } : null,
      droneSystemPurchased: gs.droneSystemPurchased,
      gprSystemPurchased: gs.gprSystemPurchased,
      compactorSystemPurchased: gs.compactorSystemPurchased,
      repairRigPurchased: gs.repairRigPurchased,
      inventory: {
        droneCount: gs.inventory.droneCount,
        selectedDroneId: gs.inventory.selectedDroneId,
        deployed: gs.inventory.deployed,
        gprCount: gs.inventory.gprCount,
        selectedGprId: gs.inventory.selectedGprId,
        gprDeployed: gs.inventory.gprDeployed,
        selectedCompactorId: gs.inventory.selectedCompactorId,
        selectedRepairId: gs.inventory.selectedRepairId
      },
      scanned: JSON.parse(JSON.stringify(gs.scanned || {})),
      subsurfaceScanned: JSON.parse(JSON.stringify(gs.subsurfaceScanned || {})),
      roads: JSON.parse(JSON.stringify(gs.roads || {})),
      tileData: {},
      terrainLayout: typeof t.getLayout === "function" ? t.getLayout() : [],
      
      // Animations — encode with live DURATION so decode can reconstruct t0 exactly
      hqBuild: c && c.hqBuild ? encodeHQ(c.hqBuild) : null,
      hqCurtain: c && c.hqCurtain ? { col: c.hqCurtain.col, row: c.hqCurtain.row } : null,
      bursts: [] // don't serialize active confetti
    };

    // Serialize tileData, omitting transient render caches
    if (gs.tileData) {
      var keys = Object.keys(gs.tileData);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var d = gs.tileData[k];
        save.tileData[k] = {
          col: d.col,
          row: d.row,
          droneScanned: d.droneScanned,
          gprScanned: d.gprScanned,
          surfaceStability: d.surfaceStability,
          soilType: d.soilType,
          mineralDeposits: d.mineralDeposits,
          bedrockDepth: d.bedrockDepth,
          bestUse: d.bestUse,
          zoneType: d.zoneType,
          zoneMismatched: d.zoneMismatched,
          zoneVerdict: d.zoneVerdict,
          zoneBuilding: d.zoneBuilding,
          buildingSprite: d.buildingSprite,
          construction: encodePhase(d.construction),
          curtain: d.curtain ? { id: d.curtain.id, sprite: d.curtain.sprite, zone: d.curtain.zone } : null,
          hazard: d.hazard ? { active: d.hazard.active, type: d.hazard.type, triggeredAt: d.hazard.triggeredAt } : null,
          pollution: d.pollution || 0,
          blighted: d.blighted || false,
          isHQ: d.isHQ
        };
      }
    }

    return save;
  };

  api.save = function () {
    var data = api.serialize();
    if (!data) return false;

    var json = JSON.stringify(data);

    try {
      localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      // QuotaExceededError or Private Browsing
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        // Strip ledger to save space
        if (data.cashLedger && data.cashLedger.length > 20) {
          data.cashLedger = data.cashLedger.slice(-20);
          json = JSON.stringify(data);
          try {
            localStorage.setItem(SAVE_KEY, json);
            if (window.UI && window.UI.toast) {
              window.UI.toast("Save quota reached — old ledger trimmed", { duration: 3000 });
            }
            return true;
          } catch (e2) {
            console.error("[SaveSystem] Failed to save even after trimming", e2);
          }
        }
      }
      console.error("[SaveSystem] Save failed", e);
      return false;
    }
  };

  // ---- Migration ---------------------------------------------------------

  function migrate(data) {
    if (!data || !data.v) return data;
    // v1 → v2: hazard field added mid-save (pre-hazard saves have no hazard key)
    if (data.v < 2) {
      if (data.tileData) {
        for (var k in data.tileData) {
          if (data.tileData[k] && data.tileData[k].hazard === undefined) data.tileData[k].hazard = null;
        }
      }
      data.v = 2;
    }
    // future: if (data.v < 3) { ...; data.v = 3; }
    return data;
  }

  // ---- Loading -----------------------------------------------------------

  api.load = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      
      // Basic corruption validation
      if (!data || typeof data.v !== 'number' || typeof data.seed !== 'number') {
        throw new Error("Invalid save format");
      }
      if (typeof data.cash !== 'number' || data.cash < 0) {
        throw new Error("Invalid cash value");
      }

      return migrate(data);
    } catch (e) {
      console.error("[SaveSystem] Load failed (corrupt save), clearing.", e);
      api.clearSave();
      return null;
    }
  };

  api.apply = function (data) {
    if (!data) return false;

    var gs = window.GameState;
    var t = window.Terrain;
    var c = window.Construction;

    // Apply Terrain layout FIRST, because GameState uses Terrain for bounds/river checking
    if (t && typeof t.regenerate === "function") {
      t.regenerate(data.seed);
      if (data.terrainLayout && data.terrainLayout.length > 0 && typeof t.setLayout === "function") {
        t.setLayout(data.terrainLayout);
      }
    }

    if (gs) {
      gs.cash = data.cash;
      gs.cashLedger = data.cashLedger || [];
      gs.hqBuilt = !!data.hqBuilt;
      gs.hqTile = data.hqTile ? { col: data.hqTile.col, row: data.hqTile.row } : null;
      
      gs.droneSystemPurchased = !!data.droneSystemPurchased;
      gs.gprSystemPurchased = !!data.gprSystemPurchased;
      gs.compactorSystemPurchased = !!data.compactorSystemPurchased;
      gs.repairRigPurchased = !!data.repairRigPurchased;
      
      if (data.inventory) {
        gs.inventory.droneCount = data.inventory.droneCount || 0;
        gs.inventory.selectedDroneId = data.inventory.selectedDroneId || null;
        gs.inventory.deployed = data.inventory.deployed || null;
        gs.inventory.gprCount = data.inventory.gprCount || 0;
        gs.inventory.selectedGprId = data.inventory.selectedGprId || null;
        gs.inventory.gprDeployed = data.inventory.gprDeployed || null;
        gs.inventory.selectedCompactorId = data.inventory.selectedCompactorId || null;
        gs.inventory.selectedRepairId = data.inventory.selectedRepairId || null;
      }

      gs.scanned = data.scanned || {};
      gs.subsurfaceScanned = data.subsurfaceScanned || {};
      gs.roads = data.roads || {};
      
      gs.tileData = {};
      if (data.tileData) {
        var keys = Object.keys(data.tileData);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var d = data.tileData[k];
          gs.tileData[k] = {
            col: d.col,
            row: d.row,
            droneScanned: !!d.droneScanned,
            gprScanned: !!d.gprScanned,
            surfaceStability: d.surfaceStability,
            soilType: d.soilType,
            mineralDeposits: d.mineralDeposits,
            bedrockDepth: d.bedrockDepth,
            // Don't trust raw bestUse, always recompute for determinism
            bestUse: null,
            zoneType: d.zoneType || null,
            zoneMismatched: !!d.zoneMismatched,
            zoneVerdict: d.zoneVerdict || null,
            zoneBuilding: d.zoneBuilding || null,
            buildingSprite: d.buildingSprite || null,
            construction: decodePhase(d.construction),
            curtain: d.curtain ? { 
              id: d.curtain.id, 
              sprite: d.curtain.sprite, 
              zone: d.curtain.zone,
              t0: window.Construction && window.Construction.now ? window.Construction.now() : Date.now() // set tapable immediately
            } : null,
            hazard: d.hazard ? { active: d.hazard.active, type: d.hazard.type, triggeredAt: d.hazard.triggeredAt } : null,
            pollution: d.pollution || 0,
            blighted: !!d.blighted,
            isHQ: !!d.isHQ
          };
          
          if (gs._recalcBestUse) gs._recalcBestUse(gs.tileData[k]);
        }
      }
    }

    if (c) {
      c.hqBuild = decodeHQ(data.hqBuild);
      if (data.hqCurtain) {
        var now = c.now ? c.now() : Date.now();
        c.hqCurtain = { col: data.hqCurtain.col, row: data.hqCurtain.row, t0: now };
      } else {
        c.hqCurtain = null;
      }
      c.bursts = []; // Always reset transient fx
    }
    
    return true;
  };

  return api;
})();
