export const GRID_AUTO_MODES=['scan','row','column','walk','knight','orbit','timbre','life'];
export function seededRandom(seed=17321){let state=(Number(seed)>>>0)||1;return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const autoClamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(v))?Number(v):a));
export function autoOptions(input={}){return {mode:GRID_AUTO_MODES.includes(input.mode)?input.mode:'orbit',seed:Math.trunc(autoClamp(input.seed??17321,1,4294967295)),stride:Math.round(autoClamp(input.stride??1,1,8)),density:Math.round(autoClamp(input.density??16,0,16)),scale:['off','major','minor','pentatonic'].includes(input.scale)?input.scale:'off',voices:Math.round(autoClamp(input.voices??4,1,8)),ratio:['1:1','2:3','3:2','3:4'].includes(input.ratio)?input.ratio:'2:3',boundary:input.boundary==='wrap'?'wrap':'bounce'};}
export function gridRhythm(tick,hits){hits=Math.round(autoClamp(hits,0,16));return hits>0&&(Math.max(0,Math.trunc(tick))*hits)%16<hits;}
export function gridScaleTranspose(f0,scale){if(!f0||scale==='off')return 0;const notes={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pentatonic:[0,2,4,7,9]}[scale];if(!notes)return 0;const midi=69+12*Math.log2(f0/440);let best=midi,error=Infinity;for(let n=Math.floor(midi)-12;n<=Math.ceil(midi)+12;n++)if(notes.includes(((n%12)+12)%12)&&Math.abs(n-midi)<error){best=n;error=Math.abs(n-midi);}return autoClamp(best-midi,-24,24);}
export function gridCoordinate(value,size,boundary='bounce'){if(size<=1)return 0;if(boundary==='wrap')return ((Math.round(value)%size)+size)%size;const period=2*(size-1),v=((Math.round(value)%period)+period)%period;return v<size?v:period-v;}

