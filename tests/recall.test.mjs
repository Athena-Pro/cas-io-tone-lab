import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CAS,createWorkletSource} from '../engine.js';
let checks=0;
function test(name,fn){fn();checks++;console.log(`ok ${checks} · ${name}`);}
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} vs ${b}`);
const config=(values={})=>({...CAS.initPatch().recall,align:false,...values});
function filled(values={}){const r=new CAS.BeatRecall(1000,config(values));r.setTempo(120);for(let i=0;i<4000;i++)r.process(Math.sin(i*.031)*.6);return r;}
function finish(r,input=0){for(let i=0;i<2000&&r.capture;i++)r.process(input);assert.equal(r.capture,null);}

test('Streaming crossings count both directions without treating startup or exact-zero plateaus as events',()=>{
  const c=new CAS.CrossingCounter(1000,{hysteresis:.01,gate:0});for(const x of [-1,0,0,1,0,0,-1,0,1])c.next(x);assert.equal(c.up,2);assert.equal(c.down,1);assert.equal(c.stats().total,3);
  const a=new CAS.CrossingCounter(48000,{hysteresis:.0003,gate:.001}),b=new CAS.CrossingCounter(48000,{hysteresis:.0003,gate:.001});for(let start=0;start<48000;start+=128)for(let i=start;i<Math.min(start+128,48000);i++){const x=.5*Math.sin(CAS.TAU*440*i/48000);a.next(x);b.next(x);}assert.deepEqual(a.stats(),b.stats());assert.ok(a.up>=439&&a.up<=440);assert.ok(a.down>=439&&a.down<=440);close(a.stats().intervalMs,1000/440,.03);
});
test('Hysteresis rejects chatter, silence closes the detector, and reset clears accumulated features',()=>{
  const c=new CAS.CrossingCounter(1000,{hysteresis:.01,gate:.02});for(let i=0;i<1000;i++)c.next(i%2?.005:-.005);assert.equal(c.stats().total,0);for(let i=0;i<1000;i++)c.next(.4*Math.sin(CAS.TAU*20*i/1000));assert.ok(c.stats().total>30);assert.ok(c.stats().rms>.1&&c.stats().peak>.3);for(let i=0;i<1000;i++)c.next(0);assert.equal(c.stats().rate,0);assert.equal(c.stats().intervalMs,0);c.reset();assert.equal(c.stats().total,0);assert.equal(c.stats().area,0);
});
test('A capture is the exact earlier beat, copied in bounded chunks while history keeps recording',()=>{
  const r=filled(),start=r.clock-2000,expected=Float32Array.from({length:500},(_,i)=>r.readAbsolute(start+i)),before=r.clock;assert.equal(r.grab(),true);assert.equal(r.clipLength,0);r.process(-.7);assert.ok(r.capture&&r.capture.cursor===32);finish(r,-.7);assert.ok(r.clock>before);assert.equal(r.clipLength,500);assert.deepEqual(r.snapshot().data,expected);assert.equal(r.info.back,4);assert.equal(r.info.bpm,120);assert.ok(r.target);
});
test('Recall OFF retains captured audio through history overwrite; ON replays it rather than grabbing silence',()=>{
  const r=filled();r.grab();finish(r);const expected=r.snapshot().data;r.toggle();for(let i=0;i<8000;i++)r.process(0);assert.equal(r.target,false);assert.deepEqual(r.snapshot().data,expected);assert.ok(r.history.every(x=>x===0));assert.equal(r.toggle(),true);let energy=0;for(let i=0;i<1000;i++)energy+=r.process(0)**2;assert.ok(energy>.1);assert.deepEqual(r.snapshot().data,expected);
});
test('Re-grabbing replaces the pinned audio and the old bank stays intact during the playback crossfade',()=>{
  const r=filled();r.grab();finish(r);for(let i=0;i<4000;i++)r.process(.25);const old=r.snapshot().data,oldBank=r.activeBank;r.grab();finish(r,.25);assert.equal(r.activeBank,1-oldBank);assert.ok(r.banks[r.activeBank].subarray(0,r.clipLength).every(x=>x===.25));assert.deepEqual(r.banks[oldBank].slice(0,old.length),old);assert.ok(r.swap>0);assert.equal(r.grab(),false);for(let i=0;i<r.fade;i++)r.process(0);assert.equal(r.swap,0);
});
test('Capture alignment is bounded to 2 ms and loop boundaries use zero-valued edge fades',()=>{
  const r=filled({align:true});r.grab();finish(r);assert.ok(Math.abs(r.info.shiftMs)<=2);assert.equal(r.clipLength,500);close(r.clipSample(r.activeBank,0,r.clipLength,'loop'),0);close(r.clipSample(r.activeBank,r.clipLength-1,r.clipLength,'loop'),0);
  const a=filled({mode:'once'});a.grab();finish(a);for(let i=0;i<1000;i++)a.process(0);assert.equal(a.target,false);assert.ok(a.clipLength>0);close(a.process(0),0);
});
test('Early capture is refused, source changes rewarm history, and clear releases playback without erasing live notes',()=>{
  const r=new CAS.BeatRecall(1000,config());r.setTempo(40);assert.equal(r.grab(),false);for(let i=0;i<6100;i++)r.process(.2);assert.ok(r.ready());r.grab();finish(r);const clip=r.snapshot().data;r.configure(config({source:'mix'}));assert.equal(r.recorded,0);assert.deepEqual(r.snapshot().data,clip);r.clear();for(let i=0;i<1000;i++)r.process(.1);assert.equal(r.clipLength,0);assert.equal(r.target,false);assert.ok(r.recorded>0);
});
test('An armed crossing count captures exactly after N future rising edges',()=>{
  const p=CAS.initPatch();p.quality=1;p.c=0;p.env={attack:.002,decay:.002,sustain:1,release:.002};p.recall={...config({divisor:4}),back:1};const e=new CAS.Engine(1000,p);e.setTempo(120);e.noteOn('n',57);for(let i=0;i<1000;i++)e.next();const before=e.crossings.dry.up;assert.equal(e.armRecall(),true);for(let i=0;i<1000&&e.crossingArm;i++)e.next();assert.equal(e.crossings.dry.up,before+4);assert.ok(e.recall.capture);for(let i=0;i<100;i++)e.next();assert.ok(e.recall.clipLength>0);e.noteOff('n');let energy=0;for(let i=0;i<600;i++){const out=e.next();close(out,e.lastDry+e.lastDelay+e.lastRoom+e.lastRecall,1e-12);energy+=e.lastRecall**2;}assert.ok(energy>.001);assert.equal(e.voices.length,0);
});
test('Snapshot restore preserves a captured slice and resamples it for offline rendering at another rate',()=>{
  const r=filled();r.grab();finish(r);const snapshot=r.snapshot(),other=new CAS.BeatRecall(2000,config());assert.equal(other.restore(snapshot),true);assert.equal(other.clipLength,r.clipLength*2);for(let i=0;i<other.clipLength;i+=2)close(other.banks[other.activeBank][i],snapshot.data[i/2]);assert.equal(other.target,true);assert.equal(other.restore({data:[1],sampleRate:Infinity}),false);assert.equal(other.restore({data:new Float32Array(5000),sampleRate:1000}),false);
});
test('History allocation persists across quality changes, has a fixed ceiling, and parameters are validated',()=>{
  const p=CAS.sanitize({recall:{back:999,length:999,source:'evil',mix:99,divisor:0,mode:'evil'},crossings:{hysteresis:-1,gate:99}});assert.equal(p.recall.back,4);assert.equal(p.recall.length,1);assert.equal(p.recall.source,'dry');assert.equal(p.recall.mix,1);assert.equal(p.recall.divisor,1);assert.equal(p.crossings.hysteresis,.000001);assert.equal(p.crossings.gate,.1);
  const e=new CAS.Engine(1000),memory=e.recall.history,bytes=e.recall.status().bytes;for(const q of [1,2,4]){const p=CAS.initPatch();p.quality=q;e.setPatch(p);assert.equal(e.recall.history,memory);assert.equal(e.recall.status().bytes,bytes);}assert.equal(bytes,(6250+2*1502)*4);e.panic();assert.equal(e.recall.clipLength,0);assert.equal(e.crossings.dry.up,0);
});
test('Generated worklet matches offline recall, publishes counters/edge markers and exports captured audio',()=>{
  let Processor;const messages=[],sr=48000,sandbox={sampleRate:sr,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,c)=>Processor=c};vm.runInNewContext(createWorkletSource(),sandbox);
  const p=CAS.initPatch();p.recall={...config({back:1,length:.25}),source:'dry'};const proc=new Processor(),ref=new CAS.Engine(sr,p);ref.setTempo(120);ref.noteOn('n',60,.8);proc.port.onmessage({data:{type:'patch',patch:p}});proc.port.onmessage({data:{type:'clock',tempo:120}});proc.port.onmessage({data:{type:'on',id:'n',note:60,velocity:.8}});
  for(let block=0;block<400;block++){if(block===210){proc.port.onmessage({data:{type:'recall',action:'grab'}});assert.equal(ref.recall.grab(),true);}if(block===300)proc.port.onmessage({data:{type:'recallSnapshot',id:7}});sandbox.currentTime=block*128/sr;const out=new Float32Array(128);proc.process([],[ [out] ]);for(const x of out)close(x,ref.next(),3e-8);}
  const scope=messages.filter(m=>m.type==='scope').at(-1);assert.ok(scope.analysis.counts.dry.up>0&&scope.analysis.counts.recall.up>0);assert.ok(scope.edges.dry.some(x=>x!==0));for(let i=0;i<1024;i++)close(scope.y[i],scope.dry[i]+scope.delay[i]+scope.room[i]+scope.recall[i],4e-8);const snap=messages.find(m=>m.type==='recallSnapshot');assert.equal(snap.id,7);assert.ok(snap.snapshot.data.length>0&&snap.snapshot.active);
});
console.log(`\n${checks} crossing/recall checks passed.`);
