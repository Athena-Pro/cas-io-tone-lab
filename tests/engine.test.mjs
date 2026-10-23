import assert from 'node:assert/strict';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { CAS,createWorkletSource } from '../engine.js';

let checks=0;
function test(name,fn){fn();checks++;console.log(`ok ${checks} · ${name}`);}
const p=()=>{const patch=CAS.initPatch();patch.env={attack:.002,decay:.002,sustain:1,release:.01};return patch;};
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} versus ${b}`);
function voice(patch,n=4096){const v=new CAS.Voice('test',69,1,48000);v.stage=2;v.env=1;return Float64Array.from({length:n},()=>v.sample(patch));}
function energy(a){return Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);}
function difference(a,b){return energy(a.map((x,i)=>x-b[i]));}

test('Equal-frequency sum is one sinusoid with the predicted amplitude and phase',()=>{
  const patch=p();patch.a=.6;patch.c=.8;patch.b=1;patch.d=1;
  const samples=voice(patch),phase=Math.atan2(.8,.6),R=1;
  samples.forEach((x,i)=>close(x,R*Math.sin(CAS.TAU*440*(i+1)/48000+phase),2e-10));
});
test('Ring mode is the pure product and contains the exact sum/difference terms',()=>{
  const patch=p();patch.a=1;patch.c=1;patch.b=1;patch.d=1.5;patch.combine='ring';
  voice(patch).forEach((x,i)=>{const t=CAS.TAU*440*(i+1)/48000;close(x,.5*(Math.sin(2.5*t)+Math.sin(-.5*t)),1e-10);});
  close(CAS.combine(.5,.25,'ring'),.125);
});
test('Coefficient rotation preserves amplitude and becomes PM for equal frequencies',()=>{
  const patch=p();patch.a=.8;patch.c=0;patch.b=patch.d=1;Object.assign(patch.ops[0],{target:'rotate',depth:1.3,rate:2});
  voice(patch).forEach((x,i)=>{const t=CAS.TAU*440*(i+1)/48000;close(x,.8*Math.sin(t+1.3*Math.sin(2*t)),2e-10);});
});
test('Frequency modulation integrates the instantaneous ratio, including through zero',()=>{
  const patch=p();patch.a=1;patch.c=0;patch.b=.5;Object.assign(patch.ops[0],{target:'b',depth:2,rate:1});let phase=0;
  voice(patch).forEach((x,i)=>{const mod=2*Math.sin(CAS.TAU*440*(i+1)/48000);phase+=440*(.5+mod)/48000;close(x,Math.sin(CAS.TAU*phase),2e-10);});
});
test(`All ${CAS.WAVES.length} functions remain finite and bounded at poles and negative phases`,()=>{
  for(const kind of CAS.WAVES)for(let i=-1000;i<=1000;i++){const value=CAS.wave(kind,i/1000);assert.ok(Number.isFinite(value));assert.ok(Math.abs(value)<=1.00000001,`${kind}: ${value}`);}
  close(CAS.wave('sinc',.5),1);
});
test('Operator six changes sound and can feed another operator without an output destination',()=>{
  const patch=p(),baseline=voice(patch);Object.assign(patch.ops[5],{rate:3,depth:1.2,target:'pmB'});assert.ok(difference(baseline,voice(patch))>.1);
  patch.ops[5].target='off';Object.assign(patch.ops[0],{rate:2,depth:1,target:'pmB',source:5,index:3});
  const chained=voice(patch);patch.ops[0].source=-1;assert.ok(difference(chained,voice(patch))>.1);
});
test('Cyclic and self-PM routes use a causal previous-sample graph without runaway values',()=>{
  const patch=p();patch.feedback=2;patch.cross=4;patch.drive=4;
  for(let i=0;i<6;i++)Object.assign(patch.ops[i],{source:(i+1)%6,index:12,depth:4,target:i%2?'pmB':'pmD',wave:CAS.WAVES[i+5]});
  for(const quality of [1,2,4]){patch.quality=quality;const e=new CAS.Engine(48000,patch);e.noteOn('cycle',96);for(let i=0;i<5000;i++){const x=e.next();assert.ok(Number.isFinite(x)&&Math.abs(x)<=.98);}}
});
test('Independent gate owners at one pitch release separately; panic clears every voice',()=>{
  const e=new CAS.Engine(48000,p());e.noteOn('keyboard',60);e.noteOn('sequence',60);for(let i=0;i<256;i++)e.next();e.noteOff('sequence');for(let i=0;i<800;i++)e.next();assert.equal(e.voices.length,1);assert.equal(e.voices[0].id,'keyboard');e.panic();for(let i=0;i<200;i++)close(e.next(),0);assert.equal(e.voices.length,0);
});
test('Voice allocation is bounded and release reaches silence at each sample-rate multiplier',()=>{
  for(const quality of [1,2,4]){const patch=p();patch.quality=quality;const e=new CAS.Engine(48000,patch);for(let i=0;i<20;i++)e.noteOn(`n${i}`,40+i);assert.equal(e.voices.length,8);for(let i=0;i<1000;i++)e.next();for(const v of e.voices)e.noteOff(v.id);for(let i=0;i<5000;i++)e.next();assert.equal(e.voices.length,0);assert.ok(Math.abs(e.next())<.001);}
});
test('Patch validation bounds malformed values and leaves exactly six operators',()=>{
  const v=CAS.sanitize({a:Infinity,b:1e30,c:'2',quality:100,volume:-3,name:'<script>',env:{attack:0},ops:[{source:80,index:1e10,wave:'evil',depth:NaN}]});assert.equal(v.a,.8);assert.equal(v.b,16);assert.equal(v.c,2);assert.equal(v.volume,0);assert.equal(v.quality,2);assert.equal(v.ops.length,6);assert.equal(v.ops[0].source,5);assert.equal(v.ops[0].index,12);assert.equal(v.ops[0].wave,'sine');assert.equal(v.env.attack,.002);
});
test('Oversampled decimation removes a large out-of-band carrier rather than folding it back',()=>{
  const patch=p();patch.a=1;patch.c=0;patch.b=16;const render=q=>{patch.quality=q;const e=new CAS.Engine(48000,patch);e.noteOn('high',100,1);for(let i=0;i<4000;i++)e.next();return Float64Array.from({length:12000},()=>e.next());};
  const a=energy(render(1)),b=energy(render(4));assert.ok(b<a*.15,`1x ${a}, 4x ${b}`);
});
test('The actual AudioWorklet source renders matching samples and dispatches timed note-off',()=>{
  let Processor;const messages=[];const sandbox={sampleRate:48000,currentTime:0,Float32Array,Float64Array,Math,Number,String,Array,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,c)=>Processor=c};
  vm.runInNewContext(createWorkletSource(),sandbox);
  const proc=new Processor(),patch=p(),ref=new CAS.Engine(48000,patch);proc.port.onmessage({data:{type:'patch',patch}});proc.port.onmessage({data:{type:'on',id:'timed',note:69,velocity:1,when:0}});proc.port.onmessage({data:{type:'off',id:'timed',when:.04}});ref.noteOn('timed',69,1);
  for(let block=0;block<40;block++){sandbox.currentTime=block*128/48000;const out=new Float32Array(128);proc.process([],[ [out] ]);for(let i=0;i<128;i++){const frame=block*128+i;if(frame===1920)ref.noteOff('timed');close(out[i],ref.next(),2e-8);}}
  assert.ok(messages.length>=2);assert.equal(messages[0].y.length,1024);assert.ok(messages[0].rms>0);assert.equal(proc.engine.voices.length,0);
  proc.port.onmessage({data:{type:'on',id:'seq:1',note:60,when:2}});proc.port.onmessage({data:{type:'cancel',prefix:'seq:'}});assert.equal(proc.queue.length,0);
});
test('Eight voices with six active operators render within a desktop reference budget',()=>{
  const patch=p();patch.quality=2;for(let i=0;i<6;i++)Object.assign(patch.ops[i],{target:i%2?'pmD':'pmB',depth:.35,source:(i+1)%6,index:.5});const e=new CAS.Engine(48000,patch);for(let i=0;i<8;i++)e.noteOn(`v${i}`,48+i*3);const start=performance.now();let sum=0;for(let i=0;i<24000;i++)sum+=Math.abs(e.next());const elapsed=performance.now()-start;assert.ok(sum>10);console.log(`   Reference: ${elapsed.toFixed(1)} ms to render 500 ms (desktop Node; not hardware timing)`);assert.ok(elapsed<2000,'Gross performance regression');
});
console.log(`\n${checks} synthesis checks passed.`);
