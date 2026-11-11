
'use strict';
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const cv = createCanvas(L.W, L.H), ctx = cv.getContext('2d');
let bad = 0, warns = 0;
const rows = [];
for (const s of B.SHOTS){
  const fn = SCENES[s.scene];
  if (!fn){ console.log('MISSING SCENE ' + s.id + ' -> ' + s.scene); bad++; continue; }
  let worst = 1e9, worstAt = 0, err = null;
  for (let k = 1; k <= 5; k++){
    const t = s.t0 + s.dur * k / 6;
    ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = L.C.void; ctx.fillRect(0,0,L.W,L.H);
    try { fn(ctx, t, s.dur * k / 6, s); } catch(e){ err = e.message; break; }
    const d = ctx.getImageData(0, 0, L.W, L.H).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4 * 97) sum += (d[i] + d[i+1] + d[i+2]) / 3;
    const mean = sum / (d.length / (4 * 97));
    if (mean < worst){ worst = mean; worstAt = t; }
  }
  if (err){ console.log('THROW  ' + s.id + ': ' + err); bad++; continue; }
  rows.push({ id: s.id, m: worst, at: worstAt });
  if (worst < 1.2){ console.log('DARK   ' + s.id + '  mean=' + worst.toFixed(2) + ' at ' + worstAt.toFixed(2)); warns++; }
}
rows.sort((a,b) => a.m - b.m);
console.log('--- darkest 8');
rows.slice(0, 8).forEach(r => console.log('  ' + r.id.padEnd(14) + ' mean ' + r.m.toFixed(2)));
console.log('--- brightest 4');
rows.slice(-4).forEach(r => console.log('  ' + r.id.padEnd(14) + ' mean ' + r.m.toFixed(2)));
console.log('OK: ' + rows.length + ' shots clean, ' + bad + ' errors, ' + warns + ' suspected-empty');
