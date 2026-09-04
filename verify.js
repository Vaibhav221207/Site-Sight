const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.indexOf('<div id="start-screen"');
console.log('start:', start);
console.log('snippet:', c.substring(start, start + 300));