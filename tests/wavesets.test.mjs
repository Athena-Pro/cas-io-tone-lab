import assert from 'node:assert/strict';
import {makeCellSamples,cellBufferKey,cellPlayback,wavesetOptions,wavesetSegments} from '../cell-audio.js';
import {FRAME,demoSound} from '../harmonic-grid.js';
import {makeGridTake,renderGridTake} from '../grid-recording.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const sr=48000,sine=(f,n=8192,phase=0)=>Float32Array.from({length:n},(_,i)=>.5*Math.sin(2*Math.PI*f*i/sr+phase));
const piece={id:3,start:2048,end:4096,f0:0,loop:null};
// Frequency from interpolated rising crossings over the middle half of a buffer.
function crossingRate(out){const a=Math.floor(out.length/4),b=Math.floor(out.length*3/4),c=[];for(let i=a+1;i<b;i++)if(out[i-1]<=0&&out[i]>0)c.push(i-1-out[i-1]/(out[i]-out[i-1]));return sr*(c.length-1)/(c.at(-1)-c[0]);}

await test('Waveset options and buffer keys are bounded and distinguish every repeat, drop and length',()=>{
  assert.deepEqual(wavesetOptions(),{repeat:2,drop:0});assert.deepEqual(wavesetOptions({repeat:'3',drop:'5'}),{repeat:3,drop:5});
  for(const bad of [{repeat:0,drop:1},{repeat:9,drop:9},{repeat:NaN,drop:-2}])assert.deepEqual(wavesetOptions(bad),{repeat:2,drop:0});
  const keys=new Set();for(const repeat of [1,2,3,4])for(const drop of [0,2,5])for(const length of [.25,.5,1])keys.add(cellBufferKey(piece,'waveset',length,{repeat,drop}));assert.equal(keys.size,36);
  assert.equal(cellBufferKey(piece,'frame',1,{repeat:4}),cellBufferKey(piece,'frame',1));
});
await test('A waveset runs from one rising zero crossing to the next; complex cycles contain several',()=>{
  const pure=wavesetSegments(sine(220),2048,FRAME);for(const [a,b] of pure)assert.ok(Math.abs(b-a-sr/220)<.01);
  const mixed=Float32Array.from({length:8192},(_,i)=>.4*Math.sin(2*Math.PI*220*i/sr)+.4*Math.sin(2*Math.PI*880*i/sr+.5)),segments=wavesetSegments(mixed,2048,FRAME);
  assert.ok(segments.length>pure.length*1.5);assert.ok(segments.every(([a,b])=>b-a>=4&&b-a<sr/220+1));
});
await test('Repeating wavesets stretches a steady tone without changing its pitch',()=>{
  const source=sine(330),one=makeCellSamples(source,piece,'waveset',1,{repeat:1});
  for(const repeat of [2,3,4]){const out=makeCellSamples(source,piece,'waveset',1,{repeat});assert.ok(Math.abs(out.length/one.length-repeat)<.002*repeat+2/one.length);assert.ok(Math.abs(crossingRate(out)/330-1)<.002);assert.ok(out[0]===0);}
  assert.ok(Math.abs(crossingRate(one)/330-1)<.002);
});
await test('Dropping every Nth waveset shortens the grain by 1/N and keeps the remaining cycles intact',()=>{
  const source=sine(250),all=makeCellSamples(source,piece,'waveset',1,{repeat:1}),segments=wavesetSegments(source,piece.start,FRAME).length;
  for(const drop of [2,3,4,8]){const kept=segments-Math.floor(segments/drop),out=makeCellSamples(source,piece,'waveset',1,{repeat:1,drop});assert.ok(Math.abs(out.length-all.length*kept/segments)<=2,`${drop}: ${out.length}`);assert.ok(Math.abs(crossingRate(out)/250-1)<.002);}
});
await test('Repeat on a complex tone reshapes the cycle, while the output stays finite and windowed',()=>{
  const mixed=Float32Array.from({length:8192},(_,i)=>.4*Math.sin(2*Math.PI*220*i/sr)+.4*Math.sin(2*Math.PI*880*i/sr+.5)),out=makeCellSamples(mixed,piece,'waveset',1,{repeat:2});
  assert.ok(out.every(Number.isFinite));assert.ok(out[0]===0);assert.ok(Math.max(...out.map(Math.abs))<=.8+1e-6);assert.ok(Math.abs(crossingRate(out)/220-1)>.05,'repeated sub-cycles should change the crossing rate');
});
await test('Frames without enough crossings fall back to the ordinary centered grain, including short lengths',()=>{
  for(const length of [.25,.5,1]){const silent=new Float32Array(8192);assert.deepEqual(makeCellSamples(silent,piece,'waveset',length,{repeat:3}),makeCellSamples(silent,piece,'frame',length));}
  const dc=new Float32Array(8192).fill(.3);assert.deepEqual(makeCellSamples(dc,piece,'waveset',1,{repeat:2}),makeCellSamples(dc,piece,'frame',1));
});
await test('Waveset playback duration follows the generated buffer, and long steps loop it like frame grains',()=>{
  const out=makeCellSamples(sine(330),piece,'waveset',1,{repeat:3});
  for(const [length,transpose] of [[1,0],[1,12],[.5,0],[2,-12],[3,0]]){const rule=cellPlayback(piece,'waveset',length,transpose,.05,sr,out.length),rate=2**(transpose/12);assert.ok(Math.abs(rule.duration-out.length/sr/rate*Math.max(1,length))<1e-12);assert.equal(rule.loop,false);assert.equal(rule.exactFrame,length<=1||Number.isInteger(length));}
  assert.equal(cellPlayback(piece,'waveset',1,0,.05,sr).duration,FRAME/sr);
});
await test('Offline waveset takes render every grain for its full stretched duration through the CAS chain',async()=>{
  const samples=demoSound(sr).slice(0,sr),steps=[0,5,10,15].map(p=>({piece:p,x:0,y:0,interval:.25,length:1,gain:1})),take=settings=>makeGridTake({name:'Wavesets',sourceName:'Generated demo',samples,sampleRate:sr,settings:{clock:4,level:1,...settings},selection:{piece:0,step:0},steps});
  const frame=await renderGridTake(take({cut:'frame'}),{yieldTask:async()=>{}}),stretched=await renderGridTake(take({cut:'waveset',waveset:{repeat:4,drop:0}}),{yieldTask:async()=>{}});
  assert.equal(frame.skipped,0);assert.equal(stretched.skipped,0);assert.equal(stretched.scheduled,4);assert.ok(stretched.samples.every(Number.isFinite));
  const energy=(s,a,b)=>{let e=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++)e+=s[i]**2;return e;};
  // A 4× stretched grain still sounds 100 ms after onset, where the 43 ms frame grain has ended.
  assert.ok(energy(stretched.samples,.10,.14)>20*energy(frame.samples,.10,.14));
});
console.log(`\n${count} waveset checks passed.`);
