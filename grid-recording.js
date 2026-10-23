import {CAS} from './engine.js';
import {FRAME,HOP,analyzeSound} from './harmonic-grid.js';
import {autoOptions} from './grid-auto.js';
import {makeCellSamples,cellBufferKey,cellPlayback} from './cell-audio.js';

export const MAX_RENDER_SECONDS=120;
const takeNumber=(v,fallback,lo,hi)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
const takeChoice=(v,choices,fallback)=>choices.includes(v)?v:fallback;
const takeText=(v,fallback='Grid take')=>typeof v==='string'?v.slice(0,120):fallback;

function checkSource(samples,sampleRate){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000||!samples||samples.length<FRAME||samples.length>sampleRate*30)throw new Error('A take needs 2048 samples to 30 seconds of audio at 8–192 kHz.');
  for(const x of samples)if(!Number.isFinite(x)||Math.abs(x)>8)throw new Error('Take audio contains invalid sample data.');
}
function encodeTakeSource(samples){
  const bytes=new Uint8Array(samples.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++)view.setFloat32(i*4,samples[i],true);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export function takeSource(take){
  const s=take.source;
  if(s?.encoding!=='float32-le/base64'||!Number.isInteger(s.samples)||s.samples<FRAME||!Number.isInteger(s.sampleRate)||s.sampleRate<8000||s.sampleRate>192000||s.samples>s.sampleRate*30||typeof s.data!=='string'||s.data.length!==4*Math.ceil(s.samples*4/3))throw new Error('Invalid embedded take audio.');
  let binary;try{binary=atob(s.data);}catch{throw new Error('Invalid take audio encoding.');}
  if(binary.length!==s.samples*4)throw new Error('Take audio length does not match its metadata.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),samples=new Float32Array(s.samples);
  for(let i=0;i<samples.length;i++)samples[i]=view.getFloat32(i*4,true);
  checkSource(samples,s.sampleRate);return {samples,sampleRate:s.sampleRate,name:takeText(s.name,'Loaded sound')};
}
export function takeConfiguration(input={}){
  const n=input.navigation||{};
  return {patch:CAS.sanitize(input.patch),tempo:takeNumber(input.tempo,110,40,240),navigation:{
    page:takeChoice(n.page,['home','ops','alg','env','fx','mem','global','seq'],'home'),
    view:takeChoice(n.view,['wave','spectrum','xy','route'],'wave'),
    opIndex:Math.round(takeNumber(n.opIndex,0,0,5)),stackIndex:Math.round(takeNumber(n.stackIndex,0,0,3)),
    fxBank:Math.round(takeNumber(n.fxBank,0,0,7)),globalGroup:Math.round(takeNumber(n.globalGroup,0,0,1)),octave:Math.round(takeNumber(n.octave,3,0,7))}};
}
function takeSettings(input={}){
  const a=input.automation||{};
  return {layout:takeChoice(input.layout,['balanced','plot','pca'],'balanced'),capacity:takeChoice(input.capacity,[0,64,144,256],64),
    cut:input.cut==='period'?'period':'frame',clock:takeNumber(input.clock,24,1/6,50),level:takeNumber(input.level,1,0,2),
    automation:{...autoOptions(a),clockMode:a.clockMode==='free'?'free':'tempo',division:takeChoice(a.division,[.25,.5,1,2,4,8],4)}};
}
function takeSteps(input,count){
  if(!Array.isArray(input)||!input.length||input.length>4096)throw new Error('A take must contain 1–4096 score steps.');
  const piece=id=>{if(!Number.isInteger(id)||id<0||id>=count)throw new Error('A score step refers to a missing source frame.');return id;};
  return input.map((s,i)=>{
    if(!s||typeof s!=='object'||s.voices!==undefined&&(!Array.isArray(s.voices)||s.voices.length>8))throw new Error(`Invalid voices at step ${i+1}.`);
    const note=n=>({piece:piece(n.piece),transpose:takeNumber(n.transpose,0,-24,24),x:Math.round(takeNumber(n.x,0,0,127)),y:Math.round(takeNumber(n.y,0,0,127))});
    const out={...note(s),gain:takeNumber(s.gain,1,0,1.5),length:takeNumber(s.length,1,.25,4),rest:s.rest===true};
    if(s.voices)out.voices=s.voices.map(note);
    if(s.interval!==undefined){if(!Number.isFinite(s.interval)||s.interval<1/50-1e-9||s.interval>6+1e-9)throw new Error(`Invalid interval at step ${i+1}.`);out.interval=s.interval;}
    if(s.normalization!==undefined)out.normalization=Math.round(takeNumber(s.normalization,1,1,8));
    return out;
  });
}
export function makeGridTake({name,sourceName,samples,sampleRate,settings,configuration,selection,steps}){
  checkSource(samples,sampleRate);
  return readGridTake({format:'cas-grid-take',version:3,name:takeText(name),source:{name:takeText(sourceName,'Loaded sound'),sampleRate,samples:samples.length,encoding:'float32-le/base64',data:encodeTakeSource(samples)},settings,configuration,selection,steps});
}
export function readGridTake(input,{legacySource}={}){
  if(input?.format==='cas-harmonic-score'&&input.version===2){
    if(!legacySource||input.source!==legacySource.sourceName||input.sampleRate!==legacySource.sampleRate||input.sourceSamples!==legacySource.samples?.length)throw new Error('Load the matching source sound before importing a legacy score v2.');
    return makeGridTake({...legacySource,name:'Imported legacy score',settings:{...input,automation:input.automation},configuration:{...legacySource.configuration,tempo:input.automation?.bpm},steps:input.steps});
  }
  if(input?.format!=='cas-grid-take'||input.version!==3)throw new Error('Choose a CAS grid take v3 or a matching legacy score v2.');
  const source=takeSource(input),count=Math.floor((source.samples.length-FRAME)/HOP)+1,steps=takeSteps(input.steps,count),selection=input.selection||{};
  return {format:'cas-grid-take',version:3,name:takeText(input.name),source:{name:source.name,sampleRate:source.sampleRate,samples:source.samples.length,encoding:input.source.encoding,data:input.source.data},settings:takeSettings(input.settings),configuration:takeConfiguration(input.configuration),
    selection:{piece:Math.round(takeNumber(selection.piece,steps[0].piece,0,count-1)),step:Math.round(takeNumber(selection.step,0,0,steps.length-1)),output:takeChoice(selection.output,['both','audio','navigation'],'both')},steps};
}

// Magnitude resynthesis fits the existing two carriers and six direct operators.
// It does not pretend that harmonic magnitudes contain phase or noise information.
export function harmonicPreset(piece,name='Cell'){
  if(!piece?.f0||!piece.h)throw new Error('Select a pitched cell to generate a harmonic preset.');
  const harmonics=Array.from(piece.h,(amplitude,i)=>({harmonic:i+1,amplitude:Number.isFinite(amplitude)?Math.max(0,amplitude):0})).filter(p=>p.amplitude>0).sort((a,b)=>b.amplitude-a.amplitude||a.harmonic-b.harmonic).slice(0,8),sum=harmonics.reduce((s,p)=>s+p.amplitude,0);
  if(!sum)throw new Error('This cell has no measured harmonic amplitudes.');
  const p=CAS.initPatch();p.name=`GRID / ${name}`.slice(0,48);p.a=harmonics[0].amplitude/sum;p.b=harmonics[0].harmonic;p.c=harmonics[1]?harmonics[1].amplitude/sum:0;p.d=harmonics[1]?.harmonic||1;p.phaseD=-Math.PI/2;
  p.env={attack:.01,decay:.1,sustain:1,release:.25};
  p.ops.forEach((op,i)=>{const h=harmonics[i+2];Object.assign(op,{enabled:!!h,target:h?'out':'off',rate:h?.harmonic||1,depth:h?h.amplitude/sum:0,phase:0,source:-1,index:0,decay:0});});
  const allEnergy=Array.from(piece.h).reduce((s,x)=>s+(Number.isFinite(x)?x*x:0),0),retained=harmonics.reduce((s,h)=>s+h.amplitude**2,0)/Math.max(1e-20,allEnergy);
  return {patch:CAS.sanitize(p),note:69+12*Math.log2(piece.f0/440),harmonics:structuredClone(harmonics),retained,sourceF0:piece.f0};
}

// Render one score pass. Grain timing/window/envelope rules are shared with live
// playback; the offline source reader interpolates linearly. Effects use the exact
// CAS DSP with empty histories, without unrelated live notes or a recall RAM clip.
export async function renderGridTake(input,{sampleRate=48000,yieldTask=()=>new Promise(r=>setTimeout(r,0)),progress=()=>{}}={}){
  const take=readGridTake(input),source=takeSource(take),pieces=await analyzeSound(source.samples,source.sampleRate,{yieldTask}),buffers=new Map(),voices=[],active=[],settings=take.settings;
  let when=0,end=0,skipped=0;
  for(const event of take.steps){
    const interval=event.interval||1/settings.clock,notes=event.voices?.length?event.voices:[{piece:event.piece,transpose:0}],normalization=event.normalization||notes.length;
    for(let i=active.length-1;i>=0;i--)if(active[i]<=when+1e-9)active.splice(i,1);
    if(!event.rest)for(const note of notes){
      if(active.length>=32){skipped++;continue;}
      const piece=pieces[note.piece],key=cellBufferKey(piece,settings.cut,event.length);
      if(!buffers.has(key))buffers.set(key,makeCellSamples(source.samples,piece,settings.cut,event.length));
      const buffer=buffers.get(key),rule=cellPlayback(piece,settings.cut,event.length,event.transpose+(note.transpose||0),interval),duration=rule.duration??buffer.length/source.sampleRate/rule.rate*Math.max(1,event.length);
      voices.push({when,duration,buffer,rate:rule.rate,gain:event.gain/Math.sqrt(normalization),exact:rule.exactFrame});active.push(when+duration+.001);end=Math.max(end,when+duration);
    }
    when+=interval;
    if(when>MAX_RENDER_SECONDS)throw new Error(`WAV rendering is limited to ${MAX_RENDER_SECONDS} seconds. Shorten the score or increase its clock.`);
  }
  const tail=CAS.tailSeconds(take.configuration.patch.fx),seconds=Math.max(when,end)+tail+.12;
  if(seconds>MAX_RENDER_SECONDS)throw new Error(`Score plus grain/effect tails exceeds the ${MAX_RENDER_SECONDS}-second WAV limit.`);
  const dry=new Float32Array(Math.ceil(seconds*sampleRate)),out=new Float32Array(dry.length);
  for(let v=0;v<voices.length;v++){
    const voice=voices[v],start=Math.round(voice.when*sampleRate),stop=Math.min(dry.length,Math.ceil((voice.when+voice.duration)*sampleRate)),fade=Math.min(.003,voice.duration/4),buffer=voice.buffer;
    for(let i=start;i<stop;i++){
      const t=(i-start)/sampleRate,at=t*source.sampleRate*voice.rate%buffer.length,j=Math.floor(at),f=at-j;
      const envelope=voice.exact?1:Math.max(0,Math.min(1,t/fade,(voice.duration-t)/fade));
      dry[i]+=(buffer[j]+f*(buffer[(j+1)%buffer.length]-buffer[j]))*voice.gain*envelope*settings.level;
    }
    if(v%16===0){progress(.35*v/Math.max(1,voices.length));await yieldTask();}
  }
  const engine=new CAS.Engine(sampleRate,take.configuration.patch);engine.setTempo(take.configuration.tempo);
  for(let i=0;i<out.length;i++){
    const fade=tail>=12&&i>out.length-sampleRate*.05?.5+.5*Math.cos(Math.PI*(i-out.length+sampleRate*.05)/(sampleRate*.05)):1;
    out[i]=engine.next(dry[i])*fade;
    if(i%16384===0){progress(.35+.65*i/out.length);await yieldTask();}
  }
  progress(1);return {samples:out,sampleRate,seconds:out.length/sampleRate,skipped,steps:take.steps.length};
}
export function encodeTakeWav(samples,sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer),text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  text(0,'RIFF');v.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,x))*32767),true));return buffer;
}
