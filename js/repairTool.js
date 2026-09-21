/* js/repairTool.js — ConTech Repair Rig: staged disaster-response drone.
 * DESIGN READ (taste-skill): game UI for construction hazard response, chunky
 *   tactile industrial, vanilla canvas + procedural SVG. Dials VARIANCE 7 / MOTION 5 / DENSITY 4.
 * MOTION WEIGHTING (design-motion-principles): Primary Jakub (production polish
 *   for shipped game) · Secondary Emil (restraint for high-frequency tile taps)
 *   · Selective Jhey (rare hazard delight). Frequency Gate: hazard is RARE
 *   (100s roll, occasional/session) → expressive staged motion welcome; daily
 *   tile taps remain restrained. Each micro-phase uses Jakub 200-500ms polish
 *   with custom cubic easings, transform/opacity/filter only, will-change + 
 *   prefers-reduced-motion handled (ui-ux-pro-max P1/P7).
 * Research: Cities: Skylines Disaster Response Unit / SimCity scaffolding —
 *   dispatch from HQ → travel → scan → repair work (scaffold + beam) → depart.
 *   Total 4.0s so it reads as real work, still respects single-click rule.
 */

window.RepairTool = (function () {
  "use strict";

  var api = {
    isActive: false,
    _anim: null,
    _swarm: null, // {col,row,t0}
    _pulse: 0
  };

  var BODY_FILL = "#4A4A45";
  var BODY_STROKE = "#2E2E2B";
  var ARM_COLOR = "#3A3A36";
  var ROTOR_FILL = "#8A8A82";
  var NAV_AMBER = "#FFB300";
  var REPAIR_CORAL = "#C7432B";
  var SHADOW = "rgba(0,0,0,0.22)";
  // staged timings — total 4000ms (4s readable repair, like SC/CS2 scaffolding stage)
  var LIFT_MS = 400;
  var TRAVEL_MS = 900;
  var SCAN_MS = 500;
  var WORK_MS = 1700;
  var EXIT_MS = 500;
  var TOTAL_MS = LIFT_MS + TRAVEL_MS + SCAN_MS + WORK_MS + EXIT_MS; // 4000

  function isHqTile(c, r) {
    try {
      if (window.Terrain && window.Terrain.isHQ && window.Terrain.isHQ(c, r)) return true;
      var hq = window.GameState && window.GameState.hqTile;
      if (hq && hq.col === c && hq.row === r) return true;
    } catch (e) {}
    return false;
  }

  api.startPlacement = function () {
    if (!(window.GameState && window.GameState.repairRigPurchased)) return false;
    try {
      if (window.InputHandler && window.InputHandler.isScanBusy && window.InputHandler.isScanBusy()) return false;
    } catch (e) {}
    api.isActive = true;
    api._swarm = null;
    if (window.InputHandler && window.InputHandler.setMode) {
      window.InputHandler.setMode("fixing-hazard");
      window.InputHandler.setCursor("crosshair");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(true);
      window.InputHandler.setCursor("crosshair");
    }
    if (window.HqPanel) try { window.HqPanel.showMsg("Click a flagged building to dispatch Repair Drone", false); } catch (e2) {}
    if (window.BlockRender) window.BlockRender.invalidate();
    return true;
  };

  api.cancel = function () {
    api.isActive = false;
    api._swarm = null;
    api._pending = null;
    api._queue = [];
    if (api._anim) { try { api._anim.pause(); } catch (e) {} api._anim = null; }
    if (window.InputHandler && window.InputHandler.setMode) {
      if (window.InputHandler.getMode && window.InputHandler.getMode() === "fixing-hazard") window.InputHandler.setMode("idle");
      window.InputHandler.setCursor("grab");
    } else if (window.InputHandler) {
      window.InputHandler.setPlacementMode(false);
      window.InputHandler.setCursor("grab");
    }
    if (window.BlockRender) window.BlockRender.invalidate();
  };

  api.isValidTile = function (col, row) {
    if (isHqTile(col, row)) return false;
    if (api._pending === col+","+row) return false; // mid-flight lock — badge still visible but not re-clickable
    var d = null;
    try { d = window.GameState && window.GameState.getTileData ? window.GameState.getTileData(col, row) : null; } catch (e) { return false; }
    if (!d || !d.zoneBuilding) return false;
    if (!d.hazard || !d.hazard.active) return false;
    return true;
  };

  function prefersReducedMotion(){
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch(e){ return false; }
  }
  // single-drone queue: one repair flies at a time; extra taps while busy
  // QUEUE instead of overwriting (the old overwrite left every in-flight
  // repair orphaned — clicking A then B solved neither).
  api._pending = null; // "col,row" of tile currently being repaired
  api._queue = [];     // queued "col,row" keys, oldest first
  function queueMsg(text, ok) {
    try { if (window.HqPanel && window.HqPanel.showMsg) window.HqPanel.showMsg(text, !!ok); } catch (e) {}
  }
  function shiftNext() {
    if (!api._queue.length) return false;
    var nxt = api._queue.shift().split(",");
    _begin(+nxt[0], +nxt[1]);
    return true;
  }
  function finishJob(col, row, key, type) {
    // stale timer (cancelled or superseded) — never touch another job
    if (api._pending !== key) return;
    try {
      var dd = window.GameState && window.GameState.getTileData ? window.GameState.getTileData(col, row) : null;
      if (dd && dd.hazard && dd.hazard.active) dd.hazard = null;
    } catch(e){}
    try { if (window.Construction && window.Construction.bursts) window.Construction.bursts.push({ c: col, r: row, t0: window.Construction.now() }); } catch (e2) {}
    api._pending = null;
    try { if (window.SaveSystem && window.SaveSystem.markDirty) window.SaveSystem.markDirty(); } catch (e3) {}
    if (window.Main && window.Main.updateHUD) try { window.Main.updateHUD(); } catch (e3b) {}
    queueMsg(type + " fixed — income restored", true);
    if (window.BlockRender) window.BlockRender.invalidate();
    shiftNext(); // drone flies straight to the next queued hazard, if any
  }
  function _begin(col, row) {
    var key = col + "," + row;
    var d = window.GameState.getTileData(col, row);
    var type = (d && d.hazard) ? d.hazard.type : "hazard";
    // keep hazard visible during LIFT→TRAVEL→SCAN so badge doesn't pop before drone arrives
    api._pending = key;
    // accessibility: reduced-motion → instant (no travel), then next queued
    if (prefersReducedMotion()){
      finishJob(col, row, key, type);
      api._swarm = null;
      setTimeout(function () { if (!api._pending) api.cancel(); }, 120);
      return;
    }
    api._swarm = { col: col, row: row, t0: Date.now() };
    if (window.BlockRender) window.BlockRender.invalidate();
    // badge stays → drone travels → clear + celebrate at END of WORK phase (first frame of EXIT)
    var clearDelay = LIFT_MS + TRAVEL_MS + SCAN_MS + WORK_MS;
    setTimeout(function(){ finishJob(col, row, key, type); }, clearDelay);
    setTimeout(function () {
      if (api._pending) return; // a job (this or queued next) still owns the mode
      api.cancel();
    }, TOTAL_MS + 90);
  }
  api.attempt = function (col, row) {
    if (!api.isValidTile(col, row)) return false;
    var key = col+","+row;
    if (api._pending === key) return false; // same tile mid-flight
    if (api._pending) {
      // drone busy — queue instead of overwriting (overwrite orphaned both)
      if (api._queue.indexOf(key) < 0) {
        api._queue.push(key);
        queueMsg("Drone busy — repair queued (#" + api._queue.length + ")", false);
      }
      return true;
    }
    _begin(col, row);
    return true;
  };

  function easeOutCubic(t){ return 1 - Math.pow(1-t,3); }
  function easeInCubic(t){ return t*t*t; }
  function easeInOutCubic(t){ return t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

  function drawRepairDrone(ctx, cx, cy, alpha, bob, beamOn){
    var iso = (window.IsoGrid && window.IsoGrid.isoSize) ? window.IsoGrid.isoSize : 32;
    var u = iso * 1.18;
    var half = u/2;
    var armD = u * 0.32;
    var rotorR = u * 0.145;
    var bodyR = u * 0.20;
    var ySquash = 0.82;
    alpha = alpha == null ? 1 : alpha;
    bob = bob || 0;
    var by = cy + bob;
    ctx.save();
    if(alpha!==1) ctx.globalAlpha = alpha;
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(cx, cy + half*0.75, u*0.12, 0, Math.PI*2);
    ctx.fill();
    if(beamOn){
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, by + bodyR*0.6);
      ctx.lineTo(cx, by + bodyR*0.6 + u*0.42);
      ctx.stroke();
      ctx.fillStyle = REPAIR_CORAL;
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, by + bodyR*0.6 + u*0.42, 2.2, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }
    var dirs = [{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1},{x:1,y:1}];
    ctx.fillStyle = ROTOR_FILL;
    ctx.globalAlpha = alpha * 0.55;
    for(var i=0;i<4;i++){
      ctx.beginPath();
      ctx.arc(cx + dirs[i].x*armD, by + dirs[i].y*armD*ySquash, rotorR, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ARM_COLOR;
    ctx.lineWidth = Math.max(1.4, u*0.045);
    ctx.beginPath();
    for(var a=0;a<4;a++){
      ctx.moveTo(cx + dirs[a].x*bodyR, by + dirs[a].y*bodyR*ySquash);
      ctx.lineTo(cx + dirs[a].x*armD, by + dirs[a].y*armD*ySquash);
    }
    ctx.stroke();
    ctx.fillStyle = BODY_FILL;
    ctx.beginPath();
    for(var k=0;k<6;k++){
      var ang = -Math.PI/2 + k*(Math.PI/3);
      var bx = cx + Math.cos(ang)*bodyR;
      var by2 = by + Math.sin(ang)*bodyR*ySquash;
      if(k===0) ctx.moveTo(bx,by2); else ctx.lineTo(bx,by2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = BODY_STROKE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = NAV_AMBER;
    ctx.shadowColor = NAV_AMBER;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(cx - bodyR*0.45, by - bodyR*0.18*ySquash, bodyR*0.22, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + bodyR*0.45, by - bodyR*0.18*ySquash, bodyR*0.22, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = REPAIR_CORAL;
    ctx.beginPath();
    ctx.arc(cx, by, bodyR*0.18, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // dotted scaffold ring like your screenshot — orange dots around the base
  function drawScaffoldRing(ctx, cx, topY, iso, half, progress, pulse){
    var r = iso * 0.52;
    var dotR = 1.6;
    var n = 16;
    ctx.save();
    var a = 0.35 + pulse*0.35;
    for(var i=0;i<n;i++){
      var ang = (i/n)*Math.PI*2 + progress*0.6;
      // diamond ring mapped to iso diamond: x = cx + cos*iso, y = topY + sin*half
      var x = cx + Math.cos(ang)*r;
      var y = topY + Math.sin(ang)*half*0.52;
      // only draw dots whose progress is revealed (scaffold builds clockwise)
      if(i/n > progress) continue;
      ctx.globalAlpha = a * (0.7 + 0.3*Math.sin(i*0.9 + pulse*6));
      ctx.fillStyle = i%3===0 ? "#FFB300" : i%3===1 ? "#FF8F00" : "#C7432B";
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "#2B2320";
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = a*0.9;
      ctx.stroke();
    }
    // faint connecting dashed diamond for structure
    ctx.globalAlpha = 0.18 + pulse*0.12;
    ctx.strokeStyle = "#FF8F00";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3,4]);
    ctx.beginPath();
    ctx.moveTo(cx, topY - half*0.52);
    ctx.lineTo(cx + r, topY);
    ctx.lineTo(cx, topY + half*0.52);
    ctx.lineTo(cx - r, topY);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  api.render = function (ctx, grid) {
    if (!grid || !grid.isoSize) return;
    var iso = grid.isoSize, half = iso * 0.5;
    if (api.isActive && window.InputHandler) {
      try {
        var pos = window.InputHandler._lastPos || null;
        var tile = null;
        if (pos && grid.screenToTile) tile = grid.screenToTile(pos.x, pos.y);
        if (tile) {
          var valid = api.isValidTile(tile.col, tile.row);
          var p = grid.worldToScreen(tile.col, tile.row);
          var elev = 0;
          try { elev = window.Terrain ? window.Terrain.elevationAt(tile.col, tile.row) : 0; } catch (e) {}
          var topY = p.y - (4 + elev);
          ctx.save();
          ctx.strokeStyle = valid ? "rgba(255,179,0,0.92)" : "rgba(239,68,68,0.85)";
          ctx.lineWidth = valid ? 2.6 : 1.8;
          ctx.setLineDash(valid ? [] : [6,4]);
          ctx.beginPath();
          ctx.moveTo(p.x, topY - half);
          ctx.lineTo(p.x + iso, topY);
          ctx.lineTo(p.x, topY + half);
          ctx.lineTo(p.x - iso, topY);
          ctx.closePath();
          ctx.stroke();
          if(valid){ ctx.fillStyle="rgba(255,179,0,0.16)"; ctx.fill(); }
          ctx.restore();
          if (window.BlockRender) window.BlockRender.invalidate();
        }
      } catch (e) {}
    }
    if (api._swarm) {
      if (prefersReducedMotion()) { api._swarm = null; return; }
      var age = Date.now() - api._swarm.t0;
      if (age > TOTAL_MS) { api._swarm = null; return; }
      var p2 = grid.worldToScreen(api._swarm.col, api._swarm.row);
      var elev2 = 0;
      try { elev2 = window.Terrain ? window.Terrain.elevationAt(api._swarm.col, api._swarm.row) : 0; } catch (e) {}
      var groundY = p2.y - (4 + elev2);
      var hoverY = groundY - iso * 0.58;
      // HQ origin for travel — fallback to offscreen north if no HQ yet
      var hqPos = null;
      try {
        var hq = window.GameState && window.GameState.hqTile;
        if (hq && grid.worldToScreen) { var hp = grid.worldToScreen(hq.col, hq.row); var he = window.Terrain?window.Terrain.elevationAt(hq.col,hq.row):0; hqPos = {x: hp.x, y: hp.y - (4+he) - iso*1.2}; }
      } catch(e){}
      if(!hqPos) hqPos = {x: p2.x, y: hoverY - 140};
      var cx, cy, alpha, bob, phase, progress;
      var workProgress = 0, ringProg = 0;

      if (age < LIFT_MS){
        var t0 = age / LIFT_MS;
        var e0 = easeOutCubic(t0);
        cx = hqPos.x;
        cy = hqPos.y - e0*18; // small lift
        alpha = 0.35 + e0*0.65;
        bob = 0;
        phase = "lift";
      } else if (age < LIFT_MS + TRAVEL_MS){
        var t1 = (age - LIFT_MS)/TRAVEL_MS;
        var e1 = easeInOutCubic(t1);
        cx = hqPos.x + (p2.x - hqPos.x)*e1;
        cy = hqPos.y + (hoverY - hqPos.y)*e1 - Math.sin(t1*Math.PI)*14;
        alpha = 1;
        bob = Math.sin(t1*Math.PI*4)*1.2;
        phase = "travel";
      } else if (age < LIFT_MS + TRAVEL_MS + SCAN_MS){
        var t2 = (age - LIFT_MS - TRAVEL_MS)/SCAN_MS;
        cx = p2.x + Math.cos(t2*Math.PI*2)* iso*0.08;
        cy = hoverY + Math.sin(t2*Math.PI*2)*2.5;
        alpha = 1;
        bob = Math.sin(t2*Math.PI*2)*1.8;
        phase = "scan";
      } else if (age < LIFT_MS + TRAVEL_MS + SCAN_MS + WORK_MS){
        var t3 = (age - LIFT_MS - TRAVEL_MS - SCAN_MS)/WORK_MS;
        workProgress = t3;
        ringProg = t3;
        cx = p2.x;
        cy = hoverY + Math.sin(t3*Math.PI*4)*1.6;
        alpha = 1;
        bob = Math.sin(t3*Math.PI*3)*1.8;
        phase = "work";
      } else {
        var t4 = (age - LIFT_MS - TRAVEL_MS - SCAN_MS - WORK_MS)/EXIT_MS;
        var ei = easeInCubic(t4);
        cx = p2.x;
        cy = hoverY - ei*160;
        alpha = 1 - ei;
        bob = 0;
        phase = "exit";
      }

      var isWorking = (phase==="work");
      var isScan = (phase==="scan");

      // scan sweep line during scan phase
      if(isScan){
        var sT = (age - LIFT_MS - TRAVEL_MS)/SCAN_MS;
        ctx.save();
        ctx.globalAlpha = 0.28 + Math.sin(sT*Math.PI*4)*0.18;
        ctx.strokeStyle = "#00E5FF";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4,4]);
        ctx.beginPath();
        ctx.moveTo(cx - iso*0.45, groundY - half*0.3 + sT*half*0.6);
        ctx.lineTo(cx + iso*0.45, groundY - half*0.3 + sT*half*0.6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // dotted scaffold ring builds during work, stays faint after
      if(phase==="work" || phase==="exit"){
        var pulse = 0.5 + 0.5*Math.sin(age*0.012);
        drawScaffoldRing(ctx, p2.x, groundY, iso, half, isWorking?workProgress:1, pulse*0.5);
      }

      // repair beam during work only
      if(isWorking){
        var tipY = cy + (iso*1.18*0.20*0.6 + iso*1.18*0.42);
        var beamA = 0.68 + Math.sin(workProgress*Math.PI*5)*0.16;
        var grd = ctx.createLinearGradient(cx, tipY, cx, groundY);
        grd.addColorStop(0, "rgba(255,179,0,"+(0.88*beamA)+")");
        grd.addColorStop(0.45, "rgba(255,140,30,"+(0.55*beamA)+")");
        grd.addColorStop(1, "rgba(199,67,43,"+(0.10*beamA)+")");
        ctx.save();
        ctx.strokeStyle = grd;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = "#FFB300";
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx, groundY);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,179,0,"+(0.42*beamA)+")";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, 7 + Math.sin(age*0.014)*2.5, 3.2 + Math.cos(age*0.014)*1.2, 0, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
        // sparks intensify mid-work
        var sMid = 1 - Math.abs(workProgress-0.55)/0.45;
        sMid = Math.max(0, Math.min(1, sMid));
        if(sMid>0.18){
          ctx.save();
          ctx.globalAlpha = sMid*0.92;
          ctx.fillStyle = "#FFFBF0";
          ctx.shadowColor = "#FFB300";
          ctx.shadowBlur = 9;
          ctx.beginPath();
          ctx.arc(cx, groundY, 4.2, 0, Math.PI*2);
          ctx.fill();
          ctx.shadowBlur = 0;
          for(var si=0;si<4;si++){
            var sx = cx + (Math.random()-0.5)*14;
            var sy = groundY + (Math.random()-0.5)*9 -1;
            ctx.fillStyle = si%2===0 ? "#C7432B" : "#FFB300";
            ctx.globalAlpha = sMid*0.9;
            ctx.beginPath();
            ctx.arc(sx,sy, si===0?1.8:1.3, 0, Math.PI*2);
            ctx.fill();
          }
          ctx.restore();
        }
        // progress arc around drone (like Cities: Skylines rebuild circle)
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = "#FFB300";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy - iso*0.08, 10, -Math.PI/2, -Math.PI/2 + Math.PI*2*workProgress);
        ctx.stroke();
        ctx.strokeStyle = "rgba(43,35,32,0.22)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy - iso*0.08, 10, -Math.PI/2 + Math.PI*2*workProgress, -Math.PI/2 + Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }

      drawRepairDrone(ctx, cx, cy, alpha, bob*0.35, isWorking);

      if (window.BlockRender) window.BlockRender.invalidate();
    }
  };

  return api;
})();