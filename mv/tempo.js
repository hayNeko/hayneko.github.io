
const fs=require('fs');
const A=JSON.parse(fs.readFileSync('analysis.json','utf8'));
const {fps}=A, flux=A.flux, n=flux.length;
const dur=A.dur;

// ---- global tempo+phase comb search
function score(bpm, phaseFrames){
  const p=60/bpm*fps;
  let s=0,c=0;
  for(let t=phaseFrames;t<n;t+=p){ const i=Math.round(t); if(i<0||i>=n)continue; s+=flux[i]; c++; }
  return c>50? s/c : 0;
}
const results=[];
for(let bpm=90;bpm<=180.001;bpm+=0.02){
  const p=60/bpm*fps;
  // phase histogram (0.25-frame bins)
  const NB=Math.max(8,Math.round(p*4));
  const hist=new Float64Array(NB);
  for(let i=0;i<n;i++){ const v=flux[i]; if(v<=0)continue; hist[Math.round((i%p)/p*NB)%NB]+=v; }
  let bi=0; for(let k=1;k<NB;k++) if(hist[k]>hist[bi]) bi=k;
  const ph=(bi/NB)*p;
  results.push({bpm, ph, s:score(bpm,ph)});
}
results.sort((a,b)=>b.s-a.s);
console.log('TOP:');
results.slice(0,12).forEach(r=>console.log('  bpm',r.bpm.toFixed(2),'phase',r.ph.toFixed(2),'score',r.s.toFixed(4)));
// prefer candidates near 125-135
const near=results.filter(r=>r.bpm>120&&r.bpm<140).slice(0,6);
console.log('NEAR 120-140:');
near.forEach(r=>console.log('  bpm',r.bpm.toFixed(2),'phase',r.ph.toFixed(2),'score',r.s.toFixed(4)));
fs.writeFileSync('tempo.json', JSON.stringify(results.slice(0,40)));
