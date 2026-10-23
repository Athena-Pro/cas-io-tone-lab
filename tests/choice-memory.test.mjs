import assert from 'node:assert/strict';
import {GridAutomator,GRID_AUTO_MODES,autoOptions} from '../grid-auto.js';
import {makeGridTake,readGridTake} from '../grid-recording.js';
let checks=0;function test(name,fn){fn();console.log(`ok ${++checks} · ${name}`);}
function fixture(cols=7,rows=7,pool=1){const pieces=[],cells=Array.from({length:cols*rows},()=>[]),locations=new Map();for(let at=0;at<cells.length;at++)for(let m=0;m<pool;m++){const id=pieces.length;pieces.push({id,f0:100+id*7,brightness:1+id/30,h:Float64Array.from({length:16},(_,k)=>k===id%16?1:0)});cells[at].push(id);locations.set(id,{x:at%cols,y:Math.floor(at/cols)});}return {map:{columns:cols,rows,cells,locations},pieces};}
const run=(f,o={},anchor=24)=>new GridAutomator(f.map,f.pieces,o,anchor);
const ticks=(g,n)=>Array.from({length:n},()=>g.next());
// The heard content of an event, without its clock position or bookkeeping.
const heard=e=>({piece:e.piece,rest:e.rest,transpose:e.transpose,voices:e.voices.map(v=>[v.piece,v.transpose])});

