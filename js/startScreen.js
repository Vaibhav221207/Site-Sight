/* js/startScreen.js — playful Site Sight title screen.
 * Ambient CSS only: star drift + twinkle, one title float, one button bob.
 * This file: letter-split title (staggered entrance, hover wobble),
 * cursor-follow scan reveal (auto-roams on touch), an occasional shooting
 * star, and the press-slam -> mini-build loader -> wipe exit.
 */
(function(){
  var entered = false;
  var screen = null, btn = null, loader = null, meteor = null;
  var rafId = null, meteorTimer = null;
  var mx = 50, my = 66, tx = 50, ty = 66;      // reveal pos (%): eased -> target
  var lastPointer = 0;
  var loading = false, prog = 0, shown = 0, lastTs = 0, shownPct = -1;
  var loadTiles = [], fillOrder = [];
  // Deterministic capture hook: index.html#shot renders the settled state
  // (no entrance, no meteor). Zero effect on normal loads.
  var shotMode = (window.location && window.location.hash === '#shot');

  // Loader build grid — reuses the main game's tile pop recipe exactly:
  // js/blockRender.js animateRise() tweens rise 0 -> POP_RISE px over
  // POP_DUR ms with easeOutCubic (there: POP_RISE = 16, POP_DUR = 280).
  // Positions come straight from window.IsoGrid.worldToScreen, top colors
  // from Terrain.colorAt/baseColorAt, sides via the same shade math as
  // drawBlock (LEFT 0.62 / RIGHT 0.42 over BASE_H 4 + elevation) — so a
  // settled loader tile sits EXACTLY on its live twin. Read-only: the
  // loader never writes game state.
  var LOAD_RISE = 16, LOAD_DUR = 280, LOAD_EASE = 'easeOutCubic';
  var LOAD_BASE = 4, LOAD_LEFT = 0.62, LOAD_RIGHT = 0.42, LOAD_RIVER_A = 0.85;
  var LOAD_MS = 6000;        // full auto load takes ~6s: 400 tiles row by row
  var loadCtx = null, loadW = 0, loadH = 0, gridDirty = false;
  var loadTimers = [], loadOrder = [];
  function loadShade(hex, factor){
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgb(' + Math.min(255, Math.round(r * factor)) + ',' + Math.min(255, Math.round(g * factor)) + ',' + Math.min(255, Math.round(b * factor)) + ')';
  }

  function init(){
    screen = document.getElementById('start-screen');
    btn = document.getElementById('start-enter');
    loader = document.getElementById('site-loader');
    if(!screen || !btn) return;

    splitLetters();
    btn.addEventListener('click', enter);
    screen.addEventListener('pointermove', onPointer);
    window.addEventListener('keydown', onKey);

    lastPointer = now();
    if(shotMode) { startLoop(); if(btn) btn.focus(); return; }
    entrance();
    startLoop();
    scheduleMeteor(2500);
    btn.focus();
  }

  function now(){
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  function reducedMotion(){
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function anim(){
    return (typeof anime !== 'undefined') ? anime : null;
  }

  // Split the title into per-letter spans (screen readers keep one label).
  function splitLetters(){
    var h1 = document.getElementById('start-title');
    if(!h1 || h1.querySelector('.ch')) return;
    var text = h1.textContent;
    h1.setAttribute('aria-label', text);
    h1.textContent = '';
    for(var i = 0; i < text.length; i++){
      var s = document.createElement('span');
      if(text[i] === ' '){
        s.className = 'sp';
        s.innerHTML = '&nbsp;';
      } else {
        s.className = 'ch';
        s.textContent = text[i];
        s.addEventListener('mouseenter', function(){ wobble(this); });
      }
      s.setAttribute('aria-hidden', 'true');
      h1.appendChild(s);
    }
  }

  // Site drop-in: letters fall from the sky and land like survey blocks.
  function entrance(){
    var a = anim();
    if(!a || reducedMotion() || !screen) return;
    var chars = screen.querySelectorAll('.start-title .ch');
    var action = screen.querySelector('.start-action-block');
    if(!chars.length) return;
    letterEls = chars;
    a.set(chars, { translateY: -200, opacity: 0, rotate: -10 });
    a.set(action, { opacity: 0 });
    a.timeline()
      .add({
        targets: chars, translateY: [-200, 0], opacity: [0, 1], rotate: [-10, 0],
        duration: 700, delay: a.stagger(45), easing: 'easeOutExpo',
        complete: landing
      })
      .add({ targets: action, opacity: [0, 1], duration: 300, easing: 'easeOutQuad' }, '-=250');
  }

  // Touchdown: dust where a few blocks landed + a tiny ground thump.
  function landing(){
    if(!screen || entered || !letterEls.length) return;
    for(var k = 0; k < 3; k++){
      var host = letterEls[Math.floor(Math.random() * letterEls.length)];
      for(var i = 0; i < 3; i++) dustAt(host, 3 + Math.random() * 4);
    }
    if(anim() && !reducedMotion()){
      anim()({ targets: screen, translateX: [0, -2, 2, 0], duration: 120, easing: 'linear' });
    }
  }

  function dustAt(host, size){
    var d = document.createElement('span');
    d.className = 'start-dust';
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    host.appendChild(d);
    var dir = Math.random() < 0.5 ? -1 : 1;
    anim()({
      targets: d,
      translateX: [0, dir * (20 + Math.random() * 30)],
      translateY: [0, -6 - Math.random() * 14],
      opacity: [0.9, 0],
      duration: 380 + Math.random() * 160, easing: 'easeOutQuad',
      complete: (function(el){ return function(){ el.remove(); }; })(d)
    });
  }

  // One letter squash-stretches when the cursor brushes it.
  function wobble(span){
    var a = anim();
    if(!a || reducedMotion() || span._busy || entered) return;
    span._busy = true;
    a({
      targets: span,
      scaleY: [1, 0.72, 1.18, 1], scaleX: [1, 1.22, 0.9, 1],
      duration: 340, easing: 'easeOutQuad',
      complete: function(){ span._busy = false; }
    });
  }

  function onPointer(e){
    if(!screen || reducedMotion()) return;
    var r = screen.getBoundingClientRect();
    if(r.width > 0 && r.height > 0){
      tx = ((e.clientX - r.left) / r.width) * 100;
      ty = ((e.clientY - r.top) / r.height) * 100;
    }
    lastPointer = now();
  }

  // One rAF loop: eases the reveal disc toward the pointer,
  // or roams the disc on its own when nobody is touching anything.
  function loop(ts){
    if(!screen || screen.classList.contains('hidden')){
      rafId = null;
      return;
    }
    if(ts - lastPointer > 4000){
      tx = 50 + 32 * Math.sin(ts * 0.00021);
      ty = 46 + 26 * Math.sin(ts * 0.000157 + 1.3);
    }
    mx += (tx - mx) * 0.12;
    my += (ty - my) * 0.12;
    screen.style.setProperty('--mx', mx.toFixed(2) + '%');
    screen.style.setProperty('--my', my.toFixed(2) + '%');
    if(loading) driveLoading(ts);
    if(gridDirty) drawLoadGrid();
    lastTs = ts;
    rafId = requestAnimationFrame(loop);
  }

  // Loader: progress climbs automatically; each percent reveals the next
  // tiles row by row, every tile popping with the game's own rise motion.
  function driveLoading(ts){
    var dt = Math.min(ts - (lastTs || ts), 50);
    prog = Math.min(prog + dt * (100 / LOAD_MS), 100);
    var target = Math.floor(prog / 100 * fillOrder.length);
    while(shown < target){ popLoadTile(loadTiles[fillOrder[shown]]); shown++; }
    var v = Math.floor(prog);
    if(v !== shownPct){
      shownPct = v;
      var pct = loader.querySelector('.site-loader-pct');
      var chip = loader.querySelector('.site-loadhud');
      if(pct) pct.textContent = v + '%';
      if(chip) chip.setAttribute('aria-valuenow', String(v));
    }
    if(prog >= 100){
      loading = false;
      settleAndDissolve();
    }
  }

  function popLoadTile(t){
    if(!t) return;
    var a = anim();
    if(a && !reducedMotion()){
      a({
        targets: t, rise: LOAD_RISE, alpha: 1,
        duration: LOAD_DUR, easing: LOAD_EASE,
        update: function(){ gridDirty = true; }
      });
    } else {
      t.rise = LOAD_RISE;
      t.alpha = 1;
      gridDirty = true;
    }
  }

  function drawLoadGrid(){
    if(!loadCtx || !gridDirty) return;
    gridDirty = false;
    var g = window.IsoGrid;
    if(!g || !g.isoSize || !g.worldToScreen) return;
    var T = window.Terrain;
    var ctx = loadCtx, iso = g.isoSize, half = iso / 2;
    ctx.clearRect(0, 0, loadW, loadH);
    for(var i = 0; i < loadOrder.length; i++){
      var t = loadTiles[loadOrder[i]];
      if(t.alpha <= 0) continue;
      var p = g.worldToScreen(t.c, t.r);
      var elev = 0;
      try { if(T && T.elevationAt) elev = T.elevationAt(t.c, t.r) || 0; } catch(e){}
      var topY = p.y - (LOAD_BASE + elev + t.rise);
      var cx = p.x;
      var top = loadTopColor(t);
      ctx.globalAlpha = t.alpha * (t.type === 'river' ? LOAD_RIVER_A : 1);
      if(t.type === 'trench'){
        // sunken floor diamond, like the pit (walls dissolve away unseen)
        diamondAt(ctx, cx, p.y + 5, iso, half, top);
      } else {
        // side faces first, top face last — identical math to drawBlock
        ctx.fillStyle = loadShade(top, LOAD_LEFT);
        ctx.beginPath();
        ctx.moveTo(cx - iso, topY); ctx.lineTo(cx, topY + half);
        ctx.lineTo(cx, p.y + half); ctx.lineTo(cx - iso, p.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = loadShade(top, LOAD_RIGHT);
        ctx.beginPath();
        ctx.moveTo(cx, topY + half); ctx.lineTo(cx + iso, topY);
        ctx.lineTo(cx + iso, p.y); ctx.lineTo(cx, p.y + half);
        ctx.closePath(); ctx.fill();
        diamondAt(ctx, cx, topY, iso, half, top);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loadTopColor(t){
    var top = '#7EB24A';
    try {
      var T = window.Terrain;
      if(T){
        if(t.type === 'rock' && T.baseColorAt) top = T.baseColorAt(t.c, t.r);
        else if(T.colorAt) top = T.colorAt(t.c, t.r);
      }
    } catch(e){}
    return top || '#7EB24A';
  }

  function diamondAt(ctx, cx, topY, iso, half, fill){
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, topY - half);
    ctx.lineTo(cx + iso, topY);
    ctx.lineTo(cx, topY + half);
    ctx.lineTo(cx - iso, topY);
    ctx.closePath();
    ctx.fill();
  }

  function startLoop(){
    if(rafId === null && !reducedMotion() && window.requestAnimationFrame){
      rafId = window.requestAnimationFrame(loop);
    }
  }

  function stopLoop(){
    if(rafId !== null){
      if(window.cancelAnimationFrame) window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function scheduleMeteor(delay){
    if(meteorTimer) clearTimeout(meteorTimer);
    meteorTimer = null;
    if(reducedMotion() || !anim()) return;
    meteorTimer = setTimeout(flyMeteor, delay);
  }

  function flyMeteor(){
    meteorTimer = null;
    if(!screen || entered || screen.classList.contains('hidden')){
      return;
    }
    if(!meteor){
      meteor = document.createElement('div');
      meteor.className = 'start-meteor';
      meteor.setAttribute('aria-hidden', 'true');
      screen.appendChild(meteor);
    }
    meteor.style.left = (15 + Math.random() * 70) + '%';
    meteor.style.top = (4 + Math.random() * 30) + '%';
    anim()({
      targets: meteor, rotate: -24, translateX: [60, -320], opacity: [0, 0.9, 0],
      duration: 950, easing: 'easeInQuad',
      complete: function(){ scheduleMeteor(6000 + Math.random() * 7000); }
    });
  }

  function onKey(e){
    if(!screen) return;
    if(e.key === 'Enter' || e.key === ' '){
      if(screen.classList.contains('hidden') || entered) return;
      e.preventDefault();
      enter();
    } else if(e.key === 'Escape'){
      if(screen.classList.contains('hidden')) show();
      else if(!entered) enter();
    }
  }

  // Compactor slam: anticipation rise, impact (shake + dust), recover —
  // then content fades and the mini-build loader takes over.
  function enter(){
    if(entered) return;
    if(!screen || !btn || !loader || screen.classList.contains('hidden')) return;
    entered = true;

    if(reducedMotion() || !anim()){
      finish();
      return;
    }

    screen.classList.add('is-leaving');
    loader.hidden = false;

    anim().timeline()
      .add({ targets: btn, translateY: [0, -7], duration: 90, easing: 'easeOutQuad' })
      .add({
        targets: btn, translateY: [-7, 6], scale: [1, 0.9],
        duration: 80, easing: 'easeInQuad',
        begin: function(){ btn.classList.add('is-down'); },
        complete: impact
      })
      .add({
        targets: btn, translateY: [6, 0], scale: [0.9, 1],
        duration: 160, easing: 'easeOutBack',
        complete: function(){ btn.classList.remove('is-down'); }
      })
      .add({
        targets: ['.start-title-block', '.start-action-block'],
        opacity: [1, 0], translateY: [0, -14],
        duration: 220, easing: 'easeInQuad'
      }, '-=60')
      .add({ targets: loader, opacity: [0, 1], duration: 200, easing: 'linear' }, '-=60')
      .add({ targets: '#site-loadgrid', scale: [0.96, 1], duration: 320, easing: 'easeOutQuad' }, '-=200')
      .add({
        targets: { t: 0 }, t: [0, 1], duration: 120, easing: 'linear',
        complete: startLoading
      });
  }

  // Impact frame: tiny screen shake + dust burst. Transient by design.
  function impact(){
    anim()({
      targets: screen,
      translateX: [0, -4, 3, -2, 0], translateY: [0, 2, -2, 1, 0],
      duration: 160, easing: 'linear'
    });
    for(var i = 0; i < 7; i++){
      var d = document.createElement('span');
      d.className = 'start-dust';
      var sz = 5 + Math.random() * 5;
      d.style.width = sz + 'px';
      d.style.height = sz + 'px';
      btn.appendChild(d);
      var ang = (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.2;
      var dist = 40 + Math.random() * 60;
      anim()({
        targets: d,
        translateX: [0, Math.cos(ang) * dist],
        translateY: [0, -10 - Math.random() * 30],
        opacity: [0.95, 0],
        duration: 420 + Math.random() * 200, easing: 'easeOutQuad',
        complete: (function(el){ return function(){ el.remove(); }; })(d)
      });
    }
  }

  // Settle + invisible cut: raised tiles ease back onto their live twins
  // in diagonal bands, then the overlay (now pixel-identical to the game
  // beneath) fades — the cut cannot be seen.
  function settleAndDissolve(){
    var a = anim();
    for(var s = 0; s <= 38; s++){
      (function(sum){
        loadTimers.push(setTimeout(function(){
          for(var i = 0; i < loadTiles.length; i++){
            var t = loadTiles[i];
            if(t.c + t.r !== sum || t.rise <= 0) continue;
            if(a && !reducedMotion()){
              (function(tt){
                a({ targets: tt, rise: 0, duration: 320, easing: 'easeInOutQuad',
                  update: function(){ gridDirty = true; } });
              })(t);
            } else { t.rise = 0; gridDirty = true; }
          }
          if(sum === 38){
            loadTimers.push(setTimeout(function(){
              if(!screen || screen.classList.contains('hidden')) return;
              if(a && !reducedMotion()){
                a({ targets: loader, opacity: [1, 0], duration: 400, easing: 'easeOutQuad',
                  complete: finish });
              } else finish();
            }, 340));
          }
        }, sum * 12));
      })(s);
    }
  }

  function startLoading(){
    var cv = document.getElementById('site-loadgrid');
    loadCtx = cv ? cv.getContext('2d') : null;
    var gw = window.innerWidth, gh = window.innerHeight;
    if(loadCtx && cv){
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      loadW = gw;
      loadH = gh;
      cv.width = Math.round(gw * dpr);
      cv.height = Math.round(gh * dpr);
      loadCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      loadCtx.clearRect(0, 0, loadW, loadH);
    }
    var T = window.Terrain, n = 20;
    try { if(T && window.IsoGrid && window.IsoGrid.gridSize) n = window.IsoGrid.gridSize; } catch(e){}
    loadTiles = [];
    loadOrder = [];
    for(var r = 0; r < n; r++) for(var c = 0; c < n; c++){
      var ty = 'land';
      try { if(T && T.typeAt) ty = T.typeAt(c, r) || 'land'; } catch(e){}
      loadTiles.push({ c: c, r: r, rise: 0, alpha: 0, type: ty });
      loadOrder.push(r * n + c);
    }
    loadOrder.sort(function(a, b){
      var ar = (a / n) | 0, ac = a % n, br = (b / n) | 0, bc = b % n;
      return (ac + ar) - (bc + br);
    });
    // snake fill path so the survey drone never teleports between rows
    fillOrder = [];
    for(var fr = 0; fr < n; fr++){
      if(fr % 2 === 0){ for(var fc = 0; fc < n; fc++) fillOrder.push(fr * n + fc); }
      else { for(var fc2 = n - 1; fc2 >= 0; fc2--) fillOrder.push(fr * n + fc2); }
    }
    prog = 0; shown = 0; shownPct = -1;
    var pct = loader.querySelector('.site-loader-pct');
    var chip = loader.querySelector('.site-loadhud');
    if(pct) pct.textContent = '0%';
    if(chip) chip.setAttribute('aria-valuenow', '0');
    if(loader) loader.style.pointerEvents = 'auto';
    lastTs = now();
    loading = true;
  }

  function finish(){
    stopLoop();
    loading = false;
    for(var li = 0; li < loadTimers.length; li++){ try { clearTimeout(loadTimers[li]); } catch(e){} }
    loadTimers = [];
    if(meteorTimer){ clearTimeout(meteorTimer); meteorTimer = null; }
    if(loader) loader.style.pointerEvents = '';
    if(btn){
      var dust = btn.querySelectorAll('.start-dust');
      for(var i = 0; i < dust.length; i++) dust[i].remove();
    }
    if(screen){
      screen.classList.add('hidden');
      screen.classList.remove('is-leaving');
      if(anim() && anim().remove) anim().remove(screen);
      screen.style.transform = '';
      screen.style.opacity = '';
    }
    window.dispatchEvent(new CustomEvent('site:started'));
  }

  function show(){
    if(!screen) return;
    entered = false;
    loading = false;
    for(var lj = 0; lj < loadTimers.length; lj++){ try { clearTimeout(loadTimers[lj]); } catch(e){} }
    loadTimers = [];
    if(loader) loader.style.pointerEvents = '';
    prog = 0; shown = 0; shownPct = -1;
    loadTiles = [];
    var cv0 = document.getElementById('site-loadgrid');
    if(cv0) cv0.style.transform = '';
    if(loadCtx){ loadCtx.clearRect(0, 0, loadW, loadH); gridDirty = false; }
    if(loader){
      loader.hidden = true;
      loader.style.opacity = '';
      var pct = loader.querySelector('.site-loader-pct');
      var chip = loader.querySelector('.site-loadhud');
      if(pct) pct.textContent = '0%';
      if(chip) chip.setAttribute('aria-valuenow', '0');
    }
    if(btn){ btn.style.transform = ''; btn.classList.remove('is-down'); }
    screen.classList.remove('hidden', 'is-leaving');
    screen.style.transform = '';
    var title = screen.querySelector('.start-title-block');
    var action = screen.querySelector('.start-action-block');
    if(title){ title.style.opacity = ''; title.style.transform = ''; }
    if(action){ action.style.opacity = ''; action.style.transform = ''; }
    if(btn && anim() && !reducedMotion()){
      anim()({ targets: [title, action], opacity: [0, 1], duration: 260, easing: 'easeOutQuad' });
    }
    lastPointer = now();
    startLoop();
    scheduleMeteor(3000);
    if(btn) btn.focus();
  }

  window.StartScreen = { hide: enter, show: show };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
