
const fs=require('fs');
const t=fs.readFileSync('yt.en.vtt','utf8').replace(/\r/g,'');
const blocks=t.split(/\n\n+/);
const cues=[];
for(const b of blocks){
  const m=b.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
  if(!m)continue;
  const s=+m[1]*3600 + +m[2]*60 + +m[3] + +m[4]/1000;
  const e=+m[5]*3600 + +m[6]*60 + +m[7] + +m[8]/1000;
  const lines=b.split('\n').filter(function(l){return l.trim() && !/^WEBVTT|^Kind:|^Language:|^\d{2}:\d{2}/.test(l);});
  const txt=lines.join(' ').replace(/<[^>]+>/g,'').trim();
  if(txt) cues.push({s:+s.toFixed(2), e:+e.toFixed(2), t:txt});
}
console.log('cues',cues.length,'first',cues[0].s,'last end',cues[cues.length-1].e);
const out=[];
for(const c of cues){ const L=out[out.length-1]; if(L && Math.abs(L.s-c.s)<0.01 && L.t===c.t) continue; out.push(c); }
console.log('dedup',out.length);
console.log('--- gaps > 0.6s');
for(let i=1;i<out.length;i++){ const g=out[i].s-out[i-1].e; if(g>0.6) console.log('  '+out[i-1].e.toFixed(2)+'s (+'+g.toFixed(2)+'s) after "'+out[i-1].t+'" -> "'+out[i].t+'"'); }
const SPB=60/130;
const phases=out.map(function(c){return ((c.s%SPB)+SPB)%SPB;});
let sa=0,ca=0; for(const p of phases){ sa+=Math.sin(2*Math.PI*p/SPB); ca+=Math.cos(2*Math.PI*p/SPB); }
const off=(((Math.atan2(sa,ca)/(2*Math.PI))*SPB)+SPB)%SPB;
console.log('circular-mean offset '+off.toFixed(4)+'s  beats at '+off.toFixed(3)+' + k*'+SPB.toFixed(4));
const res=phases.map(function(p){let d=p-off;while(d>SPB/2)d-=SPB;while(d<-SPB/2)d+=SPB;return d;}).sort(function(a,b){return a-b;});
const q=function(f){return res[Math.floor(res.length*f)].toFixed(3);};
console.log('residual p10/p50/p90: '+q(0.1)+' / '+q(0.5)+' / '+q(0.9));
fs.writeFileSync('cues.json',JSON.stringify(out));
console.log('wrote cues.json');
