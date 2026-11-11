
'use strict';
const L = require('../engine/lib.js');
const { W, H, C, rgba, clamp, lerp, sat, ss, TAU, BEAT0, SPB, beatOf,
        pulse, easeOutCubic, easeInCubic, easeOutQuint, easeInOutCubic,
        mulberry32, hash2 } = L;

const S16 = SPB / 4;
const g8  = n => BEAT0 + n * (SPB / 2);
const g16 = n => BEAT0 + n * S16;
const snap = (t, u) => BEAT0 + Math.round((t - BEAT0) / u) * u;

function dark(ctx, col){ ctx.fillStyle = col || '#04060A'; ctx.fillRect(0, 0, W, H); }
function dot(ctx, x, y, r, col, a){
  ctx.fillStyle = rgba(col, clamp(a, 0, 1));
  ctx.fillRect(x - r / 2, y - r / 2, r, r);
}

// ================================================================ 1. m_stacktrace
// core dump / stack unwinding. the trace prints one frame at a time and the
// camera falls through the printed lines as if they were floors.
const TRACE = [
  ['#0',  'world.execute(me)',       'world.c:7'],
  ['#1',  'interpreter_loop',        'interp.c:412'],
  ['#2',  'cudaLaunchKernel',        'cuda_runtime_api.h:2203'],
  ['#3',  'cudaLaunchKernelExC',     'cuda_runtime_api.h:2311'],
  ['#4',  '__device_stub__exec',     'exec_stub.cu:11'],
  ['#5',  'dispatch_kernel',         'dispatch.cc:88'],
  ['#6',  'launch_grid',             'launch.c:52'],
  ['#7',  'stream_enqueue',          'stream.cc:301'],
  ['#8',  'run_command_buffer',      'cmd_buf.c:77'],
  ['#9',  'exec_sequence',           'sequence.c:129'],
  ['#10', '_PyEval_EvalFrameDefault','ceval.c:4012'],
  ['#11', '_PyFunction_Vectorcall',  'call.c:308'],
  ['#12', '_PyObject_MakeTpCall',    'call.c:214'],
  ['#13', 'call_function',           'call.c:640'],
  ['#14', 'do_call_core',            'ceval.c:5145'],
  ['#15', 'builtin_exec',            'bltinmodule.c:1123'],
  ['#16', 'world_module_exec',       'module.c:64'],
  ['#17', 'importlib_exec_module',   '_bootstrap.py:219'],
  ['#18', '_PyRun_AnyFileObject',    'pylifecycle.c:2470'],
  ['#19', 'Py_RunMain',              'pylifecycle.c:2076'],
  ['#20', 'pymain_run_python',       'pymain_main.c:224'],
  ['#21', 'main',                    'python.c:23'],
  ['#22', '__libc_start_call_main',  'libc-start.c:74'],
  ['#23', '__libc_start_main',       'libc-start.c:308'],
  ['#24', '_start',                  'start.S:122'],
];

const ST_VP = 300, ST_STEP = 118;

