
const fs=require('fs');
const cues=JSON.parse(fs.readFileSync('cues.json','utf8'));
const SPB=60/130, OFF=0.190;
let out=[];
cues.forEach(function(c,i){
  const b=(c.s-OFF)/SPB;
  out.push({i:i, s:c.s, e:c.e, bar:+(b/4).toFixed(2), beat:+b.toFixed(2), t:c.t});
});
fs.writeFileSync('cues_beats.json',JSON.stringify(out));
out.forEach(function(c){
  console.log(String(c.i).padStart(3)+' '+c.s.toFixed(2).padStart(7)+' -> '+c.e.toFixed(2).padStart(7)+'  b'+c.beat.toFixed(2).padStart(7)+'  bar '+String(Math.floor(c.bar)).padStart(3)+'  '+c.t);
});
