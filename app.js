import { CAS, createWorkletSource } from './engine.js';
import { fft } from './harmonic-grid.js';
import { createHarmonicPalette } from './palette.js';
import {takeConfiguration} from './grid-recording.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clone = v => structuredClone(v);
const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const noteName = n => NOTE_NAMES[((n%12)+12)%12] + (Math.floor(n/12)-1);
const targetNames = {off:'OFF / PM source',a:'A · amplitude',b:'B · frequency',c:'C · amplitude',d:'D · frequency',pmB:'B · phase',pmD:'D · phase',ac:'A/C · phase pair',bd:'B/D · phase pair',rotate:'A/C · rotation',fold:'Wavefold amount',out:'Direct output',warpB:'B · phase warp',warpD:'D · phase warp'};
const waveNames = {sine:'sin θ',cosine:'cos θ',triangle:'asin(sin θ)',saw:'Saw',pulse:'Pulse',tan:'Soft tan',cot:'Soft cot',sec:'Soft sec',csc:'Soft csc',sinc:'Periodic sinc',cheb2:'Chebyshev T₂',cheb3:'Chebyshev T₃',fold:'Folded sine',steps:'8-step cycle',harmonics:'12-sine stack',dirichlet:'Dirichlet comb',fejer:'Fejér pulse'};
const modeNames = ['SUM','RING PRODUCT','SOFT QUOTIENT','SIGNED MAGNITUDE','PHASE ANGLE','WAVEFOLD'];
const ruleNames={sum:'ADD',ring:'MULTIPLY',quotient:'SOFT QUOTIENT',magnitude:'SIGNED MAGNITUDE',angle:'PHASE ANGLE',sine:'SINE',cosine:'CENTERED COSINE',fold:'WAVEFOLD',cheby:'CHEBYSHEV',soft:'SOFT SATURATE',rotate:'VECTOR MIX'};
const sourceNames={none:'NONE / 0',s:'S · sine branch',c:'C · cosine branch',op1:'OP 1',op2:'OP 2',op3:'OP 3',op4:'OP 4',op5:'OP 5',op6:'OP 6',feedback:'PREVIOUS OUTPUT'};
const algorithmNames=[...CAS.ALGORITHMS.map(a=>a.name),'CUSTOM STACK'];
let patch=CAS.initPatch(), dirty=false, page='home', opIndex=0, stackIndex=0, globalGroup=0, fxBank=0;
const fxBanks=['VOICE SHAPE','PHASE WARP','TRIG SHAPER','RING / TREM','SSB SHIFT','ALLPASS ORBIT','TRIG DELAY','ROTATING ROOM'];
const fxKeys=['voice','phase','shaper','mod','shift','phaser','delay','reverb'];
let octave=3, lastNote=60, selectedField=1, view='wave', frozen=false, shift=false, latchedShift=false;
let context=null, node=null, wakePromise=null, scope={y:new Float32Array(1024),s:new Float32Array(1024),c:new Float32Array(1024),dry:new Float32Array(1024),delay:new Float32Array(1024),room:new Float32Array(1024),recall:new Float32Array(1024),rms:0,peak:0,voices:0,sampleRate:48000};
let xyMap='sources',xyGain=1,showCrossings=false,liveAnalysis=null;
const snapshotRequests=new Map();let snapshotSerial=0;
const sourceVisibility={dry:true,delay:true,room:true,recall:true};
const scopeSources=[{id:'dry',name:'DRY',color:'#91dfbc',dash:[]},{id:'delay',name:'DELAY',color:'#ffb36b',dash:[4,2]},{id:'room',name:'ROOM',color:'#c6a2ff',dash:[1,3]},{id:'recall',name:'RECALL',color:'#73d9ff',dash:[6,3,1,3]}];
let hold=false, pendingOff=new Set(), activeNotes=new Map(), keyboardNotes=new Map(), pointerNotes=new Map(), voices=0;
let tempo=110, countIn=true, recordState='stopped', recordArmed=false, loopStart=0, scheduledCycle=-1, currentStep=-1;
let pattern=[], undoPattern=null, recordPending=new Map(), recordCycle=0, lastPatchSnapshot=null, arp=false;
let noticeTimeout, lastDraw=0, midiAccess=null, midiInput=null, bootPatch=null, detail=false;
let harmonicPalette=null;
const COLORS=['#91dfbc','#e6b575','#d29eb5','#98ace9','#bed58c','#c5a0e4'];

function makePreset(name,values={},ops=[]) {
  const p=Object.assign(CAS.initPatch(),values,{name});
  if(values.env)p.env={...CAS.initPatch().env,...values.env};
  ops.forEach((op,i)=>Object.assign(p.ops[i],op));
  return CAS.sanitize(p);
}
const presets = [
  CAS.initPatch(),
  makePreset('01 / VECTOR GLASS',{a:.7,b:1,c:.7,d:1,env:{attack:.01,decay:.7,sustain:.25,release:1.4}},[
    {rate:3.5,depth:2,target:'pmD',decay:.55},{rate:7,depth:.5,target:'pmB',decay:.2},{mode:'hz',rate:.3,depth:1,target:'rotate'}]),
  makePreset('02 / LINEAR FM BRASS',{a:.8,b:1,c:.4,d:2,feedback:.15,env:{attack:.04,decay:.4,sustain:.65,release:.25}},[
    {rate:1,depth:1.1,target:'b',decay:.8},{rate:2,depth:.6,target:'d'},{mode:'hz',rate:5.2,depth:.007,target:'b'}]),
  makePreset('03 / CASCADE BELL',{a:.8,b:1,c:.5,d:2.01,env:{attack:.004,decay:1.4,sustain:0,release:1.1}},[
    {rate:2.72,depth:2.7,target:'pmB',source:1,index:1.6,decay:.9},{rate:1.41,depth:1.3,target:'off',source:2,index:1.2,decay:.7},
    {rate:5,depth:1,target:'off',decay:.35},{rate:3.01,depth:1.1,target:'pmD',source:4,index:2,decay:.5},
    {rate:7.03,depth:.6,target:'off',decay:.3},{rate:.5,depth:.16,target:'out',decay:.8}]),
  makePreset('04 / VECTOR ORBIT',{a:.8,b:1,c:.8,d:1,env:{attack:.5,decay:.5,sustain:.8,release:1.2}},[
    {mode:'hz',rate:.22,depth:2.4,target:'rotate'},{rate:2,depth:.7,target:'pmB'},{mode:'hz',rate:.17,depth:.6,target:'pmD'},
    {mode:'hz',rate:.7,depth:.12,target:'a'},{rate:3,depth:.2,target:'out'},{mode:'hz',rate:.13,depth:.08,target:'c'}]),
  makePreset('05 / RING METAL',{a:1,b:1,c:1,d:1.414,combine:'ring',env:{attack:.003,decay:.8,sustain:.15,release:.65}},[
    {rate:2.01,depth:.5,target:'pmD',decay:.3},{mode:'hz',rate:4,depth:.06,target:'b'}]),
  makePreset('06 / RECIPROCAL REED',{a:.7,b:1,c:.3,d:2,combine:'quotient',drive:.08,env:{attack:.025,decay:.35,sustain:.6,release:.2}},[
    {wave:'cot',rate:1,depth:.24,target:'pmB'},{wave:'sec',rate:2,depth:.16,target:'pmD'},{mode:'hz',rate:5,depth:.025,target:'b'}]),
  makePreset('07 / SINC KEYS',{a:.75,b:1,c:.35,d:4,env:{attack:.003,decay:.7,sustain:.12,release:.5}},[
    {wave:'sinc',rate:7,depth:1.4,target:'pmD',decay:.2},{rate:3,depth:.35,target:'pmB',decay:.4},{mode:'hz',rate:3.3,depth:.12,target:'ac'}]),
  makePreset('08 / ANGLE BASS',{a:.8,b:.5,c:.8,d:1,combine:'angle',env:{attack:.005,decay:.2,sustain:.6,release:.12}},[
    {rate:1,depth:.45,target:'pmB',decay:.17},{rate:2,depth:.25,target:'pmD',decay:.2}]),
  makePreset('09 / FOLDED CHIME',{a:.6,b:1,c:.4,d:3,combine:'fold',fold:.65,env:{attack:.005,decay:1,sustain:.08,release:.8}},[
    {mode:'hz',rate:.4,depth:.24,target:'fold'},{wave:'cheb3',rate:2,depth:.35,target:'pmD',decay:.4}]),
  makePreset('10 / SIX PARTIAL ORGAN',{a:.5,b:1,c:.2,d:2,env:{attack:.018,decay:.2,sustain:.8,release:.12}},[
    {rate:.5,depth:.18,target:'out'},{rate:1.5,depth:.15,target:'out'},{rate:3,depth:.1,target:'out'},
    {rate:4,depth:.09,target:'out'},{rate:6,depth:.055,target:'out'},{rate:8,depth:.04,target:'out'}]),
  makePreset('11 / THROUGH-ZERO',{a:.65,b:.5,c:.25,d:1,env:{attack:.12,decay:.4,sustain:.7,release:.4}},[
    {rate:1,depth:2.3,target:'b'},{rate:.5,depth:.75,target:'d'},{mode:'hz',rate:.4,depth:.18,target:'a'}]),
  makePreset('12 / PHASE REED',{a:.7,b:1,c:.25,d:2,warpB:.17,warpD:.68,env:{attack:.03,decay:.4,sustain:.65,release:.3}},[
    {mode:'hz',rate:.35,depth:.06,target:'warpB'}]),
  makePreset('13 / HARMONIC COMB',{a:.2,b:1,c:0,d:2,env:{attack:.01,decay:.4,sustain:.6,release:.4}},[
    {wave:'harmonics',rate:1,depth:1.1,target:'out'},{wave:'dirichlet',rate:.5,depth:.25,target:'out'}]),
  makePreset('14 / SINE BLOOM',{a:.65,b:1,c:.35,d:2,fx:{shaper:{enabled:true,mode:'sine',drive:4.5,bias:.15,mix:.72}},env:{attack:.02,decay:.5,sustain:.6,release:.4}}),
  makePreset('15 / CHEBY CHIME',{a:1,b:1,c:0,d:1,fx:{shaper:{enabled:true,mode:'cheby',drive:1.4,order:5,mix:.8}},env:{attack:.005,decay:1.1,sustain:.08,release:.8}}),
  makePreset('16 / RING CRYSTAL',{a:.7,b:1,c:.35,d:2,fx:{mod:{enabled:true,mode:'ring',rate:73,depth:1,mix:.78}},env:{attack:.005,decay:.7,sustain:.35,release:.6}}),
  makePreset('17 / SSB HALO',{a:.6,b:1,c:.45,d:4,fx:{shift:{enabled:true,hz:37,feedback:.12,mix:1}},env:{attack:.2,decay:.6,sustain:.7,release:.8}}),
  makePreset('18 / ALLPASS ORBIT',{a:.7,b:1,c:.35,d:2,fx:{phaser:{enabled:true,rate:.22,depth:2.5,center:650,mix:.64}},env:{attack:.15,decay:.5,sustain:.75,release:.65}},[
    {wave:'harmonics',rate:1,depth:.6,target:'out'}]),
  makePreset('19 / FEJER PULSE',{a:.15,b:1,c:0,d:2,env:{attack:.005,decay:.5,sustain:.4,release:.4}},[
    {wave:'fejer',rate:1,depth:1.1,target:'out'},{mode:'hz',rate:.25,depth:.12,target:'rotate'}])
];
[
  ['20 / NESTED CRYSTAL',{a:.7,c:.65,b:1,d:1.5,env:{attack:.005,decay:.9,sustain:.2,release:.7}},[{rate:3,depth:.4,target:'pmB',decay:.4}]],
  ['21 / QUOTIENT REED',{a:.65,c:.45,b:.5,d:1,env:{attack:.025,decay:.4,sustain:.7,release:.25}},[]],
  ['22 / ANGLE PERCUSSION',{a:.6,c:.5,b:1,d:2.01,env:{attack:.003,decay:.65,sustain:0,release:.45}},[]],
  ['23 / VECTOR CASCADE',{a:.55,c:.5,b:1,d:1.5,env:{attack:.15,decay:.5,sustain:.65,release:.6}},[{mode:'hz',rate:.3,depth:.5,target:'rotate'}]],
  ['24 / FEEDBACK FOLD',{a:.65,c:.35,b:.5,d:1,env:{attack:.01,decay:.5,sustain:.65,release:.35}},[]],
  ['25 / NESTED PHASE BELL',{a:.7,c:.35,b:1,d:2.01,env:{attack:.004,decay:1,sustain:.1,release:.75}},[
    {rate:2,depth:.6,target:'pmB',source:1,index:1.4,decay:.5},{rate:3,depth:.65,target:'off',source:2,index:1.2,decay:.4},
    {rate:5.02,depth:.5,target:'off',decay:.25}]]
].forEach(([name,values,ops],i)=>presets.push(CAS.selectAlgorithm(makePreset(name,values,ops),6+i)));
presets.push(
  CAS.selectAlgorithm(makePreset('26 / TRIG ECHO',{a:.65,c:.45,b:1,d:1.5,env:{attack:.004,decay:.3,sustain:.1,release:.15},fx:{delay:{enabled:true,time:.285,feedback:.62,damping:.22,mix:.45,mode:'sine-fold',color:.7,drive:4,rate:.25,depth:.5}}}),6),
  makePreset('27 / ROTATING ROOM',{a:.55,c:.3,b:1,d:2.01,env:{attack:.004,decay:.4,sustain:.12,release:.2},fx:{reverb:{enabled:true,size:1,decay:3.2,damping:.35,mix:.55,rotation:1.1,mode:'sine',color:.35,drive:3,diffusion:.65}}},[{wave:'harmonics',rate:1,depth:.25,target:'out',decay:.4}]),
  CAS.selectAlgorithm(makePreset('28 / DIFFUSED CASCADE',{a:.65,c:.35,b:1,d:2.01,env:{attack:.004,decay:.5,sustain:.1,release:.25},fx:{spaceRoute:'serial',delay:{enabled:true,time:.18,feedback:.45,damping:.3,mix:.4,mode:'sine',color:.7,drive:3,rate:.2,depth:1.5},reverb:{enabled:true,size:1.2,decay:2.8,damping:.45,mix:.45,rotation:.9,mode:'sine-fold',color:.25,drive:2,diffusion:.65}}}),11)
);
presets.push(makePreset('29 / CROSSING MEMORY',{a:.7,b:1,c:.3,d:2,env:{attack:.004,decay:.25,sustain:.2,release:.15},recall:{back:4,length:1,mix:.65,source:'dry',mode:'loop',align:true,divisor:64,triggerSource:'dry'}}));

