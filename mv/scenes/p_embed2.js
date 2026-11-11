
'use strict';
const L = require('../engine/lib.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, easeInOutCubic, SPB, BEAT0, pulse } = L;
// camera orbits the origin so the query point stays perfectly centred
function p_embed(ctx, t, u, shot){
  ctx.fillStyle = '#03040A'; ctx.fillRect(0, 0, W, H);
  const t0 = shot.t0;
  const z = 18 - 7.0 * easeInOutCubic(sat((t - t0) / 2.9));
  const yaw = 0.55 + u * 0.85;
  const cam = L.makeCam({ pos: [Math.sin(yaw) * z, 0, Math.cos(yaw) * z], yaw: yaw, pitch: 0, fov: 1.02 });
  const R = L.mulberry32(2024);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4200; i++){
    const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1), rr = 2.2 + Math.pow(R(), 0.55) * 7.2;
    const p = [Math.sin(ph) * Math.cos(th) * rr, Math.cos(ph) * rr * 0.58, Math.sin(ph) * Math.sin(th) * rr];
    const q = L.proj(cam, p); if (!q) continue;
    const d = clamp(1 - q[2] / 30, 0.05, 1);
    ctx.fillStyle = rgba(i % 13 === 0 ? C.dsLite : C.white, (0.13 + 0.40 * R()) * d);
    const s = 1.2 + d * 2.0;
    ctx.fillRect(q[0], q[1], s, s);
  }
  ctx.restore();
  // nebular haze so the field has mass
  const hz = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 720);
  hz.addColorStop(0, 'rgba(40,28,70,0.30)'); hz.addColorStop(0.6, 'rgba(20,16,40,0.12)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
  const qp = L.proj(cam, [0, 0, 0]);
  const tq = ss(t0 + 0.28, t0 + 0.82, t);
  if (qp && tq > 0){
    const s = 6 + 5 * pulse(t, 0.16);
    L.glow(ctx, C.love, 60 * tq, () => { ctx.fillStyle = rgba(C.love, 0.98 * tq); ctx.fillRect(qp[0] - s / 2, qp[1] - s / 2, s, s); });
    ctx.save(); ctx.globalAlpha = tq;
    L.mono(ctx, 'love', qp[0] + 22, qp[1] - 16, 26, rgba(C.love, 0.98), 3.5);
    ctx.restore();
  }
  const NB = [
    ['affection', 0.71, [-1.55, 0.75, 0.70]], ['adore', 0.68, [1.50, 0.95, 0.40]],
    ['cherish', 0.66, [-0.62, -1.10, 1.30]], ['beloved', 0.64, [1.62, -0.66, -0.50]],
    ['longing', 0.61, [-1.70, 0.12, -0.75]], ['tenderness', 0.62, [0.42, 1.42, -1.14]],
  ];
  NB.forEach(function(nb, i){
    const at = t0 + 0.95 + i * 0.22;
    const a2 = ss(at, at + 0.30, t);
    if (a2 <= 0) return;
    const q = L.proj(cam, nb[2]); if (!q) return;
    if (qp){
      ctx.strokeStyle = rgba(C.love, 0.34 * a2); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(qp[0], qp[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
    }
    L.glow(ctx, C.love, 12, () => { ctx.fillStyle = rgba(C.love, 0.95 * a2); ctx.fillRect(q[0] - 4, q[1] - 4, 8, 8); });
    const right = q[0] >= W / 2;
    const dx = right ? 14 : -14;
    L.mono(ctx, nb[0], q[0] + dx, q[1] - 4, 15, rgba(C.white, 0.95 * a2), 1.5, right ? 'left' : 'right');
    L.mono(ctx, 'cos ' + nb[1].toFixed(2), q[0] + dx, q[1] + 15, 11, rgba(C.love, 0.78 * a2), 0.8, right ? 'left' : 'right');
  });
  L.spec(ctx, 168, 200, [
    ['space', 'R^7168 (projected to 3-D)'],
    ['metric', 'cos θ = a·b / (|a||b|)'],
    ['learned from', 'co-occurrence, not meaning'],
  ], { alpha: ss(t0 + 0.45, t0 + 1.05, t) * 0.92, color: C.love, kw: 116 });
  return { bloom: 1.25, chroma: 1.3, scan: 0.45, grain: 0.10 };
}
module.exports = { p_embed };
