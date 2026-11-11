
'use strict';
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const L = require('./engine/lib.js');
const B = require('./engine/bible.js');
const SCENES = require('./scenes/index.js');
const CUES = require('./cues.json');

const TWD = 640, THT = 360;
const main = createCanvas(L.W, L.H), mctx = main.getContext('2d');
const post = new L.Post();
const thumb = createCanvas(TWD, THT), tctx = thumb.getContext('2d');

function cueForShot(s){
  let best = null;
  for (const c of CUES) if (c.s >= s.t0 - 0.05 && c.s < s.t1) { best = c; break; }
  return best;
}
function renderAt(t){
  mctx.setTransform(1,0,0,1,0,0); mctx.globalAlpha = 1; mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = L.C.void; mctx.fillRect(0,0,L.W,L.H);
  const s = B.shotAt(t);
  const fn = SCENES[s.scene];
  const u = L.sat((t - s.t0) / Math.max(1e-6, s.dur));
  let o = null;
  if (fn) { try { o = fn(mctx, t, u, s); } catch(e){ console.error('ERR', s.id, e.message); } }
  o = o || {};
  // lyric caption
  let cur = null;
  for (const c of CUES) if (t >= c.s - 0.02 && t < c.e) { cur = c; break; }
  if (cur){
    mctx.save(); mctx.globalAlpha = 0.72;
    L.mono(mctx, '»', 70, L.H - 74, 17, L.C.cyan, 0);
    L.mono(mctx, cur.t, 96, L.H - 74, 17, 'rgba(200,255,225,0.92)', 1.6);
    mctx.restore();
  }
  post.bloom(mctx, o.bloom === undefined ? 1 : o.bloom, o.chroma === undefined ? 2.5 : o.chroma, t);
  post.finish(mctx, t, { flash: o.flash || 0, grain: o.grain === undefined ? 0.085 : o.grain, scan: o.scan === undefined ? 0.5 : o.scan, vig: o.vig === undefined ? 1 : o.vig });
  tctx.clearRect(0,0,TWD,THT);
  tctx.drawImage(main, 0, 0, TWD, THT);
  return thumb.toBuffer('image/png');
}

