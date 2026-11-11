
const { execFileSync } = require('child_process');
const fs = require('fs');

const SRC = 'audio_raw.mp3';
// duration
const probe = execFileSync('ffprobe', ['-v','error','-show_entries','format=duration,bit_rate','-of','json', SRC]).toString();
console.log('probe', probe.trim());

const SR = 22050;
const raw = execFileSync('ffmpeg', ['-v','error','-i',SRC,'-ac','1','-ar',String(SR),'-f','f32le','-'], {maxBuffer: 1<<30});
const buf = Buffer.from(raw);
const N = Math.floor(buf.length/4);
const x = new Float32Array(N);
for (let i=0;i<N;i++) x[i]=buf.readFloatLE(i*4);
const dur = N/SR;
console.log('samples',N,'dur',dur.toFixed(3),'s');

// --- FFT
function fft(re, im){ const n=re.length; for(let i=1,j=0;i<n;i++){let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t;}}
 for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len; const wr=Math.cos(ang),wi=Math.sin(ang);
  for(let i=0;i<n;i+=len){let cr=1,ci=0; for(let j=0;j<len/2;j++){const ur=re[i+j],ui=im[i+j]; const vr=re[i+j+len/2]*cr-im[i+j+len/2]*ci; const vi=re[i+j+len/2]*ci+im[i+j+len/2]*cr;
   re[i+j]=ur+vr; im[i+j]=ui+vi; re[i+j+len/2]=ur-vr; im[i+j+len/2]=ui-vi; const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr;}}}}

// --- STFT spectral flux
const WIN=1024, HOP=256;
const nFrames = Math.floor((N-WIN)/HOP);
const nBins = WIN/2;
const flux = new Float32Array(nFrames);
const rms = new Float32Array(nFrames);
const bandE = [new Float32Array(nFrames),new Float32Array(nFrames),new Float32Array(nFrames)];
let prev = null;
const re=new Float32Array(WIN), im=new Float32Array(WIN);
const hann = new Float32Array(WIN); for(let i=0;i<WIN;i++) hann[i]=0.5-0.5*Math.cos(2*Math.PI*i/(WIN-1));
for (let f=0; f<nFrames; f++){
  const off=f*HOP;
  let e=0;
  for(let i=0;i<WIN;i++){ const s=x[off+i]||0; e+=s*s; re[i]=s*hann[i]; im[i]=0; }
  rms[f]=Math.sqrt(e/WIN);
  fft(re,im);
  const mag=new Float32Array(nBins);
  for(let b=0;b<nBins;b++) mag[b]=Math.hypot(re[b],im[b]);
  if(prev){ let s=0; for(let b=1;b<nBins;b++){ const d=mag[b]-prev[b]; if(d>0) s+=d; } flux[f]=s; }
  // bands: low <200Hz, mid 200-2000, high >2000
  const hzPerBin = SR/WIN;
  let lo=0,mi=0,hi=0;
  for(let b=0;b<nBins;b++){ const hz=b*hzPerBin; const p=mag[b]*mag[b]; if(hz<200) lo+=p; else if(hz<2000) mi+=p; else hi+=p; }
  bandE[0][f]=lo; bandE[1][f]=mi; bandE[2][f]=hi;
  prev=mag;
}
// normalize flux (adaptive: subtract local mean)
const fluxN=new Float32Array(nFrames);
const W=16;
for(let f=0;f<nFrames;f++){ let m=0,c=0; for(let k=-W;k<=W;k++){const j=f+k; if(j>=0&&j<nFrames){m+=flux[j];c++;}} m/=c; fluxN[f]=Math.max(0,flux[f]-m*1.05); }
let mx=0; for(const v of fluxN) if(v>mx) mx=v;
for(let f=0;f<nFrames;f++) fluxN[f]/= (mx||1);

const fps = SR/HOP;
console.log('onset frames',nFrames,'fps',fps.toFixed(2));

// --- tempo via autocorrelation of onset envelope (lag range 60-200 BPM)
function tempoFrom(env, fps, lo=70, hi=190){
  const lagMin=Math.floor(60/hi*fps), lagMax=Math.ceil(60/lo*fps);
  let best=0,bestLag=0; const arr=[];
  for(let lag=lagMin;lag<=lagMax;lag++){
    let s=0,c=0; for(let i=0;i+lag<env.length;i++){ s+=env[i]*env[i+lag]; c++; }
    s/=c; arr.push([lag,s]); if(s>best){best=s;bestLag=lag;}
  }
  return {bpm: 60*fps/bestLag, lag:bestLag, curve:arr};
}
const t1=tempoFrom(fluxN,fps);
console.log('tempo est', t1.bpm.toFixed(2), 'lag', t1.lag);
// refit with harmonic check (half/double)
const cands = [t1.bpm/2, t1.bpm, t1.bpm*2, t1.bpm*1.5, t1.bpm/1.5].filter(b=>b>60&&b<200);
console.log('cands', cands.map(c=>c.toFixed(2)).join(' '));

fs.writeFileSync('analysis.json', JSON.stringify({
  sr:SR, dur, fps, nFrames,
  flux: Array.from(fluxN).map(v=>+v.toFixed(4)),
  rms: Array.from(rms).map(v=>+v.toFixed(5)),
  low: Array.from(bandE[0]).map(v=>+v.toFixed(3)),
  mid: Array.from(bandE[1]).map(v=>+v.toFixed(3)),
  high: Array.from(bandE[2]).map(v=>+v.toFixed(3)),
  tempo:{bpm:t1.bpm, lag:t1.lag},
}));
console.log('wrote analysis.json');