export class GridAutomator {
  constructor(map,pieces,options={},anchor=0){
    this.map=map;this.pieces=new Map(pieces.map(p=>[p.id,p]));this.options=autoOptions(options);this.available=map.cells.map((ids,i)=>ids.length?i:-1).filter(i=>i>=0);this.rng=seededRandom(this.options.seed);this.tick=0;this.phase=0;this.recent=[];this.setAnchor(anchor);
  }
  random(){return this.rng();}
  nearest(x,y){let best=this.available[0]??-1,distance=Infinity;for(const at of this.available){const d=(at%this.map.columns-x)**2+(Math.floor(at/this.map.columns)-y)**2;if(d<distance){distance=d;best=at;}}return best;}
  coordinate(value,size){return gridCoordinate(value,size,this.options.boundary);}
  setAnchor(index){
    this.anchor=this.available.includes(index)?index:this.available[0]??-1;this.position=this.anchor;this.phase=0;this.recent=[];const x=this.anchor%this.map.columns,y=Math.floor(this.anchor/this.map.columns),mode=this.options.mode;
    this.route=this.available.filter(at=>mode==='row'?Math.floor(at/this.map.columns)===y:mode==='column'?at%this.map.columns===x:true).sort((a,b)=>{const ay=Math.floor(a/this.map.columns),by=Math.floor(b/this.map.columns);return mode==='column'?ay-by:ay-by||(ay%2?b-a:a-b);});
    this.routeAt=Math.max(0,this.route.indexOf(this.anchor));this.seedLife();
  }
  seedLife(){this.live=new Set();if(!this.available.length)return;const x=this.anchor%this.map.columns,y=Math.floor(this.anchor/this.map.columns),turn=Math.floor(this.random()*4);for(let [dx,dy] of [[1,0],[2,1],[0,2],[1,2],[2,2]]){for(let r=0;r<turn;r++)[dx,dy]=[-dy,dx];const a=this.coordinate(x+dx,this.map.columns),b=this.coordinate(y+dy,this.map.rows),at=b*this.map.columns+a;if(this.map.cells[at]?.length)this.live.add(at);}if(!this.live.size)this.live.add(this.anchor);}
  setLiveCells(cells){this.live=new Set(cells.filter(at=>this.map.cells[at]?.length));}
  advanceLife(){const next=new Set(),cols=this.map.columns,rows=this.map.rows;for(const at of this.available){const x=at%cols,y=Math.floor(at/cols),neighbors=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){let a=x+dx,b=y+dy;if(this.options.boundary==='wrap'){a=((a%cols)+cols)%cols;b=((b%rows)+rows)%rows;}else if(a<0||a>=cols||b<0||b>=rows)continue;const other=b*cols+a;if(other!==at&&this.live.has(other))neighbors.add(other);}if(neighbors.size===3||neighbors.size===2&&this.live.has(at))next.add(at);}this.live=next;}
  move(){const {columns,rows}=this.map,o=this.options,x=this.position%columns,y=Math.floor(this.position/columns);if(['scan','row','column'].includes(o.mode)){const at=this.route[this.routeAt];this.routeAt=(this.routeAt+o.stride)%this.route.length;return at;}
    if(o.mode==='orbit'){if(this.tick===0)return this.anchor;const [a,b]=o.ratio.split(':').map(Number),radius=.42;this.phase+=.08*o.stride;const cx=this.anchor%columns,cy=Math.floor(this.anchor/columns);return this.nearest(this.coordinate(cx+Math.sin(this.phase*a)*Math.max(1,columns-1)*radius,columns),this.coordinate(cy+Math.cos(this.phase*b)*Math.max(1,rows-1)*radius,rows));}
    if(o.mode==='timbre'){if(this.tick===0)return this.anchor;const current=this.pieces.get(this.map.cells[this.position][0]),pool=this.available.filter(at=>at!==this.position&&!this.recent.slice(-3).includes(at)).map(at=>{const p=this.pieces.get(this.map.cells[at][0]);return {at,distance:current.h.reduce((sum,h,i)=>sum+(h-p.h[i])**2,0)};}).sort((a,b)=>a.distance-b.distance||a.at-b.at);return pool.length?pool[Math.floor(this.random()*Math.min(pool.length,o.stride*2))].at:this.position;}
    if(this.tick===0)return this.anchor;const moves=o.mode==='knight'?[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]:[[1,0],[-1,0],[0,1],[0,-1]],choices=[...new Set(moves.map(([dx,dy])=>{const a=this.coordinate(x+dx*o.stride,columns),b=this.coordinate(y+dy*o.stride,rows);return b*columns+a;}).filter(at=>at!==this.position&&this.map.cells[at]?.length))];return choices.length?choices[Math.floor(this.random()*choices.length)]:this.position;
  }
  next(){
    if(!this.available.length)return {rest:true,voices:[],tick:this.tick++,alive:[]};const o=this.options;let cells,alive=[];
    if(o.mode==='life'){if(!this.live.size)this.seedLife();alive=[...this.live].sort((a,b)=>a-b);cells=Array.from({length:Math.min(o.voices,alive.length)},(_,i)=>alive[(this.tick*o.voices+i)%alive.length]);this.advanceLife();}
    else {this.position=this.move();cells=[this.position];this.recent.push(this.position);if(this.recent.length>4)this.recent.shift();}
    const notes=cells.map(at=>{const ids=this.map.cells[at],id=ids[Math.floor(this.random()*ids.length)],p=this.pieces.get(id);return {x:at%this.map.columns,y:Math.floor(at/this.map.columns),piece:id,transpose:gridScaleTranspose(p.f0,o.scale)};});
    const first=notes[0]||{piece:this.map.cells[this.anchor][0],x:this.anchor%this.map.columns,y:Math.floor(this.anchor/this.map.columns)};
    return {...first,gain:.8,length:1,transpose:0,voices:notes,rest:!gridRhythm(this.tick,o.density),tick:this.tick++,alive,mode:o.mode};
  }
}
