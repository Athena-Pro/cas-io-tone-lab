import {hann,FRAME} from './harmonic-grid.js';

export function cellBufferKey(piece,mode,length=1){return `${piece.id}:${mode}:${mode==='period'&&piece.loop?1:Math.min(1,length)}`;}
export function cellPlayback(piece,mode,length=1,transpose=0,interval=1/24,sampleRate=48000){
  const loop=mode==='period'&&!!piece.loop,rate=2**(transpose/12),samples=loop?Math.max(2,Math.round(piece.loop.end-piece.loop.start)):Math.round(FRAME*Math.min(1,length));
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

// Return buffer samples independently of Web Audio so the loop/window DSP is testable.
export function makeCellSamples(samples,piece,mode='frame',length=1){
  const loop=mode==='period'?piece.loop:null,trim=loop?1:Math.min(1,Math.max(.25,length)),n=loop?Math.max(2,Math.round(loop.end-loop.start)):Math.round(FRAME*trim),start=loop?loop.start:piece.start+(FRAME-n)/2,span=loop?loop.end-loop.start:n,out=new Float32Array(n);
  for(let i=0;i<n;i++){const at=start+i*span/n,j=Math.floor(at),f=at-j,raw=(samples[j]||0)+f*((samples[j+1]||0)-(samples[j]||0));out[i]=loop?raw:raw*hann(i,n);}
  return out;
}
