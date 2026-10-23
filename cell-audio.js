import {hann,FRAME} from './harmonic-grid.js';

export function cellBufferKey(piece,mode,length=1){return `${piece.id}:${mode}:${mode==='period'&&piece.loop?1:Math.min(1,length)}`;}
export function cellPlayback(piece,mode,length=1,transpose=0,interval=1/24){
  const loop=mode==='period'&&!!piece.loop,rate=2**(transpose/12),samples=loop?Math.max(2,Math.round(piece.loop.end-piece.loop.start)):Math.round(FRAME*Math.min(1,length));
  return {loop,rate,samples,duration:loop?interval*length:null,exactFrame:!loop&&(length<=1||Number.isInteger(length))};
}

// Return buffer samples independently of Web Audio so the loop/window DSP is testable.
export function makeCellSamples(samples,piece,mode='frame',length=1){
  const loop=mode==='period'?piece.loop:null,trim=loop?1:Math.min(1,Math.max(.25,length)),n=loop?Math.max(2,Math.round(loop.end-loop.start)):Math.round(FRAME*trim),start=loop?loop.start:piece.start+(FRAME-n)/2,span=loop?loop.end-loop.start:n,out=new Float32Array(n);
  for(let i=0;i<n;i++){const at=start+i*span/n,j=Math.floor(at),f=at-j,raw=(samples[j]||0)+f*((samples[j+1]||0)-(samples[j]||0));out[i]=loop?raw:raw*hann(i,n);}
  return out;
}
