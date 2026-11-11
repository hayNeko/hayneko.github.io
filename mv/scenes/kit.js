
'use strict';
const L = require('../engine/lib.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU } = L;

// ---- unit cube in wireframe ----
const CUBE_V = [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]];
const CUBE_E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const CUBE_F = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,3,7,4]];

function tf(p, rot, scale, off){
  let [x,y,z] = p;
  scale = scale === undefined ? 1 : scale;
  x *= scale; y *= scale; z *= scale;
  if (rot){
    const cy = Math.cos(rot[1]), sy = Math.sin(rot[1]);
    let x1 = x*cy + z*sy, z1 = -x*sy + z*cy; x = x1; z = z1;
    const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]);
    let y1 = y*cx - z*sx, z2 = y*sx + z*cx; y = y1; z = z2;
    if (rot[2]){ const cz = Math.cos(rot[2]), sz = Math.sin(rot[2]); const x2 = x*cz - y*sz; const y2 = x*sz + y*cz; x = x2; y = y2; }
  }
  if (off){ x += off[0]; y += off[1]; z += off[2]; }
  return [x,y,z];
}
function drawWire(ctx, cam, verts, edges, opt){
  opt = opt || {};
  const P = verts.map(v => L.proj(cam, v));
  ctx.lineWidth = opt.lw || 1.2;
  for (let i = 0; i < edges.length; i++){
    const a = P[edges[i][0]], b = P[edges[i][1]];
    if (!a || !b) continue;
    const d = (a[2] + b[2]) / 2;
    const al = (opt.alpha === undefined ? 1 : opt.alpha) * clamp(1.6 - d / (opt.fade || 14), 0.05, 1);
    ctx.strokeStyle = rgba(opt.color || C.phos, al);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
}
function sortedFaces(cam, verts, faces){
  const out = [];
  for (const f of faces){
    let d = 0, ok = true; const P = [];
    for (const i of f){ const q = L.proj(cam, verts[i]); if (!q) { ok = false; break; } P.push(q); d += q[2]; }
    if (ok) out.push({ P, d: d / f.length });
  }
  out.sort((a,b) => b.d - a.d);
  return out;
}
function polyFill(ctx, P, fill, stroke, lw){
  if (P.length < 3) return;
  ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.closePath();
  if (fill){ ctx.fillStyle = fill; ctx.fill(); }
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}
// perspective floor with camera
function floorGrid(ctx, cam, n, sp, opt){
  opt = opt || {};
  ctx.lineWidth = opt.lw || 1;
  for (let i = -n; i <= n; i++){
    const a = L.proj(cam, [i*sp, 0, -n*sp]), b = L.proj(cam, [i*sp, 0, n*sp]);
    if (a && b){ ctx.strokeStyle = rgba(opt.color || C.phos, opt.alpha || 0.12); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); }
    const c = L.proj(cam, [-n*sp, 0, i*sp]), d = L.proj(cam, [n*sp, 0, i*sp]);
    if (c && d){ ctx.strokeStyle = rgba(opt.color || C.phos, (opt.alpha || 0.12) * 0.8); ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(d[0],d[1]); ctx.stroke(); }
  }
}
// generic point cloud
function cloud(ctx, cam, pts, opt){
  opt = opt || {};
  const sz = opt.size || 2, col = opt.color || C.cyan, al = opt.alpha === undefined ? 1 : opt.alpha;
  ctx.globalCompositeOperation = opt.blend || 'lighter';
  for (let i = 0; i < pts.length; i++){
    const q = L.proj(cam, pts[i]); if (!q) continue;
    const r = Math.min(opt.max || 6, sz * q[3] * (opt.k || 0.02) + sz * 0.4);
    const d = clamp(1 - q[2] / (opt.fade || 18), 0.12, 1);
    ctx.fillStyle = rgba(col, al * d * (opt.palette ? opt.palette(i) : 1));
    ctx.fillRect(q[0] - r / 2, q[1] - r / 2, r, r);
  }
  ctx.globalCompositeOperation = 'source-over';
}
// hex / byte block
function byteBlock(ctx, x, y, s, v, color){
  ctx.fillStyle = rgba(color, 0.12 + 0.5 * v); ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = rgba(color, 0.7); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, s - 1, s - 1);
}
// labelled tick on a wire
function tag(ctx, x, y, str, color, size, align){
  size = size || 13;
  L.mono(ctx, str, x, y, size, color, 1, align || 'left');
}
// bar of the address space
function segBar(ctx, x, y, w, h, segs, opt){
  opt = opt || {};
  for (const s of segs){
    ctx.fillStyle = s.fill; ctx.fillRect(x + w * s.a, y, w * (s.b - s.a), h);
    ctx.strokeStyle = s.stroke || rgba(C.phos, 0.5); ctx.lineWidth = 1;
    ctx.strokeRect(x + w * s.a + .5, y + .5, w * (s.b - s.a) - 1, h - 1);
  }
}
module.exports = { CUBE_V, CUBE_E, CUBE_F, tf, drawWire, sortedFaces, polyFill, floorGrid, cloud, byteBlock, tag, segBar };
