
const fs=require('fs');
const {createCanvas}=require('@napi-rs/canvas');
const {execFileSync}=require('child_process');
const A=JSON.parse(fs.readFileSync('analysis.json','utf8'));
const SR=22050, WIN=2048, HOP=512;
const raw=execFileSync('ffmpeg',['-v','error','-i','audio_raw.mp3','-ac','1','-ar',String(SR),'-f','f32le','-'],{maxBuffer:1<<30});
const buf=Buffer.from(raw); const N=buf.length/4; const x=new Float32Array(N);
for(let i=0;i<N;i++)x[i]=buf.readFloatLE(i*4);
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j];const vr=re[i+j+len/2]*cr-im[i+j+len/2]*ci,vi=re[i+j+len/2]*ci+im[i+j+len/2]*cr;re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr;}}}}
const nF=Math.floor((N-WIN)/HOP); const nb=WIN/2;
const S=[]; const re=new Float32Array(WIN),im=new Float32Array(WIN);
const hann=new Float32Array(WIN);for(let i=0;i<WIN;i++)hann[i]=0.5-0.5*Math.cos(2*Math.PI*i/(WIN-1));
for(let f=0;f<nF;f++){const o=f*HOP;for(let i=0;i<WIN;i++){re[i]=(x[o+i]||0)*hann[i];im[i]=0;}fft(re,im);
 const a=new Float32Array(nb);for(let b=0;b<nb;b++)a[b]=Math.log1p(200*Math.hypot(re[b],im[b]));S.push(a);}
console.log('frames',nF,'fps',(SR/HOP).toFixed(2));
// log-freq bins
const fmin=40,fmax=10000, NBANDS=256;
const edges=[];for(let k=0;k<=NBANDS;k++)edges.push(Math.round(fmin*Math.pow(fmax/fmin,k/NBANDS)/(SR/WIN)));
for(let k=0;k<NBANDS;k++) if(edges[k+1]<=edges[k]) edges[k+1]=edges[k]+1;
const bandOfFrame=S.map(a=>{const o=new Float32Array(NBANDS);for(let k=0;k<NBANDS;k++){let m=0,c=0;for(let b=edges[k];b<edges[k+1]&&b<nb;b++){m=Math.max(m,a[b]);c++;}o[k]=m;}return o;});
let gmax=0;for(const o of bandOfFrame)for(const v of o)if(v>gmax)gmax=v;
// draw
const perSec=20, H=520, W=Math.round(Math.min(106,A.dur)*perSec);
for(let part=0;part<Math.ceil(A.dur/106);part++){
  const t0=part*106, t1=Math.min(A.dur,t0+106); const w=Math.round((t1-t0)*perSec);
  const cv=createCanvas(w,H+220); const g=cv.getContext('2d');
  g.fillStyle='#000';g.fillRect(0,0,w,H+220);
  const img=g.createImageData(w,H); 
  for(let px=0;px<w;px++){
    const t=t0+px/perSec; const f=Math.round(t*SR/HOP); if(f<0||f>=nF)continue;
    const o=bandOfFrame[f];
    for(let py=0;py<H;py++){ const bi=Math.round((1-py/H)*(NBANDS-1)); const v=Math.min(1,o[bi]/(gmax*0.78));
      const idx=(py*w+px)*4; const hue=0.62-0.62*v; 
      // simple palette: black->blue->magenta->yellow->white
      let r,gg,b;
      if(v<0.5){const u=v/0.5; r=20*u*2*0.5; gg=60*u*u; b=40+160*u;} else {const u=(v-0.5)/0.5; r=60+195*u; gg=30+215*u*u; b=200*(1-u)+55*u;}
      img.data[idx]=r;img.data[idx+1]=gg;img.data[idx+2]=b;img.data[idx+3]=255;}
  }
  g.putImageData(img,0,0);
  // beats
  const bpm=130, off=0.1829, spb=60/bpm;
  g.lineWidth=1;
  for(let k=0;;k++){const t=off+k*spb; if(t>t1)break; if(t<t0)continue; const px=(t-t0)*perSec;
    g.strokeStyle = (k%4===0)?'rgba(0,255,140,0.55)':'rgba(0,255,140,0.16)'; g.beginPath();g.moveTo(px,0);g.lineTo(px,H);g.stroke();}
  // time labels + rms
  g.font='11px Consolas'; g.fillStyle='#7fffd4';
  for(let t=Math.ceil(t0);t<=t1;t++){ const px=(t-t0)*perSec; if(t%5===0){g.fillText(String(t),px+2,H+13);} g.fillStyle='rgba(127,255,212,0.15)'; g.fillRect(px,H+18,1,6); g.fillStyle='#7fffd4'; }
  // rms waveform
  const ry=H+30, rh=180;
  g.strokeStyle='#ff9d00';g.beginPath();
  for(let px=0;px<w;px++){const t=t0+px/perSec;const fi=Math.min(A.rms.length-1,Math.round(t*A.fps));const v=Math.min(1,A.rms[fi]*6);
    const y=ry+rh-v*rh; if(px===0)g.moveTo(px,y);else g.lineTo(px,y);}
  g.stroke();
  // lyrics markers nothing
  g.fillStyle='#fff';g.font='14px Consolas';g.fillText('spectrogram '+t0+'s - '+t1.toFixed(1)+'s  (green lines = 130bpm grid, thick=bar)',8,H+rh+30);
  fs.writeFileSync('spec_'+part+'.png',cv.toBuffer('image/png'));
  console.log('wrote spec_'+part+'.png',w,'x',H+220);
}
