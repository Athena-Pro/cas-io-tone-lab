import {hann,FRAME} from './harmonic-grid.js';

// Return buffer samples independently of Web Audio so the loop/window DSP is testable.
export function makeCellSamples(samples,piece,mode='frame',length=1){
  const loop=mode==='period'?piece.loop:null,trim=loop?1:Math.min(1,Math.max(.25,length)),n=loop?Math.max(2,Math.round(loop.end-loop.start)):Math.round(FRAME*trim),start=loop?loop.start:piece.start+(FRAME-n)/2,span=loop?loop.end-loop.start:n,out=new Float32Array(n);
  for(let i=0;i<n;i++){const at=start+i*span/n,j=Math.floor(at),f=at-j,raw=(samples[j]||0)+f*((samples[j+1]||0)-(samples[j]||0));out[i]=loop?raw:raw*hann(i,n);}
  return out;
}
