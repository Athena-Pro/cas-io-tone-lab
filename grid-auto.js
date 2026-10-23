import {representativeId} from './harmonic-grid.js';
export const GRID_AUTO_MODES=['scan','row','column','walk','knight','orbit','timbre','life','kuramoto','standard'];
// Ratio scales are octave-repeating sets above a root taken from the anchor cell.
export const GRID_RATIO_SCALES={harmonic:[1,9/8,5/4,11/8,3/2,13/8,7/4,15/8],just:[1,9/8,5/4,4/3,3/2,5/3,15/8],hexany:[1,7/6,5/4,35/24,5/3,7/4]};
export const GRID_SCALES=['off','major','minor','pentatonic',...Object.keys(GRID_RATIO_SCALES)];
const TAU=2*Math.PI,MIDDLE_C=261.6255653005986;
export function seededRandom(seed=17321){let state=(Number(seed)>>>0)||1;return ()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const autoClamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(v))?Number(v):a));
export function autoOptions(input={}){return {mode:GRID_AUTO_MODES.includes(input.mode)?input.mode:'orbit',seed:Math.trunc(autoClamp(input.seed??17321,1,4294967295)),stride:Math.round(autoClamp(input.stride??1,1,8)),density:Math.round(autoClamp(input.density??16,0,16)),scale:GRID_SCALES.includes(input.scale)?input.scale:'off',voices:Math.round(autoClamp(input.voices??4,1,8)),ratio:['1:1','2:3','3:2','3:4'].includes(input.ratio)?input.ratio:'2:3',boundary:input.boundary==='wrap'?'wrap':'bounce',coupling:Math.round(autoClamp(input.coupling??1,0,4)*100)/100,
  repeat:Math.round(autoClamp(input.repeat??0,0,1)*100)/100,memory:Math.round(autoClamp(input.memory??8,1,16)),lock:input.lock===true};}
export function gridRhythm(tick,hits){hits=Math.round(autoClamp(hits,0,16));return hits>0&&(Math.max(0,Math.trunc(tick))*hits)%16<hits;}
export function gridScaleTranspose(f0,scale,root=MIDDLE_C){if(!f0||scale==='off')return 0;const ratios=Object.hasOwn(GRID_RATIO_SCALES,scale)?GRID_RATIO_SCALES[scale]:null;
  if(ratios){if(!(root>0))return 0;const r=Math.log2(f0/root),octave=Math.floor(r);let best=0,error=Infinity;for(const k of [...ratios,2]){const d=octave+Math.log2(k)-r;if(Math.abs(d)<error){error=Math.abs(d);best=d;}}return autoClamp(12*best,-24,24);}
  const steps={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10],pentatonic:[0,2,4,7,9]},notes=Object.hasOwn(steps,scale)?steps[scale]:null;if(!notes)return 0;const midi=69+12*Math.log2(f0/440);let best=midi,error=Infinity;for(let n=Math.floor(midi)-12;n<=Math.ceil(midi)+12;n++)if(notes.includes(((n%12)+12)%12)&&Math.abs(n-midi)<error){best=n;error=Math.abs(n-midi);}return autoClamp(best-midi,-24,24);}
// The anchor cell's f0 roots the ratio scales; unpitched anchors use the median source f0.
export function gridScaleRoot(anchor,pieces=[]){if(anchor?.f0>0)return anchor.f0;const pitched=[...pieces].map(p=>p.f0).filter(f=>f>0).sort((a,b)=>a-b);return pitched.length?pitched[Math.floor(pitched.length/2)]:MIDDLE_C;}
export function gridCoordinate(value,size,boundary='bounce'){if(size<=1)return 0;if(boundary==='wrap')return ((Math.round(value)%size)+size)%size;const period=2*(size-1),v=((Math.round(value)%period)+period)%period;return v<size?v:period-v;}

