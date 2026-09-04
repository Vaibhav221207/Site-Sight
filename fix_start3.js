const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
const end = c.indexOf('      </div>\n    </div>\n    </div>\n    </div>\n    <script>', c.indexOf('<div id="start-screen"'));
console.log('start:', start, 'end:', end);
const before = c.substring(0, start);
const after = c.substring(end + 36); // include the <script> tag
const newStart = '<div id="start-screen" aria-label="Site Sight">\n      <div class="start-sky" aria-hidden="true"></div>\n      <div class="start-atmosphere" aria-hidden="true"></div>\n      <div class="start-dossier">\n        <header class="start-head">\n          <h1 class="start-title">SITE SIGHT</h1>\n          <p class="start-subtitle">Uncharted 20\u00d720 \u2022 One HQ \u2022 No second chances</p>\n        </header>\n        <button id="start-enter" class="start-cta" type="button">DROP IN \u2014 ENTER SITE</button>\n      </div>\n    </div>';
const newContent = c.substring(0, start) + newStart + c.substring(end + 36);
fs.writeFileSync('index.html', newContent, 'utf8');
console.log('done');