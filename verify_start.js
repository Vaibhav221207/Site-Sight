const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');
const start = content.indexOf('<div id="start-screen"');
console.log('start:', start);
const end = content.indexOf('      </div>\n    </div>\n    </div>\n    </div>\n    <script>', start);
console.log('end:', end);
if (start >= 0 && end > start) {
  const snippet = content.substring(start, end + 36);
  console.log('SNIPPET:', snippet.substring(0, 500));
}
console.log('Has BRIEFING:', content.includes('BRIEFING'));
console.log('Has budget:', content.includes('BUDGET AUTHORIZED'));
console.log('Has blurb:', content.includes('raw land'));