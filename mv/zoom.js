
const fs=require('fs');
const {createCanvas}=require('@napi-rs/canvas');
const {execFileSync}=require('child_process');
const SR=22050,WIN=1024,HOP=256,NBANDS=200,FMAX=3200;
const raw=execFileSync('ffmpeg',['-v','error','-i','audio_raw.mp3','-ac','1','-ar',String(SR),'-f','f32le','-'],{maxBuffer:1<<30});
const buf=Buffer.from(raw);const N=buf.length/4;const x=new Float32Array(N);
for(let i=0;i<N;i++)x[i]=buf.readFloatLE(i*4);
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j];const vr=re[i+j+len/2]*cr-im[i+j+len/2]*ci,vi=re[i+j+len/2]*ci+im[i+j+len/2]*cr;re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;const ncr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=ncr;}}}}
const nF=Math.floor((N-WIN)/HOP),nb=WIN/2,fps=SR/HOP;
const re=new Float32Array(WIN),im=new Float32Array(WIN);
const hann=new Float32Array(WIN);for(let i=0;i<WIN;i++)hann[i]=0.5-0.5*Math.cos(2*Math.PI*i/(WIN-1));
const rows=[];
for(let f=0;f<nF;f++){const o=f*HOP;for(let i=0;i<WIN;i++){re[i]=(x[o+i]||0)*hann[i];im[i]=0;}
 fft(re,im);const a=new Float32Array(NBANDS);
 for(let k=0;k<NBANDS;k++){const hz=(k+1)*FMAX/NBANDS;const b0=Math.round(hz*0.94/(SR/WIN)),b1=Math.max(b0,Math.round(hz/(SR/WIN)));
  let m=0;for(let b=b0;b<=b1&&b<nb;b++)m=Math.max(m,Math.hypot(re[b],im[b]));a[k]=m;}
 rows.push(a);}
let gmax=0;for(const r of rows)for(const v of r)if(v>gmax)gmax=v;
const perSec=40,H=430;
const SPANS=[[0,53],[53,106],[106,159],[159,212]];
SPANS.forEach(([t0,t1],pi)=>{
  const w=Math.round((t1-t0)*perSec);
  const cv=createCanvas(w,H+120),g=cv.getContext('2d');g.fillStyle='#08080c';g.fillRect(0,0,w,H+120);
  const img=g.createImageData(w,H);
  for(let px=0;px<w;px++){const t=t0+px/perSec;const f=Math.round(t*fps);if(f<0||f>=nF)continue;const a=rows[f];
   for(let py=0;py<H;py++){const k=Math.round((1-py/H)*(NBANDS-1));const v=Math.min(1,a[k]/(gmax*0.55));
    const idx=(py*w+px)*4;
    const r=Math.min(255,10+255*Math.max(0,v*1.6-0.55));
    const gg=Math.min(255,255*Math.pow(v,0.8)*0.92);
    const b=Math.min(255,30+255*Math.max(0,0.85-v*1.1));
    img.data[idx]=r;img.data[idx+1]=gg;img.data[idx+2]=b;img.data[idx+3]=255;}}
  g.putImageData(img,0,0);
  const bpm=130,off=0.1829,spb=60/bpm;
  for(let k=0;;k++){const t=off+k*spb;if(t>t1)break;if(t<t0)continue;const px=(t-t0)*perSec;
   g.strokeStyle=(k%4===0)?'rgba(0,255,120,0.75)':'rgba(0,200,255,0.18)';
   g.beginPath();g.moveTo(px,0);g.lineTo(px,H);g.stroke();
   if(k%4===0){g.fillStyle='#0f0';g.font='11px Consolas';g.fillText(String((k/4)|0),px+1,10);}}
  g.fillStyle='#fff';g.font='12px Consolas';
  for(let t=Math.ceil(t0);t<=t1;t++){if(t%5===0){g.fillStyle='#8cf';g.fillText(String(t), (t-t0)*perSec+2, H+16);}}
  g.fillStyle='#fff';g.font='13px Consolas';g.fillText('0-3200Hz  '+t0+'s..'+t1+'s   (green=bar line w/ bar#, cyan=beat)',8,H+40);
  g.fillText('freq axis: bottom=0Hz top=3200Hz',8,H+60);
  fs.writeFileSync('zoom_'+pi+'.png',cv.toBuffer('image/png'));
  console.log('zoom_'+pi+'.png',w);
});