const experiments = [
  {title:'01 / Collapse to one sine',sub:'Equal frequencies · vector identity',equation:'a sin θ + c cos θ = R sin(θ + φ)',
    text:'With B = D and constant coefficients, R = √(a² + c²) and φ = atan2(c, a). Changing A and C moves a vector; it does not create additional partials. Listen, then change B or D to break the single-frequency condition.',
    observe:'FFT: one spectral line. XY: a closed ellipse.',url:'https://www.dsprelated.com/freebooks/mdft/Sinusoids.html',source:'Julius O. Smith · sinusoidal quadrature',
    patch:makePreset('EXPERIMENT / VECTOR IDENTITY',{a:.7,c:.7,b:1,d:1,env:{attack:.02,decay:.2,sustain:1,release:.25}})},
  {title:'02 / Ring sidebands',sub:'An exact product, no dry blend',equation:'sin Bθ · cos Dθ = ½[sin(B+D)θ + sin(B−D)θ]',
    text:'Multiplication creates sum and difference frequencies. With B = 1 and D = 1.5, the lines occur at 2.5f₀ and 0.5f₀. The ring mode here is a pure product. The supplied prototype mixed in the dry carriers, which obscured this identity.',
    observe:'FFT: two lines at 0.5× and 2.5× the played note.',
    patch:makePreset('EXPERIMENT / PURE RING',{a:1,c:1,b:1,d:1.5,combine:'ring',env:{attack:.01,decay:.2,sustain:1,release:.25}})},
  {title:'03 / FM versus PM',sub:'Integration versus phase offset',equation:'FM: φ̇ = 2πf₀(B + m)     PM: sin(φ + m)',
    text:'A B-frequency route changes instantaneous frequency before phase integration. A B-phase route adds radians after integration. A sinusoidal modulator relates the two through integration and a phase shift, but equal numeric depth is not equal modulation index. Try moving OP 1 between these destinations.',
    observe:'OP 1: change B · frequency ↔ B · phase and compare.',url:'https://www.dsprelated.com/freebooks/mDFT/FM_Spectra.html',source:'Julius O. Smith · FM spectra',
    patch:makePreset('EXPERIMENT / FM VS PM',{a:.85,c:0,b:1,d:1,env:{attack:.02,decay:.3,sustain:1,release:.3}},[{rate:2,depth:1.5,target:'pmB'}])},
  {title:'04 / Rotation becomes phase',sub:'A geometric modulation operator',equation:'[a′, c′] = rotate([a, c], r(t))',
    text:'Rotating the coefficient vector preserves a² + c². When B = D, this turns directly into phase modulation while preserving the carrier amplitude. When the two frequencies differ, the same rotation becomes coupled amplitude modulation. This geometric route is a useful extension of the original model.',
    observe:'Switch D from 1× to 2×; watch the spectrum open.',
    patch:makePreset('EXPERIMENT / VECTOR ROTATION',{a:.8,c:0,b:1,d:1,env:{attack:.02,decay:.3,sustain:1,release:.3}},[{rate:2,depth:1.8,target:'rotate'}])},
  {title:'05 / Operators into operators',sub:'A six-node phase network',equation:'uᵢ[n] = Dᵢ wᵢ(φᵢ[n] + Iᵢ uⱼ[n−1])',
    text:'Each modulator can take another operator as a phase input, including itself. All graph edges use one previous internal sample, making cyclic routing well-defined. A destination of OFF leaves an operator available as a PM source. This is an expanded digital model, not a claim about the current firmware.',
    observe:'OP 2 → OP 1 → carrier B; OP 3 enriches OP 2.',patch:clone(presets[3])},
  {title:'06 / Harmonic functions',sub:'Bounded functions, honest names',equation:'T₂(sin θ) = −cos 2θ     T₃(sin θ) = −sin 3θ',
    text:'Chebyshev functions can expose exact harmonic relationships. Reciprocal trig functions have singularities, so this lab regularizes their denominators and saturates their output. The resulting soft tan/sec/csc/cot waves are new bounded waveforms, not the mathematical functions near their poles.',
    observe:'Change OP 1 from Chebyshev T₃ to sine or soft cot.',patch:makePreset('EXPERIMENT / HARMONIC FUNCTIONS',{a:.4,c:0,b:1,d:1,env:{attack:.02,decay:.3,sustain:1,release:.3}},[{wave:'cheb3',rate:1,depth:.35,target:'out'}])},
  {title:'07 / Warp phase speed',sub:'A genuine phase-map operation',equation:'W(p,q) = p/(2q) if p<q; ½ + (p−q)/(2−2q) otherwise',
    text:'The phase stays continuous across the pivot, but it traverses the first and second half-cycles at different speeds. A pivot of 0.5 is identity; other positions add harmonics without changing the cycle length. Unlike a fixed phase offset, this changes the shape of every cycle.',
    observe:'Open PHASE WARP and move B PIVOT toward 0.5, then toward 0.1.',patch:clone(presets[12])},
  {title:'08 / Shift Hz, not pitch',sub:'Hilbert quadrature makes SSB',equation:'y = I cos(2πΔft) − Q sin(2πΔft)',
    text:'The analytic I/Q pair lets one sideband cancel. Each positive-frequency partial moves by the same signed Hz amount, so harmonic ratios generally change. This is different from transposition and from ring modulation, which retains both sidebands. The finite filter is approximate near DC and Nyquist; low bass will retain more unwanted image.',
    observe:'Try SSB SHIFT, then compare it with RING / TREMOLO at a similar rate.',url:'https://www.dsprelated.com/freebooks/mdft/Analytic_Signals_Hilbert_Transform.html',source:'Julius O. Smith · analytic signals and the Hilbert transform',patch:clone(presets[17])},
  {title:'09 / Hear phase as notches',sub:'Allpass stages plus a dry path',equation:'H(z) = [(a + z⁻¹) / (1 + az⁻¹)]⁴',
    text:'With a fixed coefficient, the allpass chain has unity magnitude and changes frequency-dependent phase. Mixing it with the original signal makes notches where their phases oppose. A sine LFO moves the center frequency in octaves. In this experiment the LFO is stopped so you can compare the wet chain and the dry/wet cancellation.',
    observe:'ALLPASS ORBIT: set wet mix to 100%, then 50%; turn LFO rate above zero to sweep.',url:'https://www.dsprelated.com/freebooks/pasp/Virtual_Analog_Example_Phasing.html',source:'Julius O. Smith · virtual analog phasing',patch:makePreset('EXPERIMENT / ALLPASS NOTCH',{a:.7,b:1,c:.3,d:2,fx:{phaser:{enabled:true,rate:0,depth:0,center:800,mix:.5}},env:{attack:.03,decay:.2,sustain:.9,release:.4}},[{wave:'harmonics',rate:1,depth:.8,target:'out'}])},
  {title:'10 / Nest the rules',sub:'Composition is order dependent',equation:'x₀ = S+C; x₁ = x₀C; x₂ = sin(2.2x₁); x₃ = mix(x₂, fold(1.8x₂), 0.7)',
    text:'A nested algorithm feeds a rule’s result into the next rule. Multiplication before sine gives sin(gxC); multiplication after sine gives C sin(gx). These are generally different sounds. The stack works on voice amplitude samples; operator phase nesting is configured separately in the six-node network. Both can run together.',
    observe:'Move SINE before MULTIPLY, then compare the waveform and spectrum. Bypass the stack to hear the base rule.',patch:clone(presets[20])},
  {title:'11 / Repeats become rules',sub:'A buffer makes the stack remember',equation:'w[n] = x[n] + g · L(d[n]); d[n] = buffer[n − D(n)]',
    text:'A circular buffer stores past stack output. Clean feedback makes geometric repeats; a sine or sine→fold rule changes each later pass through the loop. The feedback rules are normalized to have slope magnitude at most one, preventing the color control from adding loop gain. A sine LFO moves the fractional read tap for chorus-like echoes; turning time also bends pitch.',
    observe:'TRIG DELAY: compare CLEAN with SINE → FOLD, then SCL+EDIT opens loop color and modulation controls. Notes stop while stored echoes continue.',url:'https://www.dsprelated.com/freebooks/pasp/Delay_Line_Signal_Interpolation.html',source:'Julius O. Smith · interpolated delay lines',patch:clone(presets[26])},
  {title:'12 / Rotate a room',sub:'Four buffers scatter stored energy',equation:'v[n] = delay(w[n]); w[n] = b·x[n] + G · R(θ) · H · L(v[n])',
    text:'Four unequal delay lines recirculate through a normalized Hadamard matrix and two sin/cos rotations. Those matrices preserve vector energy; per-line losses set a nominal decay, and low-pass damping removes high frequencies. Two short allpass buffers diffuse the input. Rotation changes the network’s modes without increasing the matrix gain. This is a small algorithmic reverb, not an acoustic-room model.',
    observe:'ROTATING ROOM: SCL+EDIT opens SCATTER ANGLE and diffusion. Compare parallel returns with ECHO → ROOM routing in the buffer section.',url:'https://www.dsprelated.com/freebooks/pasp/FDN_Reverberation.html',source:'Julius O. Smith · feedback delay network reverberation',patch:clone(presets[27])}
];
let experimentIndex=0;

