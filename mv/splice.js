
const fs = require('fs');
let s = fs.readFileSync('scenes/a_boot.js', 'utf8');
const M = n => '// ---------------------------------------------------------------- ' + n;
const seq = ['a_cursor','a_line','a_dive','a_ecc','a_tiling','a_arena','a_object'];
for (const k of seq){
  const p = 'parts2/' + k + '.txt';
  if (!fs.existsSync(p)) continue;
  const a = s.indexOf(M(k));
  const nx = seq[seq.indexOf(k) + 1];
  const b = nx ? s.indexOf(M(nx)) : s.indexOf('module.exports');
  if (a < 0 || b < 0) throw new Error('fail ' + k);
  s = s.slice(0, a) + fs.readFileSync(p, 'utf8').trimEnd() + '\n\n' + s.slice(b);
}
fs.writeFileSync('scenes/a_boot.js', s);
console.log('ok', s.length);
