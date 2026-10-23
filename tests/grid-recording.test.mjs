import assert from 'node:assert/strict';
import {CAS} from '../engine.js';
import {analyzeFrame,mapPieces,makePattern,FRAME,representativeId} from '../harmonic-grid.js';
import {GridAutomator,seededRandom} from '../grid-auto.js';
import {cellBufferKey,makeCellSamples} from '../cell-audio.js';
import {readAudioDuration} from '../audio-file.js';
import {makeGridTake,readGridTake,takeSource,harmonicPreset,renderGridTake,encodeTakeWav} from '../grid-recording.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const noYield=async()=>{},sr=48000,source=Float32Array.from({length:8192},(_,i)=>.4*Math.sin(2*Math.PI*240*i/sr)),base={name:'Test take',sourceName:'Generated tone',samples:source,sampleRate:sr,configuration:{patch:CAS.initPatch(),tempo:123,navigation:{page:'ops',view:'xy',opIndex:5}},settings:{clock:10,capacity:64,level:.5},selection:{piece:2,step:0,output:'navigation'},steps:[{piece:0,gain:.7,length:.5,transpose:0,interval:.1}]};
const take=extra=>makeGridTake({...base,...extra}),energy=a=>a.reduce((s,x)=>s+x*x,0);
await test('RMS-normalized rumble sweep: eight independent phases by four frame positions, including +4 dB at 40/45 Hz',()=>{
  const starts=[0,1024,4096,8192],rms=a=>Math.sqrt(energy(a)/a.length);
  for(const [f,rumble,db] of [[220,25,-2],[220,25,4],[330,40,-2],[330,40,4],[440,45,4]]){
    const tone=Float32Array.from({length:sr},(_,i)=>{let x=0;for(let k=1;k<=16;k++)x+=Math.sin(2*Math.PI*f*k*i/sr)/k;return x;}),toneRms=rms(tone);
    for(let phase=0;phase<8;phase++){
      const low=Float32Array.from({length:sr},(_,i)=>Math.sin(2*Math.PI*rumble*i/sr+phase*Math.PI/4)),lowRms=rms(low),scaledTone=Float32Array.from(tone,x=>.2*x/toneRms),scaledLow=Float32Array.from(low,x=>.2*10**(db/20)*x/lowRms),signal=Float32Array.from(scaledTone,(x,i)=>x+scaledLow[i]),before=signal.slice();
      assert.ok(Math.abs(20*Math.log10(rms(scaledLow)/rms(scaledTone))-db)<1e-5);
      for(const start of starts){const p=analyzeFrame(signal,sr,start);assert.ok(Math.abs(p.f0/f-1)<.01,`${f}+${rumble}, RMS ${db}dB, phase ${phase}, frame ${start}: ${p.f0}`);}
      assert.deepEqual(signal,before);
    }
  }
});
await test('Clean 62–3000 Hz sine and saw pitches survive the rumble cutoff across phases and frame positions',()=>{
  for(const harmonics of [1,16])for(const f of [62,65,82.4,110,220,330,440,880,2093,3000])for(const phase of [0,.7]){
    const signal=Float32Array.from({length:sr},(_,i)=>{let x=0;for(let k=1;k<=Math.min(harmonics,Math.floor((sr/2-1)/f));k++)x+=Math.sin(k*(2*Math.PI*f*i/sr+phase))/k;return x*.2;});
    for(const start of [0,1024,4096,8192]){const p=analyzeFrame(signal,sr,start);assert.ok(Math.abs(p.f0/f-1)<.01,`${harmonics} partials, ${f}Hz, phase ${phase}, ${start}: ${p.f0}`);}
  }
});
await test('Unpitched period fallback buffers key every window length, while true period loops share their raw buffer',()=>{
  const p={id:7,start:0,loop:null};assert.notEqual(cellBufferKey(p,'period',.25),cellBufferKey(p,'period',1));assert.notEqual(cellBufferKey(p,'frame',.25),cellBufferKey(p,'frame',1));
  p.loop={start:0,end:1000};assert.equal(cellBufferKey(p,'period',.25),cellBufferKey(p,'period',4));
});
await test('Pooled static patterns choose seeded members throughout the pool, and middle representatives drive similarity',()=>{
  const pieces=Array.from({length:512},(_,id)=>({id,f0:110+id,brightness:id/32,h:Float64Array.from({length:16},(_,k)=>k===id%16?1:0)})),map=mapPieces(pieces,'balanced',64);
  assert.equal(representativeId([1,2,3,4,5]),3);
  for(const mode of ['row','walk','knight']){const path=makePattern(map,pieces,mode,1024,{x:0,y:0},seededRandom(123));assert.deepEqual(path,makePattern(map,pieces,mode,1024,{x:0,y:0},seededRandom(123)));assert.ok(path.some(s=>map.cells[s.y*map.columns+s.x][0]!==s.piece));if(mode!=='row')assert.ok(new Set(path.map(s=>s.piece)).size>100);}
  const ps=Array.from({length:9},(_,id)=>({id,f0:220,h:new Float64Array([id===1?1:id===4?.99:0,0])})),m={columns:3,rows:1,cells:[[0,1,2],[3,4,5],[6,7,8]]},g=new GridAutomator(m,ps,{mode:'timbre'},0);g.random=()=>0;g.next();assert.equal(g.next().x,1);
});
function sparse(){const cells=Array.from({length:81},()=>[]),pieces=[0,40,80].map((at,id)=>{cells[at]=[id];return {id,f0:220,h:new Float64Array([1,0])};});return {map:{columns:9,rows:9,cells},pieces};}
await test('Walk and knight escape isolated occupied cells deterministically',()=>{const f=sparse();for(const mode of ['walk','knight']){const a=new GridAutomator(f.map,f.pieces,{mode,seed:17}),b=new GridAutomator(f.map,f.pieces,{mode,seed:17}),path=Array.from({length:30},()=>a.next());assert.equal(new Set(path.map(p=>p.piece)).size,3);assert.deepEqual(path,Array.from({length:30},()=>b.next()));}});
await test('Extinct sparse Life reseeds different occupied areas rather than repeating the anchor forever',()=>{const f=sparse(),g=new GridAutomator(f.map,f.pieces,{mode:'life',seed:17});assert.equal(new Set(Array.from({length:30},()=>g.next().piece)).size,3);});
await test('Unknown WebM metadata uses a bounded probe seek, then cleans up when real duration appears',async()=>{let sought=false,revoked=0;const element={duration:Infinity,removeAttribute(){},load(){},set src(v){queueMicrotask(()=>this.onloadedmetadata());},set currentTime(v){assert.equal(v,1e7);sought=true;this.duration=2.4;queueMicrotask(()=>this.ondurationchange?.());}};assert.equal(await readAudioDuration({}, {createAudio:()=>element,createURL:()=> 'blob:webm',revokeURL:()=>revoked++}),2.4);assert.ok(sought);assert.equal(revoked,1);assert.equal(element.onseeked,null);assert.equal(element.ontimeupdate,null);});
await test('An unresolved metadata seek times out and cleans up instead of decoding an unbounded source',async()=>{let revoked=0;const element={duration:Infinity,removeAttribute(){},load(){},set src(v){queueMicrotask(()=>this.onloadedmetadata?.());}};await assert.rejects(readAudioDuration({}, {createAudio:()=>element,createURL:()=> 'blob:unknown',revokeURL:()=>revoked++,timeoutMs:5}),/timed out/);assert.equal(revoked,1);assert.equal(element.onloadedmetadata,null);});
await test('Take JSON round-trips exact Float32 source, fractional timing, chord/rest score, configuration and selection',()=>{
  const steps=[...base.steps,{piece:1,gain:.8,length:2,transpose:3,interval:.137,rest:true,voices:[{piece:1,transpose:-1},{piece:2,transpose:2}],normalization:2}],t=take({steps}),restored=readGridTake(JSON.parse(JSON.stringify(t)));
  assert.deepEqual(restored,t);assert.deepEqual(takeSource(restored).samples,source);assert.equal(restored.steps[1].interval,.137);assert.equal(restored.configuration.tempo,123);assert.equal(restored.configuration.navigation.opIndex,5);assert.equal(restored.selection.output,'navigation');
});
await test('Take imports reject missing frames, malformed PCM, excessive voices and invalid intervals before playback',()=>{
  const t=take();for(const mutate of [t=>t.steps[0].piece=999,t=>t.source.data='short',t=>t.source.samples=1e9,t=>t.source.sampleRate=1,t=>t.steps[0].interval=-1,t=>t.steps[0].voices=Array(9).fill({piece:0})]){const v=structuredClone(t);mutate(v);assert.throws(()=>readGridTake(v));}
  const bad=source.slice();bad[0]=NaN;assert.throws(()=>take({samples:bad}));
});
await test('Legacy v2 scores require their matching source and migrate timing into a portable take',()=>{const legacy={format:'cas-harmonic-score',version:2,source:base.sourceName,sourceSamples:source.length,sampleRate:sr,clock:10,steps:base.steps};assert.throws(()=>readGridTake(legacy),/matching source/);const t=readGridTake(legacy,{legacySource:base});assert.equal(t.version,3);assert.equal(t.steps[0].interval,.1);assert.deepEqual(takeSource(t).samples,source);});
await test('Generated presets fit the eight strongest measured harmonics and report retained energy accurately',()=>{
  const h=Float64Array.from({length:16},(_,i)=>(i+1)/136),p={f0:187.5,h},result=harmonicPreset(p,'test'),patch=result.patch;
  assert.equal(result.harmonics.length,8);assert.deepEqual(result.harmonics.map(x=>x.harmonic),[16,15,14,13,12,11,10,9]);assert.ok(Math.abs(result.retained-h.slice(8).reduce((s,x)=>s+x*x,0)/energy(h))<1e-12);
  const voice=new CAS.Voice('test',result.note,1,sr);for(let i=0;i<4096;i++)voice.sample(patch);const out=Float64Array.from({length:8192},()=>voice.sample(patch)),sum=result.harmonics.reduce((s,p)=>s+p.amplitude,0);
  for(const partial of result.harmonics){let sin=0,cos=0;for(let i=0;i<out.length;i++){sin+=out[i]*Math.sin(2*Math.PI*p.f0*partial.harmonic*i/sr);cos+=out[i]*Math.cos(2*Math.PI*p.f0*partial.harmonic*i/sr);}assert.ok(Math.abs(2*Math.hypot(sin,cos)/out.length-partial.amplitude/sum)<1e-8);}
});
await test('Unpitched or empty harmonic vectors cannot become misleading synth presets',()=>{assert.throws(()=>harmonicPreset({f0:0,h:new Float64Array(16)}),/pitched/);assert.throws(()=>harmonicPreset({f0:220,h:new Float64Array(16)}),/no measured/);});
await test('Offline short-grain samples pass through the same CAS DSP as the corresponding live input',async()=>{
  const t=take(),rendered=await renderGridTake(t,{yieldTask:noYield}),buffer=makeCellSamples(source,{id:0,start:0,loop:null},'frame',.5),engine=new CAS.Engine(sr,t.configuration.patch);
  engine.setTempo(t.configuration.tempo);
  for(let i=0;i<rendered.samples.length;i++){const expected=engine.next((buffer[i]||0)*.7*.5);assert.ok(Math.abs(rendered.samples[i]-expected)<1e-7);}
});
await test('Offline renders preserve rests and chord normalization rather than flattening the event stream',async()=>{
  const steps=[{piece:0,gain:.2,length:1,transpose:0}],single=await renderGridTake(take({steps}),{yieldTask:noYield}),chord=await renderGridTake(take({steps:[{...steps[0],voices:[{piece:0,transpose:0},{piece:0,transpose:0}]}]}),{yieldTask:noYield}),rest=await renderGridTake(take({steps:[{...steps[0],rest:true}]}),{yieldTask:noYield});
  assert.equal(energy(rest.samples),0);assert.ok(Math.abs(energy(chord.samples)/energy(single.samples)-2)<1e-6);
});
await test('Stored effect settings produce deterministic nonzero tails from fresh histories',async()=>{
  const patch=CAS.initPatch();Object.assign(patch.fx.delay,{enabled:true,time:.06,mix:.8,feedback:.3,mode:'clean',depth:0});const t=take({configuration:{patch,tempo:120}}),a=await renderGridTake(t,{yieldTask:noYield}),b=await renderGridTake(JSON.parse(JSON.stringify(t)),{yieldTask:noYield});assert.deepEqual(a.samples,b.samples);assert.ok(energy(a.samples.slice(Math.round(sr*.06),Math.round(sr*.12)))>0);assert.ok(a.samples.every(Number.isFinite));assert.ok(Math.max(...a.samples.slice(-100))<1e-4);
});
await test('WAV encoding exports the rendered PCM with correct duration and format fields',async()=>{const rendered=await renderGridTake(take(),{yieldTask:noYield}),wav=encodeTakeWav(rendered.samples,sr),v=new DataView(wav);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),sr);assert.equal(v.getUint16(34,true),16);assert.equal(v.getUint32(40,true),rendered.samples.length*2);assert.equal(wav.byteLength,44+rendered.samples.length*2);});
await test('Offline rendering bounds total duration and the same 32 active grain budget as live playback',async()=>{
  await assert.rejects(renderGridTake(take({steps:Array.from({length:21},()=>({...base.steps[0],interval:6}))}),{yieldTask:noYield}),/limited to 120/);
  const steps=Array.from({length:12},()=>({piece:0,gain:.1,length:4,transpose:0,interval:.02,voices:Array.from({length:8},()=>({piece:0,transpose:0}))})),rendered=await renderGridTake(take({settings:{...base.settings,cut:'period'},steps}),{yieldTask:noYield});assert.ok(rendered.skipped>0);assert.ok(rendered.samples.every(Number.isFinite));
});
console.log(`\n${count} grid recording and follow-up checks passed.`);