function notify(text) { const el=$('#notice');el.textContent=text;el.hidden=false;clearTimeout(noticeTimeout);noticeTimeout=setTimeout(()=>el.hidden=true,4500); }
function send(m) {node?.port.postMessage(m);}
function updatePatch({table=false}={}) {
  dirty=true;send({type:'patch',patch});
  if(table)renderOperators();
  renderPanel();updateTheoryMetric();
}
async function ensureAudio() {
  if(context&&node){await context.resume();updateAudioLabel();return;}
  if(wakePromise)return wakePromise;
  wakePromise=(async()=>{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)throw new Error('Web Audio is unavailable in this browser.');
    context=new AudioContextClass({latencyHint:'interactive'});
    if(!context.audioWorklet)throw new Error('AudioWorklet requires localhost or HTTPS. Use start-cas-lab.cmd.');
    const url=URL.createObjectURL(new Blob([createWorkletSource()],{type:'application/javascript'}));
    try {await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    node=new AudioWorkletNode(context,'cas-tone',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
    node.port.onmessage=({data:m})=>{if(m.type==='recallSnapshot'){const pending=snapshotRequests.get(m.id);if(pending){clearTimeout(pending.timeout);snapshotRequests.delete(m.id);pending.resolve(m.snapshot);}return;}if(m.type==='scope'){voices=m.voices;if(!frozen)scope=m;liveAnalysis=m.analysis;updateAudioLabel();renderMemoryStatus();if(m.buffers)$('#buffer-levels').textContent=`TAP RMS · ECHO ${m.buffers.delay.toFixed(4)} / ROOM ${m.buffers.reverb.toFixed(4)}`;}};
    node.onprocessorerror=()=>notify('The audio processor stopped. Reload the lab to restart it.');
    node.connect(context.destination);send({type:'patch',patch});send({type:'clock',tempo});
    await context.resume();context.onstatechange=updateAudioLabel;updateAudioLabel();renderPanel();
  })().catch(error=>{notify(error.message);if(context)context.close();context=null;node=null;throw error;}).finally(()=>wakePromise=null);
  return wakePromise;
}
function updateAudioLabel() {
  const running=context?.state==='running';$('#audio-state').textContent=running?'● AUDIO LIVE':context?'● AUDIO SUSPENDED':'● AUDIO ASLEEP';$('#audio-state').classList.toggle('live',running);
  $('#wake').textContent=running?'Audio enabled':'Enable audio';$('#wake').classList.toggle('primary',!running);
  $('#voice-count').textContent=`${voices} / ${patch.poly} VOICES`;
  $('#sample-rate').textContent=`${((context?.sampleRate||48000)/1000).toFixed(0)} kHz / ${patch.quality}×`;
}
async function noteOn(id,note,velocity=.8,{record=true}={}) {
  activeNotes.set(id,note);lastNote=note;pendingOff.delete(id);renderKeys();
  $('#note-label').textContent=`${noteName(note)} · ${(440*2**((note-69)/12)).toFixed(1)} Hz`;
  try {await ensureAudio();if(!activeNotes.has(id))return;send({type:'on',id,note,velocity});if(record)recordOn(id,note,velocity);}catch{activeNotes.delete(id);renderKeys();}
}
function noteOff(id,{force=false}={}) {
  if(hold&&!force&&activeNotes.has(id)){pendingOff.add(id);return;}
  activeNotes.delete(id);pendingOff.delete(id);send({type:'off',id});recordOff(id);renderKeys();
}
function setHold(value) {
  hold=value;$('#hold').setAttribute('aria-pressed',String(hold));
  if(!hold)for(const id of [...pendingOff])noteOff(id,{force:true});
  renderPanel();
}
function panic() {
  harmonicPalette?.stop();
  stopTransport();send({type:'panic'});activeNotes.clear();pendingOff.clear();keyboardNotes.clear();pointerNotes.clear();recordPending.clear();setHold(false);arp=false;voices=0;renderKeys();renderPanel();notify('All voices and scheduled notes stopped.');
}
function stopLiveInputs() {for(const id of [...keyboardNotes.values(),...pointerNotes.values()])noteOff(id,{force:true});keyboardNotes.clear();pointerNotes.clear();}

const knobControls=new Map();
function knob(mount,id,name,{min=0,max=1,step=.01,value=0,reset=value,format=v=>v.toFixed(2),onChange,relative=false,ariaLabel=null}={}) {
  const root=document.createElement('div');root.className='knob';
  root.innerHTML=`<label class="knob-name" for="dial-${id}"></label><div class="dial-wrap"><span class="dial"></span><input type="range" id="dial-${id}"></div><output for="dial-${id}"></output>`;
  const input=root.querySelector('input'),label=root.querySelector('label'),out=root.querySelector('output'),dial=root.querySelector('.dial'),wrap=root.querySelector('.dial-wrap');
  input.min=min;input.max=max;input.step=step;input.value=value;label.textContent=name;input.setAttribute('aria-label',name);
  const c={root,input,update(v,options={}){Object.assign(c,options);input.min=c.min;input.max=c.max;input.step=c.step;input.value=v;label.textContent=c.name;input.setAttribute('aria-label',c.ariaLabel||c.name);out.textContent=c.format(v);input.setAttribute('aria-valuetext',c.format(v));const norm=(v-c.min)/(c.max-c.min||1),degrees=CAS.clamp(norm,0,1)*270;dial.style.setProperty('--angle',`${degrees-135}deg`);wrap.style.background=`conic-gradient(from 225deg,#6d9983 0deg,#6d9983 ${degrees}deg,#141b18 ${degrees}deg,#141b18 270deg,transparent 270deg)`;},min,max,step,reset,format,onChange,name,relative,ariaLabel};
  const change=v=>{v=CAS.clamp(v,c.min,c.max);const digits=Math.max(0,(String(c.step).split('.')[1]||'').length);v=Number((Math.round(v/c.step)*c.step).toFixed(digits));c.update(v);c.onChange?.(v);};
  let drag=null;
  input.addEventListener('pointerdown',e=>{e.preventDefault();input.focus();input.setPointerCapture(e.pointerId);drag={id:e.pointerId,y:e.clientY,x:e.clientX,value:Number(input.value)};});
  input.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const fine=e.shiftKey||shift;const delta=drag.y-e.clientY+(e.clientX-drag.x)*.25;const scale=(c.max-c.min)/180*(fine?.12:1);change(drag.value+delta*scale);});
  input.addEventListener('pointerup',()=>drag=null);input.addEventListener('pointercancel',()=>drag=null);input.addEventListener('lostpointercapture',()=>drag=null);
  input.addEventListener('input',()=>{c.onChange?.(Number(input.value));c.update(Number(input.value));});
  input.addEventListener('wheel',e=>{e.preventDefault();const fine=e.shiftKey||shift;const amount=c.step*(fine?1:Math.max(1,Math.round((c.max-c.min)/(c.step*100))));change(Number(input.value)+(e.deltaY<0?amount:-amount));},{passive:false});
  input.addEventListener('keydown',e=>{if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();change(Number(input.value)+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*c.step*(e.shiftKey||shift||c.step>=1?1:4));}});
  input.addEventListener('dblclick',()=>change(c.reset));$(mount).append(root);c.update(value);knobControls.set(id,c);return c;
}
const number = (v,d=2) => Number(v).toFixed(d);
const enums=(values,labels=values)=>({min:0,max:values.length-1,step:1,format:v=>labels[Math.round(v)]});
const field=(name,value,min,max,step,set,format=v=>number(v))=>({name,value,min,max,step,set,format});
const elementMeta={
  phase:{title:'PHASE WARP',kind:'SYNTHESIS',formula:'sin(2π · W(φ, pivot) + offset)',description:'Move the half-cycle pivot to redistribute phase speed. Route an operator to B/D phase warp to animate it.',demo:12},
  shaper:{title:'TRIG SHAPER',kind:'OVERSAMPLED INSERT',formula:'sin(gx + β) − sin β',description:'Sine/cosine folding or Chebyshev harmonic shaping. Zero-input offsets are removed and output is normalized.',demo:14},
  mod:{title:'RING / TREMOLO',kind:'INSERT',formula:'y = x · cos(2πft + φ)',description:'A sine carrier multiplies the complete voice mix. Tremolo adds a DC offset so gain stays nonnegative.',demo:16},
  shift:{title:'SSB FREQUENCY SHIFT',kind:'ANALYTIC INSERT',formula:'y = I cos θ − Q sin θ',description:'A 255-tap Hilbert pair moves partials by a fixed Hz amount. Both paths align to a 127-sample delay.',demo:17},
  phaser:{title:'ALLPASS ORBIT',kind:'INSERT',formula:'a(t) = (tan(πfc/fs) − 1) / (tan(πfc/fs) + 1)',description:'Four allpass stages sweep with a sine LFO. Mixing their phase-shifted output with dry audio makes notches.',demo:18},
  delay:{title:'TRIG DELAY',kind:'SHARED CIRCULAR BUFFER',formula:'write = input + g · L(delayed sample)',description:'5–1000 ms echo with signed feedback, damping and a sine-modulated read tap. CLEAN, SINE or SINE → FOLD shapes the recirculating signal.',demo:26},
  reverb:{title:'ROTATING ROOM',kind:'FOUR-LINE FEEDBACK NETWORK',formula:'write = input + G · R(θ) · H · L(taps)',description:'Four unequal buffers, two input diffusers and an energy-preserving trig rotation. Decay is nominal; damping and nonlinear color shorten parts of the tail.',demo:27}
};
function effectFields(key,advanced=false) {
  const set=name=>v=>{if(key==='phase'){patch[name]=v;patch.phaseEnabled=true;}else{patch.fx[key][name]=v;patch.fx[key].enabled=true;}updatePatch();};
  if(key==='phase')return [field('K1 / B PIVOT',patch.warpB,.05,.95,.01,set('warpB')),field('K2 / D PIVOT',patch.warpD,.05,.95,.01,set('warpD')),field('K3 / B OFFSET',patch.phaseB,-Math.PI,Math.PI,.01,set('phaseB'),v=>`${number(v)} rad`),field('K4 / D OFFSET',patch.phaseD,-Math.PI,Math.PI,.01,set('phaseD'),v=>`${number(v)} rad`)];
  const c=patch.fx[key],pct=v=>`${Math.round(v*100)}%`;
  if(key==='shaper')return [field('K1 / INPUT DRIVE',c.drive,.1,12,.01,set('drive'),v=>`${number(v)}×`),c.mode==='cheby'?field('K2 / HARMONIC',c.order,2,12,1,set('order'),v=>`T${v}`):field('K2 / SHAPE LAW',['sine','cosine','cheby'].indexOf(c.mode),0,2,1,v=>setEffectMode('shaper',['sine','cosine','cheby'][v]),v=>['SINE','COSINE','CHEBY'][v]),field('K3 / BIAS',c.bias,c.mode==='cheby'?-1:-Math.PI,c.mode==='cheby'?1:Math.PI,.01,set('bias')),field('K4 / WET MIX',c.mix,0,1,.01,set('mix'),pct)];
  if(key==='mod')return [field('K1 / CARRIER RATE',c.rate,0,c.mode==='tremolo'?30:2000,c.mode==='tremolo'?.01:.1,set('rate'),v=>`${number(v)} Hz`),field('K2 / DEPTH',c.depth,0,1,.01,set('depth'),pct),field('K3 / PHASE',c.phase,-Math.PI,Math.PI,.01,set('phase'),v=>`${number(v)} rad`),field('K4 / WET MIX',c.mix,0,1,.01,set('mix'),pct)];
  if(key==='shift')return [field('K1 / SHIFT',c.hz,-2000,2000,.1,set('hz'),v=>`${number(v,1)} Hz`),field('K2 / ROTATION',c.rotate,-Math.PI,Math.PI,.01,set('rotate'),v=>`${number(v)} rad`),field('K3 / FEEDBACK',c.feedback,0,.65,.01,set('feedback'),pct),field('K4 / WET MIX',c.mix,0,1,.01,set('mix'),pct)];
  if(key==='delay')return advanced?[field('K1 / LOOP COLOR',c.color,0,1,.01,set('color'),pct),field('K2 / LOOP DRIVE',c.drive,.5,8,.01,set('drive'),v=>`${number(v)}×`),field('K3 / MOD RATE',c.rate,0,2,.01,set('rate'),v=>`${number(v)} Hz`),field('K4 / MOD DEPTH',c.depth,0,5,.01,set('depth'),v=>`${number(v)} ms`)]:[field('K1 / ECHO TIME',c.time,.005,1,.001,set('time'),v=>`${Math.round(v*1000)} ms`),field('K2 / ECHO FEEDBACK',c.feedback,-.95,.95,.01,set('feedback'),pct),field('K3 / ECHO DAMPING',c.damping,0,.98,.01,set('damping'),pct),field('K4 / ECHO RETURN',c.mix,0,1,.01,set('mix'),pct)];
  if(key==='reverb')return advanced?[field('K1 / SCATTER ANGLE',c.rotation,0,Math.PI/2,.01,set('rotation'),v=>`${number(v)} rad`),field('K2 / ROOM COLOR',c.color,0,1,.01,set('color'),pct),field('K3 / ROOM DRIVE',c.drive,.5,8,.01,set('drive'),v=>`${number(v)}×`),field('K4 / DIFFUSION',c.diffusion,0,.75,.01,set('diffusion'),pct)]:[field('K1 / ROOM SIZE',c.size,.4,1.5,.01,set('size'),v=>`${number(v)}×`),field('K2 / ROOM DECAY',c.decay,.2,8,.01,set('decay'),v=>`${number(v)} s`),field('K3 / ROOM DAMPING',c.damping,0,.98,.01,set('damping'),pct),field('K4 / ROOM RETURN',c.mix,0,1,.01,set('mix'),pct)];
  return [field('K1 / LFO RATE',c.rate,0,15,.01,set('rate'),v=>`${number(v)} Hz`),field('K2 / SWEEP DEPTH',c.depth,0,3,.01,set('depth'),v=>`${number(v)} oct`),field('K3 / CENTER',c.center,40,10000,1,set('center'),v=>`${Math.round(v)} Hz`),field('K4 / WET MIX',c.mix,0,1,.01,set('mix'),pct)];
}
function effectDefaults(key,advanced=false){if(advanced&&key==='delay')return [.4,2,.3,0];if(advanced&&key==='reverb')return [.4,.35,2,.6];return {phase:[.5,.5,0,0],shaper:[2,patch.fx.shaper.mode==='cheby'?3:0,0,.5],mod:[30,1,0,.5],shift:[40,0,0,1],phaser:[.3,2,800,.5],delay:[.3,.45,.35,.3],reverb:[1,2.4,.5,.25]}[key];}
function focusEffect(key){fxBank=fxKeys.indexOf(key);page='fx';detail=false;renderPanel();}
function toggleEffect(key){if(key==='phase')patch.phaseEnabled=!patch.phaseEnabled;else patch.fx[key].enabled=!patch.fx[key].enabled;updatePatch();}
function setEffectMode(key,value){patch.fx[key].mode=value;patch.fx[key].enabled=true;if(key==='mod'&&value==='tremolo')patch.fx.mod.rate=Math.min(patch.fx.mod.rate,30);if(key==='shaper'&&value==='cheby')patch.fx.shaper.bias=CAS.clamp(patch.fx.shaper.bias,-1,1);updatePatch();}
function buildRack(){
  for(const [key,meta] of Object.entries(elementMeta)){
    const buffered=key==='delay'||key==='reverb',rack=$(buffered?'#buffer-rack':'#element-rack');
    const card=document.createElement('article');card.className='element';card.dataset.element=key;
    const head=document.createElement('div');head.className='element-heading';const title=document.createElement('button');title.className='element-title';title.textContent=meta.title;title.addEventListener('click',()=>focusEffect(key));const toggle=document.createElement('button');toggle.id=`enable-${key}`;toggle.setAttribute('aria-label',`Enable ${meta.title.toLowerCase()}`);toggle.addEventListener('click',()=>{focusEffect(key);toggleEffect(key);});head.append(title,toggle);card.append(head);
    const type=document.createElement('span');type.className='element-kind';type.textContent=meta.kind;card.append(type);
    const formula=document.createElement('code');formula.className='element-formula';formula.id=`formula-${key}`;formula.textContent=meta.formula;card.append(formula);
    const description=document.createElement('p');description.textContent=meta.description;card.append(description);
    const controls=document.createElement('div');controls.className='element-knobs';controls.id=`element-${key}`;card.append(controls);rack.append(card);
    effectFields(key).forEach((f,i)=>knob(`#element-${key}`,`element-${key}-${i}`,f.name.split(' / ')[1],{...f,reset:effectDefaults(key)[i],onChange:v=>{fxBank=fxKeys.indexOf(key);page='fx';detail=false;f.set(v);}}));
    if(buffered){const advanced=document.createElement('div');advanced.id=`loop-${key}`;advanced.className='element-knobs buffer-extra';advanced.hidden=true;card.append(advanced);effectFields(key,true).forEach((f,i)=>knob(`#loop-${key}`,`loop-${key}-${i}`,f.name.split(' / ')[1],{...f,reset:effectDefaults(key,true)[i],onChange:v=>{fxBank=fxKeys.indexOf(key);page='fx';detail=true;f.set(v);}}));}
    const footer=document.createElement('div');footer.className='element-footer';
    if(key==='shaper'||key==='mod'||buffered){const label=document.createElement('label');label.textContent=buffered?'LOOP ':'MODE ';const select=document.createElement('select');select.id=`mode-${key}`;select.setAttribute('aria-label',`${meta.title.toLowerCase()} mode`);const values=buffered?CAS.LOOP_MODES:key==='shaper'?['sine','cosine','cheby']:['ring','tremolo'];values.forEach(v=>select.append(option(v,v.toUpperCase().replace('-',' → '),false)));select.addEventListener('change',()=>{fxBank=fxKeys.indexOf(key);page='fx';setEffectMode(key,select.value);});label.append(select);footer.append(label);}
    if(buffered){const b=document.createElement('button');b.id=`details-${key}`;b.textContent='Loop controls';b.addEventListener('click',()=>{const active=page==='fx'&&fxKeys[fxBank]===key&&detail;fxBank=fxKeys.indexOf(key);page='fx';detail=!active;renderPanel();});footer.append(b);}
    const load=document.createElement('button');load.textContent='Load demo';load.setAttribute('aria-label',`Load ${meta.title.toLowerCase()} demo`);load.title='Replace the current patch with this demonstration preset';load.addEventListener('click',()=>{loadPatch(presets[meta.demo]);focusEffect(key);});footer.append(load);
    const demo=document.createElement('button');demo.textContent='Try sound';demo.setAttribute('aria-label',`Try ${meta.title.toLowerCase()} sound`);demo.title='Play the current patch without changing its controls';demo.addEventListener('click',()=>{$('#audition').click();});footer.append(demo);card.append(footer);
  }
}
function renderRack(){
  if(!$('#element-rack').children.length)return;
  let count=0;
  for(const key of Object.keys(elementMeta)){
    const enabled=key==='phase'?patch.phaseEnabled:patch.fx[key].enabled;
    if(key!=='phase'&&enabled)count++;
    const toggle=$(`#enable-${key}`);toggle.textContent=enabled?'ON':'OFF';toggle.setAttribute('aria-pressed',String(enabled));
    const card=$(`[data-element="${key}"]`);card.classList.toggle('selected',page==='fx'&&fxKeys[fxBank]===key);card.classList.toggle('bypassed',key!=='phase'&&patch.fx.bypass);
    effectFields(key).forEach((f,i)=>knobControls.get(`element-${key}-${i}`)?.update(f.value,{name:f.name.split(' / ')[1],min:f.min,max:f.max,step:f.step,reset:effectDefaults(key)[i],format:f.format,onChange:v=>{fxBank=fxKeys.indexOf(key);page='fx';detail=false;f.set(v);}}));
    if(['shaper','mod','delay','reverb'].includes(key))$(`#mode-${key}`).value=patch.fx[key].mode;
    if(key==='delay'||key==='reverb'){const expanded=page==='fx'&&fxKeys[fxBank]===key&&detail;$(`#loop-${key}`).hidden=!expanded;$(`#details-${key}`).textContent=expanded?'Main controls':'Loop controls';$(`#details-${key}`).setAttribute('aria-expanded',String(expanded));effectFields(key,true).forEach((f,i)=>knobControls.get(`loop-${key}-${i}`)?.update(f.value,{name:f.name.split(' / ')[1],min:f.min,max:f.max,step:f.step,reset:effectDefaults(key,true)[i],format:f.format,onChange:v=>{fxBank=fxKeys.indexOf(key);page='fx';detail=true;f.set(v);}}));}
  }
  $('#fx-bypass').setAttribute('aria-pressed',String(patch.fx.bypass));$('#fx-bypass').textContent=patch.fx.bypass?'Effects bypassed':'Bypass effects';
  $('#fx-status').textContent=patch.fx.bypass?'EFFECTS BYPASSED':`${count} / 6 EFFECTS ON`;
  $('#formula-shaper').textContent=patch.fx.shaper.mode==='cheby'?'Tₙ(clip(gx + β)) − Tₙ(clip β)':`${patch.fx.shaper.mode==='cosine'?'cos':'sin'}(gx + β) − ${patch.fx.shaper.mode==='cosine'?'cos':'sin'} β`;
  $('#formula-mod').textContent=patch.fx.mod.mode==='ring'?'y = x · [(1−d) + d cos(θ)]':'y = x · [1−d/2 + (d/2) cos(θ)]';
}
function renderBuffers(){
  $('#buffer-route').value=patch.fx.spaceRoute;
  $('#buffer-path').textContent=patch.fx.spaceRoute==='serial'?'STACK → TRIG INSERTS → ECHO + DRY → ROOM → OUTPUT':'STACK → TRIG INSERTS → PARALLEL ECHO / ROOM RETURNS → OUTPUT';
  const sr=context?.sampleRate||48000,reserve=CAS.bufferPlan(sr),rate=Number($('#plan-rate').value),bytes=Number($('#plan-format').value),channels=Number($('#plan-channels').value),instances=Number($('#plan-instances').value),seconds=Number($('#plan-time').value),plan=CAS.bufferPlan(rate,bytes,channels,instances,seconds,patch.fx.reverb.size),kib=n=>`${(n/1024).toFixed(1)} KiB`;
  $('#buffer-reserve').textContent=`ECHO / ROOM RESERVE · ${kib(reserve.totalBytes)} Float32 · ${(sr/1000).toFixed(1)} kHz · shared mono`;
  $('#plan-time-value').textContent=`${Math.round(seconds*1000)} ms`;
  $('#plan-delay').textContent=kib(plan.delayBytes);$('#plan-room').textContent=kib(plan.reverbBytes);$('#plan-total').textContent=kib(plan.totalBytes);
  $('#plan-note').textContent=`Sample storage only, with room size ${patch.fx.reverb.size.toFixed(2)}×. A proposed build capped at these lengths; live allocation above remains fixed. Filter state, alignment, resampling and CPU costs are additional.`;
}
$('#buffer-route').addEventListener('change',e=>{patch.fx.spaceRoute=e.target.value;updatePatch();});
$('#clear-buffers').addEventListener('click',()=>{send({type:'clearBuffers'});notify('Echo and reverb memories cleared. Held voices keep playing.');});
$('#buffer-load-demo').addEventListener('click',()=>{loadPatch(presets[28]);focusEffect('delay');});
$('#buffer-demo').addEventListener('click',()=>{$('#audition').click();});
for(const id of ['plan-rate','plan-format','plan-channels','plan-instances','plan-time'])$(`#${id}`).addEventListener('input',renderBuffers);
function recallFields(){const r=patch.recall,set=key=>v=>{r[key]=v;page='mem';updatePatch();};return [field('K1 / BEATS BACK',[1,2,4].indexOf(r.back),0,2,1,v=>set('back')([1,2,4][v]),v=>`${[1,2,4][v]} BEATS`),field('K2 / SLICE LENGTH',[.25,.5,1].indexOf(r.length),0,2,1,v=>set('length')([.25,.5,1][v]),v=>`${[.25,.5,1][v]} BEAT`),field('K3 / RECALL RETURN',r.mix,0,1,.01,set('mix'),v=>`${Math.round(v*100)}%`),field('K4 / RISING EDGES',r.divisor,1,4096,1,set('divisor'),v=>`${v} ↑`)];}
function buildMemory(){
  recallFields().forEach((f,i)=>knob('#recall-knobs',`recall-${i}`,f.name.split(' / ')[1],{...f,onChange:f.set}));
  for(const source of scopeSources){const row=document.createElement('tr');row.dataset.crossingSource=source.id;const label=document.createElement('th');label.scope='row';label.textContent=source.name;label.style.color=source.color;row.append(label);for(const key of ['up','down','total','rate','interval','rms']){const cell=document.createElement('td');cell.id=`zc-${source.id}-${key}`;cell.textContent=key==='interval'?'—':'0';row.append(cell);}$('#crossing-counts').append(row);}
}
function renderMemory(){
  recallFields().forEach((f,i)=>knobControls.get(`recall-${i}`)?.update(f.value,{name:f.name.split(' / ')[1],min:f.min,max:f.max,step:f.step,format:f.format,reset:[2,2,.6,64][i],onChange:f.set}));
  $('#recall-source').value=patch.recall.source;$('#recall-mode').value=patch.recall.mode;$('#recall-trigger-source').value=patch.recall.triggerSource;$('#recall-align').checked=patch.recall.align;$('#zc-hysteresis').value=Number((patch.crossings.hysteresis*100).toFixed(4));$('#zc-gate').value=Number((patch.crossings.gate*100).toFixed(4));$('#memory-tempo').value=tempo;
  const sr=context?.sampleRate||48000,bytes=(Math.ceil(CAS.RECALL_SECONDS*sr)+2*(Math.ceil(CAS.RECALL_CLIP_SECONDS*sr)+2))*4;
  $('#recall-memory').textContent=`Rolling history + two capture banks: ${(bytes/1048576).toFixed(2)} MiB Float32 at ${(sr/1000).toFixed(1)} kHz. An 8 kHz PCM16 port would need about 144.5 KiB before other effects, state and resampling.`;
  renderMemoryStatus();
}
function renderMemoryStatus(){
  const a=liveAnalysis,s=a?.recall,ready=!!s?.ready,active=!!s?.active,busy=!!s?.busy;
  $('#recall-toggle').textContent=active?'RECALL ON · MUTE':s?.hasClip?'RECALL OFF · REPLAY':'GRAB PAST BEAT';$('#recall-toggle').setAttribute('aria-pressed',String(active));$('#recall-toggle').disabled=busy||(!s?.hasClip&&!ready);
  $('#recall-grab').disabled=!ready||busy;$('#recall-arm').disabled=!a?.arm&&(!ready||busy);$('#recall-arm').textContent=a?.arm?`CANCEL · ${a.arm.remaining} ↑ LEFT`:`ARM ${patch.recall.divisor} RISES`;
  $('#recall-history').value=s?.recordedSeconds||0;$('#recall-history-label').textContent=`${(s?.recordedSeconds||0).toFixed(2)} / ${CAS.RECALL_SECONDS} s recorded · ${ready?'READY':`need ${(s?.requiredSeconds||patch.recall.back*60/tempo).toFixed(2)} s`}`;
  $('#recall-status').textContent=!s?'ENABLE AUDIO TO RECORD HISTORY':busy?'CAPTURING / FADING':active?'REPLAYING CAPTURED AUDIO':s.hasClip?'CAPTURE KEPT · RECALL MUTED':'ROLLING HISTORY · RECALL OFF';
  $('#recall-captured').textContent=s?.info?`${s.info.beats} beat from ${s.info.back} beats back · ${s.info.bpm} BPM · ${s.info.source.toUpperCase()} · ${(s.info.rms>0?20*Math.log10(s.info.rms):-120).toFixed(1)} dB before master`:'First grab captures the selected earlier beat. OFF keeps that slice; ON plays it again.';
  for(const source of scopeSources){const c=a?.counts?.[source.id];if(!c)continue;for(const key of ['up','down','total'])$(`#zc-${source.id}-${key}`).textContent=c[key].toLocaleString();$(`#zc-${source.id}-rate`).textContent=c.rate.toFixed(0);$(`#zc-${source.id}-interval`).textContent=c.intervalMs?`${c.intervalMs.toFixed(2)} ms`:'—';$(`#zc-${source.id}-rms`).textContent=c.rms.toFixed(4);}
}
async function recallAction(action){try{await ensureAudio();send({type:'cancel',prefix:'memory-demo:'});send({type:'recall',action});}catch{}}
$('#recall-toggle').addEventListener('click',()=>recallAction('toggle'));$('#recall-grab').addEventListener('click',()=>recallAction('grab'));$('#recall-arm').addEventListener('click',()=>recallAction(liveAnalysis?.arm?'cancel':'arm'));$('#recall-clear').addEventListener('click',()=>recallAction('clear'));
$('#zc-reset').addEventListener('click',()=>{send({type:'resetCrossings'});notify('Crossing counters reset; audio history is kept.');});
for(const [id,key] of [['recall-source','source'],['recall-mode','mode'],['recall-trigger-source','triggerSource']])$(`#${id}`).addEventListener('change',e=>{patch.recall[key]=e.target.value;updatePatch();});
$('#recall-align').addEventListener('change',e=>{patch.recall.align=e.target.checked;updatePatch();});
for(const [id,key,lo,hi] of [['zc-hysteresis','hysteresis',.000001,.05],['zc-gate','gate',0,.1]])$(`#${id}`).addEventListener('change',e=>{patch.crossings[key]=CAS.clamp(Number(e.target.value)/100||0,lo,hi);updatePatch();});
$('#memory-tempo').addEventListener('change',e=>changeTempo(CAS.clamp(Math.round(Number(e.target.value)||110),40,240)));
$('#recall-demo').addEventListener('click',async()=>{try{await ensureAudio();panic();loadPatch(presets[29]);changeTempo(120);setPage('mem');setView('xy');const start=context.currentTime+.05;[60,64,67,72].forEach((note,i)=>{const id=`memory-demo:${i}`;send({type:'on',id,note,velocity:.8,when:start+i*.5});send({type:'off',id,when:start+i*.5+.28});});send({type:'recall',action:'grab',id:'memory-demo:capture',when:start+2.12});notify('Four notes play; then the first beat returns from four beats back.');}catch{}});
async function recallSnapshot(){if(!node||!liveAnalysis?.recall?.hasClip)return null;await ensureAudio();const id=++snapshotSerial;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{snapshotRequests.delete(id);reject(new Error('Could not snapshot captured audio. Try rendering again.'));},2000);snapshotRequests.set(id,{resolve,timeout});send({type:'recallSnapshot',id});});}
function chooseAlgorithm(index){
  if(index<CAS.ALGORITHMS.length)patch=CAS.selectAlgorithm(patch,index);
  else patch.stack.enabled=true;
  updatePatch();
}
function setStackValue(i,key,value){
  const stage=patch.stack.stages[i];stage[key]=value;patch.stack.enabled=true;stackIndex=i;page='alg';
  if(key==='rule'){stage.amount=value==='cheby'?CAS.clamp(Math.round(stage.amount),2,12):CAS.clamp(stage.amount,0,4);if(value==='cheby')stage.source='none';}
  updatePatch();
}
function stackFields(i){
  const s=patch.stack.stages[i],set=k=>v=>setStackValue(i,k,v),cheby=s.rule==='cheby';
  return [field('K1 / RULE',CAS.STACK_RULES.indexOf(s.rule),0,CAS.STACK_RULES.length-1,1,v=>set('rule')(CAS.STACK_RULES[v]),v=>ruleNames[CAS.STACK_RULES[v]]),
    field('K2 / SIDE INPUT',cheby?0:CAS.STACK_SOURCES.indexOf(s.source),0,cheby?0:CAS.STACK_SOURCES.length-1,1,v=>{if(!cheby)set('source')(CAS.STACK_SOURCES[v]);},v=>cheby?'UNUSED':sourceNames[CAS.STACK_SOURCES[v]]),
    field(cheby?'K3 / HARMONIC ORDER':'K3 / AMOUNT',s.amount,cheby?2:0,cheby?12:4,cheby?1:.01,set('amount'),v=>cheby?`T${Math.round(v)}`:s.rule==='rotate'?`${number(v)} rad`:number(v)),
    field('K4 / WET',s.wet,0,1,.01,set('wet'),v=>`${Math.round(v*100)}%`)];
}
function ruleFormula(s){
  const g=number(s.amount),forms={sum:`x + ${g}y`,ring:`${g}xy`,quotient:`tanh(${g}x / (0.15 + |y|))`,magnitude:`sign(x+y) · hypot(${g}x, y)`,angle:`atan2(${g}x, y) / π`,sine:`sin(${g}x + y)`,cosine:`[cos(${g}x + y) − cos(y)] / 2`,fold:`fold(${g}x + y)`,cheby:`[T${s.amount}(clip x) − T${s.amount}(0)] / [1+|T${s.amount}(0)|]`,soft:`tanh(${g}x + y)`,rotate:`x cos(${g}) + y sin(${g})`};
  return forms[s.rule];
}
function buildStack(){
  const picker=$('#stack-algorithm');algorithmNames.forEach((name,i)=>picker.append(option(i,name,false)));
  picker.addEventListener('change',()=>chooseAlgorithm(Number(picker.value)));
  CAS.MODES.forEach((mode,i)=>$('#stack-base').append(option(mode,modeNames[i],false)));
  $('#stack-base').addEventListener('change',e=>{patch.combine=e.target.value;updatePatch();});
  $('#stack-enable').addEventListener('click',()=>{patch.stack.enabled=!patch.stack.enabled;updatePatch();});
  $('#stack-clear').addEventListener('click',()=>{patch.stack=CAS.initStack();stackIndex=0;updatePatch();});
  $('#stack-load-demo').addEventListener('click',()=>{const index=CAS.algorithmIndex(patch);if(index>=6&&index<CAS.ALGORITHMS.length){loadPatch(presets[20+index-6]);stackIndex=0;setPage('alg');}else notify('Choose a compound algorithm to load its demonstration preset.');});
  $('#stack-demo').addEventListener('click',()=>{$('#audition').click();});
  for(let i=0;i<4;i++){
    const card=document.createElement('article');card.className='stack-stage';card.dataset.stage=i;
    const head=document.createElement('div');head.className='stage-heading';
    const title=document.createElement('button');title.className='stage-title';title.textContent=`${String(i+1).padStart(2,'0')} / STAGE`;title.setAttribute('aria-label',`Select stage ${i+1}`);title.addEventListener('click',()=>{stackIndex=i;setPage('alg');});
    const toggle=document.createElement('button');toggle.id=`stage-${i}-enable`;toggle.setAttribute('aria-label',`Enable stage ${i+1}`);toggle.addEventListener('click',()=>setStackValue(i,'enabled',!patch.stack.stages[i].enabled));head.append(title,toggle);card.append(head);
    for(const [key,values,labels] of [['rule',CAS.STACK_RULES,ruleNames],['source',CAS.STACK_SOURCES,sourceNames]]){
      const label=document.createElement('label');label.className='stage-choice';label.textContent=key==='rule'?'RULE':'SIDE INPUT';
      const select=document.createElement('select');select.id=`stage-${i}-${key}`;select.setAttribute('aria-label',`Stage ${i+1} ${key==='rule'?'rule':'side input'}`);values.forEach(v=>select.append(option(v,labels[v],false)));select.addEventListener('change',()=>setStackValue(i,key,select.value));label.append(select);card.append(label);
    }
    const knobs=document.createElement('div');knobs.className='stage-knobs';knobs.id=`stage-${i}-knobs`;card.append(knobs);$('#stack-rack').append(card);
    stackFields(i).slice(2).forEach((f,j)=>knob(`#stage-${i}-knobs`,`stage-${i}-${j}`,f.name.split(' / ')[1],{...f,onChange:f.set}));
    const formula=document.createElement('code');formula.className='stage-formula';formula.id=`stage-${i}-formula`;card.append(formula);
    const moves=document.createElement('div');moves.className='stage-moves';
    for(const [delta,text] of [[-1,'← EARLIER'],[1,'LATER →']]){
      const button=document.createElement('button');button.textContent=text;button.disabled=i+delta<0||i+delta>3;button.setAttribute('aria-label',`Move stage ${i+1} ${delta<0?'earlier':'later'}`);button.addEventListener('click',()=>{const stages=patch.stack.stages;[stages[i],stages[i+delta]]=[stages[i+delta],stages[i]];stackIndex=i+delta;page='alg';updatePatch();});moves.append(button);
    }card.append(moves);
  }
}
function renderStack(){
  if(!$('#stack-rack').children.length)return;
  const index=CAS.algorithmIndex(patch),enabled=patch.stack.enabled,count=patch.stack.stages.filter(s=>s.enabled&&s.wet>0).length;
  $('#stack-algorithm').value=index;$('#stack-base').value=patch.combine;
  $('#stack-enable').textContent=enabled?'Bypass stack':'Enable stack';$('#stack-enable').setAttribute('aria-pressed',String(enabled));
  $('#stack-status').textContent=enabled?`${count} / 4 STAGES ACTIVE`:'STACK BYPASSED';
  const path=patch.stack.stages.flatMap((s,i)=>s.enabled&&s.wet>0?[`${i+1} ${ruleNames[s.rule]}${s.source==='none'||s.rule==='cheby'?'':` (${sourceNames[s.source].split(' · ')[0]})`}`]:[]);
  $('#stack-path').textContent=`BASE: ${modeNames[CAS.MODES.indexOf(patch.combine)]}${enabled&&path.length?' → '+path.join(' → '):''} → VOICE OUTPUT`;
  $('#stack-fit').textContent=CAS.ALGORITHMS[index]?.fit||'Fixed depth: four sequential rules. Hardware cost depends on the chosen operations; this lab does not measure device CPU usage.';
  patch.stack.stages.forEach((s,i)=>{
    const card=$(`[data-stage="${i}"]`);card.classList.toggle('selected',page==='alg'&&stackIndex===i);card.classList.toggle('bypassed',!enabled||!s.enabled);
    const toggle=$(`#stage-${i}-enable`);toggle.textContent=s.enabled?'ON':'OFF';toggle.setAttribute('aria-pressed',String(s.enabled));
    $(`#stage-${i}-rule`).value=s.rule;$(`#stage-${i}-source`).value=s.source;$(`#stage-${i}-source`).disabled=s.rule==='cheby';
    stackFields(i).slice(2).forEach((f,j)=>knobControls.get(`stage-${i}-${j}`)?.update(f.value,{name:f.name.split(' / ')[1],min:f.min,max:f.max,step:f.step,reset:j===1?1:s.rule==='cheby'?3:1,format:f.format,onChange:f.set,ariaLabel:`Stage ${i+1} ${j===1?'wet':s.rule==='cheby'?'harmonic order':'amount'}`}));
    $(`#stage-${i}-formula`).textContent=ruleFormula(s);
  });
}
function pageFields() {
  const set=k=>v=>{patch[k]=v;updatePatch();};
  if(page==='home')return [field('K1 / a · SINE GAIN',patch.a,-2,2,.01,set('a')),field('K2 / b · SINE RATIO',patch.b,-16,16,.01,set('b'),v=>`${number(v)}×`),field('K3 / c · COS GAIN',patch.c,-2,2,.01,set('c')),field('K4 / d · COS RATIO',patch.d,-16,16,.01,set('d'),v=>`${number(v)}×`)];
  if(page==='mem')return recallFields();
  if(page==='alg')return stackFields(stackIndex);
  if(page==='ops') {
    const op=patch.ops[opIndex],setOp=k=>v=>{op[k]=v;updatePatch({table:true});};
    if(detail)return [field('K1 / PM SOURCE',op.source,-1,5,1,setOp('source'),v=>v<0?'NONE':`OP ${v+1}`),field('K2 / PM INDEX',op.index,0,12,.01,setOp('index'),v=>`${number(v)} rad`),field('K3 / START PHASE',op.phase,0,1,.01,setOp('phase'),v=>`${Math.round(v*360)}°`),field('K4 / OP DECAY',op.decay,0,8,.01,setOp('decay'),v=>v===0?'STEADY':`${number(v)} s`)];
    return [field('K1 / OP RATE',op.rate,0,op.mode==='hz'?2000:32,op.mode==='hz'?.1:.01,setOp('rate'),v=>`${number(v)}${op.mode==='hz'?' Hz':'×'}`),field('K2 / OP DEPTH',op.depth,0,4,.01,setOp('depth')),field('K3 / FUNCTION',CAS.WAVES.indexOf(op.wave),0,CAS.WAVES.length-1,1,v=>{op.wave=CAS.WAVES[v];updatePatch({table:true});},v=>waveNames[CAS.WAVES[v]]),field('K4 / DESTINATION',CAS.TARGETS.indexOf(op.target),0,CAS.TARGETS.length-1,1,v=>{op.target=CAS.TARGETS[v];updatePatch({table:true});},v=>targetNames[CAS.TARGETS[v]].split(' · ')[0])];
  }
  if(page==='env')return ['attack','decay','sustain','release'].map((k,i)=>field(`K${i+1} / ${k.toUpperCase()}`,patch.env[k],k==='sustain'?0:.002,k==='sustain'?1:4,k==='sustain'?.01:.002,v=>{patch.env[k]=v;updatePatch();},v=>k==='sustain'?`${Math.round(v*100)}%`:`${number(v,3)} s`));
  if(page==='fx'){if(fxBank>0)return effectFields(fxKeys[fxBank],detail);return [field('K1 / FEEDBACK',patch.feedback,0,2,.01,set('feedback'),v=>`${number(v)} rad`),field('K2 / CROSS PHASE',patch.cross,0,4,.01,set('cross'),v=>`${number(v)} rad`),field('K3 / WAVEFOLD',patch.fold,0,3,.01,set('fold')),field('K4 / DRIVE',patch.drive,0,4,.01,set('drive'))];}
  if(page==='global') {
    if(globalGroup===0)return [field('K1 / POLYPHONY',patch.poly===8?1:0,0,1,1,v=>{patch.poly=v?8:1;updatePatch();},v=>v?'8 VOICES':'MONO'),field('K2 / PHASE RESET',patch.reset?1:0,0,1,1,v=>{patch.reset=!!v;updatePatch();},v=>v?'ON':'FREE'),field('K3 / OVERSAMPLING',[1,2,4].indexOf(patch.quality),0,2,1,v=>{patch.quality=[1,2,4][v];updatePatch();updateAudioLabel();},v=>`${[1,2,4][v]}×`),field('K4 / BIT DEPTH',patch.bits,2,16,1,set('bits'),v=>v===16?'FLOAT':`${v} BIT`)];
    return [field('K1 / TEMPO',tempo,40,240,1,v=>{changeTempo(v);},v=>`${v} BPM`),field('K2 / COUNT-IN',countIn?1:0,0,1,1,v=>{countIn=!!v;renderPanel();},v=>v?'1 BAR':'OFF'),field('K3 / VIEW',['wave','spectrum','xy','route'].indexOf(view),0,3,1,v=>setView(['wave','spectrum','xy','route'][v]),v=>['WAVE','FFT','XY','ROUTE'][v]),field('K4 / FREEZE',frozen?1:0,0,1,1,v=>setFreeze(!!v),v=>v?'FROZEN':'LIVE')];
  }
  return [field('K1 / TEMPO',tempo,40,240,1,v=>changeTempo(v),v=>`${v} BPM`),field('K2 / COUNT-IN',countIn?1:0,0,1,1,v=>{countIn=!!v;renderPanel();},v=>v?'1 BAR':'OFF'),field('K3 / LOOP ROOT',lastNote,24,96,1,v=>{lastNote=v;renderPanel();},v=>noteName(v)),field('K4 / NOTE GATE',gateLength,.1,.95,.01,v=>{gateLength=v;renderPanel();},v=>`${Math.round(v*100)}%`)];
}
let gateLength=.72;
function selectValue(){return page==='mem'?['dry','delay','room','mix'].indexOf(patch.recall.source):page==='ops'?opIndex:page==='alg'?stackIndex:page==='global'?globalGroup:page==='seq'?tempo:page==='fx'?fxBank:patch.feedback;}
function renderPanel() {
  const fields=pageFields();
  const defaults=page==='home'?[.8,1,.55,2]:page==='mem'?[2,2,.6,64]:page==='alg'?[5,0,patch.stack.stages[stackIndex].rule==='cheby'?3:1,1]:page==='ops'?(detail?[-1,0,0,0]:[opIndex+1,0,0,0]):page==='env'?[.012,.45,.65,.5]:page==='fx'?(fxBank>0?effectDefaults(fxKeys[fxBank],detail):[0,0,0,0]):page==='global'?(globalGroup===0?[1,1,1,16]:[110,1,0,0]):[110,1,60,.72];
  fields.forEach((f,i)=>knobControls.get(`k${i}`)?.update(f.value,{name:f.name,min:f.min,max:f.max,step:f.step,reset:defaults[i],format:f.format,onChange:v=>{selectedField=i;f.set(v);}}));
  knobControls.get('master')?.update(patch.volume);
  knobControls.get('preset')?.update(Math.max(0,presets.findIndex(p=>p.name===patch.name)));
  let selectOptions={name:'SELECT / FEEDBACK',min:0,max:2,step:.01,format:v=>`${number(v)} rad`};
  if(page==='ops')selectOptions={name:'SELECT / OPERATOR',...enums([0,1,2,3,4,5],['OP 1','OP 2','OP 3','OP 4','OP 5','OP 6'])};
  else if(page==='mem')selectOptions={name:'SELECT / HISTORY INPUT',...enums(['dry','delay','room','mix'],['DRY','DELAY','ROOM','MIX'])};
  else if(page==='alg')selectOptions={name:'SELECT / STAGE',...enums([0,1,2,3],['STAGE 1','STAGE 2','STAGE 3','STAGE 4'])};
  else if(page==='global')selectOptions={name:'SELECT / GROUP',...enums([0,1],['VOICE','CLOCK / VIEW'])};
  else if(page==='seq')selectOptions={name:'SELECT / TEMPO',min:40,max:240,step:1,format:v=>`${v} BPM`};
  else if(page==='fx')selectOptions={name:'SELECT / ELEMENT',...enums(fxBanks)};
  knobControls.get('select')?.update(selectValue(),selectOptions);
  const op=patch.ops[opIndex];
  let alg={name:'ALGORITHM / STACK',...enums(algorithmNames)};let algValue=CAS.algorithmIndex(patch);
  if(page==='mem'){alg={name:'ALGORITHM / RECALL',...enums(['loop','once'],['LOOP','ONE SHOT'])};algValue=patch.recall.mode==='once'?1:0;}
  if(page==='ops'){alg={name:'ALGORITHM / CLOCK',...enums(['ratio','hz'],['RATIO','FIXED HZ'])};algValue=op.mode==='hz'?1:0;}
  if(page==='fx'&&fxKeys[fxBank]==='shaper'){alg={name:'ALGORITHM / SHAPER',...enums(['sine','cosine','cheby'],['SINE','COSINE','CHEBYSHEV'])};algValue=['sine','cosine','cheby'].indexOf(patch.fx.shaper.mode);}
  if(page==='fx'&&fxKeys[fxBank]==='mod'){alg={name:'ALGORITHM / MOD',...enums(['ring','tremolo'],['RING','TREMOLO'])};algValue=patch.fx.mod.mode==='ring'?0:1;}
  if(page==='fx'&&['delay','reverb'].includes(fxKeys[fxBank])){alg={name:'ALGORITHM / LOOP',...enums(CAS.LOOP_MODES,['CLEAN','SINE','SINE → FOLD'])};algValue=CAS.LOOP_MODES.indexOf(patch.fx[fxKeys[fxBank]].mode);}
  knobControls.get('algorithm')?.update(algValue,alg);
  $$('#main-knobs .knob').forEach((el,i)=>el.classList.toggle('touched',i===selectedField));
  $$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('#patch-name').textContent=patch.name+(dirty?' *':'');
  const titles={home:'HOME / COEFFICIENTS',mem:'MEMORY / CROSSING RECALL',ops:`OP ${opIndex+1} / ${detail?'PHASE NETWORK':'MODULATION'}`,alg:`STAGE ${stackIndex+1} / NESTED RULES`,env:'ENVELOPE / PER VOICE',fx:`FX / ${fxBanks[fxBank]}${detail&&fxBank>=6?' / LOOP':''}`,global:`GLOBAL / ${globalGroup?'CLOCK & DISPLAY':'VOICE ENGINE'}`,seq:'SEQUENCER / NOTE LOOP'};
  $('#screen-page').textContent=titles[page];
  $('#screen-status').textContent=shift?'SCL · FINE / PLAY HOLD / REC UNDO':`${algorithmNames[CAS.algorithmIndex(patch)]} · ${frozen?'FROZEN':recordState.toUpperCase()}`;
  if(page==='alg'&&!shift)$('#screen-status').textContent=`${patch.stack.enabled?'STACK ON':'STACK BYPASSED'} · STAGE ${patch.stack.stages[stackIndex].enabled?'ON':'OFF'} · EDIT TO TOGGLE`;
  if(page==='fx'&&fxBank>0&&!shift){const on=fxBank===1?patch.phaseEnabled:patch.fx[fxKeys[fxBank]].enabled;$('#screen-status').textContent=`${on?'ON':'OFF'} · EDIT TO ${on?'BYPASS':'ENABLE'}${patch.fx.bypass&&fxBank>1?' · FX BYPASS':''}`;}
  const overlay=$('#page-overlay');overlay.hidden=page==='home'||view==='route'||view==='xy';
  overlay.replaceChildren();
  if(!overlay.hidden)for(const f of fields){const row=document.createElement('div');row.className='screen-field';const label=document.createElement('span'),value=document.createElement('strong');label.textContent=f.name.split(' / ')[1];value.textContent=f.format(f.value);row.append(label,value);overlay.append(row);}
  $('#hold').setAttribute('aria-pressed',String(hold));$('#play').classList.toggle('active',recordState!=='stopped');$('#rec').classList.toggle('active',recordArmed||['recording','overdub'].includes(recordState));
  $('#transport-status').textContent=`${recordArmed&&recordState==='stopped'?'ARMED':recordState.toUpperCase()} · ${tempo} BPM${pattern.length?` · ${pattern.length} NOTES`:''}`;
  updateAudioLabel();renderRack();renderStack();renderBuffers();renderScopeControls();renderMemory();harmonicPalette?.refresh();
}
knob('#preset-knob','preset','PRESETS',{min:0,max:presets.length-1,step:1,value:0,format:v=>String(Math.round(v)).padStart(2,'0'),onChange:v=>loadPatch(presets[v])});
knob('#select-knob','select','SELECT',{min:0,max:2,step:.01,onChange:v=>{if(page==='mem'){patch.recall.source=['dry','delay','room','mix'][v];updatePatch();}else if(page==='ops'){opIndex=v;renderOperators();renderPanel();}else if(page==='alg'){stackIndex=v;renderPanel();}else if(page==='global'){globalGroup=v;renderPanel();}else if(page==='seq')changeTempo(v);else if(page==='fx'){fxBank=v;detail=false;renderPanel();}else{patch.feedback=v;updatePatch();}}});
knob('#algorithm-knob','algorithm','ALGORITHM',{...enums(algorithmNames),onChange:v=>{if(page==='mem'){patch.recall.mode=v?'once':'loop';updatePatch();}else if(page==='ops'){const op=patch.ops[opIndex];op.mode=v?'hz':'ratio';op.rate=Math.min(op.rate,v?2000:32);updatePatch({table:true});}else if(page==='fx'&&fxKeys[fxBank]==='shaper')setEffectMode('shaper',['sine','cosine','cheby'][v]);else if(page==='fx'&&fxKeys[fxBank]==='mod')setEffectMode('mod',['ring','tremolo'][v]);else if(page==='fx'&&['delay','reverb'].includes(fxKeys[fxBank]))setEffectMode(fxKeys[fxBank],CAS.LOOP_MODES[v]);else chooseAlgorithm(v);}});
knob('#master-knob','master','MASTER',{value:patch.volume,reset:.55,min:0,max:1,step:.01,format:v=>`${Math.round(v*100)}%`,onChange:v=>{patch.volume=v;updatePatch();}});
for(let i=0;i<4;i++)knob('#main-knobs',`k${i}`,`KNOB ${i+1}`);