export class GridAutomator {
  constructor(map,pieces,options={},anchor=0){
    this.map=map;this.pieces=new Map(pieces.map(p=>[p.id,p]));this.options=autoOptions(options);this.clearMemory();
    // Replay decisions use their own seeded stream, so REPEAT 0 leaves each player's sequence unchanged.
    this.memoryRandom=seededRandom((this.options.seed^0x5bd1e995)>>>0||1);this.available=map.cells.map((ids,i)=>ids.length?i:-1).filter(i=>i>=0);this.rng=seededRandom(this.options.seed);this.tick=0;this.phase=0;this.recent=[];this.setAnchor(anchor);
  }
  random(){return this.rng();}
  nearest(x,y){let best=this.available[0]??-1,distance=Infinity;for(const at of this.available){const d=(at%this.map.columns-x)**2+(Math.floor(at/this.map.columns)-y)**2;if(d<distance){distance=d;best=at;}}return best;}
  coordinate(value,size){return gridCoordinate(value,size,this.options.boundary);}
  setAnchor(index){
    this.anchor=this.available.includes(index)?index:this.available[0]??-1;this.position=this.anchor;this.phase=0;this.recent=[];const x=this.anchor%this.map.columns,y=Math.floor(this.anchor/this.map.columns),mode=this.options.mode;
    this.route=this.available.filter(at=>mode==='row'?Math.floor(at/this.map.columns)===y:mode==='column'?at%this.map.columns===x:true).sort((a,b)=>{const ay=Math.floor(a/this.map.columns),by=Math.floor(b/this.map.columns);return mode==='column'?ay-by:ay-by||(ay%2?b-a:a-b);});
    this.routeAt=Math.max(0,this.route.indexOf(this.anchor));this.lifeSeed=this.anchor;this.lifeSeeds=0;this.seedLife();this.root=this.rootFrequency();
    // Only the dynamical players draw extra seeded values, so older players keep their sequences.
    if(mode==='kuramoto')this.seedOscillators();else if(mode==='standard')this.seedStandardMap();
  }
  rootFrequency(){return gridScaleRoot(this.pieces.get(representativeId(this.map.cells[this.anchor])),this.pieces.values());}
  // Up to 16 occupied cells nearest the anchor become phase oscillators. Each natural
  // frequency is its cell's f0 relative to the window median (brightness when unpitched),
  // so an octave fires twice as often. A cell sounds when its phase passes 2π.
  seedOscillators(){
    const cols=this.map.columns,ax=this.anchor%cols,ay=Math.floor(this.anchor/cols);this.sync=0;
    this.oscillators=this.available.map(at=>({at,d:(at%cols-ax)**2+(Math.floor(at/cols)-ay)**2})).sort((a,b)=>a.d-b.d||a.at-b.at).slice(0,16).map(({at})=>{const p=this.pieces.get(representativeId(this.map.cells[at]));return {at,f0:p?.f0>0?p.f0:0,brightness:p?.brightness>0?p.brightness:1,theta:this.random()*TAU};});
    const median=values=>values.length?values.sort((a,b)=>a-b)[Math.floor(values.length/2)]:0,f0=median(this.oscillators.map(o=>o.f0).filter(Boolean)),brightness=median(this.oscillators.map(o=>o.brightness));
    for(const o of this.oscillators)o.ratio=o.f0&&f0?o.f0/f0:o.brightness/brightness;
  }
  // Mean-field Kuramoto step in four substeps. K is in radians per tick; phases never run
  // backward and advance less than one cycle per tick, so each cell fires at most once.
  stepOscillators(){
    const os=this.oscillators,n=os.length,K=this.options.coupling,base=.125*this.options.stride,fired=new Set();if(!n)return [];
    for(let sub=0;sub<4;sub++){let c=0,s=0;for(const o of os){c+=Math.cos(o.theta);s+=Math.sin(o.theta);}const r=Math.hypot(c,s)/n,psi=Math.atan2(s,c);
      for(const o of os){const omega=TAU*Math.max(.02,Math.min(.9,base*o.ratio)),step=Math.max(0,Math.min(.95*TAU,omega+K*r*Math.sin(psi-o.theta)))/4;o.theta+=step;if(o.theta>=TAU){o.theta-=TAU;fired.add(o.at);}}}
    let c=0,s=0;for(const o of os){c+=Math.cos(o.theta);s+=Math.sin(o.theta);}this.sync=Math.hypot(c,s)/n;
    return [...fired].sort((a,b)=>a-b);
  }
  // Chirikov standard map on the torus: p ← p + K sin q, q ← q + p. Low K traces regular
  // orbits; above K ≈ 0.97 no invariant circle spans the torus, so orbits can cross every
  // row, though regular islands persist at moderate K. Reflect folds the torus onto the grid.
  seedStandardMap(){const cols=this.map.columns,rows=this.map.rows,ax=this.anchor%cols,ay=Math.floor(this.anchor/cols);this.q=TAU*(ax+.25+.5*this.random())/Math.max(1,cols);this.p=TAU*(ay+.25+.5*this.random())/Math.max(1,rows);}
  moveStandardMap(){
    const {columns,rows}=this.map,K=this.options.coupling,mod=v=>((v%TAU)+TAU)%TAU,fold=u=>this.options.boundary==='wrap'?u:1-Math.abs(2*u-1);
    for(let i=0;i<this.options.stride;i++){this.p=mod(this.p+K*Math.sin(this.q));this.q=mod(this.q+this.p);}
    const place=(u,size)=>this.options.boundary==='wrap'?u*size-.5:fold(u)*(size-1);return this.nearest(place(this.q/TAU,columns),place(this.p/TAU,rows));
  }
  seedLife(){this.live=new Set();if(!this.available.length)return;if(this.lifeSeeds++){const other=this.available.filter(at=>at!==this.lifeSeed);if(other.length)this.lifeSeed=other[Math.floor(this.random()*other.length)];}const x=this.lifeSeed%this.map.columns,y=Math.floor(this.lifeSeed/this.map.columns),turn=Math.floor(this.random()*4);for(let [dx,dy] of [[1,0],[2,1],[0,2],[1,2],[2,2]]){for(let r=0;r<turn;r++)[dx,dy]=[-dy,dx];const a=this.coordinate(x+dx,this.map.columns),b=this.coordinate(y+dy,this.map.rows),at=b*this.map.columns+a;if(this.map.cells[at]?.length)this.live.add(at);}if(!this.live.size)this.live.add(this.lifeSeed);}
  setLiveCells(cells){this.live=new Set(cells.filter(at=>this.map.cells[at]?.length));}
  advanceLife(){const next=new Set(),cols=this.map.columns,rows=this.map.rows;for(const at of this.available){const x=at%cols,y=Math.floor(at/cols),neighbors=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(dx||dy){let a=x+dx,b=y+dy;if(this.options.boundary==='wrap'){a=((a%cols)+cols)%cols;b=((b%rows)+rows)%rows;}else if(a<0||a>=cols||b<0||b>=rows)continue;const other=b*cols+a;if(other!==at&&this.live.has(other))neighbors.add(other);}if(neighbors.size===3||neighbors.size===2&&this.live.has(at))next.add(at);}this.live=next;}
  move(){const {columns,rows}=this.map,o=this.options,x=this.position%columns,y=Math.floor(this.position/columns);if(['scan','row','column'].includes(o.mode)){const at=this.route[this.routeAt];this.routeAt=(this.routeAt+o.stride)%this.route.length;return at;}
    if(o.mode==='orbit'){if(this.tick===0)return this.anchor;const [a,b]=o.ratio.split(':').map(Number),radius=.42;this.phase+=.08*o.stride;const cx=this.anchor%columns,cy=Math.floor(this.anchor/columns);return this.nearest(this.coordinate(cx+Math.sin(this.phase*a)*Math.max(1,columns-1)*radius,columns),this.coordinate(cy+Math.cos(this.phase*b)*Math.max(1,rows-1)*radius,rows));}
    if(o.mode==='standard')return this.tick===0?this.anchor:this.moveStandardMap();
    if(o.mode==='timbre'){if(this.tick===0)return this.anchor;const current=this.pieces.get(representativeId(this.map.cells[this.position])),pool=(()=>{const fresh=this.available.filter(at=>at!==this.position&&!this.recent.slice(-3).includes(at));return fresh.length?fresh:this.available.filter(at=>at!==this.position);})().map(at=>{const p=this.pieces.get(representativeId(this.map.cells[at]));return {at,distance:current.h.reduce((sum,h,i)=>sum+(h-p.h[i])**2,0)};}).sort((a,b)=>a.distance-b.distance||a.at-b.at);return pool.length?pool[Math.floor(this.random()*Math.min(pool.length,o.stride*2))].at:this.position;}
    if(this.tick===0)return this.anchor;const moves=o.mode==='knight'?[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]:[[1,0],[-1,0],[0,1],[0,-1]],choices=[...new Set(moves.map(([dx,dy])=>{const a=this.coordinate(x+dx*o.stride,columns),b=this.coordinate(y+dy*o.stride,rows);return b*columns+a;}).filter(at=>at!==this.position&&this.map.cells[at]?.length))];if(choices.length)return choices[Math.floor(this.random()*choices.length)];const fallback=this.available.filter(at=>at!==this.position).sort((a,b)=>((a%columns-x)**2+(Math.floor(a/columns)-y)**2)-((b%columns-x)**2+(Math.floor(b/columns)-y)**2)||a-b).slice(0,4);return fallback.length?fallback[Math.floor(this.random()*fallback.length)]:this.position;
  }
  clearMemory(){this.memory=Array(16).fill(null);}
  memoryFill(){return this.memory.slice(0,this.options.memory).filter(Boolean).length;}
  // Choice memory: the player advances every tick, and its event fills loop slot tick mod
  // MEMORY. With probability REPEAT a filled slot replays its stored event instead (frame IDs,
  // chord voices, rests and transposition). LOCK stops new events from overwriting slots,
  // so REPEAT 1 with LOCK loops exactly; HITS PER 16 still gates replays.
  next(){
    const fresh=this.generate();if(!this.available.length)return fresh;
    const o=this.options,slot=fresh.tick%o.memory,stored=this.memory[slot];
    const replay=!!stored&&o.repeat>0&&(o.repeat>=1||this.memoryRandom()<o.repeat);
    if(replay){const {tick,alive,sync}=fresh;return {...structuredClone(stored),rest:stored.rest||!gridRhythm(tick,o.density),tick,alive,mode:o.mode,...(sync===undefined?{}:{sync}),replay:true,memorySlot:slot};}
    if(!o.lock){const {tick,alive,sync,...kept}=fresh;this.memory[slot]=structuredClone(kept);}
    return {...fresh,replay:false,memorySlot:slot};
  }
  generate(){
    if(!this.available.length)return {rest:true,voices:[],tick:this.tick++,alive:[]};const o=this.options;let cells,alive=[],extra={};
    if(o.mode==='life'){if(!this.live.size)this.seedLife();alive=[...this.live].sort((a,b)=>a-b);cells=Array.from({length:Math.min(o.voices,alive.length)},(_,i)=>alive[(this.tick*o.voices+i)%alive.length]);this.advanceLife();}
    else if(o.mode==='kuramoto'){const fired=this.stepOscillators();alive=this.oscillators.map(c=>c.at).sort((a,b)=>a-b);cells=Array.from({length:Math.min(o.voices,fired.length)},(_,i)=>fired[(this.tick*o.voices+i)%fired.length]);extra={sync:this.sync};}
    else {this.position=this.move();cells=[this.position];this.recent.push(this.position);if(this.recent.length>4)this.recent.shift();}
    const notes=cells.map(at=>{const ids=this.map.cells[at],id=ids[Math.floor(this.random()*ids.length)],p=this.pieces.get(id);return {x:at%this.map.columns,y:Math.floor(at/this.map.columns),piece:id,transpose:gridScaleTranspose(p.f0,o.scale,this.root)};});
    const first=notes[0]||{piece:this.map.cells[this.anchor][0],x:this.anchor%this.map.columns,y:Math.floor(this.anchor/this.map.columns)};
    // A Kuramoto tick on which no oscillator crosses 2π is a rest, not the anchor.
    return {...first,gain:.8,length:1,transpose:0,voices:notes,rest:!gridRhythm(this.tick,o.density)||!notes.length,tick:this.tick++,alive,mode:o.mode,...extra};
  }
}
