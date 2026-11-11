
'use strict';
const fs = require('fs');
let s = fs.readFileSync('scenes/a_boot.js', 'utf8');
const M = (name) => '// ---------------------------------------------------------------- ' + name;

function splice(file, marker, nextMarker, code){
  const a = file.indexOf(M(marker));
  const b = nextMarker ? file.indexOf(M(nextMarker)) : file.indexOf('module.exports');
  if (a < 0 || b < 0 || b <= a) throw new Error('splice fail ' + marker + ' ' + a + ' ' + b);
  return file.slice(0, a) + code.trimEnd() + '\n\n' + file.slice(b);
}

s = splice(s, 'a_cursor', 'a_line', String.raw