function m_stacktrace(ctx, t, u, shot){
  dark(ctx, '#04060A');
  const t0 = shot.t0, dur = shot.t1 - shot.t0, N = TRACE.length;
  const pr = sat((t - t0) / dur);
  const p = Math.pow(pr, 1.12) * (N + 0.2);            // continuous print head
  const VPX = 960 + 54 * Math.sin((t - t0) * 0.85) - 18;
  const VPY = ST_VP, STEP = ST_STEP;
  const hw = Y => Math.max(46, (Y - VPY) * 1.30);
  const born = k => snap(t0 + 0.04 + Math.pow((k + 0.3) / N, 1.12) * dur * 0.985, S16);
  const age = k => p - k;

  // ---- corridor shell (rolled slightly: the camera is not level)
  ctx.save();
  ctx.translate(960, 540); ctx.rotate(-0.016 + 0.010 * Math.sin(t * 0.5)); ctx.translate(-960, -540);
  ctx.globalCompositeOperation = 'lighter';
  const mouth = ctx.createRadialGradient(VPX, VPY, 0, VPX, VPY, 300);
  mouth.addColorStop(0, 'rgba(120,255,200,0.13)'); mouth.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mouth; ctx.fillRect(VPX - 300, VPY - 300, 600, 600);
  // shaft ribs: horizontal rings that converge, moving toward the viewer
  for (let i = 0; i < 11; i++){
    const ph = ((i / 11) + ((t - t0) * 0.5) % (1 / 11));
    const yy = VPY + (1220 - VPY) * (ph * ph);
    const a = 0.055 * (1 - ph) * (0.4 + 0.6 * ph);
    ctx.strokeStyle = rgba(C.phos, a);
    ctx.beginPath(); ctx.moveTo(VPX - hw(yy) * 1.5, yy); ctx.lineTo(VPX + hw(yy) * 1.5, yy); ctx.stroke();
  }
  // rails, above and below the vanishing point
  ctx.strokeStyle = rgba(C.phos, 0.20); ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(VPX - hw(1220), 1220); ctx.lineTo(VPX, VPY); ctx.lineTo(VPX + hw(1220), 1220);
  ctx.stroke();
  ctx.strokeStyle = rgba(C.phos, 0.10);
  ctx.beginPath();
  ctx.moveTo(VPX - 700, 0); ctx.lineTo(VPX, VPY); ctx.lineTo(VPX + 700, 0);
  ctx.stroke();
  ctx.restore();

  // ---- floors, nearest last so the stack occludes correctly
  const Yof = ag => VPY + 111 * (Math.exp(0.30 * ag) - 1);
  const draw = [];
  for (let k = 0; k < N; k++){
    const ag = age(k);
    if (ag < -0.2 || ag > 9.5) continue;
    const Y = Yof(ag);
    if (Y < VPY - 34 || Y > 1260) continue;
    draw.push([k, ag, Y]);
  }
  draw.reverse();
  ctx.save();
  ctx.translate(960, 540); ctx.rotate(-0.016 + 0.010 * Math.sin(t * 0.5)); ctx.translate(-960, -540);
  for (const [k, ag, Y] of draw){
    const ap = clamp(0.18 + ag * 3, 0, 1) * (1 - ss(1120, 1300, Y));
    if (ap <= 0.01) continue;
    const Yb = Yof(ag + 0.72);
    const w0 = hw(Y), w1 = hw(Yb);
    const sizeBase = clamp((Y - VPY) * 0.135, 8, 96);
    const fresh = t - born(k);
    const hot = fresh < 0.24 && fresh > -0.05;
    const base = k === 0 ? C.alert : (hot ? C.white : C.phos);

    // slab: a thin floor whose bright edge is the printed line
    const g = ctx.createLinearGradient(0, Yb, 0, Y);
    g.addColorStop(0, rgba(base, 0.0));
    g.addColorStop(0.6, rgba(base, 0.035 * ap));
    g.addColorStop(1, rgba(base, 0.13 * ap));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(VPX - w1, Yb); ctx.lineTo(VPX + w1, Yb);
    ctx.lineTo(VPX + w0, Y); ctx.lineTo(VPX - w0, Y);
    ctx.closePath(); ctx.fill();

    // bright front edge + end ticks
    ctx.strokeStyle = rgba(base, (hot ? 0.92 : 0.42) * ap); ctx.lineWidth = hot ? 2 : 1.1;
    ctx.beginPath(); ctx.moveTo(VPX - w0, Y + 1); ctx.lineTo(VPX + w0, Y + 1); ctx.stroke();
    ctx.strokeStyle = rgba(C.cyan, 0.45 * ap); ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VPX - w0, Y + 1); ctx.lineTo(VPX - w0, Y - 15);
    ctx.moveTo(VPX + w0, Y + 1); ctx.lineTo(VPX + w0, Y - 15); ctx.stroke();

    // the text printed on the floor (slightly compressed: it lies down)
    const head = TRACE[k][0] + '  ' + TRACE[k][1];
    const tail = 'at ' + TRACE[k][2];
    ctx.font = L.F(40, L.MONO);
    const wRel = (ctx.measureText(head).width + 26 + ctx.measureText(tail).width) / 40;
    const fs = Math.min(sizeBase, (w0 * 1.86) / Math.max(6, wRel));
    ctx.font = L.F(fs, L.MONO);
    const w1t = ctx.measureText(head).width, w2t = ctx.measureText(tail).width;
    const x = VPX - (w1t + 26 + w2t) / 2;
    const ty = Y - fs * 0.30;
    ctx.save();
    ctx.translate(VPX, ty); ctx.scale(1, 0.9); ctx.translate(-VPX, -ty);
    if (hot) L.glow(ctx, base, 16, () => L.mono(ctx, head, x, ty, fs, rgba(base, ap), 0));
    else L.mono(ctx, head, x, ty, fs, rgba(base, ap), 0);
    L.mono(ctx, tail, x + w1t + 26, ty, fs * 0.8, rgba(C.cyan, ap * 0.5), 0);
    ctx.restore();
  }
  ctx.restore();

  // ---- the print head: cursor + sparks at the vanishing point
  const blink = 0.5 + 0.5 * Math.cos(t * 40);
  const R = mulberry32(Math.floor(t * 60));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  dot(ctx, VPX, VPY, 4 + 3 * blink, C.white, 0.45 + 0.45 * blink);
  for (let i = 0; i < 9; i++){
    const a = R() * TAU, rr = 8 + R() * 52;
    ctx.strokeStyle = rgba(C.cyan, 0.30 * (1 - rr / 60) * (0.4 + 0.6 * blink)); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(VPX, VPY); ctx.lineTo(VPX + Math.cos(a) * rr, VPY + Math.sin(a) * rr); ctx.stroke();
  }
  ctx.restore();

  // ---- annotation, left
  const aA = ss(t0 + 0.10, t0 + 0.55, t);
  L.spec(ctx, 116, 152, [
    ['unwind', 'core dump · ELF note'],
    ['frames', String(N) + ' · frame pointer rbp'],
    ['source', 'world.c:7'],
    ['data', 'the crash is data'],
  ], { alpha: 0.95 * aA, color: C.cyan, kw: 86, size: 14, lh: 25 });

  // ---- depth ruler, right
  const rx = 1774, ry0 = 196, ry1 = 936;
  ctx.strokeStyle = rgba(C.phos, 0.22 * aA); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(rx, ry0); ctx.lineTo(rx, ry1); ctx.stroke();
  for (let k = 0; k < N; k++){
    const yy = ry0 + (ry1 - ry0) * (k / (N - 1));
    const cur = Math.abs(k - p) < 0.55;
    ctx.strokeStyle = rgba(cur ? C.white : C.phos, (cur ? 0.95 : 0.28) * aA); ctx.lineWidth = cur ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(rx - (cur ? 7 : 4), yy); ctx.lineTo(rx + (cur ? 7 : 4), yy); ctx.stroke();
    if (k % 4 === 0) L.mono(ctx, '#' + k, rx + 14, yy + 4, 11, rgba(k <= p ? C.cyan : C.phos, 0.45 * aA), 0.6);
  }
  L.mono(ctx, 'STACK DEPTH', rx, ry0 - 24, 11, rgba(C.cyan, 0.75 * aA), 2.4, 'right');
  if (p > 0.2){
    const my = ry0 + (ry1 - ry0) * sat(p / (N - 1));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(C.white, 0.9 * aA);
    ctx.beginPath(); ctx.arc(rx, my, 4.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // bottom statement
  L.mono(ctx, 'frame 0  ' + TRACE[0][1] + '  \u2190 faulting frame', 116, 1012, 14,
         rgba(C.alert, 0.62 * ss(t0 + 0.3, t0 + 0.9, t)), 1.2);

  const near = Math.max(0, 1 - Math.abs((p % 1) - 0.5) * 2);
  return { bloom: 1.2, chroma: 2.0 + 3.0 * near, scan: 0.55, grain: 0.1 };
}


// ================================================================ 2. m_fall
// free fall through six translucent planes. each level is stamped with the real
// artefact it is made of; nothing at one level can see the level below it.
const FALL = [
  { id: 'L1', name: 'PYTHON FRAME', col: C.dsLite,
    head: ['File "world.py", line 7, in execute', '    return world.execute(me)', 'f_locals  me \u2192 0x7f2a1040'] },
  { id: 'L2', name: 'CUDA KERNEL', col: C.ds,
    head: ['__global__ void exec(float* me)', 'exec<<<132, 1024>>>(me);', 'smem 228 KB   regs 65536'] },
  { id: 'L3', name: 'PTX', col: C.cyan,
    head: ['.visible .entry exec(.param .u64 %rd<3>)', 'ld.global.f32  %f1, [%rd1];', 'add.f32  %f2, %f1, 0f3F800000;'] },
  { id: 'L4', name: 'SASS', col: C.phos,
    head: ['0x000A5C  IMAD R4, R2, R3, R4', '[31:26 opc][25:21 rd][20:16 rs1][15:0 rs2]', ''] },
  { id: 'L5', name: 'REGISTER FILE', col: C.cyan,
    head: ['65,536 registers / SM', 'R0 \u2026 R255 per thread', ''] },
  { id: 'L6', name: 'TRANSISTOR', col: C.white,
    head: ['gate \u00b7 high-k oxide \u00b7 channel', 'source \u00b7 drain \u00b7 6T SRAM', ''] },
];
const FALL_OFF = [[-0.30, 0.16], [0.26, -0.20], [-0.16, -0.10], [0.34, 0.20], [-0.36, 0.06], [0.12, 0.28]];
const FALL_RY  = [0.26, -0.20, 0.30, -0.14, 0.20, -0.28];
const FALL_RZ  = [-0.10, 0.14, 0.06, -0.16, 0.10, -0.05];
const FOC = 900;

// monotone cubic through the knots: the fall is authored, the crossings sit on beats
function pchip(xs, ys){
  const n = xs.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++){
    if (d[i] === 0){ m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
    if (q > 9){ const t2 = 3 / Math.sqrt(q); m[i] = t2 * a * d[i]; m[i + 1] = t2 * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], tt = (x - xs[i]) / h;
    const h00 = 2 * tt * tt * tt - 3 * tt * tt + 1, h10 = tt * tt * tt - 2 * tt * tt + tt;
    const h01 = -2 * tt * tt * tt + 3 * tt * tt, h11 = tt * tt * tt - tt * tt;
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
  };
}

function pj3(x, y, z){
  const d = -z; if (d < 0.06) return null;
  const s = FOC / d; return [960 + x * s, 540 - y * s, d];
}
function planePt(o, u, v){
  // o = {ox,oy,d,hu,hv,ry,rz}; u,v in 0..1
  let x = (u * 2 - 1) * o.hu, y = (1 - v * 2) * o.hv;
  const cr = Math.cos(o.ry), sr = Math.sin(o.ry), cz = Math.cos(o.rz), sz = Math.sin(o.rz);
  const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
  const x2 = x1 * cr, z2 = -x1 * sr;
  return pj3(o.ox + x2, o.oy + y1, -o.d + z2);
}

function m_fall(ctx, t, u, shot){
  dark(ctx, '#030507');
  const t0 = shot.t0, dur = shot.t1 - shot.t0;
  // crossings on the beat grid, 3-2-2-1-1 beats apart; the last sheet is still
  // passing the lens when the shot cuts away.
  const FALL_CROSS = [297, 299, 301, 303, 305, 307].map(k => BEAT0 + k * SPB);
  const fx = [t0, ...FALL_CROSS, shot.t1 + 0.40];
  const fy = [0, ...[0, 1, 2, 3, 4, 5].map(i => 1.15 + i * 2.0), 12.6];
  const fall = Math.max(0, pchip(fx, fy)(t));

  // ---- dust streaming at the camera
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const R = mulberry32(5150);
  for (let i = 0; i < 130; i++){
    const ax = (R() - 0.5) * 5.0, ay = (R() - 0.5) * 3.2, ph = R();
    const z = 1.1 + ((ph * 9.0 - fall * 0.9) % 9.0 + 9.0) % 9.0;
    const p = pj3(ax, ay, -z);
    if (!p) continue;
    const p2 = pj3(ax, ay, -(z + 0.08 + 1.5 / z));
    const a = clamp(0.26 - z * 0.020, 0.03, 0.34);
    ctx.strokeStyle = rgba(i % 9 === 0 ? C.white : C.phos, a);
    ctx.lineWidth = clamp(20 / z, 0.7, 3.2);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    if (p2) ctx.lineTo(p2[0], p2[1]); else ctx.lineTo(p[0] + 2, p[1] + 2);
    ctx.stroke();
  }
  ctx.restore();

  // ---- the six planes, far to near
  const items = [];
  for (let i = 0; i < 6; i++){
    const d = i * 2.0 + 1.15 - fall;
    if (d < 0.16 || d > 13) continue;
    items.push([i, d]);
  }
  items.sort((a, b) => b[1] - a[1]);

  for (const [i, d] of items){
    const lv = FALL[i];
    const o = { ox: FALL_OFF[i][0], oy: FALL_OFF[i][1], d, hu: 1.30, hv: 0.80,
                ry: FALL_RY[i] + 0.10 * Math.sin(t * 0.45 + i * 1.7), rz: FALL_RZ[i] };
    const TL = planePt(o, 0, 0), TR = planePt(o, 1, 0), BL = planePt(o, 0, 1), BR = planePt(o, 1, 1);
    if (!TL || !TR || !BL || !BR) continue;
    const fade = clamp((d - 0.16) * 2.2, 0, 1) * clamp((13 - d) * 0.9, 0, 1);
    const near = sat(1.5 - d / 4.5);
    const pass = sat(1 - (d - 0.16) / 1.1);          // 1 at the instant of crossing

    ctx.save();
    // membrane
    const g = ctx.createLinearGradient(TL[0], TL[1], BL[0], BL[1]);
    g.addColorStop(0, rgba(lv.col, 0.028 * fade));
    g.addColorStop(0.40, rgba(lv.col, 0.006 * fade));
    g.addColorStop(1, rgba('#02040A', 0.62 * fade));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]);
    ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]); ctx.closePath(); ctx.fill();

    // sheet border
    ctx.strokeStyle = rgba(lv.col, (0.22 + 0.60 * near) * fade); ctx.lineWidth = 1 + 1.8 * near;
    ctx.beginPath(); ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]);
    ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]); ctx.closePath(); ctx.stroke();

    // internal grid, exact perspective
    ctx.strokeStyle = rgba(lv.col, 0.13 * fade); ctx.lineWidth = 1;
    for (let q = 1; q < 4; q++){
      const p1 = planePt(o, q / 4, 0), p2 = planePt(o, q / 4, 1);
      if (p1 && p2){ ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); }
      const p3 = planePt(o, 0, q / 4), p4 = planePt(o, 1, q / 4);
      if (p3 && p4){ ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]); ctx.stroke(); }
    }

    // everything printed on the sheet uses the sheet's own affine
    const a = (TR[0] - TL[0]) / 1000, b = (TR[1] - TL[1]) / 1000;
    const cc = (BL[0] - TL[0]) / 620, dd = (BL[1] - TL[1]) / 620;
    ctx.save();
    ctx.setTransform(a, b, cc, dd, TL[0], TL[1]);
    const ink = clamp((6.2 - d) / 4.2, 0.10, 1) * clamp(0.4 + near * 0.7, 0, 1);
    const right = (i % 2) === 1;
    const ax = right ? 954 : 46, al = right ? 'right' : 'left';
    L.mono(ctx, lv.id, ax, 96, 92, rgba(lv.col, 0.92 * fade * ink), 8, al);
    L.mono(ctx, lv.name, right ? 754 : 250, 84, 34, rgba(lv.col, 0.80 * fade * ink), 5, al);
    L.mono(ctx, 'opaque to ' + (i < 5 ? FALL[i + 1].id : 'silicon'), right ? 46 : 954, 62, 24,
           rgba(C.alert, 0.55 * fade * ink), 2, right ? 'left' : 'right');
    ctx.strokeStyle = rgba(lv.col, 0.5 * fade * ink); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(46, 126); ctx.lineTo(954, 126); ctx.stroke();
    let ly = 196;
    for (const line of lv.head){
      if (line){ L.mono(ctx, line, ax, ly, 30, rgba(lv.col, 0.90 * fade * ink), 0, al); ly += 46; }
    }
    if (i === 3){
      const bits = '1010 0101 1100 0010 0100 0011 0100 0100';
      L.mono(ctx, bits, ax, ly + 22, 26, rgba(C.white, 0.60 * fade * ink), 2, al);
      for (let q = 0; q <= 12; q++){
        const bx2 = right ? ax - 700 + q * 58 : ax + q * 58;
        ctx.strokeStyle = rgba(C.phos, 0.4 * fade * ink); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx2, ly + 34); ctx.lineTo(bx2, ly + 52); ctx.stroke();
      }
      L.mono(ctx, '26          5      5      5        11', ax, ly + 74, 20, rgba(C.phos, 0.55 * fade * ink), 2, al);
    }
    if (i === 4){
      const rr = mulberry32(77);
      for (let ry2 = 0; ry2 < 6; ry2++) for (let rx2 = 0; rx2 < 16; rx2++){
        const v = rr();
        ctx.fillStyle = rgba(v > 0.74 ? C.white : C.phos, (0.10 + 0.62 * v) * fade * ink);
        ctx.fillRect((right ? 954 - 384 : 46) + rx2 * 24, ly + 24 + ry2 * 22, 21, 19);
      }
    }
    if (i === 5){
      const x6 = right ? 560 : 30;
      L.mono(ctx, 'G', x6 + 180, ly + 46, 24, rgba(C.white, 0.8 * fade * ink), 0, 'center');
      L.mono(ctx, 'S', x6 + 40, ly + 132, 24, rgba(C.cyan, 0.8 * fade * ink), 0, 'center');
      L.mono(ctx, 'D', x6 + 320, ly + 132, 24, rgba(C.cyan, 0.8 * fade * ink), 0, 'center');
      ctx.strokeStyle = rgba(C.white, 0.55 * fade * ink); ctx.lineWidth = 2;
      ctx.strokeRect(x6 + 110, ly + 20, 140, 40);
      ctx.fillStyle = rgba(C.white, 0.10 * fade * ink); ctx.fillRect(x6 + 90, ly + 60, 180, 22);
      ctx.fillStyle = rgba(C.cyan, 0.12 * fade * ink); ctx.fillRect(x6, ly + 82, 90, 62);
      ctx.fillRect(x6 + 270, ly + 82, 90, 62);
      ctx.strokeRect(x6, ly + 82, 360, 62);
    }
    ctx.restore();
    ctx.restore();

    // the instant of the crossing: the lens is inside the membrane
    if (pass > 0.01){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.30 * pass * pass;
      ctx.strokeStyle = lv.col; ctx.lineWidth = 2 + 12 * pass;
      ctx.beginPath(); ctx.moveTo(TL[0], TL[1]); ctx.lineTo(TR[0], TR[1]);
      ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]); ctx.closePath(); ctx.stroke();
      // the seam sweeping past the lens + the shockwave of the crossing
      const sy = 540 + (1 - pass) * 300;
      const gsw = ctx.createLinearGradient(0, sy - 90, 0, sy + 90);
      gsw.addColorStop(0, rgba(lv.col, 0)); gsw.addColorStop(0.5, rgba(lv.col, 0.26 * pass));
      gsw.addColorStop(1, rgba(lv.col, 0));
      ctx.fillStyle = gsw; ctx.fillRect(0, sy - 90, W, 180);
      ctx.globalAlpha = 0.55 * pass * pass;
      ctx.strokeStyle = lv.col; ctx.lineWidth = 2 + 6 * pass;
      ctx.beginPath(); ctx.arc(960, 540, 120 + 1500 * (1 - pass), 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- readout
  const cur = Math.max(0, Math.min(5, Math.round(fall - 1.15)));
  const aA = ss(t0 + 0.12, t0 + 0.5, t);
  L.spec(ctx, 116, 152, [
    ['level', FALL[cur].id + ' \u00b7 ' + FALL[cur].name],
    ['planes', '6 \u00b7 CUDA \u2192 PTX \u2192 SASS \u2192 silicon'],
    ['rule', 'nothing here sees the level below'],
    ['fall', (fall).toFixed(2) + ' plane units'],
  ], { alpha: 0.95 * aA, color: C.cyan, kw: 82, size: 14, lh: 25 });

  // level ladder, right
  const lx = 1792;
  for (let i = 0; i < 6; i++){
    const on = i === cur;
    L.mono(ctx, FALL[i].id, lx, 214 + i * 30, 14, rgba(on ? C.white : FALL[i].col, (on ? 0.98 : 0.38) * aA), 2, 'right');
  }
  L.mono(ctx, 'ABSTRACTION STACK', lx, 188, 11, rgba(C.phos, 0.38 * aA), 2.2, 'right');

  let hit = 0;
  for (let i = 0; i < 6; i++) hit = Math.max(hit, 1 - Math.abs(i * 2.0 + 1.15 - fall) / 0.85);
  return { bloom: 0.85, chroma: 1.4 + 5 * clamp(hit, 0, 1), scan: 0.5, flash: 0.02 * clamp(hit, 0, 1) };
}