function setPage(next){page=next;detail=false;renderPanel();}
function setView(next){view=next;$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('#scope').setAttribute('aria-label',`Live ${view==='xy'?'source vectorscope':view==='spectrum'?'output frequency spectrum':view==='route'?'operator routing diagram':'output waveform'}`);renderPanel();}
function renderScopeControls(){
  $('#scope-sources').hidden=view!=='xy';$('#scope-source-toggles').hidden=xyMap!=='sources';$('#xy-map').value=xyMap;$('#xy-gain').value=xyGain;
  $$('[data-scope-source]').forEach(b=>b.setAttribute('aria-pressed',String(sourceVisibility[b.dataset.scopeSource])));
  $('#scope-crossings').setAttribute('aria-pressed',String(showCrossings));
  if(view==='xy')$('#scope').setAttribute('aria-label',xyMap==='sources'?'Live color-separated dry, delay and room vectorscope: each source versus its value 0.5 milliseconds earlier':'Live carrier XY trajectory: sine branch versus cosine branch');
}
$$('[data-scope-source]').forEach(b=>b.addEventListener('click',()=>{sourceVisibility[b.dataset.scopeSource]=!sourceVisibility[b.dataset.scopeSource];renderScopeControls();}));
$('#xy-map').addEventListener('change',e=>{xyMap=e.target.value;renderScopeControls();});
$('#xy-gain').addEventListener('change',e=>{xyGain=Number(e.target.value);});
$('#scope-crossings').addEventListener('click',()=>{showCrossings=!showCrossings;renderScopeControls();});
function setFreeze(value){frozen=value;$('#freeze').setAttribute('aria-pressed',String(value));renderPanel();}
function loadPatch(p){patch=CAS.sanitize(p);dirty=false;send({type:'patch',patch});send({type:'clearBuffers'});renderOperators();renderPanel();updateTheoryMetric();}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.page==='fx'&&shift){patch.fx.bypass=!patch.fx.bypass;updatePatch();return;}if(b.dataset.page==='home'&&shift){setPage('global');globalGroup=1;renderPanel();return;}if(page==='home'&&b.dataset.page==='home')setView(view==='wave'?'xy':'wave');setPage(b.dataset.page);}));
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('#freeze').addEventListener('click',()=>setFreeze(!frozen));
$('#wake').addEventListener('click',()=>ensureAudio().catch(()=>{}));
$('#audition').addEventListener('click',async()=>{try{await ensureAudio();[60,64,67].forEach((n,i)=>{const id=`audition:${Date.now()}:${i}`;send({type:'on',id,note:n,velocity:.7,when:context.currentTime+.03});send({type:'off',id,when:context.currentTime+1.4});});}catch{}});
$('#panic').addEventListener('click',panic);
$('#edit').addEventListener('click',()=>{if(page==='mem')recallAction(shift?'grab':'toggle');else if(page==='ops'){detail=!detail;renderPanel();}else if(page==='alg')setStackValue(stackIndex,'enabled',!patch.stack.stages[stackIndex].enabled);else if(page==='fx'&&fxBank>=6&&shift){detail=!detail;renderPanel();}else if(page==='fx'&&fxBank>0)toggleEffect(fxKeys[fxBank]);else if(page==='home'&&shift&&[1,3].includes(selectedField)){const key=selectedField===1?'b':'d';patch[key]=Math.round(patch[key]*2)/2;updatePatch();}else notify(page==='home'?'SCL + EDIT snaps the last touched B or D ratio.':'Turn a knob to edit its displayed field.');});
$('#hold').addEventListener('click',()=>setHold(!hold));
$('#shift').addEventListener('click',()=>{latchedShift=!latchedShift;shift=latchedShift;$('#shift').setAttribute('aria-pressed',String(shift));renderPanel();});
$('#save').addEventListener('click',()=>{try{localStorage.setItem('cas-tone-lab-patch',JSON.stringify(patch));dirty=false;renderPanel();notify('Patch saved in this browser. Export JSON for a portable copy.');}catch{notify('Browser storage unavailable. Use Export patch.');}});
$('#oct-down').addEventListener('click',()=>{if(shift)panic();else changeOctave(-1);});$('#oct-up').addEventListener('click',()=>changeOctave(1));
function changeOctave(delta){stopLiveInputs();octave=CAS.clamp(octave+delta,0,7);renderKeyboard();}