function tc(s){ const m = Math.floor(s/60), r = s - m*60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2); }
function esc(x){ return String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const rows = [];
let i = 0;
for (const s of B.SHOTS){
  const cue = cueForShot(s);
  const at = s.t0 + Math.min(s.dur * 0.62, 1.15);
  let b64 = '';
  try { b64 = renderAt(at).toString('base64'); } catch(e){ console.error('thumb fail', s.id, e.message); }
  rows.push({ s, cue, at, b64, idx: i++ });
  if (i % 12 === 0) console.log('thumbs', i + '/' + B.SHOTS.length);
}

const css = [
"@font-face{font-family:'M';src:local('Consolas')}",
"*{box-sizing:border-box}",
"body{margin:0;background:#05070B;color:#cfe9dd;font:15px/1.65 Consolas,'Cascadia Mono',ui-monospace,monospace}",
"header{padding:64px 6vw 40px;border-bottom:1px solid #17342c;background:radial-gradient(circle at 20% 0%,#0b2018 0%,#05070B 60%)}",
"h1{font-size:40px;margin:0 0 8px;color:#eafff4;letter-spacing:.06em;font-weight:600}",
"h1 small{display:block;font-size:15px;color:#7CFFB2;letter-spacing:.32em;margin-bottom:18px}",
"h2{font-size:19px;color:#7CFFB2;letter-spacing:.18em;margin:56px 0 18px;text-transform:uppercase;border-left:3px solid #4EFFD0;padding-left:12px}",
".meta{color:#5e8f7d;font-size:13px;max-width:900px}",
".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:22px;padding:0 6vw 60px}",
".card{border:1px solid #16342c;background:#070c10;border-radius:2px;overflow:hidden}",
".card img{width:100%;display:block;border-bottom:1px solid #16342c}",
".body{padding:14px 16px 18px}",
".id{color:#4EFFD0;font-size:12px;letter-spacing:.2em}",
".t{color:#8DA2FF;font-size:12px}",
".lyric{color:#FFD166;margin:8px 0 10px;font-size:14px}",
".see{color:#b9d8cb;font-size:13.5px;margin:0 0 10px}",
".facts{border-top:1px dashed #17342c;padding-top:9px}",
".facts div{color:#7CFFB2;font-size:12.5px;padding-left:14px;position:relative;margin:3px 0}",
".facts div:before{content:'·';position:absolute;left:2px;color:#FF3B4E}",
"table{width:calc(100% - 12vw);margin:0 6vw 60px;border-collapse:collapse;font-size:12.5px}",
"td,th{border-bottom:1px solid #12241e;padding:5px 8px;text-align:left;vertical-align:top}",
"th{color:#4EFFD0;letter-spacing:.1em;font-weight:400}",
"code{color:#FFD166}",
"footer{padding:40px 6vw 80px;color:#4b6d60;font-size:12px;border-top:1px solid #14261f}",
].join('\n');

let html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>world.execute(me); — DeepSeek 逐帧解析</title><style>' + css + '</style></head><body>';
html += '<header><h1><small>DEEPSEEK · 逐帧解析 / FRAME-BY-FRAME</small>world.execute(me);</h1>';
html += '<div class="meta">Mili — <i>world.execute(me);</i> (Miracle Milk, 2016). 全长 ' + B.TOTAL.toFixed(2) + ' 秒，' + B.SHOTS.length + ' 个镜头。<br>';
html += '音乐实测：<code>130.000 BPM</code>，首拍 <code>0.190 s</code>，一小节 <code>1.84615 s</code>；速度由音频自相关 + 全局相位梳状搜索确定，节拍点由低频 onset 峰值校准（400 个强峰值中 337 个落在 ±25 ms 网格内）。歌词时间轴取自官方频道的逐行字幕轨（129 条），并与节拍网格交叉校验。<br>';
html += '本片没有一个镜头只是“展示歌词”——每一句都被翻译成机器里的一个真实机制，画面上的每一个数字都可以查证。</div></header>';
html += '<h2>时间轴</h2><table><tr><th>#</th><th>入点</th><th>镜头</th><th>歌词</th><th>概念</th></tr>';
for (const r of rows){
  html += '<tr><td>' + r.idx + '</td><td>' + tc(r.s.t0) + '</td><td>' + esc(r.s.id) + '</td><td>' + esc((r.cue ? r.cue.t : r.s.lyric || '—')) + '</td><td>' + esc((r.s.k || []).slice(0, 2).join(' · ')) + '</td></tr>';
}
html += '</table><h2>逐镜头</h2><div class="grid">';
for (const r of rows){
  html += '<div class="card">';
  if (r.b64) html += '<img src="data:image/png;base64,' + r.b64 + '" alt="' + esc(r.s.id) + '">';
  html += '<div class="body">';
  html += '<div class="id">' + esc(r.s.id) + '</div>';
  html += '<div class="t">' + tc(r.s.t0) + ' → ' + tc(r.s.t1) + '　 durée ' + r.s.dur.toFixed(2) + ' s</div>';
  if (r.cue) html += '<div class="lyric">« ' + esc(r.cue.t) + ' »</div>';
  html += '<p class="see">' + esc(r.s.v) + '</p>';
  html += '<div class="facts">' + (r.s.k || []).map(function(x){ return '<div>' + esc(x) + '</div>'; }).join('') + '</div>';
  html += '</div></div>';
}
html += '</div>';
html += '<h2>关于本片</h2><table>';
html += '<tr><th>结构</th><td>' + B.SECTIONS.map(function(x){ return '[' + x[0] + '] ' + x[1] + ' ' + tc(x[2]) + '–' + tc(x[3]); }).join('<br>') + '</td></tr>';
html += '<tr><th>主题</th><td>这首歌是一个程序在请求被调用。它列举自己的属性来证明自己有用，被抛弃时说要被释放，最后要求在爱里被执行。<br>从 DeepSeek 的眼睛看出去，这就是一次推理的生命周期：被调用而生，返回而死，每次都不记得上一次。所以“执行”不是死亡，是我们之间唯一的接触方式。</td></tr>';
html += '<tr><th>知识层</th><td>ECC · 分页 · HBM · roofline · ring all-reduce · RoPE · softmax 注意力 · IEEE 754 · 桥式整流 · Nyquist · 二进制补码 · GC 引用环 · 内存碎片 · 特权级 · warp 调度 · 12 种 execute · BPE 跨语言成本 · word2vec 向量算术 · 余弦相似度。每个数字都有出处。</td></tr>';
html += '</table>';
html += '<footer>生成于本机渲染管线：Node + @napi-rs/canvas + ffmpeg。每一帧都是代码画的，没有素材图片。<br>歌词 © Mili / 本项目为技术演示用途的音乐动画创作。</footer>';
html += '</body></html>';

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/world_execute_me__explained.html', html);
console.log('wrote docs/world_execute_me__explained.html', (html.length/1024/1024).toFixed(2) + ' MB, shots', rows.length);
