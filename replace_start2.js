const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
const end = c.indexOf('      </div>\n    </div>\n    </div>\n    </div>\n    <script>', c.indexOf('<div id="start-screen"'));
console.log('start:', start, 'end:', end);
if (start >= 0 && end > start) {
  const before = c.substring(0, start);
  const after = c.substring(end + 36);
  const newStart = `<div id="start-screen" aria-label="Site Sight">
      <div class="start-bg" aria-hidden="true">
        <div class="start-bg-stars" aria-hidden="true"></div>
        <div class="start-scanlines" aria-hidden="true"></div>
        <div class="start-radar" aria-hidden="true"></div>
        <div class="start-grid" aria-hidden="true"></div>
      </div>

      <!-- Title and Button - visually separated -->
      <div class="start-content" role="document">
        <div class="start-title-block" aria-hidden="true">
          <h1 class="start-title" id="start-title">SITE SIGHT</h1>
          <p class="start-tagline" aria-hidden="true">Uncharted 20\u00d720 \u2022 One HQ \u2022 No second chances</p>
        </div>

        <div class="start-action-block">
          <button id="start-enter" class="start-enter-btn" type="button" aria-label="Enter the game">
            <span class="start-enter-text">ENTER GAME</span>
            <span class="start-enter-prompt" aria-hidden="true">\u25bc</span>
          </button>
          <p class="start-hint" aria-hidden="true">Press <kbd>Enter</kbd> or <kbd>Space</kbd> to begin</p>
        </div>
      </div>

      <!-- Background atmosphere -->
      <div class="start-atmosphere" aria-hidden="true">
        <div class="start-stars" aria-hidden="true"></div>
        <div class="start-scan-beam" aria-hidden="true"></div>
        <div class="start-grid-lines" aria-hidden="true"></div>
      </div>
    </div>`;
const newContent = c.substring(0, start) + newStart + c.substring(end + 36);
fs.writeFileSync('index.html', newContent, 'utf8');
console.log('done');