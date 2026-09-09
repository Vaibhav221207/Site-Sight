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
    { id: "small-house", zone: "residential", label: "Small House", role: "booster", buildCost: 150, incomePerTick: 0, pollutionPerTick: 0, boost: 0.15 },
    { id: "townhouse", zone: "residential", label: "Townhouse", role: "booster", buildCost: 250, incomePerTick: 0, pollutionPerTick: 0, boost: 0.20 },
    { id: "apartment-block", zone: "residential", label: "Apartment Block", role: "booster", buildCost: 450, incomePerTick: 0, pollutionPerTick: 0, boost: 0.30 },
    { id: "corner-shop", zone: "commercial", label: "Corner Shop", role: "earner", buildCost: 200, incomePerTick: 5, pollutionPerTick: 0 },
    { id: "market", zone: "commercial", label: "Market", role: "earner", buildCost: 350, incomePerTick: 8, pollutionPerTick: 0 },
    { id: "retail-center", zone: "commercial", label: "Retail Center", role: "earner", buildCost: 600, incomePerTick: 15, pollutionPerTick: 1 },
    { id: "industrial-plant", zone: "industrial", label: "Industrial Plant", role: "earner", buildCost: 750, incomePerTick: 16, pollutionPerTick: 3 },
    { id: "mine-shaft", zone: "mining", label: "Mine Shaft", role: "extractor", buildCost: 300, incomePerTick: 2, pollutionPerTick: 1, payout: { Rich: 800, Trace: 300, other: 100 } },
    { id: "open-pit-mine", zone: "mining", label: "Open Pit Mine", role: "extractor", buildCost: 500, incomePerTick: 3, pollutionPerTick: 2, payout: { Rich: 1200, Trace: 500, other: 150 } },
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

  // Full price for ONE tile: permit ($10/$25 match logic) +
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

  return api;
})();
