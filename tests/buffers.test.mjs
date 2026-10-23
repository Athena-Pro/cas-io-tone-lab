import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {CAS,createWorkletSource} from '../engine.js';
let checks=0;const sr=48000;
function test(name,fn){fn();checks++;console.log(`ok ${checks} · ${name}`);}
const close=(x,y,eps=1e-8)=>assert.ok(Math.abs(x-y)<eps,`${x} vs ${y}`);
const sumSquares=a=>a.reduce((s,v)=>s+v*v,0);
function impulse(fx,seconds=2){const b=new CAS.BufferEffects(sr,fx),out=new Float32Array(sr*seconds);for(let i=0;i<out.length;i++)out[i]=b.process(i===0?1:0);return out;}
test('The circular buffer reads causal integer/fractional taps and wraps without reallocating',()=>{
  const b=new CAS.RingBuffer(8),memory=b.data;for(let i=1;i<=100;i++){b.write(i/100);close(b.read(1),i/100,4e-8);if(i>2)close(b.read(1.5),(i-.5)/100,4e-8);}assert.equal(b.data,memory);b.reset();for(const x of b.data)assert.equal(x,0);
});
test('A clean feedback delay produces echoes at the expected positions and geometric amplitudes',()=>{
  const f=CAS.initFX();Object.assign(f.delay,{enabled:true,time:.05,feedback:.5,damping:0,mix:1,mode:'clean'});const x=impulse(f,1),n=.05*sr;
  for(let k=1;k<=12;k++){const at=k*n,mix=1-Math.exp(-(at+1)/(.02*sr));close(x[at],.5**(k-1)*mix,1e-7);assert.equal(x[at-1],0);assert.equal(x[at+1],0);}assert.equal(x[0],1);
});
test('Signed feedback reverses alternating repeats without changing the echo times',()=>{
  const f=CAS.initFX();Object.assign(f.delay,{enabled:true,time:.02,feedback:-.7,damping:0,mix:1,mode:'clean'});const x=impulse(f,1);assert.ok(x[960]>0&&x[1920]<0&&x[2880]>0);close(x[1920],-.7*(1-Math.exp(-1921/960)),1e-7);
});
test('Nested trig loop laws are zero-preserving contractions for every legal drive and blend',()=>{
  for(const mode of CAS.LOOP_MODES)for(const g of [.5,1,4,8])for(const mix of [0,.3,1]){
    assert.equal(CAS.loopShape(0,mode,g,mix),0);
    for(let i=-800;i<=800;i++){const x=i/100,y=CAS.loopShape(x,mode,g,mix);assert.ok(Math.abs(y)<=Math.abs(x)+1e-12);const delta=1e-6;assert.ok(Math.abs(CAS.loopShape(x+delta,mode,g,mix)-y)<=delta*1.0000001);}
  }
});
test('The Hadamard and trig rotation preserve vector energy at every angle',()=>{
  const out=new Float64Array(4);for(let i=0;i<400;i++){const v=[Math.sin(i),Math.cos(i*.31),Math.sin(i*.7),Math.cos(i*.91)],angle=i/400*Math.PI/2;CAS.rotateRoom(...v,Math.cos(angle),Math.sin(angle),out);close(sumSquares(out),sumSquares(v),1e-12);}
});
test('Reverb has a delayed dense tail that decays, and longer nominal decay retains more energy',()=>{
  const f=CAS.initFX();Object.assign(f.reverb,{enabled:true,decay:.6,damping:.2,mix:1,mode:'clean'});const short=impulse(f,4);f.reverb.decay=2.4;const long=impulse(f,4);
  assert.equal(sumSquares(long.slice(1,1200)),0);assert.ok(long.slice(sr/5,sr).filter(x=>Math.abs(x)>1e-7).length>sr*.5);
  assert.ok(sumSquares(long.slice(sr,sr*2))>sumSquares(short.slice(sr,sr*2))*20);
  const early=sumSquares(long.slice(sr/2,sr)),late=sumSquares(long.slice(sr*3,sr*4));console.log(`   Reverb energy, 3–4 s vs 0.5–1 s: ${(10*Math.log10(late/early)).toFixed(1)} dB`);assert.ok(late<early*.001);
});
test('Loop color changes later echoes while leaving the first stored echo unchanged',()=>{
  const f=CAS.initFX();Object.assign(f.delay,{enabled:true,time:.03,feedback:.8,damping:0,mix:1,mode:'clean'});const a=impulse(f,1);Object.assign(f.delay,{mode:'sine-fold',drive:4,color:1});const b=impulse(f,1);assert.equal(a[1440],b[1440]);assert.ok(Math.abs(a[2880]-b[2880])>.1);
});
test('Parallel and serial routing are distinct, and buffers continue after voices have ended',()=>{
  const f=CAS.initFX();Object.assign(f.delay,{enabled:true,time:.06,mix:.7});Object.assign(f.reverb,{enabled:true,decay:.8,mix:.7});const a=impulse(f,2);f.spaceRoute='serial';const b=impulse(f,2);assert.ok(a.some((v,i)=>Math.abs(v-b[i])>.001));
  const p=CAS.initPatch();p.env={attack:.002,decay:.002,sustain:1,release:.01};p.fx=f;const e=new CAS.Engine(sr,p);e.noteOn('n',60);for(let i=0;i<sr/10;i++)e.next();e.noteOff('n');let energy=0;for(let i=0;i<sr/2;i++){const x=e.next();if(i>sr/10)energy+=x*x;}assert.equal(e.voices.length,0);assert.ok(energy>.0001);
});
test('Allocation matches the buffer plan and stays independent of polyphony and oversampling',()=>{
  const b=new CAS.BufferEffects(sr),actual=b.echo.data.byteLength+[...b.room,...b.diffusers].reduce((n,line)=>n+line.data.byteLength,0);assert.equal(CAS.bufferPlan(sr).totalBytes,actual);
  const e=new CAS.Engine(sr),reference=e.effects.buffers.echo.data;for(const poly of [1,8])for(const quality of [1,2,4]){const p=CAS.initPatch();p.poly=poly;p.quality=quality;e.setPatch(p);assert.equal(e.effects.buffers.echo.data,reference);}
  const half=CAS.bufferPlan(22050,2,1,1,1,1);console.log(`   Samples only: browser reserve ${actual} B; 22.05 kHz PCM16 / 1s echo + room ${half.totalBytes} B`);assert.ok(half.totalBytes<55000);assert.equal(CAS.bufferPlan(sr,2,2,8).totalBytes,actual*8);
});
test('Buffer bypass and clear do not leave hidden old tails; panic erases all memories',()=>{
  const f=CAS.initFX();f.delay.enabled=f.reverb.enabled=true;const b=new CAS.BufferEffects(sr,f);for(let i=0;i<sr/2;i++)b.process(i<500?Math.sin(i):0);b.configure(CAS.sanitizeFX({...f,bypass:true}));for(let i=0;i<20;i++)assert.equal(b.process(.123),.123);b.configure(f);for(let i=0;i<sr/2;i++)assert.equal(b.process(0),0);
  const p=CAS.initPatch();p.fx=f;const e=new CAS.Engine(sr,p);e.noteOn('n',60);for(let i=0;i<sr/5;i++)e.next();e.panic();for(let i=0;i<sr/2;i++)assert.equal(e.next(),0);
  for(const line of [e.effects.buffers.echo,...e.effects.buffers.room,...e.effects.buffers.diffusers])assert.ok(line.data.every(x=>x===0));
});
test('Malformed buffer settings are bounded; old patches stay dry; WAV tail estimates are capped',()=>{
  const f=CAS.sanitizeFX({spaceRoute:'evil',delay:{enabled:true,time:99,feedback:99,drive:Infinity,depth:99},reverb:{enabled:true,decay:99,rotation:99,diffusion:99}});assert.equal(f.spaceRoute,'parallel');assert.equal(f.delay.time,1);assert.equal(f.delay.feedback,.95);assert.equal(f.delay.depth,5);assert.equal(f.reverb.decay,8);assert.equal(f.reverb.rotation,Math.PI/2);assert.equal(f.reverb.diffusion,.75);assert.equal(CAS.tailSeconds(f),12);assert.ok(!CAS.sanitize({}).fx.delay.enabled);
  const p=CAS.initFX();assert.equal(CAS.tailSeconds(p),.1);p.reverb.enabled=true;assert.ok(CAS.tailSeconds(p)>p.reverb.decay);
  const initial=CAS.initPatch();initial.fx.delay.time=.015;initial.fx.reverb.size=.4;const e=new CAS.Engine(sr,initial);assert.equal(e.effects.buffers.time,sr*.015);assert.equal(e.effects.buffers.size,.4);
});
test('The live worklet matches offline nested synthesis with both buffers active and supports clearing',()=>{
  let Processor;const sandbox={sampleRate:sr,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(name,c)=>Processor=c};vm.runInNewContext(createWorkletSource(),sandbox);const proc=new Processor(),p=CAS.selectAlgorithm(CAS.initPatch(),6);Object.assign(p.fx.delay,{enabled:true,time:.015,mode:'sine-fold',depth:2});Object.assign(p.fx.reverb,{enabled:true,mode:'sine'});p.fx.spaceRoute='serial';
  const ref=new CAS.Engine(sr,p);ref.noteOn('space',60,.8);proc.port.onmessage({data:{type:'patch',patch:p}});proc.port.onmessage({data:{type:'on',id:'space',note:60,velocity:.8}});
  for(let block=0;block<160;block++){sandbox.currentTime=block*128/sr;const out=new Float32Array(128);proc.process([],[ [out] ]);for(const x of out)close(x,ref.next(),3e-8);}
  const memory=proc.engine.effects.buffers.echo.data;proc.port.onmessage({data:{type:'clearBuffers'}});assert.ok(memory.every(x=>x===0));assert.equal(proc.engine.voices.length,1);
});
test('Worst legal buffer settings stay finite during time/size changes and render within a desktop budget',()=>{
  const p=CAS.selectAlgorithm(CAS.initPatch(),11);p.quality=2;Object.assign(p.fx.delay,{enabled:true,time:1,feedback:.95,damping:0,mode:'sine-fold',drive:8,color:1,depth:5,rate:2,mix:1});Object.assign(p.fx.reverb,{enabled:true,size:1.5,decay:8,damping:0,mode:'sine-fold',drive:8,color:1,mix:1});
  const e=new CAS.Engine(sr,p);for(let i=0;i<8;i++)e.noteOn(`n${i}`,48+i*3);const start=performance.now();for(let i=0;i<24000;i++){if(i===12000){p.fx.delay.time=.005;p.fx.reverb.size=.4;e.setPatch(p);}const x=e.next();assert.ok(Number.isFinite(x)&&Math.abs(x)<=.98);}const elapsed=performance.now()-start;console.log(`   Nested voices + buffers: ${elapsed.toFixed(1)} ms / 500 ms audio (desktop, not FM-1)`);assert.ok(elapsed<2000);
});
console.log(`\n${checks} buffer delay/reverb checks passed.`);