// ================================================================ 3. m_warps
// we land on a warp scheduler: four schedulers per SM, 64 warps resident,
// 32 threads each. stalled warps give their slot away.
const WARP_STALL = ['no instruction', 'short scoreboard', 'long scoreboard', 'wait', 'dependency', 'not selected'];

function m_warps(ctx, t, u, shot){
  dark(ctx, '#03040A');
  const t0 = shot.t0, t1 = shot.t1;
  const PEAK = BEAT0 + 310 * SPB;                    // the one perfect cycle
  const bt = (t - BEAT0) / SPB;
  const cyc = Math.floor(bt), ph = bt - cyc;
  const post = t >= PEAK ? 1 : 0;
  const pre = 1 - post;
  const ready = ss(t0 + 0.1, PEAK - 0.35, t);        // slots come back from stalls

  // ---- sheet geometry
  const GX = 150, GY = 336, CW = 128, CH = 66, SW = 120, SH = 56;
  const barY = 246, barH = 46, barW = 252;

  const R = mulberry32(9091);
  const SLOT = [];
  for (let i = 0; i < 64; i++) SLOT.push({ r: R(), reg: 'R' + (7 + (i % 11)), st: Math.floor(R() * 5) });

  // ---- four schedulers
  for (let k = 0; k < 4; k++){
    const bx = GX + k * (barW + 18), by = barY;
    const lit = post ? 1 : 0.35 + 0.65 * Math.max(0, Math.cos(ph * TAU));
    ctx.fillStyle = rgba(C.ds, 0.10 + 0.16 * lit);
    ctx.fillRect(bx, by, barW, barH);
    ctx.strokeStyle = rgba(post ? C.white : C.cyan, 0.35 + 0.55 * lit); ctx.lineWidth = 1.4;
    ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
    L.mono(ctx, 'SCHED ' + k, bx + 12, by + 29, 15, rgba(post ? C.white : C.cyan, 0.9), 2, 'left');
    L.mono(ctx, post ? 'issue 16/16' : 'issue 1/16', bx + barW - 12, by + 29, 11,
           rgba(post ? C.white : C.phos, 0.55), 1, 'right');
    // fan of issue lines down to its sixteen warps
    for (let q = 0; q < 16; q++){
      const c = k * 2 + (q % 2), r = Math.floor(q / 2);
      const sx = bx + barW / 2, sy = by + barH;
      const ex = GX + c * CW + SW / 2, ey = GY + r * CH + SH / 2;
      ctx.strokeStyle = rgba(C.phos, 0.11); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }
  }

  // ---- the 64 warp slots
  let issued = 0, stalled = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++){
    const i = r * 8 + c, s = SLOT[i];
    const x = GX + c * CW, y = GY + r * CH;
    const sched = Math.floor(c / 2);
    // who issues this cycle
    const pick = (sched * 7 + (cyc % 16) * 3 + 5) % 16;          // 0..15 within the scheduler
    const mine = (c % 2) + Math.floor(r) * 2;                     // this slot's index in its scheduler
    const eligible = s.r < (0.28 + 0.62 * ready);
    const issuing = post ? 1 : (eligible && (Math.floor(r / 2) * 2 + (c % 2)) === (pick % 8) ? 1 : 0);
    const st = !eligible && !post;
    if (issuing) issued++; else if (st) stalled++;
    const pulse = issuing ? Math.exp(-Math.max(0, ph - 0.22) * 9) : 0;

    // cell
    ctx.fillStyle = rgba(st ? C.phos : C.ds, st ? 0.022 : (0.035 + 0.20 * pulse));
    ctx.fillRect(x, y, SW, SH);
    ctx.strokeStyle = rgba(st ? C.phos : (issuing ? C.white : C.cyan),
                           st ? 0.12 : (issuing ? 0.26 + 0.68 * pulse : 0.18));
    ctx.lineWidth = issuing ? 1.5 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, SW - 1, SH - 1);
    if (issuing && pulse > 0.05){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(C.cyan, 0.36 * pulse);
      ctx.fillRect(x + 1, y + 1, SW - 2, SH - 2);
      ctx.restore();
    }
    L.mono(ctx, (i < 10 ? 'W0' : 'W') + i, x + 9, y + 22, 14,
           rgba(st ? C.phos : (issuing ? C.white : C.phos), st ? 0.30 : 0.92), 1);
    L.mono(ctx, st ? WARP_STALL[s.st] : (issuing ? 'issue' : 'ready'), x + 9, y + 42, 10,
           rgba(st ? C.phos : (issuing ? C.white : C.cyan), st ? 0.24 : 0.72), 0.6);
    L.mono(ctx, s.reg, x + SW - 9, y + 42, 10, rgba(C.phos, st ? 0.18 : 0.4), 0.6, 'right');
    // the pulse travelling down the fan
    if (issuing && ph < 0.55){
      const bx = GX + sched * (barW + 18) + barW / 2, by = barY + barH;
      const ex = x + SW / 2, ey = y + SH / 2;
      const q = ss(0, 0.55, ph);
      ctx.fillStyle = rgba(C.white, 0.95 * (1 - q * 0.6));
      ctx.beginPath(); ctx.arc(bx + (ex - bx) * q, by + (ey - by) * q, 3.2, 0, TAU); ctx.fill();
    }
  }

  // ---- the perfect cycle hits the beat
  if (t >= PEAK - 0.02){
    const k = clamp(1 - (t - PEAK) / 0.55, 0, 1);
    if (k > 0){
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k * k;
      ctx.strokeStyle = C.white; ctx.lineWidth = 2 + 6 * k;
      ctx.beginPath(); ctx.arc(660, 600, 140 + 1500 * (1 - k), 0, TAU); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = rgba('#03040A', 0.55 * k);
      ctx.fillRect(660 - 330, 566, 660, 92);
      ctx.strokeStyle = rgba(C.white, 0.35 * k); ctx.lineWidth = 1;
      ctx.strokeRect(660 - 330.5, 566.5, 660, 92);
      L.display(ctx, '64 / 64', 660, 636, 62 + 16 * k, rgba(C.white, 0.92 * k), 'center');
      L.mono(ctx, 'EVERY SLOT ISSUES AT ONCE', 660, 656, 12, rgba(C.cyan, 0.85 * k), 4, 'center');
      ctx.restore();
    }
  }

  // ---- scoreboard
  const px = 1240, pa = ss(t0 + 0.15, t0 + 0.55, t);
  ctx.strokeStyle = rgba(C.cyan, 0.25 * pa); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px - 26, 150); ctx.lineTo(px - 26, 980); ctx.stroke();
  L.mono(ctx, 'SCOREBOARD', px, 178, 12, rgba(C.cyan, 0.85 * pa), 3);
  const rows = [
    ['warp scheduler', '4 / SM'],
    ['warp', '32 threads'],
    ['warps resident', '64 / SM'],
    ['threads', '2048 / SM'],
    ['shared memory', '228 KB'],
    ['registers', '65,536 / SM'],
  ];
  L.spec(ctx, px, 214, rows, { alpha: 0.95 * pa, color: C.cyan, kw: 150, size: 14, lh: 26 });
  ctx.strokeStyle = rgba(C.phos, 0.18 * pa); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 400); ctx.lineTo(px + 520, 400); ctx.stroke();
  L.spec(ctx, px, 436, [
    ['cycle', String(cyc)],
    ['issued', issued + ' / 64'],
    ['stalled', String(stalled)],
  ], { alpha: 0.95 * pa, color: post ? C.white : C.phos, kw: 96, size: 14, lh: 26 });

  // issue history, one bar per cycle
  const hx = px, hy = 560, hh = 120;
  L.mono(ctx, 'issue / cycle', hx, hy - 12, 11, rgba(C.phos, 0.45 * pa), 1.6);
  for (let j = 0; j < 34; j++){
    const c0 = cyc - 33 + j;
    const isPeak = Math.abs(BEAT0 + c0 * SPB - PEAK) < SPB * 0.5;
    const n = isPeak || c0 * SPB > 310 * SPB ? 64 : 4 + ((c0 * 37) % 9);
    const hgt = hh * n / 64;
    const x = hx + j * 15;
    ctx.fillStyle = rgba(isPeak ? C.white : (n >= 64 ? C.cyan : C.ds), isPeak ? 0.95 * pa : 0.5 * pa);
    ctx.fillRect(x, hy + hh - hgt, 11, hgt);
  }
  ctx.strokeStyle = rgba(C.phos, 0.22 * pa);
  ctx.beginPath(); ctx.moveTo(hx, hy + hh + 0.5); ctx.lineTo(hx + 34 * 15, hy + hh + 0.5); ctx.stroke();

  // stall legend
  L.mono(ctx, 'stall reasons', px, 740, 11, rgba(C.phos, 0.45 * pa), 1.6);
  WARP_STALL.forEach((sname, j) => {
    L.mono(ctx, sname, px, 766 + j * 20, 12, rgba(C.phos, 0.42 * pa), 0.6);
    const n = SLOT.filter(q => Math.floor(q.r * 5) === j).length;
    L.mono(ctx, String(post ? 0 : n), px + 300, 766 + j * 20, 12, rgba(C.cyan, 0.42 * pa), 0.6, 'right');
  });

  // title
  L.mono(ctx, 'WARP SCHEDULER', 152, 158, 13, rgba(C.cyan, 0.9 * pa), 4);
  L.mono(ctx, 'the bottom of the fall is a scoreboard', 152, 186, 15, rgba(C.phos, 0.55 * pa), 1.4);

  const flash = t >= PEAK ? 0.10 * Math.exp(-(t - PEAK) * 9) : 0;
  return { bloom: 1.0, chroma: 1.6 + 6 * (t >= PEAK ? Math.exp(-(t - PEAK) * 4) : 0), scan: 0.5, flash };
}

module.exports = { m_stacktrace, m_fall, m_warps };
