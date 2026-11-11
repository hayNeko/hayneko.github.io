
'use strict';
const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const cv = createCanvas(L.W, L.H), ctx = cv.getContext('2d');
const post = new L.Post();
const T = 190.60;
const s = B.shotAt(T);
ctx.fillStyle = L.C.void; ctx.fillRect(0, 0, L.W, L.H);
const o = SCENES[s.scene](ctx, T, (T - s.t0) / s.dur, s) || {};
post.bloom(ctx, o.bloom === undefined ? 1 : o.bloom, o.chroma === undefined ? 2.5 : o.chroma, T);
post.finish(ctx, T, { flash: 0, grain: 0.08, scan: 0.45, vig: 1 });
// title block
const g = ctx.createLinearGradient(0, L.H - 420, 0, L.H);
g.addColorStop(0, 'rgba(3,5,8,0)'); g.addColorStop(0.55, 'rgba(3,5,8,0.78)'); g.addColorStop(1, 'rgba(3,5,8,0.96)');
ctx.fillStyle = g; ctx.fillRect(0, L.H - 420, L.W, 420);
ctx.font = L.F(22, L.CJK); ctx.fillStyle = L.rgba(L.C.phos, 0.92); ctx.textAlign = 'left';
ctx.fillText('DEEPSEEK 眼中的世界', 120, L.H - 228);
L.mono(ctx, 'DEEPSEEK EYES THE WORLD', 120 + 300, L.H - 232, 15, L.rgba(L.C.phos, 0.5), 4);
L.display(ctx, 'world.execute(me);', 116, L.H - 118, 132, '#EFFCF6', 'left', L.CONDX);
L.mono(ctx, 'A MUSIC ANIMATION CG  ·  3:28  ·  84 SHOTS  ·  208.60 s  ·  130.000 BPM', 120, L.H - 68, 15, L.rgba(L.C.cyan, 0.75), 2.2);
L.mono(ctx, 'EVERY FRAME DRAWN BY CODE', L.W - 120, L.H - 68, 15, L.rgba(L.C.dsLite, 0.8), 2.2, 'right');
fs.writeFileSync('out/poster.png', cv.toBuffer('image/png'));
console.log('poster written');
