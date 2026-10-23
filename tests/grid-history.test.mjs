import assert from 'node:assert/strict';
import {GridScoreUndo} from '../grid-history.js';
import {analyzeFrame,mapPieces} from '../harmonic-grid.js';
import {CAS} from '../engine.js';
import {makeGridTake,takeSource,renderGridTake,encodeTakeWav} from '../grid-recording.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
const samples=Float32Array.from({length:8192},(_,i)=>.2*Math.sin(2*Math.PI*240*i/48000));
function state(){return {samples,pieces:Array.from({length:7},(_,id)=>({...analyzeFrame(samples,48000,id*1024),id})),sampleRate:48000,sourceName:'First source',score:[{piece:5,x:1,y:2,gain:.73,length:.5,transpose:-3,interval:.137,voices:[{piece:5,transpose:2},{piece:6,transpose:-1}],normalization:2},{piece:0,rest:true,gain:1,length:1,transpose:0,interval:.283}],settings:{layout:'pca',capacity:64,clock:8,timing:'recorded',cut:'frame',level:.5,automation:{division:.25}},selection:{piece:6,step:1,output:'navigation'},configuration:{patch:CAS.initPatch(),tempo:113,navigation:{page:'ops',opIndex:5}},takeName:'Unstored path',captured:{configuration:null,settings:null,selection:null}};}
await test('A score checkpoint preserves exact intervals, chords, rests, selection and controls after subsequent edits',()=>{
  const history=new GridScoreUndo(),before=state(),expected=structuredClone(before);history.save(before,'Random walk');
  before.score[0].voices[0].transpose=24;before.score[1].interval=6;before.score.splice(0,1);before.settings.automation.division=8;before.selection.piece=0;before.configuration.patch.a=99;
  assert.deepEqual(history.entry.state,expected);
});
await test('One-level undo replaces the preceding checkpoint and can be consumed exactly once',()=>{
  const history=new GridScoreUndo(),a=history.save(state(),'Selected row'),next=state();next.score=[];const b=history.save(next,'Clear steps');
  assert.equal(history.entry,b);assert.equal(history.consume(a),null);assert.equal(history.entry,b);assert.equal(history.consume(b),b);assert.equal(history.entry,null);assert.equal(history.consume(),null);
});
await test('Source PCM and immutable analysis are retained by reference, without allocating a second audio copy per edit',()=>{
  const history=new GridScoreUndo(),before=state();history.save(before,'Delete step');const saved=history.entry.state;
  assert.equal(saved.samples,before.samples);assert.equal(saved.pieces,before.pieces);assert.notEqual(saved.score,before.score);assert.notEqual(saved.configuration,before.configuration);
});
await test('Undo across a shorter source at another rate recovers valid old frame IDs and pooled-member selection',()=>{
  const history=new GridScoreUndo(),before=state();history.save(before,'loading a take',{restoreConfiguration:true});
  const replacement={...state(),samples:new Float32Array(4096),sampleRate:44100,pieces:[],score:[{piece:0}],sourceName:'Different source'};
  const saved=history.consume().state,map=mapPieces(saved.pieces,saved.settings.layout,saved.settings.capacity),take=makeGridTake({...saved,steps:saved.score});
  assert.notEqual(saved.samples,replacement.samples);assert.equal(saved.sampleRate,48000);assert.equal(saved.sourceName,'First source');assert.deepEqual(takeSource(take).samples,samples);assert.ok(map.locations.has(saved.selection.piece));assert.equal(take.steps[0].voices[1].piece,6);assert.equal(take.selection.piece,6);
});
await test('Recovered timed score and old audio produce a byte-identical WAV with the captured configuration',async()=>{
  const before=state(),history=new GridScoreUndo(),render=async s=>{const result=await renderGridTake(makeGridTake({...s,steps:s.score}),{yieldTask:async()=>{}});return encodeTakeWav(result.samples,result.sampleRate);};
  const expected=await render(before);history.save(before,'loading a take',{restoreConfiguration:true});before.score=[];before.samples=new Float32Array(4096);before.sampleRate=44100;
  assert.deepEqual(await render(history.consume().state),expected);
});
await test('Only take-load undo requests synth restoration; missing source and canceled undo preserve the checkpoint',()=>{
  const history=new GridScoreUndo();history.save(state(),'Original order');assert.equal(history.entry.restoreConfiguration,false);
  const takeUndo=history.save(state(),'loading a take',{restoreConfiguration:true});assert.equal(takeUndo.restoreConfiguration,true);assert.equal(history.save(null,'failed load'),null);assert.equal(history.entry,takeUndo);
  // A guard cancellation simply leaves the entry unconsumed for a later retry.
  assert.equal(history.entry,takeUndo);assert.equal(history.consume(takeUndo).state.takeName,'Unstored path');
});
console.log(`\n${count} score recovery checks passed.`);
