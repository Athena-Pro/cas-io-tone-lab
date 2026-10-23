export function gridInterval(step,clock=24,timing='recorded'){
  return timing!=='uniform'&&Number.isFinite(step.interval)?step.interval:1/Math.max(1/6,Math.min(50,Number(clock)||24));
}
// The final event uses the preceding movement gap (or the grid clock for a
// single event). Reaching for Disarm does not extend the loop's final interval.
export class GridPathWriter {
  reset(){this.last=-1;this.time=0;}
  constructor(){this.reset();}
  append(score,step,now,clock=24){
    let interval=gridInterval({},clock);
    if(this.last>=0&&score[this.last]){interval=Math.max(.02,Math.min(6,now-this.time));score[this.last].interval=interval;}
    score.push({...step,interval});this.last=score.length-1;this.time=now;
  }
  finish(){this.reset();}
}
