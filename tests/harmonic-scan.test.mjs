import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CAS,createWorkletSource} from '../engine.js';
import {fft,demoSound} from '../harmonic-grid.js';
import {makeGridTake,renderGridTake} from '../grid-recording.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const SR=48000,N=4096;
// A plain S carrier: no C branch, operators, rules, shaping or effects, one oversampling step.
function plain(values={}){const p=CAS.initPatch();Object.assign(p,{a:1,c:0,b:1,d:1,combine:'sum',quality:1,volume:.8,env:{attack:.001,decay:.001,sustain:1,release:.01}},values);return CAS.sanitize(p);}
const toNote=f=>69+12*Math.log2(f/440);
function render(engine,n,input=()=>0){return Float64Array.from({length:n},(_,i)=>engine.next(input(i)));}
function magnitudes(x,binsPerHarmonic,count=16){const re=Float64Array.from(x.slice(-N)),im=new Float64Array(N);fft(re,im);return Array.from({length:count},(_,k)=>Math.hypot(re[(k+1)*binsPerHarmonic],im[(k+1)*binsPerHarmonic]));}
const target=Float64Array.from({length:16},(_,k)=>k<10?1/(k+1)**1.2:0);

await test('Scan settings are bounded, vectors normalize to unit sum, and silent vectors are ignored',()=>{
  assert.deepEqual(CAS.sanitizeScan(),{enabled:false,blend:.5,motion:.08});assert.deepEqual(CAS.sanitizeScan({enabled:true,blend:7,motion:9}),{enabled:true,blend:1,motion:2});assert.equal(CAS.sanitizeScan({motion:0}).motion,.005);assert.equal(CAS.sanitizeScan({enabled:'yes'}).enabled,false);
  const v=CAS.scanVector([2,1,1,-4,NaN]);assert.ok(Math.abs(v.reduce((s,x)=>s+x,0)-1)<1e-15);assert.equal(v[0],.5);assert.equal(v[3],0);assert.equal(CAS.scanVector(new Float64Array(16)),null);assert.equal(new CAS.Engine(SR).scanTarget([0,0]),false);
});
await test('The harmonic-table recurrence equals the direct sum of sines for every harmonic count',()=>{
  let state=9;const rand=()=>(state=(state*1664525+1013904223)>>>0)/2**32;
  for(let trial=0;trial<200;trial++){const theta=(rand()-.5)*40,amps=Float64Array.from({length:16},rand),k=1+Math.floor(rand()*16);let direct=0;for(let j=0;j<k;j++)direct+=amps[j]*Math.sin((j+1)*theta);assert.ok(Math.abs(CAS.harmonicTable(theta,amps,k)-direct)<1e-12);}
});
await test('With BLEND 1 a held key reproduces the scanned cell’s harmonic magnitudes',()=>{
  const f=SR/N*20,e=new CAS.Engine(SR,plain());e.setScan({enabled:true,blend:1,motion:.005});e.scanTarget(target);e.noteOn('k',toNote(f),1);render(e,SR/2);
  const m=magnitudes(render(e,N),20),unit=CAS.scanVector(target);for(let k=0;k<16;k++)assert.ok(Math.abs(m[k]/m[0]-unit[k]/unit[0])<2e-3,`H${k+1}: ${m[k]/m[0]} vs ${unit[k]/unit[0]}`);
});
await test('Harmonics above 0.45 of the output rate are skipped, so a high key does not alias',()=>{
  const f=SR/N*170,top=Float64Array.from({length:16},(_,k)=>k===0||k===15?1:0),e=new CAS.Engine(SR,plain());e.setScan({enabled:true,blend:1,motion:.005});e.scanTarget(top);e.noteOn('k',toNote(f),1);render(e,SR/4);
  const re=Float64Array.from(render(e,N)),im=new Float64Array(N);fft(re,im);const power=Array.from({length:N/2},(_,i)=>re[i]**2+im[i]**2),fundamental=power[170],rest=power.reduce((s,x,i)=>i===170?s:s+x,0);
  assert.ok(16*f>SR/2);assert.ok(rest<1e-9*fundamental,`${rest/fundamental}`);
});
await test('A new target crossfades linearly over MOTION while the waveform stays continuous',()=>{
  const e=new CAS.Engine(SR,plain()),bright=Float64Array.from({length:16},(_,k)=>k===2?1:0);e.setScan({enabled:true,blend:1,motion:.1});e.noteOn('k',57,1);render(e,4800);
  const before=render(e,960);let steady=0;for(let i=1;i<before.length;i++)steady=Math.max(steady,Math.abs(before[i]-before[i-1]));
  assert.ok(e.scanTarget(bright));const during=render(e,2400);assert.ok(Math.abs(e.scanAmps[0]-.5)<1e-3&&Math.abs(e.scanAmps[2]-.5)<1e-3);render(e,2400);assert.equal(e.scanAmps[0],0);assert.equal(e.scanAmps[2],1);
  let jump=Math.abs(during[0]-before.at(-1));for(let i=1;i<during.length;i++)jump=Math.max(jump,Math.abs(during[i]-during[i-1]));
  const after=render(e,960);let third=0;for(let i=1;i<after.length;i++)third=Math.max(third,Math.abs(after[i]-after[i-1]));assert.ok(jump<=1.05*Math.max(steady,third),`${jump} vs ${steady}/${third}`);
});
await test('BLEND 0 silences keys and leaves the grain path bit-identical to an engine without scan',()=>{
  let state=5;const grains=Float64Array.from({length:12000},()=>((state=(state*1664525+1013904223)>>>0)/2**32-.5)*.6);
  const scanned=new CAS.Engine(SR,plain()),reference=new CAS.Engine(SR,plain());scanned.setScan({enabled:true,blend:0});scanned.noteOn('k',60,1);scanned.scanTarget(target);
  const a=render(scanned,grains.length,i=>grains[i]),b=render(reference,grains.length,i=>grains[i]);assert.deepEqual(a,b);
});
await test('Intermediate BLEND mixes keyed voices by m and grains by 1 − m through the linear output chain',()=>{
  let state=3;const grains=Float64Array.from({length:9600},()=>((state=(state*1664525+1013904223)>>>0)/2**32-.5)*.3);
  const make=(blend,key,input)=>{const e=new CAS.Engine(SR,plain({volume:.5}));e.setScan({enabled:true,blend});e.scanTarget(target);if(key)e.noteOn('k',57,.5);return render(e,grains.length,i=>input?grains[i]:0);};
  const keys=make(1,true,false),only=make(0,false,true);for(const m of [.25,.6]){const mixed=make(m,true,true);for(let i=0;i<mixed.length;i++)assert.ok(Math.abs(mixed[i]-(m*keys[i]+(1-m)*only[i]))<1e-12);}
});
await test('Disabled scan ignores targets, and existing patches render bit-identically',()=>{
  const p=plain({a:.8,c:.5,d:2}),a=new CAS.Engine(SR,p),b=new CAS.Engine(SR,p);a.scanTarget(target);a.setScan({enabled:false,blend:1});a.noteOn('k',60,1);b.noteOn('k',60,1);assert.deepEqual(render(a,6000),render(b,6000));
});
await test('The AudioWorklet applies scan configuration and timed retargets exactly like the offline engine',()=>{
  let Processor;const sandbox={sampleRate:SR,currentTime:0,Float32Array,Float64Array,Int8Array,Math,Number,String,Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:()=>{}};}},registerProcessor:(name,c)=>Processor=c};
  vm.runInNewContext(createWorkletSource(),sandbox);const patch=plain({a:.9,c:.3,d:2}),proc=new Processor(),ref=new CAS.Engine(SR,patch),second=Float64Array.from({length:16},(_,k)=>k===1||k===4?1:0);
  for(const m of [{type:'patch',patch},{type:'scanConfig',config:{enabled:true,blend:.7,motion:.02}},{type:'scanTarget',h:Array.from(target)},{type:'on',id:'k',note:62,velocity:1},{type:'scanTarget',id:'scan:target',h:Array.from(second),when:.05}])proc.port.onmessage({data:m});
  ref.setScan({enabled:true,blend:.7,motion:.02});ref.scanTarget(target);ref.noteOn('k',62,1);
  for(let block=0;block<60;block++){sandbox.currentTime=block*128/SR;const out=new Float32Array(128);proc.process([[Float32Array.from({length:128},(_,i)=>.1*Math.sin(i*.07))]],[[out]]);for(let i=0;i<128;i++){const frame=block*128+i;if(frame===Math.ceil(.05*SR))ref.scanTarget(second);const expected=ref.next(.1*Math.sin(i*.07));assert.ok(Math.abs(out[i]-expected)<2e-8,`${frame}: ${out[i]} vs ${expected}`);}}
  assert.equal(proc.engine.scanAmps[1],.5);
});
await test('Grid WAVs follow the scan blend: grains render at 1 − BLEND and older takes are unchanged',async()=>{
  const samples=demoSound(SR).slice(0,SR),steps=[0,6,12].map(piece=>({piece,x:0,y:0,interval:.2})),take=scan=>makeGridTake({name:'Scan',sourceName:'Generated demo',samples,sampleRate:SR,settings:{clock:5,level:1,scan},selection:{piece:0,step:0},steps});
  const plainTake=take(undefined),scanTake=take({enabled:true,blend:.75,motion:.1,lock:true});assert.deepEqual(plainTake.settings.scan,{enabled:false,blend:.5,motion:.08,lock:false});assert.deepEqual(scanTake.settings.scan,{enabled:true,blend:.75,motion:.1,lock:true});
  const full=(await renderGridTake(plainTake,{yieldTask:async()=>{}})).samples,quarter=(await renderGridTake(scanTake,{yieldTask:async()=>{}})).samples;let peak=0;
  for(let i=0;i<full.length;i++){peak=Math.max(peak,Math.abs(full[i]));assert.ok(Math.abs(quarter[i]-.25*full[i])<2e-7);}assert.ok(peak>1e-3);
});
console.log(`\n${count} harmonic scan checks passed.`);
