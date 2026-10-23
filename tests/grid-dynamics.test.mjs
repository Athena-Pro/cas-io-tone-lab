import assert from 'node:assert/strict';
import {GridAutomator,GRID_AUTO_MODES,GRID_RATIO_SCALES,GRID_SCALES,autoOptions,gridScaleTranspose,gridScaleRoot} from '../grid-auto.js';
import {makeGridTake,readGridTake} from '../grid-recording.js';
let checks=0;function test(name,fn){fn();console.log(`ok ${++checks} · ${name}`);}
function fixture(cols=8,rows=8,holes=[],f0=at=>110*2**((at%12)/12)*(at%3?1:2)){const pieces=[],cells=Array.from({length:cols*rows},()=>[]),locations=new Map();for(let at=0;at<cells.length;at++)if(!holes.includes(at)){const id=pieces.length;pieces.push({id,f0:f0(at),brightness:1+at/10,h:new Float64Array(16)});cells[at].push(id);locations.set(id,{x:at%cols,y:Math.floor(at/cols)});}return {map:{columns:cols,rows,cells,locations},pieces};}
const run=(f,o={},anchor=27)=>new GridAutomator(f.map,f.pieces,o,anchor);
const ticks=(g,n)=>Array.from({length:n},()=>g.next());
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;

