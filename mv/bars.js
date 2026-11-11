
const fs=require('fs');
const A=JSON.parse(fs.readFileSync('analysis.json','utf8'));
const fps=A.fps, n=A.flux.length;
const BPM=130, SPB=60/BPM, OFF=0.1829;
const bar=SPB*4; // 1.846s
const nBars=Math.floor((A.dur-OFF)/bar);
function avgAt(arr,t0,t1){const a=Math.max(0,Math.round(t0*fps)),b=Math.min(arr.length,Math.round(t1*fps));let s=0;for(let i=a;i<b;i++)s+=arr[i];return s/Math.max(1,b-a);}
const db=x=>20*Math.log10(x+1e-9);
let rows=[];
for(let b=0;b<nBars;b++){const t0=OFF+b*bar,t1=t0+bar;
  rows.push({bar:b,t:+t0.toFixed(2),low:+db(avgAt(A.low,t0,t1)).toFixed(1),mid:+db(avgAt(A.mid,t0,t1)).toFixed(1),high:+db(avgAt(A.high,t0,t1)).toFixed(1),rms:+db(avgAt(A.rms,t0,t1)).toFixed(1)});}
const R=rows.map(r=>r.rms), mn=Math.min(...R), mx=Math.max(...R);
console.log('bars',nBars,'bar len',bar.toFixed(3),'s  total',A.dur.toFixed(1));
console.log('bar  t     rms   low   mid  high  | level');
for(const r of rows){
  const v=(r.rms-mn)/(mx-mn);
  console.log(String(r.bar).padStart(3),String(r.t).padStart(7),String(r.rms).padStart(6),String(r.low).padStart(6),String(r.mid).padStart(6),String(r.high).padStart(6),'|'+'#'.repeat(Math.round(v*40)));
}
