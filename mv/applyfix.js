
const fs = require('fs');
const fixes = JSON.parse(fs.readFileSync('fix.json', 'utf8'));
let bad = 0;
for (const [file, oldS, newS] of fixes){
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(oldS)) { console.log('MISS in ' + file + ': ' + oldS.slice(0, 60).replace(/\n/g, ' | ')); bad++; continue; }
  s = s.split(oldS).join(newS);
  fs.writeFileSync(file, s);
}
console.log('applied', fixes.length - bad, 'misses', bad);
