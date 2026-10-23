// Radix-2 butterfly adapted from the workbench's app/additive.js.
export function fft(re, im, inverse=false) {
  const n=re.length;if(n!==im.length||n<2||(n&(n-1)))throw new Error('FFT needs equal power-of-two arrays.');
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for(let len=2;len<=n;len<<=1){const angle=(inverse?2:-2)*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const a=i+k,b=a+len/2,xr=re[b]*cr-im[b]*ci,xi=re[b]*ci+im[b]*cr;re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;const t=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t;}}}
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
const bound=(v,a,b)=>Math.max(a,Math.min(b,v));
export const FRAME=2048,HOP=1024,PARTIALS=16;
export const hann=(i,n)=>.5-.5*Math.cos(2*Math.PI*i/n);
// Pitch-only 40 Hz high-pass. Forward/backward filtering with reflected padding
// avoids a start-of-file filter transient becoming a false low fundamental.
function pitchFrame(samples,sr,start,n){
  const w=2*Math.PI*40/sr,c=Math.cos(w),sin=Math.sin(w),padding=Math.ceil(sr*.075),data=new Float64Array(n+2*padding),span=Math.max(1,samples.length-1);
  for(let i=0;i<data.length;i++){const at=start+i-padding,wrapped=((at%(2*span))+2*span)%(2*span),index=wrapped<=span?wrapped:2*span-wrapped;data[i]=samples[index]||0;}
  const filter=reverse=>{
    const stages=[.5411961001,1.3065629649].map(q=>{const a=1+sin/(2*q);return {b0:(1+c)/2/a,b1:-(1+c)/a,b2:(1+c)/2/a,a1:-2*c/a,a2:(1-sin/(2*q))/a,x1:0,x2:0,y1:0,y2:0};});
    stages[0].x1=stages[0].x2=data[reverse?data.length-1:0];
    for(let j=0;j<data.length;j++){const i=reverse?data.length-1-j:j;let x=data[i];for(const f of stages){const y=f.b0*x+f.b1*f.x1+f.b2*f.x2-f.a1*f.y1-f.a2*f.y2;f.x2=f.x1;f.x1=x;f.y2=f.y1;f.y1=y;x=y;}data[i]=x;}
  };
  filter(false);filter(true);return data.slice(padding,padding+n);
}
export function analyzeFrame(samples,sr,start=0) {
  const n=FRAME,re=new Float64Array(n),im=new Float64Array(n),ar=new Float64Array(n*2),ai=new Float64Array(n*2),sums=new Float64Array(n+1);
  let mean=0;for(let i=0;i<n;i++)mean+=samples[start+i]||0;mean/=n;
  const pitch=pitchFrame(samples,sr,start,n);let energy=0;
  for(let i=0;i<n;i++){const x=(samples[start+i]||0)-mean;re[i]=x*hann(i,n);energy+=x*x;ar[i]=pitch[i];sums[i+1]=sums[i]+pitch[i]*pitch[i];}
  const rms=Math.sqrt(energy/n);fft(re,im);const power=Float64Array.from({length:n/2},(_,i)=>re[i]**2+im[i]**2);
  let f0=0,confidence=0;
  if(rms>1e-5){fft(ar,ai);for(let i=0;i<ar.length;i++){ar[i]=ar[i]**2+ai[i]**2;ai[i]=0;}fft(ar,ai,true);
    const lo=Math.max(2,Math.floor(sr/Math.min(4000,sr/8))),hi=Math.min(n/2-2,Math.ceil(sr/60)),corr=new Float64Array(hi+2),peaks=[];
    for(let lag=1;lag<=hi+1;lag++)corr[lag]=ar[lag]/Math.max(1e-20,Math.sqrt(sums[n-lag]*(sums[n]-sums[lag])));
    let firstNegative=1;while(firstNegative<=hi&&corr[firstNegative]>0)firstNegative++;
    let peak=0;const keepPeak=()=>{if(peak&&corr[peak]>=corr[peak-1]&&corr[peak]>corr[peak+1])peaks.push(peak);peak=0;};
    for(let lag=firstNegative+1;lag<=hi;lag++){if(corr[lag]>0){if(!peak||corr[lag]>corr[peak])peak=lag;}else keepPeak();}keepPeak();
    const best=peaks.reduce((m,l)=>Math.max(m,corr[l]),0),chosen=peaks.find(l=>corr[l]>=Math.max(.6,best*.92));
    if(chosen>=lo){const a=corr[chosen-1],b=corr[chosen],c=corr[chosen+1],d=bound(.5*(a-c)/(a-2*b+c||1),-.5,.5);f0=sr/(chosen+d);
      // A clean raw period can be more coherent than its reflected-filter edge.
      // Rumble rejection chooses the lag; confidence can also use the raw repeat.
      let dot=0,left=0,right=0;for(let i=0;i<n-chosen;i++){const x=(samples[start+i]||0)-mean,y=(samples[start+i+chosen]||0)-mean;dot+=x*y;left+=x*x;right+=y*y;}
      confidence=bound(Math.max(b,dot/Math.max(1e-20,Math.sqrt(left*right))),0,1);}
  }
  const h=new Float64Array(PARTIALS);let total=0,odd=0,even=0,weighted=0,allEnergy=0,residual=0;
  const residualWidth=Math.min(1.5,.35*f0*n/sr);
  for(let bin=2;bin<power.length;bin++){allEnergy+=power[bin];const harmonic=f0?Math.round(bin*sr/n/f0):0;if(!harmonic||Math.abs(bin-harmonic*f0*n/sr)>residualWidth)residual+=power[bin];}
  if(f0)for(let k=1;k<=PARTIALS;k++){const at=k*f0*n/sr;if(at>=power.length-1)break;let energy=0;for(let j=Math.max(1,Math.ceil(at-1.5));j<=Math.min(power.length-1,Math.floor(at+1.5));j++)energy+=power[j];h[k-1]=Math.sqrt(energy);total+=h[k-1];weighted+=k*h[k-1];if(k%2)odd+=h[k-1];else even+=h[k-1];}
  if(total)for(let i=0;i<h.length;i++)h[i]/=total;
  return {start,end:Math.min(start+n,samples.length),f0,confidence,rms,h,brightness:total?weighted/total:0,oddEven:total?(odd-even)/total:0,inharmonicity:allEnergy?bound(residual/allEnergy,0,1):0,residualResolutionLimited:!!f0&&f0*n/sr<5};
}
function nearestCrossing(samples,target,radius){let best=null,distance=Infinity;for(let i=Math.max(1,Math.floor(target-radius));i<Math.min(samples.length-1,target+radius);i++)if(samples[i-1]<=0&&samples[i]>0){const at=i-1-samples[i-1]/(samples[i]-samples[i-1]);if(Math.abs(at-target)<distance){best=at;distance=Math.abs(at-target);}}return best;}
export function periodBounds(samples,sr,piece){
  if(!piece.f0||piece.confidence<.75)return null;const period=sr/piece.f0,start=nearestCrossing(samples,piece.start+period,period*.6);if(start===null)return null;
  const periods=Math.max(1,Math.floor((FRAME-period*1.7)/period)),target=start+periods*period,end=nearestCrossing(samples,target,period*.15);
  return end!==null&&end>start+8?{start,end,periods}:null;
}
export async function analyzeSound(samples,sr,{progress=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}) {
  if(samples.length<FRAME)throw new Error('Load at least 2048 samples of sound.');
  const pieces=[],count=Math.floor((samples.length-FRAME)/HOP)+1;
  for(let i=0;i<count;i++){const p=analyzeFrame(samples,sr,i*HOP);p.id=i;p.loop=periodBounds(samples,sr,p);pieces.push(p);if(i%32===31){progress((i+1)/count);await yieldTask();}}
  progress(1);return pieces;
}
export function principalCoordinates(pieces){
  const mean=new Float64Array(PARTIALS);for(const p of pieces)for(let i=0;i<PARTIALS;i++)mean[i]+=p.h[i]/pieces.length;
  const cov=Array.from({length:PARTIALS},()=>new Float64Array(PARTIALS));for(const p of pieces)for(let i=0;i<PARTIALS;i++)for(let j=0;j<PARTIALS;j++)cov[i][j]+=(p.h[i]-mean[i])*(p.h[j]-mean[j]);
  const axes=[];for(let axis=0;axis<2;axis++){let v=Float64Array.from({length:PARTIALS},(_,i)=>Math.sin((i+1)*(axis+1.37)));for(let k=0;k<60;k++){const w=Float64Array.from({length:PARTIALS},(_,i)=>cov[i].reduce((s,x,j)=>s+x*v[j],0));for(const prev of axes){const dot=w.reduce((s,x,i)=>s+x*prev[i],0);for(let i=0;i<PARTIALS;i++)w[i]-=dot*prev[i];}const norm=Math.hypot(...w);if(norm<1e-15){v.fill(0);break;}v=Float64Array.from(w,x=>x/norm);}axes.push(v);}
  return pieces.map(p=>axes.map(axis=>axis.reduce((s,x,i)=>s+x*(p.h[i]-mean[i]),0)));
}
export function mapPieces(pieces,mode='balanced',capacity=0){
  if(!pieces.length)return {columns:0,rows:0,cells:[],locations:new Map(),mode,capacity};
  const count=capacity>0?Math.min(pieces.length,Math.max(1,Math.floor(capacity))):pieces.length,columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns),cells=Array.from({length:columns*rows},()=>[]),locations=new Map();
  const put=(id,x,y)=>{cells[y*columns+x].push(id);locations.set(id,{x,y});};
  if(mode==='balanced'||mode==='pca'){
    const projected=mode==='pca'?principalCoordinates(pieces):pieces.map(p=>[p.brightness,p.f0]),coords=new Map(pieces.map((p,i)=>[p.id,projected[i]]));
    const sorted=pieces.slice().sort((a,b)=>coords.get(a.id)[0]-coords.get(b.id)[0]||a.id-b.id);let cursor=0;
    for(let x=0;x<columns;x++){const size=Math.floor(pieces.length/columns)+(x<pieces.length%columns?1:0),column=sorted.slice(cursor,cursor+size).sort((a,b)=>coords.get(a.id)[1]-coords.get(b.id)[1]||a.id-b.id);cursor+=size;column.forEach((p,i)=>put(p.id,x,rows-1-(size<=rows?i:Math.floor(i*rows/size))));}
  }else{
    const pitched=pieces.filter(p=>p.f0>0),hasUnpitched=pitched.length!==pieces.length,coords=pitched.map(p=>[p.brightness,Math.log2(p.f0)]),min=[0,1].map(i=>coords.length?Math.min(...coords.map(p=>p[i])):0),max=[0,1].map(i=>coords.length?Math.max(...coords.map(p=>p[i])):1);
    for(const p of pieces){let x=0,y=rows-1;if(p.f0>0){x=Math.round((p.brightness-min[0])/(max[0]-min[0]||1)*(columns-1));y=Math.round((1-(Math.log2(p.f0)-min[1])/(max[1]-min[1]||1))*(rows-1));if(hasUnpitched&&x===0&&y===rows-1){if(columns>1)x=1;else if(rows>1)y--;}}put(p.id,x,y);}
  }
  return {columns,rows,cells,locations,mode,capacity};
}
export function nextOccupiedCell(map,from,dx,dy){
  const x=from%map.columns,y=Math.floor(from/map.columns);for(let a=x+dx,b=y+dy;a>=0&&a<map.columns&&b>=0&&b<map.rows;a+=dx,b+=dy)if(map.cells[b*map.columns+a]?.length)return b*map.columns+a;
  let best=from,distance=Infinity;map.cells.forEach((ids,at)=>{if(!ids.length)return;const ax=at%map.columns-x,ay=Math.floor(at/map.columns)-y,forward=ax*dx+ay*dy,across=ax*dy-ay*dx;if(forward<=0)return;const cost=forward*forward+5*across*across;if(cost<distance){distance=cost;best=at;}});return best;
}
export const representativeId=ids=>ids?.[Math.floor(ids.length/2)];
export function makePattern(map,pieces,mode='original',count=32,start={x:0,y:0},random=Math.random){
  const step=id=>({...map.locations.get(id),piece:id,gain:1,length:1,transpose:0});
  const pick=ids=>ids[Math.min(ids.length-1,Math.floor(random()*ids.length))];
  if(mode==='original')return pieces.map(p=>step(p.id));
  const available=map.cells.map((ids,i)=>ids.length?i:-1).filter(i=>i>=0);if(!available.length)return[];
  if(mode==='row'){const row=Math.max(0,Math.min(map.rows-1,start.y));return map.cells.slice(row*map.columns,(row+1)*map.columns).filter(ids=>ids.length).map(ids=>step(pick(ids)));}
  let at=available.includes(start.y*map.columns+start.x)?start.y*map.columns+start.x:available[0];const result=[];
  for(let i=0;i<count;i++){result.push(step(pick(map.cells[at])));const x=at%map.columns,y=Math.floor(at/map.columns),moves=mode==='knight'?[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];const choices=moves.map(([dx,dy])=>[x+dx,y+dy]).filter(([a,b])=>a>=0&&a<map.columns&&b>=0&&b<map.rows&&map.cells[b*map.columns+a].length);at=choices.length?(()=>{const [a,b]=choices[Math.floor(random()*choices.length)];return b*map.columns+a;})():available[Math.floor(random()*available.length)];}
  return result;
}
export function demoSound(sr=48000){const samples=new Float32Array(sr*6);for(let i=0;i<samples.length;i++){const t=i/sr,section=Math.floor(t/.375),f=110*2**((section%8)*2/12),bright=Math.floor(section/4)%4,local=t%.375,envelope=Math.min(1,local/.012,Math.max(0,(.375-local)/.025));let value=0;for(let k=1;k<=16;k++)value+=Math.sin(2*Math.PI*f*k*t)/(k**(2.8-bright*.65));samples[i]=value*.23*envelope;}return samples;}
