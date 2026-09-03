/* js/startScreen.js — ConTech Dossier start screen (chunky, game-matched).
 * Isolated overlay — does not touch game logic, just gates visibility.
 * Interactive: hoverable site-ops map that teases the real terrain.
 */
(function(){
  var startEl, enterBtn, briefBtn, briefPanel, opsMap;

  function init(){
    startEl = document.getElementById('start-screen');
    enterBtn = document.getElementById('start-enter');
    briefBtn = document.getElementById('start-brief');
    briefPanel = document.getElementById('start-brief-panel');
    opsMap = document.getElementById('start-ops-map');
    if(!startEl) return;

    // 10×10 ops map — hover to preview scan, click to pulse HQ
    if(opsMap){
      var pal = { land: '#7EB24A', river: '#5B6FA8', trench: '#4A3F6B', rock: '#9AA3AB', hq: '#44ddbb' };
      for(var i=0;i<100;i++){
        var r = Math.floor(i/10), c = i%10;
        var cell = document.createElement('div');
        cell.className = 'sleg-cell';
        var isRiver = (r===4 && c>=2 && c<=6) || (r===5 && c>=3 && c<=7);
        var isTrench = (r>=6 && r<=8 && c>=6 && c<=8);
        var isRock = (i===12 || i===18 || i===73);
        var t = isRiver ? 'river' : isTrench ? 'trench' : isRock ? 'rock' : 'land';
        cell.style.background = pal[t];
        cell.title = t;
        cell.addEventListener('mouseenter', (function(el, tt){
          return function(){ el.style.filter='brightness(1.25)'; el.style.transform='scale(1.08)'; };
        })(cell, t));
        cell.addEventListener('mouseleave', (function(el){
          return function(){ el.style.filter=''; el.style.transform=''; };
        })(cell));
        opsMap.appendChild(cell);
      }
      // pulse center HQ
      var hqCell = opsMap.children[44];
      if(hqCell){
        hqCell.style.background = pal.hq;
        hqCell.style.boxShadow = '0 0 0 2px #E8604A';
        setInterval(function(){ hqCell.style.opacity = hqCell.style.opacity==='0.85'?'1':'0.85'; }, 900);
      }
    }

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
