/* js/buildings.js — building catalog + contradiction verdicts for the DATA-tab
 * designate flow. Pure data + logic (no DOM): DataMap renders the picker,
 * economy.js prices the tick. Verdicts derive from zone-vs-BestUse only —
 * no per-building exception lists.
 *
 * Verdict tiers: ok x1.0 · mild WARNING x0.75 · severe NOT SUITABLE x0.5
 * (severe is allowed at the player's risk: fast stain, blight likely).
 */

window.Buildings = (function () {
  var BUILDINGS = [
    { id: "workshop",   zone: "industrial", label: "Workshop",   role: "earner",
      blurb: "Cheap starter industry. Sips power, sips land.",
      buildCost: 200, incomePerTick: 4,  pollutionPerTick: 1 },
    { id: "factory",    zone: "industrial", label: "Factory",    role: "earner",
      blurb: "Heavy output, heavy footprint. Keep away from homes.",
      buildCost: 600, incomePerTick: 12, pollutionPerTick: 3 },
    { id: "shop",       zone: "commercial", label: "Shop",       role: "earner",
      blurb: "Corner store. Clean, modest, reliable.",
      buildCost: 200, incomePerTick: 5,  pollutionPerTick: 0 },
    { id: "mall",       zone: "commercial", label: "Mall",       role: "earner",
      blurb: "Retail magnet. Prints money, draws crowds.",
      buildCost: 700, incomePerTick: 15, pollutionPerTick: 1 },
    { id: "cottage",    zone: "residential", label: "Cottage",   role: "booster",
      blurb: "Homes nearby: +15% business income around it.",
      buildCost: 150, incomePerTick: 0,  pollutionPerTick: 0, boost: 0.15 },
    { id: "apartments", zone: "residential", label: "Apartments", role: "booster",
      blurb: "Dense housing: +30% business income around it.",
      buildCost: 450, incomePerTick: 0,  pollutionPerTick: 0, boost: 0.30 },
    { id: "mine",       zone: "mining", label: "Mine",           role: "extractor",
      blurb: "Cash out the deposit now, trickle after.",
      buildCost: 300, incomePerTick: 2,  pollutionPerTick: 1,
      payout: { Rich: 800, Trace: 300, other: 100 } },
    { id: "quarry",     zone: "mining", label: "Quarry",         role: "extractor",
      blurb: "Strip it fast and big. The land will remember.",
      buildCost: 500, incomePerTick: 3,  pollutionPerTick: 2,
      payout: { Rich: 1500, Trace: 600, other: 200 } },
  ];

  var MULT = { ok: 1, mild: 0.75, severe: 0.5 };

  var api = {};

  api.all = function () { return BUILDINGS.slice(); };

  api.byZone = function (zone) {
    var out = [];
    for (var i = 0; i < BUILDINGS.length; i++) {
      if (BUILDINGS[i].zone === zone) out.push(BUILDINGS[i]);
    }
    return out;
  };

  api.byId = function (id) {
    for (var i = 0; i < BUILDINGS.length; i++) {
      if (BUILDINGS[i].id === id) return BUILDINGS[i];
    }
    return null;
  };

  function norm(s) { return String(s == null ? "" : s).toLowerCase(); }

  // Contradiction verdict for a zone placed on a tile with this bestUse.
  // ok: same family · severe: Unsuitable land, or heavy industry on homes ·
  // mild: every other cross (business-on-business, shops near homes, homes
  // near smog, miners off rich ground).
  api.verdictFor = function (zone, bestUse) {
    var z = norm(zone), b = norm(bestUse);
    if (!z || !b) return "mild";
    if (z === b) return "ok";
    if (b === "unsuitable") return "severe";
    if (z === "industrial" && b === "residential") return "severe";
    return "mild";
  };

  api.multFor = function (verdict) { return MULT[verdict] == null ? 1 : MULT[verdict]; };

  api.verdictCopy = function (verdict) {
    if (verdict === "ok") return "Matches survey";
    if (verdict === "mild") return "Warning — poor fit (−25% income)";
    return "Not suitable — allowed at risk (−50% income)";
  };

  // Full price for ONE tile: permit (existing $50/$100 match logic) +
  // building cost + extractor payout. Returns null when tile unzonable.
  api.priceFor = function (col, row, zone, buildingId) {
    var spec = api.byId(buildingId);
    if (!spec || !window.ZoningTool) return null;
    var b = window.ZoningTool.getCostForTiles([{ col: col, row: row }], zone);
    if (!b) return null; // unzonable (unscanned / bad terrain)
    var d = window.GameState ? window.GameState.getTileData(col, row) : null;
    var verdict = api.verdictFor(zone, d ? d.bestUse : null);
    var mult = api.multFor(verdict);
    var payout = 0;
    if (spec.role === "extractor" && spec.payout && d) {
      var dep = d.mineralDeposits;
      payout = Math.round(((spec.payout[dep] != null) ? spec.payout[dep] : spec.payout.other) * mult);
    }
    return {
      permit: b.totalCost,
      building: spec.buildCost,
      total: b.totalCost + spec.buildCost,
      payout: payout,
      net: b.totalCost + spec.buildCost - payout,
      verdict: verdict,
      mult: mult,
      spec: spec,
    };
  };

  // Batch purchase across tiles (permit math per tile via priceFor).
  // Sets zoneType/zoneMismatched/zoneVerdict/zoneBuilding, deducts net cash,
  // refreshes maps + HUD. Pure result object, no DOM.
  api.confirmPurchase = function (tiles, zone, buildingId) {
    var spec = api.byId(buildingId);
    if (!spec || !tiles || !tiles.length) return { ok: false, reason: "empty" };
    if (!window.GameState) return { ok: false, reason: "empty" };
    var items = [], total = 0, payoutSum = 0;
    for (var i = 0; i < tiles.length; i++) {
      var p = api.priceFor(tiles[i].col, tiles[i].row, zone, buildingId);
      if (!p) continue; // skip unzonable tiles (reported via skipped)
      items.push({ col: tiles[i].col, row: tiles[i].row, price: p });
      total += p.total;
      payoutSum += p.payout;
    }
    if (!items.length) return { ok: false, reason: "empty" };
    var net = total - payoutSum;
    if (window.GameState.cash < net) {
      return { ok: false, reason: "funds", total: total, payout: payoutSum, net: net, cash: window.GameState.cash, count: items.length };
    }
    window.GameState.cash -= net;
    for (var j = 0; j < items.length; j++) {
      var t = items[j];
      var d = window.GameState.getTileData(t.col, t.row);
      d.zoneType = zone;
      d.zoneBuilding = buildingId;
      d.zoneVerdict = t.price.verdict;
      d.zoneMismatched = t.price.verdict !== "ok";
      // NOTE: no recalcBestUse here (see zoningTool) — flags stay consistent
      // with the Best Use the price was computed from.
    }
    if (window.Main && window.Main.updateHUD) window.Main.updateHUD();
    if (window.MobileUI && window.MobileUI.update) window.MobileUI.update();
    if (window.BlockRender) {
      window.BlockRender.invalidate();
      if (window.BlockRender.popTiles) {
        window.BlockRender.popTiles(items.map(function (t) { return { col: t.col, row: t.row }; }));
      }
    }
    try {
      console.log("[Buildings] Built " + buildingId + " x" + items.length + " in " + zone +
        " — paid $" + net + " (permit $" + total + " − payout $" + payoutSum + ")");
    } catch (e) {}
    return { ok: true, total: total, payout: payoutSum, net: net, cash: window.GameState.cash, count: items.length, spec: spec };
  };

  return api;
})();
