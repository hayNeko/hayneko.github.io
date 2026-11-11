
const fs=require('fs');
const A=JSON.parse(fs.readFileSync('analysis.json','utf8'));
const fps=A.fps, n=A.low.length, SPB=60/130;
// kick detection from low band: local maxima with prominence, only in loud sections
const peaks=[];
for(let i=2;i<n-2;i++){
  const v=A.low[i];
  if(v>A.low[i-1]&&v>=A.low[i+1]&&v>A.low[i-2]&&v>=A.low[i+2]){
    const t=i/fps; if(t>15&&t<200) peaks.push({t,v});
  }
}
// keep strong ones
peaks.sort(function(a,b){return b.v-a.v;});
const strong=peaks.slice(0,400).sort(function(a,b){return a.t-b.t;});
console.log('strong kick-ish peaks:',strong.length);
// phase estimation with sub-frame parabolic interpolation around each peak
function refine(t){ const i=Math.round(t*fps); const a=A.low[i-1],b=A.low[i],c=A.low[i+1];
  const d=0.5*(a-c)/(a-2*b+c||1e-9); return (i+d)/fps; }
let sa=0,ca=0,wsum=0;
for(const p of strong){ const tt=refine(p.t); const ph=((tt%SPB)+SPB)%SPB; sa+=Math.sin(2*Math.PI*ph/SPB)*p.v; ca+=Math.cos(2*Math.PI*ph/SPB)*p.v; wsum+=p.v; }
let off=(((Math.atan2(sa,ca)/(2*Math.PI))*SPB)+SPB)%SPB;
console.log('kick-weighted beat offset = '+off.toFixed(4)+'s  -> beats at '+off.toFixed(3)+' + k*'+SPB.toFixed(4));
// how many peaks land within 25ms of that grid
let hit=0; for(const p of strong){ let d=((p.t-off)%SPB+SPB)%SPB; if(d>SPB/2)d-=SPB; if(Math.abs(d)<0.025)hit++; }
console.log('peaks within 25ms of grid: '+hit+'/'+strong.length);
const cues=JSON.parse(fs.readFileSync('cues.json','utf8'));
console.log('--- ALL CUES (129)');
cues.forEach(function(c,i){
  const beat=((c.s-off)/SPB);
  console.log(String(i).padStart(3)+' '+c.s.toFixed(2).padStart(7)+'-'+c.e.toFixed(2).padStart(7)+' b'+beat.toFixed(2).padStart(7)+'  '+((beat%4)+4)%4===0?'':' '+c.t);
});
