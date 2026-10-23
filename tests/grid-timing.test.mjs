import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GrainBudget} from '../cell-audio.js';
import {GridPathWriter,gridInterval} from '../grid-timing.js';
import {makeGridTake,readGridTake,renderGridTake} from '../grid-recording.js';
let count=0;async function test(name,fn){await fn();console.log(`ok ${++count} · ${name}`);}
await test('Every saved autoplay division has a matching canonical option, including quarter and half divisions',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),menu=html.match(/id="palette-auto-division"[^>]*>([\s\S]*?)<\/select>/)[1],values=[...menu.matchAll(/value="([^"]+)"/g)].map(m=>m[1]);
  const samples=new Float32Array(4096);for(const division of [.25,.5,1,2,4,8]){const t=readGridTake(JSON.parse(JSON.stringify(makeGridTake({samples,sampleRate:48000,steps:[{piece:0}],settings:{automation:{division}}}))));assert.ok(values.includes(String(t.settings.automation.division)),String(division));}
});
await test('Path finalization retains the preceding movement gap and a singleton uses its clock',()=>{
  const writer=new GridPathWriter(),score=[];writer.append(score,{piece:0},10,8);writer.append(score,{piece:1},10.4,8);assert.ok(Math.abs(score[0].interval-.4)<1e-9);assert.equal(score[1].interval,score[0].interval);
  writer.finish();assert.equal(score[1].interval,score[0].interval);writer.append(score,{piece:2},999,8);writer.finish();assert.equal(score[2].interval,.125);
});
await test('Switching clocks never mutates recorded timing and switching back restores exact intervals',()=>{
  const score=[{interval:.137},{interval:.512},{}],before=structuredClone(score);assert.deepEqual(score.map(s=>gridInterval(s,8,'uniform')),[.125,.125,.125]);assert.deepEqual(score.map(s=>gridInterval(s,20,'recorded')),[.137,.512,.05]);assert.deepEqual(score,before);
});
await test('Timing mode round-trips in take JSON and the WAV obeys the selected clock without deleting intervals',async()=>{
  const samples=Float32Array.from({length:4096},(_,i)=>.1*Math.sin(2*Math.PI*220*i/48000)),steps=[{piece:0,interval:.37},{piece:1,interval:.37}],original=makeGridTake({samples,sampleRate:48000,steps,settings:{clock:8,timing:'recorded'}}),uniform=readGridTake({...original,settings:{...original.settings,timing:'uniform'}}),a=await renderGridTake(original,{yieldTask:async()=>{}}),b=await renderGridTake(uniform,{yieldTask:async()=>{}});
  assert.equal(uniform.steps[0].interval,.37);assert.ok(Math.abs((a.seconds-b.seconds)-.49)<1/48000);assert.equal(readGridTake(JSON.parse(JSON.stringify(uniform))).settings.timing,'uniform');
});
await test('Audible reservations allow queued nonoverlapping grains and enforce exact boundaries and held voices',()=>{
  const budget=new GrainBudget(2);assert.ok(budget.reserve(.2,.1,0));assert.ok(budget.reserve(.25,.1,0));assert.ok(budget.reserve(.15,.07,0));assert.equal(budget.reserve(.26,.1,0),null);assert.ok(budget.reserve(.3,.1,.1));assert.equal(budget.countAt(.27),2);
  budget.reset();const held=budget.reserve(0,Infinity,0);assert.ok(held);assert.ok(budget.reserve(.1,.1,0));assert.equal(budget.reserve(.15,.1,0),null);budget.release(held);assert.ok(budget.reserve(.15,.1,.01));
});
await test('Lookahead batches and offline chronological scheduling admit the same dense chord grains',()=>{
  for(const duration of [.005,.0426666667,.08,.25]){
    const events=Array.from({length:64},(_,tick)=>Array.from({length:8},(_,voice)=>({id:tick*8+voice,when:.05+tick*.02,duration}))).flat(),offline=new GrainBudget(),live=new GrainBudget(),expected=events.filter(e=>offline.reserve(e.when,e.duration+.001,e.when)!==null).map(e=>e.id),heard=[];let cursor=0;
    for(let now=0;cursor<events.length;now+=.025)while(cursor<events.length&&events[cursor].when<now+.1){const e=events[cursor++];if(live.reserve(e.when,e.duration+.001,now)!==null)heard.push(e.id);}
    assert.deepEqual(heard,expected,`duration ${duration}`);if(duration===.005)assert.equal(heard.length,512);else assert.ok(heard.length<=512);
  }
});
await test('WAV admission retains all short dense grains that can coexist within the audible cap',async()=>{
  const samples=Float32Array.from({length:4096},(_,i)=>.1*Math.sin(2*Math.PI*220*i/48000)),steps=Array.from({length:12},()=>({piece:0,length:.25,interval:.02,voices:Array.from({length:8},()=>({piece:0}))})),take=makeGridTake({samples,sampleRate:48000,steps}),render=await renderGridTake(take,{yieldTask:async()=>{}});assert.equal(render.skipped,0);assert.equal(render.scheduled,96);
});
console.log(`\n${count} timing and grain admission checks passed.`);
