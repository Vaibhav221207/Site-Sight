/* js/zoningTool.js — Zoning cost + confirm logic for the DATA-tab flow.
 *
 * Pure game-logic module: NO placement mode, NO drag-select, NO DOM of its
 * own. The DATA tab mini-map (js/dataMap.js) owns tile selection and renders
 * the inline DESIGNATE ZONE UI; this module answers "what does it cost?"
 * ($50 matched / $100 mismatched: priced so half the map is zonable from a
 * starting budget, with the 2:1 mismatch penalty kept) and applies
 * confirmed zoning to game state + map rendering.
 */

window.ZoningTool = (function () {
  var ZONE_TYPES = [
    { id: "residential", label: "Residential", color: "#66BB6A" },
    { id: "commercial",  label: "Commercial",  color: "#42A5F5" },
    { id: "industrial",  label: "Industrial",  color: "#8E24AA" },
    { id: "mining",      label: "Mining",      color: "#FFB300" }
  ];

  var BASE_COST = 50;
  var MISMATCH_COST = 100;

  var api = {};

  function isMatch(zoneType, bestUse) {
    if (!zoneType || !bestUse) return false;
    return zoneType.toLowerCase() === bestUse.toLowerCase();
  }
  api.isMatch = isMatch;

  api.zoneTypes = function () { return ZONE_TYPES.slice(); };

  api.zoneColorFor = function (id) {
    for (var i = 0; i < ZONE_TYPES.length; i++) {
      if (ZONE_TYPES[i].id === id) return ZONE_TYPES[i].color;
    }
    return null;
  };

  api.zoneLabelFor = function (id) {
    for (var i = 0; i < ZONE_TYPES.length; i++) {
      if (ZONE_TYPES[i].id === id) return ZONE_TYPES[i].label;
    }
    return id;
  };

  api.costs = function () { return { base: BASE_COST, mismatch: MISMATCH_COST }; };

  // Only flat, FULLY-scanned land tiles can be zoned. HQ/river/rock/trench
  // are never zonable; partially-scanned land must finish surveying first.
  api.isValidTile = function (col, row) {
    if (!window.Terrain || !window.GameState) return false;
    var t = window.Terrain.typeAt(col, row);
    if (t === "river" || t === "rock" || t === "trench" || t === "hq") return false;
    if (t !== "land") return false;
    var d = window.GameState.getTileData(col, row);
    if (!d || !d.droneScanned || !d.gprScanned) return false;
    return true;
  };

  api.isValid = function (col, row) { return api.isValidTile(col, row); };

  // Cost breakdown for an explicit tile list + zone type. Unzonable tiles
  // are filtered out (reported via invalidCount); null when nothing valid.
  // Cost math is unchanged from the retired paint tool.
  api.getCostForTiles = function (tiles, zone) {
    if (!zone || !tiles || !tiles.length) return null;
    var validTiles = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t && api.isValidTile(t.col, t.row)) validTiles.push({ col: t.col, row: t.row });
    }
    if (validTiles.length === 0) return null;
    var matched = 0, mismatched = 0;
    for (var j = 0; j < validTiles.length; j++) {
      var d = window.GameState.getTileData(validTiles[j].col, validTiles[j].row);
      var bestUse = d ? d.bestUse : null;
      if (isMatch(zone, bestUse)) matched++;
      else mismatched++;
    }
    return {
      validTiles: validTiles,
      invalidCount: tiles.length - validTiles.length,
      matched: matched,
      mismatched: mismatched,
      totalCost: matched * BASE_COST + mismatched * MISMATCH_COST,
      zone: zone
    };
  };

  function money(n) { return "$" + Number(n).toLocaleString(); }

  // Single source of truth for confirm copy (plain breakdown — the caller
  // owns its own Confirm button, unlike the retired floating prompt).
  api.breakdownText = function (b) {
    if (!b) return "";
    var parts = [];
    if (b.matched > 0) parts.push(b.matched + " matched (" + money(b.matched * BASE_COST) + ")");
    if (b.mismatched > 0) parts.push(b.mismatched + " mismatched (" + money(b.mismatched * MISMATCH_COST) + ")");
    return parts.join(" + ") + " = " + money(b.totalCost);
  };

  // Single-tile confirm line, e.g. "Zone as Residential — $500
  // (matches Best Use)" or "Zone as Industrial — $1,000
  // (mismatch — land suited for Residential)".
  api.singleTileText = function (col, row, zone) {
    var d = window.GameState ? window.GameState.getTileData(col, row) : null;
    var bestUse = d ? d.bestUse : null;
    var cost = isMatch(zone, bestUse) ? BASE_COST : MISMATCH_COST;
    var label = api.zoneLabelFor(zone);
    if (isMatch(zone, bestUse)) {
      return "Zone as " + label + " — " + money(cost) + " (matches Best Use)";
    }
    var suited = bestUse || "current survey";
    return "Zone as " + label + " — " + money(cost) + " (mismatch — land suited for " + suited + ")";
  };

  // Apply zoning: deduct cash, set zoneType + zoneMismatched per tile,
  // refresh map rendering + HUD. Returns a result object (no DOM side
  // effects — the caller renders success/failure inline).
  api.confirmZoning = function (tiles, zone) {
    var b = api.getCostForTiles(tiles, zone);
    if (!b) return { ok: false, reason: "empty" };
    var cash = window.GameState ? window.GameState.cash : 0;
    if (cash < b.totalCost) {
      return { ok: false, reason: "funds", breakdown: b, cash: cash };
    }
    window.GameState.cash -= b.totalCost;
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    for (var i = 0; i < b.validTiles.length; i++) {
      var t = b.validTiles[i];
      var d = window.GameState.getTileData(t.col, t.row);
      d.zoneType = zone;
      d.zoneMismatched = !isMatch(zone, d.bestUse);
      if (window.GameState.recalcBestUse) window.GameState.recalcBestUse(t.col, t.row);
    }
    if (window.BlockRender) {
      window.BlockRender.invalidate();
      if (window.BlockRender.popTiles) window.BlockRender.popTiles(b.validTiles);
    }
    try {
      console.log("[Zoning] Zoned " + b.validTiles.length + " tile(s) as " + zone +
        " cost $" + b.totalCost + " (matched " + b.matched + " mismatched " + b.mismatched + ")");
    } catch (e) {}
    return { ok: true, breakdown: b, cash: window.GameState.cash };
  };

  return api;
})();