function option(value,label,selected){const o=document.createElement('option');o.value=value;o.textContent=label;o.selected=selected;return o;}
function renderOperators() {
  const body=$('#operators');body.replaceChildren();
  patch.ops.forEach((op,i)=>{
    const row=document.createElement('tr');row.classList.toggle('selected',i===opIndex);row.dataset.op=i;
    const first=document.createElement('td'),check=document.createElement('input'),label=document.createElement('label');
    check.type='checkbox';check.className='op-toggle';check.checked=op.enabled;check.id=`op-${i}-enabled`;check.setAttribute('aria-label',`Enable operator ${i+1}`);
    label.className='op-label';label.textContent=`OP ${String(i+1).padStart(2,'0')}`;label.htmlFor=check.id;first.append(check,label);row.append(first);
    check.addEventListener('change',()=>{op.enabled=check.checked;opIndex=i;updatePatch();});
    const addSelect=(key,choices,labels)=>{const td=document.createElement('td'),select=document.createElement('select');select.setAttribute('aria-label',`Operator ${i+1} ${key}`);select.dataset.key=key;choices.forEach((v,j)=>select.append(option(v,labels[j],String(op[key])===String(v))));select.addEventListener('change',()=>{op[key]=key==='source'?Number(select.value):select.value;opIndex=i;if(key==='mode'){op.rate=Math.min(op.rate,op.mode==='hz'?2000:32);renderOperators();}updatePatch();});td.append(select);row.append(td);};
    const addNumber=(key,min,max,step)=>{const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.value=op[key];input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',`Operator ${i+1} ${key}`);input.dataset.key=key;input.addEventListener('change',()=>{op[key]=CAS.clamp(Number(input.value)||0,min,max);input.value=op[key];opIndex=i;updatePatch();});td.append(input);row.append(td);};
    addSelect('wave',CAS.WAVES,CAS.WAVES.map(w=>waveNames[w]));addSelect('mode',['ratio','hz'],['Ratio × note','Fixed Hz']);addNumber('rate',0,op.mode==='hz'?2000:32,.01);addNumber('depth',0,4,.01);addSelect('target',CAS.TARGETS,CAS.TARGETS.map(t=>targetNames[t]));addSelect('source',[-1,0,1,2,3,4,5],['None','OP 1','OP 2','OP 3','OP 4','OP 5','OP 6']);addNumber('index',0,12,.01);addNumber('decay',0,8,.01);
    row.addEventListener('focusin',()=>{if(opIndex!==i){opIndex=i;$$('#operators tr').forEach((r,j)=>r.classList.toggle('selected',j===i));renderPanel();}});body.append(row);
  });
}
$('#clear-ops').addEventListener('click',()=>{patch.ops=CAS.initPatch().ops;updatePatch({table:true});notify('All operator destinations and depths cleared.');});
$('#fx-bypass').addEventListener('click',()=>{patch.fx.bypass=!patch.fx.bypass;updatePatch();});

const keyMap=['a','w','s','e','d','f','t','g','y','h','u','j','k','o','l','p',';'];
function renderKeyboard(){const root=$('#keyboard');root.replaceChildren();let whites=0;const whiteCount=15;
  for(let semi=0;semi<=24;semi++){const midi=(octave+1)*12+semi,black=[1,3,6,8,10].includes(midi%12),b=document.createElement('button');b.type='button';b.className=`piano-key ${black?'black':'white'}`;b.dataset.note=midi;b.setAttribute('aria-label',`Play ${noteName(midi)}`);b.textContent=semi%12===0?noteName(midi):semi<keyMap.length?keyMap[semi].toUpperCase():'';
    if(black)b.style.left=`${whites/whiteCount*100-1.85}%`;else whites++;
    b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);const id=`pointer:${e.pointerId}`;pointerNotes.set(e.pointerId,id);noteOn(id,midi);});
    const release=e=>{const id=pointerNotes.get(e.pointerId);if(id){pointerNotes.delete(e.pointerId);noteOff(id);}};b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);
    b.addEventListener('click',e=>{if(e.detail!==0)return;const id=`accessible:${midi}:${Date.now()}`;noteOn(id,midi).then(()=>setTimeout(()=>noteOff(id),180));});root.append(b);
  }$('#octave-label').textContent=`C${octave}—C${octave+2}`;renderKeys();}
