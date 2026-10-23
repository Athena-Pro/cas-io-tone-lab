# Buffer-based trig effects: audible prototype and hardware budget

Use a **shared post-voice bus** as the first hardware candidate. It stores the mixed output of the existing per-voice trig stacks once, so delay/reverb memory and processing do not multiply by voice count or synthesis oversampling. A one-second echo plus the small default room needs **102,346 bytes of PCM16 sample storage at 44.1 kHz**, or **51,190 bytes at 22.05 kHz**, before filter state, alignment and rate conversion. The lab implements the effects audibly in floating point; neither rate reduction nor a fixed-point firmware port is implemented.

## Implemented signal path

```
voice stack → ADSR → voice mix → existing trig inserts
                                  ├→ echo → return ─┐
                                  └→ room → return ─┤→ dry + returns → DC block/master
```

Parallel mode sends the insert output to both effects. Serial mode sends dry + echo return into the room. RETURN controls add wet signal without removing dry. Both effects run at the output rate and continue after all voices have released. Presets clear buffer histories; parameter changes retain them. Global effects bypass clears the histories and passes dry signal directly. Disabling an individual effect fades its return over about 20 ms and clears its history when that fade is negligible. Clear buffer tails erases only these memories; Panic clears voices and every effect.

Preset 26 demonstrates colored echoes, 27 the rotating room, and 28 a nested stack through both effects. The two new theory experiments isolate their behavior. SCL+EDIT on the selected buffer bank opens its four extra controls; ALGORITHM chooses the loop rule.

## 1. Delay: a stored result becomes the next input

Each output sample reads a fractional circular-buffer tap, filters it, and writes the current input plus feedback:

```
d[n] = (1−f) buffer[i] + f buffer[i+1]
q[n] = (1−damping) d[n] + damping q[n−1]
write[n] = input[n] + feedback · L(q[n])
output[n] = input[n] + return · d[n]
D[n] = smoothed_time · fs + depth_ms · fs/1000 · sin(phase[n])
```

