/* js/progress.js — tool progression contract (scaffolding, NOT yet enforced).
 *
 * END-GAME FEATURE (deferred by design): tools unlock in a fixed order so
 * every system is learned in sequence instead of all at once:
 *
 *   hq -> drone-buy -> drone-scan -> gpr-buy -> gpr-scan -> data-review
 *     -> zone-build -> compactor-cleanup (+ stabilize/scrub) -> income
 *
 * Until that feature lands, every gate below returns TRUE (open sandbox) so
 * nothing changes for players. What this file guarantees TODAY:
 *  - one canonical ORDER list every future lock/unlock UI reads from;
 *  - requires(id): the static prerequisite map (documentation + tests);
 *  - isUnlocked(id): the single choke point the future feature flips on.
 *
 * Forward-compat audit (verified by dev-tools/verify-progression.js):
 * every tool ALREADY fails cleanly without its predecessors, so layering
 * locks on top cannot strand state or throw:
 *  - STORE lives inside the HQ panel            -> HQ first (structural)
 *  - Drone/GPR.startDeployment with 0 units     -> false (no-op)
 *  - Compactor.startPlacement unpurchased       -> false (guarded)
 *  - Zoning/buildings on unscanned tiles        -> validity excludes them
 *  - Scrub/stabilize without compactor          -> { ok:false, "nocompactor" }
 *  - Economy tick with no buildings             -> { earned: 0 } (no-op)
 * Future hook points: STORE buy buttons + inventory Deploy buttons
 * (hqPanel.js), DATA designate/scrub/stabilize keys (dataMap.js),
 * compactor placement (compactorTool.js).
 */

window.Progress = (function () {
  // canonical tool order, earliest first
  var ORDER = [
    "hq",
    "drone-buy",
    "drone-scan",
    "gpr-buy",
    "gpr-scan",
    "data-review",
    "zone-build",
    "compactor-cleanup",
    "income"
  ];

  // static prerequisites (informational until enforcement lands)
  var REQUIRES = {
    "hq": [],
    "drone-buy": ["hq"],
    "drone-scan": ["drone-buy"],
    "gpr-buy": ["drone-scan"],
    "gpr-scan": ["gpr-buy"],
    "data-review": ["drone-scan"],
    "zone-build": ["gpr-scan"],
    "compactor-cleanup": ["hq"],
    "income": ["zone-build"]
  };

  var api = {
    ORDER: ORDER,
    enforced: false, // flips true when the progression feature ships
  };

  // single choke point for the future lock UI. Open sandbox until then.
  api.isUnlocked = function (id) {
    return true;
  };

  api.requires = function (id) {
    return (REQUIRES[id] || []).slice();
  };

  return api;
})();