test('Memory options are bounded, default to off, and keep an 8-tick loop',()=>{
  const o=autoOptions({});assert.equal(o.repeat,0);assert.equal(o.memory,8);assert.equal(o.lock,false);
  assert.equal(autoOptions({repeat:2}).repeat,1);assert.equal(autoOptions({repeat:-1}).repeat,0);assert.equal(autoOptions({repeat:.333}).repeat,.33);
  assert.equal(autoOptions({memory:0}).memory,1);assert.equal(autoOptions({memory:99}).memory,16);assert.equal(autoOptions({memory:5.6}).memory,6);assert.equal(autoOptions({lock:'yes'}).lock,false);
});
test('REPEAT 0 leaves every player exactly as it was, including seeded draws',()=>{
  const f=fixture(7,6,2);for(const mode of GRID_AUTO_MODES){const a=run(f,{mode,seed:91,repeat:0}),b=run(f,{mode,seed:91});for(let i=0;i<120;i++){const e=a.next();assert.equal(e.replay,false);assert.deepEqual(heard(e),heard(b.generate()));}}
});
test('REPEAT 1 loops the first MEMORY events exactly, across chords, rests and pooled members',()=>{
  const f=fixture(7,7,3);for(const [mode,extra] of [['walk',{}],['life',{voices:4}],['kuramoto',{coupling:1.5,stride:2}],['timbre',{stride:3}]])for(const memory of [1,5,16]){
    const g=run(f,{mode,seed:7,repeat:1,memory,...extra}),events=ticks(g,memory*6),first=events.slice(0,memory).map(heard);
    events.forEach((e,i)=>{assert.deepEqual(heard(e),first[i%memory],`${mode} ${memory} @${i}`);assert.equal(e.replay,i>=memory);assert.equal(e.memorySlot,i%memory);});
  }
  const life=ticks(run(f,{mode:'life',repeat:1,memory:4,voices:4}),40);assert.ok(life.some(e=>e.voices.length>1));const sync=ticks(run(f,{mode:'kuramoto',coupling:0,repeat:1,memory:6}),60);assert.ok(sync.some(e=>e.rest));
});
test('LOCK freezes memory: fresh variations no longer overwrite it, and REPEAT 1 then loops exactly',()=>{
  const f=fixture(),g=run(f,{mode:'walk',seed:3,repeat:.5,memory:8});ticks(g,40);g.options=autoOptions({...g.options,lock:true});const frozen=structuredClone(g.memory);
  const varied=ticks(g,200);assert.deepEqual(g.memory,frozen);assert.ok(varied.some(e=>!e.replay)&&varied.some(e=>e.replay));for(const e of varied)if(e.replay)assert.deepEqual(heard(e),heard({...frozen[e.memorySlot],voices:frozen[e.memorySlot].voices}));
  g.options=autoOptions({...g.options,repeat:1});const loop=ticks(g,32);loop.forEach((e,i)=>assert.deepEqual(heard(e),heard(loop[i%8])));
  g.options=autoOptions({...g.options,lock:false,repeat:0});ticks(g,8);assert.notDeepEqual(g.memory,frozen);
});
test('Intermediate REPEAT replays about that fraction of filled slots and overwrites the rest',()=>{
  for(const repeat of [.25,.5,.75]){const g=run(fixture(),{mode:'walk',seed:11,repeat,memory:8}),events=ticks(g,4000).slice(8),fraction=events.filter(e=>e.replay).length/events.length;assert.ok(Math.abs(fraction-repeat)<.03,`${repeat}: ${fraction}`);}
  const g=run(fixture(),{mode:'walk',seed:11,repeat:.5,memory:4});for(let i=0;i<200;i++){const e=g.next();if(!e.replay)assert.deepEqual(heard({...g.memory[e.memorySlot],voices:g.memory[e.memorySlot].voices}),heard(e));}
});
test('Changing length, stride or density keeps memory; density still gates replays; Clear empties it',()=>{
  const g=run(fixture(),{mode:'walk',seed:5,repeat:1,memory:6});const first=ticks(g,6).map(heard);
  g.options=autoOptions({...g.options,stride:3});const again=ticks(g,6).map(heard);assert.deepEqual(again,first);
  g.options=autoOptions({...g.options,density:0});assert.ok(ticks(g,12).every(e=>e.rest&&e.replay));
  g.options=autoOptions({...g.options,density:16,memory:3});ticks(g,3);assert.equal(g.memoryFill(),3);g.clearMemory();assert.equal(g.memoryFill(),0);assert.equal(g.next().replay,false);
});
test('A new automator (new source, seed or player) starts with empty memory; seeds reproduce replay choices',()=>{
  const f=fixture();assert.equal(run(f,{repeat:1}).memoryFill(),0);
  const a=ticks(run(f,{mode:'walk',seed:21,repeat:.5}),200),b=ticks(run(f,{mode:'walk',seed:21,repeat:.5}),200),c=ticks(run(f,{mode:'walk',seed:22,repeat:.5}),200);
  assert.deepEqual(a,b);assert.notDeepEqual(a.map(e=>e.replay),c.map(e=>e.replay));
});
test('Steering the anchor changes new material while the remembered loop survives',()=>{
  const f=fixture(),g=run(f,{mode:'row',repeat:1,memory:4});const loop=ticks(g,4).map(heard);g.setAnchor(3);assert.deepEqual(ticks(g,8).map(heard),[...loop,...loop]);
  g.options=autoOptions({...g.options,repeat:0});const fresh=ticks(g,4);assert.ok(fresh.every(e=>e.y===0));
});
test('Takes round-trip REPEAT, MEMORY LENGTH and LOCK; older takes default to memory off',()=>{
  const samples=Float32Array.from({length:8192},(_,i)=>.4*Math.sin(2*Math.PI*220*i/48000)),base={name:'Memory',sourceName:'Generated',samples,sampleRate:48000,steps:[{piece:0,x:0,y:0}],selection:{piece:0,step:0}};
  const take=readGridTake(JSON.parse(JSON.stringify(makeGridTake({...base,settings:{automation:{mode:'walk',repeat:.65,memory:12,lock:true}}}))));assert.equal(take.settings.automation.repeat,.65);assert.equal(take.settings.automation.memory,12);assert.equal(take.settings.automation.lock,true);
  const old=makeGridTake({...base,settings:{automation:{mode:'walk'}}});assert.equal(old.settings.automation.repeat,0);assert.equal(old.settings.automation.memory,8);assert.equal(old.settings.automation.lock,false);
});
console.log(`\n${checks} choice memory checks passed.`);