function renderKeys(){const held=new Set(activeNotes.values());$$('.piano-key').forEach(k=>{const on=held.has(Number(k.dataset.note));k.classList.toggle('active',on);k.setAttribute('aria-pressed',String(on));});}
document.addEventListener('keydown',e=>{
  if($('#grid-replace-dialog').open)return;
  if(e.key==='Escape'){e.preventDefault();panic();return;}
  if(e.key==='Shift'){shift=true;$('#shift').setAttribute('aria-pressed','true');renderPanel();return;}
  if(e.repeat||e.ctrlKey||e.metaKey||e.altKey||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.code==='Space'){if(e.target.closest('button'))return;e.preventDefault();if(shift)setHold(!hold);else togglePlay();return;}
  const key=e.key.toLowerCase(),index=keyMap.indexOf(key);if(index<0)return;e.preventDefault();
  const id=`key:${key}`;keyboardNotes.set(key,id);noteOn(id,(octave+1)*12+index);
});
document.addEventListener('keyup',e=>{if(e.key==='Shift'){shift=latchedShift;$('#shift').setAttribute('aria-pressed',String(shift));renderPanel();}const id=keyboardNotes.get(e.key.toLowerCase());if(id){keyboardNotes.delete(e.key.toLowerCase());noteOff(id);}});
window.addEventListener('blur',()=>{shift=latchedShift;$('#shift').setAttribute('aria-pressed',String(shift));stopLiveInputs();renderPanel();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLiveInputs();if(recordState!=='stopped'){stopTransport();notify('Loop stopped while the lab was hidden.');}}});

