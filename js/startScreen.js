/* js/startScreen.js — ConTech Dossier start screen (chunky, game-matched).
 * Whole-page alive: dossier tilts + sky parallax follow mouse, not a boxed mini-game.
 * Uses Baloo 2 / coral / cream to match the game, not Pro Max teal.
 */
(function(){
  var startEl, enterBtn, briefBtn, briefPanel, skyEl, dossierEl;

  function init(){
    startEl = document.getElementById('start-screen');
    enterBtn = document.getElementById('start-enter');
    briefBtn = document.getElementById('start-brief');
    briefPanel = document.getElementById('start-brief-panel');
    skyEl = document.querySelector('#start-screen .start-sky');
    dossierEl = document.querySelector('#start-screen .start-dossier');
    var droneEl = document.getElementById('start-cursor-drone');
    if(!startEl) return;

    // whole-page alive: dossier tilt + sky + cursor-drone follows mouse
    var raf = null, mx = 0, my = 0, tx = window.innerWidth/2, ty = window.innerHeight/2, cx = tx, cy = ty;
    // init drone at center
    if(droneEl){ droneEl.style.transform = 'translate('+(cx-26)+'px,'+(cy-16)+'px)'; }
    startEl.addEventListener('mousemove', function(e){
      tx = e.clientX; ty = e.clientY;
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
      if(raf) return;
      raf = requestAnimationFrame(function(){
        raf = null;
        if(dossierEl){
          dossierEl.style.transform = 'perspective(900px) rotateY('+(mx*2.2)+'deg) rotateX('+(-my*1.6)+'deg) translateZ(0)';
        }
        if(skyEl){
          skyEl.style.transform = 'translate('+(mx*10)+'px,'+(my*7)+'px) scale(1.02)';
        }
        // drone follows with lerp
        if(droneEl){
          cx += (tx - cx) * 0.14;
          cy += (ty - cy) * 0.14;
          droneEl.style.transform = 'translate('+(cx-26)+'px,'+(cy-16)+'px) rotate('+(mx*6)+'deg)';
        }
        if(Math.abs(tx-cx) > 0.5 || Math.abs(ty-cy) > 0.5){
          raf = requestAnimationFrame(arguments.callee);
        }
      });
    });
    startEl.addEventListener('mouseleave', function(){
      if(dossierEl) dossierEl.style.transform = '';
      if(skyEl) skyEl.style.transform = '';
      if(droneEl) droneEl.style.opacity = '0';
    });
    startEl.addEventListener('mouseenter', function(){
      if(droneEl) droneEl.style.opacity = '1';
    });

    if(enterBtn){
      enterBtn.addEventListener('click', hide);
      enterBtn.addEventListener('keydown', function(e){
        if(e.key==='Enter' || e.key===' ') { e.preventDefault(); hide(); }
      });
    }
    if(briefBtn && briefPanel){
      briefBtn.addEventListener('click', function(){
        var expanded = briefBtn.getAttribute('aria-expanded')==='true';
        briefBtn.setAttribute('aria-expanded', !expanded);
        briefPanel.hidden = expanded;
      });
    }

    if(enterBtn) enterBtn.focus();

    window.addEventListener('keydown', function(e){
      if(e.key==='Escape' && startEl.classList.contains('hidden')){
        show();
      } else if(e.key==='Escape' && !startEl.classList.contains('hidden')){
        hide();
      }
    });

    window.addEventListener('site:started', function(){});
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
