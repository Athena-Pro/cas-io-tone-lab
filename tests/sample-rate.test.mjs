import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FRAME,HOP,analysisFrameSize,analyzeFrame,analyzeSound,demoSound,mapPieces} from '../harmonic-grid.js';
import {makeGridTake,readGridTake,takeSource} from '../grid-recording.js';
import {makeCellSamples,cellPlayback} from '../cell-audio.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const noYield=async()=>{},tone=(sr,f,length=8192,phase=0)=>Float32Array.from({length},(_,i)=>.5*Math.sin(2*Math.PI*f*i/sr+phase)+.25*Math.sin(4*Math.PI*f*i/sr+2*phase));
const pitched=(p,f)=>assert.ok(Math.abs(p.f0/f-1)<.002,`${f} Hz returned ${p.f0} Hz`);
await test('Feature windows grow at high rates without changing the source-sample frame grid',()=>{
  for(const [sr,n] of [[8000,2048],[44100,2048],[48000,2048],[88200,4096],[96000,4096],[192000,8192]])assert.equal(analysisFrameSize(sr),n);
  for(const sr of [8000,22050,32000,44100,48000,60000,64000,65536,67800,88200,96000,128000,192000]){const n=analysisFrameSize(sr);assert.equal(n&(n-1),0);assert.ok(n/2-2>=Math.ceil(sr/60));}
  assert.equal(FRAME,2048);assert.equal(HOP,1024);
});
await test('62, 80, 100 and 150 Hz survive all five standard source rates within 0.2 percent',()=>{
  for(const sr of [44100,48000,88200,96000,192000])for(const f of [62,80,100,150])pitched(analyzeFrame(tone(sr,f),sr,2048),f);
});
await test('High-rate low tones remain accurate across independent phases, interior frames and both file edges',()=>{
  for(const sr of [88200,96000,192000])for(const f of [62,80,100,150])for(const phase of [0,.7,1.9]){
    const data=tone(sr,f,16384,phase),before=data.slice();for(const start of [0,1024,2048,6144,14336])pitched(analyzeFrame(data,sr,start),f);assert.deepEqual(data,before);
  }
});
await test('High-rate harmonic vectors retain the fundamental/second-partial balance and normalized magnitudes',()=>{
  for(const sr of [48000,96000,192000]){const p=analyzeFrame(tone(sr,110,sr/4),sr,2048);assert.ok(Math.abs(p.h[0]-2/3)<.01);assert.ok(Math.abs(p.h[1]-1/3)<.01);assert.ok(Math.abs(p.brightness-4/3)<.02);assert.ok(Math.abs(p.h.reduce((s,x)=>s+x,0)-1)<1e-12);assert.equal(sr/analysisFrameSize(sr),48000/FRAME);}
});
await test('A 96 kHz analysis retains every original frame ID, start and end; frame grains retain their duration',async()=>{
  const data=tone(96000,80,16384),pieces=await analyzeSound(data,96000,{yieldTask:noYield});assert.equal(pieces.length,15);
  for(const [id,p] of pieces.entries()){assert.equal(p.id,id);assert.equal(p.start,id*HOP);assert.equal(p.end,id*HOP+FRAME);pitched(p,80);assert.equal(makeCellSamples(data,p,'frame').length,FRAME);}
  assert.equal(cellPlayback(pieces[3],'frame',1,0,.1,96000).duration,FRAME/96000);
  assert.equal(cellPlayback(pieces[3],'frame',1,0,.1,48000).duration,2*FRAME/96000);
});
await test('A high-rate portable take keeps its exact PCM, score IDs and selected pooled member through import',async()=>{
  const data=tone(96000,80,98304),pieces=await analyzeSound(data,96000,{yieldTask:noYield}),map=mapPieces(pieces,'balanced',64),pool=map.cells.find(ids=>ids.length>1&&ids.at(-1)>64),chosen=pool.at(-1),steps=[0,3,chosen].map(piece=>({...map.locations.get(piece),piece,interval:.137})),take=makeGridTake({samples:data,sampleRate:96000,sourceName:'Generated 96 kHz tone',steps,settings:{capacity:64},selection:{piece:chosen,step:2,output:'navigation'}}),imported=readGridTake(JSON.parse(JSON.stringify(take))),decoded=takeSource(imported),again=await analyzeSound(decoded.samples,decoded.sampleRate,{yieldTask:noYield});
  assert.deepEqual(imported.steps,take.steps);assert.deepEqual(imported.selection,take.selection);assert.equal(decoded.sampleRate,96000);assert.deepEqual(decoded.samples,data);assert.deepEqual(again.map(p=>[p.id,p.start,p.end]),pieces.map(p=>[p.id,p.start,p.end]));const remapped=mapPieces(again,imported.settings.layout,imported.settings.capacity),location=remapped.locations.get(imported.selection.piece),restoredPool=remapped.cells[location.y*remapped.columns+location.x];assert.equal(restoredPool.at(-1),chosen);assert.ok(restoredPool.length>1);
});
await test('Previously captured 44.1/48 kHz feature results stay unchanged to floating-point precision',async()=>{
  const rows=JSON.parse(await readFile(new URL('./fixtures/analysis-v15-features.json',import.meta.url),'utf8'));
  for(const row of rows){const p=analyzeFrame(tone(row.sr,row.f),row.sr,row.start);assert.equal(p.start,row.start);assert.equal(p.end,row.end);
    for(const key of ['f0','confidence','rms','brightness','oddEven','inharmonicity'])assert.ok(Math.abs(p[key]-row[key])<=1e-12*(1+Math.abs(row[key])),`${row.sr} ${row.f}: ${key}`);
    p.h.forEach((x,i)=>assert.ok(Math.abs(x-row.h[i])<1e-12));assert.equal(p.residualResolutionLimited,row.residualResolutionLimited);
  }
});
await test('Enlarged windows on short sources and silence stay finite and do not mutate source data',()=>{
  for(const data of [new Float32Array(FRAME),tone(192000,1000,FRAME,.7)]){const before=data.slice(),p=analyzeFrame(data,192000);assert.ok([p.f0,p.confidence,p.rms,p.brightness,...p.h].every(Number.isFinite));assert.equal(p.end,FRAME);assert.deepEqual(data,before);if(!data.some(x=>x))assert.equal(p.f0,0);}
});
await test('The six-second 192 kHz demo retains the old frame grid and pitches at least 98 percent of its frames',async()=>{
  const pieces=await analyzeSound(demoSound(192000),192000,{yieldTask:noYield});assert.equal(pieces.length,1124);assert.ok(pieces.filter(p=>p.f0).length>pieces.length*.98);assert.equal(pieces.at(-1).id,1123);assert.equal(pieces.at(-1).start,1123*HOP);
});
console.log(`\n${count} sample-rate analysis checks passed.`);
