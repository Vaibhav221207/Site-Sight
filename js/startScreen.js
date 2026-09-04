/* js/startScreen.js — Site Sight Title Screen
 * Game-feel title screen with subtle parallax, animated title, juicy button,
 * and atmospheric background. No drone, no mini-game — just pure game feel.
 */
(function(){
  var startEl, enterBtn, skyEl, dossierEl, titleEl, taglineEl, enterBtn, hintEl;
  var raf = null, mx = 0, my = 0;

  function init(){
    var startEl = document.getElementById('start-screen');
    var enterBtn = document.getElementById('start-enter');
    var briefBtn = document.getElementById('start-brief');
    var briefPanel = document.getElementById('start-brief-panel');
    var skyEl = document.querySelector('#start-screen .start-bg');
    var dossierEl = document.querySelector('.start-title-block');
    var titleEl = document.getElementById('start-title');
    var taglineEl = document.querySelector('.start-tagline');
    var enterBtn = document.getElementById('start-enter');
    var hintEl = document.querySelector('.start-hint');
    if(!startEl) return;

    // Subtle parallax on mouse move — title block tilts slightly, background drifts
    var raf = null, mx = 0, my = 0;
    startEl.addEventListener('mousemove', function(e){
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
      });
    });
    startEl.addEventListener('mouseleave', function(){
      if(dossierEl) dossierEl.style.transform = '';
      if(skyEl) skyEl.style.transform = '';
    });

    if(enterBtn){
      enterBtn.addEventListener('click', hide);
      enterBtn.addEventListener('keydown', function(e){
        if(e.key==='Enter' || e.key===' ') { e.preventDefault(); hide(); }
      });
    }

    // Enter/Space to start, Esc to toggle
    window.addEventListener('keydown', function(e){
      if(e.key==='Enter' || e.key===' ') { e.preventDefault(); hide(); }
      else if(e.key==='Escape' && !startEl.classList.contains('hidden')){
        hide();
      } else if(e.key==='Escape' && startEl.classList.contains('hidden')){
        show();
      }
    });

    // Enter button press animation
    var enterBtn = document.getElementById('start-enter');
    if(enterBtn){
      enterBtn.addEventListener('mousedown', function(){
        this.style.transform = 'translateY(2px) scale(0.98)';
      });
      window.addEventListener('mouseup', function(){
        var btn = document.getElementById('start-enter');
        if(btn) btn.style.transform = '';
      });
      enterBtn.addEventListener('mouseleave', function(){
        this.style.transform = '';
      });
    }

    // Subtle idle animations for title and button
    startIdleAnimations();

    // Enter/Space to start, Esc to toggle
    window.addEventListener('keydown', function(e){
      if(e.key==='Enter' || e.key===' ') { e.preventDefault(); hide(); }
      else if(e.key==='Escape' && !startEl.classList.contains('hidden')){
        hide();
      } else if(e.key==='Escape' && startEl.classList.contains('hidden')){
        show();
      }
    });

    // Subtle idle animations for title and button
    startIdleAnimations();

    window.addEventListener('site:started', function(){});
  }

  function startIdleAnimations(){
    // Title float handled by CSS
    // Button bob handled by CSS
  }

  function hide(){
    var startEl = document.getElementById('start-screen');
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
    var startEl = document.getElementById('start-screen');
    if(!startEl) return;
    startEl.classList.remove('hidden');
    if(typeof anime !== 'undefined' && anime){
      anime.set(startEl, {opacity:0, scale:0.96});
      anime({targets: startEl, opacity:[0,1], scale:[0.96,1], duration:280, easing:'easeOutCubic'});
    }
    if(enterBtn) enterBtn.focus();
  }

  window.StartScreen = { hide: hide, show: show };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();