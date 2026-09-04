const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
const afterStart = c.substring(start + 500);
// Find the exact end by looking for the pattern
const idx1 = afterStart.indexOf('</div>');
const idx2 = afterStart.indexOf('</div>', idx1 + 1);
const idx3 = afterStart.indexOf('</div>', idx2 + 1);
const idx4 = afterStart.indexOf('</div>', idx3 + 1);
const idx5 = afterStart.indexOf('</div>', idx4 + 1);
const idx6 = afterStart.indexOf('</div>', idx5 + 1);
console.log('idx1:', afterStart.substring(idx1, idx1+30));
console.log('idx2:', afterStart.substring(idx2, idx2+30));
console.log('idx3:', afterStart.substring(idx3, idx3+30));
console.log('idx4:', afterStart.substring(idx4, idx4+30));
console.log('idx5:', afterStart.substring(idx5, idx5+30));
console.log('idx6:', afterStart.substring(idx6, idx6+30));
console.log('idx6 pos:', idx6);
console.log('end in full:', start + 500 + idx6 + 6);