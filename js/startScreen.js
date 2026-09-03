/* js/startScreen.js — Start screen for Site Sight (Pro Max Minimalism experiment).
 * Isolated overlay — does not touch game logic, just gates visibility.
 * Uses: Flexbox/Grid, safe-area, focus-visible, CustomEvent, no RAF polling.
 */
(function(){
  var startEl, enterBtn, howBtn, howPanel, miniGrid, viewportEl;

  function init(){
    startEl = document.getElementById('start-screen');
    enterBtn = document.getElementById('start-enter');
    howBtn = document.getElementById('start-how');
    howPanel = document.getElementById('start-how-panel');
    miniGrid = document.getElementById('start-mini-grid');
    viewportEl = document.getElementById('start-viewport');
    if(!startEl) return;

    // build 5x5 mini grid — interactive demo of zoning colors
    if(miniGrid){
      for(var i=0;i<25;i++){
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'mcell';
        cell.setAttribute('aria-label', 'Demo cell '+(i+1));
        // center + random hilite for demo
        if(i===12) cell.classList.add('is-ctr');
        if([6,8,16,18].indexOf(i)>=0) cell.classList.add('is-hil');
        cell.addEventListener('click', (function(c){
          return function(){
            c.classList.toggle('is-hil');
            c.style.background = c.classList.contains('is-hil') ? '#D97706' : '';
          };
        })(cell));
        miniGrid.appendChild(cell);
      }
    }

    if(viewportEl){
      var upd = function(){ viewportEl.textContent = window.innerWidth+'×'+window.innerHeight+' @'+(window.devicePixelRatio||1)+'x'; };
      upd();
      window.addEventListener('resize', upd);
    }

    if(enterBtn){
      enterBtn.addEventListener('click', hide);
      enterBtn.addEventListener('keydown', function(e){
        if(e.key==='Enter' || e.key===' ') { e.preventDefault(); hide(); }
      });
    }
    if(howBtn && howPanel){
      howBtn.addEventListener('click', function(){
        var expanded = howBtn.getAttribute('aria-expanded')==='true';
        howBtn.setAttribute('aria-expanded', !expanded);
        howPanel.hidden = expanded;
        if(!expanded) howPanel.scrollIntoView({behavior:'smooth', block:'nearest'});
      });
    }

    // focus first CTA for keyboard
    if(enterBtn) enterBtn.focus();

    // Esc to re-open in-game
    window.addEventListener('keydown', function(e){
      if(e.key==='Escape' && startEl.classList.contains('hidden')){
        show();
      } else if(e.key==='Escape' && !startEl.classList.contains('hidden')){
        hide();
      }
    });

    // CustomEvent example — start screen listens for game state, not polling
    window.addEventListener('site:started', function(){ /* hook for future */ });
  }

  function hide(){
    if(!startEl || startEl.classList.contains('hidden')) return;
    if(typeof anime !== 'undefined' && anime){
      anime({
        targets: startEl,
        opacity: [1,0],
        scale: [1,0.96],
        duration: 260,
        easing: 'easeInCubic',
        complete: function(){
          startEl.classList.add('hidden');
          startEl.style.opacity='';
          startEl.style.transform='';
          window.dispatchEvent(new CustomEvent('site:started'));
        }
      });
    } else {
      startEl.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('site:started'));
    }
  }

  function show(){
    if(!startEl) return;
    startEl.classList.remove('hidden');
    if(typeof anime !== 'undefined' && anime){
      anime.set(startEl, {opacity:0, scale:0.96});
      anime({targets: startEl, opacity:[0,1], scale:[0.96,1], duration:280, easing:'easeOutCubic'});
    }
    if(enterBtn) enterBtn.focus();
  }

  // expose for console / menu
  window.StartScreen = { hide: hide, show: show };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
