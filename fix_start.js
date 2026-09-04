const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const start = 2078;
const end = 4289;

const before = content.substring(0, start);
const after = content.substring(end);

const newStartScreen = `<div id="start-screen" aria-label="Site Sight">
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

const newContent = content.substring(0, 2078) + newStartScreen + content.substring(4289);
fs.writeFileSync('index.html', newContent, 'utf8');
console.log('done');