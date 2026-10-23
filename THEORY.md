# Developing the CAS model

The useful organizing idea is two weighted trigonometric branches with independently controllable amplitude, phase and frequency. The formula is a coordinate system for familiar synthesis techniques, rather than evidence that every timbre it can produce is a new synthesis method.

## 1. What the four-coefficient model does by itself

For constant real coefficients:

```
y(t) = a sin(bt) + c cos(dt)
```

If `b = d = ω`, the expression collapses exactly to one sinusoid:

```
R = sqrt(a² + c²)
φ = atan2(c, a)
y(t) = R sin(ωt + φ)
```

The zero vector has zero output and an arbitrary phase. Otherwise, the two coefficients describe amplitude and phase. Turning A/C with equal frequency is a useful live demonstration of the relation between Cartesian I/Q coordinates and polar amplitude/phase. It does not create a spectrum containing many partials while A/C remain constant. See [Smith's derivation of sinusoidal quadrature](https://www.dsprelated.com/freebooks/mdft/Sinusoids.html).

If B and D are different, the model has two sinusoidal partials. Integer ratios to the note frequency give harmonic partials; noninteger ratios can give inharmonic or beating combinations. Two sinusoids alone cannot produce an arbitrary spectrum. More partials require additional terms or modulation/nonlinearity.

## 2. The time-varying model needs integrated frequency

In this lab B/D are dimensionless ratios to the played note's frequency `f0`. They are not angular frequencies in radians per second. The digital form is:

```
φb[n+1] = φb[n] + 2π f0 (B + mB[n]) / fs
φd[n+1] = φd[n] + 2π f0 (D + mD[n]) / fs
S[n] = (A + mA[n]) sin(φb[n] + pB[n])
C[n] = (C + mC[n]) cos(φd[n] + pD[n])
```

Substituting a changing frequency directly into `sin(b(t)t)` is different: its instantaneous angular frequency becomes `b(t) + t b′(t)`. Integrating the intended frequency avoids that unwanted extra term.

Gain destinations implement signed amplitude modulation. Frequency destinations implement linear FM, including negative instantaneous ratios. Phase destinations implement PM in radians. Sinusoidal FM and PM are related through integration, but their depth units and frequency dependence differ. See [Smith's treatment of FM spectra](https://www.dsprelated.com/freebooks/mDFT/FM_Spectra.html).

## 3. Coefficient rotation is a productive geometric operator

Instead of independently adding to A/C, rotate their vector:

```
A′ = A cos r − C sin r
C′ = A sin r + C cos r
```

This preserves `A² + C²`. At equal carrier frequency, the output phase increases by `r(t)` while its carrier amplitude stays fixed. At different carrier frequencies the same operation is coupled amplitude modulation of two distinct partials. The fourth on-page experiment lets the listener move between these cases by changing D.

This is an application of quadrature/vector identities, not a claim of historical novelty. A quarter-cycle shift of an arbitrary non-sinusoidal operator waveform also does not necessarily form a Hilbert-transform pair.

## 4. Six operators form an explicit phase network

Each operator has a function, ratio/fixed-Hz clock, depth, start phase and optional exponential decay. Its output is:

```
u_i[n] = depth_i · exp(−age/decay_i)
         · w_i(θ_i[n] + index_i · u_j[n−1])
```

The decay factor is omitted when its setting is zero. In the code oscillator phases are in cycles, so the radian PM offset is divided by `2π` at evaluation. Every edge reads the previous internal sample, including cycles and self-feedback. This defines a causal graph and prevents evaluation order from silently changing the result.

The graph can act on either carrier, rotate the coefficient vector, change folding, or sum an operator directly into the output. This supports nested modulation and more than two additive partials. The six operators are modulators with optional direct output; they are not a DX7-compatible six-operator voice architecture.

## 5. Output laws are extensions, not equivalent formulas

| Law | Implemented function | Consequence |
| --- | --- | --- |
| Sum | `S + C` | Original two-branch model |
| Ring | `S*C` | Pure product; sum/difference sidebands without dry carriers |
| Soft quotient | `tanh(0.7 S / (0.15 + abs(C)))` | Bounded nonlinear waveshaper |
| Signed magnitude | `sign(S+C) sqrt(S²+C²)` | Polarity discontinuities can add strong harmonics |
| Phase angle | `atan2(S,C)/π`, zero at the zero vector | Wrapped angle can be saw-like; not a frequency shifter |
| Wavefold | Triangle-fold of the sum | Reflection at amplitude thresholds creates harmonics |

For sinusoidal carriers, pure ring multiplication has the exact identity:

```
sin(Bθ) cos(Dθ) = ½ [sin((B+D)θ) + sin((B−D)θ)]
```

The supplied prototype's ring mode also mixed in the dry carriers. This lab intentionally uses a pure product so the identity can be tested by ear and by spectrum. A product or an XY trace alone is not a broadband single-sideband/Hilbert frequency shifter. Likewise, these patches do not establish faithful CZ, acoustic formant or other hardware emulation.

## 6. Functions have precise limits

`(2/π) asin(sin θ)` gives a triangle wave. Applying Chebyshev polynomials to a sine gives exact harmonic relations: `T2(sin θ) = −cos(2θ)` and `T3(sin θ) = −sin(3θ)`.

Tangent, cotangent, secant and cosecant have poles. Their lab versions bound denominators and apply tanh; the regularized waveforms are not the unbounded mathematical functions. “Periodic sinc” here repeats a finite centered sinc segment. It is not an ideal band-limited oscillator, and its segment boundary contributes its own harmonics.

Oversampling and low-pass decimation reduce some aliasing but cannot guarantee arbitrary nonlinear networks are alias-free. Changing the internal sample rate also changes the delay in cyclic networks. Compare 1×/2×/4× as different numerical realizations of a research patch, not as mathematically identical renders.

## 7. What can inform a future hardware build

The lab makes routing semantics, useful depth ranges and control-page choices audible before a device is available. Candidate firmware additions should be selected from tested musical behaviors, then implemented in the fixed-point engine and measured on the unit. Six JavaScript operators, reciprocal functions, oversampling and eight-voice feedback networks are not evidence that the physical audio budget can support the same combination.

A firmware port is a separate deliverable. This module neither sends programming messages nor changes its operator count or audio path.

## 8. Playable trig synthesis and insert effects

The software lab now implements these elements, with the same DSP factory used for live audio and WAV rendering. They are standard mathematical/DSP constructions used as research building blocks, not claims of a newly invented synthesis family.

### Continuous phase mapping

For phase `p` in cycles and pivot `q` between 0.05 and 0.95:

```
W(p,q) = p/(2q)                         if p < q
         1/2 + (p−q)/(2(1−q))           otherwise
```

The map sends the pivot to half a cycle, keeps phase continuous and preserves the cycle period. At `q = 0.5` it is identity. Other pivots change phase speed within a cycle and introduce harmonics. B and D have independent pivots and constant offsets; operator destinations can modulate either pivot. This is a defined phase-distortion operation, rather than a patch merely named after a phase-distortion instrument.

### Finite harmonic functions

Three new operator waveforms use finite sums:

```
H(θ) = sum(k=1..12, 0.72^(k−1) sin(kθ)) / sum(k=1..12, 0.72^(k−1))
D(θ) = [1 + 2 sum(k=1..6, cos(kθ))] / 13
F(θ) = [2 sum(k=1..7, (1−k/8) cos(kθ))] / 7
```

H is a geometrically weighted sine stack. D is a normalized Dirichlet kernel. F is a normalized, DC-centered Fejér pulse; the conventional constant term has been removed. Recurrence evaluates the sums without dividing by a sine near its zero. Direct finite-sum tests verify all three, including cycle boundaries. Subsequent phase warping and modulation can introduce additional, potentially aliased partials.

### Trig shaper and ring/tremolo

The shaper applies sine/cosine to driven input audio, or evaluates a Chebyshev polynomial on clipped input. Bias changes symmetry; the output at zero input is subtracted and a fixed normalization bounds the result. This prevents the insert from generating a constant signal when its input is silent. A nonzero input can still acquire DC, removed by the engine's output DC blocker. The sine/cosine mode has a shape-law selector; the Chebyshev mode instead exposes harmonic order 2–12.

Ring modulation multiplies the complete voice mix by a cosine carrier, with depth blending the carrier against unity. Tremolo uses `1−d/2+(d/2)cos θ`, which stays between `1−d` and 1. Unlike the per-voice carrier-product output law, the insert processes every voice and partial together. The shaper runs before oversampled decimation; the other inserts run at the output rate.

### Hilbert frequency shifting

The new SSB insert constructs a finite analytic pair, then takes the real part after complex rotation:

```
I = delayed x
Q = Hilbert(x)
y = I cos(2πΔft + rotation) − Q sin(2πΔft + rotation)
```

This uses a 255-tap Blackman-windowed Hilbert FIR and an aligned 127-sample real path. It approximates single-sideband cancellation over its useful band; it retains unwanted image near DC and Nyquist. A signed Hz shift changes partial spacing differently from pitch transposition. Negative shifts that cross zero frequency fold into the real output's positive-frequency representation. Bounded, saturated feedback recirculates the wet signal.

The test at a 1 kHz input shifted by +125 Hz measures about **−83 dB unwanted image relative to the wanted sideband**. This is a specific deterministic test, not a broadband rejection specification. Zero shift/zero rotation returns the aligned real path. Active shift uses 127 samples of latency (2.65 ms at 48 kHz); global bypass is immediate passthrough. See [Smith's analytic-signal and Hilbert-filter derivation](https://www.dsprelated.com/freebooks/mdft/Analytic_Signals_Hilbert_Transform.html).

### Allpass orbit

Four equal first-order sections implement:

```
H(z) = [(a + z^-1)/(1 + a z^-1)]^4
a = (tan(π fc/fs) − 1)/(tan(π fc/fs) + 1)
fc(t) = center · 2^(depth · sin(2π rate · t))
```

The coefficient is constrained to a stable range and smoothed. At a fixed center, the wet chain has unity magnitude. Mixing it with dry audio produces two phase-cancellation notches. A fixed 800 Hz center predicts the first at **331.6 Hz**, verified numerically. Modulating the center in octaves with a sine LFO sweeps the notches. See [Smith's allpass-phaser construction](https://www.dsprelated.com/freebooks/pasp/Virtual_Analog_Example_Phasing.html).

## 9. Nested rules: function composition per voice

A sequence of amplitude rules extends the base output law:

```
x0 = base(S,C) + direct_operator_mix
x(k+1) = clip(xk + wet_k · [F_k(xk, yk, amount_k) − xk], −8, 8)
```

The clip is applied only for active stages. The main input is always the previous result. The side input `y` selects zero, S, C, one of the six current operator samples, or the previous internal voice output, bounded to ±4. That feedback tap is taken after voice fold/drive and before ADSR/velocity. It starts at zero at note-on. All stages read the same previous-output tap; there is no zero-delay feedback or forward stage reference. Four allocated slots place an explicit ceiling on processing depth. Disabled stages and zero wet do no work and preserve the input exactly.

| Rule | F(x,y,g) |
| --- | --- |
| Add | `x + g*y` |
| Multiply | `g*x*y` |
| Soft quotient | `tanh(g*x / (0.15 + abs(y)))` |
| Signed magnitude | `sign(x+y) * hypot(g*x,y)`, positive sign at zero |
| Phase angle | `atan2(g*x,y)/π`, zero near the zero vector |
| Sine | `sin(g*x+y)` |
| Centered cosine | `(cos(g*x+y)−cos(y))/2` |
| Wavefold | `fold(g*x+y)` |
| Chebyshev | `(Tn(clip(x,−1,1))−Tn(0))/(1+abs(Tn(0)))`, `n=round(g)` |
| Soft saturation | `tanh(g*x+y)` |
| Vector mix | `x*cos(g)+y*sin(g)` |

Chebyshev has order 2–12 and ignores `y`; other amounts range from 0–4. Cosine and Chebyshev remove their zero-input offset. Side taps, nonlinear shaping and partial wet mixing can still introduce DC, which the output blocker removes. In the first template the complete expression is:

```
u = (S+C) * C
v = sin(2.2*u)
out = 0.3*v + 0.7*fold(1.8*v)
```

Applying sine before multiplication instead yields `C*sin(2.2*(S+C))`; the two are generally unequal. This is genuine sequential composition rather than several parallel rules mixed at the output. It differs from operator PM nesting: `sin(φ1 + I*sin(φ2 + J*sin φ3))` works on oscillator phase, while this stack transforms the resulting audio amplitudes. Preset 25 combines the existing delayed PM chain with three amplitude rules.

### What this says about a physical port

Serial oscillator PM and sequential amplitude rules are different computations. This browser implements both, with explicit delayed feedback and fixed slot counts. Their presence does not establish the capabilities or processing budget of a physical synthesizer.

A shallow multiply → sine-LUT → fold stack is a plausible fixed-point port candidate. It can reuse oscillator taps and needs no additional voices or per-stage delay buffers. Division, atan2, high-order polynomials and multiple trig evaluations cost more, so depth alone is a poor CPU predictor. Port selected recipes to bounded fixed-point operations, benchmark the target build at maximum polyphony and worst-case settings, then validate on the device when it is available. The current implementation is in the software lab only.

## 10. Memory gives rules a history

The shared echo and room prototypes process the voice-stack output after the existing insert chain. A circular buffer supplies delayed samples as rule inputs. Two routing choices expose independent parallel returns or dry+echo feeding the room. Feedback color uses a normalized sine/fold subset; unlike the unrestricted voice stack, it has a defined non-amplifying scalar slope. The four-line room combines an orthogonal Hadamard mixer with sin/cos rotations and per-line decay losses.

The two new experiments explore repeated rule application and scattering between delayed coordinates. Full equations, actual sample-memory counts, interpolation/aliasing limits, alternate uses of read taps and the hardware port sequence are in [BUFFER-RESEARCH.md](BUFFER-RESEARCH.md).

## 11. Crossings turn a waveform into control events

Qualified upward/downward crossings can count oscillations, delimit segments for RMS/area measurements, or advance a control divider. Hysteresis and an envelope gate reject chatter and silence. A complex trig stack can cross zero several times per fundamental cycle, so this event stream describes waveform geometry rather than guaranteeing pitch detection.

The lab accumulates these features on dry, delay, room and recall contributions. A countdown of N future rising crossings can trigger a retrospective capture. The control event happens now, while the captured sound begins a chosen number of beats earlier in a continuously recorded history. Pinning that slice separates playback from the advancing write head: toggling OFF/ON recalls the same audio; grabbing again replaces it. Full behavior, equations, copy bounds and hardware memory tradeoffs are in [CROSSING-MEMORY.md](CROSSING-MEMORY.md).

## 12. Hybrid sample and trigonometric synthesis

The palette, magnitude-derived patches and shared effects already connect recorded and synthesized material. [HYBRIDIZATION.md](HYBRIDIZATION.md) develops further proposals for table/grain blending, remembered choices, harmonic trajectories and waveset processing, with controls, resource estimates and tests.
