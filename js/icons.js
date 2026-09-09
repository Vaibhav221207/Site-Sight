/* js/icons.js — procedural SVG icon family for the HQ terminal.
 *
 * One artist, one rulebook: 24x24 viewBox, chunky ink outlines (#2B2320,
 * width 2, round caps), flat fills, a single accent per glyph, ~2px safe
 * margin. Silhouette-first shapes that survive 28px slots: quad rotors,
 * radar dish, steamroller, house, shop awning, sawtooth factory, derrick.
 * No text inside glyphs (vanishes at slot size). Pure strings — no DOM.
 *
 * 100% procedural family: no licensed rasters remain. Drone is a quadcopter
 * (ring rotors + camera lens), GPR stays a cart because it IS a cart
 * machine (body + wheels + handle + radargram screen), compactor a roller
 * (ringed drum + cab window). One focal detail each, silhouette first.
 */

window.Icons = (function () {
  var INK = "#2B2320";
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + "</svg>";
  }
  function stroke(extra) {
    return 'fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      (extra ? " " + extra : "");
  }
  function fill(color, extra) {
    return 'fill="' + color + '" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"' +
      (extra ? " " + extra : "");
  }

  var G = {
    // survey quadcopter, drawn for the slot: X arms, four RING rotors
    // (rings read as spinning blades where solid dots read as bolts), center
    // body with a coral camera lens — the one focal detail.
    drone: svg(
      '<path d="M5 5 L19 19 M19 5 L5 19" fill="none" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="5" cy="5" r="3" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="19" cy="5" r="3" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="5" cy="19" r="3" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="19" cy="19" r="3" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="5" cy="5" r="0.9" fill="' + INK + '"/>' +
      '<circle cx="19" cy="5" r="0.9" fill="' + INK + '"/>' +
      '<circle cx="5" cy="19" r="0.9" fill="' + INK + '"/>' +
      '<circle cx="19" cy="19" r="0.9" fill="' + INK + '"/>' +
      '<rect x="8.5" y="8.5" width="7" height="7" rx="2" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="12" cy="12" r="1.8" fill="#C7432B"/>'
    ),
    // GPR survey cart, redrawn simple: low wide body, two solid wheels,
    // ONE push strut, tablet with a solid radargram screen. Earlier drafts
    // had hubs + twin struts + hairline zigzag and dissolved into gray soup
    // at slot size — every removed line makes the survivor louder.
    gpr: svg(
      '<rect x="2.5" y="11.5" width="14" height="6.5" rx="2" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="6" cy="18.8" r="2" ' + fill("#2B2320") + "/>" +
      '<circle cx="13.5" cy="18.8" r="2" ' + fill("#2B2320") + "/>" +
      '<path d="M9.5 11.5 L15 4.5" ' + stroke() + "/>" +
      '<rect x="12.5" y="0.8" width="8.5" height="5" rx="1" ' + fill("#2B2320") + "/>" +
      '<rect x="13.9" y="1.9" width="5.7" height="2.8" rx="0.6" fill="#42A5F5" stroke="none"/>'
    ),
    // steamroller compactor: ringed road drum (the working face), small
    // front wheel, cab with an amber glass window — drum ring + window are
    // the two reads; everything else is supporting volume.
    compactor: svg(
      '<circle cx="7" cy="15.5" r="5.5" ' + fill("#FFFFFF") + "/>" +
      '<circle cx="7" cy="15.5" r="2.8" fill="none" stroke="' + INK + '" stroke-width="1.6"/>' +
      '<circle cx="18" cy="18" r="2.4" ' + fill("#2B2320") + "/>" +
      '<circle cx="18" cy="18" r="0.9" fill="#FFFBF0"/>' +
      '<path d="M7 10.5 L7 5.5 L18 5.5 L18 13.5" ' + fill("#FFFFFF") + "/>" +
      '<rect x="9" y="7" width="4.6" height="3.4" rx="0.8" fill="#E0962A" stroke="' + INK + '" stroke-width="1.4"/>'
    ),
    // cottage: square + pitched roof + door, green
    residential: svg(
      '<rect x="6" y="11" width="12" height="9" ' + fill("#FFFBF0") + "/>" +
      '<path d="M3 11 L12 4 L21 11 Z" ' + fill("#66BB6A") + "/>" +
      '<rect x="10.5" y="14" width="3" height="6" ' + fill("#2B2320") + "/>"
    ),
    // corner shop: block + striped awning + door, blue
    commercial: svg(
      '<rect x="5" y="9" width="14" height="11" ' + fill("#FFFBF0") + "/>" +
      '<path d="M4 9 L6 5 L9 9 L11 5 L14 9 L16 5 L19 9 L20 5 L20 9 Z" ' + fill("#42A5F5") + "/>" +
      '<rect x="10.5" y="13" width="3" height="7" ' + fill("#2B2320") + "/>"
    ),
    // factory: sawtooth roof + stack + windows, purple
    industrial: svg(
      '<rect x="4" y="11" width="16" height="9" ' + fill("#FFFBF0") + "/>" +
      '<path d="M4 11 L8 6 L8 11 L12 6 L12 11 L16 6 L16 11 L20 6 L20 11 Z" ' + fill("#8E24AA") + "/>" +
      '<rect x="5.5" y="14" width="2.5" height="2.5" ' + fill("#2B2320") + "/>" +
      '<rect x="10" y="14" width="2.5" height="2.5" ' + fill("#2B2320") + "/>"
    ),
    // mine derrick: A-frame + crossbar + pit, gold accent
    mining: svg(
      '<path d="M12 3 L5 20 M12 3 L19 20 M7.5 14 L16.5 14" ' + stroke() + "/>" +
      '<circle cx="12" cy="3" r="1.6" ' + fill("#FFB300") + "/>" +
      '<ellipse cx="12" cy="20.5" rx="5" ry="1.8" ' + fill("#2B2320") + "/>"
    ),
  };

  var api = { list: Object.keys(G) };

  api.get = function (name) {
    return G[name] || "";
  };

  return api;
})();