function loopBeats(){return 4;}
function nowBeat(){return (context.currentTime-loopStart)*tempo/60;}
function changeTempo(value){if(recordState!=='stopped')stopTransport();tempo=CAS.clamp(value,40,240);send({type:'clock',tempo});renderPanel();}
function recordOn(id,note,velocity){if(!['recording','overdub'].includes(recordState))return;if(pattern.length>=512){notify('Loop full: 512 notes.');return;}recordPending.set(id,{note,velocity,start:Math.max(0,nowBeat())});}
function finishRecorded(id,end){const take=recordPending.get(id);if(!take)return;recordPending.delete(id);if(pattern.length>=512)return;const start=Math.round(take.start*4)/4;pattern.push({note:take.note,velocity:take.velocity,beat:((start%4)+4)%4,duration:CAS.clamp(end-take.start,.08,4)});renderSteps();}
function recordOff(id){if(context)finishRecorded(id,Math.max(0,nowBeat()));}
function finishTake(){if(context){const end=Math.max(0,nowBeat());for(const id of [...recordPending.keys()])finishRecorded(id,end);}renderSteps();}
function beginTake(replace){undoPattern=clone(pattern);if(replace)pattern=[];recordPending.clear();recordCycle=Math.floor(Math.max(0,nowBeat())/4);renderSteps();}
function stopTransport(){if(['recording','overdub'].includes(recordState))finishTake();recordState='stopped';recordArmed=false;send({type:'cancel',prefix:'seq:'});scheduledCycle=-1;currentStep=-1;renderSteps();renderPanel();}
async function togglePlay(){if(shift){setHold(!hold);return;}if(recordState!=='stopped'){stopTransport();return;}try{await ensureAudio();}catch{return;}loopStart=context.currentTime+(recordArmed&&countIn?4*60/tempo:.06);scheduledCycle=-1;
  if(recordArmed){beginTake(true);recordState=countIn?'count-in':'recording';}else recordState='playing';renderPanel();schedule();}
function toggleRecord(){if(shift){undoTake();return;}if(recordState==='stopped'){recordArmed=!recordArmed;renderPanel();return;}if(recordState==='count-in'){notify('Count-in is running. PLAY cancels.');return;}if(['recording','overdub'].includes(recordState)){finishTake();recordState='playing';recordArmed=false;}else{beginTake(false);recordState='overdub';}renderPanel();}
function undoTake(){if(['recording','overdub','count-in'].includes(recordState)){notify('Finish or stop the take before undo.');return;}if(undoPattern){const old=pattern;pattern=undoPattern;undoPattern=old;send({type:'cancel',prefix:'seq:'});scheduledCycle=Math.floor(Math.max(0,context?nowBeat():0)/4);renderSteps();renderPanel();notify('Take restored.');}else notify('No completed take to undo.');}
function schedule(){if(!context||recordState==='stopped')return;const time=context.currentTime,beat=nowBeat();
  if(recordState==='count-in'&&beat>=0){recordState='recording';recordCycle=0;renderPanel();}
  if(recordState==='recording'&&beat>=4){finishTake();recordState='playing';recordArmed=false;scheduledCycle=0;renderPanel();}
  const cycle=Math.max(0,Math.floor((beat+.12*tempo/60)/4));
  if(recordState!=='count-in'&&recordState!=='recording'&&cycle>scheduledCycle){for(let c=Math.max(0,scheduledCycle+1);c<=cycle;c++){pattern.forEach((n,i)=>{const when=loopStart+(c*4+n.beat)*60/tempo;if(when<time-.02)return;const id=`seq:${c}:${i}`;send({type:'on',id,note:n.note,velocity:n.velocity,when});send({type:'off',id,when:when+n.duration*60/tempo});});}scheduledCycle=cycle;}
  const step=beat<0?-1:Math.floor(((beat%4)+4)%4*4);if(step!==currentStep){currentStep=step;renderSteps();}
  if(beat<0)$('#transport-status').textContent=`COUNT-IN · ${Math.ceil(-beat)} · ${tempo} BPM`;
}
setInterval(schedule,25);
$('#play').addEventListener('click',togglePlay);$('#rec').addEventListener('click',toggleRecord);$('#undo').addEventListener('click',undoTake);
function renderSteps(){const root=$('#steps');root.replaceChildren();for(let i=0;i<16;i++){const notes=pattern.filter(n=>Math.floor(n.beat*4)===i),b=document.createElement('button');b.className=`step${notes.length?' filled':''}${currentStep===i?' playing':''}`;b.innerHTML=`${String(i+1).padStart(2,'0')}<span>${notes.length?noteName(notes[0].note):'—'}</span>`;b.setAttribute('aria-label',`Step ${i+1}: ${notes.length?notes.map(n=>noteName(n.note)).join(', '):'empty'}. Click to ${notes.length?'clear':'add last played note'}.`);b.addEventListener('click',()=>{if(['recording','overdub','count-in'].includes(recordState)){notify('Finish the take before editing steps.');return;}undoPattern=clone(pattern);if(notes.length)pattern=pattern.filter(n=>Math.floor(n.beat*4)!==i);else if(pattern.length<512)pattern.push({note:lastNote,velocity:.8,beat:i/4,duration:gateLength/4});if(recordState==='playing')stopTransport();renderSteps();renderPanel();});root.append(b);}$('#loop-position').textContent=`${String(Math.max(0,currentStep)+1).padStart(2,'0')} / 16`;}
$('#clear-loop').addEventListener('click',()=>{stopTransport();undoPattern=clone(pattern);pattern=[];renderSteps();notify('Note loop cleared.');});
$('#demo-loop').addEventListener('click',()=>{stopTransport();undoPattern=clone(pattern);pattern=[60,67,72,64,67,74,72,67].map((note,i)=>({note,velocity:.72,beat:i*.5,duration:.32}));renderSteps();renderPanel();notify('Demo loop loaded. Press PLAY.');});

