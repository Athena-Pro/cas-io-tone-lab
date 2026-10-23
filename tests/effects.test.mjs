import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CAS,createWorkletSource} from '../engine.js';
let checks=0;
const test=(name,fn)=>{fn();console.log(`ok ${++checks} · ${name}`);};
const close=(x,y,eps=1e-9)=>assert.ok(Math.abs(x-y)<eps,`${x} vs ${y}`);
function amplitude(x,hz,sr=48000){let re=0,im=0;for(let i=0;i<x.length;i++){const p=CAS.TAU*hz*i/sr;re+=x[i]*Math.cos(p);im-=x[i]*Math.sin(p);}return Math.hypot(re,im)*2/x.length;}
function render(fx,hz=1000,count=48000){const effects=new CAS.TrigEffects(48000,fx,2);let at=0;for(;at<4800;at++)effects.process(Math.cos(CAS.TAU*hz*at/48000));return Float64Array.from({length:count},()=>effects.process(Math.cos(CAS.TAU*hz*at++/48000)));}
test('Neutral phase warp is identity; extreme pivots stay continuous, monotone and periodic',()=>{
  for(const pivot of [.05,.17,.5,.82,.95]){let previous=-1;for(let i=0;i<10000;i++){const p=i/10000,v=CAS.warpPhase(p,pivot);assert.ok(v>=previous&&v>=0&&v<1);previous=v;if(pivot===.5)close(v,p);}close(CAS.warpPhase(pivot,pivot),.5);close(CAS.warpPhase(-.1,pivot),CAS.warpPhase(.9,pivot));}
});
test('Phase distortion changes the voice and its bypass restores the unwarped voice',()=>{
  const p=CAS.initPatch();p.c=0;p.env.sustain=1;const read=p=>{const v=new CAS.Voice('p',69,1,48000);v.stage=2;v.env=1;return Float64Array.from({length:2000},()=>v.sample(p));};const original=read(p);p.warpB=.17;const warped=read(p);assert.ok(original.some((x,i)=>Math.abs(x-warped[i])>.5));p.phaseEnabled=false;read(p).forEach((x,i)=>close(x,original[i]));
});
test('New harmonic waveforms equal their finite analytic sums, including removable-pole phases',()=>{
  for(let i=0;i<=2000;i++){const p=i/2000,t=CAS.TAU*p;let stack=0,norm=0,comb=1,pulse=0;for(let k=1;k<=12;k++){const w=.72**(k-1);stack+=w*Math.sin(k*t);norm+=w;}for(let k=1;k<=6;k++)comb+=2*Math.cos(k*t);for(let k=1;k<8;k++)pulse+=2*(1-k/8)*Math.cos(k*t);close(CAS.wave('harmonics',p),stack/norm,1e-10);close(CAS.wave('dirichlet',p),comb/13,1e-10);close(CAS.wave('fejer',p),pulse/7,1e-10);}
});
test('Sine folding and Chebyshev shaping follow their equations without self-generating DC',()=>{
  const cfg=CAS.initFX().shaper;
  for(const mode of ['sine','cosine','cheby'])for(const bias of [-.4,0,.4]){cfg.mode=mode;cfg.bias=bias;for(let i=-100;i<=100;i++){const y=CAS.trigShape(i/100,cfg);assert.ok(Number.isFinite(y)&&Math.abs(y)<=1.00000001);}close(CAS.trigShape(0,cfg),0);}
  Object.assign(cfg,{mode:'sine',bias:0,drive:4});for(let i=-100;i<=100;i++)close(CAS.trigShape(i/100,cfg),Math.sin(4*i/100));
  Object.assign(cfg,{mode:'cheby',bias:0,drive:1,order:3});for(let i=0;i<1000;i++){const t=i/1000*CAS.TAU;close(CAS.trigShape(Math.sin(t),cfg),-Math.sin(3*t),1e-12);}
});
test('All insert effects off or globally bypassed are bit-exact passthrough',()=>{
  const fx=CAS.initFX(),e=new CAS.TrigEffects(48000,fx);for(let i=0;i<1000;i++){const x=Math.sin(i);assert.equal(e.shape(x),x);assert.equal(e.process(x),x);}
  for(const key of ['shaper','mod','shift','phaser'])fx[key].enabled=true;fx.bypass=true;e.configure(fx);for(let i=0;i<1000;i++){const x=Math.sin(i);assert.equal(e.shape(x),x);assert.equal(e.process(x),x);}
});
test('Ring insert produces equal sum/difference sidebands and suppresses the dry carrier',()=>{
  const fx=CAS.initFX();Object.assign(fx.mod,{enabled:true,mode:'ring',rate:125,depth:1,mix:1});const x=render(fx);close(amplitude(x,1125),.5,1e-6);close(amplitude(x,875),.5,1e-6);assert.ok(amplitude(x,1000)<1e-6);
});
test('Tremolo keeps a nonnegative gain and cannot amplify its input',()=>{
  const fx=CAS.initFX();Object.assign(fx.mod,{enabled:true,mode:'tremolo',rate:5,depth:1,mix:1});const e=new CAS.TrigEffects(48000,fx);for(let i=0;i<20000;i++){const x=Math.cos(i*.37),y=e.process(x);assert.ok(x*y>=-1e-14);assert.ok(Math.abs(y)<=Math.abs(x)+1e-12);}
});
test('Hilbert SSB shifts up/down with image rejection, while zero shift is an aligned delay',()=>{
  const fx=CAS.initFX();Object.assign(fx.shift,{enabled:true,hz:125,mix:1});let x=render(fx);const up=amplitude(x,1125),image=amplitude(x,875);assert.ok(up>.99);assert.ok(image/up<.005);console.log(`   1 kHz + 125 Hz: unwanted image ${Math.round(20*Math.log10(image/up))} dB relative`);
  fx.shift.hz=-125;x=render(fx);assert.ok(amplitude(x,875)>.99);assert.ok(amplitude(x,1125)/amplitude(x,875)<.005);
  fx.shift.hz=0;x=render(fx);x.forEach((v,i)=>close(v,Math.cos(CAS.TAU*1000*(i+4800-127)/48000),2e-10));
});
test('Stationary allpass chain has unity magnitude; dry/wet mix creates the predicted notch',()=>{
  const fx=CAS.initFX();Object.assign(fx.phaser,{enabled:true,rate:0,depth:0,center:800,mix:1});close(amplitude(render(fx),1000),1,1e-6);
  fx.phaser.mix=.5;const t=Math.tan(Math.PI*800/48000),notch=48000/Math.PI*Math.atan(t*Math.tan(Math.PI/8));const x=render(fx,notch);const rms=Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);assert.ok(rms<.0001,`${notch} Hz notch: ${rms}`);console.log(`   Fixed 800 Hz allpass center: first notch ${notch.toFixed(1)} Hz`);
});
test('Effects preserve old patches, bound malformed parameters and stop every tail on panic',()=>{
  const old=CAS.sanitize({a:.8,b:1,c:.55,d:2,ops:[]});assert.equal(old.warpB,.5);assert.ok(!old.fx.shift.enabled);
  const bad=CAS.sanitize({fx:{shift:{enabled:true,hz:Infinity,feedback:100},phaser:{enabled:true,center:-1,depth:100},shaper:{enabled:true,order:999,mix:7}}});assert.equal(bad.fx.shift.feedback,.65);assert.equal(bad.fx.phaser.center,40);assert.equal(bad.fx.shaper.order,12);assert.equal(bad.fx.shaper.mix,1);
  const modes=CAS.sanitizeFX({shaper:{mode:'cheby',bias:3},mod:{mode:'tremolo',rate:2000}});assert.equal(modes.shaper.bias,1);assert.equal(modes.mod.rate,30);
  const p=CAS.initPatch();for(const key of ['shaper','mod','shift','phaser'])p.fx[key].enabled=true;p.fx.shift.feedback=.65;p.warpB=.05;const e=new CAS.Engine(48000,p);e.noteOn('test',72);for(let i=0;i<12000;i++){const y=e.next();assert.ok(Number.isFinite(y)&&Math.abs(y)<=.98);}e.panic();for(let i=0;i<1000;i++)assert.equal(e.next(),0);
});
test('Live worklet and offline engine match with phase warp and all inserts active',()=>{
  let Processor;const sandbox={sampleRate:48000,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(name,c)=>Processor=c};
  vm.runInNewContext(createWorkletSource(),sandbox);const proc=new Processor(),p=CAS.initPatch();p.warpB=.17;for(const k of ['shaper','mod','shift','phaser'])p.fx[k].enabled=true;p.ops[0]={...p.ops[0],wave:'fejer',depth:.3,target:'out'};
  const ref=new CAS.Engine(48000,p);ref.noteOn('fx',60,.8);proc.port.onmessage({data:{type:'patch',patch:p}});proc.port.onmessage({data:{type:'on',id:'fx',note:60,velocity:.8}});
  for(let block=0;block<64;block++){sandbox.currentTime=block*128/48000;const out=new Float32Array(128);proc.process([],[ [out] ]);for(const x of out)close(x,ref.next(),3e-8);}
});
console.log(`\n${checks} trigonometric synthesis/effects checks passed.`);
