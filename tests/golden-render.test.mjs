import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {CAS} from '../engine.js';
import {demoSound} from '../harmonic-grid.js';
import {makeGridTake,renderGridTake} from '../grid-recording.js';

// Deterministic renders of canonical patches and grid takes. Any DSP edit that
// changes a single output bit fails here; refresh deliberately with
// `npm run golden:update` and explain the audible change in the commit.
// V8 computes Math.sin/cos/tanh/exp with its own portable library, so x64 hosts
// must match bit for bit. Other architectures may contract multiply-adds inside
// that library; there, block RMS within a tight tolerance is accepted instead.
const UPDATE=process.argv.includes('--update'),EXACT=process.arch==='x64',SR=48000,BLOCKS=32;
const fixtureURL=new URL('./fixtures/golden-renders.json',import.meta.url);
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const patch=(values={},edit=()=>{})=>{const p=Object.assign(CAS.initPatch(),values);edit(p);return CAS.sanitize(p);};
const op=(p,i,values)=>Object.assign(p.ops[i],values);
const fx=(p,values)=>{for(const [key,v] of Object.entries(values))p.fx[key]=typeof v==='object'?{...p.fx[key],...v}:v;};
const env={attack:.004,decay:.12,sustain:.6,release:.12};

const synthCases=[
  ['init',CAS.initPatch()],
  ...CAS.ALGORITHMS.map((a,i)=>[`algorithm-${a.id}`,CAS.selectAlgorithm(patch({env}),i)]),
  ['operator-network',patch({env,a:.7,c:.4,b:1,d:2},p=>{
    op(p,0,{wave:'sine',rate:2,depth:.6,target:'pmB'});op(p,1,{wave:'triangle',rate:3,depth:.4,target:'a',source:0,index:2});
    op(p,2,{wave:'tan',rate:1,depth:.2,target:'out'});op(p,3,{wave:'sine',mode:'hz',rate:5,depth:.5,target:'rotate'});
    op(p,4,{wave:'harmonics',rate:.5,depth:.3,target:'fold',decay:.4});op(p,5,{wave:'fejer',rate:1,depth:.2,target:'warpB'});})],
  ['insert-effects',patch({env,a:.8,c:.5,b:1,d:3},p=>fx(p,{shaper:{enabled:true,mode:'cheby',order:3,mix:.6},mod:{enabled:true,mode:'ring',rate:30,mix:.5},
    shift:{enabled:true,hz:40,mix:.7},phaser:{enabled:true,rate:.5,mix:.5}}))],
  ['buffer-space-serial',patch({env,a:.8,c:.5,b:1,d:2,feedback:.3,cross:.2,quality:4,bits:10,drive:.5},p=>fx(p,{spaceRoute:'serial',
    delay:{enabled:true,time:.11,feedback:.5,mix:.4,mode:'sine-fold'},reverb:{enabled:true,size:.8,decay:1.6,mix:.35,mode:'sine'}}))],
  ['beat-recall',patch({env,a:.8,c:.5,b:1,d:2,recall:{back:1,length:.5,mix:.7,source:'dry',mode:'loop',align:true,divisor:64,triggerSource:'dry'}}),{tempo:240,grabAt:.3}]
];