function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export').addEventListener('click',()=>download(new Blob([JSON.stringify({format:'cas-tone-lab',version:1,patch,pattern,tempo},null,2)],{type:'application/json'}),'cas-tone-patch.json'));
$('#import').addEventListener('click',()=>$('#patch-file').click());
$('#patch-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>200000)throw new Error('Patch file is too large.');const data=JSON.parse(await file.text());if(!data||data.format!=='cas-tone-lab'||data.version!==1||!data.patch)throw new Error('Choose a CAS Tone Lab version 1 patch.');stopTransport();loadPatch(data.patch);tempo=CAS.clamp(Number(data.tempo)||110,40,240);send({type:'clock',tempo});pattern=Array.isArray(data.pattern)?data.pattern.slice(0,512).filter(n=>[n.note,n.beat,n.duration,n.velocity].every(Number.isFinite)).map(n=>({note:CAS.clamp(Math.round(n.note),0,127),beat:CAS.clamp(n.beat,0,3.999),duration:CAS.clamp(n.duration,.04,4),velocity:CAS.clamp(n.velocity,0,1)})):[];renderSteps();renderPanel();notify('Patch and note loop imported.');}catch(error){notify(error.message);}e.target.value='';});
function encodeWav(samples,sr){const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);const text=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));text(0,'RIFF');v.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);samples.forEach((x,i)=>v.setInt16(44+i*2,Math.round(CAS.clamp(x,-1,1)*32767),true));return buffer;}
$('#wav').addEventListener('click',async()=>{const b=$('#wav');b.disabled=true;b.textContent='Rendering…';try{await new Promise(r=>setTimeout(r,25));const captured=await recallSnapshot(),sr=48000,p=clone(patch),tail=CAS.tailSeconds(p.fx),length=Math.ceil((4+p.env.release+tail)*sr),engine=new CAS.Engine(sr,p),samples=new Float32Array(length);engine.setTempo(tempo);if(captured)engine.recall.restore(captured);engine.noteOn('render',60,.8);for(let i=0;i<length;i++){if(i===sr*4){engine.noteOff('render');engine.recall.stop();}const fade=tail>=12&&i>length-sr*.05?.5+.5*Math.cos(Math.PI*(i-length+sr*.05)/(sr*.05)):1;samples[i]=engine.next()*fade;if(i%48000===0)await new Promise(r=>setTimeout(r,0));}download(new Blob([encodeWav(samples,sr)],{type:'audio/wav'}),'cas-tone-c4.wav');notify(`Rendered C4 with effects${captured?.active?' and the captured recall slice':''}.${tail>=12?' Tail capped at 12 seconds and faded.':''}`);}catch(error){notify(error.message);}finally{b.disabled=false;b.textContent='Render WAV';}});

function showExperiment(i){experimentIndex=i;$$('#experiments button').forEach((b,j)=>b.classList.toggle('active',i===j));const e=experiments[i],root=$('#theory-detail');root.replaceChildren();const title=document.createElement('h3');title.textContent=e.title.substring(5);const equation=document.createElement('div');equation.className='equation';equation.textContent=e.equation;const p=document.createElement('p');p.textContent=e.text;const observation=document.createElement('p');observation.textContent=e.observe;const action=document.createElement('div');action.className='experiment-action';const b=document.createElement('button');b.className='primary';b.textContent='Load experiment';b.addEventListener('click',()=>{loadPatch(e.patch);setPage('home');setView(i===0?'xy':i===4?'route':'spectrum');notify('Experiment loaded. Play a key or the chord.');});const metric=document.createElement('span');metric.id='theory-metric';action.append(b,metric);root.append(title,equation,p);if(e.observe)root.append(observation);root.append(action);if(e.url){const citation=document.createElement('p'),a=document.createElement('a');a.href=e.url;a.target='_blank';a.rel='noreferrer';a.textContent=e.source;citation.append(a);root.append(citation);}updateTheoryMetric();}
experiments.forEach((e,i)=>{const b=document.createElement('button');b.append(document.createTextNode(e.title));const sub=document.createElement('small');sub.textContent=e.sub;b.append(sub);b.addEventListener('click',()=>showExperiment(i));$('#experiments').append(b);});
function updateTheoryMetric(){const el=$('#theory-metric');if(!el)return;el.textContent=experimentIndex===0?`BASE R = ${Math.hypot(patch.a,patch.c).toFixed(3)} · φ = ${(Math.atan2(patch.c,patch.a)*180/Math.PI).toFixed(1)}°`:`${patch.ops.filter(o=>o.enabled&&o.depth>0).length} ACTIVE OPERATORS`;}

const canvas=$('#scope'),ctx=canvas.getContext('2d');
function spectrum(values){const n=1024,re=new Float64Array(n),im=new Float64Array(n);for(let i=0;i<n;i++)re[i]=values[i]*(.5-.5*Math.cos(CAS.TAU*i/(n-1)));fft(re,im);return Array.from({length:n/2},(_,i)=>20*Math.log10(Math.max(1e-8,Math.hypot(re[i],im[i])*4/n)));}
function drawGrid(w,h){ctx.strokeStyle='#36644c33';ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<=8;i++){const x=i*w/8;ctx.moveTo(x,0);ctx.lineTo(x,h);}for(let j=0;j<=4;j++){const y=j*h/4;ctx.moveTo(0,y);ctx.lineTo(w,y);}ctx.stroke();}
function drawRoutes(w,h){const pad=26,left=pad+18,right=w-54,step=(h-30)/6;ctx.font='9px monospace';ctx.textAlign='left';patch.ops.forEach((op,i)=>{const y=15+i*step;ctx.fillStyle=COLORS[i];ctx.fillText(`OP${i+1}`,2,y+3);ctx.fillStyle=op.enabled&&op.depth>0?COLORS[i]:'#33503e';ctx.beginPath();ctx.arc(left,y,3,0,CAS.TAU);ctx.fill();if(op.enabled&&op.depth>0&&op.target!=='off'){ctx.strokeStyle=COLORS[i]+'88';ctx.beginPath();ctx.moveTo(left+4,y);ctx.lineTo(right-12,y);ctx.stroke();ctx.fillStyle='#9dcab0';ctx.fillText(op.target.toUpperCase(),right-5,y+3);}if(op.enabled&&op.source>=0&&op.index>0){const sy=15+op.source*step;ctx.strokeStyle=COLORS[op.source]+'aa';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(left,sy);ctx.bezierCurveTo(left+30,sy,left+30,y,left,y);ctx.stroke();ctx.setLineDash([]);}});ctx.fillStyle='#6a9980';ctx.fillText('SOLID: DESTINATION   DOTTED: OP PHASE INPUT',0,h-1);}
function drawVectors(w,h){
  ctx.save();ctx.beginPath();ctx.rect(0,0,w,h-16);ctx.clip();
  if(xyMap==='carriers'){
    ctx.strokeStyle='#97e0bd';ctx.lineWidth=1.2;ctx.beginPath();for(let i=0;i<scope.y.length;i++){const x=w/2+scope.s[i]*w*1.7*xyGain,y=(h-16)/2-scope.c[i]*(h-16)*1.7*xyGain;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
  }else{
    const lag=Math.max(1,Math.round(scope.sampleRate*.0005)),scale=Math.min(w,h-16)*2.5*xyGain;
    for(const source of scopeSources){
      const values=scope[source.id];if(!values)continue;
      const rms=Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);$(`#scope-level-${source.id}`).textContent=rms>1e-6?`${(20*Math.log10(rms)).toFixed(0)} dB`:'−∞';
      if(!sourceVisibility[source.id]||rms<1e-7)continue;
      ctx.strokeStyle=source.color;ctx.lineWidth=source.id==='delay'?1.6:1.15;ctx.setLineDash(source.dash);ctx.beginPath();
      for(let i=lag;i<values.length;i++){const x=w/2+values[i]*scale,y=(h-16)/2-values[i-lag]*scale;if(i===lag)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
      if(showCrossings&&scope.edges?.[source.id]){ctx.setLineDash([]);for(let i=lag;i<values.length;i++){const edge=scope.edges[source.id][i];if(!edge)continue;ctx.beginPath();ctx.arc(w/2+values[i]*scale,(h-16)/2-values[i-lag]*scale,2.1,0,CAS.TAU);if(edge>0){ctx.fillStyle=source.color;ctx.fill();}else ctx.stroke();}}
    }
  }
  ctx.restore();ctx.fillStyle='#87aa97';ctx.font='8px monospace';ctx.fillText(xyMap==='sources'?`X: SOURCE NOW   Y: −0.5 ms   ${xyGain}×`:`SINE → X    COSINE → Y    ${xyGain}×`,7,h-5);
}
function draw(time){requestAnimationFrame(draw);if(time-lastDraw<33)return;lastDraw=time;const ratio=Math.min(devicePixelRatio||1,2),box=canvas.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height);if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);drawGrid(w,h);
  if(view==='route')drawRoutes(w,h);
  else if(view==='xy')drawVectors(w,h);
  else if(view==='spectrum'){const bins=spectrum(scope.y),maxHz=scope.sampleRate/2;ctx.strokeStyle='#a3e1bd';ctx.lineWidth=1.5;ctx.beginPath();for(let i=1;i<bins.length;i++){const hz=i*scope.sampleRate/1024,x=(Math.log2(Math.max(40,hz)/40)/Math.log2(maxHz/40))*w,y=h-18-CAS.clamp((bins[i]+90)/90,0,1)*(h-25);if(i===1)ctx.moveTo(Math.max(0,x),y);else ctx.lineTo(x,y);}ctx.stroke();ctx.font='8px monospace';ctx.fillStyle='#6e9b82';for(const hz of [100,1000,10000]){const x=Math.log2(hz/40)/Math.log2(maxHz/40)*w;ctx.fillText(hz>=1000?`${hz/1000}k`:`${hz}Hz`,CAS.clamp(x,0,w-26),h-4);}ctx.fillText('0 dBFS',4,9);ctx.fillText('−90',4,h-20);}
  else {let start=0;for(let i=0;i<256;i++)if(scope.y[i]<=0&&scope.y[i+1]>0){start=i;break;}const count=Math.min(768,scope.y.length-start);const path=(a,color,scale)=>{ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();for(let i=0;i<count;i++){const x=i*w/(count-1),y=h/2-a[start+i]*h*scale;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();};path(scope.s,'#c6a06b77',1.5);path(scope.c,'#8d9dc077',1.5);path(scope.y,'#9ae8c3',1.5);ctx.font='8px monospace';ctx.fillStyle='#6e9b82';ctx.fillText(`${(count/scope.sampleRate*1000).toFixed(1)} ms   S + C → OUTPUT`,7,h-6);}
  $('#screen-level').textContent=scope.rms>1e-6?`${(20*Math.log10(scope.rms)).toFixed(1)} dBFS`:'−∞ dBFS';
}

// Optional MIDI input is receive-only. No port is opened until the user asks.
const midiButton=document.createElement('button');midiButton.textContent='MIDI input';midiButton.id='midi';$('.workbench .toolbar').prepend(midiButton);
midiButton.addEventListener('click',async()=>{if(midiAccess){if(midiInput)midiInput.onmidimessage=null;for(const id of [...activeNotes.keys()])if(id.startsWith('midi:'))noteOff(id,{force:true});midiAccess=null;midiInput=null;midiButton.textContent='MIDI input';return;}try{if(!navigator.requestMIDIAccess)throw new Error('This browser does not support MIDI input.');await ensureAudio();midiAccess=await navigator.requestMIDIAccess({sysex:false});const inputs=[...midiAccess.inputs.values()];if(!inputs.length){midiAccess=null;throw new Error('No MIDI input found.');}midiInput=inputs[0];midiInput.onmidimessage=({data})=>{const type=data[0]&0xf0,id=`midi:${data[0]&15}:${data[1]}`;if(type===0x90&&data[2])noteOn(id,data[1],data[2]/127);else if(type===0x80||type===0x90)noteOff(id);else if(type===0xb0&&[120,123].includes(data[1]))for(const key of [...activeNotes.keys()])if(key.startsWith('midi:'))noteOff(key,{force:true});};midiButton.textContent=`MIDI: ${midiInput.name}`;notify(`Listening to ${midiInput.name}.`);}catch(error){notify(error.message);}});

try{const saved=localStorage.getItem('cas-tone-lab-patch');if(saved)bootPatch=CAS.sanitize(JSON.parse(saved));}catch{}
if(bootPatch)patch=bootPatch;
buildStack();buildRack();buildMemory();renderKeyboard();renderOperators();renderSteps();showExperiment(0);renderPanel();requestAnimationFrame(draw);
let gridReplacePending=false;
async function confirmGridPatchReplace(action){
  if(!dirty)return true;if(gridReplacePending)return false;gridReplacePending=true;
  const dialog=$('#grid-replace-dialog');$('#grid-replace-message').textContent=`${action} will load another synth patch. Your current synth edits have not been saved.`;
  return new Promise(resolve=>{const finish=replace=>{dialog.close();gridReplacePending=false;$('#grid-replace-keep').onclick=$('#grid-replace-accept').onclick=dialog.oncancel=null;resolve(replace);};$('#grid-replace-keep').onclick=()=>finish(false);$('#grid-replace-accept').onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();});
}
function gridConfiguration(){return {patch:clone(patch),tempo,navigation:{page,view,opIndex,stackIndex,fxBank,globalGroup,octave}};}
function restoreGridConfiguration(input){const saved=takeConfiguration(input),n=saved.navigation;panic();loadPatch(saved.patch);changeTempo(saved.tempo);opIndex=n.opIndex;stackIndex=n.stackIndex;fxBank=n.fxBank;globalGroup=n.globalGroup;octave=n.octave;renderKeyboard();setView(n.view);setPage(n.page);renderOperators();renderPanel();}
harmonicPalette=createHarmonicPalette({ensureAudio,audio:()=>({context,node}),snapshot:recallSnapshot,notify,getTempo:()=>tempo,setTempo:changeTempo,getConfiguration:gridConfiguration,allowPatchReplace:confirmGridPatchReplace,applyConfiguration:restoreGridConfiguration,applyHarmonicPreset:result=>{panic();loadPatch(result.patch);setPage('home');setView('spectrum');}});
// A small public module API supports embedding and reproducible engine/panel checks.
window.casLab={get patch(){return clone(patch);},get scope(){return scope;},get state(){return {page,opIndex,stackIndex,recordState,recordArmed,hold,pattern:clone(pattern),activeNotes:[...activeNotes],audio:context?.state||'off',dirty};},presets:clone(presets),loadPatch,setPage,setView,noteOn,noteOff,panic,ensureAudio,spectrum,encodeWav};
