import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CAS,createWorkletSource} from '../engine.js';
let checks=0;
function test(name,fn){fn();checks++;console.log(`ok ${checks} · ${name}`);}
const close=(x,y,eps=1e-10)=>assert.ok(Math.abs(x-y)<eps,`${x} vs ${y}`);
function patch(){const p=CAS.selectAlgorithm(CAS.initPatch(),6);Object.assign(p.fx.delay,{enabled:true,time:.017,feedback:.7,mix:.7,depth:1.5});Object.assign(p.fx.reverb,{enabled:true,size:.6,decay:.8,mix:.65});return p;}

test('Raw source taps are actual dry and post-return-gain contributions in both buffer routings',()=>{
  for(const route of ['parallel','serial']){const p=patch();p.fx.spaceRoute=route;const b=new CAS.BufferEffects(48000,p.fx);let delay=0,room=0;
    for(let i=0;i<12000;i++){const input=.3*Math.sin(i*.11),output=b.process(input);assert.equal(b.dry,input);close(output,b.dry+b.delayReturn+b.roomReturn);delay+=b.delayReturn**2;room+=b.roomReturn**2;}assert.ok(delay>.1&&room>.1);
    p.fx.delay.mix=p.fx.reverb.mix=0;const muted=new CAS.BufferEffects(48000,p.fx);for(let i=0;i<3000;i++){const x=muted.process(.2);assert.equal(x,.2);close(muted.delayReturn,0);close(muted.roomReturn,0);}
  }
});
test('Displayed contributions sum to the actual output after DC blocking, master changes and limiting',()=>{
  for(const quality of [1,2,4]){const p=patch();p.quality=quality;p.a=2;p.c=2;p.volume=1;p.fx.shaper.enabled=true;p.fx.shaper.drive=8;const e=new CAS.Engine(48000,p);for(let i=0;i<8;i++)e.noteOn(`v${i}`,48+i);
    for(let i=0;i<14000;i++){if(i===7000){p.volume=.2;p.fx.spaceRoute='serial';e.setPatch(p);}const output=e.next();close(output,e.lastDry+e.lastDelay+e.lastRoom,1e-12);for(const v of [e.lastDry,e.lastDelay,e.lastRoom])assert.ok(Number.isFinite(v));}
  }
});
test('Only the delay trace retains energy after dry voices end when the room is disabled',()=>{
  const p=patch();p.stack.enabled=false;p.c=0;p.env={attack:.002,decay:.002,sustain:1,release:.002};p.fx.reverb.enabled=false;p.fx.delay.time=.12;p.fx.delay.feedback=.85;p.fx.delay.mode='clean';p.fx.delay.damping=0;
  const e=new CAS.Engine(48000,p);e.noteOn('n',60);for(let i=0;i<1600;i++)e.next();e.noteOff('n');let dry=0,delay=0;
  for(let i=0;i<60000;i++){e.next();if(i>48000){dry+=e.lastDry**2;delay+=e.lastDelay**2;assert.equal(e.lastRoom,0);}}assert.equal(e.voices.length,0);assert.ok(delay>dry*1000&&delay>.00001);
});
test('Bypass exposes dry alone and panic clears every source and its monitoring filter state',()=>{
  const p=patch();p.fx.bypass=true;const effects=new CAS.TrigEffects(48000,p.fx);for(let i=0;i<1000;i++){const x=Math.sin(i);assert.equal(effects.process(x),x);assert.equal(effects.dry,x);assert.equal(effects.delayReturn,0);assert.equal(effects.roomReturn,0);}
  p.fx.bypass=false;const e=new CAS.Engine(48000,p);e.noteOn('n',60);for(let i=0;i<8000;i++)e.next();e.panic();for(let i=0;i<2000;i++){assert.equal(e.next(),0);assert.equal(e.lastDry,0);assert.equal(e.lastDelay,0);assert.equal(e.lastRoom,0);}
});
test('Worklet source windows carry synchronized dry/delay/room samples matching offline taps',()=>{
  let Processor;const messages=[],sandbox={sampleRate:48000,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,c)=>Processor=c};vm.runInNewContext(createWorkletSource(),sandbox);
  const proc=new Processor(),p=patch(),ref=new CAS.Engine(48000,p),history={dry:[],delay:[],room:[]};ref.noteOn('n',60,.8);proc.port.onmessage({data:{type:'patch',patch:p}});proc.port.onmessage({data:{type:'on',id:'n',note:60,velocity:.8}});
  for(let block=0;block<120;block++){sandbox.currentTime=block*128/48000;const out=new Float32Array(128);proc.process([],[ [out] ]);for(let i=0;i<128;i++){close(out[i],ref.next(),3e-8);history.dry.push(Math.fround(ref.lastDry));history.delay.push(Math.fround(ref.lastDelay));history.room.push(Math.fround(ref.lastRoom));}
    if(messages.length){const m=messages.shift();for(let i=0;i<1024;i++){close(m.y[i],m.dry[i]+m.delay[i]+m.room[i],4e-8);for(const source of ['dry','delay','room'])assert.equal(m[source][i],history[source][history[source].length-1024+i]);}}
  }
});
console.log(`\n${checks} source-vectorscope checks passed.`);