test('Options accept the dynamical players, ratio scales and a bounded coupling constant',()=>{
  for(const mode of ['kuramoto','standard'])assert.ok(GRID_AUTO_MODES.includes(mode));for(const scale of ['harmonic','just','hexany'])assert.ok(GRID_SCALES.includes(scale));
  assert.equal(autoOptions({}).coupling,1);assert.equal(autoOptions({coupling:-3}).coupling,0);assert.equal(autoOptions({coupling:99}).coupling,4);assert.equal(autoOptions({coupling:'nope'}).coupling,0);assert.equal(autoOptions({coupling:1.2345}).coupling,1.23);
  assert.equal(autoOptions({mode:'kuramoto',scale:'hexany'}).mode,'kuramoto');assert.equal(autoOptions({scale:'hexany'}).scale,'hexany');assert.equal(autoOptions({scale:'lydian'}).scale,'off');
});
test('Kuramoto coupling moves the window from free polyrhythm to synchronized chords',()=>{
  const f=fixture(),stats=K=>{const g=run(f,{mode:'kuramoto',coupling:K,stride:2,voices:8}),events=ticks(g,400).slice(100),heard=events.filter(e=>!e.rest);return {sync:mean(events.map(e=>e.sync)),chord:mean(heard.map(e=>e.voices.length)),rests:events.length-heard.length};};
  const free=stats(0),locked=stats(4);assert.ok(free.sync<.45,`free sync ${free.sync}`);assert.ok(locked.sync>.95,`locked sync ${locked.sync}`);assert.ok(locked.chord>free.chord+2);assert.ok(locked.rests>free.rests);
});
test('Kuramoto natural rates follow f0 ratios: an octave above fires twice as often when uncoupled',()=>{
  const f=fixture(2,1,[],at=>at?200:100),g=run(f,{mode:'kuramoto',coupling:0,stride:2,voices:2},0),fired=[0,0];
  for(const e of ticks(g,800))for(const v of e.voices)fired[v.piece]++;
  assert.ok(Math.abs(fired[1]/fired[0]-2)<.02,`${fired}`);assert.ok(Math.abs(fired[1]-200)<=2,`${fired}`);
});
test('Kuramoto ticks without a crossing are rests, fired cells stay inside the window, and each cell fires at most once a tick',()=>{
  const f=fixture(8,8,[0,1,2,9,10,40]),g=run(f,{mode:'kuramoto',coupling:1.5,stride:8,voices:8});
  for(const e of ticks(g,300)){assert.equal(e.alive.length,16);if(!e.voices.length)assert.ok(e.rest);const cells=e.voices.map(v=>v.y*8+v.x);assert.equal(new Set(cells).size,cells.length);for(const at of cells){assert.ok(e.alive.includes(at));assert.ok(f.map.cells[at].length);}}
});
test('Live coupling changes reach a running Kuramoto player, and seeds stay reproducible',()=>{
  const f=fixture(),g=run(f,{mode:'kuramoto',coupling:0,stride:2});ticks(g,150);const before=mean(ticks(g,100).map(e=>e.sync));g.options=autoOptions({...g.options,coupling:4});ticks(g,100);assert.ok(mean(ticks(g,100).map(e=>e.sync))>before+.3);
  for(const mode of ['kuramoto','standard']){assert.deepEqual(ticks(run(f,{mode,seed:5}),60),ticks(run(f,{mode,seed:5}),60));assert.notDeepEqual(ticks(run(f,{mode,seed:5}),60),ticks(run(f,{mode,seed:6}),60));}
});
test('The standard map stays on regular orbits at low kick and crosses the grid when chaotic',()=>{
  const f=fixture(),cover=(K,boundary)=>{const path=ticks(run(f,{mode:'standard',coupling:K,boundary}),256);return {rows:new Set(path.map(e=>e.y)).size,cells:new Set(path.map(e=>e.y*8+e.x)).size};};
  for(const boundary of ['wrap','bounce']){assert.ok(cover(0,boundary).rows<=2);assert.ok(cover(.2,boundary).rows<=2);const chaos=cover(4,boundary);assert.ok(chaos.rows>=6&&chaos.cells>40,JSON.stringify(chaos));}
  const still=ticks(run(f,{mode:'standard',coupling:0,boundary:'wrap'}),64);assert.equal(new Set(still.slice(1).map(e=>e.y)).size,1);
});
test('Standard-map positions land on occupied cells with holes and respect iterations per tick',()=>{
  const f=fixture(8,7,[0,1,2,3,9,10,33]);for(const boundary of ['wrap','bounce'])for(const e of ticks(run(f,{mode:'standard',coupling:2.5,stride:3,boundary}),200))assert.ok(f.map.cells[e.y*8+e.x].includes(e.piece));
  const one=run(f,{mode:'standard',coupling:1.1,stride:1}),three=run(f,{mode:'standard',coupling:1.1,stride:3});one.next();three.next();for(let i=0;i<3;i++)one.moveStandardMap();three.moveStandardMap();assert.equal(one.q,three.q);assert.equal(one.p,three.p);
});
test('Ratio scales place each grain on an octave-repeating ratio of the root, and unpitched cells stay put',()=>{
  for(const [scale,ratios] of Object.entries(GRID_RATIO_SCALES))for(const root of [97.3,220,261.6255653005986])for(let f=40;f<3000;f*=1.0137){
    const shift=gridScaleTranspose(f,scale,root),landed=f*2**(shift/12)/root,reduced=landed/2**Math.floor(Math.log2(landed)+1e-12);assert.ok([...ratios,2].some(k=>Math.abs(reduced-k)<1e-9||Math.abs(reduced*2-k)<1e-9),`${scale} ${f} → ${reduced}`);
    const steps=[...ratios,2].map(Math.log2),gap=Math.max(...steps.slice(1).map((x,i)=>x-steps[i]));assert.ok(Math.abs(shift)<=6*gap+1e-9);
  }
  assert.equal(gridScaleTranspose(0,'just',220),0);assert.equal(gridScaleTranspose(330,'hexany',0),0);assert.ok(Math.abs(gridScaleTranspose(660,'harmonic',220))<1e-12);assert.ok(Math.abs(gridScaleTranspose(220*7/4,'hexany',220))<1e-12);
  assert.ok(Math.abs(gridScaleTranspose(440*2**(1/12),'major')-(-1))<1e-9);for(const scale of ['toString','constructor'])assert.equal(gridScaleTranspose(300,scale,220),0);
});
test('The ratio root follows the anchor cell, falling back to the median pitched source for unpitched anchors',()=>{
  const f=fixture(4,1,[],at=>[0,150,200,300][at]);assert.equal(gridScaleRoot(f.pieces[2],f.pieces),200);assert.equal(gridScaleRoot(f.pieces[0],f.pieces),200);assert.equal(gridScaleRoot({f0:0},[]),261.6255653005986);
  const g=run(f,{mode:'scan',scale:'just'},3);assert.equal(g.root,300);g.setAnchor(1);assert.equal(g.root,150);const e=g.next();assert.ok(Math.abs(e.voices[0].transpose-gridScaleTranspose(150,'just',150))<1e-12);
});
test('Takes round-trip the new player, coupling, ratio scale and waveset settings; older takes get defaults',()=>{
  const samples=Float32Array.from({length:8192},(_,i)=>.4*Math.sin(2*Math.PI*220*i/48000)),base={name:'Dynamics',sourceName:'Generated',samples,sampleRate:48000,steps:[{piece:0,x:0,y:0}],selection:{piece:0,step:0}};
  const take=makeGridTake({...base,settings:{cut:'waveset',waveset:{repeat:3,drop:4},automation:{mode:'standard',coupling:2.35,scale:'hexany'}}}),again=readGridTake(JSON.parse(JSON.stringify(take)));
  assert.equal(again.settings.cut,'waveset');assert.deepEqual(again.settings.waveset,{repeat:3,drop:4});assert.equal(again.settings.automation.mode,'standard');assert.equal(again.settings.automation.coupling,2.35);assert.equal(again.settings.automation.scale,'hexany');
  const old=makeGridTake({...base,settings:{cut:'period',automation:{mode:'life'}}});assert.equal(old.settings.cut,'period');assert.deepEqual(old.settings.waveset,{repeat:2,drop:0});assert.equal(old.settings.automation.coupling,1);
  assert.equal(makeGridTake({...base,settings:{cut:'granular',waveset:{repeat:9,drop:1}}}).settings.cut,'frame');
});
console.log(`\n${checks} grid dynamics and ratio-scale checks passed.`);
