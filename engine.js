// CAS I/O TONE research engine. The same factory runs in the browser,
// AudioWorklet and offline renders; it has no DOM or device dependencies.
export function createCASModule() {
  const TAU = Math.PI * 2;
  const WAVES = ['sine','cosine','triangle','saw','pulse','tan','cot','sec','csc','sinc','cheb2','cheb3','fold','steps','harmonics','dirichlet','fejer'];
  const TARGETS = ['off','a','b','c','d','pmB','pmD','ac','bd','rotate','fold','out','warpB','warpD'];
  const MODES = ['sum','ring','quotient','magnitude','angle','fold'];
  const STACK_RULES=['sum','ring','quotient','magnitude','angle','sine','cosine','fold','cheby','soft','rotate'];
  const STACK_SOURCES=['none','s','c','op1','op2','op3','op4','op5','op6','feedback'];
  const LOOP_MODES=['clean','sine','sine-fold'];
  const ROOM_TIMES=[.0297,.0371,.0411,.0437],DIFFUSER_TIMES=[.0031,.0053];
  const RECALL_SECONDS=6.25,RECALL_CLIP_SECONDS=1.5;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const finite = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
  const wrap = p => p - Math.floor(p);
  const fold = x => 1 - 4 * Math.abs(wrap(x / 4 + .25) - .5);
  function warpPhase(p,pivot=.5) {
    p=wrap(p);pivot=clamp(pivot,.05,.95);
    return p<pivot?.5*p/pivot:.5+.5*(p-pivot)/(1-pivot);
  }
  function chebyshev(x,n) {let a=1,b=x;for(let k=2;k<=n;k++){const next=2*x*b-a;a=b;b=next;}return n===0?a:b;}
  function wave(kind, p) {
    p = wrap(p);
    const s = Math.sin(TAU * p), c = Math.cos(TAU * p);
    const safe = v => Math.abs(v) < .08 ? (v < 0 ? -.08 : .08) : v;
    switch (kind) {
      case 'cosine': return c;
      case 'triangle': return 2 / Math.PI * Math.asin(s);
      case 'saw': return 2 * p - 1;
      case 'pulse': return p < .5 ? 1 : -1;
      case 'tan': return Math.tanh(.45 * s / safe(c));
      case 'cot': return Math.tanh(.45 * c / safe(s));
      case 'sec': return Math.tanh(.4 * (1 / safe(c) - c));
      case 'csc': return Math.tanh(.4 * (1 / safe(s) - s));
      case 'sinc': {
        const x = (p - .5) * 8 * Math.PI;
        return Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;
      }
      case 'cheb2': return 2 * s * s - 1;
      case 'cheb3': return 4 * s * s * s - 3 * s;
      case 'fold': return fold(s * 2.5);
      case 'steps': return [-.8,.2,.9,-.3,.6,-.9,.4,0][Math.floor(p * 8)];
      case 'harmonics': {
        // Twelve finite, geometrically weighted sine partials; recurrence avoids 12 trig calls.
        let previous=0,current=s,sum=0,weight=1,norm=0;
        for(let k=1;k<=12;k++){sum+=weight*current;norm+=weight;const next=2*c*current-previous;previous=current;current=next;weight*=.72;}
        return sum/norm;
      }
      case 'dirichlet': {
        let sum=1,previous=1,current=c;
        for(let k=1;k<=6;k++){sum+=2*current;const next=2*c*current-previous;previous=current;current=next;}
        return sum/13;
      }
      case 'fejer': {
        // A DC-centered eight-term Fejer pulse, evaluated without a removable singularity.
        let sum=0,previous=1,current=c;
        for(let k=1;k<8;k++){sum+=2*(1-k/8)*current;const next=2*c*current-previous;previous=current;current=next;}
        return sum/7;
      }
      default: return s;
    }
  }
  function combine(s, c, mode, amount = 0) {
    switch (mode) {
      case 'ring': return s * c;
      case 'quotient': return Math.tanh(.7 * s / (.15 + Math.abs(c)));
      case 'magnitude': return (s + c >= 0 ? 1 : -1) * Math.hypot(s, c);
      case 'angle': return Math.hypot(s,c) < 1e-8 ? 0 : Math.atan2(s,c) / Math.PI;
      case 'fold': return fold((s + c) * (1 + amount * 3));
      default: return s + c;
    }
  }
  // Harmonic scan: a grid cell's 16 normalized harmonic magnitudes become the S carrier's
  // waveform, sum(k) a_k sin(k*theta), so B ratio, phase warp, PM, feedback and the nested
  // rules all act on it. Targets crossfade linearly over MOTION seconds while voice phases
  // keep running, so timbre changes are continuous. BLEND weighs keyed voices (m) against
  // the external grid grains (1-m). Harmonics above 0.45x the output rate are skipped.
  const SCAN_PARTIALS=16;
  function sanitizeScan(input){const v=input&&typeof input==='object'?input:{};return {enabled:v.enabled===true,blend:clamp(finite(v.blend,.5),0,1),motion:clamp(finite(v.motion,.08),.005,2)};}
  function scanVector(h){const out=new Float64Array(SCAN_PARTIALS);let sum=0;for(let k=0;k<SCAN_PARTIALS;k++){const x=Math.max(0,finite(h?.[k],0));out[k]=x;sum+=x;}if(!(sum>0))return null;for(let k=0;k<SCAN_PARTIALS;k++)out[k]/=sum;return out;}
  function harmonicTable(theta,amps,count) {
    // sin((k+1)x) = 2cos(x)sin(kx) - sin((k-1)x): one sine and one cosine per sample.
    const c2=2*Math.cos(theta);let previous=0,current=Math.sin(theta),sum=0;
    for(let k=0;k<count;k++){sum+=amps[k]*current;const next=c2*current-previous;previous=current;current=next;}
    return sum;
  }
  function initStack(){return {enabled:false,stages:Array.from({length:4},()=>({enabled:false,rule:'sine',source:'none',amount:1,wet:1}))};}
  function sanitizeStack(input) {
    const stack=initStack();if(!input||typeof input!=='object')return stack;
    stack.enabled=input.enabled===true;
    stack.stages=stack.stages.map((stage,i)=>{
      const v=input.stages?.[i];if(!v||typeof v!=='object')return stage;
      const rule=STACK_RULES.includes(v.rule)?v.rule:stage.rule;
      return {enabled:v.enabled===true,rule,source:STACK_SOURCES.includes(v.source)?v.source:'none',
        amount:rule==='cheby'?clamp(Math.round(finite(v.amount,3)),2,12):clamp(finite(v.amount,1),0,4),wet:clamp(finite(v.wet,1),0,1)};
    });return stack;
  }
  const stage=(rule,source='none',amount=1,wet=1)=>({enabled:true,rule,source,amount,wet});
  const ALGORITHMS=MODES.map((mode,i)=>({id:mode,name:['SUM','RING PRODUCT','SOFT QUOTIENT','SIGNED MAGNITUDE','PHASE ANGLE','WAVEFOLD'][i],base:mode,stack:initStack(),path:mode.toUpperCase(),fit:'Single output rule; existing lab behavior.'}));
  for(const a of [
    {id:'ring-sine-fold',name:'RING → SINE → FOLD',base:'sum',stages:[stage('ring','c'),stage('sine','none',2.2),stage('fold','none',1.8,.7)],path:'BASE → × C → sin(2.2x) → fold(1.8x)',fit:'Fixed-point candidate: multiply, sine lookup and folding.'},
    {id:'quotient-cheby-sine',name:'QUOTIENT → T3 → SINE',base:'sum',stages:[stage('quotient','c',.7),stage('cheby','none',3),stage('sine','none',1.4,.75)],path:'BASE → quotient(C) → T3 → sine',fit:'Division and polynomial work need target timing.'},
    {id:'angle-ring-soft',name:'ANGLE → RING → SOFT',base:'sum',stages:[stage('angle','c'),stage('ring','s',1.2),stage('soft','none',2.2)],path:'BASE → angle(C) → × S → tanh',fit:'Research first: atan2 needs a bounded fixed-point implementation.'},
    {id:'rotate-fold-ring',name:'ROTATE → FOLD → RING',base:'sum',stages:[stage('rotate','c',.75),stage('fold','none',2),stage('ring','s',1.3)],path:'BASE → vector mix(C) → fold → × S',fit:'Fixed-point candidate; rotation coefficients can be prepared per block.'},
    {id:'feedback-sine-fold',name:'FEEDBACK → SINE → FOLD',base:'sum',stages:[stage('sum','feedback',.6),stage('sine','none',1.9),stage('fold','none',1.7,.8)],path:'BASE + 0.6z⁻¹ → sine → fold',fit:'Bounded one-sample feedback; requires stress and alias checks.'},
    {id:'sine-cosine-cheby',name:'SINE → COSINE → T5',base:'sum',stages:[stage('sine','c',1.6),stage('cosine','s',2.2),stage('cheby','none',5,.55)],path:'BASE → sine(+C) → cosine(+S) → T5',fit:'Two trig evaluations and a polynomial per voice/sample; measure first.'}
  ])ALGORITHMS.push({...a,stack:sanitizeStack({enabled:true,stages:a.stages})});
  function selectAlgorithm(input,index) {
    const p=sanitize(input),a=ALGORITHMS[clamp(Math.round(finite(index)),0,ALGORITHMS.length-1)];
    p.combine=a.base;p.stack=sanitizeStack(a.stack);return p;
  }
  function algorithmIndex(p) {
    if(!p.stack?.enabled)return Math.max(0,MODES.indexOf(p.combine));
    const key=JSON.stringify(p.stack);
    for(let i=MODES.length;i<ALGORITHMS.length;i++)if(p.combine===ALGORITHMS[i].base&&key===JSON.stringify(ALGORITHMS[i].stack))return i;
    return ALGORITHMS.length;
  }
  function stackRule(x,y,rule,g) {
    switch(rule){
      case 'sum':return x+g*y;
      case 'ring':return g*x*y;
      case 'quotient':return Math.tanh(g*x/(.15+Math.abs(y)));
      case 'magnitude':return (x+y>=0?1:-1)*Math.hypot(g*x,y);
      case 'angle':return Math.hypot(x,y)<1e-8?0:Math.atan2(g*x,y)/Math.PI;
      case 'sine':return Math.sin(g*x+y);
      case 'cosine':return (Math.cos(g*x+y)-Math.cos(y))*.5;
      case 'fold':return fold(g*x+y);
      case 'cheby':{const n=clamp(Math.round(g),2,12),zero=chebyshev(0,n);return (chebyshev(clamp(x,-1,1),n)-zero)/(1+Math.abs(zero));}
      case 'soft':return Math.tanh(g*x+y);
      case 'rotate':return x*Math.cos(g)+y*Math.sin(g);
      default:return x;
    }
  }
  function processStack(value,s,c,ops,previous,stack) {
    if(!stack?.enabled)return value;
    for(let i=0;i<4;i++){
      const node=stack.stages[i];if(!node?.enabled||node.wet===0)continue;
      const source=node.source;
      const y=source==='s'?s:source==='c'?c:source==='feedback'?previous:source.startsWith('op')?(ops[Number(source.slice(2))-1]||0):0;
      const x=clamp(value,-8,8),wet=stackRule(x,clamp(y,-8,8),node.rule,node.amount);
      value=clamp(x+(wet-x)*node.wet,-8,8);
    }return Number.isFinite(value)?value:0;
  }
  function initPatch() {
    return {name:'INIT / TWO PARTIALS', a:.8,b:1,c:.55,d:2,feedback:0,cross:0,fold:0,
      drive:0,bits:16,volume:.55,combine:'sum',quality:2,poly:8,reset:true,
      phaseEnabled:true,warpB:.5,warpD:.5,phaseB:0,phaseD:0,fx:initFX(),stack:initStack(),
      crossings:{hysteresis:.0003,gate:.001},recall:{back:4,length:1,mix:.6,source:'dry',mode:'loop',align:true,divisor:64,triggerSource:'dry'},
      env:{attack:.012,decay:.45,sustain:.65,release:.5},
      ops:Array.from({length:6},(_,i)=>({enabled:true,wave:'sine',mode:'ratio',rate:i+1,
        depth:0,target:'off',source:-1,index:0,phase:0,decay:0}))};
  }
  function sanitize(input = {}) {
    const p = initPatch();
    if (!input || typeof input !== 'object') return p;
    p.name = String(input.name || p.name).slice(0,48);
    const ranges = {a:[-2,2],b:[-16,16],c:[-2,2],d:[-16,16],feedback:[0,2],cross:[0,4],
      fold:[0,3],drive:[0,4],bits:[2,16],volume:[0,1],warpB:[.05,.95],warpD:[.05,.95],phaseB:[-Math.PI,Math.PI],phaseD:[-Math.PI,Math.PI]};
    for (const [k,[lo,hi]] of Object.entries(ranges)) p[k] = clamp(finite(input[k],p[k]),lo,hi);
    p.bits = Math.round(p.bits);
    p.combine = MODES.includes(input.combine) ? input.combine : 'sum';
    p.quality = [1,2,4].includes(input.quality) ? input.quality : 2;
    p.poly = input.poly === 1 ? 1 : 8;
    p.reset = input.reset !== false;
    p.phaseEnabled=input.phaseEnabled!==false;
    p.fx=sanitizeFX(input.fx);
    p.stack=sanitizeStack(input.stack);
    p.crossings={hysteresis:clamp(finite(input.crossings?.hysteresis,.0003),.000001,.05),gate:clamp(finite(input.crossings?.gate,.001),0,.1)};
    const recall=input.recall||{};p.recall={back:[1,2,4].includes(recall.back)?recall.back:4,length:[.25,.5,1].includes(recall.length)?recall.length:1,mix:clamp(finite(recall.mix,.6),0,1),source:['dry','delay','room','mix'].includes(recall.source)?recall.source:'dry',mode:recall.mode==='once'?'once':'loop',align:recall.align!==false,divisor:clamp(Math.round(finite(recall.divisor,64)),1,4096),triggerSource:['dry','delay','room'].includes(recall.triggerSource)?recall.triggerSource:'dry'};
    for (const k of ['attack','decay','release']) p.env[k] = clamp(finite(input.env?.[k],p.env[k]),.002,8);
    p.env.sustain = clamp(finite(input.env?.sustain,p.env.sustain),0,1);
    p.ops = p.ops.map((op,i) => {
      const v = input.ops?.[i];
      if (!v || typeof v !== 'object') return op;
      return {enabled:v.enabled !== false,wave:WAVES.includes(v.wave)?v.wave:'sine',
        mode:v.mode === 'hz'?'hz':'ratio',rate:clamp(finite(v.rate,op.rate),0, v.mode==='hz'?2000:32),
        depth:clamp(finite(v.depth),0,4),target:TARGETS.includes(v.target)?v.target:'off',
        source:clamp(Math.round(finite(v.source,-1)),-1,5),index:clamp(finite(v.index),0,12),
        phase:clamp(finite(v.phase),0,1),decay:clamp(finite(v.decay),0,8)};
    });
    return p;
  }
  class Voice {
    constructor(id,note,velocity,sr,seed=0) {
      this.id=id; this.note=note; this.velocity=velocity; this.frequency=440 * 2 ** ((note-69)/12);
      this.pb=seed; this.pd=seed; this.phase=new Float64Array(6); this.previous=new Float64Array(6);
      this.nextOp=new Float64Array(6); this.age=0; this.env=0; this.stage=0; this.releaseStep=0;
      this.last=0; this.s=0; this.c=0; this.dead=false; this.sr=sr;
    }
    off(p) { if (this.stage !== 3) { this.stage=3; this.releaseStep=this.env / (p.env.release*this.sr); } }
    sample(p,scan=null) {
      const dt=1/this.sr, e=p.env;
      if(this.stage===0) { this.env+=dt/e.attack; if(this.env>=1){this.env=1;this.stage=1;} }
      else if(this.stage===1) { this.env-=(1-e.sustain)*dt/e.decay; if(this.env<=e.sustain){this.env=e.sustain;this.stage=2;} }
      else if(this.stage===2) this.env=e.sustain;
      else { this.env-=Math.max(this.releaseStep,1e-9); if(this.env<=0){this.env=0;this.dead=true;return 0;} }
      let ma=0,mb=0,mc=0,md=0,pmB=0,pmD=0,rotation=0,foldAmount=p.fold,extra=0,warpB=p.warpB,warpD=p.warpD;
      for(let i=0;i<6;i++) {
        const op=p.ops[i];
        this.phase[i]=wrap(this.phase[i]+(op.mode==='hz'?op.rate:this.frequency*op.rate)*dt);
        if(!op.enabled||op.depth===0) {this.nextOp[i]=0;continue;}
        const phase=this.phase[i]+op.phase+(op.source>=0?this.previous[op.source]*op.index/TAU:0);
        const amp=op.depth*(op.decay>0?Math.exp(-this.age/op.decay):1);
        const sig=wave(op.wave,phase)*amp;
        this.nextOp[i]=sig;
        switch(op.target) {
          case 'a': ma+=sig;break; case 'b':mb+=sig;break;case 'c':mc+=sig;break;case 'd':md+=sig;break;
          case 'pmB':pmB+=sig;break;case 'pmD':pmD+=sig;break;
          case 'ac':ma+=sig;mc+=wave(op.wave,phase+.25)*amp;break;
          case 'bd':mb+=sig;md+=wave(op.wave,phase+.25)*amp;break;
          case 'rotate':rotation+=sig;break;case 'fold':foldAmount+=sig;break;case 'out':extra+=sig;break;
          case 'warpB':warpB+=sig;break;case 'warpD':warpD+=sig;break;
        }
      }
      this.previous.set(this.nextOp);
      let a=clamp(p.a+ma,-6,6),c=clamp(p.c+mc,-6,6);
      if(rotation) {const co=Math.cos(rotation),si=Math.sin(rotation),old=a; a=a*co-c*si;c=old*si+c*co;}
      const ratioB=clamp(p.b+mb,-32,32);this.pb=wrap(this.pb+this.frequency*ratioB*dt);
      this.pd=wrap(this.pd+this.frequency*clamp(p.d+md,-32,32)*dt);
      const oldS=this.s,oldC=this.c;
      const argS=TAU*warpPhase(this.pb,p.phaseEnabled?warpB:.5)+(p.phaseEnabled?p.phaseB:0)+pmB+this.last*p.feedback+oldC*p.cross,hzB=Math.abs(this.frequency*ratioB);
      this.s=a*(scan?harmonicTable(argS,scan.amps,hzB>0?Math.min(SCAN_PARTIALS,Math.floor(scan.nyquist/hzB)):SCAN_PARTIALS):Math.sin(argS));
      this.c=c*Math.cos(TAU*warpPhase(this.pd,p.phaseEnabled?warpD:.5)+(p.phaseEnabled?p.phaseD:0)+pmD+this.last*p.feedback+oldS*p.cross);
      let out=combine(this.s,this.c,p.combine,Math.max(0,foldAmount))+extra;
      out=processStack(out,this.s,this.c,this.nextOp,this.last,p.stack);
      if(p.combine!=='fold'&&foldAmount>.0001) out=fold(out*(1+foldAmount*3));
      if(p.drive>0) out=Math.tanh(out*(1+p.drive*3))/Math.tanh(1+p.drive*3);
      this.last=clamp(out,-4,4);
      this.age+=dt;
      return Number.isFinite(out)?out*this.env*this.velocity:0;
    }
  }
  // Windowed-sinc low-pass before decimation. Oversampling reduces some aliasing;
  // these nonlinear operators are deliberately not claimed to be band-limited.
  function lowpass(factor) {
    if(factor===1) return new Float64Array([1]);
    const n=31, a=new Float64Array(n),cut=.43/factor;
    let sum=0;
    for(let i=0;i<n;i++) {const x=i-(n-1)/2; a[i]=(x===0?2*cut:Math.sin(TAU*cut*x)/(Math.PI*x))*(.42-.5*Math.cos(TAU*i/(n-1))+.08*Math.cos(2*TAU*i/(n-1)));sum+=a[i];}
    return a.map(v=>v/sum);
  }
  function initFX() {
    return {bypass:false,
      shaper:{enabled:false,mode:'sine',drive:2,order:3,bias:0,mix:.5},
      mod:{enabled:false,mode:'ring',rate:30,depth:1,phase:0,mix:.5},
      shift:{enabled:false,hz:40,rotate:0,feedback:0,mix:1},
      phaser:{enabled:false,rate:.3,depth:2,center:800,mix:.5},
      spaceRoute:'parallel',
      delay:{enabled:false,time:.3,feedback:.45,damping:.35,mix:.3,mode:'sine',color:.4,drive:2,rate:.3,depth:0},
      reverb:{enabled:false,size:1,decay:2.4,damping:.5,mix:.25,mode:'clean',rotation:.4,color:.35,drive:2,diffusion:.6}};
  }
  function sanitizeFX(input) {
    const fx=initFX();if(!input||typeof input!=='object')return fx;
    fx.bypass=input.bypass===true;
    const ranges={shaper:{drive:[.1,12],order:[2,12],bias:[-Math.PI,Math.PI],mix:[0,1]},
      mod:{rate:[0,2000],depth:[0,1],phase:[-Math.PI,Math.PI],mix:[0,1]},
      shift:{hz:[-2000,2000],rotate:[-Math.PI,Math.PI],feedback:[0,.65],mix:[0,1]},
      phaser:{rate:[0,15],depth:[0,3],center:[40,10000],mix:[0,1]},
      delay:{time:[.005,1],feedback:[-.95,.95],damping:[0,.98],mix:[0,1],color:[0,1],drive:[.5,8],rate:[0,2],depth:[0,5]},
      reverb:{size:[.4,1.5],decay:[.2,8],damping:[0,.98],mix:[0,1],rotation:[0,Math.PI/2],color:[0,1],drive:[.5,8],diffusion:[0,.75]}};
    for(const [key,fields] of Object.entries(ranges)) {
      const v=input[key];if(!v||typeof v!=='object')continue;
      fx[key].enabled=v.enabled===true;
      for(const [name,[lo,hi]] of Object.entries(fields))fx[key][name]=clamp(finite(v[name],fx[key][name]),lo,hi);
    }
    fx.shaper.order=Math.round(fx.shaper.order);
    if(['sine','cosine','cheby'].includes(input.shaper?.mode))fx.shaper.mode=input.shaper.mode;
    if(['ring','tremolo'].includes(input.mod?.mode))fx.mod.mode=input.mod.mode;
    for(const key of ['delay','reverb'])if(LOOP_MODES.includes(input[key]?.mode))fx[key].mode=input[key].mode;
    if(input.spaceRoute==='serial')fx.spaceRoute='serial';
    if(fx.shaper.mode==='cheby')fx.shaper.bias=clamp(fx.shaper.bias,-1,1);
    if(fx.mod.mode==='tremolo')fx.mod.rate=Math.min(fx.mod.rate,30);
    return fx;
  }
  function trigShape(x,cfg) {
    const u=x*cfg.drive;
    if(cfg.mode==='cheby'){const zero=chebyshev(clamp(cfg.bias,-1,1),cfg.order);return (chebyshev(clamp(u+cfg.bias,-1,1),cfg.order)-zero)/(1+Math.abs(zero));}
    const trig=cfg.mode==='cosine'?Math.cos:Math.sin,zero=trig(cfg.bias);
    return (trig(u+cfg.bias)-zero)/(1+Math.abs(zero));
  }
  class Hilbert {
    constructor(length=255) {
      this.length=length;this.delay=(length-1)/2;this.buffer=new Float64Array(length);this.pos=0;this.i=0;this.q=0;
      this.offsets=[];this.coefficients=[];
      for(let k=0;k<length;k++){const n=k-this.delay;if(Math.abs(n)%2===1){this.offsets.push(k);this.coefficients.push(2/(Math.PI*n)*(.42-.5*Math.cos(TAU*k/(length-1))+.08*Math.cos(2*TAU*k/(length-1))));}}
    }
    reset(){this.buffer.fill(0);this.pos=0;this.i=0;this.q=0;}
    next(x) {
      const n=this.length;this.buffer[this.pos]=x;this.i=this.buffer[(this.pos-this.delay+n)%n];let q=0;
      for(let j=0;j<this.offsets.length;j++)q+=this.coefficients[j]*this.buffer[(this.pos-this.offsets[j]+n)%n];
      this.q=q;this.pos=(this.pos+1)%n;
    }
  }
  // A shared output-rate bus, allocated once rather than once per voice or oversampling phase.
  class RingBuffer {
    constructor(samples){this.data=new Float32Array(Math.max(4,Math.ceil(samples)+2));this.pos=0;}
    reset(){this.data.fill(0);this.pos=0;}
    read(delay){const n=this.data.length,at=(this.pos-clamp(delay,1,n-2)+n)%n,i=Math.floor(at),f=at-i;return this.data[i]+f*(this.data[(i+1)%n]-this.data[i]);}
    write(x){this.data[this.pos]=Number.isFinite(x)?clamp(x,-8,8):0;this.pos=(this.pos+1)%this.data.length;}
  }
  function loopShape(x,mode,drive,color){
    if(mode==='clean'||color===0)return x;
    const g=clamp(drive,.5,8);let wet=Math.sin(g*x)/g;
    if(mode==='sine-fold')wet=fold(2*g*wet)/(2*g);
    // Each rule has slope magnitude <=1 and maps zero to zero. A wet blend preserves that bound.
    return x+(wet-x)*color;
  }
  function rotateRoom(a,b,c,d,co,si,out){
    const h0=(a+b+c+d)*.5,h1=(a-b+c-d)*.5,h2=(a+b-c-d)*.5,h3=(a-b-c+d)*.5;
    out[0]=co*h0-si*h1;out[1]=si*h0+co*h1;out[2]=co*h2+si*h3;out[3]=-si*h2+co*h3;
    return out;
  }
  function bufferPlan(sr=48000,bytes=4,channels=1,instances=1,seconds=1.01,size=1.5){
    const delaySamples=Math.ceil(seconds*sr)+2,roomSamples=ROOM_TIMES.reduce((n,t)=>n+Math.ceil(t*size*sr)+2,0),diffuserSamples=DIFFUSER_TIMES.reduce((n,t)=>n+Math.ceil(t*sr)+2,0);
    const scale=bytes*channels*instances;
    return {delaySamples,roomSamples,diffuserSamples,delayBytes:delaySamples*scale,reverbBytes:(roomSamples+diffuserSamples)*scale,totalBytes:(delaySamples+roomSamples+diffuserSamples)*scale};
  }
  function tailSeconds(input,cap=12){
    const f=sanitizeFX(input);if(f.bypass)return .1;
    const d=f.delay,r=f.reverb,g=Math.abs(d.feedback),delay=d.enabled?d.time+(g>0?d.time*Math.log(.001)/Math.log(g):0):0,room=r.enabled?r.decay+.15:0;
    return Math.min(cap,Math.max(.1,f.shift.enabled||f.phaser.enabled?.4:0,f.spaceRoute==='serial'?delay+room:Math.max(delay,room)));
  }
  class CrossingCounter {
    constructor(sr=48000,config={hysteresis:.0003,gate:.001}){this.sr=sr;this.release=Math.exp(-1/(sr*.05));this.configure(config);this.reset();}
    configure(config){if(this.config&&(this.config.hysteresis!==config.hysteresis||this.config.gate!==config.gate)){this.side=0;this.lastRise=-1;this.period=this.periodMean=0;}this.config=config;}
    reset(){this.frame=0;this.up=0;this.down=0;this.side=0;this.envelope=0;this.lastRise=-1;this.period=0;this.periodMean=0;this.windowFrames=0;this.windowEdges=0;this.rate=0;this.segmentSamples=0;this.segmentSum=0;this.segmentEnergy=0;this.segmentPeak=0;this.lastSamples=0;this.lastSum=0;this.lastEnergy=0;this.lastPeak=0;}
    next(x){
      if(!Number.isFinite(x))x=0;const abs=Math.abs(x),c=this.config;this.envelope=Math.max(abs,this.envelope*this.release);let edge=0;
      this.segmentSamples++;this.segmentSum+=x;this.segmentEnergy+=x*x;this.segmentPeak=Math.max(this.segmentPeak,abs);
      if(this.envelope<c.gate){this.side=0;this.lastRise=-1;this.period=this.periodMean=0;this.segmentSamples=0;this.segmentSum=this.segmentEnergy=this.segmentPeak=0;}
      else if(!this.side){if(x>c.hysteresis)this.side=1;else if(x<-c.hysteresis)this.side=-1;}
      else if(this.side<0&&x>c.hysteresis){edge=1;this.side=1;this.up++;if(this.lastRise>=0){this.period=this.frame-this.lastRise;this.periodMean=this.periodMean?this.periodMean+.15*(this.period-this.periodMean):this.period;}this.lastRise=this.frame;}
      else if(this.side>0&&x<-c.hysteresis){edge=-1;this.side=-1;this.down++;}
      if(edge){this.windowEdges++;this.lastSamples=this.segmentSamples;this.lastSum=this.segmentSum;this.lastEnergy=this.segmentEnergy;this.lastPeak=this.segmentPeak;this.segmentSamples=0;this.segmentSum=this.segmentEnergy=this.segmentPeak=0;}
      if(++this.windowFrames>=Math.round(this.sr*.25)){this.rate=this.windowEdges*this.sr/this.windowFrames;this.windowFrames=0;this.windowEdges=0;}
      this.frame++;return edge;
    }
    stats(){return {up:this.up,down:this.down,total:this.up+this.down,rate:this.rate,intervalMs:this.periodMean?this.periodMean/this.sr*1000:0,peak:this.lastPeak,rms:this.lastSamples?Math.sqrt(this.lastEnergy/this.lastSamples):0,area:this.lastSum/this.sr};}
  }
  class BeatRecall {
    constructor(sr=48000,config=initPatch().recall){
      this.sr=sr;this.history=new Float32Array(Math.ceil(RECALL_SECONDS*sr));this.banks=[new Float32Array(Math.ceil(RECALL_CLIP_SECONDS*sr)+2),new Float32Array(Math.ceil(RECALL_CLIP_SECONDS*sr)+2)];this.fade=Math.max(2,Math.round(.005*sr));this.smooth=1-Math.exp(-1/(.005*sr));this.bpm=110;this.config=config;this.reset();
    }
    reset(){this.history.fill(0);for(const b of this.banks)b.fill(0);this.write=0;this.recorded=0;this.clock=0;this.activeBank=0;this.clipLength=0;this.position=0;this.gain=0;this.target=false;this.capture=null;this.oldLength=0;this.oldPosition=0;this.swap=0;this.clearPending=false;this.last=0;this.info=null;this.message='History warming';}
    configure(config){if(this.config.source!==config.source){this.history.fill(0);this.write=0;this.recorded=0;this.clock=0;this.capture=null;this.message='New history input';}this.config=config;}
    setTempo(bpm){this.bpm=clamp(finite(bpm,110),40,240);}
    ready(){return this.recorded>=Math.round(this.config.back*60/this.bpm*this.sr)+Math.ceil(this.sr*.003);}
    readAbsolute(frame){return this.history[((Math.floor(frame)%this.history.length)+this.history.length)%this.history.length];}
    grab(){
      if(this.capture||this.swap>0||this.clearPending){this.message='Capture busy';return false;}
      if(!this.ready()){this.message='Need more history';return false;}
      const cfg=this.config,length=Math.min(this.banks[0].length-2,Math.round(cfg.length*60/this.bpm*this.sr));let start=this.clock-Math.round(cfg.back*60/this.bpm*this.sr),shift=0;
      if(cfg.align){let distance=Infinity;const radius=Math.round(this.sr*.002);for(let j=-radius;j<=radius;j++){const at=start+j;if(at<Math.max(0,this.clock-this.recorded)||at+length>this.clock)continue;const a=this.readAbsolute(at-1),b=this.readAbsolute(at);if(a<=0&&b>0&&Math.abs(j)<distance){distance=Math.abs(j);shift=j;}}start+=shift;}
      this.capture={bank:1-this.activeBank,start,length,cursor:0,energy:0,meta:{back:cfg.back,beats:cfg.length,bpm:this.bpm,source:cfg.source,shiftMs:shift/this.sr*1000}};this.message='Capturing';return true;
    }
    toggle(){if(this.target){this.target=false;this.message='Captured slice muted';return true;}if(this.capture||this.clearPending)return false;if(this.clipLength){this.position=0;this.target=true;this.message='Replaying captured slice';return true;}return this.grab();}
    stop(){this.target=false;}
    clear(){this.target=false;this.capture=null;this.history.fill(0);this.write=0;this.recorded=0;this.clock=0;this.clearPending=true;this.message='History cleared';}
    clipSample(bank,position,length,mode){if(!length||position>=length&&mode==='once')return 0;const p=position%length,i=Math.floor(p),f=p-i,next=(i+1)%length,v=this.banks[bank][i]+f*(this.banks[bank][next]-this.banks[bank][i]),edge=Math.min(1,p/this.fade,(length-1-p)/this.fade);return v*(.5-.5*Math.cos(Math.PI*Math.max(0,edge)));}
    process(input,audible=true){
      if(this.capture){const c=this.capture;for(let n=0;n<32&&c.cursor<c.length;n++,c.cursor++){const v=this.readAbsolute(c.start+c.cursor);this.banks[c.bank][c.cursor]=v;c.energy+=v*v;}if(c.cursor===c.length){this.oldLength=this.target&&this.gain>1e-6?this.clipLength:0;this.oldPosition=this.position;this.activeBank=c.bank;this.clipLength=c.length;this.position=0;this.swap=this.oldLength?this.fade:0;this.info={...c.meta,rms:Math.sqrt(c.energy/c.length)};this.capture=null;this.target=true;this.message='Captured slice ready';}}
      this.history[this.write]=Number.isFinite(input)?clamp(input,-8,8):0;this.write=(this.write+1)%this.history.length;this.recorded=Math.min(this.recorded+1,this.history.length);this.clock++;
      if(!audible)this.target=false;this.gain+=((this.target?this.config.mix:0)-this.gain)*this.smooth;
      let value=this.clipSample(this.activeBank,this.position,this.clipLength,this.config.mode);
      if(this.swap>0){const t=1-this.swap/this.fade,old=this.clipSample(1-this.activeBank,this.oldPosition,this.oldLength,this.config.mode);value=old+(value-old)*t;this.oldPosition++;this.swap--;}
      if(this.clipLength&&(this.target||this.gain>1e-8)){this.position++;if(this.position>=this.clipLength){if(this.config.mode==='once'){this.target=false;this.position=this.clipLength;}else this.position%=this.clipLength;}}
      if(this.clearPending&&this.gain<1e-6){for(const b of this.banks)b.fill(0);this.clipLength=0;this.info=null;this.swap=0;this.clearPending=false;this.gain=0;}
      this.last=Number.isFinite(value)?value*this.gain:0;return this.last;
    }
    status(){return {active:this.target,hasClip:this.clipLength>0,busy:!!this.capture||this.swap>0||this.clearPending,ready:this.ready(),recordedSeconds:this.recorded/this.sr,requiredSeconds:this.config.back*60/this.bpm+.003,clipSeconds:this.clipLength/this.sr,info:this.info,message:this.message,bytes:this.history.byteLength+this.banks[0].byteLength+this.banks[1].byteLength};}
    snapshot(){return this.clipLength?{data:this.banks[this.activeBank].slice(0,this.clipLength),sampleRate:this.sr,position:this.position,active:this.target,info:this.info}:null;}
    restore(s){if(!s?.data?.length||!Number.isFinite(s.sampleRate)||s.sampleRate<500||s.data.length>s.sampleRate*RECALL_CLIP_SECONDS+2)return false;const length=Math.min(this.banks[0].length-2,Math.round(s.data.length*this.sr/s.sampleRate));for(let i=0;i<length;i++){const p=i*s.sampleRate/this.sr,j=Math.floor(p),f=p-j,a=finite(s.data[Math.min(j,s.data.length-1)]),b=finite(s.data[Math.min(j+1,s.data.length-1)]);this.banks[this.activeBank][i]=clamp(a+(b-a)*f,-8,8);}this.clipLength=length;this.position=clamp(finite(s.position)*this.sr/s.sampleRate,0,length);this.target=s.active===true;this.info=s.info||null;this.message='Captured slice restored';return true;}
  }
  class BufferEffects {
    constructor(sr=48000,fx=initFX()){
      this.sr=sr;this.echo=new RingBuffer(sr*1.01);this.room=ROOM_TIMES.map(t=>new RingBuffer(t*1.5*sr));this.diffusers=DIFFUSER_TIMES.map(t=>new RingBuffer(t*sr));
      this.taps=new Float64Array(4);this.low=new Float64Array(4);this.mixed=new Float64Array(4);this.gains=new Float64Array(4);this.smooth=1-Math.exp(-1/(.02*sr));this.configure(fx);this.reset();
    }
    configure(fx){const previous=this.fx;this.fx=fx;const r=fx.reverb;if(!this.delayActive)this.time=fx.delay.time*this.sr;if(!this.roomActive)this.size=r.size;this.co=Math.cos(r.rotation);this.si=Math.sin(r.rotation);for(let i=0;i<4;i++)this.gains[i]=10**(-3*ROOM_TIMES[i]*r.size/r.decay);if(previous&&fx.bypass&&!previous.bypass)this.reset();}
    clearDelay(){this.echo.reset();this.echoLow=0;this.delayMeter=0;this.delayReturn=0;}
    clearRoom(){for(const b of this.room)b.reset();for(const b of this.diffusers)b.reset();this.low.fill(0);this.roomMeter=0;this.roomReturn=0;}
    reset(){this.clearDelay();this.clearRoom();this.dry=0;this.delayMix=0;this.roomMix=0;this.phase=0;this.time=this.fx.delay.time*this.sr;this.size=this.fx.reverb.size;this.delayActive=false;this.roomActive=false;}
    process(x){
      this.dry=x;this.delayReturn=0;this.roomReturn=0;
      if(this.fx.bypass)return x;
      const f=this.fx,d=f.delay,r=f.reverb;let result=x;
      this.delayMix+=((d.enabled?d.mix:0)-this.delayMix)*this.smooth;
      if(d.enabled||this.delayMix>1e-8){
        this.delayActive=true;this.time+=(d.time*this.sr-this.time)*this.smooth;this.phase=wrap(this.phase+d.rate/this.sr);
        const tap=this.echo.read(this.time+Math.sin(TAU*this.phase)*d.depth*this.sr/1000);
        this.echoLow=(1-d.damping)*tap+d.damping*this.echoLow;
        this.echo.write((d.enabled?x:0)+d.feedback*loopShape(this.echoLow,d.mode,d.drive,d.color));
        this.delayReturn=tap*this.delayMix;result+=this.delayReturn;this.delayMeter+=(tap*tap-this.delayMeter)*.001;
      }else {this.delayMix=0;if(this.delayActive){this.clearDelay();this.delayActive=false;}}
      this.roomMix+=((r.enabled?r.mix:0)-this.roomMix)*this.smooth;
      if(r.enabled||this.roomMix>1e-8){
        this.roomActive=true;this.size+=(r.size-this.size)*this.smooth;let input=r.enabled?(f.spaceRoute==='serial'?result:x):0;
        for(let i=0;i<2;i++){const line=this.diffusers[i],tap=line.read(DIFFUSER_TIMES[i]*this.sr),wet=tap-r.diffusion*input;line.write(input+r.diffusion*wet);input=wet;}
        for(let i=0;i<4;i++){this.taps[i]=this.room[i].read(ROOM_TIMES[i]*this.size*this.sr);this.low[i]=(1-r.damping)*this.taps[i]+r.damping*this.low[i];this.mixed[i]=loopShape(this.low[i],r.mode,r.drive,r.color);}
        rotateRoom(this.mixed[0],this.mixed[1],this.mixed[2],this.mixed[3],this.co,this.si,this.mixed);
        for(let i=0;i<4;i++)this.room[i].write(input*(i===2?-.5:.5)+this.gains[i]*this.mixed[i]);
        const wet=.5*(this.taps[0]-this.taps[1]+this.taps[2]+this.taps[3]);this.roomReturn=wet*this.roomMix;result+=this.roomReturn;this.roomMeter+=(wet*wet-this.roomMeter)*.001;
      }else {this.roomMix=0;if(this.roomActive){this.clearRoom();this.roomActive=false;}}
      return Number.isFinite(result)?result:0;
    }
    meters(){return {delay:Math.sqrt(Math.max(0,this.delayMeter)),reverb:Math.sqrt(Math.max(0,this.roomMeter))};}
  }
  // Reusable mono elements. Shaping runs at the internal synthesis rate;
  // modulation, analytic frequency shifting and allpass phasing run at the output rate.
  class TrigEffects {
    constructor(sr=48000,fx=initFX(),factor=2){this.sr=sr;this.hilbert=new Hilbert();this.stages=new Float64Array(4);this.buffers=new BufferEffects(sr);this.reset();this.configure(fx,factor);}
    configure(fx,factor=2){const next=sanitizeFX(fx);this.buffers.configure(next);this.fx=next;this.factor=factor;this.shapeSmooth=1-Math.exp(-1/(.005*this.sr*factor));this.smooth=1-Math.exp(-1/(.005*this.sr));}
    reset(){this.hilbert.reset();this.stages.fill(0);this.buffers.reset();this.dry=0;this.delayReturn=0;this.roomReturn=0;this.modPhase=0;this.shiftPhase=0;this.phaserPhase=0;this.shapeMix=0;this.modMix=0;this.shiftMix=0;this.phaserMix=0;this.shiftLast=0;this.phaserCoefficient=-.8;this.phaserTarget=-.8;this.phaserCounter=0;}
    shape(x) {
      const f=this.fx;if(f.bypass)return x;const c=f.shaper,target=c.enabled?c.mix:0;
      this.shapeMix+=(target-this.shapeMix)*this.shapeSmooth;
      if(this.shapeMix<1e-8){this.shapeMix=0;return x;}
      return x+(trigShape(x,c)-x)*this.shapeMix;
    }
    process(x) {
      const f=this.fx;if(f.bypass){this.dry=x;this.delayReturn=0;this.roomReturn=0;return x;}
      const mod=f.mod;this.modMix+=((mod.enabled?mod.mix:0)-this.modMix)*this.smooth;
      if(this.modMix>1e-8){this.modPhase=wrap(this.modPhase+mod.rate/this.sr);const carrier=Math.cos(TAU*this.modPhase+mod.phase),gain=mod.mode==='ring'?1-mod.depth+mod.depth*carrier:1-mod.depth/2+mod.depth/2*carrier;x+= (x*gain-x)*this.modMix;}
      else this.modMix=0;
      const shift=f.shift;this.shiftMix+=((shift.enabled?shift.mix:0)-this.shiftMix)*this.smooth;
      if(this.shiftMix>1e-8){this.shiftPhase=wrap(this.shiftPhase+shift.hz/this.sr);this.hilbert.next(x+Math.tanh(this.shiftLast)*shift.feedback);const angle=TAU*this.shiftPhase+shift.rotate,wet=this.hilbert.i*Math.cos(angle)-this.hilbert.q*Math.sin(angle);this.shiftLast=clamp(wet,-4,4);x=this.hilbert.i+(wet-this.hilbert.i)*this.shiftMix;}
      else {this.shiftMix=0;this.shiftLast=0;}
      const phaser=f.phaser;this.phaserMix+=((phaser.enabled?phaser.mix:0)-this.phaserMix)*this.smooth;
      if(this.phaserMix>1e-8){this.phaserPhase=wrap(this.phaserPhase+phaser.rate/this.sr);if(this.phaserCounter++%16===0){const hz=clamp(phaser.center*2**(phaser.depth*Math.sin(TAU*this.phaserPhase)),20,this.sr*.45),t=Math.tan(Math.PI*hz/this.sr);this.phaserTarget=(t-1)/(t+1);}this.phaserCoefficient+=(this.phaserTarget-this.phaserCoefficient)*.01;let wet=x;for(let j=0;j<4;j++){const y=this.phaserCoefficient*wet+this.stages[j];this.stages[j]=wet-this.phaserCoefficient*y;wet=y;}x+=(wet-x)*this.phaserMix;}
      else this.phaserMix=0;
      const result=this.buffers.process(Number.isFinite(x)?x:0);this.dry=this.buffers.dry;this.delayReturn=this.buffers.delayReturn;this.roomReturn=this.buffers.roomReturn;return result;
    }
  }
  class Engine {
    constructor(sr=48000,p=initPatch()) {
      this.sr=sr;this.voices=[];this.frame=0;this.lastS=0;this.lastC=0;this.dcX=0;this.dcY=0;
      this.returnDCX=new Float64Array(3);this.returnDCY=new Float64Array(3);this.lastDry=0;this.lastDelay=0;this.lastRoom=0;this.lastRecall=0;
      this.recall=new BeatRecall(sr);this.crossings={dry:new CrossingCounter(sr),delay:new CrossingCounter(sr),room:new CrossingCounter(sr),recall:new CrossingCounter(sr)};this.edges=new Int8Array(4);this.crossingArm=null;
      this.volume=0;this.serial=0;this.effects=new TrigEffects(sr);this.setPatch(p);
      // The table starts as a plain sine, so enabling scan before any cell is heard stays tonal.
      this.scan=sanitizeScan();this.scanAmps=new Float64Array(SCAN_PARTIALS);this.scanAmps[0]=1;this.scanFrom=this.scanAmps.slice();this.scanGoal=this.scanAmps.slice();this.scanLeft=0;this.scanTotal=1;this.scanView={amps:this.scanAmps,nyquist:.45*sr};
    }
    setPatch(p) {
      const next=sanitize(p),changed=this.patch?.quality!==next.quality;
      this.patch=next;
      this.effects.configure(next.fx,next.quality);
      this.recall.configure(next.recall);for(const counter of Object.values(this.crossings))counter.configure(next.crossings);
      if(changed){this.taps=lowpass(next.quality);this.history=new Float64Array(this.taps.length);this.pos=0;}
      for(const v of this.voices) {v.sr=this.sr*next.quality;if(v.stage===3)v.releaseStep=v.env/(next.env.release*v.sr);}
      if(this.voices.length>next.poly) this.voices=this.voices.slice(-next.poly);
    }
    noteOn(id,note,velocity=1) {
      note=clamp(finite(note,60),0,127);velocity=clamp(finite(velocity,1),0,1);
      this.voices=this.voices.filter(v=>v.id!==id);
      if(this.voices.length>=this.patch.poly) {
        const released=this.voices.findIndex(v=>v.stage===3);
        this.voices.splice(released>=0?released:0,1);
      }
      this.voices.push(new Voice(id,note,velocity,this.sr*this.patch.quality,this.patch.reset?0:wrap(this.frame/this.sr*440)));
    }
    noteOff(id) {for(const v of this.voices)if(v.id===id)v.off(this.patch);}
    setScan(config){this.scan=sanitizeScan(config);}
    scanTarget(h){const goal=scanVector(h);if(!goal)return false;this.scanFrom.set(this.scanAmps);this.scanGoal.set(goal);this.scanTotal=Math.max(1,Math.round(this.scan.motion*this.sr));this.scanLeft=this.scanTotal;return true;}
    setTempo(bpm){this.recall.setTempo(bpm);}
    resetCrossings(){for(const counter of Object.values(this.crossings))counter.reset();this.edges.fill(0);this.crossingArm=null;}
    armRecall(){if(!this.recall.ready())return false;this.crossingArm={source:this.patch.recall.triggerSource,remaining:this.patch.recall.divisor};return true;}
    analysis(){const counts={};for(const [key,counter] of Object.entries(this.crossings))counts[key]=counter.stats();return {counts,recall:this.recall.status(),arm:this.crossingArm?{...this.crossingArm}:null};}
    panic(){this.voices=[];this.history.fill(0);this.effects.reset();this.recall.reset();this.resetCrossings();this.dcX=0;this.dcY=0;this.lastS=0;this.lastC=0;this.returnDCX.fill(0);this.returnDCY.fill(0);this.lastDry=0;this.lastDelay=0;this.lastRoom=0;this.lastRecall=0;}
    next(external=0) {
      const p=this.patch,q=p.quality;
      let filtered=0,bs=0,bc=0;
      if(this.scanLeft>0){this.scanLeft--;const t=1-this.scanLeft/this.scanTotal;for(let k=0;k<SCAN_PARTIALS;k++)this.scanAmps[k]=this.scanFrom[k]+(this.scanGoal[k]-this.scanFrom[k])*t;}
      const scan=this.scan.enabled?this.scanView:null;
      for(let k=0;k<q;k++) {
        let value=0,s=0,c=0;
        for(const v of this.voices) {if(v.dead)continue;value+=v.sample(p,scan);s+=v.s*v.env*v.velocity;c+=v.c*v.env*v.velocity;}
        if(scan)value*=this.scan.blend;
        this.history[this.pos]=this.effects.shape(value);
        if(k===q-1){let at=this.pos;for(let j=0;j<this.taps.length;j++){filtered+=this.history[at]*this.taps[j];at=(at+this.taps.length-1)%this.taps.length;}bs=s;bc=c;}
        this.pos=(this.pos+1)%this.taps.length;
      }
      if(this.frame%128===0)this.voices=this.voices.filter(v=>!v.dead);
      if(p.bits<16){const levels=2**(p.bits-1);filtered=Math.round(filtered*levels)/levels;}
      const grains=clamp(Number.isFinite(external)?external:0,-8,8);
      filtered=this.effects.process(filtered+(scan?grains*(1-this.scan.blend):grains));
      const source=this.patch.recall.source,feed=source==='dry'?this.effects.dry:source==='delay'?this.effects.delayReturn:source==='room'?this.effects.roomReturn:filtered;
      const recalled=this.recall.process(feed,!p.fx.bypass);filtered+=recalled;
      const coefficient=Math.exp(-TAU*5/this.sr),dc=filtered-this.dcX+coefficient*this.dcY;this.dcX=filtered;this.dcY=dc;
      this.volume+=(p.volume-this.volume)*.002;
      const gain=this.volume*.28;
      // Source monitoring follows the same linear DC blocker and master gain. Attribute
      // serial echo→room to its return branch, then apply the output limiter's common scale.
      for(let i=0;i<3;i++){const input=i===0?this.effects.delayReturn:i===1?this.effects.roomReturn:recalled;this.returnDCY[i]=input-this.returnDCX[i]+coefficient*this.returnDCY[i];this.returnDCX[i]=input;}
      const output=clamp(Number.isFinite(dc)?dc*gain:0,-.98,.98),limit=Math.abs(dc*gain)>.98?.98/Math.abs(dc*gain):1;
      this.lastDelay=this.returnDCY[0]*gain*limit;this.lastRoom=this.returnDCY[1]*gain*limit;this.lastRecall=this.returnDCY[2]*gain*limit;this.lastDry=output-this.lastDelay-this.lastRoom-this.lastRecall;
      this.edges[0]=this.crossings.dry.next(this.lastDry);this.edges[1]=this.crossings.delay.next(this.lastDelay);this.edges[2]=this.crossings.room.next(this.lastRoom);this.edges[3]=this.crossings.recall.next(this.lastRecall);
      if(this.crossingArm){const arm=this.crossingArm,index=arm.source==='dry'?0:arm.source==='delay'?1:2;if(this.edges[index]===1&&--arm.remaining<=0){this.recall.grab();this.crossingArm=null;}}
      this.lastS=bs*gain;this.lastC=bc*gain;this.frame++;
      return output;
    }
  }
  return {TAU,WAVES,TARGETS,MODES,STACK_RULES,STACK_SOURCES,LOOP_MODES,ROOM_TIMES,DIFFUSER_TIMES,RECALL_SECONDS,RECALL_CLIP_SECONDS,ALGORITHMS,SCAN_PARTIALS,sanitizeScan,scanVector,harmonicTable,clamp,wrap,fold,warpPhase,chebyshev,wave,combine,initStack,sanitizeStack,selectAlgorithm,algorithmIndex,stackRule,processStack,initPatch,initFX,sanitizeFX,sanitize,trigShape,Hilbert,RingBuffer,loopShape,rotateRoom,bufferPlan,tailSeconds,CrossingCounter,BeatRecall,BufferEffects,TrigEffects,Voice,Engine};
}
export const CAS = createCASModule();
export function createWorkletSource() {
  return `const CAS=(${createCASModule.toString()})();
  class CASProcessor extends AudioWorkletProcessor {
    constructor(){super();this.engine=new CAS.Engine(sampleRate);this.queue=[];this.pendingSnapshots=[];this.samples=new Float32Array(1024);this.sines=new Float32Array(1024);this.cosines=new Float32Array(1024);this.drySamples=new Float32Array(1024);this.delaySamples=new Float32Array(1024);this.roomSamples=new Float32Array(1024);this.recallSamples=new Float32Array(1024);this.edgeSamples={dry:new Int8Array(1024),delay:new Int8Array(1024),room:new Int8Array(1024),recall:new Int8Array(1024)};this.at=0;this.count=0;this.peak=0;this.sum=0;
      this.port.onmessage=({data:m})=>{if(m.type==='panic'){this.queue=[];this.engine.panic();return;}if(m.when!=null){this.queue.push(m);this.queue.sort((a,b)=>a.when-b.when);}else this.apply(m);};}
    apply(m){if(m.type==='patch')this.engine.setPatch(m.patch);else if(m.type==='clock')this.engine.setTempo(m.tempo);else if(m.type==='clearBuffers')this.engine.effects.buffers.reset();else if(m.type==='resetCrossings')this.engine.resetCrossings();else if(m.type==='recallSnapshot')this.pendingSnapshots.push(m.id);else if(m.type==='recall'){const r=this.engine.recall;if(m.action==='toggle')r.toggle();else if(m.action==='grab')r.grab();else if(m.action==='off')r.stop();else if(m.action==='clear'){r.clear();this.engine.crossingArm=null;}else if(m.action==='arm')this.engine.armRecall();else if(m.action==='cancel')this.engine.crossingArm=null;}else if(m.type==='scanConfig')this.engine.setScan(m.config);else if(m.type==='scanTarget')this.engine.scanTarget(m.h);else if(m.type==='on')this.engine.noteOn(m.id,m.note,m.velocity);else if(m.type==='off')this.engine.noteOff(m.id);else if(m.type==='cancel'){this.queue=this.queue.filter(e=>!String(e.id||'').startsWith(m.prefix));for(const v of this.engine.voices)if(String(v.id).startsWith(m.prefix))v.off(this.engine.patch);}}
    process(inputs,outputs){const out=outputs[0][0],incoming=inputs[0]?.[0];for(let i=0;i<out.length;i++){const t=currentTime+i/sampleRate;while(this.queue.length&&this.queue[0].when<=t)this.apply(this.queue.shift());const v=this.engine.next(incoming?.[i]||0);out[i]=v;this.samples[this.at]=v;this.sines[this.at]=this.engine.lastS;this.cosines[this.at]=this.engine.lastC;this.drySamples[this.at]=this.engine.lastDry;this.delaySamples[this.at]=this.engine.lastDelay;this.roomSamples[this.at]=this.engine.lastRoom;this.recallSamples[this.at]=this.engine.lastRecall;this.edgeSamples.dry[this.at]=this.engine.edges[0];this.edgeSamples.delay[this.at]=this.engine.edges[1];this.edgeSamples.room[this.at]=this.engine.edges[2];this.edgeSamples.recall[this.at]=this.engine.edges[3];this.at=(this.at+1)%1024;this.count++;this.sum+=v*v;this.peak=Math.max(this.peak,Math.abs(v));}
      if(!this.engine.recall.capture&&this.pendingSnapshots.length){const id=this.pendingSnapshots.shift(),snapshot=this.engine.recall.snapshot();this.port.postMessage({type:'recallSnapshot',id,snapshot},snapshot?[snapshot.data.buffer]:[]);}
      if(this.count>=sampleRate/25){const ordered=a=>Float32Array.from({length:1024},(_,i)=>a[(this.at+i)%1024]);const y=ordered(this.samples),s=ordered(this.sines),c=ordered(this.cosines),dry=ordered(this.drySamples),delay=ordered(this.delaySamples),room=ordered(this.roomSamples),recall=ordered(this.recallSamples),edges={};for(const key of ['dry','delay','room','recall'])edges[key]=Int8Array.from({length:1024},(_,i)=>this.edgeSamples[key][(this.at+i)%1024]);this.port.postMessage({type:'scope',y,s,c,dry,delay,room,recall,edges,analysis:this.engine.analysis(),buffers:this.engine.effects.buffers.meters(),peak:this.peak,rms:Math.sqrt(this.sum/this.count),voices:this.engine.voices.length,sampleRate},[y.buffer,s.buffer,c.buffer,dry.buffer,delay.buffer,room.buffer,recall.buffer,edges.dry.buffer,edges.delay.buffer,edges.room.buffer,edges.recall.buffer]);this.count=0;this.sum=0;this.peak=0;}return true;}
  }registerProcessor('cas-tone',CASProcessor);`;
}
