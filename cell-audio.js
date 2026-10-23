import {hann,FRAME} from './harmonic-grid.js';

// Waveset cells repeat each rising-crossing segment REPEAT times and can drop every
// DROP-th segment (0 = keep all). Out-of-range values fall back to the defaults.
export function wavesetOptions(input={}){const repeat=Math.round(Number(input?.repeat)),drop=Math.round(Number(input?.drop));return {repeat:repeat>=1&&repeat<=4?repeat:2,drop:drop>=2&&drop<=8?drop:0};}
export function cellBufferKey(piece,mode,length=1,waveset){if(mode==='waveset'){const w=wavesetOptions(waveset);return `${piece.id}:waveset:${w.repeat}:${w.drop}:${Math.min(1,length)}`;}return `${piece.id}:${mode}:${mode==='period'&&piece.loop?1:Math.min(1,length)}`;}
// Waveset buffers have a data-dependent length, so their callers pass it in.
export function cellPlayback(piece,mode,length=1,transpose=0,interval=1/24,sampleRate=48000,bufferSamples=0){
  const loop=mode==='period'&&!!piece.loop,rate=2**(transpose/12),samples=loop?Math.max(2,Math.round(piece.loop.end-piece.loop.start)):mode==='waveset'&&bufferSamples>0?bufferSamples:Math.round(FRAME*Math.min(1,length));
  return {loop,rate,samples,duration:loop?interval*length:samples/sampleRate/rate*Math.max(1,length),exactFrame:!loop&&(length<=1||Number.isInteger(length))};
}

// Reserve audible intervals, not the earlier instant at which a node is queued.
// Live scheduling and offline rendering use the same boundary and overlap rule.
export class GrainBudget {
  constructor(limit=32){this.limit=limit;this.intervals=new Map();this.serial=0;}
  reserve(start,duration,now=start){
    for(const [id,v] of this.intervals)if(v.end<=now+1e-9)this.intervals.delete(id);
    const end=start+duration,events=[[start,1],[end,-1]];
    for(const v of this.intervals.values())if(v.start<end-1e-9&&v.end>start+1e-9){events.push([Math.max(start,v.start),1],[Math.min(end,v.end),-1]);}
    events.sort((a,b)=>Math.abs(a[0]-b[0])<1e-9?a[1]-b[1]:a[0]-b[0]);let sounding=0;
    for(const [,change] of events){sounding+=change;if(sounding>this.limit)return null;}
    const id=++this.serial;this.intervals.set(id,{start,end});return id;
  }
  release(id){this.intervals.delete(id);}
  countAt(time){let count=0;for(const v of this.intervals.values())if(v.start<=time+1e-9&&v.end>time+1e-9)count++;return count;}
  reset(){this.intervals.clear();}
}

// Wishart-style wavesets: segments between successive rising zero crossings of the
// centered frame. A segment is not necessarily one fundamental period; complex tones
// have several per cycle, which is where repeat/drop reshape the formants.
export function wavesetSegments(samples,start,n){
  const at=i=>samples[start+i]||0,crossings=[];
  for(let i=1;i<n;i++){const a=at(i-1),b=at(i);if(a<=0&&b>0){const c=i-1-a/(b-a);if(!crossings.length||c-crossings.at(-1)>=4)crossings.push(c);}}
  return crossings.slice(1).map((end,i)=>[crossings[i],end]);
}
function makeWavesetSamples(samples,piece,length,options){
  const {repeat,drop}=wavesetOptions(options),n=Math.round(FRAME*Math.min(1,Math.max(.25,length))),start=piece.start+Math.floor((FRAME-n)/2),segments=wavesetSegments(samples,start,n),read=pos=>{const j=Math.floor(pos),f=pos-j;return (samples[j]||0)+f*((samples[j+1]||0)-(samples[j]||0));},out=[];
  // Carry each repetition's fractional overshoot so repeated cycles keep their mean length.
  let carry=0;segments.forEach(([a,b],w)=>{if(drop&&w%drop===drop-1)return;for(let r=0;r<repeat;r++){let pos=a+carry;for(;pos<b;pos++)out.push(read(start+pos));carry=pos-b;}});
  if(out.length<16)return null;
  return Float32Array.from(out,(x,i)=>x*hann(i,out.length));
}

// Return buffer samples independently of Web Audio so the loop/window DSP is testable.
export function makeCellSamples(samples,piece,mode='frame',length=1,waveset){
  // Silent or crossing-free frames fall back to the ordinary centered Hann grain.
  if(mode==='waveset')return makeWavesetSamples(samples,piece,length,waveset)||makeCellSamples(samples,piece,'frame',length);
  const loop=mode==='period'?piece.loop:null,trim=loop?1:Math.min(1,Math.max(.25,length)),n=loop?Math.max(2,Math.round(loop.end-loop.start)):Math.round(FRAME*trim),start=loop?loop.start:piece.start+(FRAME-n)/2,span=loop?loop.end-loop.start:n,out=new Float32Array(n);
  for(let i=0;i<n;i++){const at=start+i*span/n,j=Math.floor(at),f=at-j,raw=(samples[j]||0)+f*((samples[j+1]||0)-(samples[j]||0));out[i]=loop?raw:raw*hann(i,n);}
  return out;
}