function renderSynth(p,{tempo=110,grabAt=null}={}){
  const engine=new CAS.Engine(SR,p),out=new Float32Array(Math.round(SR*.6)),release=Math.round(SR*.35),grab=grabAt===null?-1:Math.round(SR*grabAt);
  engine.setTempo(tempo);engine.noteOn('low',57,.9);engine.noteOn('high',64,.7);
  for(let i=0;i<out.length;i++){if(i===release){engine.noteOff('low');engine.noteOff('high');}if(i===grab)assert.ok(engine.recall.grab(),'Recall capture should start');out[i]=engine.next();}
  return out;
}
async function renderTake(cut,options={}){
  const samples=demoSound(SR).slice(0,Math.round(SR*1.5)),configuration={patch:patch({},p=>fx(p,{delay:{enabled:true,time:.09,feedback:.3,mix:.25}})),tempo:120};
  const steps=[0,9,18,27,36,45,54].map((piece,i)=>({piece,x:0,y:0,gain:.9,length:i%3?1:.5,transpose:i%2?-3:0,interval:.05+.01*i}));
  steps.push({piece:12,x:0,y:0,gain:.8,length:1,transpose:0,interval:.06,voices:[{piece:12,transpose:0,x:0,y:0},{piece:30,transpose:7,x:0,y:0}]});
  const take=makeGridTake({name:`Golden ${cut}`,sourceName:'Generated demo',samples,sampleRate:SR,settings:{cut,clock:24,timing:'recorded',level:1,...options},configuration,selection:{piece:0,step:0,output:'audio'},steps});
  return (await renderGridTake(take,{yieldTask:async()=>{}})).samples;
}
const gridCases=[['grid-frame',()=>renderTake('frame')],['grid-period',()=>renderTake('period')],['grid-waveset',()=>renderTake('waveset',{waveset:{repeat:3,drop:4}})]];

function fingerprint(samples){
  const blocks=Array.from({length:BLOCKS},(_,b)=>{const start=Math.floor(b*samples.length/BLOCKS),end=Math.floor((b+1)*samples.length/BLOCKS);let sum=0;for(let i=start;i<end;i++)sum+=samples[i]**2;return Math.sqrt(sum/Math.max(1,end-start));});
  let peak=0,sum=0;for(const x of samples){peak=Math.max(peak,Math.abs(x));sum+=x*x;}
  return {sha256:createHash('sha256').update(new Uint8Array(samples.buffer,samples.byteOffset,samples.byteLength)).digest('hex'),samples:samples.length,rms:Math.sqrt(sum/samples.length),peak,blocks};
}
const renders={};
for(const [name,p,options] of synthCases)renders[name]=fingerprint(renderSynth(p,options));
for(const [name,render] of gridCases)renders[name]=fingerprint(await render());

if(UPDATE){
  await writeFile(fixtureURL,JSON.stringify({format:'cas-golden-renders',version:1,sampleRate:SR,renders},null,1)+'\n');
  console.log(`Wrote ${Object.keys(renders).length} golden renders to tests/fixtures/golden-renders.json.`);process.exit(0);
}
const golden=JSON.parse(await readFile(fixtureURL,'utf8')).renders;
function compare(names){
  const failures=[];
  for(const name of names){
    const now=renders[name],then=golden[name];
    if(!then){failures.push(`${name}: no golden render (run npm run golden:update)`);continue;}
    if(now.sha256===then.sha256)continue;
    const close=now.samples===then.samples&&now.blocks.every((x,i)=>Math.abs(x-then.blocks[i])<=1e-6+1e-4*then.blocks[i]);
    if(EXACT||!close)failures.push(`${name}: sha256 ${now.sha256.slice(0,12)} ≠ ${then.sha256.slice(0,12)}, rms ${now.rms.toPrecision(9)} vs ${then.rms.toPrecision(9)}, peak ${now.peak.toPrecision(9)} vs ${then.peak.toPrecision(9)}`);
    else console.log(`  note · ${name} differs bitwise on ${process.arch} but matches the block-RMS fingerprint`);
  }
  assert.deepEqual(failures,[],`Golden renders changed:\n${failures.join('\n')}`);
}

await test('Golden fixture covers every algorithm and each render is finite, audible and bounded',()=>{
  for(const a of CAS.ALGORITHMS)assert.ok(renders[`algorithm-${a.id}`]);assert.equal(Object.keys(golden).length,Object.keys(renders).length);
  for(const [name,r] of Object.entries(renders)){assert.ok(Number.isFinite(r.rms)&&r.rms>1e-3,`${name} is silent`);assert.ok(r.peak<=.98+1e-9,`${name} exceeds the limiter`);}
});
await test('Synth patch renders match their golden PCM hashes',()=>compare(synthCases.map(([name])=>name)));
await test('Grid take renders match their golden PCM hashes',()=>compare(gridCases.map(([name])=>name)));
console.log(`\n${count} golden render checks passed.`);
