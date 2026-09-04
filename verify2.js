const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
const end = c.indexOf('      </div>\n    </div>\n    </div>\n    </div>\n    <script>', start);
console.log('start:', start);
console.log('end:', end);
if (start >= 0 && end > start) {
  console.log('snippet:', c.substring(start, end + 36));
}
console.log('Has BRIEFING:', c.includes('BRIEFING'));
console.log('Has budget:', c.includes('BUDGET AUTHORIZED'));
console.log('Has blurb:', c.includes('raw land'));