const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
const end = 2078 + 500 + 520 + 6; // start + 500 (afterStart offset) + sixthClose (520) + 6 (</script> length)
console.log('start:', start, 'end:', end);
const before = c.substring(0, start);
const after = c.substring(end);
const newStart = `<div id="start-screen" aria-label="Site Sight">
      <div class="start-sky" aria-hidden="true"></div>
      <div class="start-atmosphere" aria-hidden="true"></div>
      <div class="start-dossier">
        <header class="start-head">
          <h1 class="start-title">SITE SIGHT</h1>
          <p class="start-subtitle">Uncharted 20\u00d720 \u2022 One HQ \u2022 No second chances</p>
        </header>
        <button id="start-enter" class="start-cta" type="button">DROP IN \u2014 ENTER SITE</button>
      </div>
    </div>`;
const newContent = c.substring(0, start) + newStartScreen + c.substring(end);
fs.writeFileSync('index.html', newContent, 'utf8');
console.log('done');