import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {CAS,createWorkletSource} from '../engine.js';

let checks=0;
function test(name,fn){fn();checks++;console.log(`ok ${checks} · ${name}`);}
const close=(x,y,eps=1e-10)=>assert.ok(Math.abs(x-y)<eps,`${x} vs ${y}`);
const stack=stages=>CAS.sanitizeStack({enabled:true,stages:stages.map(s=>({enabled:true,amount:1,wet:1,source:'none',...s}))});
const run=(x,cfg,{s=.4,c=.3,ops=[.1,.2,.3,.4,.5,.6],previous=.25}={})=>CAS.processStack(x,s,c,ops,previous,cfg);

test('Three nested rules equal the literal composed formula, including a partial-wet last stage',()=>{
  const cfg=CAS.ALGORITHMS[6].stack;
  for(let i=-100;i<=100;i++){const x=i/100,c=.37,s=Math.sin(2.2*x*c),expected=s+.7*(CAS.fold(1.8*s)-s);close(run(x,cfg,{c}),expected);}
});
test('Changing rule order changes the function, rather than mixing parallel results',()=>{
  const a=stack([{rule:'ring',source:'c'},{rule:'sine',amount:2.2}]),b=stack([...a.stages.slice(0,2)].reverse());
  const x=.73,c=.37;close(run(x,a,{c}),Math.sin(2.2*x*c));close(run(x,b,{c}),c*Math.sin(2.2*x));assert.ok(Math.abs(run(x,a,{c})-run(x,b,{c}))>.1);
});
test('Global bypass, empty stacks and zero-wet stages preserve the existing engine exactly',()=>{
  const p=CAS.initPatch(),q=CAS.selectAlgorithm(p,10);q.stack.enabled=false;
  const a=new CAS.Engine(48000,p),b=new CAS.Engine(48000,q);a.noteOn('n',60);b.noteOn('n',60);for(let i=0;i<4096;i++)assert.equal(a.next(),b.next());
  const cfg=stack([{rule:'angle',source:'feedback',wet:0},{rule:'fold',enabled:false}]);for(const x of [-20,-.7,0,1,20])assert.equal(run(x,cfg),x);
});
test('Every side input reads its documented carrier, operator or delayed-output tap',()=>{
  const values={none:0,s:.4,c:.3,op1:.1,op2:.2,op3:.3,op4:.4,op5:.5,op6:.6,feedback:.25};
  for(const source of CAS.STACK_SOURCES)close(run(.2,stack([{rule:'sum',source,amount:.5}])),.2+.5*values[source]);
  const p=CAS.initPatch();p.env.sustain=1;p.c=0;p.stack=stack([{rule:'sum',source:'feedback',amount:.5}]);
  const v=new CAS.Voice('delay',69,1,48000);v.stage=2;v.env=1;let previous=0;
  for(let i=0;i<1000;i++){const expected=p.a*Math.sin(CAS.TAU*440*(i+1)/48000)+.5*previous;close(v.sample(p),expected);previous=CAS.clamp(expected,-4,4);}
});
test('An operator with no direct destination can feed the rule stack on its current internal sample',()=>{
  const p=CAS.initPatch();p.a=p.c=0;p.env.sustain=1;Object.assign(p.ops[5],{target:'off',rate:2,depth:.7});p.stack=stack([{rule:'sum',source:'op6'}]);
  const v=new CAS.Voice('op',69,1,48000);v.stage=2;v.env=1;for(let i=0;i<1000;i++)close(v.sample(p),.7*Math.sin(CAS.TAU*880*(i+1)/48000));
});
test('Selecting each template preserves coefficients, operators, envelope and insert settings',()=>{
  const p=CAS.initPatch();p.a=-.3;p.b=-1.5;p.warpB=.2;p.ops[5].depth=1.7;p.ops[0].source=5;p.fx.shift.enabled=true;p.env.release=2;
  for(let i=0;i<CAS.ALGORITHMS.length;i++){
    const q=CAS.selectAlgorithm(p,i);assert.equal(CAS.algorithmIndex(q),i);assert.equal(q.stack.stages.length,4);
    const withoutAlgorithm=q=>{const {combine,stack,...rest}=q;return rest;};assert.deepEqual(withoutAlgorithm(q),withoutAlgorithm(p));
    if(i>=6){q.stack.stages[0].wet=.37;assert.equal(CAS.algorithmIndex(q),CAS.ALGORITHMS.length);}
  }
  assert.equal(CAS.algorithmIndex(CAS.sanitize({})),0);
});
test('Imports cap depth at four stages and sanitize every rule, source, amount, order and mix',()=>{
  const cfg=CAS.sanitizeStack({enabled:true,stages:Array.from({length:100},(_,i)=>({enabled:true,rule:i===0?'cheby':'invalid',source:'future-stage',amount:999,wet:-1}))});
  assert.equal(cfg.stages.length,4);assert.equal(cfg.stages[0].amount,12);assert.equal(cfg.stages[1].rule,'sine');assert.equal(cfg.stages[1].amount,4);assert.equal(cfg.stages[0].wet,0);assert.equal(cfg.stages[0].source,'none');
  assert.equal(CAS.sanitizeStack({stages:[{rule:'cheby',amount:NaN}]}).stages[0].amount,3);
  assert.deepEqual(CAS.sanitize(JSON.parse(JSON.stringify(CAS.selectAlgorithm(CAS.initPatch(),11)))) .stack,CAS.ALGORITHMS[11].stack);
});
test('All eleven rules stay finite at the zero vector and bounded at extreme legal inputs',()=>{
  for(const rule of CAS.STACK_RULES)for(const amount of rule==='cheby'?[2,3,12]:[0,.7,4])for(const source of ['none','c','feedback']){
    const cfg=stack(Array.from({length:4},()=>({rule,source,amount})));
    for(const x of [-1e6,-8,-.15,0,.15,8,1e6]){const result=run(x,cfg,{c:x,previous:x});assert.ok(Number.isFinite(result)&&Math.abs(result)<=8,`${rule}: ${result}`);}
  }
});
test('All six compound templates run with eight voices, nested PM and every quality setting',()=>{
  for(let a=6;a<CAS.ALGORITHMS.length;a++)for(const quality of [1,2,4]){
    const p=CAS.selectAlgorithm(CAS.initPatch(),a);p.quality=quality;
    p.ops.forEach((op,i)=>Object.assign(op,{target:i%2?'pmB':'pmD',source:(i+1)%6,depth:.5,index:1}));
    const e=new CAS.Engine(48000,p);for(let i=0;i<8;i++)e.noteOn(`n${i}`,45+i*4);
    let energy=0;for(let i=0;i<1200;i++){const x=e.next();assert.ok(Number.isFinite(x)&&Math.abs(x)<=.98);energy+=x*x;}assert.ok(energy>.01);assert.equal(e.voices.length,8);
    e.panic();for(let i=0;i<128;i++)assert.equal(e.next(),0);
  }
});
test('The generated live worklet matches offline rendering with nesting, PM and insert FX combined',()=>{
  let Processor;const sandbox={sampleRate:48000,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor:(name,c)=>Processor=c};
  vm.runInNewContext(createWorkletSource(),sandbox);const proc=new Processor(),p=CAS.selectAlgorithm(CAS.initPatch(),11);
  Object.assign(p.ops[0],{depth:.7,target:'pmB',source:1,index:1.3});Object.assign(p.ops[1],{depth:.5,target:'off',source:2,index:.9});p.ops[2].depth=.6;
  p.stack.stages[3]={enabled:true,rule:'sum',source:'feedback',amount:.2,wet:.4};p.fx.shaper.enabled=p.fx.phaser.enabled=true;
  const ref=new CAS.Engine(48000,p);ref.noteOn('stack',60,.8);proc.port.onmessage({data:{type:'patch',patch:p}});proc.port.onmessage({data:{type:'on',id:'stack',note:60,velocity:.8}});
  for(let block=0;block<64;block++){sandbox.currentTime=block*128/48000;const out=new Float32Array(128);proc.process([],[ [out] ]);for(const x of out)close(x,ref.next(),3e-8);}
});
test('Four active rules and six PM operators retain a usable desktop reference budget',()=>{
  const p=CAS.selectAlgorithm(CAS.initPatch(),11);p.stack.stages[3]={enabled:true,rule:'sum',source:'feedback',amount:.2,wet:1};p.ops.forEach((op,i)=>Object.assign(op,{depth:.5,target:'pmB',source:(i+1)%6,index:1}));
  const e=new CAS.Engine(48000,p);for(let i=0;i<8;i++)e.noteOn(`n${i}`,48+i*3);const start=performance.now();let energy=0;for(let i=0;i<24000;i++)energy+=e.next()**2;
  const elapsed=performance.now()-start;assert.ok(energy>1);console.log(`   Four rules, eight voices: ${elapsed.toFixed(1)} ms / 500 ms audio (desktop Node; not FM-1 timing)`);assert.ok(elapsed<2000,'Gross performance regression');
});
console.log(`\n${checks} nested-algorithm checks passed.`);