The time control spans 5–1000 ms, feedback −0.95 to +0.95, and modulation depth 0–5 ms. A fixed clean integer tap gives echoes at D, 2D, 3D with feedback powers 1, g, g²; negative feedback alternates their signs. Time changes are smoothed, rather than crossfaded between two fixed taps, and deliberately produce tape-style pitch movement. Sine modulation produces chorus/wow. Linear interpolation is inexpensive but attenuates high frequencies at fractional taps; that coloration recirculates. [Smith describes these interpolation choices and the gain-error advantage of allpass interpolation for nearly lossless loops.](https://www.dsprelated.com/freebooks/pasp/Delay_Line_Signal_Interpolation.html)

The buffer receives the already-composed trig stack output. Placing shaping **inside** feedback then changes each later repeat again, rather than just coloring the original note once. The first delayed sample remains unchanged; its recirculation is colored.

### A restricted loop stack makes the gain predictable

An arbitrary amplitude stack may have gain above unity or generate nonzero output from a side input. A final output limiter alone does not define its internal feedback behavior. This prototype instead uses a normalized subset:

```
CLEAN:       F(x) = x
SINE:        F(x) = sin(gx)/g
SINE → FOLD: u = sin(gx)/g; F(x) = fold(2gu)/(2g)
L(x) = (1−color)x + color F(x)
```

Each maps zero to zero and has slope magnitude at most one. Convex color blending preserves that property, so the nonlinear rule contributes no additional scalar loop gain. With fixed taps, damping and |feedback| < 1, this provides a useful decay constraint. Four-line orthogonal mixing preserves the corresponding vector norm. Continuous time/size changes are time-varying systems; their behavior still needs stress testing. Buffer writes are bounded to ±8 in the software engine. Finite storage also changes the very end of a decay; PCM16 limit cycles and dither need assessment in a fixed-point port.

## 2. Reverb: distribute the memory across unequal lines

The room uses four nominal lines of **29.7, 37.1, 41.1 and 43.7 ms**, scaled by room size 0.4–1.5. Two input allpass diffusers use **3.1 and 5.3 ms**. Damping low-passes each line's output before the feedback rule.

The feedback mixer first applies a normalized 4×4 Hadamard transform H, then two opposite-angle 2×2 rotations:

```
H(v) = ½ [v0+v1+v2+v3, v0−v1+v2−v3,
          v0+v1−v2−v3, v0−v1−v2+v3]
Rθ(a,b) = [cosθ·a − sinθ·b, sinθ·a + cosθ·b]
write_i = injection_i · diffused_input + loss_i · [R H L(v)]_i
loss_i = 10^(−3 · line_seconds_i / nominal_decay_seconds)
```

H and R preserve vector energy. Changing the scatter angle changes feedback coupling and the network's modes while keeping matrix gain fixed. Rotation coefficients and loss gains are computed when parameters change, rather than evaluating those trig/power functions per sample. The sine/fold loop law, when selected, still runs per sample. Orthogonal feedback matrices and unequal lines are standard FDN building blocks. [Smith's FDN treatment discusses matrix choice, delay lengths and frequency-dependent decay.](https://www.dsprelated.com/freebooks/pasp/FDN_Reverberation.html)

DECAY is nominal, not a measured broadband RT60 guarantee: filtering, interpolation and nonlinear color change the frequency-dependent decay. Four lines are intentionally economical and can sound metallic; this is a useful small-room/textural network, not a room-acoustics simulation or an asserted studio-quality reverb.

## 3. Memory and physical overhead

For sample storage, `bytes = sample_rate × stored_seconds × bytes_per_sample × channels × instances`, with rounded line lengths and small interpolation guards. Multiple taps reuse one buffer; independent histories require additional storage.

| Proposed allocation | Echo | Room + diffusers | Total |
| --- | ---: | ---: | ---: |
| Shared mono, 44.1 kHz PCM16, 1 s echo + size 1 room | 88,204 B | 14,142 B | **102,346 B / 99.9 KiB** |
| Shared mono, 22.05 kHz PCM16, same lengths | 44,104 B | 7,086 B | **51,190 B / 50.0 KiB** |
| Shared stereo, 22.05 kHz PCM16 | 88,208 B | 14,172 B | **102,380 B / 100.0 KiB** |
| Eight independent mono histories, 22.05 kHz PCM16 | 352,832 B | 56,688 B | **409,520 B / 399.9 KiB** |
| Actual browser reserve, 48 kHz Float32, max capacities | 193,928 B | 45,336 B | **239,264 B / 233.7 KiB** |

The browser preallocates a 1.01-second echo reserve for modulation margin, room lines at maximum size 1.5, and both diffusers. Those arrays persist across parameter, polyphony and oversampling changes. The extra scratch arrays and object/scalar state are excluded from the sample-storage numbers. The planner models a *proposed build capped at the selected echo length and current room size*; it does not shrink or resample the running browser buffers. Its stereo option is budgeting only; the live engine remains mono.

The sample-storage arithmetic above does not establish available target memory or instruction time. Rate reduction requires proper anti-alias filtering before storage and filtering on return. Allocation placement, code size, state and stack must be measured in the intended target build. Browser reserve and proposed PCM16 plans are distinct designs.

A practical port sequence is one shared clean PCM16 echo at the native output rate, then damping, then a sine-LUT loop rule, followed by the four-line room if timing remains available. Use preallocated pool/static memory, block-prepared coefficients, wide saturating accumulators and explicit buffer bounds. Benchmark worst-case voice stacks plus effects together. A half-rate wet bus is the next optimization if justified by measured load or memory pressure.

## 4. Other directions worth testing

| Direction | Reuses | Trig connection | Main tradeoff |
| --- | --- | --- | --- |
| Multi-tap echoes | One history, several read heads | Move/read-blend taps with sine LFOs | More reads/interpolation; little extra sample RAM |
| Two-tap spectral motion | One history | `cos²θ·tap1 + sin²θ·tap2` is a convex moving blend | Comb coloration and pitch changes if taps move |
| True stereo scattering | Two or more histories | Orthogonal I/Q-style rotation between delayed channels | Channel buffers and stereo output path cost more |
| Short resonator / plucked string | Short tuned feedback line | Trig/fold nonlinearity in a damped loop | Needs accurate fractional tuning and low-loss interpolation |
| Freeze | Existing room network | Remove input and loss; keep energy-preserving mixing | Quantization, interpolation loss and parameter motion require separate design |
| SSB in echo feedback | Existing shift plus echo | Rotate analytic delayed samples each repeat | Repeated Hz shifts; the Hilbert filter adds substantial work |

These are research directions, not additional implemented controls. In particular, freeze is not implemented by merely setting feedback above its current limit.

## Verification and limits

Thirteen buffer checks cover echo positions and signs, fractional reads/wrap, loop contraction, matrix norm, dense decaying room tails, repeat recoloring, parallel/serial differences, tails after voice release, exact sample allocation and persistence, bypass/clear/panic, malformed settings, generated worklet/offline parity and bounded parameter stress. In the specified clean room impulse test, energy at 3–4 seconds is **65.7 dB below** energy at 0.5–1 seconds; that is one test case, not a general reverb specification.

The room and echo loops run at output rate. Their nonlinear shaping and modulated taps can alias; voice oversampling does not oversample this wet bus. WAV uses a conservative feedback/decay-based tail estimate capped at 12 seconds, with a final 50 ms fade when capped. Browser timing and sample-memory arithmetic are evidence for the prototype only. Firmware is unchanged and the physical hardware has not been tested.

The separate retrospective-recall module now adds a continuously recorded history and two capture banks. Its native 48 kHz Float32 storage adds 1,776,016 bytes beyond the echo/room allocation above. It can capture dry or actual return buses, never its own recall return. See [CROSSING-MEMORY.md](CROSSING-MEMORY.md) for the implemented crossing trigger and lower-rate hardware budget; the echo/room planner does not include this extra history.
