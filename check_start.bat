@echo off
cd /d D:\game 3
node -e "const fs=require('fs'); const c=fs.readFileSync('index.html','utf8'); console.log('Has BRIEFING:', c.includes('BRIEFING')); console.log('Has budget:', c.includes('BUDGET AUTHORIZED')); console.log('Has blurb:', c.includes('raw land'));"